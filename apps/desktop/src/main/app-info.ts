import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type AppInfo = {
  name: string;
  version: string;
  buildNumber: string;
};

export function resolveBuildNumber(): string {
  const fallback = '';
  const packagedPackageJson = join(app.getAppPath(), 'package.json');
  const repoProject = join(
    process.cwd(),
    'apps',
    'mobile',
    'ios',
    'SyncFlowMobile.xcodeproj',
    'project.pbxproj',
  );

  try {
    const packaged = JSON.parse(readFileSync(packagedPackageJson, 'utf8')) as {
      syncflowBuildNumber?: string;
    };
    if (packaged.syncflowBuildNumber) return packaged.syncflowBuildNumber;
  } catch {
    // Fall through to repo build settings in development.
  }

  try {
    const project = readFileSync(repoProject, 'utf8');
    const match = project.match(/CURRENT_PROJECT_VERSION = (\d+);/);
    return match?.[1] ?? fallback;
  } catch {
    return fallback;
  }
}

export function getAppInfo(): AppInfo {
  const buildNumber = resolveBuildNumber();
  return {
    name: app.getName(),
    version: app.getVersion(),
    buildNumber,
  };
}

export function desktopClientHeaders(): Record<string, string> {
  const appInfo = getAppInfo();
  return {
    'X-Client-App': 'vividrop-desktop',
    'X-Client-Platform': process.platform,
    'X-Client-Version': appInfo.version,
    ...(appInfo.buildNumber ? { 'X-Client-Build': appInfo.buildNumber } : {}),
  };
}
