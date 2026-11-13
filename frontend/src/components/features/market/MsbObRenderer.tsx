import React, { useEffect, useRef, useCallback } from 'react';
import { IChartApi, ISeriesApi } from 'lightweight-charts';
import { MsbObResult } from '../../../utils/indicators';

interface MsbObRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    data: MsbObResult;
    ohlcData: { time: any; high: number; low: number; close: number; open: number }[];
    showZigzag: boolean;
}

export const MsbObRenderer: React.FC<MsbObRendererProps> = ({
    chart,
    series,
    data,
    ohlcData,
    showZigzag
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawRequested = useRef<boolean>(false);

    const drawMsbOb = useCallback(() => {
        if (!canvasRef.current || !chart || !series || data.points.length === 0) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        // Handle resizing with Retina/AMOLED High-DPI scaling
        const parent = canvas.parentElement;
        if (parent) {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const targetW = Math.round(parent.clientWidth * dpr);
            const targetH = Math.round(parent.clientHeight * dpr);
            if (canvas.width !== targetW || canvas.height !== targetH) {
                canvas.width = targetW;
                canvas.height = targetH;
                canvas.style.width = `${parent.clientWidth}px`;
                canvas.style.height = `${parent.clientHeight}px`;
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        ctx.clearRect(0, 0, canvas.parentElement?.clientWidth || canvas.width, canvas.parentElement?.clientHeight || canvas.height);

        const timeScale = chart.timeScale();
        const priceScale = series.priceScale();
        if (!timeScale || !priceScale) return;

        const logicalRange = timeScale.getVisibleLogicalRange();
        if (!logicalRange) return;

        const getX = (time: any) => timeScale.timeToCoordinate(time);
        const getY = (price: number) => series.priceToCoordinate(price);

        const startIdx = Math.max(0, Math.floor(logicalRange.from) - 5);
        const endIdx = Math.min(data.points.length - 1, Math.ceil(logicalRange.to) + 5);

        // --- 1. Draw ZigZag ---
        if (showZigzag) {
            let lastX: number | null = null;
            let lastY: number | null = null;

            ctx.beginPath();
            ctx.setLineDash([2, 4]);
            ctx.strokeStyle = '#f97316'; // Orange-500
            ctx.lineWidth = 1;

            for (let i = startIdx; i <= endIdx; i++) {
                const pt = data.points[i];
                if (pt && pt.zigzagPrice !== null) {
                    const x = getX(pt.time);
                    const y = getY(pt.zigzagPrice);
                    if (x !== null && y !== null) {
                        if (lastX !== null && lastY !== null) {
                            ctx.moveTo(lastX, lastY);
                            ctx.lineTo(x, y);
                        }
                        lastX = x;
                        lastY = y;
                    }
                }
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // --- 2. Draw Zones (OB/BB) ---
        const viewWidth = parent?.clientWidth || canvas.width;
        data.zones.forEach((zone) => {
            const startX = getX(ohlcData[zone.startX]?.time);
            const endX = getX(ohlcData[Math.min(zone.endX, ohlcData.length - 1)]?.time) || viewWidth + 50;
            if (startX !== null && endX < -50) return;
            if (startX !== null && startX > viewWidth + 50) return;

            const topY = getY(zone.top);
            const bottomY = getY(zone.bottom);

            if (startX !== null && topY !== null && bottomY !== null) {
                const isBull = zone.type.startsWith('Bu');
                const bgColor = isBull ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)';
                const borderColor = isBull ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)';
                const textColor = isBull ? '#22c55e' : '#ef4444';

                const width = endX - startX;
                const height = bottomY - topY;

                // Box
                ctx.fillStyle = bgColor;
                ctx.fillRect(startX, topY, width, height);
                ctx.strokeStyle = borderColor;
                ctx.lineWidth = 1;
                ctx.strokeRect(startX, topY, width, height);

                // Label
                ctx.font = 'bold 9px Inter, sans-serif';
                ctx.fillStyle = textColor;
                ctx.textAlign = 'right';
                ctx.fillText(zone.type, Math.min(viewWidth - 5, endX - 2), topY + 12);
            }
        });

        // --- 3. Draw MSB Labels & Lines ---
        for (let i = startIdx; i <= endIdx; i++) {
            const pt = data.points[i];
            if (pt && pt.msbType && pt.msbPrice !== null) {
                const x = getX(pt.time);
                const y = getY(pt.msbPrice);
                
                if (x !== null && y !== null) {
                    const isBull = pt.msbType === 'Bullish';
                    const color = isBull ? '#22c55e' : '#ef4444';

                    // MSB Horizontal Line
                    ctx.beginPath();
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;
                    // Start line from previous point or a bit back
                    const startX = getX(ohlcData[Math.max(0, i - 10)]?.time) || x - 50;
                    ctx.moveTo(startX, y);
                    ctx.lineTo(x, y);
                    ctx.stroke();

                    // MSB Label
                    ctx.font = 'bold 10px Inter, sans-serif';
                    ctx.fillStyle = color;
                    ctx.textAlign = 'center';
                    const labelY = isBull ? y - 15 : y + 25;
                    ctx.fillText('MSB', x, labelY);
                }
            }
        }

    }, [chart, series, data, ohlcData, showZigzag]);

    const drawMsbObRef = useRef(drawMsbOb);
    drawMsbObRef.current = drawMsbOb;

    const requestDraw = useCallback(() => {
        if (!drawRequested.current) {
            drawRequested.current = true;
            requestAnimationFrame(() => {
                drawRequested.current = false;
                drawMsbObRef.current();
            });
        }
    }, []);

    useEffect(() => {
        requestDraw();
    }, [data, showZigzag, requestDraw]);

    useEffect(() => {
        if (!chart || !series) return;
        requestDraw();
        const timeScale = chart.timeScale();
        timeScale.subscribeVisibleTimeRangeChange(requestDraw);
        return () => {
            timeScale.unsubscribeVisibleTimeRangeChange(requestDraw);
        };
    }, [chart, series, requestDraw]);

    return (
        <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 pointer-events-none"
            style={{ zIndex: 1 }}
        />
    );
};
