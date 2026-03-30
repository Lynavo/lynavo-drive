import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import log from 'electron-log';
import {
  BONJOUR_WINDOWS_INSTALLER_NAME,
  BONJOUR_WINDOWS_INSTALLER_URL,
  BONJOUR_WINDOWS_SUPPORT_URL,
  type BonjourInstallResult,
} from '../shared/bonjour';
import type { SidecarManager } from './sidecar-manager';

const maxRedirects = 5;

export async function installBonjourForWindows(
  sidecarManager: SidecarManager,
): Promise<BonjourInstallResult> {
  if (process.platform !== 'win32') {
    throw new Error('一键安装 Bonjour 仅支持 Windows。');
  }

  const currentRuntime = sidecarManager.detectBonjourRuntime();
  if (currentRuntime.status === 'native') {
    if (sidecarManager.getState().bonjour.status !== 'native') {
      await sidecarManager.retryStart();
    }
    return {
      status: 'already_installed',
      message: '已检测到 Bonjour for Windows，后台服务已重新加载原生 Bonjour 广播。',
      supportUrl: BONJOUR_WINDOWS_SUPPORT_URL,
      installerPath: null,
      bonjourPath: currentRuntime.path,
    };
  }

  const installerPath = await downloadBonjourInstaller();
  await runBonjourInstaller(installerPath);
  await sidecarManager.retryStart();

  const nextRuntime = sidecarManager.getState().bonjour;
  if (nextRuntime.status !== 'native') {
    throw new Error(
      `安装器已运行，但 SyncFlow 仍未检测到 Bonjour。你可以重新打开应用后再试，或手动访问 ${BONJOUR_WINDOWS_SUPPORT_URL}。`,
    );
  }

  return {
    status: 'installed',
    message: 'Bonjour for Windows 安装完成，后台服务已自动切换到 Apple Bonjour 广播。',
    supportUrl: BONJOUR_WINDOWS_SUPPORT_URL,
    installerPath,
    bonjourPath: nextRuntime.path,
  };
}

async function downloadBonjourInstaller(): Promise<string> {
  const installerDir = join(tmpdir(), 'SyncFlow', 'bonjour-installer');
  const installerPath = join(installerDir, BONJOUR_WINDOWS_INSTALLER_NAME);

  await mkdir(installerDir, { recursive: true });
  await rm(installerPath, { force: true });
  await downloadFile(BONJOUR_WINDOWS_INSTALLER_URL, installerPath, maxRedirects);
  log.info(`[BonjourInstaller] downloaded installer to ${installerPath}`);
  return installerPath;
}

async function downloadFile(url: string, destinationPath: string, redirectsRemaining: number): Promise<void> {
  const response = await request(url);

  if (
    response.statusCode &&
    response.statusCode >= 300 &&
    response.statusCode < 400 &&
    response.headers.location
  ) {
    response.resume();
    if (redirectsRemaining <= 0) {
      throw new Error('下载 Bonjour 安装器时发生过多重定向。');
    }
    const redirectedURL = new URL(response.headers.location, url).toString();
    await downloadFile(redirectedURL, destinationPath, redirectsRemaining - 1);
    return;
  }

  if (response.statusCode !== 200) {
    response.resume();
    throw new Error(`下载 Bonjour 安装器失败，HTTP ${response.statusCode ?? 'unknown'}。`);
  }

  await pipeline(response, createWriteStream(destinationPath));
}

function request(url: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (response) => resolve(response));
    req.on('error', (error) => reject(error));
  });
}

async function runBonjourInstaller(installerPath: string): Promise<void> {
  const quotedPath = installerPath.replace(/'/g, "''");
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$process = Start-Process -FilePath '${quotedPath}' -Verb RunAs -PassThru -Wait`,
    'exit $process.ExitCode',
  ].join('; ');

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        log.info(`[BonjourInstaller] installer exited successfully: ${installerPath}`);
        resolve();
        return;
      }

      const detail = stderr.trim();
      if (detail.includes('The operation was canceled by the user')) {
        reject(new Error('Bonjour 安装已取消。'));
        return;
      }

      reject(new Error(detail || `Bonjour 安装失败，退出码 ${code ?? 'unknown'}。`));
    });
  });
}
