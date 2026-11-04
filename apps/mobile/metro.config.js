const path = require("path");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getSentryExpoConfig(projectRoot);

// SDK 54 nested metro-config still sets watcher.unstable_workerThreads; Metro only
// recognizes transformer.unstable_workerThreads now. Remove the obsolete watcher key.
if (config.watcher && "unstable_workerThreads" in config.watcher) {
  delete config.watcher.unstable_workerThreads;
}

// Watch the shared sources and hoisted modules only. Watching the whole
// monorepo also watches apps/web/.next, which exhausts Windows file handles
// (EMFILE) inside Metro's HMR handler.
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(workspaceRoot, "shared"),
  path.resolve(workspaceRoot, "node_modules"),
];
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
  "@mmd/phone-verify-api": path.resolve(
    workspaceRoot,
    "shared/phoneVerifyApi.ts",
  ),
};

// FileStore.get also opens many cache files at once. One Metro process, no --clear.
config.maxWorkers = 2;
config.resolver.blockList = [
  ...(config.resolver.blockList ?? []),
  /.*\/Backups_Terminal\/.*/,
  /.*\\Backups_Terminal\\.*/,
  /[/\\]\.next[/\\]/,
  /[/\\]android[/\\]build[/\\]/,
  /[/\\]ios[/\\]Pods[/\\]/,
];

module.exports = config;
