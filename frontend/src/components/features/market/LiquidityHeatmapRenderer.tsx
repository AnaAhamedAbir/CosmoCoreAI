import React, { useEffect, useRef, useCallback } from 'react';
import { IChartApi, ISeriesApi } from 'lightweight-charts';
import { useTheme } from '@/context/ThemeContext';
import { isThermalGuardActive } from '@/utils/deviceProfile';
import { formatCompactOrderflowNumber } from '../../../utils/orderflowMath';

export type HeatmapPalette = 'emerald-amber' | 'bookmap' | 'ice-fire' | 'viridis';

export interface HeatmapLevel {
    price: number;
    volume: number;
    peakVolume?: number;
    pulledDelta?: number;
    notional?: number;
    type: 'bid' | 'ask';
}

export interface HeatmapDataPoint {
    time: number; // Candle-aligned Unix timestamp (seconds)
    bucketSize?: number;
    levels: HeatmapLevel[];
}

interface LiquidityHeatmapRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    data: HeatmapDataPoint[];
    bucketSize?: number;
    palette?: HeatmapPalette;
    leftAxisOffset?: number;
    showColorbar?: boolean;
}

function getHeatmapCellColor(
    curved: number,
    side: 'bid' | 'ask',
    palette: HeatmapPalette,
    isDark: boolean
): string {
    const alphaScale = isDark ? 1.0 : 0.88;

    if (palette === 'bookmap') {
        // Classic Bookmap thermal spectrum: Deep Navy -> Electric Cyan -> Gold -> Blazing Orange/White
        if (curved < 0.32) {
            return isDark
                ? `rgba(30, 64, 175, ${(0.12 + curved * 0.65).toFixed(3)})`
                : `rgba(37, 99, 235, ${(0.10 + curved * 0.5).toFixed(3)})`;
        }
        if (curved < 0.62) {
            return `rgba(6, 182, 212, ${((0.28 + (curved - 0.32) * 1.1) * alphaScale).toFixed(3)})`;
        }
        if (curved < 0.85) {
            return `rgba(250, 204, 21, ${((0.55 + (curved - 0.62) * 1.1) * alphaScale).toFixed(3)})`;
        }
        return `rgba(255, 245, 200, ${Math.min(0.92, (0.78 + (curved - 0.85) * 0.9) * alphaScale).toFixed(3)})`;
    }

    if (palette === 'ice-fire') {
        if (side === 'bid') {
            if (curved < 0.45) return `rgba(56, 189, 248, ${((0.10 + curved * 0.5) * alphaScale).toFixed(3)})`;
            if (curved < 0.78) return `rgba(14, 165, 233, ${((0.32 + (curved - 0.45) * 0.85) * alphaScale).toFixed(3)})`;
            return `rgba(186, 230, 253, ${Math.min(0.9, (0.62 + (curved - 0.78) * 1.1) * alphaScale).toFixed(3)})`;
        }
        if (curved < 0.45) return `rgba(244, 63, 94, ${((0.10 + curved * 0.5) * alphaScale).toFixed(3)})`;
        if (curved < 0.78) return `rgba(239, 68, 68, ${((0.32 + (curved - 0.45) * 0.85) * alphaScale).toFixed(3)})`;
        return `rgba(253, 186, 116, ${Math.min(0.9, (0.64 + (curved - 0.78) * 1.1) * alphaScale).toFixed(3)})`;
    }

    if (palette === 'viridis') {
        if (curved < 0.35) return `rgba(72, 40, 120, ${((0.14 + curved * 0.65) * alphaScale).toFixed(3)})`;
        if (curved < 0.65) return `rgba(38, 130, 142, ${((0.34 + (curved - 0.35) * 0.9) * alphaScale).toFixed(3)})`;
        if (curved < 0.85) return `rgba(109, 205, 89, ${((0.56 + (curved - 0.65) * 1.0) * alphaScale).toFixed(3)})`;
        return `rgba(253, 231, 37, ${Math.min(0.92, (0.76 + (curved - 0.85) * 0.9) * alphaScale).toFixed(3)})`;
    }

    // Default 'emerald-amber': distinct Support (Teal -> Cyan -> Emerald) vs Resistance (Amber -> Orange -> Gold)
    if (side === 'bid') {
        if (curved < 0.45) {
            return `rgba(6, 182, 212, ${((0.08 + curved * 0.45) * alphaScale).toFixed(3)})`;
        }
        if (curved < 0.78) {
            return `rgba(16, 185, 129, ${((0.28 + (curved - 0.45) * 0.8) * alphaScale).toFixed(3)})`;
        }
        return `rgba(52, 211, 153, ${Math.min(0.88, (0.58 + (curved - 0.78) * 1.1) * alphaScale).toFixed(3)})`;
    }
    if (curved < 0.45) {
        return `rgba(245, 158, 11, ${((0.08 + curved * 0.45) * alphaScale).toFixed(3)})`;
    }
    if (curved < 0.78) {
        return `rgba(249, 115, 22, ${((0.28 + (curved - 0.45) * 0.8) * alphaScale).toFixed(3)})`;
    }
    return `rgba(250, 204, 21, ${Math.min(0.88, (0.60 + (curved - 0.78) * 1.1) * alphaScale).toFixed(3)})`;
}

