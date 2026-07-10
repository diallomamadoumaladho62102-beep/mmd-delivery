const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const projectRoot = __dirname;
const config = getSentryExpoConfig(projectRoot);

config.resolver.blockList = [
  ...(config.resolver.blockList ?? []),
  /.*\/Backups_Terminal\/.*/,
  /.*\\Backups_Terminal\\.*/,
];

module.exports = config;
