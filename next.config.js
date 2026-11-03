const { initOpenNextCloudflareForDev } = require("@opennextjs/cloudflare");

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

initOpenNextCloudflareForDev();

module.exports = nextConfig;
