import type { NextConfig } from 'next';
const config: NextConfig = { compress: false, async rewrites() { return [{ source: '/api/v1/:path*', destination: `${process.env.INTERNAL_API_URL || 'http://localhost:4000'}/api/v1/:path*` }, { source: '/uploads/:path*', destination: `${process.env.INTERNAL_API_URL || 'http://localhost:4000'}/uploads/:path*` }]; } };
export default config;
