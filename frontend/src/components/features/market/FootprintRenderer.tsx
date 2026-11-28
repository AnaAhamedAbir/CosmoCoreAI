import React, { useEffect, useRef, useCallback } from 'react';
import { IChartApi, ISeriesApi } from 'lightweight-charts';
import { useTheme } from '@/context/ThemeContext';
import { formatFootprintVolume } from '../../../utils/volumeFormatter';
import { formatCompactOrderflowNumber } from '../../../utils/orderflowMath';

export type FootprintMode = 'bid-ask' | 'delta' | 'imbalance';

export interface FootprintDataTick {
    price: number;
    bidVolume: number;
    askVolume: number;
    isImbalance?: boolean;
    imbalanceType?: 'bid' | 'ask';
    isAskImbalance?: boolean;
    isBidImbalance?: boolean;
    isStackedImbalance?: boolean;
    isUnfinishedAuction?: boolean;
    isAbsorption?: boolean;
}

export interface FootprintCandleData {
    time: number;
    open?: number;
    high: number;
    low: number;
    close?: number;
    pocPrice?: number;
    totalDelta?: number;
    totalVolume?: number;
    hasDeltaDivergence?: boolean;
    divergenceType?: 'bullish' | 'bearish';
    isRealCluster?: boolean;
    tickStep?: number;
    ticks: FootprintDataTick[];
}

interface FootprintRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    data: FootprintCandleData[];
    visible: boolean;
    mode?: FootprintMode;
    showDevelopingPoc?: boolean;
    showNakedPoc?: boolean;
    leftAxisOffset?: number;
}

const FONT_CELL = 'bold 9px monospace';
const FONT_CELL_BOLD = '900 9.5px monospace';
const FONT_BADGE = 'bold 8.5px monospace';
const FONT_MICRO = 'bold 8px monospace';
const FONT_STAR = 'bold 11px monospace';

/**
 * Exocharts / ATAS-Style Institutional Footprint Renderer:
 * - Zero listener churn on 5Hz data updates (subscriptions mount once per chart/series/visible).
 * - Median visible candle spacing (immune to weekend/session gaps) + clamped boxWidth.
 * - Full Light/Dark contrast support + 3 Pro Modes (`bid-ask`, `delta`, `imbalance`).
 * - Developing POC (dPOC) gold trail + Naked POC (nPOC) auto-terminating forward rays.
 * - Independent Bid & Ask 300% diagonal imbalances, Stacked Imbalance S/R rays, Absorption glow,
 *   Unfinished Auctions, and bottom Delta + Volume institutional strip.
 */
