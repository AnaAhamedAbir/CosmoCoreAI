import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
    createChart,
    ColorType,
    IChartApi,
    CandlestickSeries,
    HistogramSeries,
    ISeriesApi,
    Time,
    createSeriesMarkers,
    LineSeries,
    SeriesMarker,
    LineStyle,
} from 'lightweight-charts';
import { Layers, Activity, Eye, EyeOff, Maximize2, Crosshair } from 'lucide-react';
import type { ClosedTrade } from '@/types';

interface CandleData {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

interface TradeMarker {
    time: number;
    type: 'buy' | 'sell';
    price: number;
}

interface BacktestChartProps {
    data: any[];
    trades: TradeMarker[];
    focusedTrade?: ClosedTrade | null;
    onClearFocus?: () => void;
    height?: number;
}

interface IndicatorConfig {
    id: string;
    name: string;
    type: 'SMA' | 'EMA' | 'BB';
    period: number;
    color: string;
    visible: boolean;
    stdDev?: number;
}

const calculateSMA = (data: CandleData[], period: number) => {
    const p = Math.max(1, Math.floor(Number(period) || 20));
    if (!Array.isArray(data) || data.length < p) return [];
    const smaData = [];
    for (let i = p - 1; i < data.length; i++) {
        if (!data[i] || data[i].time === undefined) continue;
        const slice = data.slice(i - p + 1, i + 1);
        const sum = slice.reduce((acc, val) => acc + (val?.close || 0), 0);
        smaData.push({ time: data[i].time as Time, value: sum / p });
    }
    return smaData;
};

const calculateEMA = (data: CandleData[], period: number) => {
    const p = Math.max(1, Math.floor(Number(period) || 20));
    if (!Array.isArray(data) || data.length === 0 || !data[0]) return [];
    const emaData = [];
    const k = 2 / (p + 1);
    let ema = data[0].close || 0;

    for (let i = 0; i < data.length; i++) {
        if (!data[i] || data[i].time === undefined) continue;
        if (i === 0) {
            emaData.push({ time: data[i].time as Time, value: data[i].close });
        } else {
            ema = (data[i].close || 0) * k + ema * (1 - k);
            emaData.push({ time: data[i].time as Time, value: ema });
        }
    }
    return emaData;
};

const calculateBollingerBands = (data: CandleData[], period: number, stdDevMultiplier: number) => {
    const p = Math.max(1, Math.floor(Number(period) || 20));
    const mult = Number.isFinite(Number(stdDevMultiplier)) ? Number(stdDevMultiplier) : 2;
    const upper: { time: Time; value: number }[] = [];
    const lower: { time: Time; value: number }[] = [];
    if (!Array.isArray(data) || data.length < p) return { upper, middle: [], lower };

    const middle = calculateSMA(data, p);
    const startIndex = p - 1;

    for (let i = 0; i < middle.length; i++) {
        const dataIndex = startIndex + i;
        const currentData = data[dataIndex];
        if (!currentData || currentData.time === undefined) continue;
        const slice = data.slice(dataIndex - p + 1, dataIndex + 1);
        const mean = middle[i].value;
        const variance = slice.reduce((acc, d) => acc + Math.pow((d?.close || 0) - mean, 2), 0) / p;
        const stdDev = Math.sqrt(variance);
        upper.push({ time: currentData.time as Time, value: mean + stdDev * mult });
        lower.push({ time: currentData.time as Time, value: mean - stdDev * mult });
    }

    return { upper, middle, lower };
};

const findClosestCandle = (sortedData: CandleData[], targetTime: number) => {
    let left = 0;
    let right = sortedData.length - 1;
    let closest = sortedData[0];
    let minDiff = Infinity;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const candle = sortedData[mid];
        const diff = Math.abs(candle.time - targetTime);
        if (diff < minDiff) {
            minDiff = diff;
            closest = candle;
        }
        if (candle.time < targetTime) left = mid + 1;
        else if (candle.time > targetTime) right = mid - 1;
        else return candle;
    }
    return closest;
};

