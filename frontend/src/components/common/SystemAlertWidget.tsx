/**
 * SystemAlertWidget — SaaS Infrastructure & Incident Observability Console
 * =========================================================================
 * Production-grade Owner/SRE monitoring workspace:
 *  - Live Incident Feed with Redis persistence, severity KPI filters, search,
 *    service filters, acknowledge/resolve actions, and full stack-trace inspector.
 *  - Chronologically merged Multi-Service Live Log Stream with severity filters,
 *    keyword search, pause/resume, line wrap, copy, and .log export.
 *  - Real-time Infrastructure Health bar (PostgreSQL, Redis, Celery, WS, Exchange RTT)
 *    and integrated VPS Hardware & Latency Guard telemetry.
 *  - Draggable compact mode + expandable wide operations mode + mobile responsive sheet.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Database,
  Download,
  Expand,
  FlaskConical,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  WrapText,
  X,
  XCircle,
} from 'lucide-react';
import { useSystemAlerts, type SystemAlert, type AlertSeverity } from '@/hooks/useSystemAlerts';
import { useTheme } from '@/context/ThemeContext';
import { useLatencyGuard } from '@/context/LatencyGuardContext';
import DeviceTelemetryPanel from '@/components/common/DeviceTelemetryPanel';
import {
  systemService,
  type SystemHealth,
  type ContainerLogBatchRecord,
  type ContainerLogLine,
} from '@/services/systemService';
import { buildAuthenticatedWsUrl } from '@/utils/wsAuth';

// ─── Config & Helpers ─────────────────────────────────────────────────────────

type TabId = 'incidents' | 'logs' | 'telemetry';
type IncidentStatusFilter = 'active' | 'all' | 'resolved';
type LogLevelFilter = 'ALL' | 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO';

const SEVERITY_META: Record<
  AlertSeverity,
  {
    label: string;
    pill: string;
    dot: string;
    accentBar: string;
    cardBorder: string;
    Icon: React.FC<{ className?: string }>;
  }
> = {
  CRITICAL: {
    label: 'Critical',
    pill: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
    dot: 'bg-rose-500',
    accentBar: 'bg-rose-500',
    cardBorder: 'border-rose-200/90 dark:border-rose-500/25 hover:border-rose-400/60 dark:hover:border-rose-500/45',
    Icon: AlertOctagon,
  },
  ERROR: {
    label: 'Error',
    pill: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
    dot: 'bg-orange-500',
    accentBar: 'bg-orange-500',
    cardBorder: 'border-orange-200/90 dark:border-orange-500/25 hover:border-orange-400/60 dark:hover:border-orange-500/45',
    Icon: XCircle,
  },
  WARNING: {
    label: 'Warning',
    pill: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    dot: 'bg-amber-500',
    accentBar: 'bg-amber-500',
    cardBorder: 'border-amber-200/90 dark:border-amber-500/25 hover:border-amber-400/60 dark:hover:border-amber-500/45',
    Icon: AlertTriangle,
  },
};

const SERVICE_META: Record<string, { short: string; label: string; badge: string }> = {
  cosmoquant_backend:          { short: 'API',   label: 'Backend API',    badge: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30' },
  cosmo_celery_worker:         { short: 'CLR',   label: 'Celery Worker',  badge: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30' },
  cosmo_celery_worker_default: { short: 'CLR',   label: 'Celery Default', badge: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30' },
  cosmo_celery_worker_heavy:   { short: 'HVY',   label: 'Celery Heavy',   badge: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30' },
  cosmo_celery_beat:           { short: 'BEAT',  label: 'Celery Beat',    badge: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30' },
  cosmo_telegram_bot:          { short: 'BOT',   label: 'Telegram Bot',   badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30' },
  cosmoquant_redis:            { short: 'REDIS', label: 'Redis Cache',    badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30' },
  cosmoquant_db:               { short: 'DB',    label: 'PostgreSQL',     badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
  cosmoquant_frontend:         { short: 'WEB',   label: 'Frontend',       badge: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30' },
  cosmoquant_nginx:            { short: 'NGX',   label: 'Nginx Proxy',    badge: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30' },
  network_latency:             { short: 'NET',   label: 'Exchange Link',  badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30' },
};

const getServiceMeta = (container: string, fallbackDisplay?: string) =>
  SERVICE_META[container] || {
    short: (fallbackDisplay || container).slice(0, 4).toUpperCase(),
    label: fallbackDisplay || container,
    badge: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30',
  };

const formatRelativeTime = (iso: string): string => {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (!Number.isFinite(diffSec)) return '';
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const formatExactTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
};

const getHeadline = (alert: SystemAlert): string => {
  if (alert.snippet && alert.snippet.length > 0) {
    const first = alert.snippet[0];
    if (first.toLowerCase().includes('traceback (most recent call last)') && alert.snippet.length > 1) {
      return alert.snippet[alert.snippet.length - 1];
    }
    return first;
  }
  return alert.message?.split('\n')[0] || 'Server incident detected';
};

const getCenterPos = (w: number, h: number) => {
  if (typeof window === 'undefined') return { x: 80, y: 64 };
  const clampedW = Math.min(w, window.innerWidth - 24);
  const clampedH = Math.min(h, window.innerHeight - 24);
  return {
    x: Math.max(12, Math.round((window.innerWidth - clampedW) / 2)),
    y: Math.max(12, Math.round((window.innerHeight - clampedH) / 2)),
  };
};

// ─── Actionable SaaS Incident Toast ───────────────────────────────────────────

const IncidentToast: React.FC<{
  alert: SystemAlert;
  onInspect: () => void;
  onClose: () => void;
}> = ({ alert, onInspect, onClose }) => {
  const meta = SEVERITY_META[alert.severity];
  const svc = getServiceMeta(alert.container, alert.display_name);
  const Icon = meta.Icon;

  useEffect(() => {
    const t = setTimeout(onClose, 8000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="w-[340px] max-w-[calc(100vw-24px)] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1120] shadow-2xl overflow-hidden transition-all duration-200">
      <div className={`h-1 w-full ${meta.accentBar}`} />
      <div className="p-3.5 flex items-start gap-3">
        <div className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 mt-0.5 ${meta.pill}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${meta.pill}`}>
              {meta.label}
            </span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${svc.badge}`}>
              {svc.short}
            </span>
            <span className="text-[10px] font-mono text-slate-400 ml-auto">{formatExactTime(alert.timestamp)}</span>
          </div>
          <p className="text-xs font-medium text-slate-800 dark:text-slate-100 mt-1.5 line-clamp-2 break-words leading-snug">
            {getHeadline(alert)}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={onInspect}
              className="text-[10px] font-bold text-cyan-600 dark:text-cyan-400 hover:underline cursor-pointer"
            >
              Inspect Incident →
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-[10px] font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ml-auto cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Incident Detail Inspector Modal ──────────────────────────────────────────

const IncidentInspectorModal: React.FC<{
  alert: SystemAlert;
  onAcknowledge: (id: string) => void;
  onClose: () => void;
}> = ({ alert, onAcknowledge, onClose }) => {
  const meta = SEVERITY_META[alert.severity];
  const svc = getServiceMeta(alert.container, alert.display_name);
  const Icon = meta.Icon;
  const [copied, setCopied] = useState<'stack' | 'json' | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copyText = async (text: string, kind: 'stack' | 'json') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // ignore
    }
  };

  const fullTimestamp = new Date(alert.timestamp).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#070B14] shadow-2xl overflow-hidden">
        <div className={`h-1 w-full ${meta.accentBar}`} />

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 ${meta.pill}`}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${meta.pill}`}>
                  {meta.label}
                </span>
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border ${svc.badge}`}>
                  {svc.label}
                </span>
                {alert.acknowledged && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                    <CheckCircle2 className="w-3 h-3" /> Resolved
                  </span>
                )}
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-1.5 break-words leading-snug">
                {getHeadline(alert)}
              </h3>
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1">
                {fullTimestamp} · ID {alert.id.slice(-10)}
                {alert.logger ? ` · ${alert.logger}` : ''}
                {alert.source ? ` · ${alert.source}` : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Close incident inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          {alert.snippet.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Stack Trace &amp; Context ({alert.snippet.length} lines)
                </span>
                <button
                  type="button"
                  onClick={() => void copyText(alert.snippet.join('\n'), 'stack')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-600 dark:text-slate-300 hover:border-cyan-500/50 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors cursor-pointer"
                >
                  {copied === 'stack' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  {copied === 'stack' ? 'Copied' : 'Copy Trace'}
                </button>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-100 p-3.5 font-mono text-[11px] leading-relaxed overflow-x-auto space-y-0.5">
                {alert.snippet.map((line, idx) => (
                  <div key={idx} className="flex items-start gap-3">
                    <span className="text-slate-600 select-none w-5 text-right flex-shrink-0">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span
                      className={`whitespace-pre-wrap break-all ${
                        idx === alert.snippet.length - 1 && alert.snippet.length > 1
                          ? 'text-rose-300 font-semibold'
                          : 'text-slate-200'
                      }`}
                    >
                      {line}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {alert.message && (
            <div className="space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                Full Payload Message
              </span>
              <pre className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] p-3.5 font-mono text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words max-h-52 overflow-y-auto leading-relaxed">
                {alert.message}
              </pre>
            </div>
          )}

          {/* Metadata strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] px-3 py-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Service</span>
              <span className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 truncate block">
                {alert.container}
              </span>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] px-3 py-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Source</span>
              <span className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 truncate block">
                {alert.source || 'live_handler'}
              </span>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] px-3 py-2 col-span-2 sm:col-span-1">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Status</span>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                {alert.acknowledged ? 'Acknowledged' : 'Active Incident'}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]">
          <button
            type="button"
            onClick={() => void copyText(JSON.stringify(alert, null, 2), 'json')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
          >
            {copied === 'json' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            {copied === 'json' ? 'JSON Copied' : 'Copy JSON'}
          </button>

          <div className="flex items-center gap-2">
            {!alert.acknowledged && (
              <button
                type="button"
                onClick={() => onAcknowledge(alert.id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Mark Resolved
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

// ─── Live Log Stream Terminal (Chronological Multi-Service) ───────────────────

const LogStreamView: React.FC<{
  batches: Map<string, ContainerLogBatchRecord>;
  logConn: boolean;
  paused: boolean;
  onTogglePause: () => void;
  onClearLocal: () => void;
}> = ({ batches, logConn, paused, onTogglePause, onClearLocal }) => {
  const [serviceFilter, setServiceFilter] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>('ALL');
  const [query, setQuery] = useState('');
  const [wrapLines, setWrapLines] = useState(true);
  const [copied, setCopied] = useState(false);

  const containers = useMemo(() => Array.from(batches.keys()).sort(), [batches]);

  const serviceErrorCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [key, batch] of batches.entries()) {
      const errCount = batch.lines.filter((l) => l.level === 'ERROR' || l.level === 'CRITICAL').length;
      counts.set(key, errCount);
    }
    return counts;
  }, [batches]);

  const mergedLines = useMemo(() => {
    const list: Array<{
      key: string;
      container: string;
      display: string;
      line: string;
      level: ContainerLogLine['level'];
      sortTs: number;
    }> = [];
    const selectedBatches = serviceFilter
      ? batches.has(serviceFilter)
        ? [batches.get(serviceFilter)!]
        : []
      : Array.from(batches.values());

    for (const batch of selectedBatches) {
      const batchTs = new Date(batch.timestamp).getTime() || 0;
      batch.lines.forEach((l, idx) => {
        const lineTs = l.ts ? new Date(l.ts).getTime() : batchTs + idx;
        list.push({
          key: `${batch.container}-${idx}-${lineTs}`,
          container: batch.container,
          display: batch.display_name,
          line: l.line,
          level: l.level,
          sortTs: Number.isFinite(lineTs) ? lineTs : batchTs + idx,
        });
      });
    }

    // Newest first across all services
    list.sort((a, b) => b.sortTs - a.sortTs);

    const q = query.trim().toLowerCase();
    return list.filter((item) => {
      if (levelFilter !== 'ALL' && item.level !== levelFilter) return false;
      if (q && !item.line.toLowerCase().includes(q) && !item.container.toLowerCase().includes(q)) return false;
      return true;
    }).slice(0, 300);
  }, [batches, serviceFilter, levelFilter, query]);

  const handleCopy = async () => {
    try {
      const text = mergedLines.map((l) => `[${getServiceMeta(l.container, l.display).short}] [${l.level}] ${l.line}`).join('\n');
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  const handleExport = () => {
    const text = mergedLines.map((l) => `[${getServiceMeta(l.container, l.display).short}] [${l.level}] ${l.line}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cosmocore-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const levelBadgeClass: Record<ContainerLogLine['level'], string> = {
    CRITICAL: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    ERROR: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
    WARNING: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    INFO: 'bg-slate-700/60 text-slate-300 border-slate-600/50',
  };

  const lineTextClass: Record<ContainerLogLine['level'], string> = {
    CRITICAL: 'text-rose-300 font-semibold',
    ERROR: 'text-orange-200',
    WARNING: 'text-amber-200/95',
    INFO: 'text-slate-300/90',
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Controls Toolbar */}
      <div className="flex-shrink-0 px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]/90 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter log lines or service..."
              className="w-full h-8 pl-8 pr-7 rounded-lg text-xs bg-white dark:bg-[#070B14] border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500/60"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Severity level segmented filter */}
          <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#070B14] p-0.5">
            {(['ALL', 'CRITICAL', 'ERROR', 'WARNING', 'INFO'] as LogLevelFilter[]).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setLevelFilter(lvl)}
                className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                  levelFilter === lvl
                    ? lvl === 'CRITICAL'
                      ? 'bg-rose-600 text-white'
                      : lvl === 'ERROR'
                        ? 'bg-orange-600 text-white'
                        : lvl === 'WARNING'
                          ? 'bg-amber-600 text-white'
                          : 'bg-cyan-600 text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {lvl === 'CRITICAL' ? 'CRIT' : lvl === 'WARNING' ? 'WARN' : lvl}
              </button>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onTogglePause}
              title={paused ? 'Resume live stream' : 'Pause live stream'}
              className={`h-8 px-2.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1 transition-colors cursor-pointer ${
                paused
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-300'
                  : 'bg-white dark:bg-[#070B14] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-cyan-500/40'
              }`}
            >
              {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              <span className="hidden sm:inline">{paused ? 'Paused' : 'Live'}</span>
            </button>
            <button
              type="button"
              onClick={() => setWrapLines((v) => !v)}
              title="Toggle line wrapping"
              className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors cursor-pointer ${
                wrapLines
                  ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-600 dark:text-cyan-300'
                  : 'bg-white dark:bg-[#070B14] border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
              }`}
            >
              <WrapText className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void handleCopy()}
              title="Copy visible logs"
              className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#070B14] text-slate-500 dark:text-slate-400 hover:text-cyan-500 flex items-center justify-center transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={handleExport}
              title="Download .log file"
              className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#070B14] text-slate-500 dark:text-slate-400 hover:text-cyan-500 flex items-center justify-center transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onClearLocal}
              title="Clear log buffer"
              className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#070B14] text-slate-500 dark:text-slate-400 hover:text-rose-500 flex items-center justify-center transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Service Filter Pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setServiceFilter(null)}
            className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border transition-colors cursor-pointer ${
              serviceFilter === null
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-transparent'
                : 'bg-white dark:bg-[#070B14] text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            All Services ({containers.length})
          </button>
          {containers.map((c) => {
            const svc = getServiceMeta(c);
            const errs = serviceErrorCounts.get(c) || 0;
            const active = serviceFilter === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setServiceFilter(active ? null : c)}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase border transition-colors cursor-pointer ${
                  active
                    ? svc.badge
                    : 'bg-white dark:bg-[#070B14] text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span>{svc.short}</span>
                {errs > 0 && (
                  <span className="px-1 rounded-sm bg-rose-500 text-white text-[8.5px] leading-tight">
                    {errs}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Terminal Output */}
      <div className="flex-1 min-h-0 overflow-auto bg-[#060913] text-slate-200 p-3 font-mono text-[11px] space-y-0.5 scrollbar-thin">
        {mergedLines.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center py-10">
            <div className="w-11 h-11 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-300">
                {batches.size === 0
                  ? logConn
                    ? 'Connected — awaiting service log stream...'
                    : 'Connecting to live log stream...'
                  : 'No log lines match the active filter'}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Multi-service logs stream automatically every 2 seconds
              </p>
            </div>
          </div>
        ) : (
          mergedLines.map(({ key, container, display, line, level }) => {
            const svc = getServiceMeta(container, display);
            return (
              <div
                key={key}
                className={`flex items-start gap-2 px-2 py-1 rounded-md hover:bg-white/[0.04] transition-colors ${
                  level === 'CRITICAL'
                    ? 'bg-rose-500/10'
                    : level === 'ERROR'
                      ? 'bg-orange-500/[0.07]'
                      : ''
                }`}
              >
                <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold border ${svc.badge}`}>
                  {svc.short}
                </span>
                <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold border ${levelBadgeClass[level]}`}>
                  {level === 'CRITICAL' ? 'CRIT' : level === 'WARNING' ? 'WARN' : level}
                </span>
                <span className={`leading-relaxed ${wrapLines ? 'break-all whitespace-pre-wrap' : 'whitespace-nowrap'} ${lineTextClass[level]}`}>
                  {line}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// ─── Main SaaS System Monitor Widget ──────────────────────────────────────────

const SystemAlertWidget: React.FC = () => {
  const {
    alerts: wsAlerts,
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
  } = useSystemAlerts();

  const {
    latencyAlerts,
    unreadLatencyCount,
    latestTransitionAlert,
    severity: latencySeverity,
    shouldWarn: isLatencyWarning,
    shouldProtect: isLatencyGuarded,
    clientToVpsMs,
    markLatencyAlertsRead,
    clearLatencyAlerts,
    dismissTransitionAlert,
  } = useLatencyGuard();

  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Panel state
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<TabId>('incidents');
  const [inspectedAlert, setInspectedAlert] = useState<SystemAlert | null>(null);
  const [toasts, setToasts] = useState<SystemAlert[]>([]);

  // Incident filters
  const [sevFilter, setSevFilter] = useState<AlertSeverity | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<IncidentStatusFilter>('active');
  const [containerFilter, setContainerFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [testingAlert, setTestingAlert] = useState(false);

  // Live infrastructure health bar
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // Container logs WS state
  const [logBatches, setLogBatches] = useState<Map<string, ContainerLogBatchRecord>>(new Map());
  const [logConn, setLogConn] = useState(false);
  const [logsPaused, setLogsPaused] = useState(false);
  const logsPausedRef = useRef(false);
  logsPausedRef.current = logsPaused;
  const logWsRef = useRef<WebSocket | null>(null);

  // Dragging state (compact floating mode only)
  const modalW = expanded ? 1040 : 740;
  const modalH = expanded ? 740 : 600;
  const [position, setPosition] = useState(() => getCenterPos(740, 600));
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, curX: 0, curY: 0 });
  const rafRef = useRef<number | null>(null);

  // Merge WS persisted alerts + local latency alerts cleanly
  const alerts = useMemo(() => {
    const wsNetworkTs = wsAlerts
      .filter((a) => a.container === 'network_latency')
      .map((a) => new Date(a.timestamp).getTime());
    const dedupedLatency = latencyAlerts.filter((la) => {
      const laTs = new Date(la.timestamp).getTime();
      return !wsNetworkTs.some((wt) => Math.abs(wt - laTs) < 20000);
    });
    const combined = [...wsAlerts, ...dedupedLatency];
    combined.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return combined.slice(0, 150);
  }, [wsAlerts, latencyAlerts]);

  // Show actionable toast ONLY for newly arriving live CRITICAL/ERROR alerts (never historical replays)
  useEffect(() => {
    if (!latestLiveAlert) return;
    if (latestLiveAlert.severity === 'CRITICAL' || latestLiveAlert.severity === 'ERROR') {
      setToasts((prev) =>
        prev.some((t) => t.id === latestLiveAlert.id) ? prev : [latestLiveAlert, ...prev].slice(0, 3)
      );
    }
    dismissLiveAlert();
  }, [latestLiveAlert, dismissLiveAlert]);

  useEffect(() => {
    if (!latestTransitionAlert) return;
    setToasts((prev) =>
      prev.some((t) => t.id === latestTransitionAlert.id) ? prev : [latestTransitionAlert, ...prev].slice(0, 3)
    );
    dismissTransitionAlert();
  }, [latestTransitionAlert, dismissTransitionAlert]);

  // Fetch system health bar when panel is open (properly parses 503 degraded/unhealthy payloads!)
  const [healthError, setHealthError] = useState(false);
  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const data = await systemService.getSystemHealth();
      setHealth(data);
      setHealthError(false);
    } catch (err: unknown) {
      const respData = (err as { response?: { data?: SystemHealth } })?.response?.data;
      if (respData && respData.services) {
        setHealth(respData);
        setHealthError(false);
      } else {
        setHealth(null);
        setHealthError(true);
      }
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void fetchHealth();
    const timer = setInterval(() => void fetchHealth(), 30000);
    return () => clearInterval(timer);
  }, [open, fetchHealth]);

  // Recenter when opening or toggling expanded mode
  useEffect(() => {
    if (open) {
      setPosition(getCenterPos(modalW, modalH));
    }
  }, [open, modalW, modalH]);

  // Close on Escape (when inspector is not open)
  useEffect(() => {
    if (!open || inspectedAlert) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, inspectedAlert]);

  // Live logs snapshot + WebSocket when on 'logs' tab
  useEffect(() => {
    if (!open || tab !== 'logs') {
      setLogConn(false);
      if (logWsRef.current) {
        logWsRef.current.onclose = null;
        logWsRef.current.close();
        logWsRef.current = null;
      }
      return;
    }

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Instant REST snapshot fallback so logs render immediately
    systemService
      .getContainerLogsSnapshot()
      .then((res) => {
        if (!alive || !res?.batches) return;
        setLogBatches((prev) => {
          const next = new Map(prev);
          for (const b of res.batches) {
            if (b?.container) next.set(b.container, b);
          }
          return next;
        });
      })
      .catch(() => {});

    const connect = async () => {
      if (!alive || logWsRef.current?.readyState === WebSocket.OPEN) return;
      const url = await buildAuthenticatedWsUrl('/ws/container-logs');
      if (!url) {
        if (alive) timer = setTimeout(connect, 4000);
        return;
      }
      if (!alive) return;

      const ws = new WebSocket(url);
      logWsRef.current = ws;
      ws.onopen = () => {
        if (alive) setLogConn(true);
      };
      ws.onclose = () => {
        if (logWsRef.current === ws) logWsRef.current = null;
        if (!alive) return;
        setLogConn(false);
        timer = setTimeout(connect, 5000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        if (!alive || logsPausedRef.current) return;
        try {
          const d = JSON.parse(e.data);
          if (d.type !== 'container_logs' || !d.container) return;
          setLogBatches((prev) => {
            const next = new Map(prev);
            next.set(d.container, d);
            return next;
          });
        } catch {
          // ignore
        }
      };
    };

    void connect();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      if (logWsRef.current) {
        logWsRef.current.onclose = null;
        logWsRef.current.close();
        logWsRef.current = null;
      }
      setLogConn(false);
    };
  }, [open, tab]);

  // Smooth RAF pointer dragging
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      const cx = e.clientX;
      const cy = e.clientY;
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const dx = cx - dragRef.current.startX;
        const dy = cy - dragRef.current.startY;
        const curW = Math.min(modalW, window.innerWidth - 24);
        const curH = Math.min(modalH, window.innerHeight - 24);
        const maxX = Math.max(0, window.innerWidth - curW);
        const maxY = Math.max(0, window.innerHeight - curH);
        setPosition({
          x: Math.max(0, Math.min(maxX, dragRef.current.curX + dx)),
          y: Math.max(0, Math.min(maxY, dragRef.current.curY + dy)),
        });
      });
    };
    const onUp = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setIsDragging(false);
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [isDragging, modalW, modalH]);

  const handleHeaderPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select')) return;
    setIsDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, curX: position.x, curY: position.y };
  };

  const handleToggleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        markAllRead();
        markLatencyAlertsRead();
      }
      return next;
    });
  };

  const handleTestAlert = async () => {
    setTestingAlert(true);
    try {
      await sendTestAlert();
    } catch {
      // ignore
    } finally {
      setTestingAlert(false);
    }
  };

  // KPI counts
  const activeAlerts = useMemo(() => alerts.filter((a) => !a.acknowledged), [alerts]);
  const resolvedCount = alerts.length - activeAlerts.length;
  const criticalCount = activeAlerts.filter((a) => a.severity === 'CRITICAL').length;
  const errorCount = activeAlerts.filter((a) => a.severity === 'ERROR').length;
  const warningCount = activeAlerts.filter((a) => a.severity === 'WARNING').length;

  const uniqueContainers = useMemo(
    () => Array.from(new Set(alerts.map((a) => a.container))).sort(),
    [alerts]
  );

  const filteredAlerts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return alerts.filter((a) => {
      if (statusFilter === 'active' && a.acknowledged) return false;
      if (statusFilter === 'resolved' && !a.acknowledged) return false;
      if (sevFilter !== 'ALL' && a.severity !== sevFilter) return false;
      if (containerFilter !== 'ALL' && a.container !== containerFilter) return false;
      if (q) {
        const hay = `${a.container} ${a.display_name} ${a.logger || ''} ${a.message} ${a.snippet.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [alerts, statusFilter, sevFilter, containerFilter, searchQuery]);

  const totalUnread = unreadCount + unreadLatencyCount;
  const activeSevereCount = criticalCount + errorCount;
  const hasCritical = criticalCount > 0 || latencySeverity === 'critical' || latencySeverity === 'unreachable';
  const hasAttention = totalUnread > 0 || activeSevereCount > 0 || isLatencyWarning;

  const fallbackHealthState = healthError ? 'offline' : 'checking';
  const infraItems = [
    {
      label: 'PostgreSQL',
      status: health?.services.database || fallbackHealthState,
      Icon: Database,
    },
    {
      label: 'Redis',
      status: health?.services.redis || fallbackHealthState,
      Icon: Server,
    },
    {
      label: 'Workers',
      status: health?.services.celery_worker || fallbackHealthState,
      Icon: Cpu,
    },
    {
      label: 'Alert WS',
      status: connected ? 'online' : 'offline',
      Icon: Radio,
    },
  ];

  const getStatusDotClass = (status: string) => {
    if (status === 'online' || status === 'healthy') return 'bg-emerald-500';
    if (status === 'checking') return 'bg-slate-400 animate-pulse';
    if (status === 'degraded') return 'bg-amber-500';
    return 'bg-rose-500';
  };

  return (
    <>
      {/* ─── Actionable Incident Toasts ─── */}
      {toasts.length > 0 &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed top-4 right-4 z-[99990] flex flex-col gap-2 pointer-events-auto">
            {toasts.map((t) => (
              <IncidentToast
                key={t.id}
                alert={t}
                onInspect={() => {
                  setToasts((p) => p.filter((x) => x.id !== t.id));
                  setOpen(true);
                  setTab('incidents');
                  setInspectedAlert(t);
                  markAllRead();
                }}
                onClose={() => setToasts((p) => p.filter((x) => x.id !== t.id))}
              />
            ))}
          </div>,
          document.body
        )}

      {/* ─── Incident Inspector Modal ─── */}
      {inspectedAlert && (
        <IncidentInspectorModal
          alert={inspectedAlert}
          onAcknowledge={(id) => {
            void acknowledgeAlert(id);
            setInspectedAlert((curr) => (curr && curr.id === id ? { ...curr, acknowledged: true } : curr));
          }}
          onClose={() => setInspectedAlert(null)}
        />
      )}

      {/* ─── Header Trigger Pill ─── */}
      <button
        id="system-alert-widget-trigger"
        type="button"
        onClick={handleToggleOpen}
        className={`relative flex items-center gap-2 px-2.5 sm:px-3 h-9 rounded-xl border transition-all cursor-pointer select-none whitespace-nowrap ${
          open
            ? 'ring-2 ring-cyan-500/35 border-cyan-500/50 bg-cyan-500/10 dark:bg-[#0D1A2D]'
            : hasAttention
              ? hasCritical
                ? 'border-rose-400/60 dark:border-rose-500/45 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100/80 dark:hover:bg-rose-950/45'
                : 'border-amber-400/60 dark:border-amber-500/45 bg-amber-50 dark:bg-amber-950/25 hover:bg-amber-100/80 dark:hover:bg-amber-950/40'
              : 'border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-[#0B1120] hover:border-cyan-500/40'
        }`}
        title={
          isLatencyWarning
            ? `Network Latency Warning (${latencySeverity.toUpperCase()})${isLatencyGuarded ? ' • Execution Guard Active' : ''}`
            : 'System Monitor — Incidents, Live Logs & VPS Telemetry'
        }
      >
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            hasCritical
              ? 'bg-rose-500 animate-pulse'
              : hasAttention
                ? 'bg-amber-500'
                : connected
                  ? 'bg-emerald-500'
                  : 'bg-slate-400'
          }`}
        />

        {hasCritical ? (
          <ShieldAlert className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
        ) : (
          <Activity
            className={`w-3.5 h-3.5 flex-shrink-0 ${
              hasAttention ? 'text-amber-500' : 'text-cyan-600 dark:text-cyan-400'
            }`}
          />
        )}

        <span
          className={`text-[11px] font-bold tracking-wide hidden sm:inline ${
            hasCritical
              ? 'text-rose-700 dark:text-rose-300'
              : hasAttention
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-slate-700 dark:text-slate-200'
          }`}
        >
          {totalUnread > 0
            ? `${totalUnread} Incident${totalUnread > 1 ? 's' : ''}`
            : activeSevereCount > 0
              ? `${activeSevereCount} Active`
              : isLatencyWarning
                ? 'Latency'
                : 'Sys Monitor'}
        </span>

        {totalUnread > 0 ? (
          <span
            className={`min-w-[18px] h-[18px] px-1 text-white text-[9.5px] font-bold rounded-full flex items-center justify-center ${
              hasCritical ? 'bg-rose-600' : 'bg-amber-600'
            }`}
          >
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        ) : isLatencyWarning ? (
          <span
            className={`px-1.5 py-0.5 text-[8.5px] font-bold rounded uppercase text-white ${
              hasCritical ? 'bg-rose-600' : 'bg-amber-600'
            }`}
          >
            {isLatencyGuarded ? 'GUARD' : 'LAG'}
          </span>
        ) : connected ? (
          <span className="hidden xl:inline-flex px-1.5 py-0.5 text-[9px] font-mono font-bold rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25">
            OK
          </span>
        ) : null}
      </button>

      {/* ─── SaaS Observability Command Center Window ─── */}
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            id="system-alert-floating-window"
            className="fixed z-[9990] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#070B14] shadow-[0_24px_70px_rgba(2,6,23,0.45)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.85)] overflow-hidden"
            style={{
              top: `${position.y}px`,
              left: `${position.x}px`,
              width: `min(${modalW}px, calc(100vw - 24px))`,
              height: `min(${modalH}px, calc(100vh - 24px))`,
              willChange: isDragging ? 'top, left' : 'auto',
            }}
          >
            {/* Top Brand Accent */}
            <div className="h-[2px] w-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-500 flex-shrink-0" />

            {/* ── Title Bar (Draggable) ── */}
            <div
              onPointerDown={handleHeaderPointerDown}
              className={`flex-shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800/90 bg-slate-50/90 dark:bg-[#0B1120] select-none touch-none ${
                isDragging ? 'cursor-grabbing' : 'cursor-grab'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 border border-cyan-500/30 flex items-center justify-center flex-shrink-0">
                  <Activity className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight truncate">
                      System Monitor
                    </h2>
                    <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      {captureMode === 'docker_socket' ? 'Docker Daemon' : 'Live Hooks'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    Real-time error detection, multi-service logs &amp; VPS telemetry
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span
                  className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-mono font-bold uppercase ${
                    connected
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                  {connected ? 'Stream Live' : 'Reconnecting'}
                </span>

                <button
                  type="button"
                  onClick={() => {
                    void refreshHistory();
                    void fetchHealth();
                  }}
                  title="Refresh incidents & infrastructure health"
                  className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#070B14] text-slate-500 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 flex items-center justify-center transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${healthLoading ? 'animate-spin' : ''}`} />
                </button>

                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  title={expanded ? 'Compact window' : 'Expand operations workspace'}
                  className="hidden sm:flex w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#070B14] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white items-center justify-center transition-colors cursor-pointer"
                >
                  {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </button>

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  title="Close System Monitor"
                  className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#070B14] text-slate-500 dark:text-slate-400 hover:text-rose-500 flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* ── Live Infrastructure Health Strip ── */}
            <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 py-2 border-b border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#080D18] overflow-x-auto hide-scrollbar">
              <div className="flex items-center gap-2">
                {infraItems.map(({ label, status, Icon }) => (
                  <div
                    key={label}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] text-[10px] font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${getStatusDotClass(status)}`} />
                    <Icon className="w-3 h-3 text-slate-400" />
                    <span>{label}</span>
                    <span className="font-mono text-[9.5px] uppercase text-slate-400">{status}</span>
                  </div>
                ))}
              </div>
              {clientToVpsMs !== null && (
                <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200/80 dark:border-slate-800 text-[10px] font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap flex-shrink-0">
                  <span>RTT</span>
                  <span
                    className={`font-bold ${
                      clientToVpsMs <= 300
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : clientToVpsMs < 900
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {Math.round(clientToVpsMs)}ms
                  </span>
                </div>
              )}
            </div>

            {/* ── Navigation Tabs ── */}
            <div className="flex-shrink-0 flex items-center gap-1 px-4 pt-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-[#090E1A]">
              {(
                [
                  { id: 'incidents', label: 'Incidents', icon: ShieldAlert, badge: activeAlerts.length },
                  { id: 'logs', label: 'Live Logs', icon: Terminal, badge: logBatches.size || undefined },
                  { id: 'telemetry', label: 'VPS & Latency', icon: Server, badge: undefined },
                ] as const
              ).map(({ id, label, icon: TabIcon, badge }) => {
                const isActive = tab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={`relative inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer border-b-2 -mb-px ${
                      isActive
                        ? 'border-cyan-500 text-cyan-700 dark:text-cyan-300'
                        : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    <TabIcon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                    {badge !== undefined && badge > 0 && (
                      <span
                        className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                          id === 'incidents' && activeSevereCount > 0
                            ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* ── Tab Body ── */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-white dark:bg-[#070B14]">
              {tab === 'incidents' ? (
                <>
                  {/* KPI Severity Filter Cards */}
                  <div className="flex-shrink-0 grid grid-cols-4 gap-2 px-4 py-3 border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/40 dark:bg-[#090E1A]/60">
                    {(
                      [
                        {
                          key: 'CRITICAL' as const,
                          label: 'Critical',
                          val: criticalCount,
                          activeRing: 'border-rose-500/60 bg-rose-500/10',
                          numColor: criticalCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400 dark:text-slate-500',
                        },
                        {
                          key: 'ERROR' as const,
                          label: 'Errors',
                          val: errorCount,
                          activeRing: 'border-orange-500/60 bg-orange-500/10',
                          numColor: errorCount > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-slate-400 dark:text-slate-500',
                        },
                        {
                          key: 'WARNING' as const,
                          label: 'Warnings',
                          val: warningCount,
                          activeRing: 'border-amber-500/60 bg-amber-500/10',
                          numColor: warningCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500',
                        },
                      ] as const
                    ).map((kpi) => {
                      const selected = sevFilter === kpi.key && statusFilter !== 'resolved';
                      return (
                        <button
                          key={kpi.key}
                          type="button"
                          onClick={() => {
                            setStatusFilter('active');
                            setSevFilter(selected ? 'ALL' : kpi.key);
                          }}
                          className={`rounded-xl border px-3 py-2 text-left transition-all cursor-pointer ${
                            selected
                              ? kpi.activeRing
                              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1120] hover:border-slate-300 dark:hover:border-slate-700'
                          }`}
                        >
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                            {kpi.label}
                          </span>
                          <span className={`text-lg font-mono font-black tabular-nums leading-tight ${kpi.numColor}`}>
                            {kpi.val}
                          </span>
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => {
                        setSevFilter('ALL');
                        setStatusFilter(statusFilter === 'resolved' ? 'active' : 'resolved');
                      }}
                      className={`rounded-xl border px-3 py-2 text-left transition-all cursor-pointer ${
                        statusFilter === 'resolved'
                          ? 'border-emerald-500/60 bg-emerald-500/10'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1120] hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                        Resolved
                      </span>
                      <span className="text-lg font-mono font-black tabular-nums leading-tight text-emerald-600 dark:text-emerald-400">
                        {resolvedCount}
                      </span>
                    </button>
                  </div>

                  {/* Filter & Actions Bar */}
                  <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-slate-200/80 dark:border-slate-800/80 flex-wrap">
                    <div className="relative flex-1 min-w-[160px]">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search error message, traceback, logger..."
                        className="w-full h-8 pl-8 pr-7 rounded-lg text-xs bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500/60"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {uniqueContainers.length > 0 && (
                      <select
                        value={containerFilter}
                        onChange={(e) => setContainerFilter(e.target.value)}
                        className="h-8 px-2.5 rounded-lg text-xs font-medium bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:border-cyan-500/60 cursor-pointer"
                      >
                        <option value="ALL">All Services</option>
                        {uniqueContainers.map((c) => (
                          <option key={c} value={c}>
                            {getServiceMeta(c).label}
                          </option>
                        ))}
                      </select>
                    )}

                    <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] p-0.5">
                      {(['active', 'all', 'resolved'] as IncidentStatusFilter[]).map((st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setStatusFilter(st)}
                          className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                            statusFilter === st
                              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleTestAlert()}
                      disabled={testingAlert}
                      title="Emit a synthetic test alert to verify Redis persistence + WebSocket delivery"
                      className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 hover:border-cyan-500/50 hover:text-cyan-600 dark:hover:text-cyan-300 inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <FlaskConical className="w-3 h-3" />
                      <span>Test</span>
                    </button>

                    {activeAlerts.length > 0 && (
                      <button
                        type="button"
                        onClick={() => void acknowledgeAllAlerts()}
                        title="Mark all active incidents as resolved"
                        className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 hover:border-emerald-500/40 hover:text-emerald-600 dark:hover:text-emerald-400 inline-flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Resolve All</span>
                      </button>
                    )}

                    {alerts.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          void clearAlerts();
                          clearLatencyAlerts();
                        }}
                        title="Clear all stored incidents"
                        className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 hover:border-rose-500/40 hover:text-rose-600 dark:hover:text-rose-400 inline-flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Clear</span>
                      </button>
                    )}
                  </div>

                  {/* Incident Cards List */}
                  <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5 scrollbar-thin">
                    {loadingHistory && alerts.length === 0 ? (
                      <div className="space-y-2.5">
                        {[0, 1, 2].map((i) => (
                          <div
                            key={i}
                            className="h-20 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-[#0B1120] animate-pulse"
                          />
                        ))}
                      </div>
                    ) : filteredAlerts.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center py-10 gap-3">
                        <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
                          <ShieldCheck className="w-7 h-7 text-emerald-500" />
                        </div>
                        <div className="max-w-sm">
                          <p className="text-sm font-bold text-slate-900 dark:text-white">
                            {alerts.length === 0
                              ? 'All Systems Operational'
                              : 'No Incidents Match Filter'}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                            {alerts.length === 0
                              ? 'Root logger, 5xx HTTP errors, Celery task crashes, and stderr tracebacks are actively monitored and persisted across refreshes.'
                              : 'Adjust your severity, service, or status filter to view other recorded events.'}
                          </p>
                        </div>
                        {alerts.length === 0 && (
                          <button
                            type="button"
                            onClick={() => void handleTestAlert()}
                            disabled={testingAlert}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-700 dark:text-slate-200 hover:border-cyan-500/50 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors cursor-pointer"
                          >
                            <FlaskConical className="w-3.5 h-3.5" />
                            Run Diagnostic Alert Test
                          </button>
                        )}
                      </div>
                    ) : (
                      filteredAlerts.map((alert) => {
                        const meta = SEVERITY_META[alert.severity];
                        const svc = getServiceMeta(alert.container, alert.display_name);
                        const SevIcon = meta.Icon;
                        const headline = getHeadline(alert);

                        return (
                          <div
                            key={alert.id}
                            onClick={() => setInspectedAlert(alert)}
                            className={`group relative rounded-xl border bg-white dark:bg-[#0B1120] p-3.5 transition-all cursor-pointer overflow-hidden ${
                              alert.acknowledged
                                ? 'border-slate-200/80 dark:border-slate-800/80 opacity-75 hover:opacity-100'
                                : meta.cardBorder
                            }`}
                          >
                            <div
                              className={`absolute left-0 top-0 bottom-0 w-1 ${
                                alert.acknowledged ? 'bg-emerald-500/60' : meta.accentBar
                              }`}
                            />
                            <div className="pl-2.5 space-y-2">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${meta.pill}`}
                                  >
                                    <SevIcon className="w-3 h-3" />
                                    {meta.label}
                                  </span>
                                  <span
                                    className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold border ${svc.badge}`}
                                  >
                                    {svc.short}
                                  </span>
                                  {alert.logger && (
                                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate max-w-[180px]">
                                      {alert.logger}
                                    </span>
                                  )}
                                  {alert.acknowledged && (
                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9.5px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                                      <CheckCircle2 className="w-2.5 h-2.5" /> Resolved
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  <span
                                    className="text-[10px] font-mono text-slate-500 dark:text-slate-400"
                                    title={new Date(alert.timestamp).toLocaleString()}
                                  >
                                    {formatRelativeTime(alert.timestamp)} · {formatExactTime(alert.timestamp)}
                                  </span>
                                  {!alert.acknowledged && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void acknowledgeAlert(alert.id);
                                      }}
                                      title="Mark incident as resolved"
                                      className="p-1 rounded-md text-slate-400 hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors cursor-pointer"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <Expand className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                              </div>

                              <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 break-words leading-snug">
                                {headline}
                              </p>

                              {alert.snippet.length > 1 && (
                                <div className="rounded-lg bg-slate-50 dark:bg-[#060913] border border-slate-200/80 dark:border-slate-800/80 px-2.5 py-1.5 font-mono text-[10px] text-slate-600 dark:text-slate-400 space-y-0.5">
                                  {alert.snippet.slice(0, 2).map((line, i) => (
                                    <p key={i} className="truncate">
                                      {line}
                                    </p>
                                  ))}
                                  {alert.snippet.length > 2 && (
                                    <p className="text-[9.5px] text-cyan-600 dark:text-cyan-400 font-semibold">
                                      +{alert.snippet.length - 2} more lines — click to inspect trace
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              ) : tab === 'logs' ? (
                <LogStreamView
                  batches={logBatches}
                  logConn={logConn}
                  paused={logsPaused}
                  onTogglePause={() => setLogsPaused((v) => !v)}
                  onClearLocal={() => setLogBatches(new Map())}
                />
              ) : (
                <DeviceTelemetryPanel active={open && tab === 'telemetry'} />
              )}
            </div>

            {/* ── Footer Status Bar ── */}
            <div className="flex-shrink-0 px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-[#0B1120] flex items-center justify-between gap-2 text-[10px] font-mono text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-3">
                <span>
                  {activeAlerts.length} active · {resolvedCount} resolved
                </span>
                <span className="hidden sm:inline text-slate-300 dark:text-slate-700">|</span>
                <span className="hidden sm:inline">
                  Theme: {isDark ? 'Dark' : 'Light'} · Redis Persistent History
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    tab === 'logs'
                      ? logConn
                        ? 'bg-emerald-500'
                        : 'bg-amber-500'
                      : connected
                        ? 'bg-emerald-500'
                        : 'bg-amber-500'
                  }`}
                />
                <span>
                  {tab === 'logs'
                    ? logConn
                      ? logsPaused
                        ? 'LOGS PAUSED'
                        : 'LOGS STREAMING · 2s'
                      : 'LOGS CONNECTING...'
                    : connected
                      ? 'REAL-TIME MONITOR'
                      : 'RECONNECTING...'}
                </span>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default SystemAlertWidget;
