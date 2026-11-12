import { useState, useEffect, useRef, useCallback } from 'react';
import {
  systemNotificationService,
  type ExportSystemNotificationsParams,
} from '@/services/systemNotificationService';
import type {
  NotificationCategory,
  NotificationSeverity,
  SysNotifPreferences,
  SystemNotificationItem,
  SystemNotificationToast,
  UnreadCounts,
} from '@/types/systemNotification';

const MAX_NOTIFICATIONS = 150;
const INITIAL_FETCH_LIMIT = 80;
const RECONNECT_DELAY_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 25000;
const NEWS_BURST_WINDOW_MS = 2000;
const MAX_VISIBLE_TOASTS = 5;
export const SYS_NOTIF_PREFS_STORAGE_KEY = 'cosmo_sys_notif_prefs';
export const SYS_NOTIF_PREFS_EVENT = 'cosmo-sys-notif-prefs-updated';

const DEFAULT_UNREAD_COUNTS: UnreadCounts = {
  total: 0,
  manual_trade: 0,
  wallhunter: 0,
  sentiment_news: 0,
  ml_training: 0,
  market_alerts: 0,
};

const DEFAULT_PREFERENCES: SysNotifPreferences = {
  soundEnabled: true,
  toastEnabled: true,
  desktopPushEnabled: false,
  muteLowImpactNews: false,
};

function getAccessToken(): string | null {
  try {
    return sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken');
  } catch {
    return null;
  }
}

function normalizePreferences(
  parsed: Partial<SysNotifPreferences> | null | undefined,
  fallback: SysNotifPreferences = DEFAULT_PREFERENCES
): SysNotifPreferences {
  return {
    soundEnabled:
      typeof parsed?.soundEnabled === 'boolean' ? parsed.soundEnabled : fallback.soundEnabled,
    toastEnabled:
      typeof parsed?.toastEnabled === 'boolean' ? parsed.toastEnabled : fallback.toastEnabled,
    desktopPushEnabled:
      typeof parsed?.desktopPushEnabled === 'boolean'
        ? parsed.desktopPushEnabled
        : fallback.desktopPushEnabled,
    muteLowImpactNews:
      typeof parsed?.muteLowImpactNews === 'boolean'
        ? parsed.muteLowImpactNews
        : fallback.muteLowImpactNews,
  };
}

function loadPreferences(): SysNotifPreferences {
  try {
    const raw = localStorage.getItem(SYS_NOTIF_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<SysNotifPreferences>;
    return normalizePreferences(parsed, DEFAULT_PREFERENCES);
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function savePreferencesToStorage(prefs: SysNotifPreferences): void {
  try {
    localStorage.setItem(SYS_NOTIF_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage quota errors
  }
}

function maybeShowDesktopNotification(
  incoming: SystemNotificationItem,
  prefs: SysNotifPreferences
): void {
  if (!prefs.desktopPushEnabled) return;
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  if (incoming.category === 'sentiment_news') {
    const impact = String(incoming.meta?.impact_level ?? '').toUpperCase();
    if (prefs.muteLowImpactNews && impact !== 'HIGH') {
      return;
    }
  }

  const shouldNotify =
    document.hidden ||
    incoming.severity === 'critical' ||
    incoming.severity === 'warning' ||
    incoming.category === 'manual_trade' ||
    incoming.category === 'wallhunter' ||
    incoming.category === 'ml_training';

  if (!shouldNotify) return;

  try {
    const desktopNotif = new Notification(incoming.title, {
      body: incoming.message,
      tag: `cosmo-sys-notif-${incoming.id}`,
    });
    desktopNotif.onclick = () => {
      try {
        window.focus();
        desktopNotif.close();
      } catch {
        // ignore focus errors
      }
    };
  } catch {
    // ignore browser notification errors
  }
}

let sharedAudioCtx: AudioContext | null = null;

function playNotificationChime(severity: NotificationSeverity): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      void sharedAudioCtx.resume();
    }

    const now = sharedAudioCtx.currentTime;
    const isUrgent = severity === 'critical' || severity === 'warning';
    const notes = isUrgent ? [659.25, 987.77] : [587.33, 880];

    notes.forEach((freq, idx) => {
      if (!sharedAudioCtx) return;
      const osc = sharedAudioCtx.createOscillator();
      const gain = sharedAudioCtx.createGain();
      osc.type = isUrgent ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);

      gain.gain.setValueAtTime(0.0001, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.045, now + idx * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 0.22);

      osc.connect(gain);
      gain.connect(sharedAudioCtx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.24);
    });
  } catch {
    // Ignore autoplay / Web Audio restrictions
  }
}

