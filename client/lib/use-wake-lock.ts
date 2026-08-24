import { useEffect } from 'react';

/**
 * Keep the screen awake while this surface is mounted. Every teller
 * surface is meant to sit visible through a whole session — phones on
 * the rail, the table TV, the board — and none of them should dim
 * mid-combat. Reacquires on tab re-focus (the lock is auto-released
 * whenever the page is hidden). No-op where unsupported.
 */
export function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;

    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
        if (stopped) await lock.release();
      } catch {
        // denied (low battery, etc.) — nothing to do
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, []);
}
