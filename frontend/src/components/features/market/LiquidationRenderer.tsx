import React, { useEffect, useRef, useState } from 'react';
import type {
    IChartApi,
    ISeriesApi,
    ISeriesPrimitive,
    IPrimitivePaneView,
    IPrimitivePaneRenderer,
    SeriesAttachedParameter,
} from 'lightweight-charts';
import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { GodModeState } from '../../../hooks/useGodModeData';
import { getThermalProfile } from '@/utils/deviceProfile';

interface LiquidationRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    data: GodModeState | null;
    symbol?: string;
    showBubbles: boolean;
    intensityScale: number; // 10-100
    useTrailingLiquidity: boolean;
    showTrueCVD: boolean;
    showSpoofing?: boolean;
    showGEX?: boolean;
    showBookmap?: boolean;
    bookmapIntensity?: number;
    spoofingThreshold?: number;
    smartMoneyBias?: boolean;
    candlesRef?: React.MutableRefObject<any[]>;
    candleTimes?: number[];
}

interface BookmapSnapshot {
    time: number; // ms
    depth: { price: number; volume: number }[];
}

interface CrosshairHoverState {
    price: number;
    x: number;
    y: number;
    visible: boolean;
}

function snapToNearestCandleTime(targetSec: number, candleTimes: number[]): number | null {
    if (!candleTimes || candleTimes.length === 0) return targetSec;
    const t = targetSec < 10_000_000_000 ? targetSec : Math.floor(targetSec / 1000);
    if (t <= candleTimes[0]) return candleTimes[0];
    if (t >= candleTimes[candleTimes.length - 1]) return candleTimes[candleTimes.length - 1];

    let lo = 0;
    let hi = candleTimes.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const val = candleTimes[mid];
        if (val === t) return val;
        if (val < t) lo = mid + 1;
        else hi = mid - 1;
    }
    return candleTimes[Math.max(0, hi)];
}

function formatPriceLabel(price: number): string {
    if (!Number.isFinite(price)) return '0';
    if (price < 0.0001) return price.toFixed(8);
    if (price < 0.1) return price.toFixed(5);
    if (price < 1) return price.toFixed(4);
    return price.toFixed(2);
}

class LiquidationPaneRenderer implements IPrimitivePaneRenderer {
    private _primitive: LiquidationPrimitive;

    constructor(primitive: LiquidationPrimitive) {
        this._primitive = primitive;
    }

    draw(target: CanvasRenderingTarget2D): void {
        target.useMediaCoordinateSpace((scope) => {
            this._drawContent(scope.context, scope.mediaSize.width, scope.mediaSize.height);
        });
    }