/**
 * Institutional Bookmap / TradingLite-style L2 Liquidity Heatmap Renderer:
 * - P98 percentile + log-perceptual normalization (a single whale spoof never flattens the whole heatmap).
 * - Multi-palette selector (`emerald-amber`, `bookmap`, `ice-fire`, `viridis`) with Light/Dark contrast.
 * - Pulled / Spoofed Wall ghost highlight when resting liquidity shrinks >45% from its candle peak.
 * - Live right-edge Resting Liquidity Ladder with vertical anti-collision USD notional tags.
 * - Optional compact intensity colorbar legend & full rAF unmount disposal.
 */
export const LiquidityHeatmapRenderer: React.FC<LiquidityHeatmapRendererProps> = ({
    chart,
    series,
    data,
    bucketSize = 0,
    palette = 'emerald-amber',
    leftAxisOffset = 0,
    showColorbar = true,
}) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rafIdRef = useRef<number | null>(null);
    const dataRef = useRef<HeatmapDataPoint[]>(data);
    dataRef.current = data;
    const bucketSizeRef = useRef<number>(bucketSize);
    bucketSizeRef.current = bucketSize;
    const paletteRef = useRef<HeatmapPalette>(palette);
    paletteRef.current = palette;
    const isDarkRef = useRef<boolean>(isDark);
    isDarkRef.current = isDark;
    const leftOffsetRef = useRef<number>(leftAxisOffset);
    leftOffsetRef.current = leftAxisOffset;
    const showColorbarRef = useRef<boolean>(showColorbar);
    showColorbarRef.current = showColorbar;

    const drawHeatmap = useCallback(() => {
        const canvas = canvasRef.current;
        const points = dataRef.current;
        if (!chart || !series || !canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const maxDpr = isThermalGuardActive() ? 1.35 : 2;
        const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
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

        if (!points || points.length === 0) return;

        try {
            const timeScale = chart.timeScale();
            const logicalRange = timeScale.getVisibleLogicalRange();
            if (!logicalRange) return;

            const timeWidth = timeScale.width();
            const visibleBars = Math.max(1, logicalRange.to - logicalRange.from);
            const barSpacing = timeWidth / visibleBars;
            const leftOff = leftOffsetRef.current;
            const activePalette = paletteRef.current;
            const dark = isDarkRef.current;

            // Collect visible heatmap points and volume distribution for P98 outlier-proof scaling
            const visiblePoints: { pt: HeatmapDataPoint; x: number }[] = [];
            const allVols: number[] = [];

            for (let i = 0; i < points.length; i++) {
                const pt = points[i];
                const x = timeScale.timeToCoordinate(pt.time as any);
                if (x === null) continue;
                if (x < -barSpacing * 2 || x > timeWidth + barSpacing * 2) continue;

                visiblePoints.push({ pt, x: x + leftOff });
                for (let j = 0; j < pt.levels.length; j++) {
                    const v = pt.levels[j].volume;
                    if (v > 0) allVols.push(v);
                }
            }

            if (visiblePoints.length === 0 || allVols.length === 0) return;

            // Compute P98 reference cap so 1 massive spoof wall never crushes normal orderbook bands
            allVols.sort((a, b) => a - b);
            const p98Idx = Math.min(allVols.length - 1, Math.floor(allVols.length * 0.98));
            const normCap = Math.max(allVols[p98Idx], allVols[allVols.length - 1] * 0.25, 1e-9);

            // Compute dynamic cell height from the actual price bucket span on the active Y-scale
            const samplePt = visiblePoints[visiblePoints.length - 1].pt;
            const effBucket = samplePt.bucketSize || bucketSizeRef.current || 0;
            let cellHeight = 5;
            if (effBucket > 0 && samplePt.levels.length > 0) {
                const refPrice = samplePt.levels[0].price;
                const y1 = series.priceToCoordinate(refPrice);
                const y2 = series.priceToCoordinate(refPrice + effBucket);
                if (y1 !== null && y2 !== null) {
                    cellHeight = Math.max(2.5, Math.min(16, Math.abs(y1 - y2)));
                }
            }

            const barWidth = Math.max(2, barSpacing * 0.96);
            const minIntensity = barSpacing < 2 ? 0.14 : 0.05;

            ctx.save();
            ctx.beginPath();
            ctx.rect(leftOff, 0, timeWidth, cssH);
            ctx.clip();

            // 1. Paint historical + live candle-aligned liquidity bands
            for (let i = 0; i < visiblePoints.length; i++) {
                const { pt, x } = visiblePoints[i];
                const drawX = Math.floor(x - barWidth / 2);
                const drawW = Math.ceil(barWidth);

                for (let j = 0; j < pt.levels.length; j++) {
                    const lv = pt.levels[j];
                    const intensity = Math.min(1, lv.volume / normCap);
                    const y = series.priceToCoordinate(lv.price);
                    if (y === null || y < -cellHeight || y > cssH + cellHeight) continue;

                    const cellY = Math.floor(y - cellHeight / 2);
                    const cellH = Math.ceil(cellHeight);

                    if (intensity >= minIntensity) {
                        // Log-like perceptual curve so mid-tier institutional walls stand out cleanly
                        const curved = Math.pow(intensity, 0.68);
                        ctx.fillStyle = getHeatmapCellColor(curved, lv.type, activePalette, dark);
                        ctx.fillRect(drawX, cellY, drawW, cellH);
                    }

                    // Pulled / Spoofed Wall marker: significant peak wall that shrank >45% inside the bar
                    if (
                        lv.peakVolume &&
                        lv.pulledDelta &&
                        lv.peakVolume >= normCap * 0.55 &&
                        lv.pulledDelta < -lv.peakVolume * 0.45 &&
                        barWidth >= 4
                    ) {
                        ctx.strokeStyle = dark ? 'rgba(244, 114, 182, 0.55)' : 'rgba(219, 39, 119, 0.6)';
                        ctx.lineWidth = 1;
                        ctx.setLineDash([2, 2]);
                        ctx.strokeRect(drawX + 0.5, cellY + 0.5, Math.max(1, drawW - 1), Math.max(1, cellH - 1));
                        ctx.setLineDash([]);
                    }
                }
            }

            // 2. Live Right-Edge Resting Liquidity Ladder (extends from newest bar to right edge)
            const latest = visiblePoints[visiblePoints.length - 1];
            const ladderMaxWidth = Math.min(72, Math.max(28, timeWidth * 0.085));
            const ladderRight = leftOff + timeWidth - 2;
            const latestBarRight = latest.x + barWidth / 2;

            if (ladderRight > latestBarRight + 4) {
                const labelCandidates: Array<{ y: number; intensity: number; notional: number; type: 'bid' | 'ask' }> = [];

                for (let j = 0; j < latest.pt.levels.length; j++) {
                    const lv = latest.pt.levels[j];
                    const intensity = Math.min(1, lv.volume / normCap);
                    if (intensity < 0.07) continue;

                    const y = series.priceToCoordinate(lv.price);
                    if (y === null || y < 8 || y > cssH - 8) continue;

                    const w = Math.max(3, Math.pow(intensity, 0.78) * ladderMaxWidth);
                    const rx = ladderRight - w;
                    const ry = Math.floor(y - Math.max(2, cellHeight * 0.42));
                    const rh = Math.max(3, Math.ceil(cellHeight * 0.84));

                    ctx.fillStyle = getHeatmapCellColor(Math.min(1, Math.pow(intensity, 0.65) + 0.12), lv.type, activePalette, dark);
                    ctx.fillRect(rx, ry, w, rh);

                    if (intensity >= 0.6 && cellHeight >= 4.5) {
                        labelCandidates.push({
                            y,
                            intensity,
                            notional: lv.notional || lv.price * lv.volume,
                            type: lv.type,
                        });
                    }
                }

                // Vertical anti-collision pass: prioritize highest-intensity walls so labels never overlap
                labelCandidates.sort((a, b) => b.intensity - a.intensity);
                const placedYs: number[] = [];
                ctx.font = 'bold 9px monospace';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';

                for (let k = 0; k < labelCandidates.length; k++) {
                    const cand = labelCandidates[k];
                    if (placedYs.some((py) => Math.abs(py - cand.y) < 13)) continue;
                    placedYs.push(cand.y);

                    const label = `$${formatCompactOrderflowNumber(cand.notional)}`;
                    const tw = ctx.measureText(label).width;
                    ctx.fillStyle = dark ? 'rgba(5, 8, 16, 0.78)' : 'rgba(255, 255, 255, 0.88)';
                    ctx.fillRect(ladderRight - tw - 6, cand.y - 6, tw + 5, 12);
                    ctx.fillStyle =
                        cand.type === 'bid'
                            ? (dark ? '#6ee7b7' : '#047857')
                            : (dark ? '#fde047' : '#b45309');
                    ctx.fillText(label, ladderRight - 3, cand.y);
                }
            }

            // 3. Subtle Intensity Colorbar Legend (bottom-left of plot area)
            if (showColorbarRef.current && timeWidth > 260 && cssH > 160) {
                const barX = leftOff + 10;
                const barY = cssH - 22;
                const barW = 76;
                const barH = 6;

                ctx.fillStyle = dark ? 'rgba(6, 10, 20, 0.74)' : 'rgba(255, 255, 255, 0.85)';
                ctx.fillRect(barX - 4, barY - 12, barW + 48, 22);

                const steps = 16;
                const stepW = barW / steps;
                for (let s = 0; s < steps; s++) {
                    const frac = (s + 0.5) / steps;
                    ctx.fillStyle = getHeatmapCellColor(frac, frac < 0.5 ? 'bid' : 'ask', activePalette, dark);
                    ctx.fillRect(barX + s * stepW, barY, Math.ceil(stepW), barH);
                }

                ctx.font = 'bold 8px monospace';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'bottom';
                ctx.fillStyle = dark ? 'rgba(148, 163, 184, 0.9)' : 'rgba(51, 65, 85, 0.9)';
                ctx.fillText(`L2 DEPTH (P98: ${formatCompactOrderflowNumber(normCap)})`, barX, barY - 2);
            }

            ctx.restore();
        } catch (error) {
            console.error('Error in LiquidityHeatmapRenderer:', error);
        }
    }, [chart, series]);

    const requestDraw = useCallback(() => {
        if (rafIdRef.current !== null) return;
        rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = null;
            drawHeatmap();
        });
    }, [drawHeatmap]);

    // Redraw whenever data, bucketSize, palette, theme, or axis offset updates
    useEffect(() => {
        requestDraw();
    }, [data, bucketSize, palette, isDark, leftAxisOffset, showColorbar, requestDraw]);

    // ResizeObserver + chart horizontal & vertical pan/zoom subscriptions with 100% clean disposal
    useEffect(() => {
        const canvas = canvasRef.current;
        const parent = canvas?.parentElement;
        if (!chart || !series || !canvas || !parent) return;

        const observer = new ResizeObserver(() => requestDraw());
        observer.observe(parent);

        const timeScale = chart.timeScale();
        timeScale.subscribeVisibleTimeRangeChange(requestDraw);
        timeScale.subscribeVisibleLogicalRangeChange(requestDraw);
        timeScale.subscribeSizeChange(requestDraw);

        // Redraw on vertical price-axis drag / wheel zoom / 1-finger touch axis stretch / double-click reset
        const chartRoot = parent.parentElement;
        const handlePriceGesture = () => requestDraw();
        const handlePointerDrag = (e: PointerEvent) => {
            if (e.buttons !== 0) requestDraw();
        };
        chartRoot?.addEventListener('wheel', handlePriceGesture, { passive: true });
        chartRoot?.addEventListener('pointermove', handlePointerDrag, { passive: true });
        chartRoot?.addEventListener('pointerup', handlePriceGesture, { passive: true });
        chartRoot?.addEventListener('touchmove', handlePriceGesture, { passive: true });
        chartRoot?.addEventListener('touchend', handlePriceGesture, { passive: true });
        chartRoot?.addEventListener('dblclick', handlePriceGesture, { passive: true });

        requestDraw();

        return () => {
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
            observer.disconnect();
            chartRoot?.removeEventListener('wheel', handlePriceGesture);
            chartRoot?.removeEventListener('pointermove', handlePointerDrag);
            chartRoot?.removeEventListener('pointerup', handlePriceGesture);
            chartRoot?.removeEventListener('touchmove', handlePriceGesture);
            chartRoot?.removeEventListener('touchend', handlePriceGesture);
            chartRoot?.removeEventListener('dblclick', handlePriceGesture);
            try {
                timeScale.unsubscribeVisibleTimeRangeChange(requestDraw);
                timeScale.unsubscribeVisibleLogicalRangeChange(requestDraw);
                timeScale.unsubscribeSizeChange(requestDraw);
            } catch {}
        };
    }, [chart, series, requestDraw]);

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ zIndex: 1 }}
        />
    );
};
