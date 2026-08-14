/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@docunest/shared-types',
    '@docunest/api-client',
    '@docunest/storage',
  ],
};

export default nextConfig;
