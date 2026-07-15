import log from 'electron-log';

type PowerEventName = 'suspend' | 'resume' | 'lock-screen' | 'unlock-screen';
type PowerMonitor = {
  on(eventName: PowerEventName, listener: () => void): void;
};

export type PowerEventSnapshot = {
  event: PowerEventName;
  state: 'awake' | 'sleeping' | 'locked' | 'unlocked';
  lastSuspendAt: string | null;
  lastResumeAt: string | null;
  lastLockAt: string | null;
  lastUnlockAt: string | null;
  updatedAt: string;
};

const POWER_EVENTS: PowerEventName[] = ['suspend', 'resume', 'lock-screen', 'unlock-screen'];

export function attachPowerEventLogging(
  monitor: PowerMonitor,
  onSnapshot?: (snapshot: PowerEventSnapshot) => void,
  now: () => Date = () => new Date(),
): void {
  const snapshot: PowerEventSnapshot = {
    event: 'resume',
    state: 'awake',
    lastSuspendAt: null,
    lastResumeAt: null,
    lastLockAt: null,
    lastUnlockAt: null,
    updatedAt: now().toISOString(),
  };

  for (const eventName of POWER_EVENTS) {
    monitor.on(eventName, () => {
      const timestamp = now().toISOString();
      snapshot.event = eventName;
      snapshot.updatedAt = timestamp;
      switch (eventName) {
        case 'suspend':
          snapshot.state = 'sleeping';
          snapshot.lastSuspendAt = timestamp;
          break;
        case 'resume':
          snapshot.state = 'awake';
          snapshot.lastResumeAt = timestamp;
          break;
        case 'lock-screen':
          snapshot.state = 'locked';
          snapshot.lastLockAt = timestamp;
          break;
        case 'unlock-screen':
          snapshot.state = 'unlocked';
          snapshot.lastUnlockAt = timestamp;
          break;
      }
      log.info(`[power] event=${eventName}`);
      onSnapshot?.({ ...snapshot });
    });
  }
}
