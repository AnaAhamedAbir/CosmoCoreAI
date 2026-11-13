import React, { useEffect, useRef, useCallback } from 'react';
import { IChartApi, ISeriesApi } from 'lightweight-charts';
import { BollingerBandsDataPoint } from '../../../utils/indicators';
import { useTheme } from '../../../context/ThemeContext';

interface BollingerBandsRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    data: BollingerBandsDataPoint[];
    visible: boolean;
}

export const BollingerBandsRenderer: React.FC<BollingerBandsRendererProps> = ({ chart, series, data, visible }) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawRequested = useRef<boolean>(false);

    const drawShading = useCallback(() => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

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

        if (!chart || !series || !visible || data.length === 0) return;

        const timeScale = chart.timeScale();
        const priceScale = series.priceScale();
        if (!timeScale || !priceScale) return;

        const logicalRange = timeScale.getVisibleLogicalRange();
        if (!logicalRange) return;

        // Define shading color:
        // Dark Mode: soft cyber cyan cloud matching the dark background
        // Light Mode: crisp, clearly visible sky-blue tint (20% opacity) that stands out cleanly on light canvas
        ctx.fillStyle = isDark ? 'rgba(56, 189, 248, 0.12)' : 'rgba(2, 132, 199, 0.20)';

        const getX = (i: number) => {
            if (i >= 0 && i < data.length) {
                return timeScale.timeToCoordinate(data[i].time as any);
            }
            return null;
        };

        const startIdx = Math.max(0, Math.floor(logicalRange.from) - 2);
        const endIdx = Math.min(data.length - 1, Math.ceil(logicalRange.to) + 2);
        if (startIdx >= endIdx) return;

        // Collect coordinates for upper cloud & lower cloud
        const pts: { x: number; yUpper: number; yMid: number; yLow: number }[] = [];
        for (let i = startIdx; i <= endIdx; i++) {
            const x = getX(i);
            if (x === null) continue;
            const yUpper = series.priceToCoordinate(data[i].upper);
            const yMid = series.priceToCoordinate(data[i].middle);
            const yLow = series.priceToCoordinate(data[i].lower);

            if (yUpper !== null && yMid !== null && yLow !== null) {
                pts.push({ x, yUpper, yMid, yLow });
            }
        }

        if (pts.length < 2) return;

        // 1. Upper Cloud (Upper forward, Middle backward) in ONE batched fill
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].yUpper);
        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].yUpper);
        }
        for (let i = pts.length - 1; i >= 0; i--) {
            ctx.lineTo(pts[i].x, pts[i].yMid);
        }
        ctx.closePath();
        ctx.fill();

        // 2. Lower Cloud (Middle forward, Lower backward) in ONE batched fill
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].yMid);
        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].yMid);
        }
        for (let i = pts.length - 1; i >= 0; i--) {
            ctx.lineTo(pts[i].x, pts[i].yLow);
        }
        ctx.closePath();
        ctx.fill();

    }, [chart, series, data, visible, isDark]);

    const drawShadingRef = useRef(drawShading);
    drawShadingRef.current = drawShading;

    const requestDraw = useCallback(() => {
        if (!drawRequested.current) {
            drawRequested.current = true;
            requestAnimationFrame(() => {
                drawRequested.current = false;
                drawShadingRef.current();
            });
        }
    }, []);

    useEffect(() => {
        requestDraw();
    }, [data, visible, isDark, requestDraw]);

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
            style={{ zIndex: 0 }} // Lower zIndex to stay behind candles if needed, but in overlay container
        />
    );
};
