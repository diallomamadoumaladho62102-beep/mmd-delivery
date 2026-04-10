// metro.config.js — Expo SDK 54 (ignore Backups_Terminal to avoid scanning old files)

const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// ✅ Ignore backups folder so Metro won't try to parse/resolve it
config.resolver.blockList = [
  /.*\/Backups_Terminal\/.*/,
  /.*\\Backups_Terminal\\.*/
];

module.exports = config;