    private _drawContent(ctx: CanvasRenderingContext2D, W: number, H: number): void {
        const {
            chart,
            series,
            data,
            symbol,
            showBubbles,
            intensityScale,
            useTrailingLiquidity,
            showTrueCVD,
            showSpoofing,
            showGEX,
            showBookmap,
            bookmapIntensity,
            spoofingThreshold,
            smartMoneyBias,
            candlesRef,
            candleTimes,
            bubblesRef,
            icebergsRef,
            bookmapHistoryRef,
            crosshairRef,
        } = this._primitive;

        if (!chart || !series || !data || W <= 0 || H <= 0) return;
        if (symbol && data.symbol && data.symbol.toUpperCase() !== symbol.toUpperCase()) return;

        const timeScale = chart.timeScale();
        if (!timeScale) return;

        const effectiveCandleTimes = this._primitive.getNormalizedCandleTimes(candlesRef, candleTimes);

        const toY = (price: number): number | null => {
            if (!Number.isFinite(price)) return null;
            try {
                return series.priceToCoordinate(price);
            } catch {
                return null;
            }
        };

        const toSnappedX = (timeMsOrSec: number): number | null => {
            if (!Number.isFinite(timeMsOrSec)) return null;
            const sec = timeMsOrSec > 10_000_000_000 ? timeMsOrSec / 1000 : timeMsOrSec;
            const snapped = snapToNearestCandleTime(sec, effectiveCandleTimes);
            if (snapped === null) return null;
            try {
                return timeScale.timeToCoordinate(snapped as any);
            } catch {
                return null;
            }
        };

        const currentPrice = Number(data.current_price) || 0;
        const effectiveIntensityScale = Math.max(10, Math.min(100, Number(intensityScale) || 75));
        const now = Date.now();

        ctx.save();

        // 1. Draw Unified Liquidation Heatmap Bands (Short Liquidations above price = Rose/Red, Long below = Emerald/Green)
        const activeMagnetZones =
            useTrailingLiquidity && data.smoothed_zones && data.smoothed_zones.length > 0
                ? data.smoothed_zones
                : data.magnet_zones || [];

        const mergedByPrice = new Map<
            string,
            { price: number; intensity: number; volume?: number; prob?: number }
        >();

        activeMagnetZones.forEach((z) => {
            const p = Number(z.price);
            const intensity = Number(z.intensity);
            if (!Number.isFinite(p) || !Number.isFinite(intensity) || intensity < 10) return;
            const key = p.toPrecision(8);
            mergedByPrice.set(key, {
                price: p,
                intensity,
                volume: z.volume,
            });
        });

        (data.cascade_probs || []).forEach((z) => {
            const p = Number(z.price);
            const prob = Number(z.prob);
            if (!Number.isFinite(p) || !Number.isFinite(prob)) return;
            const key = p.toPrecision(8);
            const existing = mergedByPrice.get(key);
            if (existing) {
                existing.prob = prob;
                if (!existing.volume && z.volume) existing.volume = z.volume;
            } else {
                mergedByPrice.set(key, {
                    price: p,
                    intensity: prob,
                    volume: z.volume,
                    prob,
                });
            }
        });

        const allZones = Array.from(mergedByPrice.values());
        const drawnTextY: number[] = [];

        allZones.forEach((zone) => {
            const refPrice = currentPrice > 0 ? currentPrice : zone.price;
            const baseThickness = refPrice * 0.001;
            let calculatedThickness = baseThickness;
            if (zone.volume && zone.volume > 0) {
                const volumeScale = Math.min(5, zone.volume / 200000);
                calculatedThickness = baseThickness + baseThickness * volumeScale;
            }

            const yTop = toY(zone.price + calculatedThickness / 2);
            const yBottom = toY(zone.price - calculatedThickness / 2);
            const yCenter = toY(zone.price);

            if (yTop === null || yBottom === null || yCenter === null) return;

            const top = Math.min(yTop, yBottom);
            const rawHeight = Math.abs(yBottom - yTop);
            const height = Math.max(4, Math.min(36, rawHeight));
            const drawTop = rawHeight < 4 ? yCenter - height / 2 : top;

            if (drawTop + height < -40 || drawTop > H + 40) return;

            const alpha = Math.min(0.85, (zone.intensity / 100) * (effectiveIntensityScale / 100));
            const isShortZone = currentPrice > 0 ? zone.price > currentPrice : false;
            const colorBase = isShortZone ? '244, 63, 94' : '16, 185, 129';

            ctx.fillStyle = `rgba(${colorBase}, ${alpha * 0.32})`;
            ctx.fillRect(0, drawTop, W, height);

            // Center dashed laser line
            ctx.beginPath();
            ctx.strokeStyle = `rgba(${colorBase}, ${Math.min(0.9, alpha * 0.75)})`;
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1;
            ctx.moveTo(0, yCenter);
            ctx.lineTo(W, yCenter);
            ctx.stroke();
            ctx.setLineDash([]);

            // Collision-avoided right-edge label
            let textY = yCenter;
            for (let i = 0; i < 10; i++) {
                if (drawnTextY.some((dy) => Math.abs(dy - textY) < 16)) {
                    textY -= 16;
                } else {
                    break;
                }
            }
            if (textY >= 10 && textY <= H - 10) {
                drawnTextY.push(textY);
                ctx.fillStyle = `rgba(${colorBase}, 0.95)`;
                ctx.font = 'bold 11px Inter, sans-serif';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                const formattedPrice = formatPriceLabel(zone.price);
                const probSuffix = zone.prob !== undefined ? ` (${Math.round(zone.prob)}%)` : '';
                const label = isShortZone
                    ? `🔥 SHORT LIQ ${Math.round(zone.intensity)}%${probSuffix} @ ${formattedPrice}`
                    : `🧲 LONG LIQ ${Math.round(zone.intensity)}%${probSuffix} @ ${formattedPrice}`;
                ctx.fillText(label, W - 8, textY);
            }
        });

        // 1.5 Draw Trailing Liquidity Clouds (DTLC)
        if (useTrailingLiquidity && data.trailing_liquidity && currentPrice > 0) {
            const tl = data.trailing_liquidity;

            if (tl.long_level > 0 && currentPrice >= tl.long_level) {
                const yL = toY(tl.long_level);
                if (yL !== null && yL >= -60 && yL <= H + 60) {
                    const cloudHeight = 60;
                    const grad = ctx.createLinearGradient(0, yL - cloudHeight / 2, 0, yL + cloudHeight / 2);
                    grad.addColorStop(0, 'rgba(16,185,129,0)');
                    grad.addColorStop(0.5, `rgba(16,185,129,${Math.min(0.25, Math.max(0.05, tl.long_intensity / 100))})`);
                    grad.addColorStop(1, 'rgba(16,185,129,0)');
                    ctx.fillStyle = grad;
                    ctx.fillRect(0, yL - cloudHeight / 2, W, cloudHeight);

                    ctx.beginPath();
                    ctx.strokeStyle = 'rgba(16, 185, 129, 0.6)';
                    ctx.setLineDash([12, 6]);
                    ctx.lineWidth = 2;
                    ctx.moveTo(0, yL);
                    ctx.lineTo(W, yL);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    ctx.fillStyle = 'rgba(16, 185, 129, 0.85)';
                    ctx.font = 'bold 10px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'alphabetic';
                    ctx.fillText('TRAILING SUPPORT CLOUD', W / 2, yL - 6);
                }
            }

            if (tl.short_level > 0 && currentPrice <= tl.short_level) {
                const yS = toY(tl.short_level);
                if (yS !== null && yS >= -60 && yS <= H + 60) {
                    const cloudHeight = 60;
                    const grad = ctx.createLinearGradient(0, yS - cloudHeight / 2, 0, yS + cloudHeight / 2);
                    grad.addColorStop(0, 'rgba(239,68,68,0)');
                    grad.addColorStop(0.5, `rgba(239,68,68,${Math.min(0.25, Math.max(0.05, tl.short_intensity / 100))})`);
                    grad.addColorStop(1, 'rgba(239,68,68,0)');
                    ctx.fillStyle = grad;
                    ctx.fillRect(0, yS - cloudHeight / 2, W, cloudHeight);

                    ctx.beginPath();
                    ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
                    ctx.setLineDash([12, 6]);
                    ctx.lineWidth = 2;
                    ctx.moveTo(0, yS);
                    ctx.lineTo(W, yS);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    ctx.fillStyle = 'rgba(239, 68, 68, 0.85)';
                    ctx.font = 'bold 10px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'alphabetic';
                    ctx.fillText('TRAILING RESISTANCE CLOUD', W / 2, yS + 12);
                }
            }
        }

        // 1.6 Draw Bookmap Style Multi-Level Depth Anchored to Chart TimeScale
        if (showBookmap && bookmapHistoryRef.current.length > 0 && effectiveCandleTimes.length >= 2) {
            const lastBarTime = effectiveCandleTimes[effectiveCandleTimes.length - 1];
            const prevBarTime = effectiveCandleTimes[effectiveCandleTimes.length - 2];
            const barIntervalSec = Math.max(1, lastBarTime - prevBarTime);

            // Estimate current pixel spacing per bar from visible candles so zoom scales Bookmap 1:1
            let barSpacingPx = 8;
            const xLast = timeScale.timeToCoordinate(lastBarTime as any);
            const xPrev = timeScale.timeToCoordinate(prevBarTime as any);
            if (xLast !== null && xPrev !== null && xLast > xPrev) {
                barSpacingPx = xLast - xPrev;
            } else {
                const logicalRange = timeScale.getVisibleLogicalRange();
                if (logicalRange && logicalRange.to > logicalRange.from) {
                    barSpacingPx = Math.max(2, W / (logicalRange.to - logicalRange.from));
                }
            }

            let maxVol = 1;
            const recentSnapshots = bookmapHistoryRef.current.slice(-15);
            recentSnapshots.forEach((h) => {
                h.depth.forEach((d) => {
                    if (d.volume > maxVol) maxVol = d.volume;
                });
            });

            const intensityMultiplier = (bookmapIntensity || 50) / 50;
            const colWidth = Math.max(3, Math.min(18, barSpacingPx * 0.35));

            bookmapHistoryRef.current.forEach((snapshot) => {
                const snapSec = snapshot.time / 1000;
                const barTime = snapToNearestCandleTime(snapSec, effectiveCandleTimes);
                if (barTime === null) return;

                let barX: number | null = timeScale.timeToCoordinate(barTime as any) as number | null;
                if (barX === null) {
                    if (snapSec > lastBarTime && xLast !== null) {
                        barX = xLast + ((snapSec - lastBarTime) / barIntervalSec) * barSpacingPx;
                    } else {
                        return;
                    }
                }

                const subBarFrac = Math.max(-0.5, Math.min(1.0, (snapSec - barTime) / barIntervalSec));
                const xPos = barX + (subBarFrac - 0.5) * barSpacingPx;

                if (xPos + colWidth < 0 || xPos > W) return;

                snapshot.depth.forEach((level) => {
                    const y = toY(level.price);
                    if (y === null || y < -6 || y > H + 6) return;

                    const normalizedIntensity = Math.min(1.0, (level.volume / maxVol) * intensityMultiplier);
                    if (normalizedIntensity <= 0.08) return;

                    if (normalizedIntensity > 0.8) {
                        ctx.fillStyle = `rgba(239, 68, 68, ${normalizedIntensity * 0.85})`;
                    } else if (normalizedIntensity > 0.5) {
                        ctx.fillStyle = `rgba(249, 115, 22, ${normalizedIntensity * 0.75})`;
                    } else if (normalizedIntensity > 0.2) {
                        ctx.fillStyle = `rgba(234, 179, 8, ${normalizedIntensity * 0.65})`;
                    } else {
                        ctx.fillStyle = `rgba(59, 130, 246, ${normalizedIntensity * 0.45})`;
                    }
                    ctx.fillRect(xPos, y - 2, colWidth, 5);
                });
            });
        }

        // 2. Draw Live Liquidation Bubbles (anchored to snapped candle X & price Y)
        if (showBubbles && bubblesRef.current.length > 0) {
            bubblesRef.current.forEach((bubble) => {
                const x = toSnappedX(bubble.timestamp);
                const y = toY(bubble.price);
                if (x === null || y === null || x < -160 || x > W + 160 || y < -160 || y > H + 160) return;

                const baseRadius = Math.max(8, Math.min(40, (bubble.value / 1000000) * 15));
                const isLongRekt = bubble.type?.toLowerCase().includes('long');

                const ex = bubble.exchange?.toLowerCase();
                const coreColor =
                    ex === 'binance'
                        ? '250, 204, 21'
                        : ex === 'bybit'
                        ? '59, 130, 246'
                        : ex === 'okx'
                        ? '255, 255, 255'
                        : ex === 'bitget'
                        ? '6, 182, 212'
                        : '168, 85, 247';
                const strokeColor = isLongRekt ? '239, 68, 68' : '34, 197, 94';
                const age = now - bubble.createdAt;

                if (age < 2000) {
                    const progress = age / 2000;
                    const rippleRadius = baseRadius + progress * 150;
                    const rippleAlpha = (1 - progress) * 0.6;

                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(${strokeColor}, ${rippleAlpha})`;
                    ctx.lineWidth = Math.max(1, 4 * (1 - progress));
                    ctx.arc(x, y, rippleRadius, 0, 2 * Math.PI);
                    ctx.stroke();

                    if (progress > 0.2) {
                        const prog2 = (age - 400) / 1600;
                        const r2 = baseRadius + prog2 * 100;
                        const alpha2 = (1 - prog2) * 0.5;
                        ctx.beginPath();
                        ctx.strokeStyle = `rgba(${coreColor}, ${alpha2})`;
                        ctx.lineWidth = Math.max(1, 3 * (1 - prog2));
                        ctx.arc(x, y, r2, 0, 2 * Math.PI);
                        ctx.stroke();
                    }
                }

                if (age < 10000) {
                    const footprintAlpha = (1 - age / 10000) * 0.6;
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(${strokeColor}, ${footprintAlpha})`;
                    ctx.setLineDash([4, 4]);
                    ctx.lineWidth = footprintAlpha > 0.3 ? 2 : 1;
                    ctx.moveTo(x, y);
                    ctx.lineTo(W, y);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                const pulse = Math.sin(age / 200) * 2;
                const radius = Math.max(4, baseRadius + pulse);

                ctx.beginPath();
                ctx.fillStyle = `rgba(${coreColor}, 0.3)`;
                ctx.arc(x, y, radius, 0, 2 * Math.PI);
                ctx.fill();

                ctx.beginPath();
                ctx.fillStyle = `rgba(${coreColor}, 0.8)`;
                ctx.arc(x, y, radius * 0.3, 0, 2 * Math.PI);
                ctx.fill();

                ctx.beginPath();
                ctx.strokeStyle = `rgba(${strokeColor}, 1)`;
                ctx.lineWidth = 2;
                ctx.arc(x, y, radius, 0, 2 * Math.PI);
                ctx.stroke();

                ctx.fillStyle = '#fff';
                ctx.font = 'bold 9px Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const valK =
                    bubble.value >= 1000000
                        ? (bubble.value / 1000000).toFixed(1) + 'M'
                        : (bubble.value / 1000).toFixed(0) + 'k';
                ctx.fillText(valK, x, y - radius - 8);
            });
        }

        // 2.5 Draw Options GEX Walls
        if (showGEX && data.gex_data) {
            const { call_wall, put_wall } = data.gex_data;

            if (Number.isFinite(call_wall) && call_wall > 0) {
                const callY = toY(call_wall);
                if (callY !== null && callY >= -20 && callY <= H + 20) {
                    ctx.beginPath();
                    ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
                    ctx.lineWidth = 2;
                    ctx.moveTo(0, callY);
                    ctx.lineTo(W, callY);
                    ctx.stroke();

                    ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
                    ctx.font = 'bold 11px Inter, sans-serif';
                    ctx.textAlign = 'right';
                    ctx.textBaseline = 'alphabetic';
                    ctx.fillText(`🔥 Call Wall: $${call_wall}`, W - 8, callY - 6);
                }
            }

            if (Number.isFinite(put_wall) && put_wall > 0) {
                const putY = toY(put_wall);
                if (putY !== null && putY >= -20 && putY <= H + 20) {
                    ctx.beginPath();
                    ctx.strokeStyle = 'rgba(16, 185, 129, 0.6)';
                    ctx.lineWidth = 2;
                    ctx.moveTo(0, putY);
                    ctx.lineTo(W, putY);
                    ctx.stroke();

                    ctx.fillStyle = 'rgba(16, 185, 129, 0.9)';
                    ctx.font = 'bold 11px Inter, sans-serif';
                    ctx.textAlign = 'right';
                    ctx.textBaseline = 'alphabetic';
                    ctx.fillText(`🛡️ Put Wall: $${put_wall}`, W - 8, putY + 14);
                }
            }
        }

        // 2.6 Draw True CVD & Iceberg Events
        if (showTrueCVD && icebergsRef.current.length > 0) {
            icebergsRef.current.forEach((iceberg) => {
                const x = toSnappedX(iceberg.timestamp);
                const y = toY(iceberg.price);
                if (x === null || y === null || x < -40 || x > W + 40 || y < -40 || y > H + 40) return;

                const isBullish = iceberg.type === 'BULLISH_ABSORPTION';
                const glowColor = '168, 85, 247';
                const textColor = isBullish ? '#22c55e' : '#ef4444';

                const age = now - iceberg.createdAt;
                const alpha = Math.max(0, 1 - age / 15000);

                ctx.beginPath();
                ctx.fillStyle = `rgba(${glowColor}, ${alpha * 0.4})`;
                ctx.arc(x, y, 25, 0, 2 * Math.PI);
                ctx.fill();

                ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                ctx.font = '16px Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('🛡️', x, y);

                ctx.fillStyle = textColor;
                ctx.font = 'bold 10px Inter, sans-serif';
                const volK =
                    iceberg.absorbed_volume >= 1000000
                        ? (iceberg.absorbed_volume / 1000000).toFixed(1) + 'M'
                        : (iceberg.absorbed_volume / 1000).toFixed(0) + 'k';
                ctx.fillText(`${volK} Absorbed`, x, y - 20);
            });
        }

        // 2.7 Draw Spoofed Zones (Ghost Orders)
        if (showSpoofing && data.spoofed_zones && data.spoofed_zones.length > 0) {
            data.spoofed_zones.forEach((zone) => {
                if (zone.volume < spoofingThreshold) return;
                const age = now - zone.timestamp * 1000;
                if (age >= 120000) return;

                const y = toY(zone.price);
                if (y === null || y < -20 || y > H + 20) return;

                const alpha = Math.max(0, 1 - age / 120000);
                ctx.beginPath();
                ctx.strokeStyle = `rgba(156, 163, 175, ${alpha * 0.8})`;
                ctx.setLineDash([10, 5, 2, 5]);
                ctx.lineWidth = 1.5;
                ctx.moveTo(0, y);
                ctx.lineTo(W, y);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.fillStyle = `rgba(156, 163, 175, ${alpha})`;
                ctx.font = 'italic bold 10px Inter, sans-serif';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'alphabetic';
                const volM =
                    zone.volume >= 1000000
                        ? (zone.volume / 1000000).toFixed(1) + 'M'
                        : (zone.volume / 1000).toFixed(0) + 'k';
                ctx.fillText(`👻 SPOOFED $${volM}`, W - 8, y - 6);
            });
        }

        // 3. Draw Interactive Tooltip for hovered zone (clamped inside pane)
        if (crosshairRef.current.visible && currentPrice > 0) {
            const hoveredZone = allZones.find(
                (z) => Math.abs(z.price - crosshairRef.current.price) < currentPrice * 0.003
            );
            if (hoveredZone) {
                const boxW = 122;
                const boxH = 50;
                const ttX = Math.max(8, Math.min(W - boxW - 8, crosshairRef.current.x + 15));
                const ttY = Math.max(boxH + 8, Math.min(H - 8, crosshairRef.current.y - 10));
                const isShortZone = hoveredZone.price > currentPrice;

                ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
                ctx.strokeStyle = isShortZone ? 'rgba(244, 63, 94, 0.6)' : 'rgba(16, 185, 129, 0.6)';
                ctx.lineWidth = 1;

                const volText = hoveredZone.volume
                    ? `Vol: $${(hoveredZone.volume / 1000).toFixed(1)}k`
                    : `Int: ${Math.round(hoveredZone.intensity)}%`;
                const typeText = isShortZone ? 'Short Liq. Zone' : 'Long Liq. Zone';

                const distancePct = Math.abs(currentPrice - hoveredZone.price) / currentPrice;
                let levText = 'Est. Lev: ';
                if (distancePct <= 0.015) levText += '100x';
                else if (distancePct <= 0.03) levText += '50x';
                else if (distancePct <= 0.055) levText += '20x-25x';
                else if (distancePct <= 0.11) levText += '10x';
                else levText += '<10x';

                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') {
                    ctx.roundRect(ttX, ttY - boxH, boxW, boxH, 4);
                } else {
                    ctx.rect(ttX, ttY - boxH, boxW, boxH);
                }
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = '#fff';
                ctx.font = 'bold 10px Inter, sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
                ctx.fillText(typeText, ttX + 7, ttY - 34);

                ctx.fillStyle = 'rgba(148, 163, 184, 1)';
                ctx.font = '9px Inter, sans-serif';
                ctx.fillText(volText, ttX + 7, ttY - 20);

                ctx.fillStyle = 'rgba(251, 191, 36, 1)';
                ctx.fillText(levText, ttX + 7, ttY - 7);
            }
        }

        // 4. Draw AI Trajectory Arrow
        const activeTrajectory = smartMoneyBias ? data.smart_trajectory : data.ai_trajectory;
        if (activeTrajectory && activeTrajectory.direction !== 'NEUTRAL' && currentPrice > 0 && activeTrajectory.target_price > 0) {
            const currentY = toY(currentPrice);
            const targetY = toY(activeTrajectory.target_price);

            if (currentY !== null && targetY !== null) {
                const isUp = activeTrajectory.direction === 'UP';
                const color = isUp ? '34, 197, 94' : '239, 68, 68';
                const startX = W * 0.85;
                const endX = W * 0.85;

                ctx.beginPath();
                ctx.strokeStyle = `rgba(${color}, 0.85)`;
                ctx.shadowColor = `rgba(${color}, 1)`;
                ctx.shadowBlur = 10;
                ctx.lineWidth = 2 + activeTrajectory.strength / 25;
                ctx.setLineDash([5, 5]);
                ctx.moveTo(startX, currentY);
                ctx.lineTo(endX, targetY);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.shadowBlur = 0;

                ctx.beginPath();
                ctx.fillStyle = `rgba(${color}, 1)`;
                const headSize = 8;
                if (isUp) {
                    ctx.moveTo(endX, targetY);
                    ctx.lineTo(endX - headSize, targetY + headSize);
                    ctx.lineTo(endX + headSize, targetY + headSize);
                } else {
                    ctx.moveTo(endX, targetY);
                    ctx.lineTo(endX - headSize, targetY - headSize);
                    ctx.lineTo(endX + headSize, targetY - headSize);
                }
                ctx.fill();

                ctx.fillStyle = `rgba(${color}, 1)`;
                ctx.font = 'bold 9px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'alphabetic';
                const lblY = isUp ? targetY - 12 : targetY + 18;
                ctx.fillText('ALGO TARGET', endX, lblY);
            }
        }

        ctx.restore();
    }
}

