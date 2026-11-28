import React, { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, createChart, createSeriesMarkers, IChartApi, IPriceLine, ISeriesApi } from 'lightweight-charts';
import Card from '@/components/common/Card';
import { GodModeState, LiquidationPoolHorizon, useGodModeStream } from '../../hooks/useGodModeData';
import { LiquidationRenderer } from '../../components/features/market/LiquidationRenderer';
import { SmartMoneyHUD } from '../../components/features/market/SmartMoneyHUD';
import { marketDepthService } from '../../services/marketDepthService';
import { calculateGodModeSignal } from '../../utils/godModeSignal';
import { isChartDisposed, safeRemoveChart } from '@/utils/chartLifecycle';
import { useBotStore } from '../../store/botStore';
import { useUIStore } from '../../store/uiStore';
import { useMarketStore } from '../../store/marketStore';
import { useTheme } from '@/context/ThemeContext';
import { formatCompactUsd, formatPairPrice } from '@/components/features/market/LiquidationCommandBar';

export interface GodModeLiquidationViewProps {
    sharedExchange?: string;
    sharedPair?: string;
    sharedTimeframe?: string;
    sharedHorizon?: LiquidationPoolHorizon;
    sharedGodModeState?: GodModeState | null;
    sharedConnected?: boolean;
}

