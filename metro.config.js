const path = require("path");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const projectRoot = __dirname;
const config = getSentryExpoConfig(projectRoot);

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(projectRoot, "apps/mobile/node_modules"),
];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  "@mmd/platform-roles": path.resolve(projectRoot, "shared/platformRoles.ts"),
  "@mmd/social-links": path.resolve(projectRoot, "shared/socialLinks.ts"),
  "@mmd/profile-completeness": path.resolve(
    projectRoot,
    "shared/profileCompleteness.ts",
  ),
  "@mmd/phone-verify-api": path.resolve(
    projectRoot,
    "shared/phoneVerifyApi.ts",
  ),
};

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
    path.join(projectRoot, "shared"),
  ]),
];

module.exports = config;