class LiquidationPaneView implements IPrimitivePaneView {
    private _renderer: LiquidationPaneRenderer;

    constructor(primitive: LiquidationPrimitive) {
        this._renderer = new LiquidationPaneRenderer(primitive);
    }

    zOrder(): 'bottom' {
        return 'bottom';
    }

    renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

class LiquidationPrimitive implements ISeriesPrimitive<any> {
    public chart: IChartApi | null = null;
    public series: ISeriesApi<'Candlestick'> | null = null;
    public data: GodModeState | null = null;
    public symbol?: string;
    public showBubbles = true;
    public intensityScale = 75;
    public useTrailingLiquidity = true;
    public showTrueCVD = false;
    public showSpoofing = true;
    public showGEX = true;
    public showBookmap = true;
    public bookmapIntensity = 50;
    public spoofingThreshold = 500000;
    public smartMoneyBias = false;
    public candlesRef?: React.MutableRefObject<any[]>;
    public candleTimes?: number[];
    public bubblesRef: React.MutableRefObject<any[]>;
    public icebergsRef: React.MutableRefObject<any[]>;
    public bookmapHistoryRef: React.MutableRefObject<BookmapSnapshot[]>;
    public crosshairRef: React.MutableRefObject<CrosshairHoverState>;

    private _requestUpdate?: () => void;
    private _paneViews: LiquidationPaneView[];
    private _cachedCandlesSource: any[] | null = null;
    private _cachedCandlesLen = -1;
    private _cachedLastCandleTime = -1;
    private _cachedNormalizedTimes: number[] = [];

