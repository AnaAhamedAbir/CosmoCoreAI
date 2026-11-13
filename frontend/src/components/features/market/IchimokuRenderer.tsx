import React, { useEffect, useRef, useCallback } from 'react';
import { IChartApi, ISeriesApi } from 'lightweight-charts';
import { IchimokuDataPoint } from '../../../utils/indicators';

interface IchimokuRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    data: IchimokuDataPoint[];
    displacement: number;
}

export const IchimokuRenderer: React.FC<IchimokuRendererProps> = ({ chart, series, data, displacement }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawRequested = useRef<boolean>(false);

    const drawIchimoku = useCallback(() => {
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

        if (!chart || !series || data.length === 0) return;

        const timeScale = chart.timeScale();
        const priceScale = series.priceScale();
        if (!timeScale || !priceScale) return;

        const logicalRange = timeScale.getVisibleLogicalRange();
        if (!logicalRange) return;

        // Colors
        const colors = {
            tenkan: '#00bfff', // Deep Sky Blue
            kijun: '#ff4500',   // Orange Red
            senkouA: 'rgba(0, 255, 0, 0.5)', // Greenish
            senkouB: 'rgba(255, 0, 0, 0.5)', // Reddish
            chikou: '#9370db',  // Medium Purple
            cloudUp: 'rgba(0, 255, 0, 0.1)',
            cloudDown: 'rgba(255, 0, 0, 0.1)'
        };

        const timeWidth = timeScale.width();
        const barSpacing = timeWidth / (logicalRange.to - logicalRange.from);

        const getX = (i: number) => {
            if (i >= 0 && i < data.length) {
                return timeScale.timeToCoordinate(data[i].time as any);
            }
            const lastIdx = data.length - 1;
            const lastX = timeScale.timeToCoordinate(data[lastIdx].time as any);
            if (lastX === null) return null;
            return lastX + (i - lastIdx) * barSpacing;
        };

        const startIdx = Math.max(0, Math.floor(logicalRange.from) - displacement - 3);
        const endIdx = Math.min(data.length - 1, Math.ceil(logicalRange.to) + displacement + 3);

        // 1. Draw Kumo (Cloud) for visible range
        for (let i = startIdx; i <= endIdx; i++) {
            const pt = data[i];
            if (!pt || pt.senkouA === null || pt.senkouB === null) continue;

            const futureIdx = i + displacement;
            const x = getX(futureIdx);
            const xNext = getX(futureIdx + 1);
            if (x === null || xNext === null) continue;
            if (xNext < 0 || x > canvas.width) continue;

            const yA = series.priceToCoordinate(pt.senkouA);
            const yB = series.priceToCoordinate(pt.senkouB);
            if (yA === null || yB === null) continue;

            ctx.fillStyle = pt.senkouA > pt.senkouB ? colors.cloudUp : colors.cloudDown;
            ctx.fillRect(x, Math.min(yA, yB), Math.max(1, xNext - x), Math.abs(yA - yB));
        }

        // 2. Draw Tenkan Line (Single continuous path)
        ctx.setLineDash([]);
        ctx.strokeStyle = colors.tenkan;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let tenkanStarted = false;
        for (let i = startIdx; i <= endIdx; i++) {
            if (data[i] && data[i].tenkan !== null) {
                const x = getX(i);
                const y = series.priceToCoordinate(data[i].tenkan!);
                if (x !== null && y !== null) {
                    if (!tenkanStarted) { ctx.moveTo(x, y); tenkanStarted = true; }
                    else { ctx.lineTo(x, y); }
                }
            }
        }
        if (tenkanStarted) ctx.stroke();

        // 3. Draw Kijun Line (Single continuous path)
        ctx.strokeStyle = colors.kijun;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let kijunStarted = false;
        for (let i = startIdx; i <= endIdx; i++) {
            if (data[i] && data[i].kijun !== null) {
                const x = getX(i);
                const y = series.priceToCoordinate(data[i].kijun!);
                if (x !== null && y !== null) {
                    if (!kijunStarted) { ctx.moveTo(x, y); kijunStarted = true; }
                    else { ctx.lineTo(x, y); }
                }
            }
        }
        if (kijunStarted) ctx.stroke();

        // 4. Draw Chikou Span (Single continuous path)
        ctx.strokeStyle = colors.chikou;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let chikouStarted = false;
        for (let i = startIdx; i <= endIdx; i++) {
            if (data[i] && data[i].chikou !== null) {
                const x = getX(i);
                const y = series.priceToCoordinate(data[i].chikou!);
                if (x !== null && y !== null) {
                    if (!chikouStarted) { ctx.moveTo(x, y); chikouStarted = true; }
                    else { ctx.lineTo(x, y); }
                }
            }
        }
        if (chikouStarted) ctx.stroke();

    }, [chart, series, data, displacement]);

    const drawIchimokuRef = useRef(drawIchimoku);
    drawIchimokuRef.current = drawIchimoku;

    const requestDraw = useCallback(() => {
        if (!drawRequested.current) {
            drawRequested.current = true;
            requestAnimationFrame(() => {
                drawRequested.current = false;
                drawIchimokuRef.current();
            });
        }
    }, []);

    useEffect(() => {
        requestDraw();
    }, [data, displacement, requestDraw]);

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
