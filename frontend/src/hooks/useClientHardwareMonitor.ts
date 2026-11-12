import { useEffect, useState, useCallback } from 'react';
import { systemService, VpsHardwareTelemetry } from '@/services/systemService';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';
import { setThermalModeOverride, ThermalMode, DeviceThermalProfile } from '@/utils/deviceProfile';

export type PressureState = 'nominal' | 'fair' | 'serious' | 'critical' | 'unsupported';
export type ThermalRiskLevel = 'cool' | 'moderate' | 'warm' | 'high';

export interface ClientHardwareTelemetry {
  deviceSummary: string;
  browserSummary: string;
  gpuRenderer: string | null;
  screenInfo: string;
  cpu: {
    cores: number | null;
    pressure: PressureState;
    jsLoadPct: number;
    fps: number;
  };
  ram: {
    deviceMemoryGb: number | null;
    heapUsedMb: number | null;
    heapTotalMb: number | null;
    heapLimitMb: number | null;
  };
  rom: {
    usedMb: number | null;
    quotaMb: number | null;
    percent: number | null;
  };
  battery: {
    supported: boolean;
    levelPct: number | null;
    charging: boolean | null;
  };
  thermal: {
    osThermalPressure: PressureState;
    riskLevel: ThermalRiskLevel;
    riskLabel: string;
    sensorNote: string;
  };
}

export interface HardwareMonitorState {
  profile: DeviceThermalProfile;
  client: ClientHardwareTelemetry;
  vps: VpsHardwareTelemetry | null;
  vpsLoading: boolean;
  vpsError: string | null;
  lastUpdatedAt: number | null;
  setThermalMode: (mode: ThermalMode) => void;
  refreshNow: () => void;
}

function detectDeviceSummary(profile: DeviceThermalProfile): { device: string; browser: string } {
  if (typeof navigator === 'undefined') {
    return { device: 'Unknown Device', browser: 'Unknown Browser' };
  }
  const ua = navigator.userAgent || '';
  const androidMatch = ua.match(/Android\s*([\d.]+)?(?:;\s*([^;)]+))?/i);
  let device = 'Desktop Workstation';

  if (profile.deviceClass === 'phone') {
    const model = androidMatch?.[2]?.replace(/Build\/.*$/i, '').trim();
    device = model && model !== 'K' ? `Android Phone (${model})` : 'Android Smartphone';
    if (/iPhone/i.test(ua)) device = 'Apple iPhone';
  } else if (profile.deviceClass === 'tablet') {
    const model = androidMatch?.[2]?.replace(/Build\/.*$/i, '').trim();
    device = model && model !== 'K' ? `Android Tablet (${model})` : 'Touch Tablet (Desktop-Width)';
    if (/iPad|Macintosh/i.test(ua)) device = 'Apple iPad';
  } else if (/Windows NT/i.test(ua)) {
    device = 'Windows Desktop / Laptop';
  } else if (/Macintosh/i.test(ua)) {
    device = 'Apple Mac';
  } else if (/Linux/i.test(ua)) {
    device = 'Linux Desktop';
  }

  let browser = 'Web Browser';
  const chromeMatch = ua.match(/Chrome\/([\d]+)/i);
  const edgeMatch = ua.match(/Edg\/([\d]+)/i);
  const firefoxMatch = ua.match(/Firefox\/([\d]+)/i);
  if (edgeMatch) browser = `Edge ${edgeMatch[1]}`;
  else if (chromeMatch) browser = `Chrome ${chromeMatch[1]}`;
  else if (firefoxMatch) browser = `Firefox ${firefoxMatch[1]}`;
  else if (/Safari/i.test(ua)) browser = 'Safari';

  return { device, browser };
}

function probeWebGLRenderer(): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const gl =
      (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ||
      (canvas.getContext('webgl') as WebGLRenderingContext | null) ||
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const raw = ext ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string | null) : (gl.getParameter(gl.RENDERER) as string | null);
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return raw ? raw.replace(/^ANGLE\s*\(/i, '').replace(/\)$/, '').trim() : null;
  } catch {
    return null;
  }
}

function computeThermalRisk(
  jsLoadPct: number,
  fps: number,
  cpuPressure: PressureState,
  osThermal: PressureState,
  charging: boolean | null
): { riskLevel: ThermalRiskLevel; riskLabel: string } {
  if (osThermal === 'critical' || cpuPressure === 'critical') {
    return { riskLevel: 'high', riskLabel: 'Critical Throttling' };
  }
  if (osThermal === 'serious' || cpuPressure === 'serious' || jsLoadPct >= 75 || (fps > 0 && fps < 22)) {
    return { riskLevel: 'warm', riskLabel: 'Elevated Thermal Load' };
  }
  if (osThermal === 'fair' || cpuPressure === 'fair' || jsLoadPct >= 40 || (charging && jsLoadPct >= 25)) {
    return { riskLevel: 'moderate', riskLabel: 'Moderate Activity' };
  }
  return { riskLevel: 'cool', riskLabel: 'Cool / Optimal' };
}

