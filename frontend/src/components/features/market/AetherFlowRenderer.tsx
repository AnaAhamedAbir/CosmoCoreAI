import React, { useEffect, useRef, useCallback } from 'react';
import { ISeriesApi, LineStyle, LineSeries, IChartApi } from 'lightweight-charts';
import { IndicatorSettings } from './IndicatorSelector';

export interface AetherFlowData {
    ut_bot: {
        time: number;
        trailing_stop: number;
        trend: string;
        buy_signal: boolean;
        sell_signal: boolean;
        filtered_buy?: boolean;
        filtered_sell?: boolean;
    }[];
    supertrend: {
        time: number;
        value: number;
        trend: string;
    }[];
    smc: {
        swing_highs: { time: number; price: number; index: number; type?: string }[];
        swing_lows: { time: number; price: number; index: number; type?: string }[];
        bos_choch: { time: number; price: number; type: string; label: string }[];
    };
    fvgs: {
        time: number;
        type: 'bullish' | 'bearish';
        top: number;
        bottom: number;
    }[];
    hull_suite: {
        time: number;
        value: number;
        trend: string;
    }[];
    order_blocks: {
        bullish: { time: number; top: number; bottom: number; avg: number }[];
        bearish: { time: number; top: number; bottom: number; avg: number }[];
    };
    three_bar_reversal: {
        time: number;
        type: 'bullish' | 'bearish';
        price: number;
    }[];
    auto_fibo: {
        start_time?: number;
        end_time?: number;
        highest?: number;
        lowest?: number;
        is_bullish?: boolean;
        levels?: { level: number; price: number }[];
    };
}

interface AetherFlowRendererProps {
    chart: IChartApi;
    series: ISeriesApi<"Candlestick">;
    data: AetherFlowData | null;
    settings: IndicatorSettings;
}

