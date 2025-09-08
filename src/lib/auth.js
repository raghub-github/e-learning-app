// src/lib/auth.js
/**
 * Authentication helpers
 *
 * getUserFromRequest(req)
 *   - supports Next.js Request (Web Fetch API) and Express-style req
 *   - reads Authorization: Bearer <token> OR 'refreshToken' cookie
 *   - verifies access token; if expired and refresh token valid, rotates tokens
 *   - returns { user, tokens } where tokens = { accessToken, refreshToken (maybe) }
 *
 * requireAuth(handler)
 *   - wrapper that works with:
 *     * Express-style handlers (req,res,next) => returns middleware (req,res,next)
 *     * Next.js App Router route handlers (req [, ctx]) => returns async (req, ctx)
 *
 * Notes:
 *  - This module is intentionally flexible; adapt your route handlers to accept
 *    the second parameter (auth context) when using Next.js App Router.
 *  - For Express-style, req.user will be attached and req.auth.tokens set.
 */

import {
  verifyAccessToken,
  verifyRefreshToken,
  signAccessToken,
  signRefreshToken,
  generateTokens,
  getRefreshTokenCookie,
  clearRefreshTokenCookie,
} from './jwt.js';
import dbConnect from './dbConnect.js';
import User from '../models/User.js';
import logger from './logger.js';

const ACCESS_TOKEN_HEADER = 'authorization';
const REFRESH_COOKIE_NAME = 'refreshToken';

/**
 * Helper: parse cookie header into object
 * Supports:
 *  - raw header string "a=1; b=2"
 *  - Express req.cookies (object) -> returned as-is
 *  - Next.js Request.cookies API (has get method) -> we will read via that API in caller
 */
