import React, { useEffect, useRef, useMemo } from 'react';
import {
    createChart,
    IChartApi,
    ISeriesApi,
    BaselineSeries,
    HistogramSeries,
    LineStyle,
} from 'lightweight-charts';
import { useTheme } from '@/context/ThemeContext';
import { formatCompactOrderflowNumber } from '../../../utils/orderflowMath';

export interface CVDDataPoint {
    time: number;
    value: number;
    delta?: number;
    buyVolume?: number;
    sellVolume?: number;
}

export interface CVDMeta {
    isTrueDelta: boolean;
    buyPct: number;
    sellPct: number;
    divergence: 'BULLISH' | 'BEARISH' | null;
}

interface CVDChartProps {
    mainChart: IChartApi | null;
    data: CVDDataPoint[];
    meta?: CVDMeta | null;
}

export const CVDChart: React.FC<CVDChartProps> = ({ mainChart, data, meta }) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const cvdSeriesRef = useRef<ISeriesApi<'Baseline'> | null>(null);
    const deltaSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

    const isSyncingRef = useRef(false);
    const lastRenderedCountRef = useRef<number>(0);
    const lastRenderedFirstTimeRef = useRef<number>(0);
    const lastRenderedLastTimeRef = useRef<number>(0);
    const valueByTimeRef = useRef<Map<number, number>>(new Map());

    // Create chart once
    useEffect(() => {
        const container = chartContainerRef.current;
        if (!container) return;

        const chart = createChart(container, {
            layout: {
                background: { type: 'solid', color: isDark ? '#000000' : '#ffffff' } as any,
                textColor: isDark ? '#94a3b8' : '#475569',
                fontSize: 11,
            },
            grid: {
                vertLines: { color: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(15, 23, 42, 0.05)' },
                horzLines: { color: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(15, 23, 42, 0.05)' },
            },
            timeScale: {
                borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.12)',
                visible: false,
            },
            rightPriceScale: {
                borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.12)',
                autoScale: true,
                scaleMargins: { top: 0.18, bottom: 0.12 },
            },
            crosshair: {
                mode: 1,
                horzLine: {
                    style: LineStyle.Dashed,
                    color: isDark ? 'rgba(148, 163, 184, 0.35)' : 'rgba(71, 85, 105, 0.35)',
                },
                vertLine: {
                    style: LineStyle.Dashed,
                    color: isDark ? 'rgba(148, 163, 184, 0.35)' : 'rgba(71, 85, 105, 0.35)',
                },
            },
            width: container.clientWidth || 300,
            height: container.clientHeight || 120,
        });

        // Subtle Per-Candle Delta Histogram behind CVD line
        const deltaSeries = chart.addSeries(HistogramSeries, {
            priceScaleId: 'delta_overlay',
            priceFormat: { type: 'volume' },
            lastValueVisible: false,
            priceLineVisible: false,
        });
        chart.priceScale('delta_overlay').applyOptions({
            scaleMargins: { top: 0.55, bottom: 0.02 },
            visible: false,
        });

        // Zero-Baseline Institutional CVD Line (Emerald above 0, Rose below 0)
        const cvdSeries = chart.addSeries(BaselineSeries, {
            baseValue: { type: 'price', price: 0 },
            topLineColor: '#10b981',
            topFillColor1: 'rgba(16, 185, 129, 0.28)',
            topFillColor2: 'rgba(16, 185, 129, 0.02)',
            bottomLineColor: '#f43f5e',
            bottomFillColor1: 'rgba(244, 63, 94, 0.02)',
            bottomFillColor2: 'rgba(244, 63, 94, 0.28)',
            lineWidth: 2,
            crosshairMarkerVisible: true,
            priceFormat: { type: 'volume' },
        });

        // Crisp zero reference line
        cvdSeries.createPriceLine({
            price: 0,
            color: isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(100, 116, 139, 0.3)',
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: '',
        });

        chartRef.current = chart;
        cvdSeriesRef.current = cvdSeries;
        deltaSeriesRef.current = deltaSeries;
        lastRenderedCountRef.current = 0;
        lastRenderedFirstTimeRef.current = 0;
        lastRenderedLastTimeRef.current = 0;

        const resizeObserver = new ResizeObserver((entries) => {
            if (!entries.length) return;
            const { width, height } = entries[0].contentRect;
            if (width > 0 && height > 0) {
                try {
                    chart.applyOptions({ width, height });
                } catch {}
            }
        });
        resizeObserver.observe(container);

        return () => {
            resizeObserver.disconnect();
            chartRef.current = null;
            cvdSeriesRef.current = null;
            deltaSeriesRef.current = null;
            try {
                chart.remove();
            } catch {}
        };
    }, []);

    // Dynamically sync Light/Dark Theme without recreating the chart
    useEffect(() => {
        if (!chartRef.current) return;
        chartRef.current.applyOptions({
            layout: {
                background: { type: 'solid', color: isDark ? '#000000' : '#ffffff' } as any,
                textColor: isDark ? '#94a3b8' : '#475569',
            },
            grid: {
                vertLines: { color: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(15, 23, 42, 0.05)' },
                horzLines: { color: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(15, 23, 42, 0.05)' },
            },
            timeScale: {
                borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.12)',
            },
            rightPriceScale: {
                borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.12)',
            },
        });
    }, [isDark]);

    // Sync Data with Incremental `.update()` on Live Ticks (Zero Full-Chart Flicker!)
    useEffect(() => {
        const cvdSeries = cvdSeriesRef.current;
        const deltaSeries = deltaSeriesRef.current;
        if (!cvdSeries || !deltaSeries) return;

        if (!data || data.length === 0) {
            try {
                cvdSeries.setData([]);
                deltaSeries.setData([]);
                lastRenderedCountRef.current = 0;
                lastRenderedFirstTimeRef.current = 0;
                lastRenderedLastTimeRef.current = 0;
            } catch {}
            return;
        }

        const firstTime = data[0].time;
        const lastPt = data[data.length - 1];
        const prevCount = lastRenderedCountRef.current;
        const prevFirst = lastRenderedFirstTimeRef.current;
        const prevLast = lastRenderedLastTimeRef.current;

        const canIncrementalUpdate =
            prevCount > 0 &&
            firstTime === prevFirst &&
            (data.length === prevCount || data.length === prevCount + 1) &&
            lastPt.time >= prevLast;

        if (canIncrementalUpdate) {
            try {
                cvdSeries.update({ time: lastPt.time as any, value: lastPt.value });
                valueByTimeRef.current.set(lastPt.time, lastPt.value);
                const barDelta =
                    lastPt.delta !== undefined
                        ? lastPt.delta
                        : data.length >= 2
                          ? lastPt.value - data[data.length - 2].value
                          : lastPt.value;
                deltaSeries.update({
                    time: lastPt.time as any,
                    value: barDelta,
                    color: barDelta >= 0 ? 'rgba(16, 185, 129, 0.42)' : 'rgba(244, 63, 94, 0.42)',
                });
                lastRenderedCountRef.current = data.length;
                lastRenderedLastTimeRef.current = lastPt.time;
                return;
            } catch {
                // Fall through to full setData on any edge mismatch
            }
        }

        // Full deduplicated chronological load (initial load / symbol or timeframe switch)
        const uniqueMap = new Map<number, CVDDataPoint>();
        for (let i = 0; i < data.length; i++) {
            const pt = data[i];
            if (pt && Number.isFinite(pt.time) && Number.isFinite(pt.value)) {
                uniqueMap.set(pt.time, pt);
            }
        }
        const sorted = Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time);
        if (sorted.length === 0) return;

        const valMap = new Map<number, number>();
        const cvdPoints = sorted.map((p) => {
            valMap.set(p.time, p.value);
            return { time: p.time as any, value: p.value };
        });
        valueByTimeRef.current = valMap;

        const deltaPoints = sorted.map((p, idx) => {
            const d = p.delta !== undefined ? p.delta : idx > 0 ? p.value - sorted[idx - 1].value : p.value;
            return {
                time: p.time as any,
                value: d,
                color: d >= 0 ? 'rgba(16, 185, 129, 0.36)' : 'rgba(244, 63, 94, 0.36)',
            };
        });

        try {
            cvdSeries.setData(cvdPoints);
            deltaSeries.setData(deltaPoints);
            lastRenderedCountRef.current = sorted.length;
            lastRenderedFirstTimeRef.current = sorted[0].time;
            lastRenderedLastTimeRef.current = sorted[sorted.length - 1].time;

            if (mainChart && chartRef.current) {
                const timeRange = mainChart.timeScale().getVisibleRange();
                if (timeRange) {
                    isSyncingRef.current = true;
                    try {
                        chartRef.current.timeScale().setVisibleRange(timeRange);
                    } catch {
                        const logicalRange = mainChart.timeScale().getVisibleLogicalRange();
                        if (logicalRange) chartRef.current.timeScale().setVisibleLogicalRange(logicalRange);
                    }
                    isSyncingRef.current = false;
                }
            }
        } catch (err) {
            console.error('Failed to set CVD Chart data:', err);
        }
    }, [data, mainChart]);

    // 2-Way Timestamp-Based Time-Scale & Crosshair Sync (never drifts off-screen even if bar counts differ!)
    useEffect(() => {
        if (!mainChart || !chartRef.current) return;

        const cvdChart = chartRef.current;
        const mainTimeScale = mainChart.timeScale();
        const cvdTimeScale = cvdChart.timeScale();

        const syncMainToCVD = () => {
            if (isSyncingRef.current) return;
            const timeRange = mainTimeScale.getVisibleRange();
            if (!timeRange) return;
            isSyncingRef.current = true;
            try {
                cvdTimeScale.setVisibleRange(timeRange);
            } catch {}
            isSyncingRef.current = false;
        };

        const syncCVDToMain = () => {
            if (isSyncingRef.current) return;
            const timeRange = cvdTimeScale.getVisibleRange();
            if (!timeRange) return;
            isSyncingRef.current = true;
            try {
                mainTimeScale.setVisibleRange(timeRange);
            } catch {}
            isSyncingRef.current = false;
        };

        const syncCrosshairMainToCVD = (param: any) => {
            if (!param.point || !param.time || !cvdSeriesRef.current) {
                try {
                    cvdChart.clearCrosshairPosition();
                } catch {}
                return;
            }
            try {
                const tNum = Number(param.time);
                const val = valueByTimeRef.current.get(tNum);
                if (val !== undefined) {
                    cvdChart.setCrosshairPosition(val, param.time, cvdSeriesRef.current);
                } else if (typeof param.logical === 'number') {
                    const seriesData = cvdSeriesRef.current.dataByIndex(param.logical);
                    if (seriesData && 'value' in seriesData) {
                        cvdChart.setCrosshairPosition((seriesData as any).value as number, param.time, cvdSeriesRef.current);
                    }
                }
            } catch {}
        };

        mainTimeScale.subscribeVisibleTimeRangeChange(syncMainToCVD);
        cvdTimeScale.subscribeVisibleTimeRangeChange(syncCVDToMain);
        mainChart.subscribeCrosshairMove(syncCrosshairMainToCVD);

        syncMainToCVD();

        return () => {
            try {
                mainTimeScale.unsubscribeVisibleTimeRangeChange(syncMainToCVD);
                cvdTimeScale.unsubscribeVisibleTimeRangeChange(syncCVDToMain);
                mainChart.unsubscribeCrosshairMove(syncCrosshairMainToCVD);
            } catch {}
        };
    }, [mainChart]);

    // Live HUD Stats (recomputes buyPct/sellPct dynamically as live ticks arrive!)
    const hudStats = useMemo(() => {
        if (!data || data.length === 0) {
            return { sessionCvd: 0, barDelta: 0, buyPct: 50, sellPct: 50 };
        }
        const last = data[data.length - 1];
        const prev = data.length >= 2 ? data[data.length - 2] : null;
        const barDelta = last.delta !== undefined ? last.delta : prev ? last.value - prev.value : last.value;

        let sumBuy = 0;
        let sumSell = 0;
        for (let i = 0; i < data.length; i++) {
            sumBuy += data[i].buyVolume || 0;
            sumSell += data[i].sellVolume || 0;
        }
        const sumTotal = sumBuy + sumSell;
        const buyPct = sumTotal > 0 ? (sumBuy / sumTotal) * 100 : (meta?.buyPct ?? 50);
        const sellPct = sumTotal > 0 ? 100 - buyPct : (meta?.sellPct ?? 50);

        return {
            sessionCvd: last.value,
            barDelta,
            buyPct,
            sellPct,
        };
    }, [data, meta]);

    const isPositive = hudStats.sessionCvd >= 0;
    const isDeltaPos = hudStats.barDelta >= 0;

    return (
        <div className="w-full h-full absolute inset-0 z-0 select-none">
            <div ref={chartContainerRef} className="w-full h-full absolute inset-0" />

            {/* Institutional Live CVD HUD Overlay */}
            <div className="absolute top-1.5 left-2 z-10 pointer-events-none flex flex-wrap items-center gap-2 px-2 py-0.5 rounded-lg bg-white/90 dark:bg-[#070b14]/85 border border-slate-200 dark:border-white/10 text-[10px] font-mono">
                <span className="flex items-center gap-1 font-black tracking-wider text-slate-700 dark:text-slate-200">
                    <span className={`w-1.5 h-1.5 rounded-full ${meta?.isTrueDelta ? 'bg-emerald-400' : 'bg-cyan-400'}`} />
                    {meta?.isTrueDelta ? 'TRUE CVD' : 'CVD'}
                </span>

                <span className={`font-black ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {formatCompactOrderflowNumber(hudStats.sessionCvd, true)}
                </span>

                <span className="text-slate-300 dark:text-white/15">|</span>

                <span className="text-slate-500 dark:text-slate-400">
                    Δ Bar:{' '}
                    <strong className={isDeltaPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                        {formatCompactOrderflowNumber(hudStats.barDelta, true)}
                    </strong>
                </span>

                {/* Buy vs Sell Tug-of-War Micro Bar */}
                <div className="hidden sm:flex items-center gap-1.5">
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">{hudStats.buyPct.toFixed(0)}%</span>
                    <div className="w-14 h-1.5 rounded-full bg-rose-500/40 overflow-hidden">
                        <div
                            className="h-full bg-emerald-500 transition-all duration-300"
                            style={{ width: `${Math.max(4, Math.min(96, hudStats.buyPct))}%` }}
                        />
                    </div>
                    <span className="text-rose-600 dark:text-rose-400 font-bold">{hudStats.sellPct.toFixed(0)}%</span>
                </div>

                {meta?.divergence && (
                    <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border ${
                            meta.divergence === 'BULLISH'
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/35'
                                : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/35'
                        }`}
                    >
                        {meta.divergence === 'BULLISH' ? '▲ BULL DIV' : '▼ BEAR DIV'}
                    </span>
                )}
            </div>
        </div>
    );
};
