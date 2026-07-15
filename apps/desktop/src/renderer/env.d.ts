import type { ElectronAPI } from '../preload/api';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
