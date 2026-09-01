import React, { useEffect, useRef, useState, useCallback } from 'react';
import { IChartApi, ISeriesApi } from 'lightweight-charts';

interface LiquidationHeatmapGodModeRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<"Candlestick"> | null;
    data: any; // godModeData
    visible: boolean;
}

export const LiquidationHeatmapGodModeRenderer: React.FC<LiquidationHeatmapGodModeRendererProps> = ({ chart, series, data, visible }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const animFrameRef = useRef<number>(0);
    const [renderTick, setRenderTick] = useState(0);

    // Subscribe to chart coordinate changes
    useEffect(() => {
        if (!chart || !series) return;
        const handler = () => {
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
            animFrameRef.current = requestAnimationFrame(() => {
                setRenderTick(prev => prev + 1);
            });
        };
        chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
        series.subscribeDataChanged(handler);
        chart.timeScale().subscribeSizeChange(handler);
        return () => {
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
            series.unsubscribeDataChanged(handler);
            chart.timeScale().unsubscribeSizeChange(handler);
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        };
    }, [chart, series]);

    const renderHeatmap = useCallback(() => {
        if (!containerRef.current || !chart || !series || !data || !visible) {
            if (containerRef.current) containerRef.current.innerHTML = '';
            return;
        }

        const el = containerRef.current;
        el.innerHTML = '';

        const W = el.offsetWidth;
        if (!W) return;

        const currentPrice = data.current_price;
        if (!currentPrice) return;

        const magnetZones = data.magnet_zones || [];
        
        magnetZones.forEach((zone: any) => {
            const price = parseFloat(zone.price);
            const intensity = parseInt(zone.intensity);
            
            if (!price || !intensity || intensity < 10) return;

            try {
                const y = series.priceToCoordinate(price);
                if (y === null || y < -100 || y > el.offsetHeight + 100) return;

                const zoneEl = document.createElement('div');
                const isShort = price > currentPrice; // Price above current -> Short liquidations -> Red
                
                // Height based on intensity (max 24px)
                const height = Math.max(4, Math.min(24, (intensity / 100) * 24));
                const opacity = (intensity / 100) * 0.4;
                const glowOpacity = (intensity / 100) * 0.8;
                
                zoneEl.style.position = 'absolute';
                zoneEl.style.left = '0px';
                zoneEl.style.width = '100%';
                zoneEl.style.top = `${y - height / 2}px`;
                zoneEl.style.height = `${height}px`;
                zoneEl.style.pointerEvents = 'none';
                
                if (isShort) {
                    zoneEl.style.backgroundColor = `rgba(244, 63, 94, ${opacity})`; // rose-500
                    zoneEl.style.boxShadow = `0 0 ${height * 1.5}px rgba(244, 63, 94, ${glowOpacity})`;
                    zoneEl.style.borderTop = `1px solid rgba(244, 63, 94, ${opacity + 0.2})`;
                } else {
                    zoneEl.style.backgroundColor = `rgba(16, 185, 129, ${opacity})`; // emerald-500
                    zoneEl.style.boxShadow = `0 0 ${height * 1.5}px rgba(16, 185, 129, ${glowOpacity})`;
                    zoneEl.style.borderBottom = `1px solid rgba(16, 185, 129, ${opacity + 0.2})`;
                }

                // Add intensity label on the right side
                const label = document.createElement('div');
                label.innerText = `LIQ ${intensity}%`;
                label.style.position = 'absolute';
                label.style.right = '4px';
                label.style.top = '50%';
                label.style.transform = 'translateY(-50%)';
                label.style.fontSize = '9px';
                label.style.fontWeight = 'bold';
                label.style.color = isShort ? 'rgba(255,228,230,0.8)' : 'rgba(209,250,229,0.8)'; // emerald-100
                label.style.fontFamily = 'monospace';
                label.style.textShadow = '0 0 2px black';
                
                zoneEl.appendChild(label);
                el.appendChild(zoneEl);

            } catch (e) {
                // Ignore coordinate mapping errors for out-of-bounds prices
            }
        });
        
    }, [chart, series, data, visible, renderTick]);

    useEffect(() => {
        renderHeatmap();
    }, [renderHeatmap]);

    if (!visible) return null;

    return (
        <div ref={containerRef} className="absolute inset-0 pointer-events-none overflow-hidden z-[5]" />
    );
};
