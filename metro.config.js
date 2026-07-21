const path = require("path");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const projectRoot = __dirname;
const config = getSentryExpoConfig(projectRoot);

config.resolver.blockList = [
  ...(config.resolver.blockList ?? []),
  /.*\/Backups_Terminal\/.*/,
  /.*\\Backups_Terminal\\.*/,
  // Keep Metro off web/build/cache trees (Windows EACCES on bad junctions).
  /[\\/]apps[\\/]web[\\/].*/,
  /[\\/]\.git[\\/].*/,
  /[\\/]\.next[\\/].*/,
  /[\\/]supabase[\\/].*/,
  /[\\/]dependabot[^\\/]*$/,
  /[\\/]apps[\\/]mobile[\\/]preview[\\/].*/,
];

// Help monorepo resolution if needed
config.watchFolders = [
  ...new Set([
    ...(config.watchFolders ?? []),
    projectRoot,
    path.join(projectRoot, "apps", "mobile"),
  ]),
];

module.exports = config;
