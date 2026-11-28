import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CandlestickSeries, createChart, IChartApi, IPriceLine, ISeriesApi } from 'lightweight-charts';
import { LiquidationRenderer } from './LiquidationRenderer';
import { marketDepthService } from '@/services/marketDepthService';
import type { GodModeState } from '@/hooks/useGodModeData';
import { useBotStore } from '@/store/botStore';

export interface LiveLiquidityPoolChartProps {
    symbol: string;
    exchange: string;
    timeframe: string;
    oraclePrice: number;
    godModeData: GodModeState | null;
    highlightedLevels: number[];
    onToggleLevel: (price: number) => void;
    isDark: boolean;
}

export const LiveLiquidityPoolChart: React.FC<LiveLiquidityPoolChartProps> = ({
    symbol,
    exchange,
    timeframe,
    oraclePrice,
    godModeData,
    highlightedLevels,
    onToggleLevel,
    isDark,
}) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const priceLinesRef = useRef<IPriceLine[]>([]);
    const candlesRef = useRef<any[]>([]);
    const [candleTimes, setCandleTimes] = useState<number[]>([]);
    const [chartReadyTick, setChartReadyTick] = useState(0);
    const [isLoadingCandles, setIsLoadingCandles] = useState(false);

    const { indicatorSettings, setIndicatorSettings } = useBotStore();
    const showPools = indicatorSettings.liquidationShowLeveragePools !== false;
    const showMagnets = indicatorSettings.liquidationShowMagnetZones !== false;
    const showBubbles = Boolean(indicatorSettings.liquidationShowBubbles);
    const showDeepWalls = indicatorSettings.liquidationShowDeepWalls !== false;
    const showBookmap = Boolean(indicatorSettings.liquidationShowBookmap);
    const showTrajectory = indicatorSettings.liquidationShowTrajectory !== false;

    const cleanPair = useMemo(() => (symbol || 'BTC/USDT').split(':')[0], [symbol]);
    const cleanExchange = useMemo(() => (exchange || 'binance').toLowerCase(), [exchange]);

    // Initialize Lightweight Chart cleanly per symbol / exchange / timeframe
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { color: 'transparent' },
                textColor: isDark ? '#cbd5e1' : '#334155',
            },
            grid: {
                vertLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.06)' },
                horzLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.06)' },
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.12)',
            },
            rightPriceScale: {
                borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.12)',
            },
        });

        const series = chart.addSeries(CandlestickSeries, {
            upColor: '#10b981',
            downColor: '#ef4444',
            borderVisible: false,
            wickUpColor: '#10b981',
            wickDownColor: '#ef4444',
        });

        chartRef.current = chart;
        seriesRef.current = series;
        candlesRef.current = [];
        setCandleTimes([]);
        setChartReadyTick((t) => t + 1);

        let cancelled = false;
        setIsLoadingCandles(true);

        marketDepthService
            .getOHLCV(cleanPair, cleanExchange, timeframe || '15m', 200)
            .then((data: any[]) => {
                if (cancelled || !Array.isArray(data) || data.length === 0) return;
                const formatted = data
                    .map((k: any) => ({
                        time: (Number(k.time) > 10_000_000_000 ? Math.floor(Number(k.time) / 1000) : Number(k.time)) as any,
                        open: parseFloat(k.open),
                        high: parseFloat(k.high),
                        low: parseFloat(k.low),
                        close: parseFloat(k.close),
                    }))
                    .filter((c) => Number.isFinite(c.open) && Number.isFinite(c.close))
                    .sort((a, b) => Number(a.time) - Number(b.time));

                if (formatted.length > 0) {
                    candlesRef.current = formatted;
                    setCandleTimes(formatted.map((c) => Number(c.time)));
                    series.setData(formatted);
                    chart.timeScale().fitContent();
                    setChartReadyTick((t) => t + 1);
                }
            })
            .catch((err) => {
                console.error('Failed to fetch OHLCV for LiveLiquidityPoolChart:', err);
            })
            .finally(() => {
                if (!cancelled) setIsLoadingCandles(false);
            });

        const resizeObserver = new ResizeObserver((entries) => {
            if (!entries.length || entries[0].target !== chartContainerRef.current) return;
            const rect = entries[0].contentRect;
            if (rect.width > 0 && rect.height > 0) {
                chart.applyOptions({ width: rect.width, height: rect.height });
            }
        });
        resizeObserver.observe(chartContainerRef.current);

        return () => {
            cancelled = true;
            resizeObserver.disconnect();
            priceLinesRef.current = [];
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
        };
    }, [cleanPair, cleanExchange, timeframe]);

    // Dynamic Theme Update
    useEffect(() => {
        if (!chartRef.current) return;
        chartRef.current.applyOptions({
            layout: { textColor: isDark ? '#cbd5e1' : '#334155' },
            grid: {
                vertLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.06)' },
                horzLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.06)' },
            },
            timeScale: { borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.12)' },
            rightPriceScale: { borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.12)' },
        });
    }, [isDark]);

    // Real-time live price update on last candle
    useEffect(() => {
        const livePrice = oraclePrice > 0 ? oraclePrice : godModeData?.current_price || 0;
        if (!seriesRef.current || livePrice <= 0 || candlesRef.current.length === 0) return;

        const lastIdx = candlesRef.current.length - 1;
        const last = candlesRef.current[lastIdx];
        if (!last) return;

        const updated = {
            ...last,
            close: livePrice,
            high: Math.max(last.high, livePrice),
            low: Math.min(last.low, livePrice),
        };
        candlesRef.current[lastIdx] = updated;
        try {
            seriesRef.current.update(updated);
        } catch {
            // ignore transient update errors
        }
    }, [oraclePrice, godModeData?.current_price]);

    // Reliable Tracked Price Lines via Lightweight Charts API
    useEffect(() => {
        const series = seriesRef.current;
        if (!series) return;

        for (const line of priceLinesRef.current) {
            try {
                series.removePriceLine(line);
            } catch {
                // ignore
            }
        }
        priceLinesRef.current = [];

        for (const price of highlightedLevels) {
            if (!Number.isFinite(price) || price <= 0) continue;
            try {
                const digits = price < 1 ? 4 : 2;
                const line = series.createPriceLine({
                    price,
                    color: '#FBBF24',
                    lineWidth: 2,
                    lineStyle: 2,
                    axisLabelVisible: true,
                    title: `Target $${price.toLocaleString(undefined, { maximumFractionDigits: digits })}`,
                });
                priceLinesRef.current.push(line);
            } catch {
                // ignore
            }
        }
    }, [highlightedLevels, chartReadyTick]);

    const layers: {
        key: keyof typeof indicatorSettings;
        label: string;
        active: boolean;
        activeCls: string;
    }[] = [
        {
            key: 'liquidationShowLeveragePools',
            label: 'OI Pools',
            active: showPools,
            activeCls: 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/40',
        },
        {
            key: 'liquidationShowMagnetZones',
            label: 'Magnets',
            active: showMagnets,
            activeCls: 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40',
        },
        {
            key: 'liquidationShowBubbles',
            label: 'Bubbles',
            active: showBubbles,
            activeCls: 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/40',
        },
        {
            key: 'liquidationShowDeepWalls',
            label: 'Deep L2',
            active: showDeepWalls,
            activeCls: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
        },
        {
            key: 'liquidationShowBookmap',
            label: 'Bookmap',
            active: showBookmap,
            activeCls: 'bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-500/40',
        },
        {
            key: 'liquidationShowTrajectory',
            label: 'Trajectory',
            active: showTrajectory,
            activeCls: 'bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/40',
        },
    ];

    return (
        <div className="relative w-full h-full">
            {/* Layer Switcher Bar (Top Right before Fullscreen btn) */}
            <div className="absolute top-3.5 right-14 z-20 flex items-center gap-1 overflow-x-auto max-w-[52%] sm:max-w-none bg-white/90 dark:bg-black/65 backdrop-blur-md p-1 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm no-scrollbar">
                {layers.map((layer) => (
                    <button
                        key={String(layer.key)}
                        type="button"
                        onClick={() => setIndicatorSettings({ [layer.key]: !layer.active })}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all ${
                            layer.active
                                ? layer.activeCls
                                : 'bg-transparent border-transparent text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        {layer.label}
                    </button>
                ))}
            </div>

            {isLoadingCandles && (
                <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                    <div className="px-3 py-1.5 rounded-xl bg-white/90 dark:bg-black/70 border border-slate-200 dark:border-white/10 text-xs font-mono text-slate-600 dark:text-slate-300 shadow">
                        Loading {cleanPair} Candles...
                    </div>
                </div>
            )}

            <div ref={chartContainerRef} className="w-full h-full" />

            <LiquidationRenderer
                chart={chartRef.current}
                series={seriesRef.current}
                data={godModeData as any}
                symbol={cleanPair}
                showBubbles={showBubbles}
                intensityScale={indicatorSettings.liquidationHeatmapIntensity || 75}
                useTrailingLiquidity={Boolean(indicatorSettings.liquidationShowTrailingCloud)}
                showTrueCVD={Boolean(indicatorSettings.liquidationShowTrueCVD)}
                showSpoofing={Boolean(indicatorSettings.liquidationShowSpoofing)}
                showGEX={Boolean(indicatorSettings.liquidationShowGEX)}
                showBookmap={showBookmap}
                bookmapIntensity={indicatorSettings.liquidationBookmapIntensity || 50}
                bookmapHistoryMinutes={indicatorSettings.liquidationBookmapHistoryMin || 120}
                spoofingThreshold={indicatorSettings.liquidationSpoofingThreshold || 500000}
                smartMoneyBias={Boolean(indicatorSettings.liquidationSmartMoneyBias)}
                showMagnetZones={showMagnets}
                showDeepWalls={showDeepWalls}
                deepRangePct={indicatorSettings.liquidationDeepRangePct || 10}
                showLeveragePools={showPools}
                showTrajectory={showTrajectory}
                isDark={isDark}
                onZoneClick={(price) => onToggleLevel(Number(price.toFixed(price < 1 ? 4 : 2)))}
                candlesRef={candlesRef}
                candleTimes={candleTimes}
            />
        </div>
    );
};

export default LiveLiquidityPoolChart;