export function useClientHardwareMonitor(enabled: boolean): HardwareMonitorState {
  const profile = useDeviceProfile();

  const [gpuRenderer, setGpuRenderer] = useState<string | null>(null);
  const [cpuPressure, setCpuPressure] = useState<PressureState>('unsupported');
  const [osThermalPressure, setOsThermalPressure] = useState<PressureState>('unsupported');
  const [jsLoadPct, setJsLoadPct] = useState<number>(0);
  const [fps, setFps] = useState<number>(0);
  const [heapStats, setHeapStats] = useState<{ used: number | null; total: number | null; limit: number | null }>({
    used: null,
    total: null,
    limit: null,
  });
  const [storageStats, setStorageStats] = useState<{ usedMb: number | null; quotaMb: number | null; percent: number | null }>({
    usedMb: null,
    quotaMb: null,
    percent: null,
  });
  const [battery, setBattery] = useState<{ supported: boolean; levelPct: number | null; charging: boolean | null }>({
    supported: false,
    levelPct: null,
    charging: null,
  });

  const [vps, setVps] = useState<VpsHardwareTelemetry | null>(null);
  const [vpsLoading, setVpsLoading] = useState<boolean>(false);
  const [vpsError, setVpsError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const fetchVpsTelemetry = useCallback(async (showSpinner = false) => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (showSpinner) setVpsLoading(true);
    try {
      const data = await systemService.getHardwareTelemetry();
      setVps(data);
      setVpsError(null);
      setLastUpdatedAt(Date.now());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'VPS telemetry unavailable';
      setVpsError(msg);
    } finally {
      if (showSpinner) setVpsLoading(false);
    }
  }, []);

  // Probe static GPU renderer once when enabled
  useEffect(() => {
    if (!enabled || gpuRenderer !== null) return;
    setGpuRenderer(probeWebGLRenderer());
  }, [enabled, gpuRenderer]);

  // Chromium Compute Pressure API (CPU & Thermals when supported)
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const PressureObs = (window as unknown as { PressureObserver?: new (cb: (recs: Array<{ source: string; state: PressureState }>) => void) => { observe: (source: string, opts?: { sampleInterval?: number }) => Promise<void>; disconnect: () => void } }).PressureObserver;
    if (!PressureObs) return;

    const observers: Array<{ disconnect: () => void }> = [];
    const startObserver = async (source: 'cpu' | 'thermals', setter: (s: PressureState) => void) => {
      try {
        const obs = new PressureObs((records) => {
          const latest = records[records.length - 1];
          if (latest?.state) setter(latest.state);
        });
        await obs.observe(source, { sampleInterval: 2000 });
        observers.push(obs);
      } catch {
        setter('unsupported');
      }
    };

    void startObserver('cpu', setCpuPressure);
    void startObserver('thermals', setOsThermalPressure);

    return () => {
      observers.forEach((o) => {
        try {
          o.disconnect();
        } catch {
          // ignore
        }
      });
    };
  }, [enabled]);

  // Battery API subscription
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined') return;
    const navWithBattery = navigator as Navigator & {
      getBattery?: () => Promise<{
        level: number;
        charging: boolean;
        addEventListener: (ev: string, fn: () => void) => void;
        removeEventListener: (ev: string, fn: () => void) => void;
      }>;
    };
    if (!navWithBattery.getBattery) return;

    let alive = true;
    let battRef: Awaited<ReturnType<NonNullable<typeof navWithBattery.getBattery>>> | null = null;
    const syncBattery = () => {
      if (!alive || !battRef) return;
      setBattery({
        supported: true,
        levelPct: Math.round(battRef.level * 100),
        charging: battRef.charging,
      });
    };

    navWithBattery
      .getBattery()
      .then((b) => {
        if (!alive) return;
        battRef = b;
        syncBattery();
        b.addEventListener('levelchange', syncBattery);
        b.addEventListener('chargingchange', syncBattery);
      })
      .catch(() => {});

    return () => {
      alive = false;
      if (battRef) {
        battRef.removeEventListener('levelchange', syncBattery);
        battRef.removeEventListener('chargingchange', syncBattery);
      }
    };
  }, [enabled]);

  // On-demand FPS, JS heap memory, event-loop lag & Storage quota sampling (ONLY when Device tab open)
  useEffect(() => {
    if (!enabled) return;

    let rafId = 0;
    let frames = 0;
    let windowStart = performance.now();
    let expectedTick = performance.now() + 250;
    let lagAccumulatorMs = 0;

    const sampleMemoryAndStorage = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const perfWithMem = performance as Performance & {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
      };
      if (perfWithMem.memory) {
        const mb = 1024 * 1024;
        setHeapStats({
          used: Math.round(perfWithMem.memory.usedJSHeapSize / mb),
          total: Math.round(perfWithMem.memory.totalJSHeapSize / mb),
          limit: Math.round(perfWithMem.memory.jsHeapSizeLimit / mb),
        });
      }
      if (navigator.storage?.estimate) {
        try {
          const est = await navigator.storage.estimate();
          const mb = 1024 * 1024;
          const usedMb = est.usage !== undefined ? Math.round((est.usage / mb) * 10) / 10 : null;
          const quotaMb = est.quota !== undefined ? Math.round(est.quota / mb) : null;
          const percent =
            usedMb !== null && quotaMb && quotaMb > 0 ? Math.min(100, Math.round((usedMb / quotaMb) * 1000) / 10) : null;
          setStorageStats({ usedMb, quotaMb, percent });
        } catch {
          // ignore
        }
      }
    };

    const tickFrame = (now: number) => {
      frames += 1;
      const elapsed = now - windowStart;
      if (elapsed >= 1000) {
        const measuredFps = Math.round((frames * 1000) / elapsed);
        setFps(measuredFps);
        // Normalize accumulated event-loop lag over 1s window into rough main-thread busy %
        const busyPct = Math.min(100, Math.max(0, Math.round((lagAccumulatorMs / elapsed) * 100)));
        setJsLoadPct(busyPct);
        frames = 0;
        lagAccumulatorMs = 0;
        windowStart = now;
      }
      if (!document.hidden) {
        rafId = requestAnimationFrame(tickFrame);
      }
    };

    const lagProbe = setInterval(() => {
      const now = performance.now();
      const drift = Math.max(0, now - expectedTick);
      lagAccumulatorMs += drift;
      expectedTick = now + 250;
    }, 250);

    const handleVisibility = () => {
      if (!document.hidden) {
        frames = 0;
        lagAccumulatorMs = 0;
        windowStart = performance.now();
        expectedTick = windowStart + 250;
        rafId = requestAnimationFrame(tickFrame);
        void sampleMemoryAndStorage();
      } else {
        cancelAnimationFrame(rafId);
      }
    };

    void sampleMemoryAndStorage();
    const metaTimer = setInterval(() => void sampleMemoryAndStorage(), 2000);
    if (!document.hidden) {
      rafId = requestAnimationFrame(tickFrame);
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(lagProbe);
      clearInterval(metaTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled]);

  // On-demand VPS Telemetry polling (every 3s desktop / 4s mobile thermal guard)
  useEffect(() => {
    if (!enabled) return;
    void fetchVpsTelemetry(true);
    const pollMs = profile.isThermalGuardActive ? 4000 : 3000;
    const timer = setInterval(() => {
      void fetchVpsTelemetry(false);
    }, pollMs);

    const handleVis = () => {
      if (!document.hidden) void fetchVpsTelemetry(false);
    };
    document.addEventListener('visibilitychange', handleVis);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVis);
    };
  }, [enabled, profile.isThermalGuardActive, fetchVpsTelemetry]);

  const { device, browser } = detectDeviceSummary(profile);
  const { riskLevel, riskLabel } = computeThermalRisk(
    jsLoadPct,
    fps,
    cpuPressure,
    osThermalPressure,
    battery.charging
  );

  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1).toFixed(2) : '1';
  const screenInfo =
    typeof window !== 'undefined'
      ? `${window.innerWidth}×${window.innerHeight} @${dpr}x${navigator.maxTouchPoints ? ` • ${navigator.maxTouchPoints}pt Touch` : ''}`
      : 'N/A';

  const deviceMemoryGb =
    typeof navigator !== 'undefined'
      ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null)
      : null;

  return {
    profile,
    client: {
      deviceSummary: device,
      browserSummary: browser,
      gpuRenderer,
      screenInfo,
      cpu: {
        cores: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || null : null,
        pressure: cpuPressure,
        jsLoadPct,
        fps,
      },
      ram: {
        deviceMemoryGb,
        heapUsedMb: heapStats.used,
        heapTotalMb: heapStats.total,
        heapLimitMb: heapStats.limit,
      },
      rom: storageStats,
      battery,
      thermal: {
        osThermalPressure,
        riskLevel,
        riskLabel,
        sensorNote:
          osThermalPressure !== 'unsupported'
            ? `OS Thermal State: ${osThermalPressure.toUpperCase()} (Exact °C sensor restricted by browser)`
            : 'Exact °C hardware sensor blocked by Chrome OS sandbox (showing real load & FPS risk)',
      },
    },
    vps,
    vpsLoading,
    vpsError,
    lastUpdatedAt,
    setThermalMode: (mode: ThermalMode) => {
      setThermalModeOverride(mode);
    },
    refreshNow: () => {
      void fetchVpsTelemetry(true);
    },
  };
}

