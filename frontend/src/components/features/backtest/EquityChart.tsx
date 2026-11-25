import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, ColorType, IChartApi, Time, AreaSeries, LineSeries, LineStyle, PriceScaleMode } from 'lightweight-charts';
import { TrendingUp } from 'lucide-react';

interface EquityPoint {
    time: number;
    value: number;
}

interface CompareSeries {
    label: string;
    color: string;
    data: EquityPoint[];
}

interface EquityChartProps {
    data: EquityPoint[];
    benchmarkData?: EquityPoint[];
    compareSeries?: CompareSeries[];
    height?: number;
}

const EquityChart: React.FC<EquityChartProps> = ({
    data = [],
    benchmarkData = [],
    compareSeries = [],
    height = 300,
}) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const [isLogScale, setIsLogScale] = useState(false);
    const [showBenchmark, setShowBenchmark] = useState(true);

    const stats = useMemo(() => {
        if (!data.length) return null;
        const first = data[0].value;
        const last = data[data.length - 1].value;
        const stratRet = first > 0 ? ((last - first) / first) * 100 : 0;

        let benchRet: number | null = null;
        if (benchmarkData.length > 1) {
            const bFirst = benchmarkData[0].value;
            const bLast = benchmarkData[benchmarkData.length - 1].value;
            if (bFirst > 0) benchRet = ((bLast - bFirst) / bFirst) * 100;
        }
        return {
            stratRet,
            benchRet,
            alpha: benchRet !== null ? stratRet - benchRet : null,
        };
    }, [data, benchmarkData]);

    useEffect(() => {
        if (!chartContainerRef.current || !data || data.length === 0) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#9CA3AF',
            },
            grid: {
                vertLines: { color: '#18181B' },
                horzLines: { color: '#18181B' },
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
                mode: isLogScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
            },
            crosshair: {
                vertLine: { color: '#6366f1', width: 1, style: 3, labelBackgroundColor: '#6366f1' },
                horzLine: { color: '#6366f1', width: 1, style: 3, labelBackgroundColor: '#6366f1' },
            },
        });
        chartRef.current = chart;

        const areaSeries = chart.addSeries(AreaSeries, {
            topColor: 'rgba(59, 130, 246, 0.35)',
            bottomColor: 'rgba(59, 130, 246, 0.0)',
            lineColor: '#3b82f6',
            lineWidth: 2,
            title: 'Strategy',
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 4,
        });

        const uniqueSorted = (pts: EquityPoint[]) => {
            const m = new Map<number, number>();
            pts.forEach((p) => { if (Number.isFinite(p.time) && Number.isFinite(p.value)) m.set(p.time, p.value); });
            return Array.from(m.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([t, v]) => ({ time: t as Time, value: v }));
        };

        areaSeries.setData(uniqueSorted(data));

        if (showBenchmark && benchmarkData && benchmarkData.length > 0) {
            const benchSeries = chart.addSeries(LineSeries, {
                color: '#F59E0B',
                lineWidth: 2,
                lineStyle: LineStyle.Dashed,
                title: 'Buy & Hold',
                priceLineVisible: false,
            });
            benchSeries.setData(uniqueSorted(benchmarkData));
        }

        compareSeries.forEach((cs) => {
            if (!cs.data.length) return;
            const s = chart.addSeries(LineSeries, {
                color: cs.color,
                lineWidth: 2,
                title: cs.label,
                priceLineVisible: false,
            });
            s.setData(uniqueSorted(cs.data));
        });

        chart.timeScale().fitContent();

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
        };
    }, [data, benchmarkData, compareSeries, height, isLogScale, showBenchmark]);

    return (
        <div className="w-full bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-xl p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 px-1">
                <div className="flex items-center gap-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <TrendingUp size={13} className="text-blue-500" /> Equity Curve
                    </h3>
                    {stats && (
                        <div className="flex items-center gap-2 text-[11px] font-mono">
                            <span className={stats.stratRet >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                Strategy: {stats.stratRet >= 0 ? '+' : ''}{stats.stratRet.toFixed(2)}%
                            </span>
                            {stats.benchRet !== null && (
                                <span className="text-amber-400">
                                    B&H: {stats.benchRet >= 0 ? '+' : ''}{stats.benchRet.toFixed(2)}%
                                </span>
                            )}
                            {stats.alpha !== null && (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${stats.alpha >= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
                                    Alpha: {stats.alpha >= 0 ? '+' : ''}{stats.alpha.toFixed(2)}%
                                </span>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-1.5">
                    {benchmarkData.length > 0 && (
                        <button
                            onClick={() => setShowBenchmark((v) => !v)}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                                showBenchmark
                                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                    : 'text-slate-500 border-[#1F1F1F] hover:text-slate-300'
                            }`}
                        >
                            Buy & Hold
                        </button>
                    )}
                    <button
                        onClick={() => setIsLogScale((v) => !v)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                            isLogScale
                                ? 'bg-blue-500/15 text-blue-400 border-blue-500/40'
                                : 'text-slate-500 border-[#1F1F1F] hover:text-slate-300'
                        }`}
                    >
                        {isLogScale ? 'LOG' : 'LIN'}
                    </button>
                </div>
            </div>
            <div ref={chartContainerRef} className="w-full" style={{ height }} />
        </div>
    );
};

export default EquityChart;
