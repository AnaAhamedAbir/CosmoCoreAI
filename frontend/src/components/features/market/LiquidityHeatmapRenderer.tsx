import React, { useEffect, useRef, useCallback } from 'react';
import { IChartApi, ISeriesApi } from 'lightweight-charts';
import { formatCompactOrderflowNumber } from '../../../utils/orderflowMath';

export interface HeatmapLevel {
    price: number;
    volume: number;
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
}

/**
 * Institutional Bookmap / TradingLite-style L2 Liquidity Heatmap Renderer:
 * - Fixes main-series logical-index mismatch (maps directly by aligned bar timestamp).
 * - Full HiDPI (devicePixelRatio) crisp canvas rendering.
 * - Distinct Bid (Teal -> Cyan -> Emerald) vs Ask (Amber -> Orange -> Gold) color scales.
 * - Dynamic cell height derived from actual price bucket height on the active Y-scale.
 * - Live right-edge Resting Liquidity Ladder bar aligned with the current orderbook.
 * - Redraws smoothly on horizontal AND vertical (price-axis) pan/zoom without listener leaks.
 */
export const LiquidityHeatmapRenderer: React.FC<LiquidityHeatmapRendererProps> = ({
    chart,
    series,
    data,
    bucketSize = 0,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawRequestedRef = useRef<boolean>(false);
    const dataRef = useRef<HeatmapDataPoint[]>(data);
    dataRef.current = data;
    const bucketSizeRef = useRef<number>(bucketSize);
    bucketSizeRef.current = bucketSize;

    const drawHeatmap = useCallback(() => {
        const canvas = canvasRef.current;
        const points = dataRef.current;
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

        if (!points || points.length === 0) return;

        try {
            const timeScale = chart.timeScale();
            const logicalRange = timeScale.getVisibleLogicalRange();
            if (!logicalRange) return;

            const timeWidth = timeScale.width();
            const visibleBars = Math.max(1, logicalRange.to - logicalRange.from);
            const barSpacing = timeWidth / visibleBars;

            // Collect visible heatmap points using exact timeToCoordinate (NOT main-series logical indices!)
            const visiblePoints: { pt: HeatmapDataPoint; x: number }[] = [];
            let maxVol = 0;

            for (let i = 0; i < points.length; i++) {
                const pt = points[i];
                const x = timeScale.timeToCoordinate(pt.time as any);
                if (x === null) continue;
                if (x < -barSpacing * 2 || x > timeWidth + barSpacing * 2) continue;

                visiblePoints.push({ pt, x });
                for (let j = 0; j < pt.levels.length; j++) {
                    const v = pt.levels[j].volume;
                    if (v > maxVol) maxVol = v;
                }
            }

            if (visiblePoints.length === 0 || maxVol <= 0) return;

            // Compute dynamic cell height from the actual price bucket span on the current Y-scale
            const samplePt = visiblePoints[visiblePoints.length - 1].pt;
            const effBucket = samplePt.bucketSize || bucketSizeRef.current || 0;
            let cellHeight = 5;
            if (effBucket > 0 && samplePt.levels.length > 0) {
                const refPrice = samplePt.levels[0].price;
                const y1 = series.priceToCoordinate(refPrice);
                const y2 = series.priceToCoordinate(refPrice + effBucket);
                if (y1 !== null && y2 !== null) {
                    cellHeight = Math.max(2.5, Math.min(14, Math.abs(y1 - y2)));
                }
            }

            const barWidth = Math.max(2, barSpacing * 0.96);
            const minIntensity = barSpacing < 2 ? 0.16 : 0.06;

            // 1. Paint historical + live candle-aligned liquidity bands
            for (let i = 0; i < visiblePoints.length; i++) {
                const { pt, x } = visiblePoints[i];
                const drawX = Math.floor(x - barWidth / 2);
                const drawW = Math.ceil(barWidth);

                for (let j = 0; j < pt.levels.length; j++) {
                    const lv = pt.levels[j];
                    const intensity = Math.min(1, lv.volume / maxVol);
                    if (intensity < minIntensity) continue;

                    const y = series.priceToCoordinate(lv.price);
                    if (y === null || y < -cellHeight || y > cssH + cellHeight) continue;

                    // Non-linear perceptual boost so strong walls pop visually while thin dust stays subtle
                    const curved = Math.pow(intensity, 0.72);
                    let fill: string;
                    if (lv.type === 'bid') {
                        // Support Liquidity: Deep Teal -> Cyan -> Bright Emerald
                        if (curved < 0.45) {
                            fill = `rgba(6, 182, 212, ${(0.08 + curved * 0.45).toFixed(3)})`;
                        } else if (curved < 0.78) {
                            fill = `rgba(16, 185, 129, ${(0.28 + (curved - 0.45) * 0.8).toFixed(3)})`;
                        } else {
                            fill = `rgba(52, 211, 153, ${(0.58 + (curved - 0.78) * 1.1).toFixed(3)})`;
                        }
                    } else {
                        // Resistance Liquidity: Deep Amber -> Vivid Orange -> Hot Gold
                        if (curved < 0.45) {
                            fill = `rgba(245, 158, 11, ${(0.08 + curved * 0.45).toFixed(3)})`;
                        } else if (curved < 0.78) {
                            fill = `rgba(249, 115, 22, ${(0.28 + (curved - 0.45) * 0.8).toFixed(3)})`;
                        } else {
                            fill = `rgba(250, 204, 21, ${(0.60 + (curved - 0.78) * 1.1).toFixed(3)})`;
                        }
                    }

                    ctx.fillStyle = fill;
                    ctx.fillRect(drawX, Math.floor(y - cellHeight / 2), drawW, Math.ceil(cellHeight));
                }
            }

            // 2. Live Right-Edge Resting Liquidity Ladder (extends from newest bar to right edge)
            const latest = visiblePoints[visiblePoints.length - 1];
            const ladderMaxWidth = Math.min(64, Math.max(26, timeWidth * 0.08));
            const ladderRight = timeWidth - 2;
            const latestBarRight = latest.x + barWidth / 2;

            if (ladderRight > latestBarRight + 4) {
                for (let j = 0; j < latest.pt.levels.length; j++) {
                    const lv = latest.pt.levels[j];
                    const intensity = Math.min(1, lv.volume / maxVol);
                    if (intensity < 0.08) continue;

                    const y = series.priceToCoordinate(lv.price);
                    if (y === null || y < 6 || y > cssH - 6) continue;

                    const w = Math.max(3, intensity * ladderMaxWidth);
                    const rx = ladderRight - w;
                    const ry = Math.floor(y - Math.max(2, cellHeight * 0.42));
                    const rh = Math.max(3, Math.ceil(cellHeight * 0.84));

                    ctx.fillStyle =
                        lv.type === 'bid'
                            ? `rgba(16, 185, 129, ${(0.22 + intensity * 0.55).toFixed(3)})`
                            : `rgba(249, 115, 22, ${(0.22 + intensity * 0.55).toFixed(3)})`;
                    ctx.fillRect(rx, ry, w, rh);

                    // Label top institutional walls (>= 65% of max visible depth) with notional USD
                    if (intensity >= 0.65 && cellHeight >= 5) {
                        const notional = lv.notional || lv.price * lv.volume;
                        const label = `$${formatCompactOrderflowNumber(notional)}`;
                        ctx.font = 'bold 9px monospace';
                        ctx.textAlign = 'right';
                        ctx.textBaseline = 'middle';
                        ctx.fillStyle = lv.type === 'bid' ? '#6ee7b7' : '#fde047';
                        ctx.fillText(label, ladderRight - 3, y);
                    }
                }
            }
        } catch (error) {
            console.error('Error in LiquidityHeatmapRenderer:', error);
        }
    }, [chart, series]);

    const requestDraw = useCallback(() => {
        if (!drawRequestedRef.current) {
            drawRequestedRef.current = true;
            requestAnimationFrame(() => {
                drawRequestedRef.current = false;
                drawHeatmap();
            });
        }
    }, [drawHeatmap]);

    // Redraw whenever data or bucketSize updates
    useEffect(() => {
        requestDraw();
    }, [data, bucketSize, requestDraw]);

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

        // Redraw on vertical price-axis drag / wheel zoom (ignore plain hover moves for zero idle CPU)
        const chartRoot = parent.parentElement;
        const handlePriceGesture = () => requestDraw();
        const handlePointerDrag = (e: PointerEvent) => {
            if (e.buttons !== 0) requestDraw();
        };
        chartRoot?.addEventListener('wheel', handlePriceGesture, { passive: true });
        chartRoot?.addEventListener('pointermove', handlePointerDrag, { passive: true });
        chartRoot?.addEventListener('pointerup', handlePriceGesture, { passive: true });

        requestDraw();

        return () => {
            observer.disconnect();
            chartRoot?.removeEventListener('wheel', handlePriceGesture);
            chartRoot?.removeEventListener('pointermove', handlePointerDrag);
            chartRoot?.removeEventListener('pointerup', handlePriceGesture);
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
