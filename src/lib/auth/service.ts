/**
 * Authentication Service
 *
 * Password hashing
 * JWT access tokens
 * Short-lived 2FA login challenges
 * Refresh-token helpers
 */

import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret) {
    throw new Error(
      "JWT_SECRET chưa được cấu hình",
    );
  }

  if (secret.length < 32) {
    throw new Error(
      "JWT_SECRET phải có ít nhất 32 ký tự",
    );
  }

  return new TextEncoder().encode(secret);
}

const JWT_EXPIRES_IN = "15m";
const REFRESH_TOKEN_EXPIRES_IN = "7d";
const TWO_FACTOR_CHALLENGE_EXPIRES_IN = "5m";

export interface JWTPayload {
  userId: string;
  email: string;
  provider: string;
}

export interface TwoFactorChallengePayload {
  userId: string;
  provider: string;
  purpose: "2fa_login";
}

/**
 * Hash password using bcrypt.
 */
export async function hashPassword(
  password: string,
): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Verify password against hash.
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate normal access token.
 */
export async function generateAccessToken(
  payload: JWTPayload,
): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({
      alg: "HS256",
    })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(getJwtSecret());
}

/**
 * Verify normal access token.
 */
export async function verifyAccessToken(
  token: string,
): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      getJwtSecret(),
      {
        algorithms: ["HS256"],
      },
    );

    if (
      typeof payload.userId !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.provider !== "string"
    ) {
      return null;
    }

    return {
      userId: payload.userId,
      email: payload.email,
      provider: payload.provider,
    };
  } catch {
    return null;
  }
}

/**
 * Generate short-lived challenge used ONLY
 * between primary authentication and TOTP verification.
 *
 * This token does NOT authenticate the user.
 */
export async function generateTwoFactorChallenge(
  payload: TwoFactorChallengePayload,
): Promise<string> {
  return new SignJWT({
    userId: payload.userId,
    provider: payload.provider,
    purpose: "2fa_login",
  })
    .setProtectedHeader({
      alg: "HS256",
    })
    .setIssuedAt()
    .setExpirationTime(
      TWO_FACTOR_CHALLENGE_EXPIRES_IN,
    )
    .setJti(
      crypto.randomUUID(),
    )
    .sign(getJwtSecret());
}

/**
 * Verify short-lived 2FA challenge.
 */
export async function verifyTwoFactorChallenge(
  token: string,
): Promise<TwoFactorChallengePayload | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      getJwtSecret(),
      {
        algorithms: ["HS256"],
      },
    );

    if (
      payload.purpose !== "2fa_login" ||
      typeof payload.userId !== "string" ||
      typeof payload.provider !== "string"
    ) {
      return null;
    }

    return {
      userId: payload.userId,
      provider: payload.provider,
      purpose: "2fa_login",
    };
  } catch {
    return null;
  }
}

/**
 * Generate refresh token.
 */
export function generateRefreshToken(): string {
  const array = new Uint8Array(32);

  crypto.getRandomValues(array);

  return Array.from(
    array,
    (b) =>
      b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Get refresh-token expiration.
 */
export function getRefreshTokenExpiresAt(): Date {
  const date = new Date();

  const match =
    REFRESH_TOKEN_EXPIRES_IN.match(
      /^(\d+)([dhms])$/,
    );

  if (match) {
    const value = parseInt(
      match[1],
      10,
    );

    const unit = match[2];

    switch (unit) {
      case "d":
        date.setDate(
          date.getDate() + value,
        );
        break;

      case "h":
        date.setHours(
          date.getHours() + value,
        );
        break;

      case "m":
        date.setMinutes(
          date.getMinutes() + value,
        );
        break;

      case "s":
        date.setSeconds(
          date.getSeconds() + value,
        );
        break;
    }
  } else {
    date.setDate(
      date.getDate() + 7,
    );
  }

  return date;
}
