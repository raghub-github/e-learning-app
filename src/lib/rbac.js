// src/lib/rbac.js
/**
 * Role-based access control (RBAC) helpers.
 *
 * Usage:
 *   import { requireRole } from '@/lib/rbac';
 *
 *   // Next.js App Router:
 *   export default requireRole('admin')(async (req, { user }) => {
 *     return NextResponse.json({ secret: 'admin-only data' });
 *   });
 *
 *   // Express:
 *   app.get('/api/admin', requireRole('admin')((req, res) => {
 *     res.json({ ok: true, user: req.user });
 *   }));
 */

import logger from './logger.js';
import { requireAuth } from './auth.js';

/**
 * Check if a user object has at least one of the required roles.
 * Supports user.role (string) or user.roles (array).
 */
function userHasRole(user, requiredRoles) {
  if (!user) return false;
  const roles = Array.isArray(user.roles) ? user.roles : user.role ? [user.role] : [];
  return requiredRoles.some(role => roles.includes(role));
}

/**
 * requireRole wrapper
 *
 * @param {string|string[]} role - Required role(s). User must have at least one.
 * @returns {Function} wrapper(handler) -> secured handler
 */
export function requireRole(role) {
  const requiredRoles = Array.isArray(role) ? role : [role];

  return function withRole(handler) {
    // Wrap with requireAuth first
    const authedHandler = requireAuth(handler);

    // Express-style handler (req, res, next)
    if (handler.length >= 3) {
      return async function expressRoleMiddleware(req, res, next) {
        try {
          // requireAuth will attach req.user
          await authedHandler(req, res, async err => {
            if (err) return next(err);
            if (!req.user || !userHasRole(req.user, requiredRoles)) {
              logger?.warn?.('RBAC denied (Express)', {
                userId: req.user?._id,
                requiredRoles,
              });
              res.statusCode = 403;
              return res.json({ error: 'Forbidden' });
            }
            return handler(req, res, next);
          });
        } catch (err) {
          logger?.error?.('RBAC middleware error (Express)', { error: err?.message });
          return next(err);
        }
      };
    }

    // Next.js-style (req, ctx)
    return async function nextRoleHandler(req, ctx = {}) {
      // Wrap requireAuth and get authContext
      const result = await authedHandler(req, ctx);

      // If auth failed → it's already a Response with 401
      if (result instanceof Response && result.status === 401) {
        return result;
      }

      // If handler already returned Response, we need to inject role check
      const user = ctx?.user || result?.user || null;
      if (!user || !userHasRole(user, requiredRoles)) {
        logger?.warn?.('RBAC denied (Next.js)', {
          userId: user?._id,
          requiredRoles,
        });
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return result;
    };
  };
}

export default {
  requireRole,
};
