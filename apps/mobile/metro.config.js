const path = require("path");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getSentryExpoConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  "@mmd/platform-roles": path.resolve(workspaceRoot, "shared/platformRoles.ts"),
  "@mmd/social-links": path.resolve(workspaceRoot, "shared/socialLinks.ts"),
  "@mmd/profile-completeness": path.resolve(
    workspaceRoot,
    "shared/profileCompleteness.ts",
  ),
};

config.resolver.blockList = [
  ...(config.resolver.blockList ?? []),
  /.*\/Backups_Terminal\/.*/,
  /.*\\Backups_Terminal\\.*/,
];

module.exports = config;
