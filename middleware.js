// /middleware.js
import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';

// Allow public assets & open routes
const PUBLIC_PATHS = [
  '/', // homepage
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
];

const PUBLIC_PREFIXES = [
  '/_next', // Next.js assets
  '/public', // static files
  '/api/auth', // auth routes
];

// Basic in-memory store for rate limiting (per IP)
const rateLimitStore = new Map();
const WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10); // 60s default
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX || '60', 10); // 60 req/min

function isPublicPath(pathname) {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

function rateLimit(ip) {
  if (!ip) return { allowed: true };

  const now = Date.now();
  const windowStart = now - WINDOW;

  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, []);
  }

  // Remove old requests
  const timestamps = rateLimitStore.get(ip).filter(ts => ts > windowStart);

  if (timestamps.length >= MAX_REQUESTS) {
    return { allowed: false, retryAfter: Math.ceil((timestamps[0] + WINDOW - now) / 1000) };
  }

  timestamps.push(now);
  rateLimitStore.set(ip, timestamps);
  return { allowed: true };
}

export async function middleware(req) {
  const { pathname } = req.nextUrl;

  // Skip public paths
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Rate limiting
  const ip = req.ip || req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const rl = rateLimit(ip);

  if (!rl.allowed) {
    return new NextResponse(
      JSON.stringify({ error: 'Too Many Requests', retryAfter: rl.retryAfter }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': rl.retryAfter.toString(),
        },
      }
    );
  }

  // Assign request ID
  const requestId = nanoid();
  const res = NextResponse.next();
  res.headers.set('X-Request-ID', requestId);

  // Security headers
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return res;
}

// Apply middleware only to certain routes
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