    constructor(
        bubblesRef: React.MutableRefObject<any[]>,
        icebergsRef: React.MutableRefObject<any[]>,
        bookmapHistoryRef: React.MutableRefObject<BookmapSnapshot[]>,
        crosshairRef: React.MutableRefObject<CrosshairHoverState>
    ) {
        this.bubblesRef = bubblesRef;
        this.icebergsRef = icebergsRef;
        this.bookmapHistoryRef = bookmapHistoryRef;
        this.crosshairRef = crosshairRef;
        this._paneViews = [new LiquidationPaneView(this)];
    }

    getNormalizedCandleTimes(
        candlesRef?: React.MutableRefObject<any[]>,
        candleTimes?: number[]
    ): number[] {
        const rawArr = candlesRef?.current && candlesRef.current.length > 0 ? candlesRef.current : null;
        if (rawArr) {
            const len = rawArr.length;
            const lastTime = Number(rawArr[len - 1]?.time ?? -1);
            if (
                this._cachedCandlesSource === rawArr &&
                this._cachedCandlesLen === len &&
                this._cachedLastCandleTime === lastTime
            ) {
                return this._cachedNormalizedTimes;
            }
            const normalized: number[] = [];
            for (let i = 0; i < len; i++) {
                const t = Number(rawArr[i]?.time);
                if (Number.isFinite(t)) {
                    normalized.push(t < 10_000_000_000 ? t : Math.floor(t / 1000));
                }
            }
            this._cachedCandlesSource = rawArr;
            this._cachedCandlesLen = len;
            this._cachedLastCandleTime = lastTime;
            this._cachedNormalizedTimes = normalized;
            return normalized;
        }

        if (candleTimes && candleTimes.length > 0) {
            const len = candleTimes.length;
            const lastTime = Number(candleTimes[len - 1] ?? -1);
            if (
                this._cachedCandlesSource === candleTimes &&
                this._cachedCandlesLen === len &&
                this._cachedLastCandleTime === lastTime
            ) {
                return this._cachedNormalizedTimes;
            }
            const normalized = candleTimes
                .map((t) => Number(t))
                .filter((t) => Number.isFinite(t))
                .map((t) => (t < 10_000_000_000 ? t : Math.floor(t / 1000)));
            this._cachedCandlesSource = candleTimes;
            this._cachedCandlesLen = len;
            this._cachedLastCandleTime = lastTime;
            this._cachedNormalizedTimes = normalized;
            return normalized;
        }

        return [];
    }

