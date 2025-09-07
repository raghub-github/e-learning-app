/** @type {import('next').NextConfig} */
// const nextConfig = {};

// export default nextConfig;


/**
 * next.config.mjs — ESM config for Next.js App Router
 *
 * Notes:
 * - Keep future/experimental flags minimal
 * - Configure allowed image domains (add your R2 domain if you use <Image/>)
 */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  experimental: {
    appDir: true,
  },
  images: {
    domains: [
      // Add any domains you will serve images from (Cloudflare R2, CDN, etc.)
      new URL(process.env.R2_PUBLIC_BASE_URL || "http://localhost").hostname.replace(/^www\./, ""),
      "res.cloudinary.com",
      "images.unsplash.com",
    ],
  },
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE || "/api",
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000",
  },
  typescript: {
    // JS-only project — keep strict type-check opt-out
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
