import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import {
    createChart,
    IChartApi,
    ISeriesApi,
    BaselineSeries,
    HistogramSeries,
    LineStyle,
} from 'lightweight-charts';
import { Link2, Unlink2, Maximize2 } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { formatCompactOrderflowNumber } from '../../../utils/orderflowMath';
import { attachChartPaneSync, ChartPaneSyncController } from '../../../utils/chartPaneSync';

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
    loading?: boolean;
    interval?: string;
}

export const CVDChart: React.FC<CVDChartProps> = ({ mainChart, data, meta, loading = false, interval = '1m' }) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const [isSyncLocked, setIsSyncLocked] = useState<boolean>(true);
    const isSyncLockedRef = useRef<boolean>(true);
    isSyncLockedRef.current = isSyncLocked;

    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const cvdSeriesRef = useRef<ISeriesApi<'Baseline'> | null>(null);
    const deltaSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const syncControllerRef = useRef<ChartPaneSyncController | null>(null);

    const isMutatingDataRef = useRef<boolean>(false);
    const mutateRafRef = useRef<number | null>(null);
    const lastRenderedCountRef = useRef<number>(0);
    const lastRenderedFirstTimeRef = useRef<number>(0);
    const lastRenderedLastTimeRef = useRef<number>(0);
    const anchorTimesRef = useRef<number[]>([]);
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
                timeVisible: true,
                secondsVisible: false,
            },
            rightPriceScale: {
                borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.12)',
                autoScale: true,
                minimumWidth: 74,
                scaleMargins: { top: 0.22, bottom: 0.12 },
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
            scaleMargins: { top: 0.58, bottom: 0.02 },
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
                    syncControllerRef.current?.syncPriceScales();
                    if (isSyncLockedRef.current) {
                        syncControllerRef.current?.syncMainToSub();
                    }
                } catch {}
            }
        });
        resizeObserver.observe(container);

        return () => {
            if (mutateRafRef.current !== null) {
                cancelAnimationFrame(mutateRafRef.current);
                mutateRafRef.current = null;
            }
            resizeObserver.disconnect();
            chartRef.current = null;
            cvdSeriesRef.current = null;
            deltaSeriesRef.current = null;
            try {
                chart.remove();
            } catch {}
        };
    }, []);

    // Dynamically sync Light/Dark Theme & Time Axis Visibility without recreating the chart
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
                visible: !isSyncLocked,
                timeVisible: true,
                secondsVisible: Boolean(interval && interval.endsWith('s')),
            },
            rightPriceScale: {
                borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.12)',
            },
        });
    }, [isDark, isSyncLocked, interval]);

    // Sync Data with Incremental `.update()` on Live Ticks (Zero Full-Chart Flicker & Zero Main-Chart Zoom Disturbance!)
    useEffect(() => {
        const cvdSeries = cvdSeriesRef.current;
        const deltaSeries = deltaSeriesRef.current;
        if (!cvdSeries || !deltaSeries) return;

        const beginDataMutation = () => {
            isMutatingDataRef.current = true;
            if (mutateRafRef.current !== null) cancelAnimationFrame(mutateRafRef.current);
        };

        const endDataMutationNextFrame = () => {
            mutateRafRef.current = requestAnimationFrame(() => {
                isMutatingDataRef.current = false;
                mutateRafRef.current = null;
                if (isSyncLockedRef.current) {
                    syncControllerRef.current?.syncMainToSub();
                }
            });
        };

        if (!data || data.length === 0) {
            beginDataMutation();
            try {
                cvdSeries.setData([]);
                deltaSeries.setData([]);
                valueByTimeRef.current.clear();
                lastRenderedCountRef.current = 0;
                lastRenderedFirstTimeRef.current = 0;
                lastRenderedLastTimeRef.current = 0;
                anchorTimesRef.current = [];
            } catch {}
            endDataMutationNextFrame();
            return;
        }

        const buildAnchorTimes = (pts: CVDDataPoint[]): number[] => {
            const n = pts.length;
            if (n === 0) return [];
            const idxs = [n - 1, n - 2, n - 3, Math.floor(n / 2), 0];
            const out: number[] = [];
            for (const i of idxs) {
                if (i >= 0 && i < n) {
                    const t = pts[i].time;
                    if (Number.isFinite(t) && !out.includes(t)) out.push(t);
                }
            }
            return out;
        };

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
                anchorTimesRef.current = buildAnchorTimes(data);
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

        beginDataMutation();
        try {
            cvdSeries.setData(cvdPoints);
            deltaSeries.setData(deltaPoints);
            lastRenderedCountRef.current = sorted.length;
            lastRenderedFirstTimeRef.current = sorted[0].time;
            lastRenderedLastTimeRef.current = sorted[sorted.length - 1].time;
            anchorTimesRef.current = buildAnchorTimes(sorted);

            // Immediately align CVD logical viewport to Main Chart WITHOUT ever touching Main Chart's zoom/pan
            if (isSyncLockedRef.current) {
                syncControllerRef.current?.syncMainToSub();
            }
        } catch (err) {
            console.error('Failed to set CVD Chart data:', err);
        } finally {
            endDataMutationNextFrame();
        }
    }, [data, mainChart]);

    // Timestamp-Calibrated Logical-Range & Crosshair Sync (Zero Auto-Zoom, Zero Whitespace Clamping, Zero Ping-Pong!)
    useEffect(() => {
        if (!mainChart || !chartRef.current || !chartContainerRef.current) return;

        const cvdChart = chartRef.current;
        const controller = attachChartPaneSync({
            mainChart,
            subChart: cvdChart,
            subContainer: chartContainerRef.current,
            getSubAnchorTimes: () => anchorTimesRef.current,
            isSubMutating: () => isMutatingDataRef.current,
            initialLocked: isSyncLockedRef.current,
        });
        syncControllerRef.current = controller;

        const syncCrosshairMainToCVD = (param: any) => {
            if (!isSyncLockedRef.current || !param.point || !param.time || !cvdSeriesRef.current) {
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

        mainChart.subscribeCrosshairMove(syncCrosshairMainToCVD);

        return () => {
            syncControllerRef.current = null;
            controller.destroy();
            try {
                mainChart.unsubscribeCrosshairMove(syncCrosshairMainToCVD);
            } catch {}
        };
    }, [mainChart]);

    const handleToggleSyncLock = useCallback(() => {
        setIsSyncLocked((prev) => {
            const next = !prev;
            syncControllerRef.current?.setLocked(next);
            return next;
        });
    }, []);

    const handleFitCvd = useCallback(() => {
        try {
            chartRef.current?.timeScale().fitContent();
        } catch {}
    }, []);

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
            <div className="absolute top-1.5 left-2 z-10 pointer-events-none flex flex-wrap items-center gap-1.5">
                <div className="flex flex-wrap items-center gap-2 px-2 py-0.5 rounded-lg bg-white/90 dark:bg-[#070b14]/90 border border-slate-200 dark:border-white/10 text-[10px] font-mono shadow-sm">
                    <span className="flex items-center gap-1 font-black tracking-wider text-slate-700 dark:text-slate-200">
                        <span className={`w-1.5 h-1.5 rounded-full ${meta?.isTrueDelta ? 'bg-emerald-400' : 'bg-cyan-400'}`} />
                        {meta?.isTrueDelta ? 'TRUE CVD' : 'CVD'}
                    </span>

                    {loading && data.length === 0 ? (
                        <span className="text-slate-400 dark:text-slate-400 animate-pulse">Loading...</span>
                    ) : (
                        <>
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
                        </>
                    )}
                </div>

                {/* Pro Time-Sync Lock / Independent Mode Controls */}
                <button
                    type="button"
                    onClick={handleToggleSyncLock}
                    title={
                        isSyncLocked
                            ? 'Time axis linked to Order Flow chart (click to unlock independent pan/zoom)'
                            : 'Independent CVD pan/zoom mode (click to re-link with Order Flow chart)'
                    }
                    className={`pointer-events-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-bold transition-colors cursor-pointer ${
                        isSyncLocked
                            ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/25'
                            : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/25'
                    }`}
                >
                    {isSyncLocked ? <Link2 className="w-3 h-3" /> : <Unlink2 className="w-3 h-3" />}
                    <span>{isSyncLocked ? 'Synced' : 'Free'}</span>
                </button>

                {!isSyncLocked && (
                    <button
                        type="button"
                        onClick={handleFitCvd}
                        title="Fit all CVD bars in view"
                        className="pointer-events-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white/90 dark:bg-[#070b14]/90 text-slate-600 dark:text-slate-300 hover:text-cyan-500 text-[10px] font-bold transition-colors cursor-pointer"
                    >
                        <Maximize2 className="w-2.5 h-2.5" />
                        <span>Fit</span>
                    </button>
                )}
            </div>
        </div>
    );
};