    attached(param: SeriesAttachedParameter<any, any>): void {
        this.chart = param.chart as unknown as IChartApi;
        this.series = param.series as unknown as ISeriesApi<'Candlestick'>;
        this._requestUpdate = param.requestUpdate;
        this.requestUpdate();
    }

    detached(): void {
        this.chart = null;
        this.series = null;
        this._requestUpdate = undefined;
    }

    updateParams(params: {
        data: GodModeState | null;
        symbol?: string;
        showBubbles: boolean;
        intensityScale: number;
        useTrailingLiquidity: boolean;
        showTrueCVD: boolean;
        showSpoofing: boolean;
        showGEX: boolean;
        showBookmap: boolean;
        bookmapIntensity: number;
        spoofingThreshold: number;
        smartMoneyBias: boolean;
        candlesRef?: React.MutableRefObject<any[]>;
        candleTimes?: number[];
    }): void {
        this.data = params.data;
        this.symbol = params.symbol;
        this.showBubbles = params.showBubbles;
        this.intensityScale = params.intensityScale;
        this.useTrailingLiquidity = params.useTrailingLiquidity;
        this.showTrueCVD = params.showTrueCVD;
        this.showSpoofing = params.showSpoofing;
        this.showGEX = params.showGEX;
        this.showBookmap = params.showBookmap;
        this.bookmapIntensity = params.bookmapIntensity;
        this.spoofingThreshold = params.spoofingThreshold;
        this.smartMoneyBias = params.smartMoneyBias;
        this.candlesRef = params.candlesRef;
        this.candleTimes = params.candleTimes;
        this.requestUpdate();
    }

