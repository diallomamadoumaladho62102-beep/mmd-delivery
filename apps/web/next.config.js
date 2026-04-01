const path = require("node:path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: path.resolve(__dirname, "..", ".."),
  },
  allowedDevOrigins: [
    "http://192.168.1.203:3000",
    "http://192.168.1.204:3000",
  ],
};

module.exports = nextConfig;