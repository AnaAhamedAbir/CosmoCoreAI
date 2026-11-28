import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts';
import { Bell, BellOff, Crosshair, Download, Layers, Magnet } from 'lucide-react';
import Card from '@/components/common/Card';
import { useTheme } from '@/context/ThemeContext';
import { CollapseIcon, ExpandIcon } from '@/constants';
import {
    AggregatedStats,
    CldData,
    LiquidationEvent,
    normalizePairSymbol,
    useLiquidationWebSocket,
} from '../../hooks/useLiquidationWebSocket';
import { GodModeState, LiquidationPoolHorizon, useGodModeStream } from '../../hooks/useGodModeData';
import LiquidationBubbleChart from '@/components/features/trading/LiquidationBubbleChart';
import LiveLiquidityPoolChart from '@/components/features/market/LiveLiquidityPoolChart';
import PoolLadderPanel from '@/components/features/market/PoolLadderPanel';
import { formatCompactUsd, formatPairPrice } from '@/components/features/market/LiquidationCommandBar';
import { useUIStore } from '@/store/uiStore';
import { useBotStore } from '@/store/botStore';
import { useMarketStore } from '@/store/marketStore';

const SkullIcon = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2a7 7 0 0 0-7 7v1.53a4.004 4.004 0 0 0 .994 2.634L7.96 16H6a1 1 0 0 0 0 2h12a1 1 0 0 0 0-2h-1.96l1.966-2.836A4.004 4.004 0 0 0 19 10.53V9a7 7 0 0 0-7-7Zm-2.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
        <path d="M8 20a1 1 0 0 0 0 2h8a1 1 0 0 0 0-2H8Z" />
    </svg>
);

const FireIcon = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor">
        <path
            fillRule="evenodd"
            d="M12.963 2.286a.75.75 0 0 0-1.071-.136 9.742 9.742 0 0 0-3.539 6.177 7.547 7.547 0 0 1-1.705-1.715.75.75 0 0 0-1.152.082A9 9 0 1 0 15.68 4.534a7.46 7.46 0 0 1-2.717-2.248ZM15.75 14.25a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
            clipRule="evenodd"
        />
    </svg>
);