    requestUpdate(): void {
        this._requestUpdate?.();
    }

    updateAllViews(): void {}

    paneViews(): readonly IPrimitivePaneView[] {
        return this._paneViews;
    }
}

export const LiquidationRenderer: React.FC<LiquidationRendererProps> = ({
    chart,
    series,
    data,
    symbol,
    showBubbles,
    intensityScale,
    useTrailingLiquidity,
    showTrueCVD,
    showSpoofing = true,
    showGEX = true,
    showBookmap = true,
    bookmapIntensity = 50,
    spoofingThreshold = 500000,
    smartMoneyBias = false,
    candlesRef,
    candleTimes,
}) => {
    const primitiveRef = useRef<LiquidationPrimitive | null>(null);
    const animRafIdRef = useRef<number | null>(null);
    const scheduleAnimationRef = useRef<() => void>(() => {});
    const lastSymbolRef = useRef<string | null>(null);

    const showBubblesRef = useRef(showBubbles);
    showBubblesRef.current = showBubbles;
    const showTrueCVDRef = useRef(showTrueCVD);
    showTrueCVDRef.current = showTrueCVD;

    const bookmapHistoryRef = useRef<BookmapSnapshot[]>([]);
    const bubblesRef = useRef<any[]>([]);
    const icebergsRef = useRef<any[]>([]);
    const crosshairRef = useRef<CrosshairHoverState>({ price: 0, x: 0, y: 0, visible: false });
    const [activeIcebergsCount, setActiveIcebergsCount] = useState(0);

    // Attach ISeriesPrimitive to candlestick series so all pan/zoom/scale redraws happen in the exact same canvas frame
    useEffect(() => {
        if (!chart || !series) return;

        const primitive = new LiquidationPrimitive(
            bubblesRef,
            icebergsRef,
            bookmapHistoryRef,
            crosshairRef
        );
        primitiveRef.current = primitive;
        series.attachPrimitive(primitive);

        primitive.updateParams({
            data,
            symbol,
            showBubbles,
            intensityScale,
            useTrailingLiquidity,
            showTrueCVD,
            showSpoofing,
            showGEX,
            showBookmap,
            bookmapIntensity,
            spoofingThreshold,
            smartMoneyBias,
            candlesRef,
            candleTimes,
        });

        let lastFrameTime = 0;

        const hasActiveAnimations = () => {
            if (typeof document !== 'undefined' && document.hidden) return false;
            return (
                (showBubblesRef.current && bubblesRef.current.length > 0) ||
                (showTrueCVDRef.current && icebergsRef.current.length > 0)
            );
        };

        const animate = (timestamp: number) => {
            if (!hasActiveAnimations()) {
                animRafIdRef.current = null;
                return;
            }
            const fpsInterval = 1000 / getThermalProfile().timings.liquidationFps;
            if (timestamp - lastFrameTime >= fpsInterval) {
                lastFrameTime = timestamp;
                const now = Date.now();
                bubblesRef.current = bubblesRef.current.filter((b) => now - b.createdAt < 60000);
                icebergsRef.current = icebergsRef.current.filter((b) => now - b.createdAt < 15000);
                primitive.requestUpdate();
            }
            if (hasActiveAnimations()) {
                animRafIdRef.current = requestAnimationFrame(animate);
            } else {
                animRafIdRef.current = null;
            }
        };

        const scheduleAnimation = () => {
            if (animRafIdRef.current !== null) return;
            if (!hasActiveAnimations()) return;
            animRafIdRef.current = requestAnimationFrame(animate);
        };

        scheduleAnimationRef.current = scheduleAnimation;
        scheduleAnimation();

        const crosshairHandler = (param: any) => {
            if (!param.point || !param.time) {
                if (crosshairRef.current.visible) {
                    crosshairRef.current.visible = false;
                    primitive.requestUpdate();
                }
            } else {
                crosshairRef.current = {
                    price: Number(series.coordinateToPrice(param.point.y)) || 0,
                    x: param.point.x,
                    y: param.point.y,
                    visible: true,
                };
                primitive.requestUpdate();
            }
        };

        const handleVisibilityChange = () => {
            if (typeof document !== 'undefined' && !document.hidden) {
                primitive.requestUpdate();
                scheduleAnimation();
            }
        };

        chart.subscribeCrosshairMove(crosshairHandler);
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibilityChange);
        }

        return () => {
            scheduleAnimationRef.current = () => {};
            chart.unsubscribeCrosshairMove(crosshairHandler);
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityChange);
            }
            if (animRafIdRef.current !== null) {
                cancelAnimationFrame(animRafIdRef.current);
                animRafIdRef.current = null;
            }
            try {
                series.detachPrimitive(primitive);
            } catch {
                // Ignore if chart/series already disposed
            }
            primitiveRef.current = null;
        };
    }, [chart, series]);

    // Ingest new WebSocket snapshots (bubbles, icebergs, Bookmap history) only when data updates
    useEffect(() => {
        if (!data) {
            bookmapHistoryRef.current = [];
            bubblesRef.current = [];
            icebergsRef.current = [];
            setActiveIcebergsCount(0);
            return;
        }

        if (data.symbol && lastSymbolRef.current && lastSymbolRef.current !== data.symbol) {
            bookmapHistoryRef.current = [];
            bubblesRef.current = [];
            icebergsRef.current = [];
            setActiveIcebergsCount(0);
        }
        if (data.symbol) {
            lastSymbolRef.current = data.symbol;
        }

        const now = Date.now();

        if (showBookmap && data.orderbook_depth && data.orderbook_depth.length > 0) {
            const lastSnapshot = bookmapHistoryRef.current[bookmapHistoryRef.current.length - 1];
            if (!lastSnapshot || now - lastSnapshot.time >= 250) {
                bookmapHistoryRef.current.push({
                    time: now,
                    depth: data.orderbook_depth.map((d) => ({ price: d.price, volume: d.volume })),
                });
                if (bookmapHistoryRef.current.length > 500) {
                    bookmapHistoryRef.current = bookmapHistoryRef.current.slice(-480);
                }
            }
        }

        if (showBubbles && data.whale_feed) {
            data.whale_feed.forEach((wf) => {
                if (wf.price && wf.timestamp) {
                    const existing = bubblesRef.current.find(
                        (b) => b.timestamp === wf.timestamp && b.price === wf.price
                    );
                    if (!existing) {
                        bubblesRef.current.push({ ...wf, createdAt: now });
                    }
                }
            });
            bubblesRef.current = bubblesRef.current.filter((b) => now - b.createdAt < 60000);
        }

        if (showTrueCVD && data.iceberg_events) {
            data.iceberg_events.forEach((ev) => {
                if (ev.price && ev.timestamp) {
                    const existing = icebergsRef.current.find(
                        (b) => b.timestamp === ev.timestamp && b.price === ev.price
                    );
                    if (!existing) {
                        icebergsRef.current.push({ ...ev, createdAt: now });
                    }
                }
            });
            icebergsRef.current = icebergsRef.current.filter((b) => now - b.createdAt < 15000);
            setActiveIcebergsCount(icebergsRef.current.length);
        } else {
            setActiveIcebergsCount(0);
        }
    }, [data, showBubbles, showTrueCVD, showBookmap]);

    // Clear local animation buffers immediately when symbol changes
    useEffect(() => {
        if (symbol && lastSymbolRef.current && lastSymbolRef.current !== symbol) {
            bookmapHistoryRef.current = [];
            bubblesRef.current = [];
            icebergsRef.current = [];
            setActiveIcebergsCount(0);
        }
        if (symbol) {
            lastSymbolRef.current = symbol;
        }
    }, [symbol]);

    // Sync primitive params & trigger synchronous chart repaint on prop/data changes
    useEffect(() => {
        if (!primitiveRef.current) return;
        primitiveRef.current.updateParams({
            data,
            symbol,
            showBubbles,
            intensityScale,
            useTrailingLiquidity,
            showTrueCVD,
            showSpoofing,
            showGEX,
            showBookmap,
            bookmapIntensity,
            spoofingThreshold,
            smartMoneyBias,
            candlesRef,
            candleTimes,
        });
        scheduleAnimationRef.current();
    }, [
        data,
        symbol,
        showBubbles,
        intensityScale,
        useTrailingLiquidity,
        showTrueCVD,
        showSpoofing,
        showGEX,
        showBookmap,
        bookmapIntensity,
        spoofingThreshold,
        smartMoneyBias,
        candlesRef,
        candleTimes,
    ]);

    return (
        <>
            {showTrueCVD && data && data.true_cvd !== undefined && (
                <TrueCVDDraggableHUD data={data} icebergsCount={activeIcebergsCount} />
            )}
        </>
    );
};