const GodModeLiquidationView: React.FC<GodModeLiquidationViewProps> = ({
    sharedExchange,
    sharedPair,
    sharedTimeframe,
    sharedHorizon,
    sharedGodModeState,
    sharedConnected,
}) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const { globalExchange, globalSymbol } = useMarketStore();

    const { indicatorSettings, setIndicatorSettings } = useBotStore();
    const { liquidationHighlightedLevels: highlightedLevels, setLiquidationHighlightedLevels: setHighlightedLevels, liquidationTimeframe } = useUIStore();

    const activePair = (sharedPair || globalSymbol || 'BTC/USDT').split(':')[0];
    const activeExchange = (sharedExchange || globalExchange || 'binance').toLowerCase();
    const activeTimeframe = sharedTimeframe || liquidationTimeframe || '15m';
    const activeHorizon: LiquidationPoolHorizon = sharedHorizon || indicatorSettings.liquidationPoolHorizon || '24h';

    const fallbackStream = useGodModeStream(
        activePair,
        sharedGodModeState === undefined,
        activeExchange,
        activeHorizon,
    );

    const state = sharedGodModeState !== undefined ? sharedGodModeState : fallbackStream.state;
    const isConnected = sharedConnected !== undefined ? sharedConnected : fallbackStream.isConnected;

    const [trailingLiquidityEnabled, setTrailingLiquidityEnabled] = useState(
        Boolean(indicatorSettings.liquidationShowTrailingCloud),
    );
    const [candleTimes, setCandleTimes] = useState<number[]>([]);

    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const markersPluginRef = useRef<any>(null);
    const priceLinesRef = useRef<IPriceLine[]>([]);
    const lastCandleTimeRef = useRef<any>(null);
    const candlesRef = useRef<any[]>([]);
    const [chartReadyTick, setChartReadyTick] = useState(0);

    // Initialize Lightweight Chart immediately (non-blocking)
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: { background: { color: 'transparent' }, textColor: isDark ? '#d1d5db' : '#334155' },
            grid: {
                vertLines: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.06)' },
                horzLines: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.06)' },
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.12)',
            },
            rightPriceScale: { borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.12)' },
        });

        const series = chart.addSeries(CandlestickSeries, {
            upColor: '#10b981',
            downColor: '#ef4444',
            borderVisible: false,
            wickUpColor: '#10b981',
            wickDownColor: '#ef4444',
        });

        markersPluginRef.current = createSeriesMarkers(series, []);
        chartRef.current = chart;
        seriesRef.current = series;
        candlesRef.current = [];
        setCandleTimes([]);
        setChartReadyTick((t) => t + 1);

        let cancelled = false;
        marketDepthService
            .getOHLCV(activePair, activeExchange, activeTimeframe, 200)
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

                if (!cancelled && !isChartDisposed(chart) && formatted.length > 0) {
                    lastCandleTimeRef.current = formatted[formatted.length - 1].time;
                    candlesRef.current = formatted;
                    setCandleTimes(formatted.map((c) => Number(c.time)));
                    series.setData(formatted);
                    chart.timeScale().fitContent();
                    setChartReadyTick((t) => t + 1);
                }
            })
            .catch((e) => console.error('Failed to fetch history for GodMode chart', e));

        const resizeObserver = new ResizeObserver((entries) => {
            if (cancelled || isChartDisposed(chart)) return;
            if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
            const newRect = entries[0].contentRect;
            if (newRect.width > 0 && newRect.height > 0) {
                chart.applyOptions({ height: newRect.height, width: newRect.width });
            }
        });
        resizeObserver.observe(chartContainerRef.current);

        return () => {
            cancelled = true;
            resizeObserver.disconnect();
            priceLinesRef.current = [];
            safeRemoveChart(chart);
            chartRef.current = null;
            seriesRef.current = null;
        };
    }, [activePair, activeExchange, activeTimeframe]);

    // Theme updates
    useEffect(() => {
        if (!chartRef.current) return;
        chartRef.current.applyOptions({
            layout: { textColor: isDark ? '#d1d5db' : '#334155' },
            grid: {
                vertLines: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.06)' },
                horzLines: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.06)' },
            },
            timeScale: { borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.12)' },
            rightPriceScale: { borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.12)' },
        });
    }, [isDark]);

    // Update real-time price tick
    useEffect(() => {
        if (state && seriesRef.current && state.current_price > 0 && candlesRef.current.length > 0) {
            const lastIdx = candlesRef.current.length - 1;
            const lastCandle = candlesRef.current[lastIdx];
            if (lastCandle) {
                const updatedCandle = {
                    ...lastCandle,
                    close: state.current_price,
                    high: Math.max(lastCandle.high, state.current_price),
                    low: Math.min(lastCandle.low, state.current_price),
                };
                candlesRef.current[lastIdx] = updatedCandle;
                try {
                    seriesRef.current.update(updatedCandle);
                } catch {}
            }
        }
    }, [state]);

    // God Mode Signal Arrow
    useEffect(() => {
        if (!state || !markersPluginRef.current || !lastCandleTimeRef.current) return;
        const result = calculateGodModeSignal(state as any);
        if (result.signal !== 'NEUTRAL') {
            const isBuy = result.signal === 'BUY';
            markersPluginRef.current.setMarkers([
                {
                    time: lastCandleTimeRef.current,
                    position: isBuy ? 'belowBar' : 'aboveBar',
                    color: isBuy ? '#10b981' : '#ef4444',
                    shape: isBuy ? 'arrowUp' : 'arrowDown',
                    text: `GM ${result.signal} (${result.score})`,
                },
            ]);
        } else {
            markersPluginRef.current.setMarkers([]);
        }
    }, [state]);

    // Render Tracked Levels (highlightedLevels) on God Mode chart
    useEffect(() => {
        const series = seriesRef.current;
        if (!series) return;

        for (const line of priceLinesRef.current) {
            try {
                series.removePriceLine(line);
            } catch {}
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
            } catch {}
        }
    }, [highlightedLevels, chartReadyTick]);

    const handlePinLevel = (price: number) => {
        if (!Number.isFinite(price) || price <= 0) return;
        const rounded = Number(price.toFixed(price < 1 ? 4 : 2));
        const exists = highlightedLevels.some((l) => Math.abs(l - rounded) / rounded < 0.0002);
        if (exists) {
            setHighlightedLevels(highlightedLevels.filter((l) => Math.abs(l - rounded) / rounded >= 0.0002));
        } else {
            setHighlightedLevels([...highlightedLevels, rounded].sort((a, b) => b - a));
        }
    };

    const layerToggles: { key: keyof typeof indicatorSettings; label: string; enabled: boolean }[] = [
        { key: 'liquidationShowLeveragePools', label: 'Pools', enabled: indicatorSettings.liquidationShowLeveragePools !== false },
        { key: 'liquidationShowMagnetZones', label: 'Magnets', enabled: indicatorSettings.liquidationShowMagnetZones !== false },
        { key: 'liquidationShowBookmap', label: 'Bookmap', enabled: indicatorSettings.liquidationShowBookmap !== false },
        { key: 'liquidationShowBubbles', label: 'Bubbles', enabled: Boolean(indicatorSettings.liquidationShowBubbles) },
        { key: 'liquidationShowDeepWalls', label: 'Deep L2', enabled: indicatorSettings.liquidationShowDeepWalls !== false },
        { key: 'liquidationShowTrajectory', label: 'Trajectory', enabled: indicatorSettings.liquidationShowTrajectory !== false },
        { key: 'liquidationShowTrueCVD', label: 'True CVD', enabled: Boolean(indicatorSettings.liquidationShowTrueCVD) },
        { key: 'liquidationShowSpoofing', label: 'Spoof', enabled: indicatorSettings.liquidationShowSpoofing !== false },
        { key: 'liquidationShowGEX', label: 'GEX', enabled: indicatorSettings.liquidationShowGEX !== false },
        { key: 'liquidationShowSmartMoneyHUD', label: 'SM HUD', enabled: indicatorSettings.liquidationShowSmartMoneyHUD !== false },
    ];

    const painLevel = state?.pain_threshold?.level ?? 0;
    const painStatus = state?.pain_threshold?.status ?? 'NORMAL';
    const smartMoney = state?.smart_money ?? 50;
    const dumbMoney = state?.dumb_money ?? 50;
    const cof = state?.candle_orderflow;
    const gex = state?.gex_data;

    return (
        <div className="flex flex-col h-full gap-3 overflow-hidden animate-fade-in-up">
            {/* System Banner + Vulnerability Marquee */}
            <div className="flex-shrink-0 flex flex-col gap-2">
                <div className="bg-rose-50 dark:bg-black text-rose-600 dark:text-rose-500 font-mono text-[10px] py-1 px-4 rounded-xl border border-rose-500/20 flex flex-wrap justify-between items-center gap-2 tracking-widest uppercase">
                    <span>SYSTEM OVERRIDE: GOD MODE // INSTITUTIONAL ORDERFLOW MATRIX ({activeHorizon.toUpperCase()} POOLS)</span>
                    <div className="flex flex-wrap items-center gap-3">
                        {gex && (gex.call_wall > 0 || gex.put_wall > 0) && (
                            <span className="text-[10px] font-bold text-cyan-700 dark:text-cyan-300">
                                GEX Call {formatPairPrice(gex.call_wall)} | Put {formatPairPrice(gex.put_wall)}
                            </span>
                        )}
                        {cof && (
                            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200">
                                1m Buy {cof.buy_pct.toFixed(0)}% | 1m Δ {formatCompactUsd(cof.bar_delta_usd)}
                            </span>
                        )}
                        <span className={isConnected ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-amber-600 dark:text-yellow-400 animate-pulse'}>
                            {isConnected ? '● STREAM LIVE' : '○ RECONNECTING'}
                        </span>
                    </div>
                </div>

                <div className="flex items-center bg-white dark:bg-black border border-rose-500/25 rounded-xl p-1.5 overflow-hidden shadow-sm">
                    <span className="text-[10px] font-bold text-white bg-rose-600 px-3 py-1 rounded uppercase whitespace-nowrap z-10 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                        Vulnerability Scan
                    </span>
                    <div className="flex-1 overflow-hidden relative min-w-0 flex items-center">
                        <div className="flex animate-marquee whitespace-nowrap min-w-max pl-6 gap-8 text-[11px] font-mono text-slate-600 dark:text-gray-400">
                            {(state?.vulnerability || []).length === 0 ? (
                                <span className="text-slate-400">Scanning cross-market leverage vulnerability...</span>
                            ) : (
                                (state?.vulnerability || []).map((item, i) => (
                                    <div key={`${item.coin}-${i}`} className="flex items-center gap-2">
                                        <span className="font-bold text-slate-900 dark:text-gray-200">{item.coin}/USDT</span>
                                        {item.side && (
                                            <span
                                                className={
                                                    item.side === 'SHORTS'
                                                        ? 'text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 rounded-sm'
                                                        : 'text-rose-600 dark:text-rose-400 font-bold border border-rose-500/25 bg-rose-500/10 px-1.5 py-0.5 rounded-sm'
                                                }
                                            >
                                                {item.side}
                                            </span>
                                        )}
                                        <span className="text-amber-600 dark:text-yellow-400 font-bold">Risk: {item.risk}%</span>
                                        <span className="text-slate-500 dark:text-gray-500 text-[10px]">| Est. Liq: ${item.est_liq}M</span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex-1 grid grid-cols-12 gap-3 min-h-0">
                {/* LEFT HUD: Arbitrage Radar + Pain Threshold */}
                <div className="col-span-12 lg:col-span-3 flex flex-col gap-3 min-h-0">
                    <Card className="flex-1 overflow-hidden bg-gradient-to-b from-white to-slate-50 dark:from-[#0A0A0A] dark:to-[#000000] border-rose-500/20 !p-0 flex flex-col">
                        <div className="p-3.5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
                            <h3 className="text-xs font-bold font-mono text-slate-900 dark:text-white tracking-widest uppercase flex items-center gap-2">
                                Arbitrage Radar
                            </h3>
                            <span className="text-[9px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/30 animate-pulse">
                                ACTIVE
                            </span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3.5 custom-scrollbar flex flex-col gap-2.5">
                            {(!state || state.arbitrage.length === 0) && (
                                <div className="text-[10px] text-slate-400 dark:text-gray-500 font-mono text-center mt-10">
                                    SCANNING CROSS-EXCHANGE SPREADS...
                                </div>
                            )}
                            {(state?.arbitrage || []).map((arb, i) => (
                                <div
                                    key={i}
                                    className="bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl p-3 hover:border-emerald-500/35 transition-colors"
                                >
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-xs font-bold text-slate-900 dark:text-white">{arb.pair}</span>
                                        <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                            +{arb.diff}%
                                        </span>
                                    </div>
                                    <div className="text-[10px] text-slate-500 dark:text-gray-400 font-mono mb-2">{arb.target}</div>
                                    <div className="flex justify-between items-center text-[10px]">
                                        <span className="text-slate-500 dark:text-gray-400">
                                            Vol: <strong className="text-slate-900 dark:text-white">${arb.vol}</strong>
                                        </span>
                                        <span className="font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                            SPREAD
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>

                    <Card className="h-56 bg-white dark:bg-[#0A0A0A]/85 border-rose-500/20 !p-4 relative overflow-hidden flex flex-col items-center justify-center flex-shrink-0">
                        <h3 className="text-[10px] font-bold font-mono text-slate-500 dark:text-gray-400 tracking-widest uppercase absolute top-3.5 left-4">
                            Pain Threshold
                        </h3>
                        <div className="relative w-36 h-36 mt-4 flex items-center justify-center">
                            <svg className="w-full h-full" viewBox="0 0 100 100" style={{ overflow: 'visible' }}>
                                <path
                                    d="M 20 80 A 30 30 0 0 1 80 80"
                                    fill="none"
                                    stroke={isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)'}
                                    strokeWidth="8"
                                    strokeLinecap="round"
                                />
                                <path
                                    d="M 20 80 A 30 30 0 0 1 80 80"
                                    fill="none"
                                    stroke="url(#painGradient)"
                                    strokeWidth="8"
                                    strokeLinecap="round"
                                    strokeDasharray="94.25"
                                    strokeDashoffset={94.25 - (painLevel / 100) * 94.25}
                                    className="transition-all duration-700"
                                />
                                <defs>
                                    <linearGradient id="painGradient" x1="0%" y1="100%" x2="100%" y2="100%">
                                        <stop offset="0%" stopColor="#34D399" />
                                        <stop offset="50%" stopColor="#FBBF24" />
                                        <stop offset="100%" stopColor="#F43F5E" />
                                    </linearGradient>
                                </defs>
                            </svg>
                            <div
                                className="absolute bottom-[20%] left-1/2 w-1 h-[42%] bg-slate-800 dark:bg-white rounded-t origin-bottom transition-transform duration-700 z-10"
                                style={{ transform: `rotate(${-90 + (painLevel / 100) * 180}deg)` }}
                            />
                            <div className="absolute bottom-[20%] left-1/2 w-3.5 h-3.5 -ml-1.5 rounded-full bg-brand-primary z-20" />
                            <div className="absolute bottom-[-8px] text-center w-full">
                                <div className="text-lg font-bold font-mono text-slate-900 dark:text-white">{painLevel}%</div>
                                <div className={`text-[9px] font-bold uppercase tracking-widest ${painStatus === 'EXTREME' ? 'text-rose-500 animate-pulse' : 'text-emerald-500'}`}>
                                    {painStatus}
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>

                {/* CENTER HUD: Chart + Layers + Readable Magnet/Cascade Rails */}
                <div className="col-span-12 lg:col-span-6 flex flex-col min-h-[340px] relative">
                    <Card className="flex-1 bg-gradient-to-b from-white to-slate-50 dark:from-[#090E17] dark:to-[#05080F] border-brand-primary/20 !p-0 relative overflow-hidden shadow-lg flex flex-col">
                        {/* God Mode Chart Layer Toolbar */}
                        <div className="p-2.5 border-b border-slate-200 dark:border-white/10 flex flex-wrap items-center justify-between gap-2 z-20 bg-white/95 dark:bg-black/60 backdrop-blur-md">
                            <div className="flex flex-wrap items-center gap-1">
                                {layerToggles.map((lt) => (
                                    <button
                                        key={String(lt.key)}
                                        type="button"
                                        onClick={() => setIndicatorSettings({ [lt.key]: !lt.enabled })}
                                        className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border transition-colors ${
                                            lt.enabled
                                                ? 'bg-brand-primary/15 text-brand-primary dark:text-cyan-300 border-brand-primary/40'
                                                : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-gray-400 border-slate-200 dark:border-white/10'
                                        }`}
                                    >
                                        {lt.label}
                                    </button>
                                ))}
                            </div>

                            <div className="flex items-center gap-2">
                                <label className="flex items-center gap-1 cursor-pointer bg-slate-100 dark:bg-black/50 border border-slate-200 dark:border-white/10 rounded px-2 py-0.5">
                                    <input
                                        type="checkbox"
                                        className="accent-brand-primary cursor-pointer w-2.5 h-2.5"
                                        checked={trailingLiquidityEnabled}
                                        onChange={(e) => {
                                            setTrailingLiquidityEnabled(e.target.checked);
                                            setIndicatorSettings({ liquidationShowTrailingCloud: e.target.checked });
                                        }}
                                    />
                                    <span className="text-[9px] font-mono text-slate-600 dark:text-gray-300 uppercase">DTLC</span>
                                </label>

                                <button
                                    type="button"
                                    onClick={() =>
                                        setIndicatorSettings({
                                            liquidationDeepRangePct:
                                                indicatorSettings.liquidationDeepRangePct === 5 ? 10 : 5,
                                        })
                                    }
                                    className="text-[9px] font-mono font-bold px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                    title="Toggle Deep L2 Aggregation Depth"
                                >
                                    L2 ±{indicatorSettings.liquidationDeepRangePct || 10}%
                                </button>

                                <span
                                    className={`text-[9px] px-2 py-0.5 rounded font-mono uppercase ${
                                        state?.cvd_spoof && state.cvd_spoof !== 'NEGATIVE' && state.cvd_spoof !== 'NEUTRAL'
                                            ? 'text-rose-600 dark:text-rose-400 border border-rose-500/40 bg-rose-500/15'
                                            : 'text-brand-primary border border-brand-primary/30 bg-brand-primary/10'
                                    }`}
                                >
                                    Spoof: {state?.cvd_spoof || 'SYNC'}
                                </span>
                            </div>
                        </div>

                        {/* Live Overlay + Rails */}
                        <div className="flex-1 relative flex min-h-0">
                            {/* Left Magnet Rail (Wider, readable, clickable) */}
                            <div className="w-24 sm:w-28 border-r border-slate-200 dark:border-white/10 bg-slate-100/85 dark:bg-black/35 py-2 px-1.5 flex flex-col justify-between shrink-0 overflow-y-auto no-scrollbar">
                                <div className="text-center text-[9px] text-slate-500 dark:text-gray-400 font-mono font-bold uppercase mb-1">
                                    Magnets
                                </div>
                                <div className="space-y-1">
                                    {(state?.magnet_zones || [])
                                        .filter((z) => z.price > (state?.current_price || 0))
                                        .slice(0, 6)
                                        .map((zone, i) => (
                                            <button
                                                key={`mag-s-${i}`}
                                                type="button"
                                                onClick={() => handlePinLevel(zone.price)}
                                                className="w-full h-6 border border-rose-500/30 rounded relative overflow-hidden bg-white/60 dark:bg-black/40 hover:border-rose-500"
                                            >
                                                <div className="absolute left-0 h-full bg-rose-500/65" style={{ width: `${zone.intensity}%` }} />
                                                <span className="relative z-10 text-[9px] font-mono font-bold text-slate-900 dark:text-white">
                                                    {formatPairPrice(zone.price)}
                                                </span>
                                            </button>
                                        ))}
                                </div>

                                <div className="my-2 text-center py-0.5 rounded bg-slate-900 dark:bg-white text-white dark:text-black text-[9px] font-mono font-black">
                                    {state?.current_price ? formatPairPrice(state.current_price) : '---'}
                                </div>

                                <div className="space-y-1">
                                    {(state?.magnet_zones || [])
                                        .filter((z) => z.price <= (state?.current_price || 0))
                                        .slice(0, 6)
                                        .map((zone, i) => (
                                            <button
                                                key={`mag-l-${i}`}
                                                type="button"
                                                onClick={() => handlePinLevel(zone.price)}
                                                className="w-full h-6 border border-emerald-500/30 rounded relative overflow-hidden bg-white/60 dark:bg-black/40 hover:border-emerald-500"
                                            >
                                                <div className="absolute left-0 h-full bg-emerald-500/65" style={{ width: `${zone.intensity}%` }} />
                                                <span className="relative z-10 text-[9px] font-mono font-bold text-slate-900 dark:text-white">
                                                    {formatPairPrice(zone.price)}
                                                </span>
                                            </button>
                                        ))}
                                </div>
                            </div>

                            {/* Center Chart */}
                            <div className="flex-1 relative bg-slate-50/70 dark:bg-black/50 min-w-0">
                                {!state && (
                                    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-white/75 dark:bg-black/65 backdrop-blur-sm text-rose-500 font-mono">
                                        <div className="w-9 h-9 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
                                        <span className="text-xs tracking-widest uppercase">
                                            Syncing {activePair} ({activeExchange.toUpperCase()})...
                                        </span>
                                    </div>
                                )}

                                <div ref={chartContainerRef} className="absolute inset-0" />

                                <LiquidationRenderer
                                    chart={chartRef.current}
                                    series={seriesRef.current}
                                    data={state as any}
                                    symbol={activePair}
                                    showBubbles={Boolean(indicatorSettings.liquidationShowBubbles)}
                                    intensityScale={indicatorSettings.liquidationHeatmapIntensity || 75}
                                    useTrailingLiquidity={trailingLiquidityEnabled}
                                    showTrueCVD={Boolean(indicatorSettings.liquidationShowTrueCVD)}
                                    showSpoofing={indicatorSettings.liquidationShowSpoofing !== false}
                                    showGEX={indicatorSettings.liquidationShowGEX !== false}
                                    showBookmap={indicatorSettings.liquidationShowBookmap !== false}
                                    bookmapIntensity={indicatorSettings.liquidationBookmapIntensity || 50}
                                    bookmapHistoryMinutes={indicatorSettings.liquidationBookmapHistoryMin || 120}
                                    spoofingThreshold={indicatorSettings.liquidationSpoofingThreshold || 500000}
                                    smartMoneyBias={Boolean(indicatorSettings.liquidationSmartMoneyBias)}
                                    showMagnetZones={indicatorSettings.liquidationShowMagnetZones !== false}
                                    showDeepWalls={indicatorSettings.liquidationShowDeepWalls !== false}
                                    deepRangePct={indicatorSettings.liquidationDeepRangePct || 10}
                                    showLeveragePools={indicatorSettings.liquidationShowLeveragePools !== false}
                                    showTrajectory={indicatorSettings.liquidationShowTrajectory !== false}
                                    isDark={isDark}
                                    onZoneClick={handlePinLevel}
                                    candlesRef={candlesRef}
                                    candleTimes={candleTimes}
                                />

                                {indicatorSettings.liquidationShowSmartMoneyHUD !== false && state && (state.smart_trajectory || state.pain_threshold) && (
                                    <SmartMoneyHUD
                                        symbol={activePair}
                                        data={state.smart_trajectory as any}
                                        godModeData={state}
                                        currentPrice={state.current_price}
                                        icebergEvents={state.iceberg_events}
                                        magnetZones={state.magnet_zones}
                                        deepRangePct={indicatorSettings.liquidationDeepRangePct || 10}
                                        visible={true}
                                    />
                                )}
                            </div>

                            {/* Right Cascade Probability Rail (Wider, readable) */}
                            <div className="w-24 sm:w-28 border-l border-slate-200 dark:border-white/10 bg-slate-100/85 dark:bg-black/35 py-2 px-1.5 flex flex-col justify-between shrink-0 overflow-y-auto no-scrollbar">
                                <div className="text-center text-[9px] text-slate-500 dark:text-gray-400 font-mono font-bold uppercase mb-1">
                                    Cascade Prob
                                </div>
                                <div className="space-y-1">
                                    {(state?.cascade_probs || [])
                                        .filter((z) => z.price > (state?.current_price || 0))
                                        .slice(0, 6)
                                        .map((zone, i) => (
                                            <div key={`cas-s-${i}`} className="h-6 w-full bg-rose-500/15 rounded relative overflow-hidden flex items-center justify-center px-1">
                                                <div className="absolute right-0 h-full bg-rose-500/75" style={{ width: `${zone.prob}%` }} />
                                                <span className="relative z-10 text-[9px] font-mono font-bold text-slate-900 dark:text-white truncate">
                                                    ${Math.round(zone.price).toLocaleString()} ({zone.prob}%)
                                                </span>
                                            </div>
                                        ))}
                                </div>

                                <div className="my-2 h-px bg-slate-400 dark:bg-white/40" />

                                <div className="space-y-1">
                                    {(state?.cascade_probs || [])
                                        .filter((z) => z.price <= (state?.current_price || 0))
                                        .slice(0, 6)
                                        .map((zone, i) => (
                                            <div key={`cas-l-${i}`} className="h-6 w-full bg-emerald-500/15 rounded relative overflow-hidden flex items-center justify-center px-1">
                                                <div className="absolute right-0 h-full bg-emerald-500/75" style={{ width: `${zone.prob}%` }} />
                                                <span className="relative z-10 text-[9px] font-mono font-bold text-slate-900 dark:text-white truncate">
                                                    ${Math.round(zone.price).toLocaleString()} ({zone.prob}%)
                                                </span>
                                            </div>
                                        ))}
                                </div>
                            </div>
                        </div>

                        {highlightedLevels.length > 0 && (
                            <div className="px-3 py-1.5 border-t border-slate-200 dark:border-white/10 bg-slate-50/90 dark:bg-black/60 flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
                                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 shrink-0">
                                    Tracked:
                                </span>
                                {highlightedLevels.map((lvl) => (
                                    <span
                                        key={lvl}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[10px] font-mono font-bold shrink-0"
                                    >
                                        ${lvl.toLocaleString()}
                                        <button
                                            type="button"
                                            onClick={() => setHighlightedLevels(highlightedLevels.filter((x) => x !== lvl))}
                                            className="hover:text-rose-500"
                                        >
                                            &times;
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </Card>
                </div>

                {/* RIGHT HUD: Smart vs Dumb Money + Whale Kill Feed */}
                <div className="col-span-12 lg:col-span-3 flex flex-col gap-3 min-h-0">
                    <Card className="h-44 bg-white dark:bg-[#0A0A0A]/85 border-emerald-500/20 !p-0 overflow-hidden flex flex-col flex-shrink-0">
                        <div className="p-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 text-[10px] font-bold font-mono text-slate-600 dark:text-gray-300 tracking-widest uppercase flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-purple-500" />
                            Smart vs Dumb Money
                        </div>
                        <div className="flex-1 flex items-center justify-around p-3">
                            <div className="flex flex-col items-center gap-1.5">
                                <div className="w-14 h-14 rounded-full relative flex items-center justify-center">
                                    <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 36 36">
                                        <path className="text-slate-200 dark:text-gray-800" strokeWidth="3" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                        <path className="text-purple-500 transition-all duration-500" strokeDasharray={`${smartMoney}, 100`} strokeWidth="3" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                    </svg>
                                    <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">{smartMoney}%</span>
                                </div>
                                <span className="text-[9px] text-slate-500 dark:text-gray-400 font-bold uppercase">Institutions</span>
                            </div>

                            <div className="h-8 w-px bg-slate-200 dark:bg-white/10" />

                            <div className="flex flex-col items-center gap-1.5">
                                <div className="w-14 h-14 rounded-full relative flex items-center justify-center">
                                    <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 36 36">
                                        <path className="text-slate-200 dark:text-gray-800" strokeWidth="3" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                        <path className="text-rose-400 transition-all duration-500" strokeDasharray={`${dumbMoney}, 100`} strokeWidth="3" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                    </svg>
                                    <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">{dumbMoney}%</span>
                                </div>
                                <span className="text-[9px] text-slate-500 dark:text-gray-400 font-bold uppercase">Retail</span>
                            </div>
                        </div>
                        <div className="h-1.5 w-full bg-slate-200 dark:bg-gray-800 flex mt-auto">
                            <div className="h-full bg-purple-500 transition-all duration-500" style={{ width: `${smartMoney}%` }} />
                            <div className="h-full bg-rose-400 transition-all duration-500" style={{ width: `${dumbMoney}%` }} />
                        </div>
                    </Card>

                    <Card className="flex-1 overflow-hidden bg-gradient-to-b from-white to-slate-50 dark:from-[#0A0A0A] dark:to-[#000000] border-rose-500/20 !p-0 flex flex-col min-h-0">
                        <div className="p-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 text-xs font-bold font-mono text-rose-600 dark:text-rose-400 tracking-widest uppercase">
                            Whale Kill Feed ({state?.whale_feed?.length || 0})
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar gap-2 flex flex-col">
                            {(!state || state.whale_feed.length === 0) && (
                                <div className="text-[10px] text-slate-400 dark:text-gray-500 font-mono text-center mt-10">
                                    NO WHALE LIQUIDATIONS YET...
                                </div>
                            )}
                            {(state?.whale_feed || []).map((item, index) => (
                                <div
                                    key={index}
                                    className="bg-slate-50 dark:bg-black/50 border border-rose-500/20 rounded-xl p-2.5 flex items-center gap-3 relative overflow-hidden"
                                >
                                    <div className="w-1 self-stretch bg-rose-500 rounded-full" />
                                    <div className="flex-1">
                                        <div className="flex justify-between items-center mb-0.5">
                                            <span
                                                className={`text-[10px] font-bold uppercase ${
                                                    item.type?.includes('Long')
                                                        ? 'text-rose-600 dark:text-rose-400'
                                                        : 'text-emerald-600 dark:text-emerald-400'
                                                }`}
                                            >
                                                {item.type}
                                            </span>
                                            <span className="text-[9px] text-slate-500 font-mono">{item.time}</span>
                                        </div>
                                        <div className="flex justify-between items-end">
                                            <span className="text-sm font-mono font-bold text-slate-900 dark:text-white">
                                                ${(item.value / 1_000_000).toFixed(2)}M
                                            </span>
                                            <span className="text-[9px] bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 px-1.5 rounded uppercase">
                                                Smart Money
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            </div>

            <style
                dangerouslySetInnerHTML={{
                    __html: `
                @keyframes marquee {
                    0% { transform: translateX(0); }
                    100% { transform: translateX(-100%); }
                }
                .animate-marquee {
                    animation: marquee 30s linear infinite;
                }
                .animate-fade-in-up {
                    animation: fadeInUp 0.4s ease-out forwards;
                }
                @keyframes fadeInUp {
                    from { opacity: 0; transform: translateY(12px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `,
                }}
            />
        </div>
    );
};

export default GodModeLiquidationView;
