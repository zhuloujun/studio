import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  experimental: {
    allowedDevOrigins: ["https://*.cloudworkstations.dev"],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;

// Enables `next dev` to talk to local Cloudflare bindings (D1/R2/etc) via
// wrangler's local emulation. Must NOT run during production builds - it
// spins up a local workerd instance which has no place in `next build`.
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
if (process.env.NODE_ENV === 'development') {
  initOpenNextCloudflareForDev();
}
