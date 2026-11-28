import { useEffect, useState } from 'react';
import {
  ViewportProfile,
  getViewportProfile,
  subscribeViewportProfile,
  syncViewportProfileToDocument,
} from '@/utils/viewportProfile';

function isTextInputFocused(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable;
}

function hasProfileChanged(prev: ViewportProfile, next: ViewportProfile): boolean {
  return (
    prev.tier !== next.tier ||
    prev.mode !== next.mode ||
    prev.metrics.width !== next.metrics.width ||
    prev.metrics.height !== next.metrics.height ||
    prev.metrics.dpr !== next.metrics.dpr
  );
}

/**
 * React hook that tracks monitor resolution, browser viewport size, and DPR changes
 * (including moving a browser window across 1366x768 and 1920x1080 monitors).
 */
export function useViewportProfile(): ViewportProfile {
  const [profile, setProfile] = useState<ViewportProfile>(() => getViewportProfile());

  useEffect(() => {
    let rafId = 0;

    const syncNow = () => {
      const synced = syncViewportProfileToDocument();
      setProfile((prev) => (hasProfileChanged(prev, synced) ? synced : prev));
    };

    const scheduleSync = () => {
      if (isTextInputFocused()) return;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(syncNow);
    };

    syncNow();
    window.addEventListener('resize', scheduleSync);
    window.addEventListener('orientationchange', scheduleSync);
    window.visualViewport?.addEventListener('resize', scheduleSync);

    const unsubscribe = subscribeViewportProfile((next) => {
      setProfile((prev) => (hasProfileChanged(prev, next) ? next : prev));
    });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', scheduleSync);
      window.removeEventListener('orientationchange', scheduleSync);
      window.visualViewport?.removeEventListener('resize', scheduleSync);
      unsubscribe();
    };
  }, []);

  return profile;
}