export function parseCookiesFromHeader(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [rawName, ...rest] = part.split('=');
    if (!rawName) continue;
    const name = rawName.trim();
    const value = rest.join('=').trim();
    cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

/**
 * Helper: extract token from Authorization header value
 */
function extractBearerTokenFromHeaderValue(headerVal) {
  if (!headerVal) return null;
  const m = headerVal.match(/^\s*Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

/**
 * Try to read access token from multiple sources:
 *  - Authorization header (Bearer)
 *  - cookie named 'accessToken' (optional)
 *
 * For req detection:
 *  - Next.js Request (fetch API) -> has headers.get, cookies.get
 *  - Express req -> has headers and cookies object
 */
async function _readTokensFromRequest(req) {
  // return { accessToken, refreshToken, context: 'express'|'next'|'other' }
  let accessToken = null;
  let refreshToken = null;
  let ctx = 'unknown';

  // Next.js Request-like (Web Fetch API)
  if (req && typeof req.headers?.get === 'function') {
    ctx = 'next';
    // Authorization header
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    accessToken = extractBearerTokenFromHeaderValue(authHeader);
    // Cookies via Request.cookies (Next.js)
    try {
      if (typeof req.cookies?.get === 'function') {
        const r = req.cookies.get(REFRESH_COOKIE_NAME);
        if (r) refreshToken = r.value;
      } else if (req.headers.get('cookie')) {
        // fallback to raw header parse
        const parsed = parseCookiesFromHeader(req.headers.get('cookie'));
        if (parsed[REFRESH_COOKIE_NAME]) refreshToken = parsed[REFRESH_COOKIE_NAME];
      }
    } catch (err) {
      // ignore cookie read errors
      logger?.warn?.('Error reading cookies from Next Request', { err: err?.message });
    }
    return { accessToken, refreshToken, ctx };
  }

  // Express / Node-style request object
  if (req && req.headers) {
    ctx = 'express';
    const authHeader = req.headers.authorization || req.headers.Authorization;
    accessToken = extractBearerTokenFromHeaderValue(authHeader);
    if (req.cookies && typeof req.cookies === 'object') {
      // Express cookie-parser
      refreshToken = req.cookies[REFRESH_COOKIE_NAME];
    } else if (req.headers.cookie) {
      const parsed = parseCookiesFromHeader(req.headers.cookie);
      refreshToken = parsed[REFRESH_COOKIE_NAME];
    }
    return { accessToken, refreshToken, ctx };
  }

  // Fallback: raw object
  return { accessToken: null, refreshToken: null, ctx: 'unknown' };
}

/**
 * Create helpers to set/clear refresh cookie for context.
 * For Next.js route handlers you would call:
 *   const setCookie = (res, token) => res.cookies.set(...)
 * But here we abstract:
 * - For Next.js we return functions that accept a NextResponse-like object
 * - For Express, they accept (res, token) and call res.setHeader('Set-Cookie', ...)
 */
function createCookieHelpersForContext(ctx) {
  const setRefreshCookie = (res, token) => {
    const cookieStr = getRefreshTokenCookie(token);
    if (ctx === 'express') {
      // For Express, append header (preserve existing Set-Cookie)
      const prev = res.getHeader && res.getHeader('Set-Cookie');
      if (prev) {
        // ensure header is an array
        const arr = Array.isArray(prev) ? prev.concat(cookieStr) : [prev, cookieStr];
        res.setHeader('Set-Cookie', arr);
      } else {
        res.setHeader && res.setHeader('Set-Cookie', cookieStr);
      }
      return;
    }
    if (ctx === 'next') {
      // For Next.js App Router route handlers we expect a NextResponse object to be returned by user.
      // We expose a helper that the route handler can call to set cookie on a NextResponse instance:
      //   setRefreshCookie(nextResponse, token)
      if (!res) return;
      // NextResponse has cookies.set(name, value, options)
      if (typeof res.cookies?.set === 'function') {
        // Parse cookie string produced by jwt.getRefreshTokenCookie to options
        // But since NextResponse.cookies.set API accepts (name, value, options), and we have cookie string,
        // prefer setting with name & value and default options here.
        // Use conservative options similar to jwt.getRefreshTokenCookie
        res.cookies.set({
          name: REFRESH_COOKIE_NAME,
          value: token,
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          // Max-age derived in jwt.getRefreshTokenCookie; set a large default if required
        });
      } else if (typeof res.headers?.append === 'function') {
        // If res exposes headers, append Set-Cookie
        res.headers.append('Set-Cookie', getRefreshTokenCookie(token));
      }
      return;
    }
    // unknown ctx: do nothing
  };

  const clearRefreshCookieFn = res => {
    const cookieStr = clearRefreshTokenCookie();
    if (ctx === 'express') {
      const prev = res.getHeader && res.getHeader('Set-Cookie');
      if (prev) {
        const arr = Array.isArray(prev) ? prev.concat(cookieStr) : [prev, cookieStr];
        res.setHeader('Set-Cookie', arr);
      } else {
        res.setHeader && res.setHeader('Set-Cookie', cookieStr);
      }
      return;
    }
    if (ctx === 'next') {
      if (!res) return;
      if (typeof res.cookies?.delete === 'function') {
        res.cookies.delete(REFRESH_COOKIE_NAME, { path: '/' });
      } else if (typeof res.headers?.append === 'function') {
        res.headers.append('Set-Cookie', cookieStr);
      }
      return;
    }
  };

  return { setRefreshCookie, clearRefreshCookie: clearRefreshCookieFn };
}

/**
 * getUserFromRequest:
 *  - reads tokens from request
 *  - tries to verify access token; if valid => fetch user and return
 *  - if access token invalid/expired and refresh token present & valid => generate new tokens, fetch user
 *
 * Returns:
 *   {
 *     user: <UserModel or null>,
 *     tokens: { accessToken, refreshToken } | null,
 *     ctx: 'express'|'next'|'unknown'
 *   }
 */
export async function getUserFromRequest(req) {
  await dbConnect(); // ensure DB connection (idempotent)
  const { accessToken, refreshToken, ctx } = await _readTokensFromRequest(req);
  let decoded = null;
  let tokens = null;

  // Try access token first
  if (accessToken) {
    try {
      decoded = await verifyAccessToken(accessToken);
    } catch (err) {
      // token invalid or expired. we'll attempt refresh below
      logger?.info?.('Access token verify failed', { reason: err?.message });
      decoded = null;
    }
  }

  // If access token invalid and refresh token present, try rotate
  if (!decoded && refreshToken) {
    try {
      const refreshDecoded = await verifyRefreshToken(refreshToken);
      // Create new tokens (rotate)
      const newAccess = await signAccessToken(refreshDecoded.sub, refreshDecoded.roles || []);
      // Optionally rotate refresh token as well
      const newRefresh = await signRefreshToken(refreshDecoded.sub, refreshDecoded.roles || []);
      tokens = { accessToken: newAccess, refreshToken: newRefresh };
      decoded = await verifyAccessToken(newAccess); // decode to get sub
    } catch (err) {
      logger?.info?.('Refresh token verify failed', { reason: err?.message });
      // expired/invalid refresh as well → treat as unauthenticated
      decoded = null;
      tokens = null;
    }
  }

  if (!decoded) {
    return { user: null, tokens: null, ctx };
  }

  // Fetch user from DB
  try {
    const userId = decoded.sub;
    const user = await User.findById(userId).select('-passwordHash').lean();
    if (!user) {
      return { user: null, tokens: null, ctx };
    }
    return { user, tokens, ctx };
  } catch (err) {
    logger?.error?.('Error fetching user in getUserFromRequest', { error: err?.message });
    return { user: null, tokens: null, ctx };
  }
}

/**
 * requireAuth wrapper
 *
 * Usage:
 * 1) Express:
 *    app.get('/api/protected', requireAuth((req, res) => { // req.user available }));
 *
 * 2) Next.js App Router:
 *    export default requireAuth(async (req, { user, tokens, setRefreshCookie }) => {
 *      // return NextResponse.json({ ... })
 *      // if tokens?.refreshToken present, call setRefreshCookie(response, tokens.refreshToken)
 *    });
 *
 * The wrapper detects handler arity and request type and acts accordingly.
 */
export function requireAuth(handler) {
  // If handler appears to be an Express-style function (3 args) we return middleware
  if (handler.length >= 3) {
    // Express middleware style (req, res, next)
    return async function expressAuthMiddleware(req, res, next) {
      try {
        const { user, tokens, ctx } = await getUserFromRequest(req);
        // attach to req for downstream handlers
        req.user = user;
        req.auth = { tokens };
        // attach helpers to set/clear cookies on Express res
        const { setRefreshCookie, clearRefreshCookie } = createCookieHelpersForContext('express');
        req.auth.setRefreshCookie = token => setRefreshCookie(res, token);
        req.auth.clearRefreshCookie = () => clearRefreshCookie(res);
        if (!user) {
          res.statusCode = 401;
          return res.json ? res.json({ error: 'Unauthorized' }) : res.end('Unauthorized');
        }
        return handler(req, res, next);
      } catch (err) {
        logger?.error?.('Authentication middleware error', { error: err?.message });
        // In Express, call next(err)
        return next(err);
      }
    };
  }

  // For Next.js (or generic) handlers, return an async function (req, ctx)
  return async function nextAuthHandler(req, ctx = {}) {
    // ctx is optional extra param; could be { params, searchParams } in Next route
    try {
      const { user, tokens, ctx: detectedCtx } = await getUserFromRequest(req);
      const cookieHelpers = createCookieHelpersForContext(detectedCtx);
      const authContext = {
        user,
        tokens,
        setRefreshCookie: (res, token) => cookieHelpers.setRefreshCookie(res, token),
        clearRefreshCookie: res => cookieHelpers.clearRefreshCookie(res),
      };

      if (!user) {
        // For Next.js App Router route handlers we need to return a Response-like object.
        // Caller handler is expected to return a NextResponse or Response.
        // Here we return a 401 JSON response if unauthenticated.
        // If the handler wants different behavior, it should call getUserFromRequest itself.
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Call original handler with authContext as second arg (developer must accept it)
      // handler signature: handler(req, authContext)
      // If handler expects only req, it can still access tokens via cookies/headers
      const result = await handler(req, authContext);
      return result;
    } catch (err) {
      logger?.error?.('requireAuth wrapper error', { error: err?.message });
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}

export default {
  getUserFromRequest,
  requireAuth,
  parseCookiesFromHeader,
};
