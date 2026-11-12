import React from 'react';
import {
  Cpu,
  HardDrive,
  MemoryStick,
  Thermometer,
  MonitorSmartphone,
  Server,
  RefreshCw,
  BatteryCharging,
  Battery,
  Wifi,
  Download,
  CheckCircle2,
} from 'lucide-react';
import { useClientHardwareMonitor, ThermalRiskLevel } from '@/hooks/useClientHardwareMonitor';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import type { ThermalMode } from '@/utils/deviceProfile';

interface DeviceTelemetryPanelProps {
  active: boolean;
}

const formatUptime = (seconds: number): string => {
  if (!seconds || seconds < 60) return `${Math.max(0, seconds)}s`;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
};

const formatMb = (mb: number | null): string => {
  if (mb === null || !Number.isFinite(mb)) return 'N/A';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
};

const getBarColor = (pct: number): string => {
  if (pct >= 85) return 'bg-rose-500';
  if (pct >= 65) return 'bg-amber-500';
  return 'bg-emerald-500';
};

const RISK_STYLE: Record<ThermalRiskLevel, { badge: string; dot: string }> = {
  cool: {
    badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    dot: 'bg-emerald-500 dark:bg-emerald-400',
  },
  moderate: {
    badge: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30',
    dot: 'bg-sky-500 dark:bg-sky-400',
  },
  warm: {
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
    dot: 'bg-amber-500 dark:bg-amber-400',
  },
  high: {
    badge: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
    dot: 'bg-rose-500 dark:bg-rose-400',
  },
};

const getLatencyTone = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined) return 'text-gray-400';
  if (ms < 60) return 'text-emerald-400';
  if (ms < 150) return 'text-amber-400';
  return 'text-rose-400';
};

const formatMs = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '-- ms';
  return `${Math.round(ms)} ms`;
};

