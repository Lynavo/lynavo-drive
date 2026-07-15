const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const monorepoRoot = path.resolve(__dirname, '../..');
const workspaceNodeModules = path.resolve(monorepoRoot, 'node_modules');
const contractsRoot = path.resolve(monorepoRoot, 'packages/contracts');

const pathToRegExp = value =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[/\\]+/g, '[/\\\\]');

const mobileRootPattern = pathToRegExp(__dirname);
const contractsRootPattern = pathToRegExp(contractsRoot);
const workspaceNodeModulesPattern = pathToRegExp(workspaceNodeModules);

const blockList = [
  new RegExp(
    `${mobileRootPattern}[/\\\\]android[/\\\\](?:app[/\\\\])?build(?:[/\\\\]|$)`,
  ),
  new RegExp(`${mobileRootPattern}[/\\\\]android[/\\\\]\\.gradle(?:[/\\\\]|$)`),
  new RegExp(
    `${mobileRootPattern}[/\\\\]ios[/\\\\](?:build|Pods)(?:[/\\\\]|$)`,
  ),
  new RegExp(`${contractsRootPattern}[/\\\\]\\.turbo(?:[/\\\\]|$)`),
  new RegExp(`${workspaceNodeModulesPattern}[/\\\\]\\.cache(?:[/\\\\]|$)`),
];

const config = {
  // Keep Metro's file map narrow. Watching the repo root makes Android bundle
  // requests wait on a full monorepo scan before the app can finish reloading.
  // pnpm installs app dependencies as symlinks into the workspace node_modules
  // store, so Metro must be able to see that target tree when resolving files.
  watchFolders: [contractsRoot, workspaceNodeModules],

  resolver: {
    blockList,
    // Tell Metro where to find node_modules in a pnpm monorepo
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      workspaceNodeModules,
    ],
    // The native find crawler filters blockList after walking directories. The
    // Node crawler prunes ignored Android/iOS build outputs before recursion.
    useWatchman: false,
    // Enable package exports (Metro 0.80+ handles pnpm symlinks correctly).
    // Required for packages like i18next v23 that define an `exports` field.
    unstable_enablePackageExports: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
