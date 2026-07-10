const path = require("path");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const projectRoot = __dirname;
const config = getSentryExpoConfig(projectRoot);

config.resolver.blockList = [
  ...(config.resolver.blockList ?? []),
  /.*\/Backups_Terminal\/.*/,
  /.*\\Backups_Terminal\\.*/,
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
