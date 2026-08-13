/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
