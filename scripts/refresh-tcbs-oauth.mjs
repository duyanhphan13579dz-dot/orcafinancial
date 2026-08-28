#!/usr/bin/env node

/**
 * Refresh an existing TCBS MCP OAuth token.
 *
 * The initial authorization-code flow must be completed through TCBS's
 * official OAuth client registration. This script only performs the standard
 * refresh_token grant once TCBS has supplied the token endpoint and refresh
 * token. Secrets are never printed.
 */

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const tokenUrl = required("TCBS_MCP_TOKEN_URL");
const clientId = required("TCBS_MCP_CLIENT_ID");
const refreshToken = required("TCBS_MCP_REFRESH_TOKEN");
const clientSecret = process.env.TCBS_MCP_CLIENT_SECRET?.trim();

const body = new URLSearchParams({
  grant_type: "refresh_token",
  refresh_token: refreshToken,
  client_id: clientId,
});
if (clientSecret) body.set("client_secret", clientSecret);

const response = await fetch(tokenUrl, {
  method: "POST",
  headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
  body,
  cache: "no-store",
});
const payload = await response.json().catch(() => ({}));
if (!response.ok) {
  const code = typeof payload.error === "string" ? payload.error : `HTTP_${response.status}`;
  throw new Error(`TCBS OAuth refresh failed: ${code}`);
}

const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
if (!accessToken) throw new Error("TCBS OAuth response did not contain access_token");

const expiresIn = Number(payload.expires_in);
const expiresAt = Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined;
const rotatedRefreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : refreshToken;

const outputFile = process.env.TCBS_MCP_TOKEN_OUTPUT_FILE?.trim();
const tokenPayload = {
  access_token: accessToken,
  refresh_token: rotatedRefreshToken,
  token_type: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
  expires_in: Number.isFinite(expiresIn) ? expiresIn : undefined,
  expires_at: expiresAt,
};
if (outputFile) {
  const { writeFile, chmod } = await import("node:fs/promises");
  await writeFile(outputFile, `${JSON.stringify(tokenPayload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(outputFile, 0o600);
}
console.log(JSON.stringify({
  ok: true,
  tokenType: tokenPayload.token_type,
  expiresIn: Number.isFinite(expiresIn) ? expiresIn : null,
  expiresAt: expiresAt ?? null,
  refreshTokenRotated: rotatedRefreshToken !== refreshToken,
  tokenWrittenToFile: Boolean(outputFile),
  note: outputFile ? "Tokens written to the requested file with mode 600." : "Tokens were not printed. Set TCBS_MCP_TOKEN_OUTPUT_FILE to write them securely.",
}));
