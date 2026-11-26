import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, AlertTriangle, ShieldAlert, ShieldCheck, WifiOff, X } from 'lucide-react';
import {
  systemService,
  type LatencyGuardConfig,
  type NetworkLatencySnapshot,
} from '@/services/systemService';
import type { SystemAlert } from '@/hooks/useSystemAlerts';
import { isThermalGuardActive } from '@/utils/deviceProfile';

export type LatencySeverity = 'optimal' | 'good' | 'warning' | 'critical' | 'unreachable';

export interface LatencyConfirmRequest {
  actionLabel: string;
  details?: string;
  isExitOrReduce?: boolean;
}

export interface LatencyConfirmResult {
  proceed: boolean;
  overriddenHighLatency: boolean;
}

interface PendingConfirmState {
  actionLabel: string;
  details?: string;
  resolve: (result: LatencyConfirmResult) => void;
}

export interface LatencyGuardContextValue {
  clientToVpsMs: number | null;
  clientToVpsJitterMs: number | null;
  network: NetworkLatencySnapshot | null;
  severity: LatencySeverity;
  shouldWarn: boolean;
  shouldProtect: boolean;
  reasons: string[];
  guardConfig: LatencyGuardConfig;
  latencyAlerts: SystemAlert[];
  unreadLatencyCount: number;
  latestTransitionAlert: SystemAlert | null;
  lastSampledAt: number | null;
  markLatencyAlertsRead: () => void;
  clearLatencyAlerts: () => void;
  dismissTransitionAlert: () => void;
  updateGuardConfig: (updates: Partial<LatencyGuardConfig>) => Promise<void>;
  refreshLatencyNow: () => Promise<void>;
  confirmIfHighLatency: (req: LatencyConfirmRequest) => Promise<LatencyConfirmResult>;
}

const DEFAULT_GUARD_CONFIG: LatencyGuardConfig = {
  guard_enabled: true,
  block_on_degraded: true,
  binance_warn_ms: 1000,
  binance_block_ms: 1200,
  client_warn_ms: 1000,
  client_block_ms: 1500,
};

const STORAGE_KEY = 'cosmo_latency_guard_v2';

const loadLocalGuardConfig = (): LatencyGuardConfig => {
  if (typeof window === 'undefined') return DEFAULT_GUARD_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_GUARD_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_GUARD_CONFIG,
      ...(typeof parsed === 'object' && parsed ? parsed : {}),
    };
  } catch {
    return DEFAULT_GUARD_CONFIG;
  }
};

const SEVERITY_RANK: Record<LatencySeverity, number> = {
  optimal: 0,
  good: 1,
  warning: 2,
  critical: 3,
  unreachable: 4,
};

const maxLatencySeverity = (a: LatencySeverity, b: LatencySeverity): LatencySeverity =>
  SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;

const formatMs = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '-- ms';
  return `${Math.round(ms)} ms`;
};

const LatencyGuardContext = createContext<LatencyGuardContextValue | null>(null);

