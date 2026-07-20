export type SidecarRuntimeStatus = 'starting' | 'healthy' | 'failed' | 'stopped';
export type BonjourRuntimeStatus = 'native' | 'fallback' | 'not_applicable';
export type BonjourRuntimeSource =
  'environment' | 'bundled' | 'system' | 'fallback' | 'not_applicable';
export type BonjourRuntimeMessageCode = 'bonjourNativeDetected' | 'bonjourFallbackDetected';
export type SidecarRuntimeMessageCode =
  | 'starting'
  | 'retrying'
  | 'startFailed'
  | 'exited'
  | 'healthCheckFailed'
  | 'retryingAfterFailure'
  | 'failedCheckExecutable';

export type RuntimeMessageArgs = Record<string, string | number | null>;

export interface BonjourRuntimeState {
  status: BonjourRuntimeStatus;
  source: BonjourRuntimeSource;
  message: string | null;
  messageCode: BonjourRuntimeMessageCode | null;
  messageArgs: RuntimeMessageArgs | null;
  path: string | null;
  /** IP address currently being advertised in the Bonjour/mDNS TXT record.
   *  Populated once the sidecar emits "bonjour broadcaster ip selected". */
  advertisedIP: string | null;
}

export interface SidecarRuntimeState {
  status: SidecarRuntimeStatus;
  message: string | null;
  messageCode: SidecarRuntimeMessageCode | null;
  messageArgs: RuntimeMessageArgs | null;
  restartCount: number;
  maxRestarts: number;
  lastExitCode: number | null;
  bonjour: BonjourRuntimeState;
}

export const INITIAL_SIDECAR_RUNTIME_STATE: SidecarRuntimeState = {
  status: 'starting',
  message: null,
  messageCode: 'starting',
  messageArgs: null,
  restartCount: 0,
  maxRestarts: 3,
  lastExitCode: null,
  bonjour: {
    status: 'not_applicable',
    source: 'not_applicable',
    message: null,
    messageCode: null,
    messageArgs: null,
    path: null,
    advertisedIP: null,
  },
};