export const FootprintRenderer: React.FC<FootprintRendererProps> = ({
    chart,
    series,
    data,
    visible,
    mode = 'bid-ask',
    showDevelopingPoc = true,
    showNakedPoc = true,
    leftAxisOffset = 0,
}) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rafIdRef = useRef<number | null>(null);
    const dataRef = useRef<FootprintCandleData[]>(data);
    dataRef.current = data;
    const modeRef = useRef<FootprintMode>(mode);
    modeRef.current = mode;
    const isDarkRef = useRef<boolean>(isDark);
    isDarkRef.current = isDark;
    const showDpocRef = useRef<boolean>(showDevelopingPoc);
    showDpocRef.current = showDevelopingPoc;
    const showNpocRef = useRef<boolean>(showNakedPoc);
    showNpocRef.current = showNakedPoc;
    const leftOffsetRef = useRef<number>(leftAxisOffset);
    leftOffsetRef.current = leftAxisOffset;

    const drawFootprint = useCallback(() => {
        const canvas = canvasRef.current;
        if (!chart || !series || !canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const candles = dataRef.current;
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

        if (!candles || candles.length === 0) return;

        try {
            const timeScale = chart.timeScale();
            const logicalRange = timeScale.getVisibleLogicalRange();
            if (!logicalRange) return;

            const timeWidth = timeScale.width();
            const visibleBars = Math.max(1, logicalRange.to - logicalRange.from);
            const avgBarSpacing = timeWidth / visibleBars;
            const leftOff = leftOffsetRef.current;
            const dark = isDarkRef.current;
            const activeMode = modeRef.current;

            // Pre-compute visible candle X coords and robust median spacing (immune to weekend/session gaps)
            const visibleCandles: Array<{ idx: number; candle: FootprintCandleData; x: number }> = [];
            const spacings: number[] = [];

            for (let i = 0; i < candles.length; i++) {
                const candle = candles[i];
                if (!candle || !candle.ticks || candle.ticks.length === 0) continue;
                const rawX = timeScale.timeToCoordinate(candle.time as any);
                if (rawX === null || rawX < -140 || rawX > timeWidth + 140) continue;
                const x = rawX + leftOff;
                if (visibleCandles.length > 0) {
                    const diff = x - visibleCandles[visibleCandles.length - 1].x;
                    if (diff > 1 && diff < avgBarSpacing * 3.5) {
                        spacings.push(diff);
                    }
                }
                visibleCandles.push({ idx: i, candle, x });
            }

            if (visibleCandles.length === 0) return;

            spacings.sort((a, b) => a - b);
            const candleSpacing =
                spacings.length > 0 ? spacings[Math.floor(spacings.length / 2)] : avgBarSpacing;
            const isZoomedIn = candleSpacing >= 34;

            ctx.save();
            ctx.beginPath();
            ctx.rect(leftOff, 0, timeWidth, cssH);
            ctx.clip();

            // 0A. Naked POC (nPOC) Auto-Terminating Forward Rays
            if (showNpocRef.current && candles.length >= 3) {
                const startLook = Math.max(0, candles.length - 100);
                const rightEdge = leftOff + timeWidth;
                let drawnRays = 0;

                for (let i = candles.length - 2; i >= startLook && drawnRays < 6; i--) {
                    const c = candles[i];
                    const poc = c.pocPrice;
                    if (!poc || !Number.isFinite(poc)) continue;

                    // Check if any subsequent candle touched this POC
                    let touched = false;
                    for (let k = i + 1; k < candles.length; k++) {
                        if (candles[k].low <= poc && candles[k].high >= poc) {
                            touched = true;
                            break;
                        }
                    }
                    if (touched) continue;

                    const y = series.priceToCoordinate(poc);
                    if (y === null || y < 10 || y > cssH - 10) continue;
                    const rawStartX = timeScale.timeToCoordinate(c.time as any);
                    const startX = rawStartX !== null ? Math.max(leftOff, rawStartX + leftOff) : leftOff;
                    if (startX >= rightEdge - 24) continue;

                    drawnRays++;
                    ctx.save();
                    ctx.strokeStyle = dark ? 'rgba(250, 204, 21, 0.45)' : 'rgba(202, 138, 4, 0.55)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(startX, y);
                    ctx.lineTo(rightEdge - 2, y);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    ctx.font = FONT_MICRO;
                    ctx.textAlign = 'right';
                    ctx.textBaseline = 'bottom';
                    ctx.fillStyle = dark ? 'rgba(253, 224, 71, 0.85)' : 'rgba(161, 98, 7, 0.9)';
                    ctx.fillText('nPOC', rightEdge - 4, y - 2);
                    ctx.restore();
                }
            }

            // 0B. Developing POC (dPOC) Connecting Gold Line across visible bars
            if (showDpocRef.current && visibleCandles.length >= 2) {
                ctx.save();
                ctx.strokeStyle = dark ? 'rgba(250, 204, 21, 0.42)' : 'rgba(202, 138, 4, 0.5)';
                ctx.lineWidth = 1.25;
                ctx.beginPath();
                let started = false;
                for (let v = 0; v < visibleCandles.length; v++) {
                    const { candle, x } = visibleCandles[v];
                    if (!candle.pocPrice) continue;
                    const py = series.priceToCoordinate(candle.pocPrice);
                    if (py === null) continue;
                    if (!started) {
                        ctx.moveTo(x, py);
                        started = true;
                    } else {
                        ctx.lineTo(x, py);
                    }
                }
                if (started) ctx.stroke();
                ctx.restore();
            }

            ctx.font = FONT_CELL;
            ctx.textBaseline = 'middle';
            const charWidth = ctx.measureText('0').width;
            const boxHeight = 13;
            const minVerticalGap = 14;

            for (let v = 0; v < visibleCandles.length; v++) {
                const { candle, x } = visibleCandles[v];

                // Anti-overlap vertical clustering: merge rows within `minVerticalGap` px with weighted Y center
                const renderRows: {
                    y: number;
                    yWeightSum: number;
                    ySum: number;
                    price: number;
                    bidVolume: number;
                    askVolume: number;
                    isPoc: boolean;
                    isImbalance: boolean;
                    imbalanceType?: 'bid' | 'ask';
                    isAskImbalance: boolean;
                    isBidImbalance: boolean;
                    isStackedImbalance: boolean;
                    isUnfinishedAuction: boolean;
                    isAbsorption: boolean;
                }[] = [];

                for (let j = 0; j < candle.ticks.length; j++) {
                    const tick = candle.ticks[j];
                    const y = series.priceToCoordinate(tick.price);
                    if (y === null || y < -20 || y > cssH + 20) continue;

                    const isPoc = tick.price === candle.pocPrice;
                    const tickAskImb = Boolean(tick.isAskImbalance || (tick.isImbalance && tick.imbalanceType === 'ask'));
                    const tickBidImb = Boolean(tick.isBidImbalance || (tick.isImbalance && tick.imbalanceType === 'bid'));
                    const tickVol = Math.max(tick.bidVolume + tick.askVolume, 1e-6);
                    const lastRow = renderRows.length > 0 ? renderRows[renderRows.length - 1] : null;

                    if (lastRow && Math.abs(y - lastRow.y) < minVerticalGap) {
                        lastRow.bidVolume += tick.bidVolume;
                        lastRow.askVolume += tick.askVolume;
                        lastRow.ySum += y * tickVol;
                        lastRow.yWeightSum += tickVol;
                        lastRow.y = lastRow.ySum / lastRow.yWeightSum;
                        if (isPoc) lastRow.isPoc = true;
                        if (tickAskImb) lastRow.isAskImbalance = true;
                        if (tickBidImb) lastRow.isBidImbalance = true;
                        if (tick.isImbalance) {
                            lastRow.isImbalance = true;
                            if (!lastRow.imbalanceType) lastRow.imbalanceType = tick.imbalanceType;
                        }
                        if (tick.isStackedImbalance) lastRow.isStackedImbalance = true;
                        if (tick.isUnfinishedAuction) lastRow.isUnfinishedAuction = true;
                        if (tick.isAbsorption) lastRow.isAbsorption = true;
                    } else {
                        renderRows.push({
                            y,
                            ySum: y * tickVol,
                            yWeightSum: tickVol,
                            price: tick.price,
                            bidVolume: tick.bidVolume,
                            askVolume: tick.askVolume,
                            isPoc,
                            isImbalance: Boolean(tick.isImbalance),
                            imbalanceType: tick.imbalanceType,
                            isAskImbalance: tickAskImb,
                            isBidImbalance: tickBidImb,
                            isStackedImbalance: Boolean(tick.isStackedImbalance),
                            isUnfinishedAuction: Boolean(tick.isUnfinishedAuction),
                            isAbsorption: Boolean(tick.isAbsorption),
                        });
                    }
                }

                // Recompute max row volume AFTER vertical merging so intensity normalization is exact
                let mergedMaxRowVol = 0;
                let mergedMaxAbsDelta = 0;
                for (let r = 0; r < renderRows.length; r++) {
                    const rv = renderRows[r].bidVolume + renderRows[r].askVolume;
                    const ad = Math.abs(renderRows[r].askVolume - renderRows[r].bidVolume);
                    if (rv > mergedMaxRowVol) mergedMaxRowVol = rv;
                    if (ad > mergedMaxAbsDelta) mergedMaxAbsDelta = ad;
                }
                if (mergedMaxRowVol <= 0) mergedMaxRowVol = 1;
                if (mergedMaxAbsDelta <= 0) mergedMaxAbsDelta = 1;

                // Clamp boxWidth strictly inside candleSpacing * 0.92 so neighboring candles NEVER collide
                const maxAllowedW = Math.max(24, candleSpacing * 0.92);

                for (let r = 0; r < renderRows.length; r++) {
                    const row = renderRows[r];
                    const bidStr = formatFootprintVolume(row.bidVolume);
                    const askStr = formatFootprintVolume(row.askVolume);
                    const sepStr = '×';
                    const rowVol = row.bidVolume + row.askVolume;
                    const rowDelta = row.askVolume - row.bidVolume;

                    const isFeatureRow =
                        row.isPoc ||
                        row.isImbalance ||
                        row.isStackedImbalance ||
                        row.isAbsorption ||
                        row.isUnfinishedAuction;

                    const totalChars =
                        activeMode === 'delta'
                            ? formatCompactOrderflowNumber(rowDelta, true).length + 2
                            : bidStr.length + sepStr.length + askStr.length + 2;
                    const boxWidth = Math.min(maxAllowedW, Math.max(30, totalChars * charWidth + 8));
                    const boxX = x - boxWidth / 2;
                    const boxY = row.y - boxHeight / 2;

                    // 1. Absorption Glow
                    if (row.isAbsorption) {
                        const radius = isZoomedIn ? boxWidth * 0.65 : 14;
                        const grad = ctx.createRadialGradient(x, row.y, 1, x, row.y, radius);
                        grad.addColorStop(0, dark ? 'rgba(168, 85, 247, 0.36)' : 'rgba(147, 51, 234, 0.25)');
                        grad.addColorStop(1, 'rgba(168, 85, 247, 0)');
                        ctx.fillStyle = grad;
                        ctx.fillRect(x - radius, row.y - boxHeight, radius * 2, boxHeight * 2);
                    }

                    // 2. Stacked Imbalance Horizontal S/R Zone Ray
                    if (row.isStackedImbalance && (row.isAskImbalance || row.isBidImbalance || row.imbalanceType)) {
                        const rayW = isZoomedIn ? Math.max(candleSpacing * 1.8, 48) : Math.max(candleSpacing * 1.1, 18);
                        const startX = isZoomedIn ? boxX + boxWidth : x + 4;
                        const isBuyZone = row.isAskImbalance || row.imbalanceType === 'ask';
                        ctx.fillStyle = isBuyZone ? 'rgba(16, 185, 129, 0.14)' : 'rgba(244, 63, 94, 0.14)';
                        ctx.fillRect(startX, boxY, rayW, boxHeight);

                        ctx.strokeStyle = isBuyZone ? 'rgba(16, 185, 129, 0.6)' : 'rgba(244, 63, 94, 0.6)';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(startX, boxY);
                        ctx.lineTo(startX + rayW, boxY);
                        ctx.stroke();
                    }

                    if (!isZoomedIn) continue;

                    // In 'imbalance' focus mode, dim non-key noise rows so POC/Imbalance/Absorption pop
                    const dimAlpha = activeMode === 'imbalance' && !isFeatureRow ? 0.26 : 1.0;
                    ctx.save();
                    if (dimAlpha < 1.0) ctx.globalAlpha = dimAlpha;

                    // 3. Cell Background Shading
                    const dominance = rowVol > 0 ? Math.abs(rowDelta) / rowVol : 0;
                    const volRatio = Math.min(1, rowVol / mergedMaxRowVol);
                    const alpha = 0.16 + volRatio * 0.24 + dominance * 0.14;

                    ctx.fillStyle =
                        rowDelta >= 0
                            ? `rgba(16, 185, 129, ${Math.min(0.54, alpha).toFixed(2)})`
                            : `rgba(244, 63, 94, ${Math.min(0.54, alpha).toFixed(2)})`;

                    ctx.beginPath();
                    if (ctx.roundRect) {
                        ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 2.5);
                    } else {
                        ctx.rect(boxX, boxY, boxWidth, boxHeight);
                    }
                    ctx.fill();

                    // Theme-aware contrast scrim
                    ctx.fillStyle = dark ? 'rgba(4, 7, 15, 0.52)' : 'rgba(255, 255, 255, 0.68)';
                    ctx.fill();

                    // Delta-Profile bar overlay when mode === 'delta'
                    if (activeMode === 'delta') {
                        const deltaFrac = Math.min(1, Math.abs(rowDelta) / mergedMaxAbsDelta);
                        const barW = Math.max(3, deltaFrac * (boxWidth - 2));
                        ctx.fillStyle =
                            rowDelta >= 0
                                ? (dark ? 'rgba(16, 185, 129, 0.42)' : 'rgba(16, 185, 129, 0.34)')
                                : (dark ? 'rgba(244, 63, 94, 0.42)' : 'rgba(244, 63, 94, 0.34)');
                        ctx.fillRect(boxX + 1, boxY + 1, barW, boxHeight - 2);
                    }

                    // 4. Gold POC Box or Imbalance Border
                    if (row.isPoc) {
                        ctx.strokeStyle = dark ? '#facc15' : '#ca8a04';
                        ctx.lineWidth = 1.4;
                        ctx.stroke();
                    } else if (row.isImbalance) {
                        ctx.strokeStyle = row.isAskImbalance
                            ? (dark ? 'rgba(52, 211, 153, 0.8)' : 'rgba(5, 150, 105, 0.8)')
                            : (dark ? 'rgba(251, 113, 133, 0.8)' : 'rgba(225, 29, 72, 0.8)');
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }

                    // 5. Unfinished Auction Marker
                    if (row.isUnfinishedAuction) {
                        ctx.font = FONT_STAR;
                        ctx.textAlign = 'right';
                        ctx.textBaseline = 'middle';
                        ctx.fillStyle = dark ? '#fbbf24' : '#d97706';
                        ctx.fillText('★', boxX - 2, row.y);
                    }

                    // 6. Monospace Cluster Digits (strictly clipped inside boxWidth so digits never spill into neighboring candles)
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(boxX + 1, boxY, Math.max(4, boxWidth - 2), boxHeight);
                    ctx.clip();
                    ctx.textBaseline = 'middle';
                    if (activeMode === 'delta') {
                        const dLabel = formatCompactOrderflowNumber(rowDelta, true);
                        ctx.font = row.isImbalance ? FONT_CELL_BOLD : FONT_CELL;
                        ctx.textAlign = 'center';
                        ctx.fillStyle =
                            rowDelta >= 0
                                ? (dark ? '#6ee7b7' : '#047857')
                                : (dark ? '#fda4af' : '#be123c');
                        ctx.fillText(dLabel, x, row.y, Math.max(10, boxWidth - 4));
                    } else {
                        const halfW = Math.max(8, boxWidth / 2 - 5);
                        // Divider '×' centered
                        ctx.font = FONT_CELL;
                        ctx.textAlign = 'center';
                        ctx.fillStyle = dark ? 'rgba(148, 163, 184, 0.7)' : 'rgba(71, 85, 105, 0.7)';
                        ctx.fillText(sepStr, x, row.y);

                        // Bid Volume (left of divider) — independent isBidImbalance highlight
                        ctx.font = row.isBidImbalance ? FONT_CELL_BOLD : FONT_CELL;
                        ctx.textAlign = 'right';
                        ctx.fillStyle = row.isBidImbalance
                            ? (dark ? '#fda4af' : '#9f1239')
                            : (dark ? '#f87171' : '#e11d48');
                        ctx.fillText(bidStr, x - 4, row.y, halfW);

                        // Ask Volume (right of divider) — independent isAskImbalance highlight
                        ctx.font = row.isAskImbalance ? FONT_CELL_BOLD : FONT_CELL;
                        ctx.textAlign = 'left';
                        ctx.fillStyle = row.isAskImbalance
                            ? (dark ? '#6ee7b7' : '#065f46')
                            : (dark ? '#4ade80' : '#059669');
                        ctx.fillText(askStr, x + 4, row.y, halfW);
                    }
                    ctx.restore();

                    ctx.restore();
                }

                // 7. Bottom Candle Delta + Volume Institutional Readout + Divergence Badge
                const lowY = series.priceToCoordinate(candle.low);
                if (lowY !== null && lowY < cssH - 16) {
                    let cursorY = lowY + 12;

                    if (isZoomedIn && candle.totalDelta !== undefined) {
                        const dVal = candle.totalDelta;
                        const deltaLabel = `Δ ${formatCompactOrderflowNumber(dVal, true)}`;
                        ctx.font = FONT_BADGE;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        const pillW = Math.min(maxAllowedW, Math.max(34, deltaLabel.length * 5.5 + 8));
                        ctx.fillStyle = dVal >= 0
                            ? (dark ? 'rgba(6, 78, 59, 0.88)' : 'rgba(209, 250, 229, 0.94)')
                            : (dark ? 'rgba(136, 19, 55, 0.88)' : 'rgba(255, 228, 230, 0.94)');
                        ctx.beginPath();
                        if (ctx.roundRect) {
                            ctx.roundRect(x - pillW / 2, cursorY - 6.5, pillW, 13, 3);
                        } else {
                            ctx.rect(x - pillW / 2, cursorY - 6.5, pillW, 13);
                        }
                        ctx.fill();
                        ctx.fillStyle = dVal >= 0
                            ? (dark ? '#6ee7b7' : '#065f46')
                            : (dark ? '#fda4af' : '#9f1239');
                        ctx.fillText(deltaLabel, x, cursorY, Math.max(12, pillW - 4));
                        cursorY += 14;

                        // Total Volume micro-row when zoomed in cleanly
                        if (candleSpacing >= 46 && candle.totalVolume && candle.totalVolume > 0 && cursorY < cssH - 10) {
                            ctx.font = FONT_MICRO;
                            ctx.fillStyle = dark ? 'rgba(148, 163, 184, 0.85)' : 'rgba(71, 85, 105, 0.85)';
                            ctx.fillText(`V ${formatCompactOrderflowNumber(candle.totalVolume)}`, x, cursorY, maxAllowedW);
                            cursorY += 12;
                        }
                    }

                    if (candle.hasDeltaDivergence && candleSpacing > 18 && cursorY < cssH - 6) {
                        const isBullDiv = candle.divergenceType === 'bullish';
                        const divText = candleSpacing >= 44 ? (isBullDiv ? '▲ BULL DIV' : '▼ BEAR DIV') : (isBullDiv ? '▲ DIV' : '▼ DIV');
                        ctx.font = FONT_BADGE;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillStyle = isBullDiv
                            ? (dark ? '#34d399' : '#059669')
                            : (dark ? '#fb7185' : '#e11d48');
                        ctx.fillText(divText, x, cursorY, maxAllowedW);
                    }
                }
            }

            ctx.restore();
        } catch (err) {
            console.error('Error in FootprintRenderer:', err);
        }
    }, [chart, series]);

    const requestDraw = useCallback(() => {
        if (rafIdRef.current !== null) return;
        rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = null;
            drawFootprint();
        });
    }, [drawFootprint]);

    // Trigger lightweight repaint on data/mode/theme changes WITHOUT tearing down chart listeners!
    useEffect(() => {
        if (!visible) return;
        requestDraw();
    }, [data, visible, mode, isDark, showDevelopingPoc, showNakedPoc, leftAxisOffset, requestDraw]);

    // Mount chart/DOM listeners once per chart/series/visible lifecycle
    useEffect(() => {
        if (!visible || !chart || !series || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const parent = canvas.parentElement;
        const resizeObserver = parent ? new ResizeObserver(requestDraw) : null;
        if (parent && resizeObserver) resizeObserver.observe(parent);

        const timeScale = chart.timeScale();
        timeScale.subscribeVisibleLogicalRangeChange(requestDraw);
        timeScale.subscribeVisibleTimeRangeChange(requestDraw);
        timeScale.subscribeSizeChange(requestDraw);

        const chartRoot = parent?.parentElement;
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
            resizeObserver?.disconnect();
            chartRoot?.removeEventListener('wheel', requestDraw);
            chartRoot?.removeEventListener('pointermove', handlePointerDrag);
            chartRoot?.removeEventListener('pointerup', requestDraw);
            chartRoot?.removeEventListener('dblclick', requestDraw);
            try {
                timeScale.unsubscribeVisibleLogicalRangeChange(requestDraw);
                timeScale.unsubscribeVisibleTimeRangeChange(requestDraw);
                timeScale.unsubscribeSizeChange(requestDraw);
            } catch {}
        };
    }, [chart, series, visible, requestDraw]);

    if (!visible) return null;

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none z-20"
        />
    );
};
