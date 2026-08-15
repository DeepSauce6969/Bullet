/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      { source: "/docs/mechanics", destination: "/docs#mechanics", permanent: false },
      { source: "/docs/mint-burn", destination: "/docs#mint-burn", permanent: false },
      { source: "/docs/loans", destination: "/docs#loans", permanent: false },
      { source: "/docs/pre-deposit", destination: "/docs#pre-deposit", permanent: false },
      { source: "/docs/fees", destination: "/docs#fees", permanent: false },
      { source: "/docs/contracts", destination: "/docs#contracts", permanent: false },
      { source: "/docs/risks", destination: "/docs#risks", permanent: false },
    ];
  },
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      fs: false,
      path: false,
      os: false,
      crypto: false,
    };
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      buffer: "buffer",
    };
    return config;
  },
};

export default nextConfig;
