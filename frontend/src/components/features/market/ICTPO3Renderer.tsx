import React, { useEffect, useRef, useCallback } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

// Data structure expected from backend for PO3
export interface PO3Zone {
    state: string;
    acc_start: string | null;
    acc_end: string | null;
    acc_top: number | null;
    acc_bottom: number | null;
    man_start: string | null;
    man_end: string | null;
    man_top: number | null;
    man_bottom: number | null;
    entry_type: string | null;
    entry_price: number | null;
    entry_time: string | null;
    tp_target: number | null;
    sl_target: number | null;
    exit_price: number | null;
    exit_time: string | null;
}

export interface ICTPO3Data {
    state: string;
    signal: string;
    zones: PO3Zone[];
}

interface ICTPO3RendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    data: ICTPO3Data | null;
    visible: boolean;
}

const COLORS = {
    accumulation: 'rgba(52, 53, 39, 0.5)', // #34352780
    manipulation: 'rgba(49, 28, 39, 0.8)', // #311c27dd
    buyLabel: '#00FF00',
    sellLabel: '#FF0000',
    text: '#FFFFFF',
    tpTarget: 'rgba(0, 0, 255, 0.5)',
    slTarget: 'rgba(255, 0, 0, 0.5)',
};

export const ICTPO3Renderer: React.FC<ICTPO3RendererProps> = ({
    chart,
    series,
    data,
    visible,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const animFrameRef = useRef<number>(0);

    const render = useCallback(() => {
        if (!containerRef.current || !chart || !data || !visible || !data.zones) {
            if (containerRef.current) containerRef.current.innerHTML = '';
            return;
        }

        const el = containerRef.current;
        el.innerHTML = '';

        const chartRect = (chart as any).chartElement?.()?.getBoundingClientRect?.() ??
            el.parentElement?.getBoundingClientRect();
        if (!chartRect) return;

        const timeScale = chart.timeScale();

        const toX = (timeStr: string | null): number | null => {
            if (!timeStr) return null;
            try {
                // Convert timestamp string to unix seconds if needed
                const date = new Date(timeStr);
                const t = Math.floor(date.getTime() / 1000);
                return timeScale.timeToCoordinate(t as any);
            } catch {
                return null;
            }
        };

        const toY = (price: number | null): number | null => {
            if (price === null) return null;
            try {
                return series?.priceToCoordinate(price) ?? null;
            } catch {
                return null;
            }
        };

        const W = el.offsetWidth;
        const H = el.offsetHeight;
        if (!W || !H) return;

        const drawBox = (
            x1: number, y1: number, x2: number, y2: number,
            bg: string, border: string = 'transparent', borderWidth: number = 0
        ) => {
            const left = Math.max(0, Math.min(x1, x2));
            const top = Math.max(0, Math.min(y1, y2));
            const width = Math.abs(x2 - x1);
            const height = Math.abs(y2 - y1);
            if (width < 1 || height < 1) return null;

            const div = document.createElement('div');
            div.style.cssText = `
                position:absolute;
                left:${left}px;top:${top}px;
                width:${Math.min(width, W - left)}px;
                height:${Math.min(height, H - top)}px;
                background:${bg};
                border:${borderWidth}px solid ${border};
                pointer-events:none;
                box-sizing:border-box;
            `;
            el.appendChild(div);
            return div;
        };

        const drawLabel = (
            x: number, y: number,
            text: string, color: string,
            bgColor: string = 'transparent',
            yOffset: number = 0
        ) => {
            if (x < 0 || x > W || y < 0 || y > H) return;
            const span = document.createElement('span');
            span.innerText = text;
            span.style.cssText = `
                position:absolute;
                left:${x}px;
                top:${y + yOffset}px;
                color:${color};
                background:${bgColor};
                padding: 2px 4px;
                border-radius: 4px;
                font-size:10px;
                font-weight:bold;
                pointer-events:none;
                user-select:none;
                white-space:nowrap;
                transform:translate(-50%, -50%);
            `;
            el.appendChild(span);
        };
        
        const drawLine = (
            x1: number, y1: number, x2: number, y2: number,
            color: string, dashed: boolean = false
        ) => {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;overflow:visible`;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', String(x1));
            line.setAttribute('y1', String(y1));
            line.setAttribute('x2', String(x2));
            line.setAttribute('y2', String(y2));
            line.setAttribute('stroke', color);
            line.setAttribute('stroke-width', '1');
            if (dashed) line.setAttribute('stroke-dasharray', '4,4');
            svg.appendChild(line);
            el.appendChild(svg);
        };

        data.zones.forEach(zone => {
            // Draw Accumulation Box
            const accStartX = toX(zone.acc_start);
            // If accumulation end is not set yet, draw till right edge of screen
            const accEndX = zone.acc_end ? toX(zone.acc_end) : W;
            const accTopY = toY(zone.acc_top);
            const accBottomY = toY(zone.acc_bottom);

            if (accStartX !== null && accEndX !== null && accTopY !== null && accBottomY !== null) {
                drawBox(accStartX, accTopY, accEndX, accBottomY, COLORS.accumulation);
            }

            // Draw Manipulation Box
            const manStartX = toX(zone.man_start);
            const manEndX = zone.man_end ? toX(zone.man_end) : W;
            const manTopY = toY(zone.man_top);
            const manBottomY = toY(zone.man_bottom);

            if (manStartX !== null && manEndX !== null && manTopY !== null && manBottomY !== null) {
                drawBox(manStartX, manTopY, manEndX, manBottomY, COLORS.manipulation);
            }

            // Draw Entry / TP / SL
            if (zone.entry_time && zone.entry_price) {
                const entryX = toX(zone.entry_time);
                const entryY = toY(zone.entry_price);
                
                if (entryX !== null && entryY !== null) {
                    const isLong = zone.entry_type === "Long";
                    const lblColor = isLong ? COLORS.buyLabel : COLORS.sellLabel;
                    const lblBg = isLong ? 'rgba(0,255,0,0.1)' : 'rgba(255,0,0,0.1)';
                    drawLabel(entryX, entryY, isLong ? 'Buy' : 'Sell', lblColor, lblBg, isLong ? 15 : -15);
                    
                    const tpY = toY(zone.tp_target);
                    const slY = toY(zone.sl_target);
                    const exitX = zone.exit_time ? toX(zone.exit_time) : W;
                    
                    if (tpY !== null && exitX !== null) {
                        drawLine(entryX, entryY, entryX, tpY, COLORS.buyLabel, true);
                        drawLine(entryX, tpY, exitX, tpY, COLORS.buyLabel, true);
                        drawLabel(exitX, tpY, `TP (${zone.tp_target?.toFixed(2)})`, COLORS.text, COLORS.tpTarget, 0);
                    }
                    
                    if (slY !== null && exitX !== null) {
                        drawLine(entryX, entryY, entryX, slY, COLORS.sellLabel, true);
                        drawLine(entryX, slY, exitX, slY, COLORS.sellLabel, true);
                        drawLabel(exitX, slY, `SL (${zone.sl_target?.toFixed(2)})`, COLORS.text, COLORS.slTarget, 0);
                    }
                    
                    if (zone.exit_time && zone.exit_price) {
                         const exitY = toY(zone.exit_price);
                         if (exitY !== null) {
                             drawLabel(exitX as number, exitY, 'Exit', '#FFD700', 'rgba(255,215,0,0.2)', isLong ? -20 : 20);
                         }
                    }
                }
            }
        });

    }, [chart, series, data, visible]);

    useEffect(() => {
        if (!chart) return;
        const scheduleRender = () => {
            cancelAnimationFrame(animFrameRef.current);
            animFrameRef.current = requestAnimationFrame(render);
        };
        scheduleRender();
        chart.timeScale().subscribeVisibleTimeRangeChange(scheduleRender);
        chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleRender);
        return () => {
            cancelAnimationFrame(animFrameRef.current);
            chart.timeScale().unsubscribeVisibleTimeRangeChange(scheduleRender);
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleRender);
        };
    }, [chart, render]);

    useEffect(() => {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = requestAnimationFrame(render);
        return () => cancelAnimationFrame(animFrameRef.current);
    }, [render]);

    return (
        <div
            ref={containerRef}
            style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 4,
                overflow: 'hidden',
            }}
        />
    );
};
