/**
 * Authentication Service — Password hashing, JWT sign/verify
 */

import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "change-this-secret-in-production-min-32-chars!!"
);
const JWT_EXPIRES_IN = "15m";
const REFRESH_TOKEN_EXPIRES_IN = "7d";

export interface JWTPayload {
  userId: string;
  email: string;
  provider: string;
}

/**
 * Hash password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Verify password against hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate access token (JWT)
 */
export async function generateAccessToken(payload: JWTPayload): Promise<string> {
  return new SignJWT(payload as any)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(JWT_SECRET);
}

/**
 * Verify and decode access token
 */
export async function verifyAccessToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Generate refresh token (random string)
 */
export function generateRefreshToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Get token expiration date
 */
export function getRefreshTokenExpiresAt(): Date {
  const date = new Date();
  // Parse REFRESH_TOKEN_EXPIRES_IN (e.g., "7d" → 7 days)
  const match = REFRESH_TOKEN_EXPIRES_IN.match(/^(\d+)([dhms])$/);
  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case "d": date.setDate(date.getDate() + value); break;
      case "h": date.setHours(date.getHours() + value); break;
      case "m": date.setMinutes(date.getMinutes() + value); break;
      case "s": date.setSeconds(date.getSeconds() + value); break;
    }
  } else {
    date.setDate(date.getDate() + 7); // default 7 days
  }
  return date;
}
