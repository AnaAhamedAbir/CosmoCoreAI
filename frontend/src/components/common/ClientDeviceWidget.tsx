import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MonitorSmartphone, X } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';
import { useLatencyGuard } from '@/context/LatencyGuardContext';
import DeviceTelemetryPanel from '@/components/common/DeviceTelemetryPanel';

/**
 * Customer-Safe Client Device & Connection Widget
 * -----------------------------------------------
 * Replaces SystemAlertWidget for regular SaaS subscribers so they can control
 * Thermal Guard, inspect their own device FPS/RAM/Battery, check live Ping, and
 * install the mobile/tablet PWA without exposing any VPS or Docker internals.
 */
const ClientDeviceWidget: React.FC = () => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const profile = useDeviceProfile();
  const { shouldWarn: isLatencyWarning, shouldProtect: isLatencyGuarded, severity: latencySeverity } = useLatencyGuard();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`relative flex items-center gap-2 px-2.5 sm:px-3 h-9 rounded-xl border transition-colors cursor-pointer select-none whitespace-nowrap ${
          open ? 'ring-1 ring-cyan-500/50' : ''
        }`}
        style={{
          background: isLatencyWarning
            ? 'linear-gradient(135deg, rgba(244,63,94,0.16), rgba(15,23,42,0.5))'
            : isDark ? '#0B1120' : 'rgba(241,245,249,0.95)',
          borderColor: isLatencyWarning
            ? 'rgba(244,63,94,0.5)'
            : profile.isThermalGuardActive
              ? 'rgba(16,185,129,0.45)'
              : isDark ? 'rgba(30,41,59,0.85)' : 'rgba(203,213,225,0.9)',
        }}
        title={isLatencyWarning ? `High Network Latency (${latencySeverity.toUpperCase()})` : 'Device Telemetry, Thermal Mode, Connection Ping & App Install'}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            isLatencyWarning
              ? 'bg-rose-400'
              : profile.isThermalGuardActive ? 'bg-emerald-400' : 'bg-cyan-400'
          }`}
        />
        <MonitorSmartphone className={`w-3.5 h-3.5 flex-shrink-0 ${isLatencyWarning ? 'text-rose-400' : 'text-cyan-400'}`} />
        <span className={`hidden sm:inline text-[11px] font-bold tracking-wider uppercase ${isLatencyWarning ? 'text-rose-400' : 'text-slate-600 dark:text-slate-300'}`}>
          {isLatencyWarning ? 'Latency !' : 'Device'}
        </span>
        {isLatencyWarning ? (
          <span className="hidden md:inline text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/35">
            {isLatencyGuarded ? 'GUARD' : 'LAG'}
          </span>
        ) : profile.isThermalGuardActive && (
          <span className="hidden md:inline text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
            ECO
          </span>
        )}
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[9990] flex items-center justify-center p-4 bg-slate-950/75"
            onClick={() => setOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[530px] max-h-[85vh] flex flex-col rounded-2xl border border-slate-200 dark:border-cyan-500/30 bg-white dark:bg-[#070B14] shadow-[0_25px_70px_rgba(0,0,0,0.65)] overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#0B1120]">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center">
                    <MonitorSmartphone className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="text-[11px] font-black tracking-wider uppercase text-slate-900 dark:text-white">
                      Device &amp; Connection Monitor
                    </h3>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      Thermal Guard • Live Ping • Mobile / Tablet App Mode
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
                  aria-label="Close device monitor"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <DeviceTelemetryPanel active={open} clientOnly={true} />
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default ClientDeviceWidget;
