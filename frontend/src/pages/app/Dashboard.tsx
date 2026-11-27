import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Sector,
} from 'recharts';
import {
    Wallet,
    TrendingUp,
    TrendingDown,
    Cpu,
    Activity,
    RefreshCw,
    ArrowUpRight,
    Zap,
    KeyRound,
    ShieldAlert,
    BarChart3,
    Layers,
    PieChart as PieChartIcon,
    FlaskConical,
    Sparkles,
    ChevronRight,
} from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useSettings } from '@/context/SettingsContext';
import { getDashboardSummary, DashboardSummary } from '@/services/dashboard';
import { getPerformanceMetrics, PerformanceMetrics } from '@/services/analytics';
import WhaleMovementWidget from './WhaleMovementWidget';
import SystemHealthWidget from '@/components/features/system/SystemHealthWidget';
import MarketStatusWidget from '@/components/features/market/MarketStatusWidget';
import EconomicCalendarWidget from '@/components/features/market/EconomicCalendarWidget';
import { useMarketStore } from '@/store/marketStore';
import { isThermalGuardActive } from '@/utils/deviceProfile';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';
import { buildAuthenticatedWsUrl } from '@/utils/wsAuth';
import { getPathFromView } from '@/utils/routeUtils';
import { AppView } from '@/types';

const formatCurrencyValue = (val: number, showSign = false): string => {
    const abs = Math.abs(val);
    const formatted = abs >= 1000
        ? abs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
        : abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (val < 0) return `-$${formatted}`;
    if (showSign && val > 0) return `+$${formatted}`;
    return `$${formatted}`;
};

