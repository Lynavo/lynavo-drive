import { create } from 'zustand';
import type { SidecarRuntimeState } from '../../shared/sidecar-runtime';
import { INITIAL_SIDECAR_RUNTIME_STATE } from '../../shared/sidecar-runtime';

interface SidecarRuntimeStore {
  runtime: SidecarRuntimeState;
  setRuntime(runtime: SidecarRuntimeState): void;
}

export const useSidecarRuntimeStore = create<SidecarRuntimeStore>((set) => ({
  runtime: INITIAL_SIDECAR_RUNTIME_STATE,
  setRuntime: (runtime) => set({ runtime }),
}));
