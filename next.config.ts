import type { NextConfig } from 'next';

/**
 * Security headers applied to every response (pages, assets, API routes).
 * The Content-Security-Policy is set per request in src/proxy.ts because it
 * carries a fresh nonce each time.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
  ...(process.env.NODE_ENV === 'production' && process.env.SECURE_COOKIES !== 'false'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
    : []),
];

const nextConfig: NextConfig = {
  // Every page in this app shows confidential, permission-filtered data, so
  // pages are rendered per request and nothing sensitive is cached on the server.
  cacheComponents: false,
  poweredByHeader: false,
  experimental: {
    authInterrupts: true, // enables forbidden() → app/forbidden.tsx
    serverActions: {
      // Evidence is capped at 4 MB per submission (Vercel's request limit is 4.5 MB).
      bodySizeLimit: '4.5mb',
    },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
