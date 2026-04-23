/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    webpackBuildWorker: true,
    parallelServerCompiles: true,
    staticWorkerRequestDeduping: true,
  },
};

export default nextConfig;
