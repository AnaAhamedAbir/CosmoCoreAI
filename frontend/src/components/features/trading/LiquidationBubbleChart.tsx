import React, { useEffect, useMemo, useState } from 'react';
import {
    ResponsiveContainer,
    ComposedChart,
    Scatter,
    Line,
    XAxis,
    YAxis,
    ZAxis,
    Tooltip,
    Cell,
    CartesianGrid,
} from 'recharts';
import { useTheme } from '@/context/ThemeContext';
import { LiquidationEvent, normalizePairSymbol } from '@/hooks/useLiquidationWebSocket';

interface LiquidationBubbleChartProps {
    data: LiquidationEvent[];
    activePair: string;
    activeExchange?: string;
    timeframe?: string;
    onSelectPrice?: (price: number) => void;
}

interface CandleData {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

const LiquidationBubbleChart: React.FC<LiquidationBubbleChartProps> = ({
    data,
    activePair,
    activeExchange = 'binance',
    timeframe = '15m',
    onSelectPrice,
}) => {
    const { theme } = useTheme();
    const [candles, setCandles] = useState<CandleData[]>([]);

    useEffect(() => {
        const fetchCandles = async () => {
            try {
                const cleanSymbol = activePair.split(':')[0];
                const params = new URLSearchParams({
                    symbol: cleanSymbol,
                    exchange: (activeExchange || 'binance').toLowerCase(),
                    interval: timeframe || '15m',
                    limit: '60',
                });
                const response = await fetch(`/api/v1/liquidation/candles?${params.toString()}`);
                const formatted: CandleData[] = await response.json();
                if (Array.isArray(formatted)) {
                    setCandles(
                        formatted.map((c) => ({
                            ...c,
                            time: c.time < 10_000_000_000 ? c.time * 1000 : c.time,
                        })),
                    );
                } else {
                    setCandles([]);
                }
            } catch (error) {
                console.error('Failed to fetch candles', error);
                setCandles([]);
            }
        };

        if (activePair) {
            fetchCandles();
        }
    }, [activePair, activeExchange, timeframe]);

    const targetSym = normalizePairSymbol(activePair);
    const bubbleData = useMemo(
        () =>
            data
                .filter((event) => !event.symbol || normalizePairSymbol(event.symbol) === targetSym)
                .map((event) => {
                    const ts = event.timestamp < 10_000_000_000 ? event.timestamp * 1000 : event.timestamp || Date.now();
                    return {
                        ...event,
                        displayTime: event.time,
                        time: ts,
                        x: ts,
                        y: event.price,
                        close: event.price,
                        z: event.amount,
                    };
                }),
        [data, targetSym],
    );

    const xDomain = useMemo<[number | 'auto', number | 'auto']>(() => {
        const times = [
            ...candles.map((c) => c.time),
            ...bubbleData.map((b) => b.time),
        ].filter((t) => Number.isFinite(t) && t > 0);
        if (times.length === 0) return ['auto', 'auto'];
        const minT = Math.min(...times);
        const maxT = Math.max(...times);
        const pad = Math.max(60_000, Math.round((maxT - minT) * 0.04));
        return [minT - pad, maxT + pad];
    }, [candles, bubbleData]);

    const summary = useMemo(() => {
        let longUsd = 0;
        let shortUsd = 0;
        let maxEvent: (typeof bubbleData)[0] | null = null;
        for (const b of bubbleData) {
            if (b.type === 'Long') longUsd += b.amount;
            else shortUsd += b.amount;
            if (!maxEvent || b.amount > maxEvent.amount) maxEvent = b;
        }
        return { longUsd, shortUsd, count: bubbleData.length, maxEvent };
    }, [bubbleData]);

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const dataPoint = payload[0].payload;

            if (dataPoint.type) {
                const isLong = dataPoint.type === 'Long';
                const colorClass = isLong ? 'text-rose-500' : 'text-emerald-500';
                const borderColor = isLong ? 'border-rose-500/30' : 'border-emerald-500/30';

                return (
                    <div className={`p-3 rounded-xl border backdrop-blur-md bg-white/95 dark:bg-black/80 ${borderColor} shadow-lg text-xs font-mono z-50 min-w-[180px]`}>
                        <div className="flex items-center justify-between mb-2 border-b border-slate-200 dark:border-white/10 pb-2">
                            <span className={`font-bold uppercase tracking-wider ${colorClass}`}>{dataPoint.type} REKT</span>
                            <span className="text-[10px] text-slate-500 dark:text-gray-400">
                                {dataPoint.displayTime || new Date(dataPoint.time).toLocaleTimeString()}
                            </span>
                        </div>
                        <div className="space-y-1.5">
                            <div className="flex justify-between">
                                <span className="text-slate-500 dark:text-gray-400">Price</span>
                                <span className="font-bold text-slate-900 dark:text-white">${dataPoint.price.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-500 dark:text-gray-400">Size</span>
                                <span className={`font-bold ${colorClass}`}>
                                    ${(dataPoint.amount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </span>
                            </div>
                        </div>
                    </div>
                );
            }

            return (
                <div className="p-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white/95 dark:bg-[#050505]/90 backdrop-blur-sm shadow-xl text-xs font-mono z-50">
                    <p className="font-bold text-slate-600 dark:text-slate-300 mb-1">Price Action</p>
                    <div className="text-slate-900 dark:text-white">${dataPoint.close?.toLocaleString()}</div>
                    <div className="text-[10px] text-slate-500 dark:text-gray-400 mt-1">
                        {new Date(dataPoint.time).toLocaleTimeString()}
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="w-full h-full min-h-[220px] flex flex-col pt-12 pb-16 px-4 animate-fade-in relative">
            {/* Compact Cluster Summary Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 px-3 py-1.5 rounded-xl bg-slate-100/80 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[11px] font-mono">
                <div className="flex items-center gap-3">
                    <span className="text-slate-600 dark:text-gray-400 font-bold">
                        Clusters: <span className="text-slate-900 dark:text-white">{summary.count}</span>
                    </span>
                    <span className="text-rose-600 dark:text-rose-400 font-bold">
                        Long Rekt: ${(summary.longUsd / 1000).toFixed(1)}k
                    </span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                        Short Rekt: ${(summary.shortUsd / 1000).toFixed(1)}k
                    </span>
                </div>
                {summary.maxEvent && (
                    <span className="text-amber-600 dark:text-amber-400 font-bold">
                        Max Bubble: ${(summary.maxEvent.amount / 1000).toFixed(1)}k @ ${summary.maxEvent.price.toLocaleString()}
                    </span>
                )}
            </div>

            <div className="flex-1 min-h-0 relative">
                {bubbleData.length === 0 && (
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-slate-100/90 dark:bg-black/60 border border-slate-200 dark:border-white/10 text-[10px] font-mono text-slate-500 dark:text-gray-400 pointer-events-none">
                        Listening for live {activePair} liquidation prints...
                    </div>
                )}

                <ResponsiveContainer width="100%" height="100%" debounce={50}>
                    <ComposedChart data={candles} margin={{ top: 15, right: 20, bottom: 10, left: 0 }}>
                        <defs>
                            <radialGradient id="longGradient" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
                                <stop offset="0%" stopColor="#F43F5E" stopOpacity={0.95} />
                                <stop offset="70%" stopColor="#F43F5E" stopOpacity={0.45} />
                                <stop offset="100%" stopColor="#F43F5E" stopOpacity={0} />
                            </radialGradient>
                            <radialGradient id="shortGradient" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
                                <stop offset="0%" stopColor="#10B981" stopOpacity={0.95} />
                                <stop offset="70%" stopColor="#10B981" stopOpacity={0.45} />
                                <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                            </radialGradient>
                        </defs>

                        <CartesianGrid strokeDasharray="2 4" stroke={theme === 'dark' ? '#334155' : '#cbd5e1'} opacity={0.2} vertical={false} />

                        <XAxis
                            type="number"
                            dataKey="time"
                            domain={xDomain}
                            tickFormatter={(unixTime) => new Date(unixTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            tick={{ fontSize: 10, fill: '#64748b' }}
                            axisLine={false}
                            tickLine={false}
                            minTickGap={30}
                        />
                        <YAxis
                            type="number"
                            dataKey="close"
                            domain={['auto', 'auto']}
                            tick={{ fontSize: 10, fill: '#64748b' }}
                            tickFormatter={(value) => `$${value.toLocaleString()}`}
                            orientation="right"
                            axisLine={false}
                            tickLine={false}
                            width={68}
                        />
                        <ZAxis type="number" dataKey="z" range={[70, 1400]} name="Amount" />

                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#64748b', strokeWidth: 1, strokeDasharray: '4 4', opacity: 0.5 }} />

                        <Line
                            type="monotone"
                            dataKey="close"
                            stroke={theme === 'dark' ? '#64748b' : '#475569'}
                            strokeWidth={1.75}
                            dot={false}
                            activeDot={{ r: 4, fill: theme === 'dark' ? '#fff' : '#0f172a' }}
                            opacity={0.45}
                            isAnimationActive={false}
                        />

                        <Scatter
                            name="Liquidations"
                            data={bubbleData}
                            isAnimationActive={true}
                            animationDuration={400}
                            onClick={(entry: any) => {
                                if (onSelectPrice && entry?.price) {
                                    onSelectPrice(Number(entry.price));
                                }
                            }}
                        >
                            {bubbleData.map((entry, index) => (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={entry.type === 'Long' ? 'url(#longGradient)' : 'url(#shortGradient)'}
                                    stroke={entry.type === 'Long' ? '#F43F5E' : '#10B981'}
                                    strokeOpacity={0.5}
                                    className="cursor-pointer"
                                />
                            ))}
                        </Scatter>
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default LiquidationBubbleChart;