const formatChartData = (rawData: any[]): CandleData[] => {
    if (!rawData || rawData.length === 0) return [];
    if (!Array.isArray(rawData[0])) return rawData as CandleData[];
    return rawData.map((c: any[]) => ({
        time: c[0] as number,
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: c[5] ?? 0,
    }));
};

const BacktestChart: React.FC<BacktestChartProps> = ({
    data = [],
    trades = [],
    focusedTrade = null,
    onClearFocus,
    height = 420,
}) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const focusSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const indicatorSeriesRefs = useRef<Map<string, ISeriesApi<'Line'>[]>>(new Map());

    const [showVolume, setShowVolume] = useState(true);
    const [indicators, setIndicators] = useState<IndicatorConfig[]>([
        { id: 'sma20', name: 'SMA 20', type: 'SMA', period: 20, color: '#F59E0B', visible: false },
        { id: 'ema50', name: 'EMA 50', type: 'EMA', period: 50, color: '#3B82F6', visible: false },
        { id: 'ema200', name: 'EMA 200', type: 'EMA', period: 200, color: '#EC4899', visible: false },
        { id: 'bb20', name: 'BB (20, 2)', type: 'BB', period: 20, stdDev: 2, color: '#8B5CF6', visible: false },
    ]);

    const formattedData = useMemo(() => {
        const raw = formatChartData(data);
        const uniqueDataMap = new Map<number, CandleData>();
        raw.forEach((item) => uniqueDataMap.set(item.time, item));
        return Array.from(uniqueDataMap.values()).sort((a, b) => a.time - b.time);
    }, [data]);

    // 1. Initialize Chart + ResizeObserver
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: '#0A0A0A' },
                textColor: '#94A3B8',
            },
            grid: {
                vertLines: { color: '#1A1A1A', style: LineStyle.Dotted },
                horzLines: { color: '#1A1A1A', style: LineStyle.Dotted },
            },
            width: chartContainerRef.current.clientWidth,
            height,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: '#1F1F1F',
            },
            rightPriceScale: {
                borderColor: '#1F1F1F',
                scaleMargins: { top: 0.08, bottom: 0.22 },
            },
            crosshair: {
                mode: 1,
            },
        });

        chartRef.current = chart;

        const series = chart.addSeries(CandlestickSeries, {
            upColor: '#10B981',
            downColor: '#EF4444',
            borderVisible: false,
            wickUpColor: '#10B981',
            wickDownColor: '#EF4444',
        });
        candlestickSeriesRef.current = series;

        const volumeSeries = chart.addSeries(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
        });
        chart.priceScale('volume').applyOptions({
            scaleMargins: { top: 0.82, bottom: 0 },
        });
        volumeSeriesRef.current = volumeSeries;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.contentRect.width > 0) {
                    chart.applyOptions({ width: entry.contentRect.width, height });
                }
            }
        });
        observer.observe(chartContainerRef.current);

        return () => {
            observer.disconnect();
            chart.remove();
            chartRef.current = null;
            candlestickSeriesRef.current = null;
            volumeSeriesRef.current = null;
            focusSeriesRef.current = null;
        };
    }, [height]);

    // 2. Update Candle Data, Volume & Trade Markers
    useEffect(() => {
        if (!candlestickSeriesRef.current || formattedData.length === 0) return;

        candlestickSeriesRef.current.setData(formattedData as any);

        if (volumeSeriesRef.current) {
            if (showVolume) {
                const volData = formattedData.map((d) => ({
                    time: d.time as Time,
                    value: d.volume ?? 0,
                    color: d.close >= d.open ? 'rgba(16, 185, 129, 0.28)' : 'rgba(239, 68, 68, 0.28)',
                }));
                volumeSeriesRef.current.setData(volData);
            } else {
                volumeSeriesRef.current.setData([]);
            }
        }

        const validMarkers: SeriesMarker<Time>[] = [];
        trades.forEach((trade) => {
            const tradeTime = Number(trade.time);
            const closest = findClosestCandle(formattedData, tradeTime);
            if (closest && Math.abs(closest.time - tradeTime) <= 86400) {
                validMarkers.push({
                    time: closest.time as Time,
                    position: trade.type === 'buy' ? 'belowBar' : 'aboveBar',
                    color: trade.type === 'buy' ? '#10B981' : '#EF4444',
                    shape: trade.type === 'buy' ? 'arrowUp' : 'arrowDown',
                    text: `${trade.type.toUpperCase()} @ ${Number(trade.price).toFixed(2)}`,
                    size: 1.4,
                });
            }
        });
        validMarkers.sort((a, b) => (a.time as number) - (b.time as number));
        createSeriesMarkers(candlestickSeriesRef.current, validMarkers);

        if (chartRef.current && !focusedTrade) {
            chartRef.current.timeScale().fitContent();
        }
    }, [formattedData, trades, showVolume, focusedTrade]);

    // 3. Handle Indicators Layer
    useEffect(() => {
        if (!chartRef.current || formattedData.length === 0) return;

        indicatorSeriesRefs.current.forEach((seriesList) => {
            seriesList.forEach((s) => {
                try { chartRef.current?.removeSeries(s); } catch { /* noop */ }
            });
        });
        indicatorSeriesRefs.current.clear();

        indicators.forEach((ind) => {
            if (!ind.visible || !chartRef.current) return;

            if (ind.type === 'SMA') {
                const smaSeries = chartRef.current.addSeries(LineSeries, {
                    color: ind.color,
                    lineWidth: 2,
                    title: ind.name,
                    priceLineVisible: false,
                });
                smaSeries.setData(calculateSMA(formattedData, ind.period));
                indicatorSeriesRefs.current.set(ind.id, [smaSeries]);
            } else if (ind.type === 'EMA') {
                const emaSeries = chartRef.current.addSeries(LineSeries, {
                    color: ind.color,
                    lineWidth: 2,
                    title: ind.name,
                    priceLineVisible: false,
                });
                emaSeries.setData(calculateEMA(formattedData, ind.period));
                indicatorSeriesRefs.current.set(ind.id, [emaSeries]);
            } else if (ind.type === 'BB') {
                const { upper, lower } = calculateBollingerBands(formattedData, ind.period, ind.stdDev || 2);
                const upperSeries = chartRef.current.addSeries(LineSeries, {
                    color: ind.color,
                    lineWidth: 1,
                    title: `${ind.name} Upper`,
                    priceLineVisible: false,
                });
                upperSeries.setData(upper);
                const lowerSeries = chartRef.current.addSeries(LineSeries, {
                    color: ind.color,
                    lineWidth: 1,
                    title: `${ind.name} Lower`,
                    priceLineVisible: false,
                });
                lowerSeries.setData(lower);
                indicatorSeriesRefs.current.set(ind.id, [upperSeries, lowerSeries]);
            }
        });
    }, [indicators, formattedData]);

    // 4. Focused Trade Zoom + Entry-to-Exit Connector Line
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart || formattedData.length === 0) return;

        if (focusSeriesRef.current) {
            try { chart.removeSeries(focusSeriesRef.current); } catch { /* noop */ }
            focusSeriesRef.current = null;
        }

        if (!focusedTrade) return;

        const entryCandle = findClosestCandle(formattedData, focusedTrade.entry_time);
        const exitCandle = findClosestCandle(formattedData, focusedTrade.exit_time);
        if (!entryCandle || !exitCandle) return;

        const isWin = focusedTrade.pnl_net >= 0;
        const lineSeries = chart.addSeries(LineSeries, {
            color: isWin ? '#10B981' : '#EF4444',
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            priceLineVisible: false,
            lastValueVisible: false,
            title: `#${focusedTrade.id} ${focusedTrade.side}`,
        });

        const points = entryCandle.time === exitCandle.time
            ? [{ time: entryCandle.time as Time, value: focusedTrade.entry_price }]
            : [
                { time: entryCandle.time as Time, value: focusedTrade.entry_price },
                { time: exitCandle.time as Time, value: focusedTrade.exit_price },
            ].sort((a, b) => (a.time as number) - (b.time as number));

        lineSeries.setData(points);
        focusSeriesRef.current = lineSeries;

        const span = Math.max(3600 * 6, Math.abs(exitCandle.time - entryCandle.time));
        const padding = Math.round(span * 0.45);
        try {
            chart.timeScale().setVisibleRange({
                from: (Math.min(entryCandle.time, exitCandle.time) - padding) as Time,
                to: (Math.max(entryCandle.time, exitCandle.time) + padding) as Time,
            });
        } catch {
            chart.timeScale().fitContent();
        }
    }, [focusedTrade, formattedData]);

    const toggleIndicator = (id: string) => {
        setIndicators((prev) => prev.map((ind) => (ind.id === id ? { ...ind, visible: !ind.visible } : ind)));
    };

    const handleResetZoom = () => {
        onClearFocus?.();
        chartRef.current?.timeScale().fitContent();
    };

    return (
        <div className="relative w-full flex flex-col">
            {/* Compact Pro Chart Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-100/80 dark:bg-[#0A0A0A] rounded-t-xl border border-slate-200 dark:border-[#1F1F1F]">
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 text-[11px] font-bold uppercase tracking-wider mr-1">
                        <Activity size={13} className="text-brand-primary" /> Overlays
                    </span>
                    <button
                        onClick={() => setShowVolume((v) => !v)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all border ${
                            showVolume
                                ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/40'
                                : 'bg-transparent text-slate-500 border-slate-300 dark:border-[#1F1F1F] hover:text-slate-300'
                        }`}
                    >
                        {showVolume ? <Eye size={11} /> : <EyeOff size={11} />} Vol
                    </button>
                    {indicators.map((ind) => (
                        <button
                            key={ind.id}
                            onClick={() => toggleIndicator(ind.id)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all border ${
                                ind.visible
                                    ? 'bg-slate-900 text-white dark:bg-[#161616]'
                                    : 'bg-transparent text-slate-500 border-slate-300 dark:border-[#1F1F1F] hover:text-slate-300'
                            }`}
                            style={{ borderColor: ind.visible ? ind.color : undefined }}
                        >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ind.color }} />
                            {ind.name}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-2">
                    {focusedTrade && (
                        <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-brand-primary/10 border border-brand-primary/30 text-[11px] font-mono">
                            <Crosshair size={12} className="text-brand-primary" />
                            <span className="text-slate-800 dark:text-slate-200 font-bold">
                                #{focusedTrade.id} {focusedTrade.side}
                            </span>
                            <span className={focusedTrade.pnl_net >= 0 ? 'text-emerald-500 font-bold' : 'text-rose-500 font-bold'}>
                                {focusedTrade.pnl_net >= 0 ? '+' : ''}${focusedTrade.pnl_net.toFixed(2)} ({focusedTrade.return_pct}%)
                            </span>
                        </div>
                    )}
                    <button
                        onClick={handleResetZoom}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-[#1F1F1F] transition-colors"
                        title="Fit All Candles"
                    >
                        <Maximize2 size={11} /> Fit
                    </button>
                </div>
            </div>

            {/* Chart Container */}
            <div className="relative w-full" style={{ height }}>
                <div
                    ref={chartContainerRef}
                    className="w-full h-full rounded-b-xl overflow-hidden border-x border-b border-slate-200 dark:border-[#1F1F1F] bg-[#0A0A0A]"
                />
                {!formattedData.length && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#050505]/80 text-slate-400 text-sm pointer-events-none z-10">
                        <div className="flex flex-col items-center gap-2">
                            <Layers size={24} />
                            <span>No Chart Data Available to Display</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BacktestChart;