const DeviceTelemetryPanel: React.FC<DeviceTelemetryPanelProps> = ({ active }) => {
  const {
    profile,
    client,
    vps,
    clientToVpsMs,
    clientToVpsJitterMs,
    vpsLoading,
    vpsError,
    setThermalMode,
    refreshNow,
  } = useClientHardwareMonitor(active);
  const pwa = usePwaInstall();

  const clientHeapPct =
    client.ram.heapUsedMb !== null && client.ram.heapLimitMb
      ? Math.min(100, Math.round((client.ram.heapUsedMb / client.ram.heapLimitMb) * 100))
      : 0;

  const riskStyle = RISK_STYLE[client.thermal.riskLevel];
  const deviceBadgeLabel =
    profile.deviceClass === 'phone'
      ? 'MOBILE PHONE'
      : profile.deviceClass === 'tablet'
        ? 'TOUCH TABLET'
        : 'DESKTOP PC';

  return (
    <div className="flex-1 min-h-0 overflow-y-auto touch-pan-y overscroll-contain p-3 space-y-3 scrollbar-thin">
      {/* ─── Section 1: Client Device (Auto-Detected) ─── */}
      <div className="rounded-xl border border-violet-500/25 bg-white/80 dark:bg-white/[0.03] p-3 space-y-2.5 shadow-sm dark:shadow-none">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
              <MonitorSmartphone className="w-4 h-4 text-violet-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-black tracking-wider uppercase text-slate-900 dark:text-white">
                  This Device
                </span>
                <span className="px-1.5 py-0.5 text-[8.5px] font-black rounded bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/30">
                  {deviceBadgeLabel}
                </span>
                <span
                  className={`px-1.5 py-0.5 text-[8.5px] font-black rounded border ${
                    profile.isThermalGuardActive
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                      : 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30'
                  }`}
                >
                  {profile.isThermalGuardActive ? 'ECO GUARD ON' : 'FULL DESKTOP'}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-gray-400 truncate">
                {client.deviceSummary} • {client.browserSummary} • {client.screenInfo}
              </p>
            </div>
          </div>

          {/* Thermal Mode Override */}
          <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg p-0.5 flex-shrink-0">
            {(['auto', 'eco', 'full'] as ThermalMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setThermalMode(m)}
                className={`px-1.5 py-0.5 text-[8.5px] font-bold uppercase rounded transition-colors cursor-pointer ${
                  profile.mode === m
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                }`}
                title={`Set Thermal Guard mode: ${m.toUpperCase()}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {client.gpuRenderer && (
          <div className="text-[9.5px] font-mono text-slate-600 dark:text-gray-400 bg-slate-100/90 dark:bg-black/30 rounded-lg px-2.5 py-1 border border-slate-200/80 dark:border-white/5 truncate">
            GPU: <span className="text-cyan-600 dark:text-cyan-300">{client.gpuRenderer}</span>
          </div>
        )}

        {/* Client Metrics Grid */}
        <div className="grid grid-cols-2 gap-2">
          {/* CPU */}
          <div className="rounded-lg bg-white dark:bg-black/30 border border-slate-200 dark:border-white/5 p-2 space-y-1 shadow-sm dark:shadow-none">
            <div className="flex items-center justify-between text-[9.5px]">
              <span className="flex items-center gap-1 font-bold text-slate-500 dark:text-gray-400">
                <Cpu className="w-3 h-3 text-sky-400" /> CPU
              </span>
              <span className="font-mono font-bold text-slate-900 dark:text-white">
                {client.cpu.cores ? `${client.cpu.cores} Threads` : 'N/A'} • {client.cpu.fps || '--'} FPS
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${getBarColor(client.cpu.jsLoadPct)}`}
                style={{ width: `${Math.min(100, Math.max(4, client.cpu.jsLoadPct))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[8.5px] font-mono text-slate-500 dark:text-gray-400">
              <span>JS Load: {client.cpu.jsLoadPct}%</span>
              <span>
                {client.cpu.pressure !== 'unsupported' ? `Pressure: ${client.cpu.pressure}` : 'OS CPU% sandboxed'}
              </span>
            </div>
          </div>

          {/* RAM */}
          <div className="rounded-lg bg-white dark:bg-black/30 border border-slate-200 dark:border-white/5 p-2 space-y-1 shadow-sm dark:shadow-none">
            <div className="flex items-center justify-between text-[9.5px]">
              <span className="flex items-center gap-1 font-bold text-slate-500 dark:text-gray-400">
                <MemoryStick className="w-3 h-3 text-purple-400" /> RAM
              </span>
              <span className="font-mono font-bold text-slate-900 dark:text-white">
                {client.ram.deviceMemoryGb
                  ? `${client.ram.deviceMemoryGb} GB Tier`
                  : client.isSecureContext
                  ? 'Tier Hidden'
                  : 'HTTPS Required'}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${getBarColor(clientHeapPct)}`}
                style={{ width: `${Math.min(100, Math.max(client.ram.heapUsedMb ? 6 : 0, clientHeapPct))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[8.5px] font-mono text-slate-500 dark:text-gray-400">
              <span>
                Tab Heap:{' '}
                {client.ram.heapUsedMb !== null
                  ? `${client.ram.heapUsedMb}/${client.ram.heapLimitMb} MB`
                  : 'Browser Hidden'}
              </span>
            </div>
          </div>

          {/* ROM / Storage */}
          <div className="rounded-lg bg-white dark:bg-black/30 border border-slate-200 dark:border-white/5 p-2 space-y-1 shadow-sm dark:shadow-none">
            <div className="flex items-center justify-between text-[9.5px]">
              <span className="flex items-center gap-1 font-bold text-slate-500 dark:text-gray-400">
                <HardDrive className="w-3 h-3 text-emerald-400" /> STORAGE
              </span>
              <span className="font-mono font-bold text-slate-900 dark:text-white">
                {client.rom.quotaMb !== null
                  ? `${formatMb(client.rom.quotaMb)} Quota`
                  : client.isSecureContext
                  ? 'N/A Quota'
                  : 'HTTPS Required'}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(client.rom.usedMb ? 4 : 0, client.rom.percent || 0))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[8.5px] font-mono text-slate-500 dark:text-gray-400">
              <span>
                App Cache:{' '}
                {client.rom.usedMb !== null
                  ? formatMb(client.rom.usedMb)
                  : client.isSecureContext
                  ? 'N/A'
                  : 'HTTPS Required'}
              </span>
              <span>ROM sandboxed</span>
            </div>
          </div>

          {/* Thermal & Battery */}
          <div className="rounded-lg bg-white dark:bg-black/30 border border-slate-200 dark:border-white/5 p-2 space-y-1 shadow-sm dark:shadow-none">
            <div className="flex items-center justify-between text-[9.5px]">
              <span className="flex items-center gap-1 font-bold text-slate-500 dark:text-gray-400">
                <Thermometer className="w-3 h-3 text-rose-400" /> THERMAL
              </span>
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[8.5px] font-bold border ${riskStyle.badge}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${riskStyle.dot}`} />
                {client.thermal.riskLabel}
              </span>
            </div>
            <div className="flex items-center justify-between text-[8.5px] font-mono text-slate-500 dark:text-gray-400 pt-0.5">
              <span className="flex items-center gap-1">
                {client.battery.charging ? (
                  <BatteryCharging className="w-3 h-3 text-amber-500" />
                ) : (
                  <Battery className="w-3 h-3 text-emerald-500" />
                )}
                {client.battery.supported && client.battery.levelPct !== null
                  ? `Batt: ${client.battery.levelPct}%${client.battery.charging ? ' (Charging)' : ''}`
                  : 'Battery: N/A'}
              </span>
            </div>
            <p className="text-[8px] font-mono text-slate-500 dark:text-gray-500 leading-tight">
              {client.thermal.sensorNote}
            </p>
          </div>
        </div>
      </div>

      {/* ─── Section 2: VPS Server Hardware (Live) ─── */}
      <div className="rounded-xl border border-cyan-500/25 bg-white/80 dark:bg-white/[0.03] p-3 space-y-2.5 shadow-sm dark:shadow-none">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center flex-shrink-0">
              <Server className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-black tracking-wider uppercase text-slate-900 dark:text-white">
                  VPS Server Hardware
                </span>
                {vps && (
                  <span className="px-1.5 py-0.5 text-[8.5px] font-black rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30">
                    UP {formatUptime(vps.uptime_seconds)}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 dark:text-gray-400 truncate">
                {vps ? `${vps.hostname} • ${vps.os} (${vps.arch})` : vpsLoading ? 'Connecting to VPS telemetry...' : 'Telemetry offline'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={refreshNow}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-gray-400 hover:text-cyan-600 dark:hover:text-cyan-300 hover:border-cyan-500/40 bg-white dark:bg-transparent transition-colors cursor-pointer"
            title="Refresh VPS Telemetry"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${vpsLoading ? 'animate-spin text-cyan-500 dark:text-cyan-400' : ''}`} />
          </button>
        </div>

        {vpsError && !vps ? (
          <div className="text-[10px] font-mono text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-500/20 rounded-lg px-2.5 py-2">
            Failed to load VPS telemetry: {vpsError}
          </div>
        ) : vps ? (
          <div className="grid grid-cols-2 gap-2">
            {/* VPS CPU */}
            <div className="rounded-lg bg-white dark:bg-black/30 border border-slate-200 dark:border-white/5 p-2 space-y-1 shadow-sm dark:shadow-none">
              <div className="flex items-center justify-between text-[9.5px]">
                <span className="flex items-center gap-1 font-bold text-slate-500 dark:text-gray-400">
                  <Cpu className="w-3 h-3 text-cyan-500 dark:text-cyan-400" /> VPS CPU
                </span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">
                  {vps.cpu.percent.toFixed(1)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${getBarColor(vps.cpu.percent)}`}
                  style={{ width: `${Math.min(100, Math.max(2, vps.cpu.percent))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[8.5px] font-mono text-slate-500 dark:text-gray-400">
                <span>{vps.cpu.cores_logical} vCPU ({vps.cpu.cores_physical}C)</span>
                <span>
                  {vps.cpu.load_avg ? `LA: ${vps.cpu.load_avg[0]}` : vps.cpu.freq_mhz ? `${vps.cpu.freq_mhz} MHz` : ''}
                </span>
              </div>
            </div>

            {/* VPS RAM */}
            <div className="rounded-lg bg-white dark:bg-black/30 border border-slate-200 dark:border-white/5 p-2 space-y-1 shadow-sm dark:shadow-none">
              <div className="flex items-center justify-between text-[9.5px]">
                <span className="flex items-center gap-1 font-bold text-slate-500 dark:text-gray-400">
                  <MemoryStick className="w-3 h-3 text-violet-500 dark:text-violet-400" /> VPS RAM
                </span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">
                  {vps.ram.percent.toFixed(1)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${getBarColor(vps.ram.percent)}`}
                  style={{ width: `${Math.min(100, Math.max(2, vps.ram.percent))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[8.5px] font-mono text-slate-500 dark:text-gray-400">
                <span>
                  {vps.ram.used_gb} / {vps.ram.total_gb} GB
                </span>
                <span>Free: {vps.ram.available_gb} GB</span>
              </div>
            </div>

            {/* VPS ROM */}
            <div className="rounded-lg bg-white dark:bg-black/30 border border-slate-200 dark:border-white/5 p-2 space-y-1 shadow-sm dark:shadow-none">
              <div className="flex items-center justify-between text-[9.5px]">
                <span className="flex items-center gap-1 font-bold text-slate-500 dark:text-gray-400">
                  <HardDrive className="w-3 h-3 text-emerald-500 dark:text-emerald-400" /> VPS ROM
                </span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">
                  {vps.rom.percent.toFixed(1)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${getBarColor(vps.rom.percent)}`}
                  style={{ width: `${Math.min(100, Math.max(2, vps.rom.percent))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[8.5px] font-mono text-slate-500 dark:text-gray-400">
                <span>
                  {vps.rom.used_gb} / {vps.rom.total_gb} GB
                </span>
                <span>Free: {vps.rom.free_gb} GB</span>
              </div>
            </div>

            {/* VPS CPU Temp */}
            <div className="rounded-lg bg-white dark:bg-black/30 border border-slate-200 dark:border-white/5 p-2 space-y-1 shadow-sm dark:shadow-none">
              <div className="flex items-center justify-between text-[9.5px]">
                <span className="flex items-center gap-1 font-bold text-slate-500 dark:text-gray-400">
                  <Thermometer className="w-3 h-3 text-orange-500 dark:text-orange-400" /> VPS TEMP
                </span>
                <span
                  className={`font-mono font-bold ${
                    vps.temperature.available && vps.temperature.cpu_temp_c !== null
                      ? vps.temperature.cpu_temp_c >= 80
                        ? 'text-rose-600 dark:text-rose-400'
                        : vps.temperature.cpu_temp_c >= 65
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-gray-400'
                  }`}
                >
                  {vps.temperature.available && vps.temperature.cpu_temp_c !== null
                    ? `${vps.temperature.cpu_temp_c.toFixed(1)}°C`
                    : 'VM Hidden'}
                </span>
              </div>
              <p className="text-[8.5px] font-mono text-slate-500 dark:text-gray-400 pt-1 leading-tight">
                {vps.temperature.available
                  ? `Sensor: ${vps.temperature.sensor_label || 'CPU Thermal'}`
                  : 'Virtual VPS hypervisor hides physical host thermal sensors'}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((idx) => (
              <div key={idx} className="h-14 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/5" />
            ))}
          </div>
        )}
      </div>

      {/* ─── Section 3: Network & Exchange Latency + PWA App Status ─── */}
      <div className="rounded-xl border border-emerald-500/25 bg-white/80 dark:bg-white/[0.03] p-3 space-y-2.5 shadow-sm dark:shadow-none">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
              <Wifi className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-black tracking-wider uppercase text-slate-900 dark:text-white block">
                Network &amp; Exchange Latency
              </span>
              <p className="text-[10px] text-slate-500 dark:text-gray-400 truncate">
                Device ↔ VPS RTT &amp; VPS → Binance API / WS Ping
              </p>
            </div>
          </div>

          {vps?.network && (
            <span
              className={`px-1.5 py-0.5 text-[8.5px] font-black uppercase rounded border ${
                vps.network.status === 'optimal'
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                  : vps.network.status === 'good'
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                    : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30'
              }`}
            >
              {vps.network.status}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-lg bg-white dark:bg-black/30 border border-slate-200 dark:border-white/5 p-2 space-y-0.5 shadow-sm dark:shadow-none">
            <span className="text-[8.5px] font-bold text-slate-500 dark:text-gray-400 block">DEVICE ↔ VPS</span>
            <span className={`text-xs font-mono font-black ${getLatencyTone(clientToVpsMs)}`}>
              {formatMs(clientToVpsMs)}
            </span>
            <span className="text-[8px] font-mono text-slate-400 dark:text-gray-500 block">
              Jitter: {clientToVpsJitterMs !== null ? `${clientToVpsJitterMs} ms` : '--'}
            </span>
          </div>

          <div className="rounded-lg bg-white dark:bg-black/30 border border-slate-200 dark:border-white/5 p-2 space-y-0.5 shadow-sm dark:shadow-none">
            <span className="text-[8.5px] font-bold text-slate-500 dark:text-gray-400 block">VPS → SPOT REST</span>
            <span className={`text-xs font-mono font-black ${getLatencyTone(vps?.network?.binance_spot_ms)}`}>
              {formatMs(vps?.network?.binance_spot_ms)}
            </span>
            <span className="text-[8px] font-mono text-slate-400 dark:text-gray-500 block">api.binance.com</span>
          </div>

          <div className="rounded-lg bg-white dark:bg-black/30 border border-slate-200 dark:border-white/5 p-2 space-y-0.5 shadow-sm dark:shadow-none">
            <span className="text-[8.5px] font-bold text-slate-500 dark:text-gray-400 block">VPS → FUTURES REST</span>
            <span className={`text-xs font-mono font-black ${getLatencyTone(vps?.network?.binance_futures_ms)}`}>
              {formatMs(vps?.network?.binance_futures_ms)}
            </span>
            <span className="text-[8px] font-mono text-slate-400 dark:text-gray-500 block">fapi.binance.com</span>
          </div>

          <div className="rounded-lg bg-white dark:bg-black/30 border border-slate-200 dark:border-white/5 p-2 space-y-0.5 shadow-sm dark:shadow-none">
            <span className="text-[8.5px] font-bold text-slate-500 dark:text-gray-400 block">VPS → BINANCE WS</span>
            <span className={`text-xs font-mono font-black ${getLatencyTone(vps?.network?.binance_ws_ms)}`}>
              {formatMs(vps?.network?.binance_ws_ms)}
            </span>
            <span className="text-[8px] font-mono text-slate-400 dark:text-gray-500 block">stream.binance:9443</span>
          </div>
        </div>

        {/* PWA Install Bar */}
        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-200 dark:border-white/10">
          <div className="min-w-0">
            <span className="text-[9.5px] font-bold text-slate-800 dark:text-gray-200 block">
              Mobile / Tablet PWA App Mode
            </span>
            <span className="text-[8.5px] font-mono text-slate-500 dark:text-gray-400 truncate block">
              {pwa.isInstalled
                ? 'Running in full-screen standalone PWA mode (reduced Chrome UI overhead)'
                : !pwa.isSecureContext
                  ? 'Open via HTTPS to unlock 1-tap Chrome PWA Install on A34 & Redmi Pad 2 Pro'
                  : pwa.canPromptInstall
                    ? 'Ready to install as standalone app (faster & cooler than browser tab)'
                    : 'Use Chrome menu (⋮) → Install App / Add to Home Screen'}
            </span>
          </div>

          {pwa.isInstalled ? (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex-shrink-0">
              <CheckCircle2 className="w-3 h-3" /> INSTALLED
            </span>
          ) : pwa.canPromptInstall ? (
            <button
              type="button"
              onClick={() => void pwa.promptInstall()}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9.5px] font-black bg-violet-600 hover:bg-violet-500 text-white shadow-sm transition-colors cursor-pointer flex-shrink-0"
            >
              <Download className="w-3 h-3" /> Install App
            </button>
          ) : (
            <span className="px-2 py-1 rounded-lg text-[8.5px] font-mono bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-gray-400 border border-slate-200 dark:border-white/10 flex-shrink-0">
              {pwa.isSecureContext ? (pwa.swRegistered ? 'SW READY' : 'MENU INSTALL') : 'HTTPS NEEDED'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeviceTelemetryPanel;

