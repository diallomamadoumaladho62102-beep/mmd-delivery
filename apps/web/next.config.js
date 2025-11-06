const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // racine absolue du monorepo (apps/web -> remonter 2 niveaux)
  turbopack: { root: path.resolve(__dirname, '..', '..') },
};

module.exports = nextConfig;