export const AetherFlowRenderer: React.FC<AetherFlowRendererProps> = ({ chart, series, data, settings }) => {
    const stSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const utSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const hullSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const animFrameRef = useRef<number>(0);

    // Render HTML overlays for FVGs, OBs, and SMC
    const renderOverlays = useCallback(() => {
        if (!containerRef.current || !chart || !data || !settings.showAetherFlow) {
            if (containerRef.current) containerRef.current.innerHTML = '';
            return;
        }

        const el = containerRef.current;
        el.innerHTML = '';

        const timeScale = chart.timeScale();
        const toX = (time: number): number | null => {
            try {
                const t = time < 10_000_000_000 ? time : Math.floor(time / 1000);
                return timeScale.timeToCoordinate(t as any);
            } catch {
                return null;
            }
        };

        const toY = (price: number): number | null => {
            try {
                return series?.priceToCoordinate(price) ?? null;
            } catch {
                return null;
            }
        };

        const W = el.offsetWidth;
        const H = el.offsetHeight;
        if (!W || !H) return;

        const drawBox = (x1: number, y1: number, x2: number, y2: number, bg: string, border: string = 'transparent') => {
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
                border:1px solid ${border};
                pointer-events:none;
                box-sizing:border-box;
            `;
            el.appendChild(div);
            return div;
        };

        const drawLabel = (x: number, y: number, text: string, color: string, align: 'left'|'center'|'right' = 'center', yOffset = '-50%') => {
            const span = document.createElement('span');
            span.innerText = text;
            span.style.cssText = `
                position:absolute;
                left:${align === 'right' ? x - 40 : x}px;
                top:${y}px;
                color:${color};
                font-size:10px;
                font-weight:bold;
                pointer-events:none;
                transform:translate(${align === 'center' ? '-50%' : '0'}, ${yOffset});
            `;
            el.appendChild(span);
        };

        const drawLine = (x1: number, y1: number, x2: number, y2: number, color: string, dashed: boolean = false, width: number = 1) => {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;overflow:visible`;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', String(x1));
            line.setAttribute('y1', String(y1));
            line.setAttribute('x2', String(x2));
            line.setAttribute('y2', String(y2));
            line.setAttribute('stroke', color);
            line.setAttribute('stroke-width', String(width));
            if (dashed) line.setAttribute('stroke-dasharray', '4,4');
            svg.appendChild(line);
            el.appendChild(svg);
        };

        // 1. SMC Structural lines & BoS/CHoCH
        if (settings.aetherSmc && data.smc) {
            data.smc.swing_highs?.slice(-15).forEach(sh => {
                const x1 = toX(sh.time);
                const y = toY(sh.price);
                if (x1 !== null && y !== null) {
                    drawLine(x1, y, x1 + 40, y, '#f59e0b', true);
                    drawLabel(x1 + 45, y, sh.type || 'HH', '#f59e0b', 'left');
                }
            });
            data.smc.swing_lows?.slice(-15).forEach(sl => {
                const x1 = toX(sl.time);
                const y = toY(sl.price);
                if (x1 !== null && y !== null) {
                    drawLine(x1, y, x1 + 40, y, '#3b82f6', true);
                    drawLabel(x1 + 45, y, sl.type || 'LL', '#3b82f6', 'left');
                }
            });
            // BoS / CHoCH Lines
            data.smc.bos_choch?.slice(-15).forEach(bc => {
                const x1 = toX(bc.time);
                const y = toY(bc.price);
                if (x1 !== null && y !== null) {
                    const color = bc.type === 'bullish' ? '#10b981' : '#ef4444';
                    drawLine(x1 - 40, y, x1, y, color, false, 2);
                    drawLabel(x1 - 20, y - 10, bc.label, color, 'center', '0');
                }
            });
        }

        // 2. FVGs
        if (settings.aetherFvg && data.fvgs) {
            data.fvgs.slice(-15).forEach(fvg => {
                const x1 = toX(fvg.time);
                if (x1 === null) return;
                const x2 = Math.min(W, x1 + 80); 
                const yTop = toY(fvg.top);
                const yBot = toY(fvg.bottom);
                if (yTop === null || yBot === null) return;

                const bg = fvg.type === 'bullish' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
                const border = fvg.type === 'bullish' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)';
                drawBox(x1, yTop, x2, yBot, bg, border);
                drawLabel(x2 - 10, (yTop + yBot) / 2, 'FVG', border, 'right');
            });
        }

        // 3. LuxAlgo Order Blocks
        if (settings.aetherOrderBlocks && data.order_blocks) {
            data.order_blocks.bullish?.forEach(ob => {
                const x1 = toX(ob.time);
                if (x1 === null) return;
                const x2 = W; // Extend to right
                const yTop = toY(ob.top);
                const yBot = toY(ob.bottom);
                const yAvg = toY(ob.avg);
                if (yTop === null || yBot === null || yAvg === null) return;

                const bg = 'rgba(16, 185, 129, 0.2)'; // Bullish green
                drawBox(x1, yTop, x2, yBot, bg, 'rgba(16, 185, 129, 0.5)');
                drawLine(x1, yAvg, x2, yAvg, 'rgba(16, 185, 129, 0.8)', true);
            });
            data.order_blocks.bearish?.forEach(ob => {
                const x1 = toX(ob.time);
                if (x1 === null) return;
                const x2 = W;
                const yTop = toY(ob.top);
                const yBot = toY(ob.bottom);
                const yAvg = toY(ob.avg);
                if (yTop === null || yBot === null || yAvg === null) return;

                const bg = 'rgba(239, 68, 68, 0.2)'; // Bearish red
                drawBox(x1, yTop, x2, yBot, bg, 'rgba(239, 68, 68, 0.5)');
                drawLine(x1, yAvg, x2, yAvg, 'rgba(239, 68, 68, 0.8)', true);
            });
        }

        // 4. Auto Fibonacci (SMC)
        if (settings.aetherAutoFibo && data.auto_fibo && data.auto_fibo.levels) {
            const startX = toX(data.auto_fibo.start_time!);
            const endX = toX(data.auto_fibo.end_time!);
            if (startX !== null && endX !== null) {
                // Draw connecting line between swing high and low
                const startY = toY(data.auto_fibo.is_bullish ? data.auto_fibo.highest! : data.auto_fibo.lowest!);
                const endY = toY(data.auto_fibo.is_bullish ? data.auto_fibo.lowest! : data.auto_fibo.highest!);
                if (startY !== null && endY !== null) {
                    drawLine(startX, startY, endX, endY, 'rgba(255, 255, 255, 0.3)', true, 1);
                }

                // Get the last known time to align the end of the fib line
                let lastCandleX = W;
                if (data.supertrend?.length) {
                    const lx = toX(data.supertrend[data.supertrend.length - 1].time);
                    if (lx !== null) lastCandleX = lx;
                }

                const FIB_COLORS = [
                    'rgba(239, 68, 68, 0.8)',   // Red
                    'rgba(249, 115, 22, 0.8)',  // Orange
                    'rgba(234, 179, 8, 0.8)',   // Yellow
                    'rgba(34, 197, 94, 0.8)',   // Green
                    'rgba(6, 182, 212, 0.8)',   // Cyan
                    'rgba(59, 130, 246, 0.8)',  // Blue
                    'rgba(168, 85, 247, 0.8)',  // Purple
                    'rgba(236, 72, 153, 0.8)'   // Pink
                ];

                // Draw Fibonacci levels
                data.auto_fibo.levels.forEach((lvl, index) => {
                    const y = toY(lvl.price);
                    if (y !== null) {
                        const color = FIB_COLORS[index % FIB_COLORS.length];
                        const isKeyLevel = lvl.level === 0 || lvl.level === 1 || lvl.level === 0.5 || lvl.level === 0.618;
                        drawLine(endX, y, lastCandleX, y, color, !isKeyLevel, isKeyLevel ? 2 : 1);
                        drawLabel(lastCandleX - 5, y, `${lvl.level} (${lvl.price.toFixed(4)})`, color, 'right');
                    }
                });
            }
        }

    }, [chart, series, data, settings]);

    // Handle lightweight-charts Series
    useEffect(() => {
        if (!chart || !data || !settings.showAetherFlow) {
            if (stSeriesRef.current) chart?.removeSeries(stSeriesRef.current);
            if (utSeriesRef.current) chart?.removeSeries(utSeriesRef.current);
            if (hullSeriesRef.current) chart?.removeSeries(hullSeriesRef.current);
            stSeriesRef.current = null;
            utSeriesRef.current = null;
            hullSeriesRef.current = null;
            return;
        }

        // --- SUPERTREND ---
        if (settings.aetherSupertrend && data.supertrend?.length > 0) {
            if (!stSeriesRef.current) {
                stSeriesRef.current = chart.addSeries(LineSeries, {
                    color: '#8b5cf6', // purple 
                    lineWidth: 2,
                    crosshairMarkerVisible: false,
                    lastValueVisible: false,
                    priceLineVisible: false
                });
            }
            const stPoints = data.supertrend.map(d => ({
                time: d.time as any,
                value: d.value,
                color: d.trend === 'bullish' ? '#10b981' : '#ef4444' // Green for bullish, Red for bearish
            }));
            stSeriesRef.current.setData(stPoints);
        } else if (stSeriesRef.current) {
            chart.removeSeries(stSeriesRef.current);
            stSeriesRef.current = null;
        }

        // --- UT BOT ---
        if (settings.aetherUtBot && data.ut_bot?.length > 0) {
            if (!utSeriesRef.current) {
                utSeriesRef.current = chart.addSeries(LineSeries, {
                    color: '#ec4899', // pink
                    lineWidth: 1,
                    lineStyle: LineStyle.Dashed,
                    crosshairMarkerVisible: false,
                    lastValueVisible: false,
                    priceLineVisible: false
                });
            }
            const utPoints = data.ut_bot.map(d => ({
                time: d.time as any,
                value: d.trailing_stop
            }));
            utSeriesRef.current.setData(utPoints);
        } else if (utSeriesRef.current) {
            chart.removeSeries(utSeriesRef.current);
            utSeriesRef.current = null;
        }

        // --- HULL SUITE ---
        if (settings.aetherHull && data.hull_suite?.length > 0) {
            if (!hullSeriesRef.current) {
                hullSeriesRef.current = chart.addSeries(LineSeries, {
                    color: '#3b82f6', // blue
                    lineWidth: 2,
                    crosshairMarkerVisible: false,
                    lastValueVisible: false,
                    priceLineVisible: false
                });
            }
            const hullPoints = data.hull_suite.map(d => ({
                time: d.time as any,
                value: d.value
            }));
            hullSeriesRef.current.setData(hullPoints);
        } else if (hullSeriesRef.current) {
            chart.removeSeries(hullSeriesRef.current);
            hullSeriesRef.current = null;
        }

        return () => {
            if (stSeriesRef.current && chart) {
                try { chart.removeSeries(stSeriesRef.current); } catch(e){}
                stSeriesRef.current = null;
            }
            if (utSeriesRef.current && chart) {
                try { chart.removeSeries(utSeriesRef.current); } catch(e){}
                utSeriesRef.current = null;
            }
            if (hullSeriesRef.current && chart) {
                try { chart.removeSeries(hullSeriesRef.current); } catch(e){}
                hullSeriesRef.current = null;
            }
        };
    }, [chart, series, data, settings]);

    // Re-render HTML overlays on scroll/zoom
    useEffect(() => {
        if (!chart) return;

        const scheduleRender = () => {
            cancelAnimationFrame(animFrameRef.current);
            animFrameRef.current = requestAnimationFrame(renderOverlays);
        };

        scheduleRender();

        chart.timeScale().subscribeVisibleTimeRangeChange(scheduleRender);
        chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleRender);

        return () => {
            cancelAnimationFrame(animFrameRef.current);
            chart.timeScale().unsubscribeVisibleTimeRangeChange(scheduleRender);
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleRender);
        };
    }, [chart, renderOverlays]);

    // Re-render HTML overlays when data changes
    useEffect(() => {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = requestAnimationFrame(renderOverlays);
        return () => cancelAnimationFrame(animFrameRef.current);
    }, [renderOverlays]);

    return (
        <div
            ref={containerRef}
            style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 5,
                overflow: 'hidden',
            }}
        />
    );
};