function buildWsUrl(token: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/notifications?token=${encodeURIComponent(token)}`;
}

export function useSystemNotifications() {
  const [notifications, setNotifications] = useState<SystemNotificationItem[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<UnreadCounts>(DEFAULT_UNREAD_COUNTS);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preferences, setPreferences] = useState<SysNotifPreferences>(loadPreferences);
  const [toasts, setToasts] = useState<SystemNotificationToast[]>([]);

  const preferencesRef = useRef<SysNotifPreferences>(preferences);
  preferencesRef.current = preferences;

  const seenIdsRef = useRef<Set<number>>(new Set());
  const lastFetchedTokenRef = useRef<string | null>(null);
  const reconnectPendingSyncRef = useRef<boolean>(false);
  const newsBurstRef = useRef<{ timestamps: number[]; aggregatedCount: number }>({
    timestamps: [],
    aggregatedCount: 0,
  });

  const updatePreferences = useCallback((patch: Partial<SysNotifPreferences>) => {
    if (
      patch.desktopPushEnabled === true &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'default'
    ) {
      try {
        void window.Notification?.requestPermission?.().catch(() => {});
      } catch {
        // ignore permission prompt error
      }
    }

    const next = normalizePreferences(
      { ...preferencesRef.current, ...patch },
      preferencesRef.current
    );
    preferencesRef.current = next;
    setPreferences(next);
    savePreferencesToStorage(next);
    try {
      window.dispatchEvent(
        new CustomEvent<SysNotifPreferences>(SYS_NOTIF_PREFS_EVENT, { detail: next })
      );
    } catch {
      // ignore custom event error
    }

    if (getAccessToken()) {
      void systemNotificationService.updatePreferences(next).catch(() => {
        // ignore transient backend sync error
      });
    }
  }, []);

  const syncPreferencesFromServer = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    try {
      const dbPrefs = await systemNotificationService.getPreferences();
      if (!dbPrefs) return;
      setPreferences(prev => {
        const merged = normalizePreferences(dbPrefs, prev);
        preferencesRef.current = merged;
        savePreferencesToStorage(merged);
        return merged;
      });
    } catch {
      // Gracefully keep localStorage preferences when endpoint is unavailable
    }
  }, []);

  const dismissToast = useCallback((toastId: string) => {
    setToasts(prev => prev.filter(t => t.toastId !== toastId));
  }, []);

  const refresh = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      lastFetchedTokenRef.current = null;
      return;
    }
    setLoading(true);
    try {
      const res = await systemNotificationService.list({ limit: INITIAL_FETCH_LIMIT });
      const items = Array.isArray(res.items) ? res.items.slice(0, MAX_NOTIFICATIONS) : [];
      seenIdsRef.current = new Set(items.map(item => item.id));
      lastFetchedTokenRef.current = token;
      setNotifications(items);
      if (res.unread_counts) {
        setUnreadCounts(res.unread_counts);
      }
    } catch {
      // Gracefully ignore when unauthenticated or backend is restarting
    } finally {
      setLoading(false);
    }
  }, []);

  const enqueueToast = useCallback((incoming: SystemNotificationItem) => {
    const prefs = preferencesRef.current;
    if (!prefs.toastEnabled) return;

    if (incoming.category === 'sentiment_news') {
      const impact = String(incoming.meta?.impact_level ?? '').toUpperCase();
      if (prefs.muteLowImpactNews && impact !== 'HIGH') {
        return;
      }

      const now = Date.now();
      const recent = newsBurstRef.current.timestamps.filter(ts => now - ts <= NEWS_BURST_WINDOW_MS);
      recent.push(now);
      newsBurstRef.current.timestamps = recent;

      if (recent.length > 2) {
        const nextCount =
          newsBurstRef.current.aggregatedCount >= 2
            ? newsBurstRef.current.aggregatedCount + 1
            : recent.length;
        newsBurstRef.current.aggregatedCount = nextCount;

        const burstToast: SystemNotificationToast = {
          toastId: 'news-burst-summary',
          kind: 'news_burst',
          burstCount: nextCount,
          title: `${nextCount} new Sentiment News updates`,
          message: incoming.title,
          category: 'sentiment_news',
          severity: incoming.severity,
          createdAt: now,
        };

        setToasts(prev => {
          const filtered = prev.filter(
            t =>
              t.toastId !== 'news-burst-summary' &&
              !(t.category === 'sentiment_news' && now - t.createdAt <= NEWS_BURST_WINDOW_MS)
          );
          return [burstToast, ...filtered].slice(0, MAX_VISIBLE_TOASTS);
        });
        return;
      }

      newsBurstRef.current.aggregatedCount = recent.length;
    }

    const singleToast: SystemNotificationToast = {
      toastId: `notif-${incoming.id}-${Date.now()}`,
      kind: 'single',
      notification: incoming,
      title: incoming.title,
      message: incoming.message,
      category: incoming.category,
      severity: incoming.severity,
      createdAt: Date.now(),
    };

    setToasts(prev => [singleToast, ...prev].slice(0, MAX_VISIBLE_TOASTS));
  }, []);

  // Initial fetch & DB preference merge on mount
  useEffect(() => {
    void refresh();
    void syncPreferencesFromServer();
  }, [refresh, syncPreferencesFromServer]);

  // Keep preferences synced across components / tabs
  useEffect(() => {
    const handlePrefsEvent = (e: Event) => {
      const custom = e as CustomEvent<SysNotifPreferences>;
      if (!custom.detail) return;
      const normalized = normalizePreferences(custom.detail, preferencesRef.current);
      preferencesRef.current = normalized;
      setPreferences(normalized);
    };

    const handlePrefsStorage = (e: StorageEvent) => {
      if (e.key === SYS_NOTIF_PREFS_STORAGE_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue) as Partial<SysNotifPreferences>;
          const normalized = normalizePreferences(parsed, preferencesRef.current);
          preferencesRef.current = normalized;
          setPreferences(normalized);
        } catch {
          // ignore malformed storage value
        }
      }
    };

    window.addEventListener(SYS_NOTIF_PREFS_EVENT, handlePrefsEvent);
    window.addEventListener('storage', handlePrefsStorage);
    return () => {
      window.removeEventListener(SYS_NOTIF_PREFS_EVENT, handlePrefsEvent);
      window.removeEventListener('storage', handlePrefsStorage);
    };
  }, []);

  // WebSocket live stream with auto-reconnect and heartbeat ping
  useEffect(() => {
    let alive = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const clearTimers = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    const connect = () => {
      if (!alive) return;
      const token = getAccessToken();
      if (!token) {
        setConnected(false);
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        return;
      }

      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
      }

      try {
        ws = new WebSocket(buildWsUrl(token));
      } catch {
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        return;
      }

      ws.onopen = () => {
        if (!alive) return;
        setConnected(true);
        const currentToken = getAccessToken();
        if (reconnectPendingSyncRef.current || lastFetchedTokenRef.current !== currentToken) {
          reconnectPendingSyncRef.current = false;
          void refresh();
        }
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'ping' }));
            } catch {
              // ignore send error
            }
          }
        }, HEARTBEAT_INTERVAL_MS);
      };

      ws.onmessage = event => {
        if (!alive) return;
        try {
          const data = JSON.parse(event.data);
          if (data?.type !== 'sys_notification') return;

          const incoming = (data.notification ?? data.data ?? data) as SystemNotificationItem;
          if (!incoming || typeof incoming.id !== 'number' || !incoming.category) return;

          if (seenIdsRef.current.has(incoming.id)) return;
          seenIdsRef.current.add(incoming.id);

          setNotifications(prev => {
            if (prev.some(n => n.id === incoming.id)) return prev;
            return [incoming, ...prev].slice(0, MAX_NOTIFICATIONS);
          });

          if (!incoming.is_read) {
            setUnreadCounts(prev => ({
              ...prev,
              total: prev.total + 1,
              [incoming.category]: (prev[incoming.category] ?? 0) + 1,
            }));
          }

          if (preferencesRef.current.soundEnabled) {
            playNotificationChime(incoming.severity);
          }

          enqueueToast(incoming);
          maybeShowDesktopNotification(incoming, preferencesRef.current);
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (!alive) return;
        reconnectPendingSyncRef.current = true;
        setConnected(false);
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    const handleStorageSync = (e: StorageEvent) => {
      if (e.key && e.key !== 'accessToken' && e.key !== 'session-sync-data') return;
      const token = getAccessToken();
      if (!token) {
        lastFetchedTokenRef.current = null;
        seenIdsRef.current.clear();
        setNotifications([]);
        setUnreadCounts(DEFAULT_UNREAD_COUNTS);
        setConnected(false);
        ws?.close();
        return;
      }
      if (token !== lastFetchedTokenRef.current) {
        void refresh();
        void syncPreferencesFromServer();
        if (!ws || ws.readyState === WebSocket.CLOSED) {
          clearTimers();
          connect();
        }
      }
    };

    window.addEventListener('storage', handleStorageSync);
    connect();

    return () => {
      alive = false;
      window.removeEventListener('storage', handleStorageSync);
      clearTimers();
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
      }
    };
  }, [enqueueToast, refresh, syncPreferencesFromServer]);

  const markRead = useCallback(async (id: number) => {
    let targetCategory: NotificationCategory | null = null;
    let wasUnread = false;

    setNotifications(prev =>
      prev.map(item => {
        if (item.id === id) {
          if (!item.is_read) {
            wasUnread = true;
            targetCategory = item.category;
          }
          return { ...item, is_read: true };
        }
        return item;
      })
    );

    if (wasUnread && targetCategory) {
      const cat = targetCategory;
      setUnreadCounts(prev => ({
        ...prev,
        total: Math.max(0, prev.total - 1),
        [cat]: Math.max(0, (prev[cat] ?? 0) - 1),
      }));
    }

    try {
      const res = await systemNotificationService.markRead(id);
      if (res?.unread_counts) {
        setUnreadCounts(res.unread_counts);
      }
    } catch {
      // ignore transient error
    }
  }, []);

  const markAllRead = useCallback(async (category?: NotificationCategory | null) => {
    setNotifications(prev =>
      prev.map(item =>
        !category || item.category === category ? { ...item, is_read: true } : item
      )
    );

    setUnreadCounts(prev => {
      if (!category) {
        return { ...DEFAULT_UNREAD_COUNTS };
      }
      const removed = prev[category] ?? 0;
      return {
        ...prev,
        total: Math.max(0, prev.total - removed),
        [category]: 0,
      };
    });

    try {
      const res = await systemNotificationService.markAllRead(category);
      if (res?.unread_counts) {
        setUnreadCounts(res.unread_counts);
      }
    } catch {
      // ignore transient error
    }
  }, []);

  const clearAll = useCallback(async (category?: NotificationCategory | null) => {
    setNotifications(prev => {
      const next = category ? prev.filter(item => item.category !== category) : [];
      seenIdsRef.current = new Set(next.map(item => item.id));
      return next;
    });

    setUnreadCounts(prev => {
      if (!category) {
        return { ...DEFAULT_UNREAD_COUNTS };
      }
      const removed = prev[category] ?? 0;
      return {
        ...prev,
        total: Math.max(0, prev.total - removed),
        [category]: 0,
      };
    });

    try {
      const res = await systemNotificationService.clearAll(category);
      if (res?.unread_counts) {
        setUnreadCounts(res.unread_counts);
      }
    } catch {
      // ignore transient error
    }
  }, []);

  const dismissOne = useCallback(async (id: number) => {
    let removedUnreadCat: NotificationCategory | null = null;

    setNotifications(prev => {
      const target = prev.find(item => item.id === id);
      if (target && !target.is_read) {
        removedUnreadCat = target.category;
      }
      seenIdsRef.current.delete(id);
      return prev.filter(item => item.id !== id);
    });

    if (removedUnreadCat) {
      const cat = removedUnreadCat;
      setUnreadCounts(prev => ({
        ...prev,
        total: Math.max(0, prev.total - 1),
        [cat]: Math.max(0, (prev[cat] ?? 0) - 1),
      }));
    }

    try {
      const res = await systemNotificationService.dismiss(id);
      if (res?.unread_counts) {
        setUnreadCounts(res.unread_counts);
      }
    } catch {
      // ignore transient error
    }
  }, []);

  const triggerDailyDigest = useCallback(async () => {
    const res = await systemNotificationService.triggerDailyDigest();
    const notif = res?.notification;
    if (notif && typeof notif.id === 'number') {
      if (!seenIdsRef.current.has(notif.id)) {
        seenIdsRef.current.add(notif.id);
        setNotifications(prev => {
          if (prev.some(n => n.id === notif.id)) return prev;
          return [notif, ...prev].slice(0, MAX_NOTIFICATIONS);
        });
      }
    }
    try {
      const counts = await systemNotificationService.getUnreadCount();
      if (counts) {
        setUnreadCounts(counts);
      }
    } catch {
      // ignore transient error
    }
    return res;
  }, []);

  const exportCsv = useCallback(async (filters?: ExportSystemNotificationsParams) => {
    await systemNotificationService.downloadCsv(filters);
  }, []);

  return {
    notifications,
    unreadCounts,
    connected,
    loading,
    preferences,
    updatePreferences,
    toasts,
    dismissToast,
    markRead,
    markAllRead,
    clearAll,
    dismissOne,
    refresh,
    triggerDailyDigest,
    exportCsv,
  };
}
