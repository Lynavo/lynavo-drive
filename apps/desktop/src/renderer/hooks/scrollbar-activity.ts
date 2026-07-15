type ScrollbarActivityTrackerOptions = {
  idleMs?: number;
};

const ACTIVE_CLASS = 'lynavo-scrollbar-active';
const DEFAULT_IDLE_MS = 900;

function resolveScrollElement(target: EventTarget | null): HTMLElement {
  if (target instanceof HTMLElement) {
    return target;
  }

  return document.documentElement;
}

export function installScrollbarActivityTracker(
  options: ScrollbarActivityTrackerOptions = {},
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const activeTargets = new Map<HTMLElement, number>();

  const clearTarget = (target: HTMLElement) => {
    const timer = activeTargets.get(target);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      activeTargets.delete(target);
    }
    target.classList.remove(ACTIVE_CLASS);
  };

  const markActive = (target: HTMLElement) => {
    const existingTimer = activeTargets.get(target);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    target.classList.add(ACTIVE_CLASS);
    activeTargets.set(
      target,
      window.setTimeout(() => clearTarget(target), idleMs),
    );
  };

  const handleScroll = (event: Event) => {
    markActive(resolveScrollElement(event.target));
  };

  window.addEventListener('scroll', handleScroll, { capture: true, passive: true });

  return () => {
    window.removeEventListener('scroll', handleScroll, { capture: true });
    for (const target of activeTargets.keys()) {
      clearTarget(target);
    }
  };
}
