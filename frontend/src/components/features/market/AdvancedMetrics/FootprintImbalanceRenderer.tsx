import React, { useEffect, useState, useRef, useCallback } from 'react';
import { IChartApi, ISeriesApi } from 'lightweight-charts';
import { useTheme } from '@/context/ThemeContext';

interface FootprintImbalanceRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    visible: boolean;
    data?: Array<{ price: number; type: string; ratio?: number }>;
}

interface PlacedImbalanceBadge {
    y: number;
    price: number;
    type: string;
    ratio: number;
}

export const FootprintImbalanceRenderer: React.FC<FootprintImbalanceRendererProps> = ({
    chart,
    series,
    visible,
    data,
}) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const containerRef = useRef<HTMLDivElement>(null);
    const dataRef = useRef(data);
    dataRef.current = data;
    const rafIdRef = useRef<number | null>(null);
    const [renderData, setRenderData] = useState<PlacedImbalanceBadge[]>([]);

    const updatePositions = useCallback(() => {
        const items = dataRef.current;
        if (!visible || !chart || !series || !items || items.length === 0) {
            setRenderData([]);
            return;
        }

        const paneH = containerRef.current?.clientHeight || 600;
        const candidates: PlacedImbalanceBadge[] = [];

        for (let i = 0; i < items.length; i++) {
            const d = items[i];
            if (!d || !Number.isFinite(Number(d.price))) continue;
            const y = series.priceToCoordinate(Number(d.price));
            if (y === null || y < 10 || y > paneH - 10) continue;
            const ratioNum = Number(d.ratio);
            candidates.push({
                y: Number(y),
                price: Number(d.price),
                type: String(d.type || 'buy_imbalance'),
                ratio: Number.isFinite(ratioNum) ? ratioNum : 0,
            });
        }

        // Prioritize strongest imbalances and apply vertical anti-collision spacing (18px)
        candidates.sort((a, b) => b.ratio - a.ratio);
        const placed: PlacedImbalanceBadge[] = [];
        for (let i = 0; i < candidates.length && placed.length < 12; i++) {
            const c = candidates[i];
            if (placed.some((p) => Math.abs(p.y - c.y) < 18)) continue;
            placed.push(c);
        }

        setRenderData(placed);
    }, [chart, series, visible]);

    const scheduleUpdate = useCallback(() => {
        if (rafIdRef.current !== null) return;
        rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = null;
            updatePositions();
        });
    }, [updatePositions]);

    useEffect(() => {
        scheduleUpdate();
    }, [data, visible, scheduleUpdate]);

    useEffect(() => {
        if (!visible || !chart || !series) {
            setRenderData([]);
            return;
        }

        const timeScale = chart.timeScale();
        timeScale.subscribeVisibleTimeRangeChange(scheduleUpdate);
        timeScale.subscribeVisibleLogicalRangeChange(scheduleUpdate);
        timeScale.subscribeSizeChange(scheduleUpdate);

        const parent = containerRef.current?.parentElement;
        const chartRoot = parent?.parentElement;
        const observer = parent ? new ResizeObserver(scheduleUpdate) : null;
        if (parent && observer) observer.observe(parent);

        const handlePointerDrag = (e: PointerEvent) => {
            if (e.buttons !== 0) scheduleUpdate();
        };
        chartRoot?.addEventListener('wheel', scheduleUpdate, { passive: true });
        chartRoot?.addEventListener('pointermove', handlePointerDrag, { passive: true });
        chartRoot?.addEventListener('pointerup', scheduleUpdate, { passive: true });
        chartRoot?.addEventListener('dblclick', scheduleUpdate, { passive: true });

        scheduleUpdate();

        return () => {
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
            observer?.disconnect();
            chartRoot?.removeEventListener('wheel', scheduleUpdate);
            chartRoot?.removeEventListener('pointermove', scheduleUpdate);
            chartRoot?.removeEventListener('pointerup', scheduleUpdate);
            chartRoot?.removeEventListener('dblclick', scheduleUpdate);
            try {
                timeScale.unsubscribeVisibleTimeRangeChange(scheduleUpdate);
                timeScale.unsubscribeVisibleLogicalRangeChange(scheduleUpdate);
                timeScale.unsubscribeSizeChange(scheduleUpdate);
            } catch {}
        };
    }, [chart, series, visible, scheduleUpdate]);

    if (!visible || !chart || !series || renderData.length === 0) return null;

    return (
        <div ref={containerRef} className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
            {renderData.map((d) => {
                const isBuy = d.type === 'buy_imbalance';
                return (
                    <div
                        key={`${d.type}-${d.price}`}
                        className="absolute right-20 flex items-center justify-center font-mono font-bold text-[9.5px] rounded px-1.5 whitespace-nowrap"
                        style={{
                            top: `${Math.round(d.y - 8)}px`,
                            height: '16px',
                            background: isBuy
                                ? (isDark ? 'rgba(6, 78, 59, 0.85)' : 'rgba(209, 250, 229, 0.94)')
                                : (isDark ? 'rgba(136, 19, 55, 0.85)' : 'rgba(255, 228, 230, 0.94)'),
                            border: `1px solid ${isBuy ? (isDark ? '#34d399' : '#059669') : (isDark ? '#fb7185' : '#e11d48')}`,
                            color: isBuy ? (isDark ? '#6ee7b7' : '#065f46') : (isDark ? '#fda4af' : '#9f1239'),
                        }}
                    >
                        {d.ratio >= 999 ? 'MAX IMB' : `${d.ratio.toFixed(1)}x IMB`}
                    </div>
                );
            })}
        </div>
    );
};