const KillFeedItem: React.FC<{
    event: LiquidationEvent;
    activePair: string;
    onTrackPrice: (price: number) => void;
}> = ({ event, activePair, onTrackPrice }) => {
    const isLong = event.type === 'Long';
    const bgColor = isLong ? 'bg-rose-500/5' : 'bg-emerald-500/5';
    const borderColor = isLong ? 'border-rose-500/20' : 'border-emerald-500/20';
    const textColor = isLong ? 'text-rose-500' : 'text-emerald-500';
    const iconWrapperBg = isLong ? 'bg-rose-500/10' : 'bg-emerald-500/10';
    const pairSource = event.symbol || activePair;
    const baseToken = pairSource ? pairSource.split(':')[0].split('/')[0] : '';
    const label = `${baseToken} ${isLong ? 'Long Rekt' : 'Short Rekt'}`;
    const priceDigits = event.price > 0 && event.price < 1 ? 4 : 2;

    return (
        <div
            onClick={() => onTrackPrice(Number(event.price.toFixed(priceDigits)))}
            className={`relative flex items-center justify-between p-2.5 mb-2 rounded-xl border ${borderColor} ${bgColor} ${
                event.isNew ? 'animate-fade-in-right' : ''
            } group overflow-hidden transition-colors hover:bg-slate-100/80 dark:hover:bg-white/5 cursor-pointer`}
            title="Click to pin this liquidation price on chart"
        >
            <div className="flex items-center gap-2.5 relative z-10">
                <div className={`p-1.5 rounded-lg ${iconWrapperBg} border ${borderColor}`}>
                    {event.isWhale ? <SkullIcon className={`w-4 h-4 ${textColor}`} /> : <FireIcon className={`w-4 h-4 ${textColor}`} />}
                </div>
                <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${textColor}`}>{label}</span>
                        <span className="text-[9px] text-slate-500 dark:text-gray-400 font-mono bg-slate-100 dark:bg-black/30 px-1 rounded">
                            {event.time}
                        </span>
                    </div>
                    <div className="text-xs font-mono font-bold text-slate-900 dark:text-white">
                        ${event.price.toLocaleString(undefined, { minimumFractionDigits: priceDigits, maximumFractionDigits: priceDigits })}
                    </div>
                </div>
            </div>

            <div className="text-right relative z-10 flex flex-col items-end gap-0.5">
                <div className={`font-bold font-mono ${event.isWhale ? 'text-sm' : 'text-xs'} ${textColor}`}>
                    ${event.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                {event.isWhale && (
                    <span className="text-[8px] bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 px-1.5 py-0.5 rounded uppercase font-bold border border-yellow-500/30">
                        Whale
                    </span>
                )}
            </div>
        </div>
    );
};

export interface StandardLiquidationViewProps {
    sharedExchange?: string;
    sharedPair?: string;
    sharedTimeframe?: string;
    sharedHorizon?: LiquidationPoolHorizon;
    sharedGodModeState?: GodModeState | null;
    sharedLiqStream?: {
        liveFeed: LiquidationEvent[];
        aggregatedStats: AggregatedStats;
        cldData: CldData[];
        currentPrice: number;
        priceUpdateStatus: 'up' | 'down' | 'none';
        isConnected: boolean;
    };
}

const StandardLiquidationView: React.FC<StandardLiquidationViewProps> = ({
    sharedExchange,
    sharedPair,
    sharedTimeframe,
    sharedHorizon,
    sharedGodModeState,
    sharedLiqStream,
}) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const widgetRef = useRef<any>(null);
    const chartApiRef = useRef<any>(null);
    const drawnLinesRef = useRef<any[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);
    const lastAlertEventIdRef = useRef<number | null>(null);

    const [isChartFullScreen, setIsChartFullScreen] = useState(false);
    const [widgetKey, setWidgetKey] = useState(Date.now());
    const [tvChartReady, setTvChartReady] = useState(false);
    const [feedFilter, setFeedFilter] = useState<'all' | 'long' | 'short' | 'whale'>('all');
    const [soundAlert, setSoundAlert] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [highlightLevelInput, setHighlightLevelInput] = useState('');

    // Fallback store values only if rendered standalone without LiquidationMap parent props
    const { globalExchange, globalSymbol } = useMarketStore();
    const selectedExchange = sharedExchange || globalExchange || 'binance';
    const activePair = sharedPair || globalSymbol || 'BTC/USDT';

    const { indicatorSettings } = useBotStore();
    const {
        liquidationChartWidth: chartWidth,
        setLiquidationChartWidth: setChartWidth,
        liquidationRightPanelTab: rightPanelTab,
        setLiquidationRightPanelTab: setRightPanelTab,
        liquidationHighlightedLevels: highlightedLevels,
        setLiquidationHighlightedLevels: setHighlightedLevels,
        liquidationMinThreshold: minLiquidationThreshold,
        setLiquidationMinThreshold: setMinLiquidationThreshold,
        liquidationChartView: chartView,
        setLiquidationChartView: setChartView,
        liquidationTimeframe,
    } = useUIStore();

    const activeTimeframe = sharedTimeframe || liquidationTimeframe || '15m';
    const activeHorizon: LiquidationPoolHorizon = sharedHorizon || indicatorSettings.liquidationPoolHorizon || '24h';

    const fallbackLiq = useLiquidationWebSocket(
        selectedExchange,
        activePair,
        !sharedLiqStream,
    );
    const liq = sharedLiqStream || fallbackLiq;
    const { liveFeed, aggregatedStats, cldData, currentPrice: wsPrice, priceUpdateStatus, isConnected } = liq;

    const fallbackGodMode = useGodModeStream(
        activePair.split(':')[0],
        !sharedGodModeState,
        selectedExchange.toLowerCase(),
        activeHorizon,
    );
    const godModeState = sharedGodModeState !== undefined ? sharedGodModeState : fallbackGodMode.state;

    const effectiveOraclePrice = wsPrice > 0 ? wsPrice : godModeState?.current_price || 0;

    // Optional Whale Sound Alert via Web Audio API
    useEffect(() => {
        if (!soundAlert || liveFeed.length === 0) return;
        const latest = liveFeed[0];
        if (!latest || latest.id === lastAlertEventIdRef.current) return;
        if (latest.amount >= Math.max(50000, minLiquidationThreshold)) {
            lastAlertEventIdRef.current = latest.id;
            try {
                const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
                if (AudioCtx) {
                    const ctx = new AudioCtx();
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.value = latest.type === 'Long' ? 420 : 660;
                    gain.gain.value = 0.04;
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.14);
                }
            } catch {
                // ignore audio permission issues
            }
        }
    }, [liveFeed, soundAlert, minLiquidationThreshold]);

    const toggleFullScreen = () => {
        setIsChartFullScreen((prev) => !prev);
        setWidgetKey(Date.now());
    };
    useEffect(() => {
        document.body.classList.toggle('body-no-scroll', isChartFullScreen);
    }, [isChartFullScreen]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
    }, []);
    const handleMouseUp = useCallback(() => {
        setIsResizing(false);
    }, []);
    const handleMouseMove = useCallback(
        (e: MouseEvent) => {
            if (isResizing && containerRef.current) {
                const bounds = containerRef.current.getBoundingClientRect();
                const newWidth = ((e.clientX - bounds.left) / bounds.width) * 100;
                if (newWidth > 48 && newWidth < 86) setChartWidth(newWidth);
            }
        },
        [isResizing, setChartWidth],
    );
    useEffect(() => {
        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, handleMouseMove, handleMouseUp]);

    // TradingView Widget (when user selects 'price' TradingView tab)
    useEffect(() => {
        if (chartView !== 'price') return;

        const containerId = isChartFullScreen
            ? `tradingview_fullscreen_liquidation_chart_${widgetKey}`
            : `tradingview_liquidation_chart_${widgetKey}`;

        const tvIntervalMap: Record<string, string> = {
            '1m': '1',
            '5m': '5',
            '15m': '15',
            '1h': '60',
            '4h': '240',
        };

        const createWidget = () => {
            const container = document.getElementById(containerId);
            if (!container) return;
            if (widgetRef.current) {
                try {
                    widgetRef.current.remove();
                } catch {}
                widgetRef.current = null;
            }

            const cleanTvPair = activePair.split(':')[0].replace('/', '');
            // @ts-ignore
            const widget = new window.TradingView.widget({
                symbol: `${selectedExchange.toUpperCase()}:${cleanTvPair}`,
                interval: tvIntervalMap[activeTimeframe] || '15',
                autosize: true,
                container_id: containerId,
                theme: theme === 'dark' ? 'Dark' : 'Light',
                style: '1',
                locale: 'en',
                toolbar_bg: theme === 'dark' ? '#141414' : '#FFFFFF',
                enable_publishing: false,
                hide_side_toolbar: false,
                allow_symbol_change: false,
                studies: ['Volume@tv-basicstudies'],
                onready: () => {
                    try {
                        chartApiRef.current = typeof widget.chart === 'function' ? widget.chart() : null;
                    } catch {
                        chartApiRef.current = null;
                    }
                    setTvChartReady(true);
                },
            });
            widgetRef.current = widget;
        };

        const checkLibraryAndCreate = () => {
            if (typeof window.TradingView !== 'undefined' && window.TradingView.widget) createWidget();
            else setTimeout(checkLibraryAndCreate, 120);
        };
        checkLibraryAndCreate();

        return () => {
            setTvChartReady(false);
            if (widgetRef.current) {
                try {
                    widgetRef.current.remove();
                } catch {}
                widgetRef.current = null;
                chartApiRef.current = null;
            }
        };
    }, [selectedExchange, activePair, activeTimeframe, theme, widgetKey, isChartFullScreen, chartView]);

    const handleToggleHighlight = useCallback(
        (level: number) => {
            if (isNaN(level) || level <= 0) return;
            const exists = highlightedLevels.some((l) => Math.abs(l - level) / level < 0.0002);
            if (exists) {
                setHighlightedLevels(highlightedLevels.filter((l) => Math.abs(l - level) / level >= 0.0002));
            } else {
                setHighlightedLevels([...highlightedLevels, level].sort((a, b) => b - a));
            }
        },
        [highlightedLevels, setHighlightedLevels],
    );

    const handleRemoveHighlight = (level: number) => {
        setHighlightedLevels(highlightedLevels.filter((l) => l !== level));
    };

    const handleHighlightSubmit = (e: FormEvent) => {
        e.preventDefault();
        const level = parseFloat(highlightLevelInput);
        if (!isNaN(level) && level > 0) {
            if (!highlightedLevels.includes(level)) {
                setHighlightedLevels([...highlightedLevels, level].sort((a, b) => b - a));
            }
            setHighlightLevelInput('');
        }
    };

    useEffect(() => {
        const chartApi = chartApiRef.current;
        if (tvChartReady && chartApi && typeof chartApi.createHorzLine === 'function') {
            drawnLinesRef.current.forEach((line) => {
                try {
                    chartApi.removeEntity(line.id);
                } catch {}
            });
            drawnLinesRef.current = [];
            highlightedLevels.forEach((level) => {
                try {
                    const line = chartApi.createHorzLine({
                        price: level,
                        text: `$${level.toLocaleString()}`,
                        lineStyle: 2,
                        lineColor: '#FBBF24',
                        textColor: '#000000',
                        backgroundColor: '#FBBF24',
                        showLabel: true,
                    });
                    drawnLinesRef.current.push(line);
                } catch {}
            });
        }
    }, [highlightedLevels, tvChartReady]);

    const filteredFeed = useMemo(() => {
        return liveFeed.filter((e) => {
            if (e.amount < minLiquidationThreshold) return false;
            if (e.symbol && normalizePairSymbol(e.symbol) !== normalizePairSymbol(activePair)) return false;
            if (feedFilter === 'long' && e.type !== 'Long') return false;
            if (feedFilter === 'short' && e.type !== 'Short') return false;
            if (feedFilter === 'whale' && !e.isWhale) return false;
            return true;
        });
    }, [liveFeed, minLiquidationThreshold, activePair, feedFilter]);

    const handleExportFeedCsv = () => {
        if (filteredFeed.length === 0) return;
        const headers = ['Timestamp', 'Time', 'Symbol', 'Side', 'Price', 'USD_Value', 'Is_Whale'];
        const rows = filteredFeed.map((e) => [
            e.timestamp,
            e.time,
            e.symbol || activePair,
            e.type,
            e.price,
            e.amount.toFixed(2),
            e.isWhale ? 'YES' : 'NO',
        ]);
        const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `liquidations_${activePair.replace('/', '-')}_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    const totalLiq = aggregatedStats.longLiqs + aggregatedStats.shortLiqs;
    const longRatio = totalLiq > 0 ? (aggregatedStats.longLiqs / totalLiq) * 100 : 50;

    const poolSummary = godModeState?.liquidation_pool_summary;
    const shortPoolsUsd = poolSummary?.total_short_liq_usd || 0;
    const longPoolsUsd = poolSummary?.total_long_liq_usd || 0;
    const totalPoolUsd = shortPoolsUsd + longPoolsUsd;
    const shortPoolPct = totalPoolUsd > 0 ? (shortPoolsUsd / totalPoolUsd) * 100 : 50;

    const deepL2 = godModeState?.deep_l2_summary;
    const pain = godModeState?.pain_threshold;

    return (
        <div className="flex flex-col h-full gap-3 overflow-hidden">
            {/* Pro Trader Edge HUD Strip */}
            <div className="flex-shrink-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 relative z-30">
                {/* 1. Untapped OI Liquidation Pools (Always populated from backend) */}
                <Card className="!p-4 bg-gradient-to-br from-white to-slate-50 dark:from-[#070B12] dark:to-[#0C121D] border-slate-200 dark:border-white/10 rounded-2xl shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5 text-cyan-500" />
                            OI Liq Pools ({activeHorizon.toUpperCase()})
                        </span>
                        <span
                            className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                                poolSummary?.dominant_side === 'ABOVE'
                                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25'
                                    : poolSummary?.dominant_side === 'BELOW'
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                                    : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-gray-400 border-slate-200 dark:border-white/10'
                            }`}
                        >
                            {poolSummary?.dominant_side || 'SYNCING'}
                        </span>
                    </div>
                    <div className="flex justify-between items-baseline text-xs font-mono font-bold mb-2">
                        <div>
                            <span className="block text-[9px] text-slate-500 dark:text-gray-400">Shorts Above</span>
                            <span className="text-sm text-rose-600 dark:text-rose-400">{formatCompactUsd(shortPoolsUsd)}</span>
                        </div>
                        <div className="text-right">
                            <span className="block text-[9px] text-slate-500 dark:text-gray-400">Longs Below</span>
                            <span className="text-sm text-emerald-600 dark:text-emerald-400">{formatCompactUsd(longPoolsUsd)}</span>
                        </div>
                    </div>
                    <div className="w-full h-2 bg-slate-200 dark:bg-black/50 rounded-full overflow-hidden flex">
                        <div className="h-full bg-rose-500 transition-all duration-500" style={{ width: `${shortPoolPct}%` }} />
                        <div className="h-full bg-emerald-500 flex-1 transition-all duration-500" />
                    </div>
                </Card>

                {/* 2. Nearest Magnetic Squeeze / Sweep Targets (Clickable!) */}
                <Card className="!p-4 bg-gradient-to-br from-white to-slate-50 dark:from-[#070B12] dark:to-[#0C121D] border-slate-200 dark:border-white/10 rounded-2xl shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 flex items-center gap-1.5">
                            <Magnet className="w-3.5 h-3.5 text-amber-500" />
                            Magnetic Pool Targets
                        </span>
                        <span className="text-[9px] font-mono text-slate-400">Click to track</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            disabled={!poolSummary?.nearest_short_pool}
                            onClick={() => poolSummary?.nearest_short_pool && handleToggleHighlight(poolSummary.nearest_short_pool.price)}
                            className="text-left p-2 rounded-xl bg-rose-500/[0.06] border border-rose-500/20 hover:border-rose-500/50 transition-all disabled:opacity-50"
                        >
                            <span className="block text-[9px] font-bold text-rose-600 dark:text-rose-400 uppercase">Short Squeeze ↑</span>
                            <span className="block text-xs font-mono font-black text-slate-900 dark:text-white mt-0.5">
                                {poolSummary?.nearest_short_pool ? formatPairPrice(poolSummary.nearest_short_pool.price) : '--'}
                            </span>
                            <span className="block text-[9px] font-mono text-slate-500 dark:text-gray-400">
                                {poolSummary?.nearest_short_pool
                                    ? `+${poolSummary.nearest_short_pool.dist_pct.toFixed(2)}% • ${formatCompactUsd(poolSummary.nearest_short_pool.estimated_usd)}`
                                    : 'No upper pool'}
                            </span>
                        </button>

                        <button
                            type="button"
                            disabled={!poolSummary?.nearest_long_pool}
                            onClick={() => poolSummary?.nearest_long_pool && handleToggleHighlight(poolSummary.nearest_long_pool.price)}
                            className="text-left p-2 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20 hover:border-emerald-500/50 transition-all disabled:opacity-50"
                        >
                            <span className="block text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Long Sweep ↓</span>
                            <span className="block text-xs font-mono font-black text-slate-900 dark:text-white mt-0.5">
                                {poolSummary?.nearest_long_pool ? formatPairPrice(poolSummary.nearest_long_pool.price) : '--'}
                            </span>
                            <span className="block text-[9px] font-mono text-slate-500 dark:text-gray-400">
                                {poolSummary?.nearest_long_pool
                                    ? `-${Math.abs(poolSummary.nearest_long_pool.dist_pct).toFixed(2)}% • ${formatCompactUsd(poolSummary.nearest_long_pool.estimated_usd)}`
                                    : 'No lower pool'}
                            </span>
                        </button>
                    </div>
                </Card>

                {/* 3. Session Rekt Volume + Long/Short Ratio */}
                <Card className="!p-4 bg-gradient-to-br from-white to-slate-50 dark:from-[#070B12] dark:to-[#0C121D] border-slate-200 dark:border-white/10 rounded-2xl shadow-sm">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 flex items-center gap-1.5">
                            <FireIcon className="w-3.5 h-3.5 text-rose-500" />
                            Session Rekt
                        </span>
                        <span className="text-sm font-mono font-black text-slate-900 dark:text-white">
                            {formatCompactUsd(aggregatedStats.totalVol)}
                        </span>
                    </div>
                    <div className="flex justify-between items-center text-[11px] font-mono font-bold mb-2">
                        <span className="text-rose-600 dark:text-rose-400">
                            Longs {formatCompactUsd(aggregatedStats.longLiqs)} ({longRatio.toFixed(0)}%)
                        </span>
                        <span className="text-emerald-600 dark:text-emerald-400">
                            Shorts {formatCompactUsd(aggregatedStats.shortLiqs)} ({(100 - longRatio).toFixed(0)}%)
                        </span>
                    </div>
                    <div className="w-full h-2 bg-slate-200 dark:bg-black/50 rounded-full overflow-hidden flex">
                        <div className="h-full bg-rose-500 transition-all duration-500" style={{ width: `${longRatio}%` }} />
                        <div className="h-full bg-emerald-500 flex-1 transition-all duration-500" />
                    </div>
                </Card>

                {/* 4. Min Threshold Filter + Deep L2 Wall Imbalance */}
                <Card className="!p-4 bg-gradient-to-br from-white to-slate-50 dark:from-[#070B12] dark:to-[#0C121D] border-slate-200 dark:border-white/10 rounded-2xl shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                            Min Filter: <span className="text-brand-primary font-mono">${(minLiquidationThreshold / 1000).toFixed(0)}k</span>
                        </span>
                        <div className="flex items-center gap-1">
                            {[0, 10000, 50000, 100000].map((val) => (
                                <button
                                    key={val}
                                    type="button"
                                    onClick={() => setMinLiquidationThreshold(val)}
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${
                                        minLiquidationThreshold === val
                                            ? 'bg-brand-primary text-white border-brand-primary'
                                            : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-gray-400 border-slate-200 dark:border-white/10'
                                    }`}
                                >
                                    {val === 0 ? 'All' : `${val / 1000}k`}
                                </button>
                            ))}
                        </div>
                    </div>

                    <input
                        type="range"
                        min="0"
                        max="100000"
                        step="5000"
                        value={minLiquidationThreshold}
                        onChange={(e) => setMinLiquidationThreshold(Number(e.target.value))}
                        className="w-full h-1.5 bg-slate-200 dark:bg-gray-800 rounded-lg appearance-none cursor-pointer accent-brand-primary my-1.5"
                    />

                    <div className="flex items-center justify-between text-[10px] font-mono pt-1 border-t border-slate-200/70 dark:border-white/10">
                        <span className="text-slate-500 dark:text-gray-400">
                            L2 Bias:{' '}
                            <strong
                                className={
                                    deepL2?.book_bias === 'BID_HEAVY'
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : deepL2?.book_bias === 'ASK_HEAVY'
                                        ? 'text-rose-600 dark:text-rose-400'
                                        : 'text-slate-700 dark:text-slate-300'
                                }
                            >
                                {deepL2?.book_bias || 'BALANCED'}
                            </strong>
                        </span>
                        <span className="text-slate-500 dark:text-gray-400">
                            Pain: <strong className={pain && pain.level >= 70 ? 'text-rose-500' : 'text-cyan-600 dark:text-cyan-400'}>{pain?.level ?? 0}%</strong>
                        </span>
                    </div>
                </Card>
            </div>

            {/* Main Split Workspace */}
            <div ref={containerRef} className="flex-1 flex gap-3 relative min-h-0">
                {isResizing && <div className="absolute inset-0 z-50 cursor-col-resize" />}

                {/* Left: Main Chart Container */}
                <div className="h-full flex flex-col relative min-w-0" style={{ width: `${chartWidth}%` }}>
                    <Card className="flex-1 min-h-0 relative !p-0 overflow-hidden border-slate-200 dark:border-white/10 shadow-lg bg-white dark:bg-[#05070C] rounded-2xl group">
                        {/* View Switcher & Oracle Pill (Top Left) */}
                        <div className="absolute top-3.5 left-3.5 z-20 flex items-center gap-2.5 flex-wrap">
                            <div className="flex bg-white/95 dark:bg-black/70 backdrop-blur-md rounded-xl p-1 shadow border border-slate-200 dark:border-white/10">
                                {[
                                    { key: 'heatmap', label: 'Liquidity Map' },
                                    { key: 'price', label: 'TradingView' },
                                    { key: 'bubbles', label: 'Bubbles' },
                                ].map((v) => (
                                    <button
                                        key={v.key}
                                        type="button"
                                        onClick={() => setChartView(v.key as any)}
                                        className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                                            chartView === v.key
                                                ? 'bg-brand-primary/15 text-brand-primary dark:text-white border border-brand-primary/40'
                                                : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                    >
                                        {v.label}
                                    </button>
                                ))}
                            </div>

                            {!isConnected && (
                                <span className="text-[9px] font-bold text-rose-500 bg-rose-500/10 px-2 py-1 rounded-lg border border-rose-500/25 animate-pulse">
                                    WS RECONNECTING
                                </span>
                            )}
                        </div>

                        {/* Chart Content */}
                        {chartView === 'heatmap' && (
                            <LiveLiquidityPoolChart
                                symbol={activePair}
                                exchange={selectedExchange}
                                timeframe={activeTimeframe}
                                oraclePrice={effectiveOraclePrice}
                                godModeData={godModeState}
                                highlightedLevels={highlightedLevels}
                                onToggleLevel={handleToggleHighlight}
                                isDark={isDark}
                            />
                        )}

                        {chartView === 'price' && (
                            <div id={`tradingview_liquidation_chart_${widgetKey}`} className="w-full h-full relative z-10" />
                        )}

                        {chartView === 'bubbles' && (
                            <LiquidationBubbleChart
                                data={liveFeed}
                                activePair={activePair}
                                activeExchange={selectedExchange}
                                timeframe={activeTimeframe}
                                onSelectPrice={(p) => handleToggleHighlight(Number(p.toFixed(p < 1 ? 4 : 2)))}
                            />
                        )}

                        {/* Floating Track Levels Toolbar */}
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-full max-w-xl px-4">
                            <div className="bg-white/95 dark:bg-[#05070C]/90 backdrop-blur-xl border border-slate-200 dark:border-white/10 rounded-2xl p-2 flex items-center gap-2.5 shadow-lg">
                                <span className="text-[10px] font-bold text-slate-600 dark:text-gray-300 uppercase tracking-wider px-1.5 whitespace-nowrap flex items-center gap-1.5">
                                    <Crosshair className="w-3.5 h-3.5 text-amber-500" />
                                    Track Levels
                                </span>

                                <form onSubmit={handleHighlightSubmit} className="flex gap-1.5 w-36 shrink-0">
                                    <input
                                        type="number"
                                        step="any"
                                        value={highlightLevelInput}
                                        onChange={(e) => setHighlightLevelInput(e.target.value)}
                                        placeholder="Price..."
                                        className="bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1 text-xs text-slate-900 dark:text-white outline-none w-full font-mono"
                                    />
                                    <button
                                        type="submit"
                                        className="bg-brand-primary/20 hover:bg-brand-primary/35 text-brand-primary border border-brand-primary/35 px-2.5 py-1 rounded-lg text-xs font-bold"
                                    >
                                        +
                                    </button>
                                </form>

                                <div className="flex-1 flex gap-1.5 overflow-x-auto no-scrollbar">
                                    {highlightedLevels.map((level) => (
                                        <span
                                            key={level}
                                            className="flex flex-shrink-0 items-center gap-1 bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 rounded-md px-2 py-0.5 text-[10px] font-mono font-bold"
                                        >
                                            ${level}
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveHighlight(level)}
                                                className="hover:text-rose-500 ml-0.5"
                                            >
                                                &times;
                                            </button>
                                        </span>
                                    ))}
                                    {highlightedLevels.length === 0 && (
                                        <span className="text-[10px] text-slate-400 dark:text-gray-500 italic px-1 py-0.5 whitespace-nowrap">
                                            Click any Pool/Magnet or enter price
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={toggleFullScreen}
                            className="absolute top-3.5 right-3.5 z-20 p-2 bg-white/95 dark:bg-black/60 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-xl text-slate-500 dark:text-gray-300 hover:text-slate-900 dark:hover:text-white shadow"
                            title="Fullscreen Chart"
                        >
                            <ExpandIcon />
                        </button>
                    </Card>
                </div>

                {/* Split Resizer */}
                <div
                    className="w-1.5 cursor-col-resize flex items-center justify-center group flex-shrink-0"
                    onMouseDown={handleMouseDown}
                >
                    <div
                        className={`h-16 w-1 rounded-full bg-slate-300 dark:bg-white/15 group-hover:bg-brand-primary transition-all ${
                            isResizing ? 'bg-brand-primary scale-x-150' : ''
                        }`}
                    />
                </div>

                {/* Right Quant Dock: Kill Feed / Pool Ladder / Analytics */}
                <div className="h-full flex flex-col min-w-0" style={{ width: `calc(${100 - chartWidth}% - 18px)` }}>
                    <Card className="flex-1 flex flex-col min-h-0 !p-0 border-slate-200 dark:border-white/10 shadow-lg bg-white dark:bg-[#05070C] rounded-2xl overflow-hidden">
                        {/* Tab Switcher */}
                        <div className="flex border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/40 shrink-0">
                            {[
                                { key: 'feed', label: `Kill Feed (${filteredFeed.length})` },
                                { key: 'pools', label: `OI Pools (${godModeState?.liquidation_pools?.length || 0})` },
                                { key: 'cld', label: 'CLD & Stats' },
                            ].map((t) => (
                                <button
                                    key={t.key}
                                    type="button"
                                    onClick={() => setRightPanelTab(t.key as any)}
                                    className={`flex-1 py-2.5 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider transition-all relative px-2 truncate ${
                                        rightPanelTab === t.key
                                            ? 'text-brand-primary bg-brand-primary/5 dark:bg-white/5'
                                            : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    {t.label}
                                    {rightPanelTab === t.key && (
                                        <div className="absolute bottom-0 left-0 w-full h-0.5 bg-brand-primary" />
                                    )}
                                </button>
                            ))}
                        </div>

                        <div className="flex-1 overflow-hidden relative">
                            {rightPanelTab === 'feed' && (
                                <div className="flex flex-col h-full">
                                    {/* Feed Filters & Export */}
                                    <div className="p-2.5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between gap-1.5 bg-slate-50/70 dark:bg-black/20 shrink-0">
                                        <div className="flex items-center gap-1">
                                            {[
                                                { key: 'all', label: 'All' },
                                                { key: 'long', label: 'Long' },
                                                { key: 'short', label: 'Short' },
                                                { key: 'whale', label: 'Whale' },
                                            ].map((f) => (
                                                <button
                                                    key={f.key}
                                                    type="button"
                                                    onClick={() => setFeedFilter(f.key as any)}
                                                    className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase border transition-colors ${
                                                        feedFilter === f.key
                                                            ? 'bg-brand-primary text-white border-brand-primary'
                                                            : 'bg-white dark:bg-white/5 text-slate-600 dark:text-gray-400 border-slate-200 dark:border-white/10'
                                                    }`}
                                                >
                                                    {f.label}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => setSoundAlert((s) => !s)}
                                                className={`p-1.5 rounded-lg border text-xs ${
                                                    soundAlert
                                                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/35'
                                                        : 'bg-white dark:bg-white/5 text-slate-500 dark:text-gray-400 border-slate-200 dark:border-white/10'
                                                }`}
                                                title={soundAlert ? 'Mute Whale Sound Alert' : 'Enable Whale Sound Alert'}
                                            >
                                                {soundAlert ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
                                            </button>
                                            <button
                                                type="button"
                                                disabled={filteredFeed.length === 0}
                                                onClick={handleExportFeedCsv}
                                                className="p-1.5 rounded-lg border bg-white dark:bg-white/5 text-slate-600 dark:text-gray-300 border-slate-200 dark:border-white/10 hover:border-cyan-500/40 disabled:opacity-40"
                                                title="Export Kill Feed CSV"
                                            >
                                                <Download className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                                        {filteredFeed.length === 0 ? (
                                            <div className="h-full flex flex-col items-center justify-center text-slate-500 dark:text-gray-400 space-y-3 text-center px-4">
                                                <div className="w-8 h-8 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
                                                <span className="text-[11px] uppercase tracking-wider font-mono">
                                                    {isConnected
                                                        ? `Listening for ${activePair} prints (>= $${(minLiquidationThreshold / 1000).toFixed(0)}k)...`
                                                        : 'Connecting to Liquidation Node...'}
                                                </span>
                                            </div>
                                        ) : (
                                            filteredFeed.map((e) => (
                                                <KillFeedItem
                                                    key={e.id}
                                                    event={e}
                                                    activePair={activePair}
                                                    onTrackPrice={handleToggleHighlight}
                                                />
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}

                            {rightPanelTab === 'pools' && (
                                <PoolLadderPanel
                                    godModeState={godModeState}
                                    currentPrice={effectiveOraclePrice}
                                    highlightedLevels={highlightedLevels}
                                    onToggleLevel={handleToggleHighlight}
                                />
                            )}

                            {rightPanelTab === 'cld' && (
                                <div className="flex flex-col h-full p-4 gap-3">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-xs font-bold text-slate-600 dark:text-gray-300 uppercase tracking-wider">
                                            Cumulative Liquidation Delta
                                        </h3>
                                        {cldData.length > 0 && (
                                            <span
                                                className={`text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-white/10 ${
                                                    cldData[cldData.length - 1].value >= 0
                                                        ? 'text-emerald-600 dark:text-emerald-400'
                                                        : 'text-rose-600 dark:text-rose-400'
                                                }`}
                                            >
                                                {cldData[cldData.length - 1].value >= 0 ? '+' : ''}
                                                {(cldData[cldData.length - 1].value / 1000).toFixed(1)}k
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex-1 min-h-0 bg-slate-50 dark:bg-black/25 rounded-xl border border-slate-200 dark:border-white/10 p-2">
                                        <ResponsiveContainer debounce={220} width="100%" height="100%">
                                            <AreaChart data={cldData}>
                                                <defs>
                                                    <linearGradient id="cldGradient" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.4} />
                                                        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <Tooltip
                                                    contentStyle={{
                                                        backgroundColor: isDark ? 'rgba(11, 17, 32, 0.95)' : 'rgba(255, 255, 255, 0.98)',
                                                        border: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid #e2e8f0',
                                                        borderRadius: '0.5rem',
                                                        color: isDark ? '#fff' : '#0f172a',
                                                        fontSize: '12px',
                                                        fontFamily: 'monospace',
                                                    }}
                                                    formatter={(v: number) => [
                                                        <span className={v >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                                                            {v >= 0 ? '+' : ''}${v.toLocaleString()}
                                                        </span>,
                                                        'Delta',
                                                    ]}
                                                    labelFormatter={() => ''}
                                                />
                                                <ReferenceLine y={0} stroke={isDark ? 'rgba(255,255,255,0.2)' : 'rgba(15,23,42,0.2)'} strokeDasharray="3 3" />
                                                <Area
                                                    type="monotone"
                                                    dataKey="value"
                                                    stroke="#3B82F6"
                                                    strokeWidth={2}
                                                    fill="url(#cldGradient)"
                                                    isAnimationActive={false}
                                                />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>

                                    <div className="flex justify-between text-[10px] font-mono border-t border-slate-200 dark:border-white/10 pt-2">
                                        <span className="text-emerald-600 dark:text-emerald-400">Positive = Short Squeeze Dominance</span>
                                        <span className="text-rose-600 dark:text-rose-400">Negative = Long Flush Dominance</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </Card>
                </div>
            </div>

            {/* Fullscreen Portal */}
            {isChartFullScreen && (
                <div className="fixed inset-0 z-[120] bg-white dark:bg-[#05070C]">
                    {chartView === 'heatmap' && (
                        <LiveLiquidityPoolChart
                            symbol={activePair}
                            exchange={selectedExchange}
                            timeframe={activeTimeframe}
                            oraclePrice={effectiveOraclePrice}
                            godModeData={godModeState}
                            highlightedLevels={highlightedLevels}
                            onToggleLevel={handleToggleHighlight}
                            isDark={isDark}
                        />
                    )}
                    {chartView === 'price' && (
                        <div id={`tradingview_fullscreen_liquidation_chart_${widgetKey}`} className="w-full h-full" />
                    )}
                    {chartView === 'bubbles' && (
                        <LiquidationBubbleChart
                            data={liveFeed}
                            activePair={activePair}
                            activeExchange={selectedExchange}
                            timeframe={activeTimeframe}
                            onSelectPrice={(p) => handleToggleHighlight(Number(p.toFixed(p < 1 ? 4 : 2)))}
                        />
                    )}
                    <button
                        type="button"
                        onClick={toggleFullScreen}
                        className="absolute top-4 right-4 z-30 p-2.5 bg-white/90 dark:bg-black/70 backdrop-blur-md rounded-xl text-slate-800 dark:text-white border border-slate-200 dark:border-white/15 shadow"
                    >
                        <CollapseIcon />
                    </button>
                </div>
            )}
        </div>
    );
};

export default StandardLiquidationView;