export const LatencyGuardProvider: React.FC<{
  children: React.ReactNode;
  canManageServerGuard?: boolean;
}> = ({ children, canManageServerGuard = false }) => {
  const [clientToVpsMs, setClientToVpsMs] = useState<number | null>(null);
  const [clientToVpsJitterMs, setClientToVpsJitterMs] = useState<number | null>(null);
  const [network, setNetwork] = useState<NetworkLatencySnapshot | null>(null);
  const [guardConfig, setGuardConfig] = useState<LatencyGuardConfig>(loadLocalGuardConfig);
  const [latencyAlerts, setLatencyAlerts] = useState<SystemAlert[]>([]);
  const [unreadLatencyCount, setUnreadLatencyCount] = useState(0);
  const [latestTransitionAlert, setLatestTransitionAlert] = useState<SystemAlert | null>(null);
  const [lastSampledAt, setLastSampledAt] = useState<number | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmState | null>(null);

  const rttHistoryRef = useRef<number[]>([]);
  const lastPanelSampleTsRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const prevAlertSeverityRef = useRef<LatencySeverity>('optimal');
  const lastAlertEmitTsRef = useRef<number>(0);
  const pendingConfirmRef = useRef<PendingConfirmState | null>(null);

  const pushClientRttSample = useCallback((rttMs: number | null) => {
    if (rttMs === null || !Number.isFinite(rttMs)) return;
    setClientToVpsMs(rttMs);
    const next = [...rttHistoryRef.current, rttMs].slice(-12);
    rttHistoryRef.current = next;
    if (next.length >= 2) {
      let totalDiff = 0;
      for (let i = 1; i < next.length; i++) {
        totalDiff += Math.abs(next[i] - next[i - 1]);
      }
      setClientToVpsJitterMs(Math.round((totalDiff / (next.length - 1)) * 10) / 10);
    }
  }, []);

  const fetchSample = useCallback(async (force = false) => {
    if (inFlightRef.current) return;
    if (typeof document !== 'undefined' && document.hidden && !force) return;
    inFlightRef.current = true;
    try {
      const [statusRes, firstRtt] = await Promise.all([
        systemService.getNetworkStatus(force),
        systemService.pingServerRtt().catch(() => null),
      ]);
      let rttMs = firstRtt;
      if (rttMs !== null && rttMs > 320) {
        const retryRtt = await systemService.pingServerRtt().catch(() => null);
        if (retryRtt !== null) {
          rttMs = Math.min(rttMs, retryRtt);
        }
      }
      if (statusRes?.network) {
        setNetwork(statusRes.network);
      }
      if (statusRes?.guard_config) {
        setGuardConfig((prev) => ({ ...prev, ...statusRes.guard_config }));
      }
      if (rttMs !== null) {
        pushClientRttSample(rttMs);
      }
      setLastSampledAt(Date.now());
    } catch {
      // If ping/status fails completely while logged in, reflect connection problem via client ping error only if repeated
    } finally {
      inFlightRef.current = false;
    }
  }, [pushClientRttSample]);

  // Listen to live 3s telemetry broadcasts when DeviceTelemetryPanel is already open (avoids duplicate polling)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onSample = (ev: Event) => {
      const detail = (ev as CustomEvent<{
        clientToVpsMs?: number | null;
        clientToVpsJitterMs?: number | null;
        network?: NetworkLatencySnapshot | null;
        guardConfig?: LatencyGuardConfig | null;
      }>).detail;
      if (!detail) return;
      lastPanelSampleTsRef.current = Date.now();
      if (detail.clientToVpsMs !== undefined && detail.clientToVpsMs !== null) {
        pushClientRttSample(detail.clientToVpsMs);
      }
      if (detail.network) setNetwork(detail.network);
      if (detail.guardConfig) setGuardConfig((prev) => ({ ...prev, ...detail.guardConfig }));
      setLastSampledAt(Date.now());
    };
    window.addEventListener('cosmo:telemetry-sample', onSample as EventListener);
    return () => window.removeEventListener('cosmo:telemetry-sample', onSample as EventListener);
  }, []);

  // Lightweight background latency polling (10s desktop / 15s eco mode, skipped while Device tab actively polls)
  useEffect(() => {
    void fetchSample(false);
    const intervalMs = isThermalGuardActive() ? 15000 : 10000;
    const timer = setInterval(() => {
      if (Date.now() - lastPanelSampleTsRef.current < 6000) {
        return;
      }
      void fetchSample(false);
    }, intervalMs);

    const onVis = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        void fetchSample(false);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fetchSample]);

  const evaluation = useMemo<{
    severity: LatencySeverity;
    shouldWarn: boolean;
    shouldProtect: boolean;
    reasons: string[];
  }>(() => {
    const reasons: string[] = [];
    let sev: LatencySeverity = 'optimal';

    if (network) {
      const spot = network.binance_spot_ms;
      const fut = network.binance_futures_ms;
      const ws = network.binance_ws_ms;
      const samples = [spot, fut, ws].filter((v): v is number => v !== null && Number.isFinite(v));

      if (network.status === 'unreachable' || samples.length === 0) {
        sev = maxLatencySeverity(sev, 'unreachable');
        reasons.push('VPS → Binance endpoints unreachable');
      } else {
        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
        const maxVal = Math.max(...samples);
        if (spot !== null && spot >= guardConfig.binance_warn_ms) {
          reasons.push(`VPS → Spot REST ${Math.round(spot)}ms (≥${guardConfig.binance_warn_ms}ms)`);
        }
        if (fut !== null && fut >= guardConfig.binance_warn_ms) {
          reasons.push(`VPS → Futures REST ${Math.round(fut)}ms (≥${guardConfig.binance_warn_ms}ms)`);
        }
        if (ws !== null && ws >= guardConfig.binance_warn_ms) {
          reasons.push(`VPS → Binance WS ${Math.round(ws)}ms (≥${guardConfig.binance_warn_ms}ms)`);
        }

        if (maxVal >= guardConfig.binance_block_ms || avg >= guardConfig.binance_block_ms) {
          sev = maxLatencySeverity(sev, 'critical');
        } else if (network.status === 'degraded' || reasons.length > 0) {
          sev = maxLatencySeverity(sev, 'warning');
        } else if (network.status === 'good') {
          sev = maxLatencySeverity(sev, 'good');
        }
      }
    }

    if (clientToVpsMs !== null && Number.isFinite(clientToVpsMs)) {
      if (clientToVpsMs >= guardConfig.client_block_ms) {
        sev = maxLatencySeverity(sev, 'critical');
        reasons.push(`Device ↔ VPS ${Math.round(clientToVpsMs)}ms (≥${guardConfig.client_block_ms}ms)`);
      } else if (clientToVpsMs >= guardConfig.client_warn_ms) {
        sev = maxLatencySeverity(sev, 'warning');
        reasons.push(`Device ↔ VPS ${Math.round(clientToVpsMs)}ms (≥${guardConfig.client_warn_ms}ms)`);
      }
    }

    if (clientToVpsJitterMs !== null && clientToVpsJitterMs >= 500) {
      sev = maxLatencySeverity(sev, 'warning');
      reasons.push(`Network Jitter ${Math.round(clientToVpsJitterMs)}ms (Unstable)`);
    }

    const shouldWarn = sev === 'warning' || sev === 'critical' || sev === 'unreachable';
    const shouldProtect =
      Boolean(guardConfig.guard_enabled) &&
      shouldWarn &&
      (Boolean(guardConfig.block_on_degraded) || sev === 'critical' || sev === 'unreachable');

    return {
      severity: sev,
      shouldWarn,
      shouldProtect,
      reasons,
    };
  }, [network, clientToVpsMs, clientToVpsJitterMs, guardConfig]);

  // Record deduplicated transition alerts into Sys Monitor alert feed & toast banner
  useEffect(() => {
    const sev: LatencySeverity = evaluation.severity;
    const prev = prevAlertSeverityRef.current;
    const now = Date.now();

    if (sev === 'warning' || sev === 'critical' || sev === 'unreachable') {
      const escalated =
        prev === 'optimal' ||
        prev === 'good' ||
        (prev === 'warning' && (sev === 'critical' || sev === 'unreachable'));
      const cooldownDone = now - lastAlertEmitTsRef.current >= 90000;
      if (escalated || cooldownDone) {
        prevAlertSeverityRef.current = sev;
        lastAlertEmitTsRef.current = now;
        const detailsStr = evaluation.reasons.join(' • ') || `Status: ${sev.toUpperCase()}`;
        const alertObj: SystemAlert = {
          id: `lat_ui_${now}`,
          timestamp: new Date(now).toISOString(),
          container: 'network_latency',
          display_name: 'Network & Exchange Latency',
          severity: sev === 'warning' ? 'WARNING' : 'CRITICAL',
          message: `High Latency Warning (${sev.toUpperCase()}): ${detailsStr}`,
          snippet: [
            `Device <-> VPS: ${formatMs(clientToVpsMs)} (Jitter ${clientToVpsJitterMs !== null ? `${clientToVpsJitterMs}ms` : '--'})`,
            `VPS -> Spot REST: ${formatMs(network?.binance_spot_ms)}`,
            `VPS -> Futures REST: ${formatMs(network?.binance_futures_ms)}`,
            `VPS -> Binance WS: ${formatMs(network?.binance_ws_ms)}`,
          ],
          read: false,
        };
        setLatencyAlerts((list) => [alertObj, ...list].slice(0, 30));
        setUnreadLatencyCount((c) => c + 1);
        setLatestTransitionAlert(alertObj);
      }
    } else if (prev === 'warning' || prev === 'critical' || prev === 'unreachable') {
      prevAlertSeverityRef.current = sev;
      lastAlertEmitTsRef.current = now;
    } else {
      prevAlertSeverityRef.current = sev;
    }
  }, [
    evaluation.severity,
    evaluation.reasons,
    clientToVpsMs,
    clientToVpsJitterMs,
    network?.binance_spot_ms,
    network?.binance_futures_ms,
    network?.binance_ws_ms,
  ]);

  const updateGuardConfig = useCallback(
    async (updates: Partial<LatencyGuardConfig>) => {
      const merged = { ...guardConfig, ...updates };
      setGuardConfig(merged);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      } catch {
        // ignore storage restrictions
      }
      if (canManageServerGuard) {
        try {
          const saved = await systemService.updateLatencyGuard(merged);
          setGuardConfig(saved);
        } catch {
          // keep local config intact even if API update fails temporarily
        }
      }
    },
    [guardConfig, canManageServerGuard]
  );

  const confirmIfHighLatency = useCallback(
    ({ actionLabel, details, isExitOrReduce }: LatencyConfirmRequest): Promise<LatencyConfirmResult> => {
      if (isExitOrReduce || !evaluation.shouldProtect) {
        return Promise.resolve({ proceed: true, overriddenHighLatency: false });
      }
      // Resolve any stale dangling confirmation safely before opening a new prompt
      if (pendingConfirmRef.current) {
        pendingConfirmRef.current.resolve({ proceed: false, overriddenHighLatency: false });
      }
      return new Promise<LatencyConfirmResult>((resolve) => {
        const next: PendingConfirmState = { actionLabel, details, resolve };
        pendingConfirmRef.current = next;
        setPendingConfirm(next);
      });
    },
    [evaluation.shouldProtect]
  );

  const handleConfirmDecision = useCallback((proceed: boolean) => {
    const active = pendingConfirmRef.current;
    pendingConfirmRef.current = null;
    setPendingConfirm(null);
    if (active) {
      active.resolve({ proceed, overriddenHighLatency: proceed });
    }
  }, []);

  const value = useMemo<LatencyGuardContextValue>(
    () => ({
      clientToVpsMs,
      clientToVpsJitterMs,
      network,
      severity: evaluation.severity,
      shouldWarn: evaluation.shouldWarn,
      shouldProtect: evaluation.shouldProtect,
      reasons: evaluation.reasons,
      guardConfig,
      latencyAlerts,
      unreadLatencyCount,
      latestTransitionAlert,
      lastSampledAt,
      markLatencyAlertsRead: () => setUnreadLatencyCount(0),
      clearLatencyAlerts: () => {
        setLatencyAlerts([]);
        setUnreadLatencyCount(0);
      },
      dismissTransitionAlert: () => setLatestTransitionAlert(null),
      updateGuardConfig,
      refreshLatencyNow: () => fetchSample(true),
      confirmIfHighLatency,
    }),
    [
      clientToVpsMs,
      clientToVpsJitterMs,
      network,
      evaluation,
      guardConfig,
      latencyAlerts,
      unreadLatencyCount,
      latestTransitionAlert,
      lastSampledAt,
      updateGuardConfig,
      fetchSample,
      confirmIfHighLatency,
    ]
  );

  return (
    <LatencyGuardContext.Provider value={value}>
      {children}

      {pendingConfirm &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-slate-950/80"
            onClick={() => handleConfirmDecision(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[460px] rounded-2xl border border-rose-500/45 bg-[#090E1A] text-white shadow-[0_25px_80px_rgba(244,63,94,0.28)] overflow-hidden"
            >
              <div className="h-1 w-full bg-gradient-to-r from-amber-500 via-rose-500 to-red-600" />
              <div className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/40 flex items-center justify-center flex-shrink-0">
                      {evaluation.severity === 'unreachable' ? (
                        <WifiOff className="w-5 h-5 text-rose-400" />
                      ) : (
                        <ShieldAlert className="w-5 h-5 text-rose-400" />
                      )}
                    </div>
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-rose-400 block">
                        Latency Trade &amp; Bot Protection
                      </span>
                      <h3 className="text-sm font-black text-white leading-snug">
                        High Network Latency Detected ({evaluation.severity.toUpperCase()})
                      </h3>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleConfirmDecision(false)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                    aria-label="Cancel action"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="rounded-xl bg-rose-950/35 border border-rose-500/30 p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-semibold">Protected Action</span>
                    <span className="font-bold text-amber-300 truncate max-w-[260px]">
                      {pendingConfirm.actionLabel}
                    </span>
                  </div>
                  {pendingConfirm.details && (
                    <p className="text-[11px] text-slate-300 font-mono">{pendingConfirm.details}</p>
                  )}
                  <p className="text-[11px] text-rose-200/90 leading-relaxed pt-1">
                    Executing entries or launching bots during network spikes increases slippage, stale price fills, and delayed stop-loss attachment.
                  </p>
                </div>

                {/* Live Latency Breakdown */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="rounded-lg bg-black/40 border border-white/10 p-2">
                    <span className="text-[8.5px] font-bold text-slate-400 block">DEVICE ↔ VPS</span>
                    <span
                      className={`text-xs font-mono font-black ${
                        clientToVpsMs !== null && clientToVpsMs >= guardConfig.client_warn_ms
                          ? 'text-rose-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {formatMs(clientToVpsMs)}
                    </span>
                  </div>
                  <div className="rounded-lg bg-black/40 border border-white/10 p-2">
                    <span className="text-[8.5px] font-bold text-slate-400 block">VPS → SPOT</span>
                    <span
                      className={`text-xs font-mono font-black ${
                        network?.binance_spot_ms === null ||
                        network?.binance_spot_ms === undefined ||
                        network.binance_spot_ms >= guardConfig.binance_warn_ms
                          ? 'text-rose-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {formatMs(network?.binance_spot_ms)}
                    </span>
                  </div>
                  <div className="rounded-lg bg-black/40 border border-white/10 p-2">
                    <span className="text-[8.5px] font-bold text-slate-400 block">VPS → FUTURES</span>
                    <span
                      className={`text-xs font-mono font-black ${
                        network?.binance_futures_ms === null ||
                        network?.binance_futures_ms === undefined ||
                        network.binance_futures_ms >= guardConfig.binance_warn_ms
                          ? 'text-rose-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {formatMs(network?.binance_futures_ms)}
                    </span>
                  </div>
                  <div className="rounded-lg bg-black/40 border border-white/10 p-2">
                    <span className="text-[8.5px] font-bold text-slate-400 block">VPS → WS</span>
                    <span
                      className={`text-xs font-mono font-black ${
                        network?.binance_ws_ms === null ||
                        network?.binance_ws_ms === undefined ||
                        network.binance_ws_ms >= guardConfig.binance_warn_ms
                          ? 'text-rose-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {formatMs(network?.binance_ws_ms)}
                    </span>
                  </div>
                </div>

                {evaluation.reasons.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {evaluation.reasons.map((r) => (
                      <span
                        key={r}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-[10px] font-mono text-amber-300"
                      >
                        <AlertTriangle className="w-3 h-3" />
                        {r}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => handleConfirmDecision(false)}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-lg shadow-emerald-950/50"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    Abort &amp; Wait Safely
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfirmDecision(true)}
                    className="px-4 py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 hover:text-rose-200 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    Override &amp; Proceed
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </LatencyGuardContext.Provider>
  );
};

const FALLBACK_CONTEXT: LatencyGuardContextValue = {
  clientToVpsMs: null,
  clientToVpsJitterMs: null,
  network: null,
  severity: 'optimal',
  shouldWarn: false,
  shouldProtect: false,
  reasons: [],
  guardConfig: DEFAULT_GUARD_CONFIG,
  latencyAlerts: [],
  unreadLatencyCount: 0,
  latestTransitionAlert: null,
  lastSampledAt: null,
  markLatencyAlertsRead: () => {},
  clearLatencyAlerts: () => {},
  dismissTransitionAlert: () => {},
  updateGuardConfig: async () => {},
  refreshLatencyNow: async () => {},
  confirmIfHighLatency: async () => ({ proceed: true, overriddenHighLatency: false }),
};

export const useLatencyGuard = (): LatencyGuardContextValue => {
  return useContext(LatencyGuardContext) ?? FALLBACK_CONTEXT;
};
