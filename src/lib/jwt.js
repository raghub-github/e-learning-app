// src/lib/jwt.js
import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import crypto from 'crypto';

const signAsync = promisify(jwt.sign);
const verifyAsync = promisify(jwt.verify);

const {
  JWT_SECRET,
  JWT_REFRESH_SECRET,
  ACCESS_TOKEN_EXP = '15m', // short-lived
  REFRESH_TOKEN_EXP = '30d', // long-lived
  NEXT_PUBLIC_BASE_URL = 'http://localhost:3000',
  NODE_ENV = 'development',
} = process.env;

if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  // Fail fast in dev/prod to avoid issuing insecure tokens
  // In tests you might bypass this, but for production we want explicit secrets set
  // Throwing here makes debugging easier if env is misconfigured.
  throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be set in environment variables');
}

/**
 * Helper: generate a random token id (jti)
 */
function generateJti() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Build standard JWT payload
 * @param {String} userId - Mongo ObjectId (string)
 * @param {Array<String>} roles - user roles
 * @param {Object} extras - extra claims to include
 */
function buildPayload(userId, roles = [], extras = {}) {
  const payload = {
    sub: String(userId),
    roles: Array.isArray(roles) ? roles : [roles],
    jti: generateJti(),
    ...extras,
  };
  return payload;
}

/**
 * Sign an access token (short-lived)
 * @param {String} userId
 * @param {Array<String>} roles
 * @param {Object} [opts] - extra jwt sign options (overrides default exp)
 * @returns {Promise<String>} JWT
 */
export async function signAccessToken(userId, roles = [], opts = {}) {
  const payload = buildPayload(userId, roles, opts.claims || {});
  const signOptions = {
    algorithm: 'HS256',
    expiresIn: opts.expiresIn || ACCESS_TOKEN_EXP,
    issuer: opts.issuer || NEXT_PUBLIC_BASE_URL,
    audience: opts.audience || undefined,
  };
  return signAsync(payload, JWT_SECRET, signOptions);
}

/**
 * Sign a refresh token (long-lived)
 * NOTE: refresh tokens should be stored as HttpOnly cookies (or secure storage) and verified carefully.
 * @param {String} userId
 * @param {Array<String>} roles
 * @param {Object} [opts]
 * @returns {Promise<String>} JWT
 */
export async function signRefreshToken(userId, roles = [], opts = {}) {
  const payload = buildPayload(userId, roles, opts.claims || {});
  const signOptions = {
    algorithm: 'HS256',
    expiresIn: opts.expiresIn || REFRESH_TOKEN_EXP,
    issuer: opts.issuer || NEXT_PUBLIC_BASE_URL,
    audience: opts.audience || undefined,
  };
  return signAsync(payload, JWT_REFRESH_SECRET, signOptions);
}

/**
 * Verify access token - returns decoded payload or throws an error.
 * @param {String} token
 * @returns {Promise<Object>}
 */
export async function verifyAccessToken(token) {
  if (!token) throw new Error('No access token provided');
  return verifyAsync(token, JWT_SECRET, { algorithms: ['HS256'] });
}

/**
 * Verify refresh token - returns decoded payload or throws an error.
 * @param {String} token
 * @returns {Promise<Object>}
 */
export async function verifyRefreshToken(token) {
  if (!token) throw new Error('No refresh token provided');
  return verifyAsync(token, JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
}

/**
 * Convenience: generate both access & refresh tokens for a user
 * @param {String} userId
 * @param {Array<String>} roles
 * @param {Object} [opts] - { accessOpts, refreshOpts }
 * @returns {Promise<{ accessToken, refreshToken }>}
 */
export async function generateTokens(userId, roles = [], opts = {}) {
  const accessToken = await signAccessToken(userId, roles, opts.accessOpts || {});
  const refreshToken = await signRefreshToken(userId, roles, opts.refreshOpts || {});
  return { accessToken, refreshToken };
}

/**
 * Cookie helpers for Refresh Token
 * Returns a Set-Cookie header string for the refresh token.
 * Keep refresh tokens HttpOnly + Secure + SameSite=strict (or 'lax' if you need cross-site post)
 *
 * Example usage in Next route:
 *   const cookie = getRefreshTokenCookie(refreshToken);
 *   res.setHeader('Set-Cookie', cookie);
 *
 * @param {String} token
 * @param {Object} [opts]
 * @returns {String}
 */
export function getRefreshTokenCookie(token, opts = {}) {
  const {
    httpOnly = true,
    secure = NODE_ENV === 'production',
    sameSite = 'lax', // 'lax' balances UX & CSRF protection; consider 'strict' if possible
    path = '/',
    maxAge = undefined, // seconds; if undefined we derive from REFRESH_TOKEN_EXP
  } = opts;

  // derive maxAge in seconds from REFRESH_TOKEN_EXP if not provided (basic parse)
  let computedMaxAge = maxAge;
  if (!computedMaxAge) {
    // supports values like '30d', '15m', numeric seconds
    const envVal = process.env.REFRESH_TOKEN_EXP || process.env.REFRESH_TOKEN_EXPIRES || undefined;
    // fallback to REFRESH_TOKEN_EXP local constant (string)
    const fallback = REFRESH_TOKEN_EXP;
    const ttl = envVal || fallback;
    // parse simple formats
    if (typeof ttl === 'string') {
      if (ttl.endsWith('d')) {
        const days = parseInt(ttl.slice(0, -1), 10);
        computedMaxAge = days * 24 * 60 * 60;
      } else if (ttl.endsWith('h')) {
        const hours = parseInt(ttl.slice(0, -1), 10);
        computedMaxAge = hours * 60 * 60;
      } else if (ttl.endsWith('m')) {
        const mins = parseInt(ttl.slice(0, -1), 10);
        computedMaxAge = mins * 60;
      } else {
        // try numeric (seconds)
        const v = parseInt(ttl, 10);
        computedMaxAge = Number.isNaN(v) ? undefined : v;
      }
    } else if (typeof ttl === 'number') {
      computedMaxAge = ttl;
    }
  }

  const parts = [
    `refreshToken=${token}`,
    `Path=${path}`,
    `HttpOnly=${httpOnly ? 'true' : 'false'}`,
    `SameSite=${sameSite}`,
  ];

  if (secure) parts.push('Secure');
  if (computedMaxAge) parts.push(`Max-Age=${computedMaxAge}`);

  // you may add Domain if needed: `.yourdomain.com`
  return parts.join('; ');
}

/**
 * Clear refresh token cookie header string
 */
export function clearRefreshTokenCookie(opts = {}) {
  const { path = '/' } = opts;
  // Set cookie with Max-Age=0 to clear
  return `refreshToken=; Path=${path}; Max-Age=0; HttpOnly=true; SameSite=lax${NODE_ENV === 'production' ? '; Secure' : ''}`;
}

/**
 * Utility: extract Bearer token from Authorization header
 * @param {String} headerVal
 * @returns {String|null}
 */
export function extractBearerToken(headerVal) {
  if (!headerVal) return null;
  const match = headerVal.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export default {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateTokens,
  getRefreshTokenCookie,
  clearRefreshTokenCookie,
  extractBearerToken,
};
