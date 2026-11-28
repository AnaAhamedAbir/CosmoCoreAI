import React, { useEffect, useRef, useCallback } from 'react';
import { IChartApi, ISeriesApi } from 'lightweight-charts';
import { useTheme } from '@/context/ThemeContext';
import { computeVpvrValueArea, formatCompactOrderflowNumber } from '../../../utils/orderflowMath';

export interface VPVRData {
    price: number;
    volume: number;
    buyVolume: number;
    sellVolume: number;
}

interface VolumeProfileWidgetProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    data: VPVRData[];
    leftAxisOffset?: number;
    maxWidthPx?: number;
    showValueArea?: boolean;
}

/**
 * Institutional High-DPI Canvas Visible-Range Volume Profile (VPVR):
 * - Zero 300ms CSS lag and zero DOM node churn; redraws in 1 rAF synced to both X and Y pan/zoom.
 * - Strictly clipped to the visible chart pane and respects dynamic `leftAxisOffset`.
 * - Computes real-time POC (Point of Control) + 70% Value Area (VAH / VAL) over visible rows.
 * - Renders Gold POC ray + VAH/VAL shading + Buy/Sell split profile bars with Light/Dark contrast.
 */
export const VolumeProfileWidget: React.FC<VolumeProfileWidgetProps> = ({
    chart,
    series,
    data,
    leftAxisOffset = 0,
    maxWidthPx = 175,
    showValueArea = true,
}) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rafIdRef = useRef<number | null>(null);
    const dataRef = useRef<VPVRData[]>(data);
    dataRef.current = data;
    const isDarkRef = useRef<boolean>(isDark);
    isDarkRef.current = isDark;
    const leftOffsetRef = useRef<number>(leftAxisOffset);
    leftOffsetRef.current = leftAxisOffset;
    const maxWidthRef = useRef<number>(maxWidthPx);
    maxWidthRef.current = maxWidthPx;
    const showValueAreaRef = useRef<boolean>(showValueArea);
    showValueAreaRef.current = showValueArea;

    const drawVpvr = useCallback(() => {
        const canvas = canvasRef.current;
        if (!chart || !series || !canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cssW = canvas.clientWidth || canvas.parentElement?.clientWidth || 0;
        const cssH = canvas.clientHeight || canvas.parentElement?.clientHeight || 0;
        if (cssW <= 0 || cssH <= 0) return;

        const targetW = Math.round(cssW * dpr);
        const targetH = Math.round(cssH * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);

        const rows = dataRef.current;
        if (!rows || rows.length === 0) return;

        try {
            const timeScale = chart.timeScale();
            const timeWidth = timeScale.width();
            const leftOff = leftOffsetRef.current;
            const dark = isDarkRef.current;
            const maxBarW = Math.min(maxWidthRef.current, Math.max(70, timeWidth * 0.22));

            // Project rows onto active Y-axis and keep only visible rows
            const visibleRows: Array<VPVRData & { y: number }> = [];
            let maxVol = 0;

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (!row || !Number.isFinite(row.price) || row.volume <= 0) continue;
                const y = series.priceToCoordinate(row.price);
                if (y === null || y < -16 || y > cssH + 16) continue;
                visibleRows.push({ ...row, y });
                if (row.volume > maxVol) maxVol = row.volume;
            }

            if (visibleRows.length === 0 || maxVol <= 0) return;

            visibleRows.sort((a, b) => a.y - b.y);

            // Compute crisp dynamic bar height from median pixel spacing between adjacent rows
            const gaps: number[] = [];
            for (let i = 1; i < visibleRows.length; i++) {
                const g = Math.abs(visibleRows[i].y - visibleRows[i - 1].y);
                if (g > 0.5) gaps.push(g);
            }
            gaps.sort((a, b) => a - b);
            const medianGap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 10;
            const barH = Math.max(3, Math.min(14, medianGap * 0.82));

            // Compute Value Area (POC, 70% VAH, 70% VAL) over visible rows
            const va = computeVpvrValueArea(visibleRows, 0.7);

            ctx.save();
            ctx.beginPath();
            ctx.rect(leftOff, 0, timeWidth, cssH);
            ctx.clip();

            // 1. 70% Value Area translucent background band (VAH to VAL)
            if (showValueAreaRef.current && va.vahPrice > 0 && va.valPrice > 0) {
                const vahY = series.priceToCoordinate(va.vahPrice);
                const valY = series.priceToCoordinate(va.valPrice);
                if (vahY !== null && valY !== null) {
                    const topY = Math.min(vahY, valY);
                    const bandH = Math.abs(valY - vahY);
                    ctx.fillStyle = dark ? 'rgba(56, 189, 248, 0.045)' : 'rgba(14, 165, 233, 0.055)';
                    ctx.fillRect(leftOff, topY, maxBarW + 8, bandH);

                    ctx.strokeStyle = dark ? 'rgba(56, 189, 248, 0.4)' : 'rgba(2, 132, 199, 0.45)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath();
                    ctx.moveTo(leftOff, vahY);
                    ctx.lineTo(leftOff + maxBarW + 18, vahY);
                    ctx.moveTo(leftOff, valY);
                    ctx.lineTo(leftOff + maxBarW + 18, valY);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    ctx.font = 'bold 8px monospace';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'bottom';
                    ctx.fillStyle = dark ? 'rgba(125, 211, 252, 0.85)' : 'rgba(3, 105, 161, 0.9)';
                    ctx.fillText('VAH', leftOff + maxBarW + 4, vahY - 1);
                    ctx.textBaseline = 'top';
                    ctx.fillText('VAL', leftOff + maxBarW + 4, valY + 2);
                }
            }

            // 2. Render each horizontal Buy / Sell split volume bar
            for (let i = 0; i < visibleRows.length; i++) {
                const row = visibleRows[i];
                const totalW = Math.max(3, (row.volume / maxVol) * maxBarW);
                const buyRatio = row.volume > 0 ? Math.max(0, Math.min(1, row.buyVolume / row.volume)) : 0.5;
                const buyW = totalW * buyRatio;
                const sellW = totalW - buyW;
                const yTop = Math.floor(row.y - barH / 2);
                const isPoc = row.price === va.pocPrice;
                const inValueArea = row.price >= va.valPrice && row.price <= va.vahPrice;
                const alphaBoost = isPoc ? 0.88 : inValueArea ? 0.62 : 0.34;

                if (buyW > 0.5) {
                    ctx.fillStyle = isPoc
                        ? (dark ? 'rgba(250, 204, 21, 0.82)' : 'rgba(217, 119, 6, 0.82)')
                        : (dark
                            ? `rgba(16, 185, 129, ${alphaBoost.toFixed(2)})`
                            : `rgba(5, 150, 105, ${alphaBoost.toFixed(2)})`);
                    ctx.fillRect(leftOff, yTop, buyW, barH);
                }

                if (sellW > 0.5) {
                    ctx.fillStyle = isPoc
                        ? (dark ? 'rgba(245, 158, 11, 0.72)' : 'rgba(180, 83, 9, 0.72)')
                        : (dark
                            ? `rgba(244, 63, 94, ${alphaBoost.toFixed(2)})`
                            : `rgba(225, 29, 72, ${alphaBoost.toFixed(2)})`);
                    ctx.fillRect(leftOff + buyW, yTop, sellW, barH);
                }

                if (isPoc) {
                    ctx.strokeStyle = dark ? '#fde047' : '#b45309';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(leftOff + 0.5, yTop + 0.5, Math.max(1, totalW - 1), Math.max(1, barH - 1));
                }
            }

            // 3. Full-width Gold POC Reference Ray + Micro-Badge
            if (va.pocPrice > 0) {
                const pocY = series.priceToCoordinate(va.pocPrice);
                if (pocY !== null && pocY >= 6 && pocY <= cssH - 6) {
                    ctx.strokeStyle = dark ? 'rgba(250, 204, 21, 0.65)' : 'rgba(202, 138, 4, 0.75)';
                    ctx.lineWidth = 1.2;
                    ctx.setLineDash([5, 4]);
                    ctx.beginPath();
                    ctx.moveTo(leftOff, pocY);
                    ctx.lineTo(leftOff + timeWidth, pocY);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    const pocLabel = `POC ${formatCompactOrderflowNumber(maxVol)}`;
                    ctx.font = 'bold 8.5px monospace';
                    const tw = ctx.measureText(pocLabel).width;
                    const badgeX = leftOff + maxBarW + 6;
                    ctx.fillStyle = dark ? 'rgba(113, 63, 18, 0.92)' : 'rgba(254, 243, 199, 0.96)';
                    ctx.fillRect(badgeX, pocY - 7, tw + 8, 14);
                    ctx.strokeStyle = dark ? 'rgba(250, 204, 21, 0.7)' : 'rgba(217, 119, 6, 0.7)';
                    ctx.lineWidth = 0.8;
                    ctx.strokeRect(badgeX, pocY - 7, tw + 8, 14);
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = dark ? '#fef08a' : '#92400e';
                    ctx.fillText(pocLabel, badgeX + 4, pocY);
                }
            }

            ctx.restore();
        } catch (err) {
            console.error('Error in VolumeProfileWidget:', err);
        }
    }, [chart, series]);

    const requestDraw = useCallback(() => {
        if (rafIdRef.current !== null) return;
        rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = null;
            drawVpvr();
        });
    }, [drawVpvr]);

    useEffect(() => {
        requestDraw();
    }, [data, isDark, leftAxisOffset, maxWidthPx, showValueArea, requestDraw]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const parent = canvas?.parentElement;
        if (!chart || !series || !canvas || !parent) return;

        const observer = new ResizeObserver(requestDraw);
        observer.observe(parent);

        const timeScale = chart.timeScale();
        timeScale.subscribeVisibleTimeRangeChange(requestDraw);
        timeScale.subscribeVisibleLogicalRangeChange(requestDraw);
        timeScale.subscribeSizeChange(requestDraw);

        const chartRoot = parent.parentElement;
        const handlePointerDrag = (e: PointerEvent) => {
            if (e.buttons !== 0) requestDraw();
        };
        chartRoot?.addEventListener('wheel', requestDraw, { passive: true });
        chartRoot?.addEventListener('pointermove', handlePointerDrag, { passive: true });
        chartRoot?.addEventListener('pointerup', requestDraw, { passive: true });
        chartRoot?.addEventListener('dblclick', requestDraw, { passive: true });

        requestDraw();

        return () => {
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
            observer.disconnect();
            chartRoot?.removeEventListener('wheel', requestDraw);
            chartRoot?.removeEventListener('pointermove', handlePointerDrag);
            chartRoot?.removeEventListener('pointerup', requestDraw);
            chartRoot?.removeEventListener('dblclick', requestDraw);
            try {
                timeScale.unsubscribeVisibleTimeRangeChange(requestDraw);
                timeScale.unsubscribeVisibleLogicalRangeChange(requestDraw);
                timeScale.unsubscribeSizeChange(requestDraw);
            } catch {}
        };
    }, [chart, series, requestDraw]);

    if (!chart || !series) return null;

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none z-10"
        />
    );
};
