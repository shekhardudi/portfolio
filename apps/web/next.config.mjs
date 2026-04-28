/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    mdxRs: true,
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.shekharlabs.com' }],
  },
};

export default nextConfig;