const AnimatedNumber: React.FC<{
    value: number;
    isCurrency?: boolean;
    signedCurrency?: boolean;
    suffix?: string;
    decimals?: number;
}> = ({ value, isCurrency = false, signedCurrency = false, suffix = '', decimals = 1 }) => {
    const [displayValue, setDisplayValue] = useState<number>(() => (isThermalGuardActive() ? value : 0));
    const hasAnimatedRef = useRef(false);

    useEffect(() => {
        if (isThermalGuardActive() || hasAnimatedRef.current) {
            setDisplayValue(value);
            return;
        }
        hasAnimatedRef.current = true;
        if (value === 0) {
            setDisplayValue(0);
            return;
        }
        const duration = 650;
        const startTime = performance.now();
        let rafId = 0;

        const step = (now: number) => {
            const progress = Math.min(1, (now - startTime) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            setDisplayValue(value * eased);
            if (progress < 1) {
                rafId = requestAnimationFrame(step);
            } else {
                setDisplayValue(value);
            }
        };

        rafId = requestAnimationFrame(step);
        return () => cancelAnimationFrame(rafId);
    }, [value]);

    if (isCurrency) {
        return <span className="tabular-nums">{formatCurrencyValue(displayValue, signedCurrency)}</span>;
    }

    return (
        <span className="tabular-nums">
            {displayValue.toLocaleString(undefined, {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
            })}
            {suffix}
        </span>
    );
};

interface KpiCardProps {
    title: string;
    value: number;
    isCurrency?: boolean;
    signedCurrency?: boolean;
    suffix?: string;
    decimals?: number;
    change?: number;
    subtext?: string;
    icon: React.ReactNode;
    accentColor: 'cyan' | 'emerald' | 'indigo' | 'purple' | 'rose';
    compact?: boolean;
    onClick?: () => void;
}

const KPI_ACCENT_STYLES: Record<
    KpiCardProps['accentColor'],
    { bar: string; iconBg: string; borderHover: string }
> = {
    cyan: {
        bar: 'from-cyan-400 to-blue-500',
        iconBg: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/25',
        borderHover: 'hover:border-cyan-500/45',
    },
    emerald: {
        bar: 'from-emerald-400 to-teal-500',
        iconBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/25',
        borderHover: 'hover:border-emerald-500/45',
    },
    indigo: {
        bar: 'from-indigo-400 to-blue-600',
        iconBg: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/25',
        borderHover: 'hover:border-indigo-500/45',
    },
    purple: {
        bar: 'from-purple-400 to-fuchsia-500',
        iconBg: 'bg-purple-500/15 text-purple-600 dark:text-purple-300 border-purple-500/25',
        borderHover: 'hover:border-purple-500/45',
    },
    rose: {
        bar: 'from-rose-400 to-red-500',
        iconBg: 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/25',
        borderHover: 'hover:border-rose-500/45',
    },
};

const KpiCard: React.FC<KpiCardProps> = ({
    title,
    value,
    isCurrency = false,
    signedCurrency = false,
    suffix = '',
    decimals = 1,
    change,
    subtext,
    icon,
    accentColor,
    compact = false,
    onClick,
}) => {
    const styles = KPI_ACCENT_STYLES[accentColor];
    return (
        <div
            onClick={onClick}
            className={`relative group rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 ${styles.borderHover} overflow-hidden transition-all duration-200 shadow-sm hover:shadow-md dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)] ${
                compact ? 'p-3.5' : 'p-4 lg:p-5'
            } ${onClick ? 'cursor-pointer' : ''}`}
        >
            <div className={`h-[2px] w-full absolute top-0 left-0 bg-gradient-to-r ${styles.bar} opacity-80`} />

            <div className="flex items-start justify-between gap-2.5">
                <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 truncate">
                        {title}
                    </p>
                    <h3
                        className={`${
                            compact ? 'text-xl mt-1' : 'text-2xl xl:text-[26px] mt-1.5'
                        } font-black tracking-tight text-slate-900 dark:text-white font-mono truncate`}
                    >
                        <AnimatedNumber
                            value={value}
                            isCurrency={isCurrency}
                            signedCurrency={signedCurrency}
                            suffix={suffix}
                            decimals={decimals}
                        />
                    </h3>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {change !== undefined && (
                            <span
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10.5px] font-mono font-extrabold border ${
                                    change >= 0
                                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                                        : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                                }`}
                            >
                                {change >= 0 ? 'â–²' : 'â–¼'} {Math.abs(change).toFixed(2)}%
                            </span>
                        )}
                        {subtext && (
                            <span className="text-[11px] font-mono text-slate-500 dark:text-gray-400 truncate">
                                {subtext}
                            </span>
                        )}
                    </div>
                </div>

                <div className={`p-2.5 rounded-xl border shrink-0 ${styles.iconBg}`}>
                    {icon}
                </div>
            </div>
        </div>
    );
};

const ActiveShape = (props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload } = props;
    return (
        <g>
            <text x={cx} y={cy - 8} dy={6} textAnchor="middle" fill={fill} className="text-sm font-black font-mono dark:fill-white">
                {payload.name}
            </text>
            <text x={cx} y={cy + 12} dy={6} textAnchor="middle" fill="#94A3B8" className="text-xs font-mono font-bold">
                {`$${Number(payload.value || 0).toLocaleString()}`}
            </text>
            <Sector
                cx={cx}
                cy={cy}
                innerRadius={innerRadius}
                outerRadius={outerRadius + 7}
                startAngle={startAngle}
                endAngle={endAngle}
                fill={fill}
            />
            <Sector
                cx={cx}
                cy={cy}
                startAngle={startAngle}
                endAngle={endAngle}
                innerRadius={outerRadius + 10}
                outerRadius={outerRadius + 12}
                fill={fill}
            />
        </g>
    );
};

const DashboardSkeleton: React.FC = () => (
    <div className="space-y-5 animate-pulse p-1">
        <div className="h-20 rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10" />
            ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8 h-80 rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10" />
            <div className="lg:col-span-4 h-80 rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10" />
        </div>
    </div>
);

const Dashboard: React.FC = () => {
    const navigate = useNavigate();
    const { theme } = useTheme();
    const { userProfile, apiKeys } = useSettings();
    const { activeMarket } = useMarketStore();
    const deviceProfile = useDeviceProfile();
    const isPhoneMobileUI = deviceProfile.isPhoneMobileUI;
    const isThermalGuard = deviceProfile.isThermalGuardActive;

    const COLORS = ['#06B6D4', '#6366F1', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6'];

    const axisColor = theme === 'dark' ? '#94A3B8' : '#64748B';
    const gridColor = theme === 'dark' ? 'rgba(148,163,184,0.12)' : '#E2E8F0';
    const tooltipStyle = theme === 'dark'
        ? {
            backgroundColor: '#0a101d',
            border: '1px solid rgba(6, 182, 212, 0.35)',
            borderRadius: '12px',
            color: '#F8FAFC',
            boxShadow: '0 10px 25px rgba(0,0,0,0.6)',
        }
        : {
            backgroundColor: '#FFFFFF',
            border: '1px solid #CBD5E1',
            borderRadius: '12px',
            color: '#0F172A',
            boxShadow: '0 10px 25px rgba(15,23,42,0.08)',
        };

    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const [dashboardData, setDashboardData] = useState<DashboardSummary | null>(null);
    const [analyticsData, setAnalyticsData] = useState<PerformanceMetrics | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [wsStatus, setWsStatus] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
    const [activeTimeframe, setActiveTimeframe] = useState<'1W' | '1M' | '1Y' | 'ALL'>('1M');

    const onPieEnter = useCallback((_: any, index: number) => {
        setActiveIndex(index);
    }, []);

    const onPieLeave = useCallback(() => {
        setActiveIndex(null);
    }, []);

    const fetchDashboard = useCallback(async (manual = false) => {
        if (manual) setIsRefreshing(true);
        try {
            const [data, analytics] = await Promise.all([
                getDashboardSummary(),
                getPerformanceMetrics().catch(() => null),
            ]);
            setDashboardData(data);
            if (analytics) setAnalyticsData(analytics);
        } catch (error) {
            console.error('Failed to fetch dashboard data:', error);
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchDashboard(false);
    }, [fetchDashboard]);

    useEffect(() => {
        let cancelled = false;
        let ws: WebSocket | null = null;

        (async () => {
            const wsUrl = await buildAuthenticatedWsUrl('/api/v1/dashboard/ws');
            if (!wsUrl || cancelled) return;

            ws = new WebSocket(wsUrl);
            ws.onopen = () => {
                if (!cancelled) setWsStatus('live');
            };
            ws.onclose = () => {
                if (!cancelled) setWsStatus('reconnecting');
            };
            ws.onerror = () => {
                if (!cancelled) setWsStatus('reconnecting');
            };
            ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'DASHBOARD_UPDATE' && message.data) {
                        setDashboardData((prev) => (prev ? { ...prev, ...message.data } : message.data));
                    }
                } catch (err) {
                    console.error('WS Message Error', err);
                }
            };
        })();

        return () => {
            cancelled = true;
            if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
                ws.close();
            }
        };
    }, []);

    const goToView = useCallback((view: AppView, section?: string) => {
        const base = getPathFromView(view);
        navigate(section ? `${base}/${section}` : base);
    }, [navigate]);

    const displayName = useMemo(() => {
        const raw = userProfile?.fullName?.trim();
        if (raw && raw !== 'Loading...') return raw.split(' ')[0];
        const uname = userProfile?.username?.trim();
        if (uname && uname !== '...') return uname;
        return 'Trader';
    }, [userProfile?.fullName, userProfile?.username]);

    const totalPortfolioValue = dashboardData?.total_equity || 0;
    const profit24h = dashboardData?.total_profit_24h || 0;
    const equityChange24h = dashboardData?.equity_change_24h || 0;
    const totalBots = dashboardData?.active_bots || 0;
    const winRate = dashboardData?.avg_win_rate || 0;
    const bots = dashboardData?.bots || [];
    const recentBacktests = dashboardData?.recent_backtests || [];
    const portfolioValueData = dashboardData?.portfolio_value || [];
    const portfolioAllocationData = dashboardData?.portfolio_allocation || [];

    const filteredCurveData = useMemo(() => {
        if (portfolioValueData.length === 0) return [];
        const limits: Record<'1W' | '1M' | '1Y' | 'ALL', number> = {
            '1W': 7,
            '1M': 30,
            '1Y': 90,
            ALL: portfolioValueData.length,
        };
        const count = limits[activeTimeframe];
        return portfolioValueData.length > count
            ? portfolioValueData.slice(portfolioValueData.length - count)
            : portfolioValueData;
    }, [portfolioValueData, activeTimeframe]);

    const curveDeltaPct = useMemo(() => {
        if (filteredCurveData.length < 2) return null;
        const first = Number(filteredCurveData[0]?.value || 0);
        const last = Number(filteredCurveData[filteredCurveData.length - 1]?.value || 0);
        if (first <= 0) return null;
        return ((last - first) / first) * 100;
    }, [filteredCurveData]);

    const pulseInfo = useMemo(() => {
        if (equityChange24h > 0.1 || profit24h > 0) {
            return {
                label: 'Positive Momentum',
                dot: 'bg-emerald-500',
                badge: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
            };
        }
        if (equityChange24h < -0.1 || profit24h < 0) {
            return {
                label: 'Drawdown Watch',
                dot: 'bg-rose-500',
                badge: 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300',
            };
        }
        return {
            label: 'Neutral Session',
            dot: 'bg-cyan-500',
            badge: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-700 dark:text-cyan-300',
        };
    }, [equityChange24h, profit24h]);

    const quickActions = [
        {
            label: 'WallHunter L2',
            sub: 'Orderbook Bot',
            icon: <Zap className="w-4 h-4 text-amber-500" />,
            view: AppView.ORDER_FLOW_HEATMAP,
            accent: 'hover:border-amber-500/50 bg-amber-500/5 dark:bg-amber-500/10',
        },
        {
            label: 'Bot Lab',
            sub: 'Manage Bots',
            icon: <Cpu className="w-4 h-4 text-cyan-500" />,
            view: AppView.BOT_LAB,
            accent: 'hover:border-cyan-500/50 bg-cyan-500/5 dark:bg-cyan-500/10',
        },
        {
            label: 'Market Trade',
            sub: 'Live Charts',
            icon: <TrendingUp className="w-4 h-4 text-emerald-500" />,
            view: AppView.MARKET,
            accent: 'hover:border-emerald-500/50 bg-emerald-500/5 dark:bg-emerald-500/10',
        },
        {
            label: 'Backtester',
            sub: 'Simulate Edge',
            icon: <FlaskConical className="w-4 h-4 text-indigo-500" />,
            view: AppView.BACKTESTER,
            accent: 'hover:border-indigo-500/50 bg-indigo-500/5 dark:bg-indigo-500/10',
        },
        {
            label: 'AI Foundry',
            sub: 'ML Models',
            icon: <Sparkles className="w-4 h-4 text-purple-500" />,
            view: AppView.AI_FOUNDRY,
            accent: 'hover:border-purple-500/50 bg-purple-500/5 dark:bg-purple-500/10',
        },
        {
            label: 'Portfolio',
            sub: 'Balances',
            icon: <PieChartIcon className="w-4 h-4 text-pink-500" />,
            view: AppView.PORTFOLIO,
            accent: 'hover:border-pink-500/50 bg-pink-500/5 dark:bg-pink-500/10',
        },
    ];

    if (isLoading && !dashboardData) {
        return <DashboardSkeleton />;
    }

    return (
        <div className={`${isPhoneMobileUI ? 'space-y-3.5' : 'space-y-5'} pb-4`}>
            {/* â”€â”€ Top SaaS Command Header Bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <div className="relative rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-cyan-500/25 p-4 lg:p-5 shadow-sm dark:shadow-[0_12px_32px_rgba(0,0,0,0.55)] overflow-hidden">
                <div className="h-[2px] w-full absolute top-0 left-0 bg-gradient-to-r from-cyan-400 via-indigo-500 to-emerald-400 opacity-85" />

                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                    <div className="space-y-1.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-700 dark:text-cyan-300 text-[10px] font-mono font-black uppercase tracking-wider">
                                <span className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'live' ? 'bg-emerald-400' : 'bg-amber-400'} ${!isThermalGuard ? 'animate-pulse' : ''}`} />
                                {wsStatus === 'live' ? 'Live Telemetry' : wsStatus === 'connecting' ? 'Connecting WS' : 'Syncing'}
                            </span>
                            {userProfile?.plan_tier && (
                                <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/35 text-amber-700 dark:text-amber-300 text-[10px] font-mono font-black uppercase">
                                    {userProfile.plan_tier} PLAN
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={() => goToView(AppView.SETTINGS, 'api-keys')}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300 text-[10px] font-mono font-bold transition-colors cursor-pointer"
                                title="Manage Exchange API Keys"
                            >
                                <KeyRound className="w-3 h-3 text-cyan-500" />
                                <span>{apiKeys.length} API {apiKeys.length === 1 ? 'Key' : 'Keys'}</span>
                            </button>
                        </div>

                        <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                            <span>Command Center</span>
                        </h1>
                        <p className="text-xs sm:text-sm text-slate-500 dark:text-gray-400">
                            Welcome back, <span className="text-cyan-600 dark:text-cyan-300 font-bold">{displayName}</span>. Monitor equity, active automation, and risk telemetry in real time.
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-mono font-bold ${pulseInfo.badge}`}>
                            <span className={`w-2 h-2 rounded-full ${pulseInfo.dot} ${!isThermalGuard ? 'animate-pulse' : ''}`} />
                            <span>{pulseInfo.label}</span>
                        </div>

                        <button
                            type="button"
                            onClick={() => fetchDashboard(true)}
                            disabled={isRefreshing}
                            className="p-2 rounded-xl bg-slate-100 dark:bg-[#0a101d] hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300 transition-colors cursor-pointer disabled:opacity-50"
                            title="Refresh Dashboard Metrics"
                        >
                            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-cyan-500' : ''}`} />
                        </button>

                        <button
                            type="button"
                            onClick={() => goToView(AppView.ORDER_FLOW_HEATMAP)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:brightness-110 text-white text-xs font-mono font-black uppercase tracking-wider shadow-[0_4px_16px_rgba(6,182,212,0.3)] transition-all cursor-pointer active:scale-95"
                        >
                            <Zap className="w-3.5 h-3.5 fill-current" />
                            <span>Open WallHunter</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* â”€â”€ Row 1: 4 SaaS KPI Cards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <div className={`grid ${isPhoneMobileUI ? 'grid-cols-2 gap-2.5' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'}`}>
                <KpiCard
                    title="Total Equity"
                    value={totalPortfolioValue}
                    isCurrency
                    change={dashboardData?.equity_change_24h}
                    subtext="24h"
                    icon={<Wallet className={isPhoneMobileUI ? 'w-4 h-4' : 'w-5 h-5'} />}
                    accentColor="cyan"
                    compact={isPhoneMobileUI}
                    onClick={() => goToView(AppView.PORTFOLIO)}
                />
                <KpiCard
                    title="24h Net PnL"
                    value={profit24h}
                    isCurrency
                    signedCurrency
                    change={dashboardData?.profit_change_24h}
                    subtext="24h"
                    icon={profit24h >= 0 ? <TrendingUp className={isPhoneMobileUI ? 'w-4 h-4' : 'w-5 h-5'} /> : <TrendingDown className={isPhoneMobileUI ? 'w-4 h-4' : 'w-5 h-5'} />}
                    accentColor={profit24h >= 0 ? 'emerald' : 'rose'}
                    compact={isPhoneMobileUI}
                />
                <KpiCard
                    title="Active Bots"
                    value={totalBots}
                    decimals={0}
                    subtext={`${bots.length} monitored`}
                    icon={<Cpu className={isPhoneMobileUI ? 'w-4 h-4' : 'w-5 h-5'} />}
                    accentColor="indigo"
                    compact={isPhoneMobileUI}
                    onClick={() => goToView(AppView.BOT_LAB)}
                />
                <KpiCard
                    title="Avg Win Rate"
                    value={winRate}
                    suffix="%"
                    decimals={1}
                    change={dashboardData?.win_rate_change_24h}
                    subtext={analyticsData ? `${analyticsData.total_trades} trades` : 'all bots'}
                    icon={<Activity className={isPhoneMobileUI ? 'w-4 h-4' : 'w-5 h-5'} />}
                    accentColor="purple"
                    compact={isPhoneMobileUI}
                />
            </div>

            {/* â”€â”€ Row 2: Equity Curve + Capital Allocation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Portfolio Performance Curve */}
                <div className="lg:col-span-8 rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 lg:p-5 shadow-sm dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)] flex flex-col">
                    <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-base font-black text-slate-900 dark:text-white tracking-tight">
                                    Portfolio Equity Curve
                                </h2>
                                {curveDeltaPct !== null && (
                                    <span
                                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-black border ${
                                            curveDeltaPct >= 0
                                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                                                : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                                        }`}
                                    >
                                        {curveDeltaPct >= 0 ? '+' : ''}{curveDeltaPct.toFixed(2)}% ({activeTimeframe})
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-gray-400">
                                Net asset value progression across connected accounts
                            </p>
                        </div>

                        <div className="flex bg-slate-100 dark:bg-[#0a101d] p-0.5 rounded-lg border border-slate-200 dark:border-white/10 gap-0.5">
                            {(['1W', '1M', '1Y', 'ALL'] as const).map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setActiveTimeframe(t)}
                                    className={`text-[11px] font-mono px-2.5 py-1 rounded-md font-extrabold transition-all cursor-pointer ${
                                        t === activeTimeframe
                                            ? 'bg-cyan-500 text-slate-950 shadow'
                                            : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="h-64 sm:h-72 w-full min-h-[240px]">
                        {filteredCurveData.length > 0 ? (
                            <ResponsiveContainer debounce={220} width="100%" height="100%">
                                <AreaChart data={filteredCurveData}>
                                    <defs>
                                        <linearGradient id="portfolioGradientSaaS" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.35} />
                                            <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                                    <XAxis dataKey="name" stroke={axisColor} fontSize={11} tickLine={false} axisLine={false} dy={8} />
                                    <YAxis
                                        stroke={axisColor}
                                        tickFormatter={(value) => {
                                            const n = Number(value);
                                            return Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;
                                        }}
                                        fontSize={11}
                                        tickLine={false}
                                        axisLine={false}
                                        width={54}
                                    />
                                    <Tooltip
                                        contentStyle={tooltipStyle}
                                        formatter={(val: any) => [formatCurrencyValue(Number(val || 0)), 'Equity']}
                                        cursor={{ stroke: '#06B6D4', strokeWidth: 1, strokeDasharray: '4 4' }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="value"
                                        stroke="#06B6D4"
                                        strokeWidth={2.5}
                                        fillOpacity={1}
                                        fill="url(#portfolioGradientSaaS)"
                                        isAnimationActive={!isThermalGuard}
                                        activeDot={{ r: 5, strokeWidth: 2, stroke: '#06B6D4', fill: '#fff' }}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-center rounded-xl bg-slate-50 dark:bg-[#0a101d]/60 border border-dashed border-slate-200 dark:border-white/10 p-6">
                                <BarChart3 className="w-8 h-8 text-cyan-500/60 mb-2" />
                                <p className="text-sm font-bold text-slate-700 dark:text-gray-200">No Equity History Yet</p>
                                <p className="text-xs text-slate-500 dark:text-gray-400 mt-1 max-w-xs">
                                    Connect an exchange API key or execute your first bot cycle to start tracking equity curves.
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Capital Allocation Donut */}
                <div className="lg:col-span-4 rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 lg:p-5 shadow-sm dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)] flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                        <div>
                            <h2 className="text-base font-black text-slate-900 dark:text-white tracking-tight">
                                Capital Allocation
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-gray-400">Holdings distribution</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => goToView(AppView.PORTFOLIO)}
                            className="text-[11px] font-mono font-bold text-cyan-600 dark:text-cyan-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                        >
                            <span>Portfolio</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    {portfolioAllocationData.length > 0 ? (() => {
                        const totalAlloc = portfolioAllocationData.reduce((acc, item) => acc + Number(item.value || 0), 0);
                        return (
                        <>
                            <div className="h-[205px] w-full relative">
                                {activeIndex === null && (
                                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                                        <span className="text-[10px] font-mono uppercase text-slate-500 dark:text-gray-400 font-bold">Total</span>
                                        <span className="text-sm font-mono font-black text-slate-900 dark:text-white">
                                            {formatCurrencyValue(totalAlloc || totalPortfolioValue)}
                                        </span>
                                    </div>
                                )}
                                <ResponsiveContainer debounce={220} width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={portfolioAllocationData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={56}
                                            outerRadius={76}
                                            dataKey="value"
                                            isAnimationActive={!isThermalGuard}
                                            {...({ activeIndex: activeIndex !== null ? activeIndex : undefined } as any)}
                                            activeShape={ActiveShape}
                                            onMouseEnter={onPieEnter}
                                            onMouseLeave={onPieLeave}
                                            paddingAngle={4}
                                            cornerRadius={4}
                                        >
                                            {portfolioAllocationData.map((_, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
                                            ))}
                                        </Pie>
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-slate-100 dark:border-white/10">
                                {portfolioAllocationData.slice(0, 6).map((item, idx) => {
                                    const pct = totalAlloc > 0 ? ((Number(item.value || 0) / totalAlloc) * 100).toFixed(0) : '0';
                                    return (
                                        <div key={item.name} className="flex items-center justify-between text-[11px] font-mono px-2 py-1 rounded-lg bg-slate-50 dark:bg-[#0a101d]">
                                            <span className="flex items-center gap-1.5 truncate text-slate-700 dark:text-gray-300 font-bold">
                                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                                                <span className="truncate">{item.name}</span>
                                            </span>
                                            <span className="text-slate-500 dark:text-gray-400 shrink-0 ml-1">
                                                {pct}%
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                        );
                    })() : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center rounded-xl bg-slate-50 dark:bg-[#0a101d]/60 border border-dashed border-slate-200 dark:border-white/10 p-6 min-h-[220px]">
                            <PieChartIcon className="w-8 h-8 text-indigo-500/60 mb-2" />
                            <p className="text-sm font-bold text-slate-700 dark:text-gray-200">No Allocation Data</p>
                            <button
                                type="button"
                                onClick={() => goToView(AppView.PORTFOLIO)}
                                className="mt-2 px-3 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/35 text-indigo-600 dark:text-indigo-300 text-xs font-mono font-bold cursor-pointer"
                            >
                                Sync Balances
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* â”€â”€ Row 3: Balanced Operations Grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                {/* Left Column (7/12): Active Bot Matrix + Risk Analytics + Recent Backtests */}
                <div className="lg:col-span-7 space-y-4">
                    {/* Active Bot Matrix */}
                    <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 lg:p-5 shadow-sm dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
                        <div className="flex justify-between items-center mb-3.5">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/25 text-cyan-600 dark:text-cyan-300">
                                    <Cpu className="w-4 h-4" />
                                </div>
                                <div>
                                    <h2 className="text-base font-black text-slate-900 dark:text-white tracking-tight">
                                        Active Bot Matrix
                                    </h2>
                                    <p className="text-[11px] text-slate-500 dark:text-gray-400">
                                        {bots.length > 0 ? `${totalBots} active automated engines` : 'No running bots detected'}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => goToView(AppView.BOT_LAB)}
                                className="text-xs font-mono font-bold text-cyan-600 dark:text-cyan-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                            >
                                <span>Manage All</span>
                                <ArrowUpRight className="w-3.5 h-3.5" />
                            </button>
                        </div>

                        {bots.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {bots.map((bot) => {
                                    const isProfit = bot.pnl >= 0;
                                    const progressWidth = Math.min(Math.max(Math.abs(bot.pnl_percent) * 4, 8), 100);
                                    return (
                                        <div
                                            key={bot.id}
                                            onClick={() => goToView(AppView.BOT_LAB)}
                                            className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#0a101d] border border-slate-200 dark:border-white/10 hover:border-cyan-500/45 transition-all cursor-pointer group"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span
                                                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                                                            isProfit ? 'bg-emerald-500' : 'bg-rose-500'
                                                        } ${!isThermalGuard ? 'animate-pulse' : ''}`}
                                                    />
                                                    <div className="min-w-0">
                                                        <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-cyan-600 dark:group-hover:text-cyan-300 transition-colors truncate">
                                                            {bot.name}
                                                        </h4>
                                                        <p className="text-[11px] font-mono text-slate-500 dark:text-gray-400 truncate">
                                                            {bot.market} â€¢ {bot.strategy}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="text-right shrink-0 font-mono">
                                                    <p className={`font-black text-sm ${isProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                        {formatCurrencyValue(bot.pnl, true)}
                                                    </p>
                                                    <p className="text-[10.5px] text-slate-500 dark:text-gray-400">
                                                        {bot.pnl_percent >= 0 ? '+' : ''}{bot.pnl_percent}%
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="w-full bg-slate-200 dark:bg-white/10 h-1 rounded-full mt-2.5 overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-300 ${isProfit ? 'bg-emerald-500' : 'bg-rose-500'}`}
                                                    style={{ width: `${progressWidth}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="rounded-xl bg-slate-50 dark:bg-[#0a101d]/70 border border-dashed border-slate-200 dark:border-white/10 p-6 text-center space-y-2.5">
                                <Layers className="w-7 h-7 text-cyan-500/60 mx-auto" />
                                <div>
                                    <p className="text-sm font-bold text-slate-800 dark:text-gray-200">No Active Bots Running</p>
                                    <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                                        Deploy an L2 WallHunter sniper or configure a Grid/DCA strategy in Bot Lab.
                                    </p>
                                </div>
                                <div className="flex items-center justify-center gap-2 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => goToView(AppView.ORDER_FLOW_HEATMAP)}
                                        className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-700 dark:text-amber-300 text-xs font-mono font-bold cursor-pointer"
                                    >
                                        âš¡ Launch WallHunter
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => goToView(AppView.BOT_LAB)}
                                        className="px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-700 dark:text-cyan-300 text-xs font-mono font-bold cursor-pointer"
                                    >
                                        Open Bot Lab
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Risk & Quant Telemetry Card */}
                    <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 lg:p-5 shadow-sm dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)] space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 rounded-lg bg-rose-500/15 border border-rose-500/25 text-rose-600 dark:text-rose-400">
                                    <ShieldAlert className="w-4 h-4" />
                                </div>
                                <h2 className="text-base font-black text-slate-900 dark:text-white tracking-tight">
                                    Risk & Execution Telemetry
                                </h2>
                            </div>
                            <span className="text-[10.5px] font-mono text-slate-500 dark:text-gray-400">
                                Cumulative Analytics
                            </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                            <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0a101d] border border-slate-200/80 dark:border-white/10">
                                <p className="text-[10px] font-mono font-bold text-slate-500 dark:text-gray-400 uppercase">Sharpe Ratio</p>
                                <p className="text-lg font-mono font-black text-cyan-600 dark:text-cyan-300 mt-0.5">
                                    {analyticsData?.sharpe_ratio?.toFixed(2) || '0.00'}
                                </p>
                            </div>
                            <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0a101d] border border-slate-200/80 dark:border-white/10">
                                <p className="text-[10px] font-mono font-bold text-slate-500 dark:text-gray-400 uppercase">Win Rate</p>
                                <p className="text-lg font-mono font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                                    {analyticsData?.win_rate?.toFixed(1) || '0.0'}%
                                </p>
                            </div>
                            <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0a101d] border border-slate-200/80 dark:border-white/10">
                                <p className="text-[10px] font-mono font-bold text-slate-500 dark:text-gray-400 uppercase">Total Trades</p>
                                <p className="text-lg font-mono font-black text-slate-900 dark:text-white mt-0.5">
                                    {analyticsData?.total_trades ?? 0}
                                </p>
                            </div>
                            <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0a101d] border border-slate-200/80 dark:border-white/10">
                                <p className="text-[10px] font-mono font-bold text-slate-500 dark:text-gray-400 uppercase">Total PnL</p>
                                <p className={`text-lg font-mono font-black mt-0.5 ${(analyticsData?.total_pnl || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                    {formatCurrencyValue(analyticsData?.total_pnl || 0, true)}
                                </p>
                            </div>
                        </div>

                        <div className="p-3 rounded-xl bg-rose-50/70 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-500/25">
                            <div className="flex justify-between items-center mb-1.5">
                                <span className="text-[11px] font-mono font-black text-rose-700 dark:text-rose-300 uppercase tracking-wider">
                                    Max Drawdown Guard
                                </span>
                                <span className="text-sm font-mono font-black text-rose-700 dark:text-rose-300">
                                    {analyticsData?.max_drawdown?.toFixed(2) || '0.00'}%
                                </span>
                            </div>
                            <div className="w-full bg-rose-200/70 dark:bg-rose-950/60 h-1.5 rounded-full overflow-hidden">
                                <div
                                    className="bg-gradient-to-r from-amber-500 to-rose-500 h-full rounded-full transition-all duration-300"
                                    style={{ width: `${Math.min(analyticsData?.max_drawdown || 0, 100)}%` }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Recent Backtests */}
                    <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 lg:p-5 shadow-sm dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
                        <div className="flex justify-between items-center mb-3">
                            <h2 className="text-base font-black text-slate-900 dark:text-white tracking-tight">
                                Recent Backtests
                            </h2>
                            <button
                                type="button"
                                onClick={() => goToView(AppView.BACKTESTER)}
                                className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                            >
                                <span>Open Backtester</span>
                                <ArrowUpRight className="w-3.5 h-3.5" />
                            </button>
                        </div>

                        {recentBacktests.length > 0 ? (
                            <div className="space-y-2">
                                {recentBacktests.slice(0, 4).map((result) => (
                                    <div
                                        key={result.id}
                                        onClick={() => goToView(AppView.BACKTESTER)}
                                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-[#0a101d] border border-slate-200/70 dark:border-white/10 hover:border-indigo-500/40 transition-colors cursor-pointer"
                                    >
                                        <div className="min-w-0">
                                            <p className="font-bold text-sm text-slate-900 dark:text-white truncate">{result.strategy}</p>
                                            <p className="text-[11px] font-mono text-slate-500 dark:text-gray-400">
                                                {result.market} â€¢ {result.timeframe} â€¢ WR {result.win_rate}% â€¢ Sharpe {result.sharpe_ratio}
                                            </p>
                                        </div>
                                        <span
                                            className={`px-2 py-1 rounded-lg text-xs font-mono font-black shrink-0 ${
                                                result.profit_percent >= 0
                                                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                                                    : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30'
                                            }`}
                                        >
                                            {result.profit_percent > 0 ? '+' : ''}{result.profit_percent}%
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="rounded-xl bg-slate-50 dark:bg-[#0a101d]/70 border border-dashed border-slate-200 dark:border-white/10 p-5 text-center">
                                <p className="text-xs font-mono text-slate-500 dark:text-gray-400">
                                    No recent backtests recorded.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => goToView(AppView.BACKTESTER)}
                                    className="mt-2 px-3 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/35 text-indigo-600 dark:text-indigo-300 text-xs font-mono font-bold cursor-pointer"
                                >
                                    Run Strategy Backtest
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column (5/12): Quick Launch Command Grid + System & Market Intelligence */}
                <div className="lg:col-span-5 space-y-4">
                    {/* Quick Launch Command Grid */}
                    <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-cyan-500/25 p-4 lg:p-5 shadow-sm dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <h2 className="text-base font-black text-slate-900 dark:text-white tracking-tight">
                                    Quick Launch
                                </h2>
                                <p className="text-[11px] text-slate-500 dark:text-gray-400">
                                    Jump directly to any execution or research desk
                                </p>
                            </div>
                            <span className="px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/25 text-cyan-700 dark:text-cyan-300 text-[10px] font-mono font-bold">
                                6 DESKS
                            </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2.5">
                            {quickActions.map((act) => (
                                <button
                                    key={act.label}
                                    type="button"
                                    onClick={() => goToView(act.view)}
                                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200/80 dark:border-white/10 ${act.accent} transition-all cursor-pointer text-left group active:scale-[0.98]`}
                                >
                                    <div className="w-8 h-8 rounded-lg bg-white dark:bg-[#0a101d] border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                                        {act.icon}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{act.label}</p>
                                        <p className="text-[10px] font-mono text-slate-500 dark:text-gray-400 truncate">{act.sub}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* TradFi Session & Calendar Widgets */}
                    <MarketStatusWidget />
                    <EconomicCalendarWidget />

                    {/* System Health & Whale Feed (Crypto Active) */}
                    {activeMarket === 'crypto' && <SystemHealthWidget />}
                    {activeMarket === 'crypto' && <WhaleMovementWidget />}
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
