import crypto from "crypto";

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function getEncryptionKey(): Buffer {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET phải được cấu hình và có ít nhất 32 ký tự",
    );
  }

  return crypto
    .createHash("sha256")
    .update(secret)
    .digest();
}

/**
 * Base32 encode.
 *
 * Google Authenticator và các authenticator app phổ biến
 * sử dụng Base32 cho TOTP secret.
 */
export function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(value >> bits) & 31];
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Base32 decode.
 */
export function base32Decode(input: string): Buffer {
  const normalized = input
    .replace(/[\s=-]/g, "")
    .toUpperCase();

  let bits = 0;
  let value = 0;

  const output: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);

    if (index < 0) {
      throw new Error("TOTP secret không hợp lệ");
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      output.push((value >> bits) & 0xff);
    }
  }

  return Buffer.from(output);
}

/**
 * Tạo secret 160-bit.
 */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/**
 * Encrypt TOTP secret trước khi lưu DB.
 *
 * Không lưu secret dạng plaintext trong database.
 */
export function encryptTotpSecret(secret: string): string {
  const key = getEncryptionKey();

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    key,
    iv,
  );

  cipher.setAAD(
    Buffer.from("orca-financial-2fa"),
  );

  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

/**
 * Decrypt TOTP secret từ DB.
 */
export function decryptTotpSecret(
  encryptedSecret: string,
): string {
  const parts = encryptedSecret.split(".");

  if (
    parts.length !== 4 ||
    parts[0] !== "v1"
  ) {
    throw new Error(
      "TOTP secret format không hợp lệ",
    );
  }

  const [, ivEncoded, tagEncoded, dataEncoded] =
    parts;

  const key = getEncryptionKey();

  const iv = Buffer.from(
    ivEncoded,
    "base64url",
  );

  const authTag = Buffer.from(
    tagEncoded,
    "base64url",
  );

  const encrypted = Buffer.from(
    dataEncoded,
    "base64url",
  );

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    iv,
  );

  decipher.setAAD(
    Buffer.from("orca-financial-2fa"),
  );

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Sinh mã TOTP 6 số.
 */
export function generateTotpCode(
  secret: string,
  timestamp = Date.now(),
): string {
  const secretBuffer = base32Decode(secret);

  const counter = Math.floor(
    timestamp / 1000 / TOTP_PERIOD_SECONDS,
  );

  const counterBuffer = Buffer.alloc(8);

  counterBuffer.writeUInt32BE(
    Math.floor(counter / 0x100000000),
    0,
  );

  counterBuffer.writeUInt32BE(
    counter >>> 0,
    4,
  );

  const hmac = crypto
    .createHmac("sha1", secretBuffer)
    .update(counterBuffer)
    .digest();

  const offset =
    hmac[hmac.length - 1] & 0x0f;

  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const code =
    binary % 10 ** TOTP_DIGITS;

  return String(code).padStart(
    TOTP_DIGITS,
    "0",
  );
}

/**
 * Verify mã TOTP.
 *
 * Cho phép lệch tối đa ±1 time window
 * để xử lý trường hợp đồng hồ điện thoại lệch nhẹ.
 */
export function verifyTotpCode(
  secret: string,
  inputCode: string,
  timestamp = Date.now(),
): boolean {
  const normalized = inputCode
    .replace(/\s/g, "")
    .trim();

  if (!/^\d{6}$/.test(normalized)) {
    return false;
  }

  const currentCounter = Math.floor(
    timestamp / 1000 / TOTP_PERIOD_SECONDS,
  );

  for (
    let offset = -TOTP_WINDOW;
    offset <= TOTP_WINDOW;
    offset++
  ) {
    const candidateTimestamp =
      (currentCounter + offset) *
      TOTP_PERIOD_SECONDS *
      1000;

    const expected = generateTotpCode(
      secret,
      candidateTimestamp,
    );

    const expectedBuffer =
      Buffer.from(expected);

    const actualBuffer =
      Buffer.from(normalized);

    if (
      expectedBuffer.length ===
        actualBuffer.length &&
      crypto.timingSafeEqual(
        expectedBuffer,
        actualBuffer,
      )
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Tạo otpauth URI dùng cho Google Authenticator,
 * Microsoft Authenticator, Authy, 1Password...
 */
export function buildTotpUri(
  secret: string,
  email: string,
): string {
  const issuer = "Orca Financial";

  const label = `${issuer}:${email}`;

  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });

  return `otpauth://totp/${encodeURIComponent(
    label,
  )}?${params.toString()}`;
}
