/**
 * SystemNotificationWidget — Cyberpunk Glassmorphism Design
 * ============================================================
 * Floating, draggable notification center for Manual Trades,
 * WallHunter Bot alerts, and Sentiment News feeds with live
 * WebSocket streaming, sound chimes, and burst-aware toasts.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  BellOff,
  BellRing,
  CheckCheck,
  Cpu,
  Download,
  ExternalLink,
  Flame,
  Monitor,
  Newspaper,
  Radar,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  TrendingUp,
  Volume2,
  VolumeX,
  X,
  ArrowUpRight,
  SlidersHorizontal,
} from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { isThermalGuardActive } from '@/utils/deviceProfile';
import { useSystemNotifications } from '@/hooks/useSystemNotifications';
import type {
  NotificationCategory,
  NotificationSeverity,
  SystemNotificationItem,
  SystemNotificationToast,
} from '@/types/systemNotification';

// ─── Config & Helpers ─────────────────────────────────────────────────────────

type TabFilter = 'all' | NotificationCategory;

interface CategoryStyle {
  label: string;
  shortLabel: string;
  neon: string;
  secondaryNeon: string;
  textClass: string;
  badgeBgDark: string;
  badgeBgLight: string;
  borderClass: string;
  Icon: React.FC<{ className?: string }>;
}

const CATEGORY_CFG: Record<NotificationCategory, CategoryStyle> = {
  manual_trade: {
    label: 'Manual Trade',
    shortLabel: 'MANUAL TRADE',
    neon: '#22d3ee',
    secondaryNeon: '#38bdf8',
    textClass: 'text-cyan-400',
    badgeBgDark: 'rgba(34, 211, 238, 0.14)',
    badgeBgLight: 'rgba(6, 182, 212, 0.12)',
    borderClass: 'border-cyan-500/35',
    Icon: TrendingUp,
  },
  wallhunter: {
    label: 'WallHunter',
    shortLabel: 'WALLHUNTER',
    neon: '#a78bfa',
    secondaryNeon: '#f59e0b',
    textClass: 'text-violet-400',
    badgeBgDark: 'rgba(167, 139, 250, 0.15)',
    badgeBgLight: 'rgba(124, 58, 237, 0.10)',
    borderClass: 'border-violet-500/35',
    Icon: Radar,
  },
  sentiment_news: {
    label: 'Sentiment News',
    shortLabel: 'SENTIMENT NEWS',
    neon: '#34d399',
    secondaryNeon: '#fb7185',
    textClass: 'text-emerald-400',
    badgeBgDark: 'rgba(52, 211, 153, 0.14)',
    badgeBgLight: 'rgba(16, 185, 129, 0.11)',
    borderClass: 'border-emerald-500/35',
    Icon: Newspaper,
  },
  ml_training: {
    label: 'ML Training',
    shortLabel: 'ML TRAINING',
    neon: '#e879f9',
    secondaryNeon: '#a855f7',
    textClass: 'text-fuchsia-400',
    badgeBgDark: 'rgba(232, 121, 249, 0.14)',
    badgeBgLight: 'rgba(192, 38, 211, 0.10)',
    borderClass: 'border-fuchsia-500/35',
    Icon: Cpu,
  },
  market_alerts: {
    label: 'Market Alerts',
    shortLabel: 'ALERTS',
    neon: '#f59e0b',
    secondaryNeon: '#fb923c',
    textClass: 'text-amber-400',
    badgeBgDark: 'rgba(245, 158, 11, 0.15)',
    badgeBgLight: 'rgba(217, 119, 6, 0.11)',
    borderClass: 'border-amber-500/35',
    Icon: Flame,
  },
};

const SEVERITY_NEON: Record<NotificationSeverity, string> = {
  info: '#38bdf8',
  success: '#34d399',
  warning: '#fbbf24',
  critical: '#fb7185',
};

const SEVERITY_FILTERS: Array<{
  key: 'all' | NotificationSeverity;
  label: string;
  neon: string;
}> = [
  { key: 'all', label: 'ALL', neon: '#22d3ee' },
  { key: 'critical', label: 'CRIT', neon: '#fb7185' },
  { key: 'warning', label: 'WARN', neon: '#fbbf24' },
  { key: 'success', label: 'OK', neon: '#34d399' },
  { key: 'info', label: 'INFO', neon: '#38bdf8' },
];

type DateGroupLabel = 'Today' | 'Yesterday' | 'Earlier';

interface QuickActionItem {
  label: string;
  path?: string;
  externalUrl?: string;
  neon: string;
  isRetrain?: boolean;
}

function getDateGroupLabel(iso: string): DateGroupLabel {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Earlier';
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const itemDayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((todayStart - itemDayStart) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return 'Earlier';
}

function getNotificationQuickActions(item: SystemNotificationItem): QuickActionItem[] {
  const meta = item.meta || {};
  const actions: QuickActionItem[] = [];

  switch (item.category) {
    case 'manual_trade':
      actions.push({
        label: 'Open OrderFlow',
        path: '/level2-wallhunter-bot',
        neon: '#22d3ee',
      });
      break;
    case 'wallhunter':
      actions.push({
        label: 'Open WallHunter',
        path: '/level2-wallhunter-bot',
        neon: '#a78bfa',
      });
      break;
    case 'sentiment_news':
      if (meta.url) {
        actions.push({
          label: 'Read Article',
          externalUrl: String(meta.url),
          neon: '#34d399',
        });
      }
      actions.push({
        label: 'Open Sentiment',
        path: '/sentiment-engine',
        neon: '#34d399',
      });
      break;
    case 'ml_training': {
      const hasModelId = meta.model_id !== undefined && meta.model_id !== null && String(meta.model_id) !== '';
      const isRetrain = Boolean(meta.action_retrain) || item.event_type === 'model_drift';
      actions.push({
        label: isRetrain ? '1-Click Retrain' : 'Open Studio',
        path: hasModelId ? `/model-training-studio/${meta.model_id}` : '/model-training-studio',
        neon: isRetrain ? '#fb7185' : '#e879f9',
        isRetrain,
      });
      break;
    }
    case 'market_alerts': {
      const evt = String(item.event_type || '').toLowerCase();
      if (evt === 'backtest_done') {
        actions.push({ label: 'Open Backtester', path: '/backtester', neon: '#f59e0b' });
      } else if (evt === 'liquidation_alert') {
        actions.push({ label: 'Liquidation Map', path: '/liquidation-map', neon: '#fb7185' });
      } else if (evt === 'whale_alert') {
        actions.push({ label: 'On-Chain Analyzer', path: '/on-chain-analyzer', neon: '#f59e0b' });
      } else if (evt === 'api_health') {
        actions.push({ label: 'Open Settings', path: '/settings', neon: '#fbbf24' });
      } else if (evt === 'daily_digest') {
        actions.push({ label: 'Open Portfolio', path: '/portfolio', neon: '#34d399' });
      } else if (evt === 'token_unlock') {
        actions.push({ label: 'Token Unlocks', path: '/token-unlocks', neon: '#f59e0b' });
      } else {
        actions.push({ label: 'Open Watchlist', path: '/alerts-watchlist', neon: '#f59e0b' });
      }
      break;
    }
  }

  return actions;
}

function getAccentNeon(item: Pick<SystemNotificationItem, 'category' | 'severity' | 'meta'>): string {
  if (item.severity === 'critical') return '#fb7185';
  if (item.category === 'sentiment_news') {
    const sentiment = String(item.meta?.sentiment ?? '').toLowerCase();
    if (sentiment.includes('neg') || sentiment.includes('bear')) return '#fb7185';
    return '#34d399';
  }
  if (item.category === 'wallhunter' && item.severity === 'warning') {
    return '#f59e0b';
  }
  return CATEGORY_CFG[item.category]?.neon ?? '#22d3ee';
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatClockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatNumber(val: number, decimals = 2): string {
  return Number.isFinite(val)
    ? val.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : String(val);
}

// ─── Floating Toast Item ──────────────────────────────────────────────────────

const NotificationToastCard: React.FC<{
  toast: SystemNotificationToast;
  isDark: boolean;
  onDismiss: () => void;
  onOpen: () => void;
}> = ({ toast, isDark, onDismiss, onOpen }) => {
  const [vis, setVis] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVis(true));
    const timer = setTimeout(() => {
      setVis(false);
      setTimeout(onDismiss, 280);
    }, 6000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [onDismiss]);

  const catCfg = CATEGORY_CFG[toast.category] ?? CATEGORY_CFG.market_alerts;
  const neon =
    toast.notification
      ? getAccentNeon(toast.notification)
      : toast.severity === 'critical'
        ? SEVERITY_NEON.critical
        : catCfg.neon;
  const Icon = catCfg.Icon;

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') onOpen();
      }}
      className={`rounded-2xl p-px cursor-pointer transition-all duration-300 ${
        vis ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-6'
      }`}
      style={{
        background: `linear-gradient(135deg, ${neon}75, ${catCfg.secondaryNeon}45)`,
        boxShadow: isDark
          ? `0 0 28px ${neon}30, 0 18px 40px rgba(0,0,0,0.75)`
          : `0 0 20px ${neon}22, 0 14px 30px rgba(15,23,42,0.16)`,
      }}
    >
      <div
        className="rounded-2xl p-3 relative overflow-hidden"
        style={{
          background: isDark ? 'rgba(10, 12, 24, 0.96)' : 'rgba(255, 255, 255, 0.96)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <div
          className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full"
          style={{ background: neon, boxShadow: `0 0 8px ${neon}` }}
        />
        <div className="flex items-start gap-2.5 pl-2">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{
              background: isDark ? catCfg.badgeBgDark : catCfg.badgeBgLight,
              border: `1px solid ${neon}50`,
              color: neon,
            }}
          >
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className="text-[9px] font-black tracking-[0.16em] uppercase"
                style={{ color: neon }}
              >
                {toast.kind === 'news_burst' ? 'News Burst' : catCfg.label}
              </span>
              {toast.notification?.meta?.symbol && (
                <span
                  className={`text-[9px] font-mono px-1.5 py-0.2 rounded ${
                    isDark ? 'bg-white/10 text-gray-200' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {toast.notification.meta.symbol}
                </span>
              )}
            </div>
            <p className={`text-xs font-bold mt-0.5 truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>
              {toast.title}
            </p>
            <p className={`text-[11px] mt-0.5 line-clamp-2 leading-snug ${isDark ? 'text-gray-300' : 'text-slate-600'}`}>
              {toast.message}
            </p>
          </div>
          <button
            type="button"
            aria-label="Dismiss notification toast"
            onClick={e => {
              e.stopPropagation();
              setVis(false);
              setTimeout(onDismiss, 250);
            }}
            className={`p-1 rounded-lg transition-colors flex-shrink-0 ${
              isDark ? 'text-gray-500 hover:text-white hover:bg-white/10' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
            }`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Detail Modal ─────────────────────────────────────────────────────────────

const NotificationDetailModal: React.FC<{
  item: SystemNotificationItem;
  isDark: boolean;
  onClose: () => void;
  onNavigateRoute: (path: string) => void;
}> = ({ item, isDark, onClose, onNavigateRoute }) => {
  const catCfg = CATEGORY_CFG[item.category] ?? CATEGORY_CFG.market_alerts;
  const neon = getAccentNeon(item);
  const meta = item.meta || {};
  const Icon = catCfg.Icon;
  const quickActions = useMemo(() => getNotificationQuickActions(item), [item]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const metaEntries = useMemo(() => {
    const ignored = new Set(['image_url', 'url']);
    return Object.entries(meta).filter(
      ([key, value]) => !ignored.has(key) && value !== undefined && value !== null && value !== ''
    );
  }, [meta]);

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
      style={{
        background: isDark ? 'rgba(0, 0, 0, 0.80)' : 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(8px)',
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl p-px"
        style={{
          background: `linear-gradient(135deg, ${neon}65, rgba(255,255,255,0.12), ${catCfg.secondaryNeon}45)`,
          boxShadow: isDark
            ? `0 0 60px ${neon}30, 0 30px 80px rgba(0,0,0,0.9)`
            : `0 0 40px ${neon}20, 0 24px 60px rgba(15,23,42,0.22)`,
        }}
      >
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: isDark ? 'rgba(8, 10, 22, 0.98)' : 'rgba(248, 250, 252, 0.99)',
          }}
        >
          {/* Header */}
          <div
            className="relative px-5 py-4 border-b"
            style={{
              borderColor: `${neon}25`,
              background: `${neon}10`,
            }}
          >
            <div
              className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl"
              style={{ background: neon, boxShadow: `0 0 12px ${neon}` }}
            />
            <div className="flex items-start justify-between gap-3 pl-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-black tracking-[0.16em] uppercase"
                    style={{ color: neon }}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {catCfg.label}
                  </span>
                  <span className={isDark ? 'text-gray-600 text-[10px]' : 'text-slate-400 text-[10px]'}>•</span>
                  <span
                    className={`px-1.5 py-0.5 rounded font-mono text-[9px] uppercase ${
                      isDark ? 'bg-white/10 text-gray-300' : 'bg-slate-200/80 text-slate-700'
                    }`}
                  >
                    {item.event_type}
                  </span>
                </div>
                <h3 className={`text-sm font-bold leading-snug ${isDark ? 'text-white' : 'text-slate-900'}`}>
                  {item.title}
                </h3>
                <p className={`font-mono text-[10px] mt-1 ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
                  {new Date(item.created_at).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all flex-shrink-0 ${
                  isDark
                    ? 'border border-white/10 text-gray-400 hover:text-white hover:bg-white/10'
                    : 'border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                }`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="px-5 py-4 space-y-4 max-h-[65vh] overflow-y-auto">
            {meta.image_url && (
              <div
                className="rounded-xl overflow-hidden border"
                style={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.1)' }}
              >
                <img
                  src={meta.image_url}
                  alt={item.title}
                  className="w-full max-h-48 object-cover"
                  loading="lazy"
                />
              </div>
            )}

            <div
              className={`rounded-xl p-3.5 text-xs leading-relaxed whitespace-pre-wrap ${
                isDark ? 'text-gray-200' : 'text-slate-700'
              }`}
              style={{
                background: isDark ? 'rgba(0,0,0,0.45)' : 'rgba(15,23,42,0.04)',
                border: `1px solid ${neon}20`,
              }}
            >
              {item.message}
            </div>

            {metaEntries.length > 0 && (
              <div>
                <p
                  className="text-[9px] font-black tracking-[0.18em] uppercase mb-2"
                  style={{ color: neon }}
                >
                  Telemetry & Metadata
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {metaEntries.map(([key, value]) => (
                    <div
                      key={key}
                      className={`rounded-lg px-2.5 py-1.5 border ${
                        isDark ? 'bg-white/[0.03] border-white/10' : 'bg-white border-slate-200'
                      }`}
                    >
                      <span
                        className={`block text-[9px] font-mono uppercase ${
                          isDark ? 'text-gray-500' : 'text-slate-400'
                        }`}
                      >
                        {key.replace(/_/g, ' ')}
                      </span>
                      <span
                        className={`block text-[11px] font-semibold truncate ${
                          key === 'pnl' && typeof value === 'number'
                            ? value >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                            : isDark
                              ? 'text-gray-200'
                              : 'text-slate-800'
                        }`}
                      >
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="px-5 py-3 border-t flex items-center justify-between gap-2 flex-wrap"
            style={{ borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)' }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              {quickActions.map(action =>
                action.externalUrl ? (
                  <a
                    key={action.label}
                    href={action.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wider uppercase border transition-all hover:opacity-90"
                    style={{
                      borderColor: `${action.neon}55`,
                      color: action.neon,
                      background: `${action.neon}18`,
                    }}
                  >
                    {action.label}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => action.path && onNavigateRoute(action.path)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wider uppercase border transition-all hover:opacity-90 cursor-pointer"
                    style={{
                      borderColor: `${action.neon}55`,
                      color: action.neon,
                      background: `${action.neon}18`,
                    }}
                  >
                    {action.label}
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                )
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className={`px-3.5 py-1.5 rounded-lg text-[10px] font-bold tracking-wider uppercase border transition-all ${
                isDark
                  ? 'border-white/15 text-gray-300 hover:bg-white/10'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
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

// ─── Notification Card ────────────────────────────────────────────────────────

const NotificationCard: React.FC<{
  item: SystemNotificationItem;
  isDark: boolean;
  onSelect: (item: SystemNotificationItem) => void;
  onDismiss: (id: number) => void;
  onMarkRead: (id: number) => void;
  onNavigateRoute: (path: string) => void;
}> = ({ item, isDark, onSelect, onDismiss, onMarkRead, onNavigateRoute }) => {
  const catCfg = CATEGORY_CFG[item.category] ?? CATEGORY_CFG.market_alerts;
  const neon = getAccentNeon(item);
  const Icon = catCfg.Icon;
  const meta = item.meta || {};
  const quickActions = useMemo(() => getNotificationQuickActions(item), [item]);

  const impactUpper = meta.impact_level ? String(meta.impact_level).toUpperCase() : null;
  const impactColor =
    impactUpper === 'HIGH'
      ? isDark
        ? 'text-rose-300 bg-rose-500/20 border-rose-500/40'
        : 'text-rose-700 bg-rose-100 border-rose-300'
      : impactUpper === 'MEDIUM'
        ? isDark
          ? 'text-amber-300 bg-amber-500/20 border-amber-500/40'
          : 'text-amber-700 bg-amber-100 border-amber-300'
        : isDark
          ? 'text-slate-300 bg-slate-500/20 border-slate-500/30'
          : 'text-slate-600 bg-slate-100 border-slate-300';

  const sentimentLower = meta.sentiment ? String(meta.sentiment).toLowerCase() : '';
  const sentimentColor = sentimentLower.includes('pos') || sentimentLower.includes('bull')
    ? isDark
      ? 'text-emerald-300 bg-emerald-500/20 border-emerald-500/35'
      : 'text-emerald-700 bg-emerald-100 border-emerald-300'
    : sentimentLower.includes('neg') || sentimentLower.includes('bear')
      ? isDark
        ? 'text-rose-300 bg-rose-500/20 border-rose-500/35'
        : 'text-rose-700 bg-rose-100 border-rose-300'
      : isDark
        ? 'text-sky-300 bg-sky-500/15 border-sky-500/30'
        : 'text-sky-700 bg-sky-100 border-sky-300';

  const sideUpper = meta.side ? String(meta.side).toUpperCase() : null;
  const isBuySide = sideUpper === 'BUY' || sideUpper === 'LONG';

  return (
    <div
      onClick={() => onSelect(item)}
      className={`relative rounded-xl p-3 border overflow-hidden transition-all cursor-pointer group ${
        isDark
          ? item.is_read
            ? 'bg-white/[0.025] border-white/[0.07] hover:bg-white/[0.05]'
            : 'bg-white/[0.06] border-white/15 hover:bg-white/[0.08]'
          : item.is_read
            ? 'bg-white/70 border-slate-200/80 hover:bg-white'
            : 'bg-white border-cyan-500/30 shadow-sm hover:bg-slate-50'
      }`}
      style={!item.is_read ? { boxShadow: `0 4px 20px ${neon}16` } : undefined}
    >
      {/* Left neon stripe */}
      <div
        className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full"
        style={{
          background: neon,
          boxShadow: item.is_read ? 'none' : `0 0 8px ${neon}`,
          opacity: item.is_read ? 0.45 : 1,
        }}
      />

      <div className="pl-2.5">
        {/* Top row */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black tracking-wider uppercase"
              style={{
                color: neon,
                background: isDark ? catCfg.badgeBgDark : catCfg.badgeBgLight,
              }}
            >
              <Icon className="w-2.5 h-2.5" />
              {catCfg.label}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded font-mono text-[8.5px] uppercase truncate max-w-[120px] ${
                isDark ? 'bg-white/5 text-gray-400' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {item.event_type}
            </span>
            {!item.is_read && (
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse"
                style={{ background: neon, boxShadow: `0 0 6px ${neon}` }}
                title="Unread"
              />
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span
              className={`text-[9px] font-mono ${isDark ? 'text-gray-500' : 'text-slate-400'}`}
              title={formatClockTime(item.created_at)}
            >
              {formatRelativeTime(item.created_at)}
            </span>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={e => {
                e.stopPropagation();
                onDismiss(item.id);
              }}
              className={`w-5 h-5 rounded-md flex items-center justify-center transition-all opacity-75 sm:opacity-0 sm:group-hover:opacity-100 ${
                isDark
                  ? 'text-gray-400 hover:text-rose-400 hover:bg-white/10'
                  : 'text-slate-400 hover:text-rose-600 hover:bg-slate-200/70'
              }`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Title & 2-line preview */}
        <p
          className={`text-xs font-bold leading-snug ${
            isDark
              ? item.is_read
                ? 'text-gray-200'
                : 'text-white'
              : item.is_read
                ? 'text-slate-700'
                : 'text-slate-900'
          }`}
        >
          {item.title}
        </p>
        <p
          className={`text-[11px] mt-0.5 line-clamp-2 leading-relaxed ${
            isDark ? 'text-gray-400' : 'text-slate-600'
          }`}
        >
          {item.message}
        </p>

        {/* Metadata pills */}
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          {meta.symbol && (
            <span
              className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-bold border ${
                isDark
                  ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/25'
                  : 'bg-cyan-50 text-cyan-700 border-cyan-200'
              }`}
            >
              {meta.symbol}
            </span>
          )}
          {sideUpper && (
            <span
              className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-bold border ${
                isBuySide
                  ? isDark
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : isDark
                    ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}
            >
              {sideUpper}
            </span>
          )}
          {typeof meta.price === 'number' && (
            <span
              className={`px-1.5 py-0.5 rounded font-mono text-[9px] border ${
                isDark
                  ? 'bg-white/5 text-gray-300 border-white/10'
                  : 'bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              ${formatNumber(meta.price, meta.price < 1 ? 4 : 2)}
            </span>
          )}
          {typeof meta.pnl === 'number' && (
            <span
              className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-bold border ${
                meta.pnl >= 0
                  ? isDark
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : isDark
                    ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}
            >
              PnL {meta.pnl >= 0 ? '+' : ''}
              {formatNumber(meta.pnl)}
            </span>
          )}
          {meta.bot_name && (
            <span
              className={`px-1.5 py-0.5 rounded font-mono text-[9px] border ${
                isDark
                  ? 'bg-violet-500/15 text-violet-300 border-violet-500/30'
                  : 'bg-violet-50 text-violet-700 border-violet-200'
              }`}
            >
              {meta.bot_name}
            </span>
          )}
          {impactUpper && (
            <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-bold border ${impactColor}`}>
              {impactUpper}
            </span>
          )}
          {meta.sentiment && (
            <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-semibold border ${sentimentColor}`}>
              {meta.sentiment}
            </span>
          )}
          {meta.source && (
            <span
              className={`px-1.5 py-0.5 rounded font-mono text-[9px] border ${
                isDark
                  ? 'bg-white/5 text-gray-400 border-white/10'
                  : 'bg-slate-100 text-slate-500 border-slate-200'
              }`}
            >
              {meta.source}
            </span>
          )}
        </div>

        {/* Quick Action Buttons */}
        {quickActions.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2 pt-2 border-t border-white/[0.06]">
            {quickActions.map(action =>
              action.externalUrl ? (
                <a
                  key={action.label}
                  href={action.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => {
                    e.stopPropagation();
                    if (!item.is_read) onMarkRead(item.id);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9.5px] font-bold tracking-wider uppercase border transition-all hover:opacity-90"
                  style={{
                    borderColor: `${action.neon}45`,
                    color: action.neon,
                    background: `${action.neon}14`,
                  }}
                >
                  {action.label}
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              ) : (
                <button
                  key={action.label}
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    if (!item.is_read) onMarkRead(item.id);
                    if (action.path) onNavigateRoute(action.path);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9.5px] font-bold tracking-wider uppercase border transition-all hover:opacity-90 cursor-pointer"
                  style={{
                    borderColor: `${action.neon}45`,
                    color: action.neon,
                    background: `${action.neon}14`,
                  }}
                >
                  {action.label}
                  <ArrowUpRight className="w-2.5 h-2.5" />
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main Widget ──────────────────────────────────────────────────────────────

const SystemNotificationWidget: React.FC = () => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const navigate = useNavigate();

  const {
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
  } = useSystemNotifications();

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'all' | NotificationSeverity>('all');
  const [isDigestLoading, setIsDigestLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedItem, setSelectedItem] = useState<SystemNotificationItem | null>(null);

  // Draggable floating window state (matches SystemAlertWidget pattern)
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, curX: 0, curY: 0 });

  // Center floating window when opened
  useEffect(() => {
    if (open) {
      const modalWidth = Math.min(560, window.innerWidth - 20);
      const modalHeight = Math.min(580, window.innerHeight - 30);
      setPosition({
        x: Math.max(10, (window.innerWidth - modalWidth) / 2),
        y: Math.max(10, (window.innerHeight - modalHeight) / 2),
      });
    }
  }, [open]);

  // Unified pointer drag system
  useEffect(() => {
    if (!isDragging) return;

    const onPointerMove = (e: PointerEvent) => {
      e.preventDefault();
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;

      const modalWidth = Math.min(560, window.innerWidth - 20);
      const modalHeight = Math.min(580, window.innerHeight - 30);
      const maxX = Math.max(0, window.innerWidth - modalWidth);
      const maxY = Math.max(0, window.innerHeight - modalHeight);

      setPosition({
        x: Math.max(0, Math.min(maxX, dragRef.current.curX + dx)),
        y: Math.max(0, Math.min(maxY, dragRef.current.curY + dy)),
      });
    };

    const onPointerUp = () => setIsDragging(false);

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [isDragging]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea')) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setIsDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, curX: position.x, curY: position.y };
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
  };

  const filteredNotifications = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return notifications.filter(item => {
      if (activeTab !== 'all' && item.category !== activeTab) return false;
      if (unreadOnly && item.is_read) return false;
      if (severityFilter !== 'all' && item.severity !== severityFilter) return false;
      if (q) {
        const meta = item.meta || {};
        const haystack = [
          item.title,
          item.message,
          item.event_type,
          meta.symbol,
          meta.bot_name,
          meta.source,
          meta.model_id !== undefined ? String(meta.model_id) : '',
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [notifications, activeTab, unreadOnly, severityFilter, searchQuery]);

  const groupedNotifications = useMemo(() => {
    const buckets: Record<DateGroupLabel, SystemNotificationItem[]> = {
      Today: [],
      Yesterday: [],
      Earlier: [],
    };
    for (const item of filteredNotifications) {
      buckets[getDateGroupLabel(item.created_at)].push(item);
    }
    return (['Today', 'Yesterday', 'Earlier'] as DateGroupLabel[])
      .map(label => ({ label, items: buckets[label] }))
      .filter(group => group.items.length > 0);
  }, [filteredNotifications]);

  const activeCategory: NotificationCategory | null = activeTab === 'all' ? null : activeTab;

  const handleDailyDigest = async () => {
    if (isDigestLoading) return;
    setIsDigestLoading(true);
    try {
      await triggerDailyDigest();
      setActiveTab('all');
    } catch {
      // ignore transient error
    } finally {
      setIsDigestLoading(false);
    }
  };

  const handleExportCsv = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      await exportCsv({
        category: activeCategory ?? undefined,
        severity: severityFilter === 'all' ? undefined : severityFilter,
        search: searchQuery.trim() || undefined,
      });
    } catch {
      // ignore transient error
    } finally {
      setIsExporting(false);
    }
  };

  const handleSelectCard = (item: SystemNotificationItem) => {
    if (!item.is_read) {
      void markRead(item.id);
    }
    setSelectedItem(item);
  };

  const handleToastOpen = (toast: SystemNotificationToast) => {
    dismissToast(toast.toastId);
    setOpen(true);
    if (toast.kind === 'news_burst') {
      setActiveTab('sentiment_news');
      return;
    }
    if (toast.notification) {
      setActiveTab(toast.notification.category);
      if (!toast.notification.is_read) {
        void markRead(toast.notification.id);
      }
      setSelectedItem(toast.notification);
    }
  };

  const handleNavigateRoute = (path: string) => {
    setSelectedItem(null);
    setOpen(false);
    navigate(path);
  };

  const hasUnread = unreadCounts.total > 0;
  const badgeText = unreadCounts.total > 99 ? '99+' : String(unreadCounts.total);

  const tabs: Array<{
    key: TabFilter;
    label: string;
    count: number;
    neon: string;
    Icon?: React.FC<{ className?: string }>;
  }> = [
    { key: 'all', label: 'ALL', count: unreadCounts.total, neon: '#22d3ee' },
    { key: 'manual_trade', label: 'MANUAL TRADE', count: unreadCounts.manual_trade, neon: '#22d3ee' },
    { key: 'wallhunter', label: 'WALLHUNTER', count: unreadCounts.wallhunter, neon: '#a78bfa' },
    { key: 'sentiment_news', label: 'SENTIMENT NEWS', count: unreadCounts.sentiment_news, neon: '#34d399' },
    { key: 'ml_training', label: 'ML TRAINING', count: unreadCounts.ml_training ?? 0, neon: '#e879f9', Icon: Cpu },
    { key: 'market_alerts', label: 'ALERTS', count: unreadCounts.market_alerts ?? 0, neon: '#f59e0b', Icon: Flame },
  ];

  return (
    <>
      {/* ─── Floating Toast Stack (top-right, offset below header & critical alerts) ─── */}
      {toasts.length > 0 &&
        createPortal(
          <div className="fixed top-20 right-4 z-[9998] flex flex-col gap-2.5 w-80 max-w-[calc(100vw-2rem)] pointer-events-none">
            {toasts.map(toast => (
              <div key={toast.toastId} className="pointer-events-auto">
                <NotificationToastCard
                  toast={toast}
                  isDark={isDark}
                  onDismiss={() => dismissToast(toast.toastId)}
                  onOpen={() => handleToastOpen(toast)}
                />
              </div>
            ))}
          </div>,
          document.body
        )}

      {/* ─── Detail Modal ─── */}
      {selectedItem && (
        <NotificationDetailModal
          item={selectedItem}
          isDark={isDark}
          onClose={() => setSelectedItem(null)}
          onNavigateRoute={handleNavigateRoute}
        />
      )}

      {/* ─── Header Trigger Button ─── */}
      <button
        type="button"
        id="system-notification-widget-trigger"
        onClick={() => setOpen(v => !v)}
        aria-label="Toggle system notifications"
        className={`relative flex items-center gap-2 px-2.5 sm:px-3 h-9 rounded-xl border transition-all duration-300 cursor-pointer select-none overflow-hidden shrink-0 ${
          open ? 'ring-1 ring-cyan-400/50' : ''
        }`}
        style={{
          background: hasUnread
            ? isDark
              ? 'linear-gradient(135deg, rgba(6,182,212,0.16), rgba(245,158,11,0.12))'
              : 'linear-gradient(135deg, rgba(6,182,212,0.14), rgba(245,158,11,0.10))'
            : isDark
              ? 'rgba(255,255,255,0.04)'
              : 'rgba(15,23,42,0.04)',
          borderColor: hasUnread
            ? 'rgba(34,211,238,0.45)'
            : isDark
              ? 'rgba(255,255,255,0.08)'
              : 'rgba(15,23,42,0.12)',
          boxShadow: hasUnread ? '0 0 18px rgba(34,211,238,0.18)' : 'none',
        }}
      >
        {/* Hover shimmer */}
        <div
          className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent)' }}
        />

        {/* Pulsing live WS dot */}
        <div className="relative flex-shrink-0">
          <div
            className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-gray-500'}`}
            style={connected ? { boxShadow: '0 0 6px #34d399' } : undefined}
          />
          {connected && <div className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />}
        </div>

        {/* Bell Icon */}
        <Bell
          className={`w-4 h-4 flex-shrink-0 transition-colors ${
            hasUnread
              ? isDark
                ? 'text-cyan-300'
                : 'text-cyan-600'
              : isDark
                ? 'text-gray-400'
                : 'text-slate-600'
          }`}
        />

        {/* Label hidden on < sm */}
        <span
          className={`text-xs font-semibold hidden sm:inline transition-colors whitespace-nowrap ${
            hasUnread
              ? isDark
                ? 'text-cyan-300'
                : 'text-cyan-700'
              : isDark
                ? 'text-gray-400'
                : 'text-slate-600'
          }`}
          style={hasUnread && isDark ? { textShadow: '0 0 8px rgba(34,211,238,0.75)' } : undefined}
        >
          {hasUnread ? `${unreadCounts.total} NEW` : 'SYS NOTIFY'}
        </span>

        {/* Unread count badge */}
        {hasUnread && (
          <span
            className="min-w-[18px] h-[18px] px-1 text-slate-950 text-[9px] font-black rounded-full flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #22d3ee, #fbbf24)',
              boxShadow: '0 0 10px rgba(34,211,238,0.65)',
            }}
          >
            {badgeText}
          </span>
        )}
      </button>

      {/* ─── Draggable Floating Cyberpunk Window ─── */}
      {(open || !isThermalGuardActive()) && createPortal(
        <div
          className={`fixed z-[9999] ${
            isDragging ? '' : 'transition-[opacity,transform] duration-200'
          } ${open ? 'opacity-100 pointer-events-auto scale-100' : 'opacity-0 pointer-events-none scale-95'}`}
          style={{
            top: `${position.y}px`,
            left: `${position.x}px`,
            width: '560px',
            maxWidth: 'calc(100vw - 20px)',
            transformOrigin: 'top left',
            willChange: isDragging ? 'top, left' : 'auto',
            touchAction: 'none',
          }}
        >
          {/* Outer glow border */}
          <div
            className="rounded-2xl p-px"
            style={{
              background: isDragging
                ? 'linear-gradient(135deg, #06b6d470, #a78bfa60, #06b6d470)'
                : 'linear-gradient(135deg, #06b6d440, #ffffff14, #a78bfa35)',
              boxShadow: isDark
                ? isDragging
                  ? '0 0 60px rgba(6,182,212,0.28), 0 30px 60px rgba(0,0,0,0.85)'
                  : '0 0 40px rgba(6,182,212,0.14), 0 25px 50px rgba(0,0,0,0.9)'
                : '0 20px 50px rgba(15,23,42,0.20)',
            }}
          >
            <div
              className="rounded-2xl overflow-hidden flex flex-col relative"
              style={{
                height: 'min(580px, calc(100vh - 30px))',
                background: isDark
                  ? (isThermalGuardActive() ? 'rgba(8, 10, 20, 0.97)' : 'rgba(8, 10, 20, 0.90)')
                  : (isThermalGuardActive() ? 'rgba(248, 250, 252, 0.99)' : 'rgba(248, 250, 252, 0.95)'),
                backdropFilter: open && !isThermalGuardActive() ? 'blur(30px)' : 'none',
                WebkitBackdropFilter: open && !isThermalGuardActive() ? 'blur(30px)' : 'none',
              }}
            >
              {/* Scanline overlay */}
              <div
                className="absolute inset-0 pointer-events-none rounded-2xl overflow-hidden z-10 opacity-[0.025]"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 3px)',
                  backgroundSize: '100% 3px',
                }}
              />

              {/* ── Title Bar (Drag Handle) ── */}
              <div
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className={`relative flex-shrink-0 flex items-center justify-between gap-2 px-4 py-3 cursor-grab select-none touch-none ${
                  isDragging ? 'cursor-grabbing' : ''
                }`}
                style={{
                  background: isDark
                    ? 'linear-gradient(135deg, rgba(6,182,212,0.14), rgba(124,58,237,0.10))'
                    : 'linear-gradient(135deg, rgba(6,182,212,0.10), rgba(124,58,237,0.06))',
                  touchAction: 'none',
                }}
              >
                <div
                  className="absolute bottom-0 left-0 right-0 h-px"
                  style={{ background: 'linear-gradient(90deg, transparent, #22d3ee60, #a78bfa50, transparent)' }}
                />

                {/* Left: Logo + Title */}
                <div className="flex items-center gap-2.5 min-w-0 pointer-events-none select-none">
                  <div
                    className="relative w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{
                      background: 'linear-gradient(135deg, rgba(6,182,212,0.35), rgba(124,58,237,0.30))',
                      border: '1px solid rgba(34,211,238,0.45)',
                      boxShadow: '0 0 14px rgba(34,211,238,0.28)',
                    }}
                  >
                    <Bell className="w-4 h-4 text-cyan-300" />
                  </div>
                  <div className="min-w-0">
                    <p
                      className={`text-[11px] font-black tracking-[0.15em] uppercase leading-none truncate ${
                        isDark ? 'text-white' : 'text-slate-900'
                      }`}
                      style={isDark ? { textShadow: '0 0 12px rgba(34,211,238,0.65)' } : undefined}
                    >
                      SYS NOTIFICATION
                    </p>
                    <p
                      className={`text-[9px] mt-0.5 tracking-wider uppercase truncate ${
                        isDark ? 'text-gray-400' : 'text-slate-500'
                      }`}
                    >
                      Trade · WallHunter · News · ML · Alerts
                    </p>
                  </div>
                </div>

                {/* Right: Live node + quick toggles + close */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <div
                    className={`hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg border pointer-events-none ${
                      isDark ? 'bg-black/30 border-white/10' : 'bg-white/70 border-slate-200'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`}
                      style={connected ? { boxShadow: '0 0 6px #34d399' } : undefined}
                    />
                    <span
                      className={`text-[8.5px] font-black tracking-widest uppercase ${
                        connected ? 'text-emerald-400' : isDark ? 'text-gray-500' : 'text-slate-400'
                      }`}
                    >
                      {connected ? 'LIVE' : 'SYNC'}
                    </span>
                  </div>

                  {/* Sound toggle */}
                  <button
                    type="button"
                    title={preferences.soundEnabled ? 'Mute notification chime' : 'Enable notification chime'}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => updatePreferences({ soundEnabled: !preferences.soundEnabled })}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all border cursor-pointer ${
                      preferences.soundEnabled
                        ? isDark
                          ? 'border-cyan-500/35 text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20'
                          : 'border-cyan-500/35 text-cyan-700 bg-cyan-50 hover:bg-cyan-100'
                        : isDark
                          ? 'border-white/10 text-gray-500 hover:text-gray-300 hover:bg-white/10'
                          : 'border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {preferences.soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                  </button>

                  {/* Popups toggle */}
                  <button
                    type="button"
                    title={preferences.toastEnabled ? 'Disable floating popups' : 'Enable floating popups'}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => updatePreferences({ toastEnabled: !preferences.toastEnabled })}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all border cursor-pointer ${
                      preferences.toastEnabled
                        ? isDark
                          ? 'border-violet-500/35 text-violet-300 bg-violet-500/10 hover:bg-violet-500/20'
                          : 'border-violet-500/35 text-violet-700 bg-violet-50 hover:bg-violet-100'
                        : isDark
                          ? 'border-white/10 text-gray-500 hover:text-gray-300 hover:bg-white/10'
                          : 'border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {preferences.toastEnabled ? <BellRing className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
                  </button>

                  {/* Desktop Browser Push toggle */}
                  <button
                    type="button"
                    title={
                      preferences.desktopPushEnabled
                        ? 'Desktop Browser Push: ON (click to disable)'
                        : 'Desktop Browser Push: OFF (click to enable)'
                    }
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => updatePreferences({ desktopPushEnabled: !preferences.desktopPushEnabled })}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all border cursor-pointer ${
                      preferences.desktopPushEnabled
                        ? isDark
                          ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25'
                          : 'border-emerald-500/40 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                        : isDark
                          ? 'border-white/10 text-gray-500 hover:text-gray-300 hover:bg-white/10'
                          : 'border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Monitor className="w-3.5 h-3.5" />
                  </button>

                  {/* Daily Digest */}
                  <button
                    type="button"
                    title="Generate Today's PnL & Trade Daily Digest"
                    disabled={isDigestLoading}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => void handleDailyDigest()}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all border cursor-pointer disabled:opacity-50 ${
                      isDark
                        ? 'border-amber-500/35 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20'
                        : 'border-amber-500/35 text-amber-700 bg-amber-50 hover:bg-amber-100'
                    }`}
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${isDigestLoading ? 'animate-pulse' : ''}`} />
                  </button>

                  {/* Export CSV */}
                  <button
                    type="button"
                    title="Export filtered notifications to CSV"
                    disabled={isExporting}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => void handleExportCsv()}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all border cursor-pointer disabled:opacity-50 ${
                      isDark
                        ? 'border-white/10 text-gray-300 hover:text-cyan-300 hover:border-cyan-500/35 hover:bg-cyan-500/10'
                        : 'border-slate-200 text-slate-600 hover:text-cyan-700 hover:border-cyan-400 hover:bg-cyan-50'
                    }`}
                  >
                    <Download className={`w-3.5 h-3.5 ${isExporting ? 'animate-bounce' : ''}`} />
                  </button>

                  {/* Refresh */}
                  <button
                    type="button"
                    title="Refresh notifications"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => void refresh()}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all border cursor-pointer ${
                      isDark
                        ? 'border-white/10 text-gray-400 hover:text-white hover:bg-white/10'
                        : 'border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                    }`}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
                  </button>

                  {/* Close */}
                  <button
                    type="button"
                    aria-label="Close notification window"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => setOpen(false)}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all border cursor-pointer ${
                      isDark
                        ? 'border-transparent text-gray-400 hover:text-white hover:border-white/10 hover:bg-white/10'
                        : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* ── Category Tabs (Horizontally Scrollable) ── */}
              <div
                className="flex-shrink-0 flex items-center overflow-x-auto hide-scrollbar border-b"
                style={{
                  borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)',
                  background: isDark ? 'rgba(0,0,0,0.28)' : 'rgba(15,23,42,0.02)',
                }}
              >
                {tabs.map(tab => {
                  const isActive = activeTab === tab.key;
                  const TabIcon = tab.Icon;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={`relative shrink-0 whitespace-nowrap py-2.5 px-3 flex items-center justify-center gap-1.5 text-[9.5px] font-black tracking-wider uppercase transition-all ${
                        isActive
                          ? isDark
                            ? 'text-white'
                            : 'text-slate-900'
                          : isDark
                            ? 'text-gray-500 hover:text-gray-300'
                            : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {isActive && (
                        <>
                          <div
                            className="absolute inset-0 opacity-10"
                            style={{ background: `linear-gradient(135deg, ${tab.neon}, transparent)` }}
                          />
                          <div
                            className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                            style={{ background: tab.neon, boxShadow: `0 0 8px ${tab.neon}` }}
                          />
                        </>
                      )}
                      {TabIcon && <TabIcon className="w-3 h-3 shrink-0" />}
                      <span>{tab.label}</span>
                      {tab.count > 0 && (
                        <span
                          className="min-w-[16px] h-4 px-1 rounded-full text-[8.5px] font-black flex items-center justify-center flex-shrink-0"
                          style={{
                            background: isActive ? tab.neon : isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.12)',
                            color: isActive ? '#020617' : isDark ? '#e5e7eb' : '#1e293b',
                          }}
                        >
                          {tab.count > 99 ? '99+' : tab.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* ── Search & Severity Filter Bar ── */}
              <div
                className="flex-shrink-0 flex items-center justify-between gap-2 px-3.5 py-2 border-b flex-wrap sm:flex-nowrap"
                style={{
                  borderColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.06)',
                  background: isDark ? 'rgba(0,0,0,0.18)' : 'rgba(15,23,42,0.015)',
                }}
              >
                <div className="relative flex-1 min-w-[160px]">
                  <Search
                    className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${
                      isDark ? 'text-gray-500' : 'text-slate-400'
                    }`}
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search symbol, keyword, title..."
                    className={`w-full pl-8 pr-7 py-1 rounded-lg text-[11px] border outline-none transition-colors ${
                      isDark
                        ? 'bg-black/40 border-white/10 text-gray-100 placeholder:text-gray-500 focus:border-cyan-400/50'
                        : 'bg-white border-slate-200 text-slate-800 placeholder:text-slate-400 focus:border-cyan-500'
                    }`}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => setSearchQuery('')}
                      className={`absolute right-2 top-1/2 -translate-y-1/2 ${
                        isDark ? 'text-gray-500 hover:text-white' : 'text-slate-400 hover:text-slate-700'
                      }`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {SEVERITY_FILTERS.map(sev => {
                    const active = severityFilter === sev.key;
                    return (
                      <button
                        key={sev.key}
                        type="button"
                        onClick={() => setSeverityFilter(sev.key)}
                        className={`px-2 py-0.5 rounded-md text-[9px] font-black tracking-wider uppercase border transition-all cursor-pointer ${
                          active
                            ? ''
                            : isDark
                              ? 'border-white/10 text-gray-500 hover:text-gray-300'
                              : 'border-slate-200 text-slate-500 hover:text-slate-800'
                        }`}
                        style={
                          active
                            ? {
                                borderColor: `${sev.neon}70`,
                                color: sev.neon,
                                background: `${sev.neon}18`,
                                boxShadow: `0 0 10px ${sev.neon}20`,
                              }
                            : undefined
                        }
                      >
                        {sev.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Action Bar ── */}
              <div
                className="flex-shrink-0 flex items-center justify-between gap-2 px-3.5 py-2 border-b flex-wrap"
                style={{ borderColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.06)' }}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setUnreadOnly(v => !v)}
                    className={`px-2.5 py-1 rounded-full text-[9.5px] font-bold tracking-wider uppercase border transition-all ${
                      unreadOnly
                        ? isDark
                          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/50'
                          : 'bg-cyan-50 text-cyan-700 border-cyan-400'
                        : isDark
                          ? 'text-gray-400 border-white/10 hover:text-gray-200'
                          : 'text-slate-500 border-slate-200 hover:text-slate-800'
                    }`}
                  >
                    Unread Only
                  </button>

                  <button
                    type="button"
                    title="When enabled, low/medium-impact sentiment news will not trigger floating popups"
                    onClick={() => updatePreferences({ muteLowImpactNews: !preferences.muteLowImpactNews })}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9.5px] font-bold tracking-wider uppercase border transition-all ${
                      preferences.muteLowImpactNews
                        ? isDark
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                          : 'bg-amber-50 text-amber-700 border-amber-300'
                        : isDark
                          ? 'text-gray-500 border-white/10 hover:text-gray-300'
                          : 'text-slate-500 border-slate-200 hover:text-slate-700'
                    }`}
                  >
                    <SlidersHorizontal className="w-2.5 h-2.5" />
                    Mute Low News
                  </button>

                  <span className={`text-[9.5px] font-mono ${isDark ? 'text-gray-500' : 'text-slate-400'}`}>
                    {filteredNotifications.length} SHOWN
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void markAllRead(activeCategory)}
                    disabled={filteredNotifications.length === 0}
                    className={`inline-flex items-center gap-1 text-[9.5px] font-bold tracking-wider uppercase transition-colors disabled:opacity-35 ${
                      isDark
                        ? 'text-cyan-400 hover:text-cyan-300'
                        : 'text-cyan-700 hover:text-cyan-600'
                    }`}
                  >
                    <CheckCheck className="w-3 h-3" />
                    Mark All Read
                  </button>
                  <span className={isDark ? 'text-gray-700' : 'text-slate-300'}>|</span>
                  <button
                    type="button"
                    onClick={() => void clearAll(activeCategory)}
                    disabled={filteredNotifications.length === 0}
                    className={`inline-flex items-center gap-1 text-[9.5px] font-bold tracking-wider uppercase transition-colors disabled:opacity-35 ${
                      isDark
                        ? 'text-gray-400 hover:text-rose-400'
                        : 'text-slate-500 hover:text-rose-600'
                    }`}
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear
                  </button>
                </div>
              </div>

              {/* ── Notification List ── */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-thin">
                {filteredNotifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 py-10">
                    <div
                      className="w-14 h-14 rounded-2xl flex items-center justify-center"
                      style={{
                        background: isDark ? 'rgba(34,211,238,0.10)' : 'rgba(6,182,212,0.10)',
                        border: '1px solid rgba(34,211,238,0.28)',
                        boxShadow: '0 0 24px rgba(34,211,238,0.12)',
                      }}
                    >
                      <Bell className="w-6 h-6 text-cyan-400" />
                    </div>
                    <div className="text-center">
                      <p className={`text-xs font-black tracking-wider uppercase ${isDark ? 'text-cyan-300' : 'text-cyan-700'}`}>
                        {unreadOnly ? 'No Unread Notifications' : 'Inbox Clear'}
                      </p>
                      <p className={`text-[11px] mt-1 font-mono ${isDark ? 'text-gray-500' : 'text-slate-500'}`}>
                        Streaming Trade, WallHunter, News, ML &amp; Alert events
                      </p>
                    </div>
                  </div>
                ) : (
                  groupedNotifications.map(group => (
                    <div key={group.label} className="space-y-2">
                      <div
                        className={`sticky top-0 z-10 flex items-center gap-2 py-1 px-1 backdrop-blur-md ${
                          isDark ? 'bg-[#080a14]/85' : 'bg-slate-50/90'
                        }`}
                      >
                        <span
                          className={`text-[9px] font-black tracking-[0.18em] uppercase ${
                            isDark ? 'text-cyan-300/80' : 'text-cyan-700'
                          }`}
                        >
                          {group.label}
                        </span>
                        <div
                          className="flex-1 h-px"
                          style={{
                            background: isDark
                              ? 'linear-gradient(90deg, rgba(34,211,238,0.28), transparent)'
                              : 'linear-gradient(90deg, rgba(6,182,212,0.28), transparent)',
                          }}
                        />
                        <span
                          className={`text-[8.5px] font-mono px-1.5 py-0.5 rounded ${
                            isDark ? 'bg-white/5 text-gray-400' : 'bg-slate-200/70 text-slate-600'
                          }`}
                        >
                          {group.items.length}
                        </span>
                      </div>
                      {group.items.map(item => (
                        <NotificationCard
                          key={item.id}
                          item={item}
                          isDark={isDark}
                          onSelect={handleSelectCard}
                          onDismiss={id => void dismissOne(id)}
                          onMarkRead={id => void markRead(id)}
                          onNavigateRoute={handleNavigateRoute}
                        />
                      ))}
                    </div>
                  ))
                )}
              </div>

              {/* ── Footer ── */}
              <div
                className="flex-shrink-0 px-4 py-2 flex items-center justify-between border-t"
                style={{
                  borderColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.08)',
                  background: isDark ? 'rgba(0,0,0,0.30)' : 'rgba(15,23,42,0.02)',
                }}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[8.5px] font-black tracking-widest text-cyan-400/80">TRADE</span>
                  <span className="text-[8.5px] font-black tracking-widest text-violet-400/80">WALLHUNTER</span>
                  <span className="text-[8.5px] font-black tracking-widest text-emerald-400/80">NEWS</span>
                  <span className="text-[8.5px] font-black tracking-widest text-fuchsia-400/80">ML</span>
                  <span className="text-[8.5px] font-black tracking-widest text-amber-400/80">ALERTS</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`}
                  />
                  <p className={`text-[9px] font-mono tracking-wider ${isDark ? 'text-gray-500' : 'text-slate-500'}`}>
                    WS · {connected ? 'CONNECTED' : 'RECONNECTING'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default SystemNotificationWidget;