interface TrueCVDDraggableHUDProps {
    data: GodModeState;
    icebergsCount?: number;
}

export const TrueCVDDraggableHUD: React.FC<TrueCVDDraggableHUDProps> = ({ data, icebergsCount = 0 }) => {
    const [position, setPosition] = useState<{ x: number; y: number }>(() => {
        try {
            const saved = localStorage.getItem('true_cvd_hud_pos');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
                    return parsed;
                }
            }
        } catch {}
        return { x: 0, y: 0 };
    });

    const [isDragging, setIsDragging] = useState(false);
    const dragRef = useRef<{ startX: number; startY: number; initX: number; initY: number } | null>(null);

    const onPointerDown = (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        setIsDragging(true);
        dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            initX: position.x,
            initY: position.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!isDragging || !dragRef.current) return;
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        setPosition({
            x: dragRef.current.initX + dx,
            y: dragRef.current.initY + dy,
        });
    };

    const onPointerUp = (e: React.PointerEvent) => {
        if (isDragging && dragRef.current) {
            const dx = e.clientX - dragRef.current.startX;
            const dy = e.clientY - dragRef.current.startY;
            const finalPos = {
                x: dragRef.current.initX + dx,
                y: dragRef.current.initY + dy,
            };
            try {
                localStorage.setItem('true_cvd_hud_pos', JSON.stringify(finalPos));
            } catch {}
        }
        setIsDragging(false);
        dragRef.current = null;
        try {
            e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {}
    };

    const resetPosition = (e: React.MouseEvent) => {
        e.stopPropagation();
        setPosition({ x: 0, y: 0 });
        try {
            localStorage.removeItem('true_cvd_hud_pos');
        } catch {}
    };

    const cvd = data.true_cvd ?? 0;
    const cvdColor = cvd > 0 ? 'text-emerald-400' : cvd < 0 ? 'text-rose-400' : 'text-slate-200';
    const cvdVal =
        Math.abs(cvd) >= 1000000
            ? (cvd / 1000000).toFixed(2) + 'M'
            : (cvd / 1000).toFixed(0) + 'k';
    const activeWalls = icebergsCount || data.iceberg_events?.length || 0;

    return (
        <div
            className={`absolute z-[25] pointer-events-auto select-none transition-all ${
                isDragging
                    ? 'cursor-grabbing scale-105 shadow-[0_0_25px_rgba(168,85,247,0.5)]'
                    : 'cursor-grab hover:shadow-[0_0_15px_rgba(168,85,247,0.25)]'
            }`}
            style={{
                left: '16px',
                bottom: '20px',
                transform: `translate(${position.x}px, ${position.y}px)`,
                touchAction: 'none',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={resetPosition}
            title="Drag with mouse to reposition anywhere • Double-click to reset to bottom-left"
        >
            <div className="flex items-center gap-2.5 bg-white/90 dark:bg-slate-950/90 backdrop-blur-md border border-purple-500/40 hover:border-purple-400/80 rounded-lg px-3 py-2 shadow-xl dark:shadow-2xl transition-colors">
                <div className="flex flex-col gap-0.5 opacity-40 hover:opacity-80 transition-opacity">
                    <div className="flex gap-0.5">
                        <span className="w-1 h-1 bg-purple-400 rounded-full" />
                        <span className="w-1 h-1 bg-purple-400 rounded-full" />
                    </div>
                    <div className="flex gap-0.5">
                        <span className="w-1 h-1 bg-purple-400 rounded-full" />
                        <span className="w-1 h-1 bg-purple-400 rounded-full" />
                    </div>
                    <div className="flex gap-0.5">
                        <span className="w-1 h-1 bg-purple-400 rounded-full" />
                        <span className="w-1 h-1 bg-purple-400 rounded-full" />
                    </div>
                </div>

                <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs leading-none">🛡️</span>
                        <span className="text-[10px] font-bold tracking-wider text-purple-700 dark:text-purple-300 uppercase font-mono leading-none">
                            TRUE CVD (60s)
                        </span>
                    </div>
                    <div className="flex items-baseline gap-2 mt-1">
                        <span className={`text-sm font-black font-mono tracking-tight leading-none ${cvdColor}`}>
                            {cvd > 0 ? '+' : ''}
                            {cvdVal}
                        </span>
                    </div>
                </div>

                {activeWalls > 0 && (
                    <div className="flex items-center gap-1 bg-purple-500/20 border border-purple-500/40 rounded px-1.5 py-0.5 ml-1 animate-pulse">
                        <span className="text-[10px] leading-none">🧊</span>
                        <span className="text-[9px] font-bold text-purple-300 font-mono whitespace-nowrap leading-none">
                            {activeWalls} Wall
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};
