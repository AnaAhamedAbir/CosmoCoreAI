import React, { useEffect, useRef } from 'react';
import { IChartApi, ISeriesApi } from 'lightweight-charts';
import { formatFootprintVolume } from '../../../utils/volumeFormatter';
import { formatCompactOrderflowNumber } from '../../../utils/orderflowMath';

export interface FootprintDataTick {
    price: number;
    bidVolume: number;
    askVolume: number;
    isImbalance?: boolean;
    imbalanceType?: 'bid' | 'ask';
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
}

const FONT_CELL = 'bold 9px monospace';
const FONT_CELL_BOLD = '900 9.5px monospace';
const FONT_BADGE = 'bold 8.5px monospace';
const FONT_STAR = 'bold 11px monospace';

/**
 * Exocharts / ATAS-Style Institutional Footprint Renderer:
 * - Fixes ctx.font corruption bug (explicitly sets font before every text draw).
 * - Full HiDPI (devicePixelRatio) razor-sharp canvas rendering.
 * - Anti-overlap vertical row merging: collapses adjacent rows whose Y distance < 14px so boxes never stack/clutter.
 * - Delta-intensity background shading per Bid x Ask cluster cell.
 * - Bold highlighted 300% Diagonal Imbalances + Gold POC box + Stacked Imbalance S/R rays.
 * - Distinct Bullish (Emerald) vs Bearish (Rose) Divergence badges + bottom Candle Delta readout.
 */
