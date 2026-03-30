export type SidecarRuntimeStatus = 'starting' | 'healthy' | 'failed' | 'stopped';
export type BonjourRuntimeStatus = 'native' | 'fallback' | 'not_applicable';
export type BonjourRuntimeSource =
  | 'environment'
  | 'bundled'
  | 'system'
  | 'fallback'
  | 'not_applicable';

export interface BonjourRuntimeState {
  status: BonjourRuntimeStatus;
  source: BonjourRuntimeSource;
  message: string | null;
  path: string | null;
}

export interface SidecarRuntimeState {
  status: SidecarRuntimeStatus;
  message: string | null;
  restartCount: number;
  maxRestarts: number;
  lastExitCode: number | null;
  bonjour: BonjourRuntimeState;
}

export const INITIAL_SIDECAR_RUNTIME_STATE: SidecarRuntimeState = {
  status: 'starting',
  message: '后台服务启动中…',
  restartCount: 0,
  maxRestarts: 3,
  lastExitCode: null,
  bonjour: {
    status: 'not_applicable',
    source: 'not_applicable',
    message: null,
    path: null,
  },
};
