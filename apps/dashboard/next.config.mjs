/** @type {import('next').NextConfig} */
const REALTIME_URL =
  process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:4000";

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@anton/shared-types"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Proxy the reasoning SSE stream (client uses a relative URL) to the
  // standalone realtime server. Socket.IO connects to REALTIME_URL directly.
  async rewrites() {
    return [
      {
        source: "/api/agent/stream",
        destination: `${REALTIME_URL}/api/agent/stream`,
      },
    ];
  },
};

export default nextConfig;