export const FootprintRenderer: React.FC<FootprintRendererProps> = ({ chart, series, data, visible }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rafIdRef = useRef<number | null>(null);
    const dataRef = useRef<FootprintCandleData[]>(data);
    dataRef.current = data;

    useEffect(() => {
        if (!visible || !chart || !series || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const drawFootprint = () => {
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

                ctx.font = FONT_CELL;
                ctx.textBaseline = 'middle';
                const charWidth = ctx.measureText('0').width;
                const boxHeight = 13;
                const minVerticalGap = 14;

                for (let i = 0; i < candles.length; i++) {
                    const candle = candles[i];
                    if (!candle || !candle.ticks || candle.ticks.length === 0) continue;

                    const x = timeScale.timeToCoordinate(candle.time as any);
                    if (x === null || x < -120 || x > timeWidth + 120) continue;

                    let candleSpacing = avgBarSpacing;
                    if (i < candles.length - 1 && candles[i + 1]) {
                        const nx = timeScale.timeToCoordinate(candles[i + 1].time as any);
                        if (nx !== null && Math.abs(nx - x) > 0) {
                            candleSpacing = Math.abs(nx - x);
                        }
                    }

                    const isZoomedIn = candleSpacing >= 34;

                    // Compute max row volume in this candle for clean cell-delta shading
                    let candleMaxRowVol = 0;
                    for (let j = 0; j < candle.ticks.length; j++) {
                        const rv = candle.ticks[j].bidVolume + candle.ticks[j].askVolume;
                        if (rv > candleMaxRowVol) candleMaxRowVol = rv;
                    }
                    if (candleMaxRowVol <= 0) candleMaxRowVol = 1;

                    // Anti-overlap vertical clustering: merge rows that fall within `minVerticalGap` pixels
                    const renderRows: {
                        y: number;
                        price: number;
                        bidVolume: number;
                        askVolume: number;
                        isPoc: boolean;
                        isImbalance: boolean;
                        imbalanceType?: 'bid' | 'ask';
                        isStackedImbalance: boolean;
                        isUnfinishedAuction: boolean;
                        isAbsorption: boolean;
                    }[] = [];

                    for (let j = 0; j < candle.ticks.length; j++) {
                        const tick = candle.ticks[j];
                        const y = series.priceToCoordinate(tick.price);
                        if (y === null || y < -20 || y > cssH + 20) continue;

                        const isPoc = tick.price === candle.pocPrice;
                        const lastRow = renderRows.length > 0 ? renderRows[renderRows.length - 1] : null;

                        if (lastRow && Math.abs(y - lastRow.y) < minVerticalGap) {
                            lastRow.bidVolume += tick.bidVolume;
                            lastRow.askVolume += tick.askVolume;
                            if (isPoc) lastRow.isPoc = true;
                            if (tick.isImbalance && !lastRow.isImbalance) {
                                lastRow.isImbalance = true;
                                lastRow.imbalanceType = tick.imbalanceType;
                            }
                            if (tick.isStackedImbalance) lastRow.isStackedImbalance = true;
                            if (tick.isUnfinishedAuction) lastRow.isUnfinishedAuction = true;
                            if (tick.isAbsorption) lastRow.isAbsorption = true;
                        } else {
                            renderRows.push({
                                y,
                                price: tick.price,
                                bidVolume: tick.bidVolume,
                                askVolume: tick.askVolume,
                                isPoc,
                                isImbalance: Boolean(tick.isImbalance),
                                imbalanceType: tick.imbalanceType,
                                isStackedImbalance: Boolean(tick.isStackedImbalance),
                                isUnfinishedAuction: Boolean(tick.isUnfinishedAuction),
                                isAbsorption: Boolean(tick.isAbsorption),
                            });
                        }
                    }

                    // Render each anti-overlapped cluster row
                    for (let r = 0; r < renderRows.length; r++) {
                        const row = renderRows[r];
                        const bidStr = formatFootprintVolume(row.bidVolume);
                        const askStr = formatFootprintVolume(row.askVolume);
                        const sepStr = '×';

                        const totalChars = bidStr.length + sepStr.length + askStr.length + 2;
                        const boxWidth = Math.max(38, Math.min(candleSpacing * 0.94, totalChars * charWidth + 8));
                        const boxX = x - boxWidth / 2;
                        const boxY = row.y - boxHeight / 2;

                        // 1. Absorption Glow
                        if (row.isAbsorption) {
                            const radius = isZoomedIn ? boxWidth * 0.65 : 14;
                            const grad = ctx.createRadialGradient(x, row.y, 1, x, row.y, radius);
                            grad.addColorStop(0, 'rgba(168, 85, 247, 0.35)');
                            grad.addColorStop(1, 'rgba(168, 85, 247, 0)');
                            ctx.fillStyle = grad;
                            ctx.fillRect(x - radius, row.y - boxHeight, radius * 2, boxHeight * 2);
                        }

                        // 2. Stacked Imbalance Horizontal S/R Zone Ray
                        if (row.isStackedImbalance && row.imbalanceType) {
                            const rayW = isZoomedIn ? Math.max(candleSpacing * 1.8, 48) : Math.max(candleSpacing * 1.1, 18);
                            const startX = isZoomedIn ? boxX + boxWidth : x + 4;
                            const isBuyZone = row.imbalanceType === 'ask';
                            ctx.fillStyle = isBuyZone ? 'rgba(16, 185, 129, 0.14)' : 'rgba(244, 63, 94, 0.14)';
                            ctx.fillRect(startX, boxY, rayW, boxHeight);

                            ctx.strokeStyle = isBuyZone ? 'rgba(16, 185, 129, 0.55)' : 'rgba(244, 63, 94, 0.55)';
                            ctx.lineWidth = 1;
                            ctx.beginPath();
                            ctx.moveTo(startX, boxY);
                            ctx.lineTo(startX + rayW, boxY);
                            ctx.stroke();
                        }

                        if (!isZoomedIn) continue;

                        // 3. Delta-Intensity Shaded Cell Background
                        const rowVol = row.bidVolume + row.askVolume;
                        const rowDelta = row.askVolume - row.bidVolume;
                        const dominance = rowVol > 0 ? Math.abs(rowDelta) / rowVol : 0;
                        const volRatio = Math.min(1, rowVol / candleMaxRowVol);
                        const alpha = 0.16 + volRatio * 0.24 + dominance * 0.14;

                        ctx.fillStyle =
                            rowDelta >= 0
                                ? `rgba(16, 185, 129, ${Math.min(0.55, alpha).toFixed(2)})`
                                : `rgba(244, 63, 94, ${Math.min(0.55, alpha).toFixed(2)})`;

                        ctx.beginPath();
                        if (ctx.roundRect) {
                            ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 2.5);
                        } else {
                            ctx.rect(boxX, boxY, boxWidth, boxHeight);
                        }
                        ctx.fill();

                        // Subtle dark scrim so monospace digits always have institutional contrast
                        ctx.fillStyle = 'rgba(4, 7, 15, 0.52)';
                        ctx.fill();

                        // 4. Gold POC Box or Imbalance Border
                        if (row.isPoc) {
                            ctx.strokeStyle = '#facc15';
                            ctx.lineWidth = 1.4;
                            ctx.stroke();
                        } else if (row.isImbalance) {
                            ctx.strokeStyle =
                                row.imbalanceType === 'ask' ? 'rgba(52, 211, 153, 0.75)' : 'rgba(251, 113, 133, 0.75)';
                            ctx.lineWidth = 1;
                            ctx.stroke();
                        }

                        // 5. Unfinished Auction Marker (explicitly resets font!)
                        if (row.isUnfinishedAuction) {
                            ctx.font = FONT_STAR;
                            ctx.textAlign = 'right';
                            ctx.textBaseline = 'middle';
                            ctx.fillStyle = '#fbbf24';
                            ctx.fillText('★', boxX - 2, row.y);
                        }

                        // 6. Bid × Ask Monospace Digits (explicit font every time — zero corruption!)
                        const center = x;
                        ctx.textBaseline = 'middle';

                        // Divider '×' centered
                        ctx.font = FONT_CELL;
                        ctx.textAlign = 'center';
                        ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
                        ctx.fillText(sepStr, center, row.y);

                        // Bid Volume (left of divider)
                        const isBidImb = row.isImbalance && row.imbalanceType === 'bid';
                        ctx.font = isBidImb ? FONT_CELL_BOLD : FONT_CELL;
                        ctx.textAlign = 'right';
                        ctx.fillStyle = isBidImb ? '#fda4af' : '#f87171';
                        ctx.fillText(bidStr, center - 4, row.y);

                        // Ask Volume (right of divider)
                        const isAskImb = row.isImbalance && row.imbalanceType === 'ask';
                        ctx.font = isAskImb ? FONT_CELL_BOLD : FONT_CELL;
                        ctx.textAlign = 'left';
                        ctx.fillStyle = isAskImb ? '#6ee7b7' : '#4ade80';
                        ctx.fillText(askStr, center + 4, row.y);
                    }

                    // 7. Bottom Candle Delta Readout + Bull/Bear Divergence Badge
                    const lowY = series.priceToCoordinate(candle.low);
                    if (lowY !== null && lowY < cssH - 18) {
                        let cursorY = lowY + 12;

                        if (isZoomedIn && candle.totalDelta !== undefined) {
                            const dVal = candle.totalDelta;
                            const deltaLabel = `Δ ${formatCompactOrderflowNumber(dVal, true)}`;
                            ctx.font = FONT_BADGE;
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            const pillW = Math.max(36, deltaLabel.length * 5.6 + 8);
                            ctx.fillStyle = dVal >= 0 ? 'rgba(6, 78, 59, 0.85)' : 'rgba(136, 19, 55, 0.85)';
                            ctx.beginPath();
                            if (ctx.roundRect) {
                                ctx.roundRect(x - pillW / 2, cursorY - 6.5, pillW, 13, 3);
                            } else {
                                ctx.rect(x - pillW / 2, cursorY - 6.5, pillW, 13);
                            }
                            ctx.fill();
                            ctx.fillStyle = dVal >= 0 ? '#6ee7b7' : '#fda4af';
                            ctx.fillText(deltaLabel, x, cursorY);
                            cursorY += 15;
                        }

                        if (candle.hasDeltaDivergence && candleSpacing > 18) {
                            const isBullDiv = candle.divergenceType === 'bullish';
                            const divText = isBullDiv ? '▲ BULL DIV' : '▼ BEAR DIV';
                            ctx.font = FONT_BADGE;
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillStyle = isBullDiv ? '#34d399' : '#fb7185';
                            ctx.fillText(divText, x, cursorY);
                        }
                    }
                }
            } catch (err) {
                console.error('Error in FootprintRenderer:', err);
            }
        };

        const requestDraw = () => {
            if (rafIdRef.current !== null) return;
            rafIdRef.current = requestAnimationFrame(() => {
                rafIdRef.current = null;
                drawFootprint();
            });
        };

        requestDraw();

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

        return () => {
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
            resizeObserver?.disconnect();
            chartRoot?.removeEventListener('wheel', requestDraw);
            chartRoot?.removeEventListener('pointermove', handlePointerDrag);
            chartRoot?.removeEventListener('pointerup', requestDraw);
            try {
                timeScale.unsubscribeVisibleLogicalRangeChange(requestDraw);
                timeScale.unsubscribeVisibleTimeRangeChange(requestDraw);
                timeScale.unsubscribeSizeChange(requestDraw);
            } catch {}
        };
    }, [chart, series, data, visible]);

    if (!visible) return null;

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none z-20"
        />
    );
};
