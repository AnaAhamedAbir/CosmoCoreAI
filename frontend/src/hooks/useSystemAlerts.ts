/**
 * useSystemAlerts — Persistent + Live WebSocket hook for Sys Monitor incidents
 *
 * - Hydrates persisted alert history on mount via GET /api/v1/system/alerts
 * - Connects to /ws/system-alerts with resilient exponential backoff reconnect
 * - Handles both `system_alerts_history` replay and real-time `system_alert` pushes
 * - Deduplicates alerts cleanly by ID without firing duplicate toasts on replay
 * - Supports server-persisted acknowledge, clear, and diagnostic test alerts
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { buildAuthenticatedWsUrl } from '@/utils/wsAuth';
import { systemService, type SystemAlertRecord } from '@/services/systemService';

export type AlertSeverity = 'CRITICAL' | 'ERROR' | 'WARNING';

export interface SystemAlert {
  id: string;
  severity: AlertSeverity;
  container: string;
  display_name: string;
  message: string;
  snippet: string[];
  timestamp: string;
  read: boolean;
  acknowledged?: boolean;
  acknowledged_at?: string;
  acknowledged_by?: string;
  logger?: string;
  source?: string;
  category?: string;
}

const MAX_ALERTS = 150;
const LAST_READ_TS_KEY = 'cosmo_sys_monitor_last_read_ts';

const getLastReadTimestamp = (): number => {
  try {
    const raw = localStorage.getItem(LAST_READ_TS_KEY);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
};

const saveLastReadTimestamp = (ts: number) => {
  try {
    localStorage.setItem(LAST_READ_TS_KEY, String(ts));
  } catch {
    // ignore storage limits
  }
};

const normalizeAlert = (data: Partial<SystemAlertRecord> & Record<string, unknown>, markRead: boolean): SystemAlert => {
  const rawSev = String(data.severity || 'ERROR').toUpperCase();
  const severity: AlertSeverity =
    rawSev === 'CRITICAL' ? 'CRITICAL' : rawSev === 'WARNING' ? 'WARNING' : 'ERROR';
  const ts = typeof data.timestamp === 'string' && data.timestamp ? data.timestamp : new Date().toISOString();
  const container = typeof data.container === 'string' && data.container ? data.container : 'cosmoquant_backend';
  const displayName =
    typeof data.display_name === 'string' && data.display_name
      ? data.display_name
      : container.replace(/^cosmoquant_|^cosmo_/, '').replace(/_/g, ' ').toUpperCase();
  const id =
    typeof data.id === 'string' && data.id
      ? data.id
      : `${container}-${ts}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    severity,
    container,
    display_name: displayName,
    message: typeof data.message === 'string' ? data.message : '',
    snippet: Array.isArray(data.snippet) ? data.snippet.map(String) : [],
    timestamp: ts,
    read: markRead || Boolean(data.acknowledged),
    acknowledged: Boolean(data.acknowledged),
    acknowledged_at: typeof data.acknowledged_at === 'string' ? data.acknowledged_at : undefined,
    acknowledged_by: typeof data.acknowledged_by === 'string' ? data.acknowledged_by : undefined,
    logger: typeof data.logger === 'string' ? data.logger : undefined,
    source: typeof data.source === 'string' ? data.source : undefined,
    category: typeof data.category === 'string' ? data.category : undefined,
  };
};

const mergeAlerts = (existing: SystemAlert[], incoming: SystemAlert[]): SystemAlert[] => {
  const byId = new Map<string, SystemAlert>();
  for (const item of existing) {
    byId.set(item.id, item);
  }
  for (const item of incoming) {
    const prev = byId.get(item.id);
    if (prev) {
      byId.set(item.id, {
        ...prev,
        ...item,
        read: prev.read || item.read,
        acknowledged: Boolean(prev.acknowledged || item.acknowledged),
      });
    } else {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, MAX_ALERTS);
};

export function useSystemAlerts() {
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [connected, setConnected] = useState(false);
  const [captureMode, setCaptureMode] = useState<'docker_socket' | 'live_handler'>('live_handler');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [latestLiveAlert, setLatestLiveAlert] = useState<SystemAlert | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef<number>(3000);
  const aliveRef = useRef<boolean>(false);

  const refreshHistory = useCallback(async () => {
    try {
      const res = await systemService.getSystemAlerts({ limit: MAX_ALERTS });
      if (!aliveRef.current) return;
      if (res.capture_mode) setCaptureMode(res.capture_mode);
      const lastReadTs = getLastReadTimestamp();
      const hydrated = (res.alerts || []).map((item) => {
        const itemTs = new Date(item.timestamp).getTime();
        const isRead = Boolean(item.acknowledged) || (lastReadTs > 0 && itemTs <= lastReadTs);
        return normalizeAlert(item as unknown as Record<string, unknown>, isRead);
      });
      setAlerts((prev) => mergeAlerts(prev, hydrated));
    } catch {
      // ignore if user is not superuser or backend restarting
    } finally {
      if (aliveRef.current) setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refreshHistory();

    const scheduleReconnect = () => {
      if (!aliveRef.current) return;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      const delay = retryDelayRef.current;
      retryDelayRef.current = Math.min(15000, Math.round(delay * 1.5));
      reconnectTimer.current = setTimeout(() => {
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (!aliveRef.current) return;
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const wsUrl = await buildAuthenticatedWsUrl('/ws/system-alerts');
      if (!wsUrl) {
        // Retry instead of permanently giving up if token refresh was in-flight
        scheduleReconnect();
        return;
      }
      if (!aliveRef.current) return;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!aliveRef.current) {
          ws.close();
          return;
        }
        setConnected(true);
        retryDelayRef.current = 3000;
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
      };

      ws.onmessage = (event) => {
        if (!aliveRef.current) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'system_alerts_history' && Array.isArray(data.alerts)) {
            const lastReadTs = getLastReadTimestamp();
            const replayed = data.alerts.map((raw: Record<string, unknown>) => {
              const itemTs = new Date(String(raw.timestamp || '')).getTime();
              const isRead = Boolean(raw.acknowledged) || (lastReadTs > 0 && itemTs <= lastReadTs);
              return normalizeAlert(raw, isRead);
            });
            setAlerts((prev) => mergeAlerts(prev, replayed));
            setLoadingHistory(false);
            return;
          }

          if (data.type !== 'system_alert') return;

          const alert = normalizeAlert(data, false);
          setAlerts((prev) => mergeAlerts(prev, [alert]));
          setLatestLiveAlert(alert);
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (!aliveRef.current) return;
        setConnected(false);
        scheduleReconnect();
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      };
    };

    void connect();

    return () => {
      aliveRef.current = false;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [refreshHistory]);

  const unreadCount = alerts.filter((a) => !a.read && !a.acknowledged).length;

  const markAllRead = useCallback(() => {
    saveLastReadTimestamp(Date.now());
    setAlerts((prev) => prev.map((a) => (a.read ? a : { ...a, read: true })));
  }, []);

  const acknowledgeAlert = useCallback(async (alertId: string) => {
    const nowIso = new Date().toISOString();
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === alertId ? { ...a, acknowledged: true, read: true, acknowledged_at: nowIso } : a
      )
    );
    try {
      await systemService.acknowledgeSystemAlert(alertId);
    } catch {
      // optimistic state stays intact
    }
  }, []);

  const acknowledgeAllAlerts = useCallback(async () => {
    const nowIso = new Date().toISOString();
    saveLastReadTimestamp(Date.now());
    setAlerts((prev) =>
      prev.map((a) =>
        a.acknowledged ? a : { ...a, acknowledged: true, read: true, acknowledged_at: nowIso }
      )
    );
    try {
      await systemService.acknowledgeAllSystemAlerts();
    } catch {
      // optimistic state stays intact
    }
  }, []);

  const clearAlerts = useCallback(async () => {
    saveLastReadTimestamp(Date.now());
    setAlerts([]);
    try {
      await systemService.clearSystemAlerts();
    } catch {
      // ignore if offline
    }
  }, []);

  const sendTestAlert = useCallback(async () => {
    const res = await systemService.sendTestSystemAlert();
    if (res?.alert) {
      const normalized = normalizeAlert(res.alert as unknown as Record<string, unknown>, false);
      setAlerts((prev) => mergeAlerts(prev, [normalized]));
    }
  }, []);

  const dismissLiveAlert = useCallback(() => {
    setLatestLiveAlert(null);
  }, []);

  return {
    alerts,
    unreadCount,
    connected,
    captureMode,
    loadingHistory,
    latestLiveAlert,
    clearAlerts,
    markAllRead,
    acknowledgeAlert,
    acknowledgeAllAlerts,
    refreshHistory,
    sendTestAlert,
    dismissLiveAlert,
  };
}
