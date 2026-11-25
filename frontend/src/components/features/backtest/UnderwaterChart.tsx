import React, { useEffect, useRef, useMemo } from 'react';
import { createChart, ColorType, IChartApi, AreaSeries, Time } from 'lightweight-charts';
import { TrendingDown } from 'lucide-react';

interface DrawdownData {
    time: string | number;
    value: number;
}

interface UnderwaterChartProps {
    data: DrawdownData[];
    height?: number;
}

const UnderwaterChart: React.FC<UnderwaterChartProps> = ({ data = [], height = 180 }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);

    const maxDD = useMemo(() => {
        if (!data.length) return 0;
        return Math.min(...data.map((d) => (d.value > 0 ? -d.value : d.value)));
    }, [data]);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: '#0A0A0A' },
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
                scaleMargins: { top: 0.1, bottom: 0.1 },
            },
        });
        chartRef.current = chart;

        const drawdownSeries = chart.addSeries(AreaSeries, {
            topColor: 'rgba(239, 68, 68, 0)',
            bottomColor: 'rgba(239, 68, 68, 0.45)',
            lineColor: '#EF4444',
            lineWidth: 2,
        });

        const formattedData = data
            .map((d) => ({
                time: d.time as Time,
                value: d.value > 0 ? -d.value : d.value,
            }))
            .sort((a, b) => Number(a.time) - Number(b.time));

        drawdownSeries.setData(formattedData);
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
    }, [data, height]);

    return (
        <div className="relative w-full bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200 dark:border-[#1F1F1F] p-3">
            <div className="flex items-center justify-between mb-2 px-1">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <TrendingDown size={13} className="text-rose-500" /> Drawdown (Underwater)
                </h3>
                <span className="text-[11px] font-mono font-bold text-rose-400">
                    Peak DD: {maxDD.toFixed(2)}%
                </span>
            </div>
            <div ref={chartContainerRef} className="w-full" style={{ height }} />

            {!data.length && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-slate-500 text-sm rounded-xl">
                    No Drawdown Data
                </div>
            )}
        </div>
    );
};

export default UnderwaterChart;
