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
import { getThermalProfile, isThermalGuardActive, subscribeThermalProfile } from '@/utils/deviceProfile';

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
    showMagnetZones?: boolean;
    showLeveragePools?: boolean;
    showTrajectory?: boolean;
    isDark?: boolean;
    onZoneClick?: (price: number) => void;
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

interface MergedZone {
    price: number;
    intensity: number;
    volume?: number;
    prob?: number;
    leverage?: string;
    estimatedUsd?: number;
    kind: 'magnet' | 'pool';
    side?: 'SHORT_LIQ' | 'LONG_LIQ';
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

function formatCompactUsd(val: number): string {
    if (!Number.isFinite(val) || val <= 0) return '$0';
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}k`;
    return `$${val.toFixed(0)}`;
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
            showMagnetZones,
            showLeveragePools,
            showTrajectory,
            isDark,
            hasZoneClickHandler,
            isThermalGuard,
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

        const allInteractiveZones: MergedZone[] = [];
        const drawnTextY: number[] = [];

        // 1. Draw L2 Orderbook Magnet & Cascade Zones
        if (showMagnetZones) {
            const activeMagnetZones =
                useTrailingLiquidity && data.smoothed_zones && data.smoothed_zones.length > 0
                    ? data.smoothed_zones
                    : data.magnet_zones || [];

            const mergedByPrice = new Map<string, MergedZone>();

            activeMagnetZones.forEach((z) => {
                const p = Number(z.price);
                const intensity = Number(z.intensity);
                if (!Number.isFinite(p) || !Number.isFinite(intensity) || intensity < 10) return;
                const key = p.toPrecision(8);
                mergedByPrice.set(key, {
                    price: p,
                    intensity,
                    volume: z.volume,
                    kind: 'magnet',
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
                        kind: 'magnet',
                    });
                }
            });

            const magnetList = Array.from(mergedByPrice.values());
            allInteractiveZones.push(...magnetList);

            magnetList.forEach((zone) => {
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

                ctx.fillStyle = `rgba(${colorBase}, ${alpha * 0.30})`;
                ctx.fillRect(0, drawTop, W, height);

                ctx.beginPath();
                ctx.strokeStyle = `rgba(${colorBase}, ${Math.min(0.9, alpha * 0.75)})`;
                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 1;
                ctx.moveTo(0, yCenter);
                ctx.lineTo(W, yCenter);
                ctx.stroke();
                ctx.setLineDash([]);

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
                    ctx.fillStyle = isDark
                        ? `rgba(${colorBase}, 0.95)`
                        : isShortZone
                        ? 'rgba(190, 18, 60, 0.95)'
                        : 'rgba(4, 120, 87, 0.95)';
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
        }

        // 1.25 Draw Estimated Leveraged Liquidation Pools (10x / 25x / 50x / 100x)
        if (showLeveragePools && data.liquidation_pools && data.liquidation_pools.length > 0) {
            data.liquidation_pools.forEach((pool) => {
                const p = Number(pool.price);
                const intensity = Number(pool.intensity);
                if (!Number.isFinite(p) || !Number.isFinite(intensity) || intensity < 15) return;

                allInteractiveZones.push({
                    price: p,
                    intensity,
                    leverage: pool.leverage,
                    estimatedUsd: pool.estimated_usd,
                    kind: 'pool',
                    side: pool.side,
                });

                const yCenter = toY(p);
                if (yCenter === null || yCenter < -30 || yCenter > H + 30) return;

                const isShortPool = pool.side === 'SHORT_LIQ' || (currentPrice > 0 && p > currentPrice);
                const barHeight = Math.max(3, Math.min(12, (intensity / 100) * 12));
                const alpha = Math.min(0.65, (intensity / 100) * (effectiveIntensityScale / 100) * 0.55);
                const rgb = isShortPool ? '245, 158, 11' : '6, 182, 212'; // Amber for Short Liq Pools, Cyan for Long Liq Pools

                const grad = ctx.createLinearGradient(0, 0, W, 0);
                grad.addColorStop(0, `rgba(${rgb}, ${alpha * 0.15})`);
                grad.addColorStop(0.65, `rgba(${rgb}, ${alpha * 0.35})`);
                grad.addColorStop(1, `rgba(${rgb}, ${alpha * 0.75})`);
                ctx.fillStyle = grad;
                ctx.fillRect(0, yCenter - barHeight / 2, W, barHeight);

                let textY = yCenter;
                for (let i = 0; i < 10; i++) {
                    if (drawnTextY.some((dy) => Math.abs(dy - textY) < 15)) {
                        textY -= 15;
                    } else {
                        break;
                    }
                }
                if (textY >= 10 && textY <= H - 10) {
                    drawnTextY.push(textY);
                    ctx.fillStyle = isDark
                        ? `rgba(${rgb}, 0.95)`
                        : isShortPool
                        ? 'rgba(180, 83, 9, 0.95)'
                        : 'rgba(14, 116, 144, 0.95)';
                    ctx.font = 'bold 10px Inter, sans-serif';
                    ctx.textAlign = 'right';
                    ctx.textBaseline = 'middle';
                    const usdTag = pool.estimated_usd ? ` ${formatCompactUsd(pool.estimated_usd)}` : '';
                    ctx.fillText(
                        `⚡ ${pool.leverage} POOL${usdTag} @ ${formatPriceLabel(p)}`,
                        W - 8,
                        textY
                    );
                }
            });
        }

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

                    ctx.fillStyle = isDark ? 'rgba(16, 185, 129, 0.85)' : 'rgba(4, 120, 87, 0.9)';
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

                    ctx.fillStyle = isDark ? 'rgba(239, 68, 68, 0.85)' : 'rgba(185, 28, 28, 0.9)';
                    ctx.font = 'bold 10px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'alphabetic';
                    ctx.fillText('TRAILING RESISTANCE CLOUD', W / 2, yS + 12);
                }
            }
        }

        // 1.6 Draw Bookmap Style Continuous Clouds & Liquidity Lines (Anchored to Latest Candle + Zoom)
        if (showBookmap && bookmapHistoryRef.current.length > 0 && effectiveCandleTimes.length >= 2) {
            const snapshots = bookmapHistoryRef.current;
            const lastIdx = effectiveCandleTimes.length - 1;
            const lastBarTime = effectiveCandleTimes[lastIdx];
            const prevBarTime = effectiveCandleTimes[lastIdx - 1];

            let anchorX: number | null =
                typeof (timeScale as any).logicalToCoordinate === 'function'
                    ? ((timeScale as any).logicalToCoordinate(lastIdx) as number | null)
                    : (timeScale.timeToCoordinate(lastBarTime as any) as number | null);

            if (anchorX === null) {
                anchorX = timeScale.timeToCoordinate(lastBarTime as any) as number | null;
            }

            if (anchorX !== null) {
                let barSpacingPx = 8;
                const xLast = timeScale.timeToCoordinate(lastBarTime as any) as number | null;
                const xPrev = timeScale.timeToCoordinate(prevBarTime as any) as number | null;
                if (xLast !== null && xPrev !== null && xLast > xPrev) {
                    barSpacingPx = xLast - xPrev;
                } else {
                    const logicalRange = timeScale.getVisibleLogicalRange();
                    if (logicalRange && logicalRange.to > logicalRange.from) {
                        barSpacingPx = Math.max(2, W / (logicalRange.to - logicalRange.from));
                    }
                }

                // Scale horizontal time-flow speed with chart zoom while keeping snapshots anchored to anchorX
                const zoomFactor = Math.max(0.5, Math.min(2.5, barSpacingPx / 10));
                const pxPerSec = 14 * zoomFactor;
                const newestTimeMs = snapshots[snapshots.length - 1].time;

                let maxVol = 1;
                const recentSnapshots = snapshots.slice(-15);
                recentSnapshots.forEach((h) => {
                    h.depth.forEach((d) => {
                        if (d.volume > maxVol) maxVol = d.volume;
                    });
                });

                // Match BookmapHeatmapService bucket size (0.05 / 50 = 0.1% of price) so levels blend smoothly
                const refPrice = currentPrice > 0 ? currentPrice : 1;
                const yRef1 = toY(refPrice);
                const yRef2 = toY(refPrice * 1.001);
                const bandHeight =
                    yRef1 !== null && yRef2 !== null
                        ? Math.max(2, Math.min(9, Math.abs(yRef2 - yRef1) * 0.95))
                        : 3.5;

                const intensityMultiplier = (bookmapIntensity || 50) / 50;
                const minCellThreshold = isThermalGuard ? 0.14 : 0.08;

                // Pre-compute continuous edge-to-edge X bounds for every snapshot
                const xPositions = snapshots.map(
                    (s) => anchorX! - ((newestTimeMs - s.time) / 1000) * pxPerSec
                );

                for (let i = 0; i < snapshots.length; i++) {
                    const xStart = xPositions[i];
                    const xEnd =
                        i < snapshots.length - 1
                            ? xPositions[i + 1]
                            : Math.min(W, anchorX + Math.max(36, barSpacingPx * 2.5));

                    if (xEnd < 0 || xStart > W) continue;
                    const stripWidth = Math.max(1.5, xEnd - xStart + 0.6);
                    const distFromAnchor = Math.max(0, anchorX - xStart);
                    const ageFade = Math.max(0.2, 1 - distFromAnchor / Math.max(250, W * 0.95));

                    const depth = snapshots[i].depth;
                    for (let j = 0; j < depth.length; j++) {
                        const level = depth[j];
                        const y = toY(level.price);
                        if (y === null || y < -8 || y > H + 8) continue;

                        const normalizedIntensity = Math.min(1.0, (level.volume / maxVol) * intensityMultiplier);
                        if (normalizedIntensity <= minCellThreshold) continue;

                        let rgb = '59, 130, 246'; // Blue (light resting liquidity)
                        if (normalizedIntensity > 0.8) {
                            rgb = '239, 68, 68'; // Red (heavy whale wall)
                        } else if (normalizedIntensity > 0.5) {
                            rgb = '249, 115, 22'; // Orange
                        } else if (normalizedIntensity > 0.22) {
                            rgb = '234, 179, 8'; // Amber/Yellow
                        }

                        // Soft continuous cloud band (no hard brick edges)
                        const cloudAlpha = normalizedIntensity * 0.34 * ageFade;
                        ctx.fillStyle = `rgba(${rgb}, ${cloudAlpha})`;
                        ctx.fillRect(xStart, y - bandHeight / 2, stripWidth, bandHeight);

                        // Crisp thin running liquidity line through strong levels
                        if (normalizedIntensity > 0.42) {
                            const lineAlpha = Math.min(0.85, normalizedIntensity * 0.78 * ageFade);
                            ctx.fillStyle = `rgba(${rgb}, ${lineAlpha})`;
                            ctx.fillRect(xStart, y - 0.75, stripWidth, 1.5);
                        }
                    }
                }
            }
        }

        // 2. Draw Live Liquidation Bubbles
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
                        ? isDark
                            ? '255, 255, 255'
                            : '71, 85, 105'
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

                const pulse = isThermalGuard ? 0 : Math.sin(age / 200) * 2;
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

                const valK =
                    bubble.value >= 1000000
                        ? (bubble.value / 1000000).toFixed(1) + 'M'
                        : (bubble.value / 1000).toFixed(0) + 'k';
                ctx.font = 'bold 9px Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                if (!isDark) {
                    ctx.lineWidth = 2.5;
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
                    ctx.strokeText(valK, x, y - radius - 8);
                    ctx.fillStyle = '#0f172a';
                } else {
                    ctx.fillStyle = '#ffffff';
                }
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

                    ctx.fillStyle = isDark ? 'rgba(239, 68, 68, 0.9)' : 'rgba(185, 28, 28, 0.95)';
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

                    ctx.fillStyle = isDark ? 'rgba(16, 185, 129, 0.9)' : 'rgba(4, 120, 87, 0.95)';
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
                const textColor = isBullish ? (isDark ? '#22c55e' : '#15803d') : (isDark ? '#ef4444' : '#b91c1c');

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
                ctx.strokeStyle = isDark
                    ? `rgba(156, 163, 175, ${alpha * 0.8})`
                    : `rgba(71, 85, 105, ${alpha * 0.8})`;
                ctx.setLineDash([10, 5, 2, 5]);
                ctx.lineWidth = 1.5;
                ctx.moveTo(0, y);
                ctx.lineTo(W, y);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.fillStyle = isDark
                    ? `rgba(156, 163, 175, ${alpha})`
                    : `rgba(51, 65, 85, ${alpha})`;
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
            const hoveredZone = allInteractiveZones.find(
                (z) => Math.abs(z.price - crosshairRef.current.price) < currentPrice * 0.0035
            );
            if (hoveredZone) {
                const boxW = hasZoneClickHandler ? 138 : 124;
                const boxH = hasZoneClickHandler ? 62 : 50;
                const ttX = Math.max(8, Math.min(W - boxW - 8, crosshairRef.current.x + 15));
                const ttY = Math.max(boxH + 8, Math.min(H - 8, crosshairRef.current.y - 10));
                const isShortZone = hoveredZone.price > currentPrice;

                ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.96)';
                ctx.strokeStyle =
                    hoveredZone.kind === 'pool'
                        ? isShortZone
                            ? 'rgba(245, 158, 11, 0.7)'
                            : 'rgba(6, 182, 212, 0.7)'
                        : isShortZone
                        ? 'rgba(244, 63, 94, 0.65)'
                        : 'rgba(16, 185, 129, 0.65)';
                ctx.lineWidth = 1;

                const volText = hoveredZone.estimatedUsd
                    ? `Pool: ${formatCompactUsd(hoveredZone.estimatedUsd)}`
                    : hoveredZone.volume
                    ? `Vol: ${formatCompactUsd(hoveredZone.volume)}`
                    : `Int: ${Math.round(hoveredZone.intensity)}%`;
                const typeText =
                    hoveredZone.kind === 'pool'
                        ? isShortZone
                            ? 'Short Lev. Pool'
                            : 'Long Lev. Pool'
                        : isShortZone
                        ? 'Short Liq. Zone'
                        : 'Long Liq. Zone';

                const distancePct = Math.abs(currentPrice - hoveredZone.price) / currentPrice;
                let levText = hoveredZone.leverage ? `Tier: ${hoveredZone.leverage}` : 'Est. Lev: ';
                if (!hoveredZone.leverage) {
                    if (distancePct <= 0.015) levText += '100x';
                    else if (distancePct <= 0.03) levText += '50x';
                    else if (distancePct <= 0.055) levText += '20x-25x';
                    else if (distancePct <= 0.11) levText += '10x';
                    else levText += '<10x';
                }

                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') {
                    ctx.roundRect(ttX, ttY - boxH, boxW, boxH, 4);
                } else {
                    ctx.rect(ttX, ttY - boxH, boxW, boxH);
                }
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = isDark ? '#ffffff' : '#0f172a';
                ctx.font = 'bold 10px Inter, sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
                ctx.fillText(typeText, ttX + 7, ttY - (boxH - 15));

                ctx.fillStyle = isDark ? 'rgba(148, 163, 184, 1)' : 'rgba(71, 85, 105, 1)';
                ctx.font = '9px Inter, sans-serif';
                ctx.fillText(volText, ttX + 7, ttY - (boxH - 29));

                ctx.fillStyle = isDark ? 'rgba(251, 191, 36, 1)' : 'rgba(217, 119, 6, 1)';
                ctx.fillText(levText, ttX + 7, ttY - (boxH - 42));

                if (hasZoneClickHandler) {
                    ctx.fillStyle = isDark ? 'rgba(96, 165, 250, 0.95)' : 'rgba(37, 99, 235, 0.95)';
                    ctx.font = 'bold 9px Inter, sans-serif';
                    ctx.fillText('Click to Trade @ Level', ttX + 7, ttY - 7);
                }
            }
        }

        // 4. Draw AI Trajectory Arrow
        const activeTrajectory = smartMoneyBias ? data.smart_trajectory : data.ai_trajectory;
        if (
            showTrajectory &&
            activeTrajectory &&
            activeTrajectory.direction !== 'NEUTRAL' &&
            currentPrice > 0 &&
            activeTrajectory.target_price > 0
        ) {
            const currentY = toY(currentPrice);
            const targetY = toY(activeTrajectory.target_price);

            if (currentY !== null && targetY !== null) {
                const isUp = activeTrajectory.direction === 'UP';
                const color = isUp ? '34, 197, 94' : '239, 68, 68';
                const startX = W * 0.85;
                const endX = W * 0.85;
                const mainWidth = 2 + activeTrajectory.strength / 25;

                // On mobile/tablet thermal guard, avoid expensive software shadowBlur
                if (isThermalGuard) {
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(${color}, 0.22)`;
                    ctx.lineWidth = mainWidth + 4;
                    ctx.setLineDash([5, 5]);
                    ctx.moveTo(startX, currentY);
                    ctx.lineTo(endX, targetY);
                    ctx.stroke();
                } else {
                    ctx.shadowColor = `rgba(${color}, 1)`;
                    ctx.shadowBlur = 10;
                }

                ctx.beginPath();
                ctx.strokeStyle = `rgba(${color}, 0.85)`;
                ctx.lineWidth = mainWidth;
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

                ctx.fillStyle = isDark ? `rgba(${color}, 1)` : isUp ? '#15803d' : '#b91c1c';
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
    public showMagnetZones = true;
    public showLeveragePools = true;
    public showTrajectory = true;
    public isDark = true;
    public hasZoneClickHandler = false;
    public isThermalGuard = false;
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
        showMagnetZones: boolean;
        showLeveragePools: boolean;
        showTrajectory: boolean;
        isDark: boolean;
        hasZoneClickHandler: boolean;
        isThermalGuard: boolean;
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
        this.showMagnetZones = params.showMagnetZones;
        this.showLeveragePools = params.showLeveragePools;
        this.showTrajectory = params.showTrajectory;
        this.isDark = params.isDark;
        this.hasZoneClickHandler = params.hasZoneClickHandler;
        this.isThermalGuard = params.isThermalGuard;
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
    showMagnetZones = true,
    showLeveragePools = true,
    showTrajectory = true,
    isDark = true,
    onZoneClick,
    candlesRef,
    candleTimes,
}) => {
    const primitiveRef = useRef<LiquidationPrimitive | null>(null);
    const animRafIdRef = useRef<number | null>(null);
    const scheduleAnimationRef = useRef<() => void>(() => {});
    const lastSymbolRef = useRef<string | null>(null);
    const hydratedKeyRef = useRef<string | null>(null);

    const [isThermalGuard, setIsThermalGuard] = useState<boolean>(() => isThermalGuardActive());
    const thermalGuardRef = useRef<boolean>(isThermalGuard);
    thermalGuardRef.current = isThermalGuard;

    useEffect(() => {
        return subscribeThermalProfile((profile) => {
            setIsThermalGuard(profile.isThermalGuardActive);
        });
    }, []);

    const showBubblesRef = useRef(showBubbles);
    showBubblesRef.current = showBubbles;
    const showTrueCVDRef = useRef(showTrueCVD);
    showTrueCVDRef.current = showTrueCVD;
    const dataRef = useRef(data);
    dataRef.current = data;
    const onZoneClickRef = useRef(onZoneClick);
    onZoneClickRef.current = onZoneClick;
    const showMagnetZonesRef = useRef(showMagnetZones);
    showMagnetZonesRef.current = showMagnetZones;
    const showLeveragePoolsRef = useRef(showLeveragePools);
    showLeveragePoolsRef.current = showLeveragePools;
    const showGEXRef = useRef(showGEX);
    showGEXRef.current = showGEX;
    const useTrailingLiquidityRef = useRef(useTrailingLiquidity);
    useTrailingLiquidityRef.current = useTrailingLiquidity;

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
            showMagnetZones,
            showLeveragePools,
            showTrajectory,
            isDark,
            hasZoneClickHandler: Boolean(onZoneClick),
            isThermalGuard,
            candlesRef,
            candleTimes,
        });

        let lastFrameTime = 0;

        const hasActiveAnimations = () => {
            if (typeof document !== 'undefined' && document.hidden) return false;
            const now = Date.now();
            const hasActiveBubble =
                showBubblesRef.current &&
                bubblesRef.current.some((b) =>
                    thermalGuardRef.current ? now - b.createdAt < 2200 : now - b.createdAt < 60000
                );
            const hasActiveIceberg =
                showTrueCVDRef.current && icebergsRef.current.some((b) => now - b.createdAt < 15000);
            return hasActiveBubble || hasActiveIceberg;
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

        const clickHandler = (param: any) => {
            const cb = onZoneClickRef.current;
            const curData = dataRef.current;
            if (!cb || !curData || !param?.point) return;

            const clickedPrice = Number(series.coordinateToPrice(param.point.y));
            const cp = Number(curData.current_price) || 0;
            if (!Number.isFinite(clickedPrice) || clickedPrice <= 0 || cp <= 0) return;

            const candidates: number[] = [];
            if (showMagnetZonesRef.current) {
                const zones =
                    useTrailingLiquidityRef.current && curData.smoothed_zones?.length
                        ? curData.smoothed_zones
                        : curData.magnet_zones || [];
                zones.forEach((z) => candidates.push(Number(z.price)));
            }
            if (showLeveragePoolsRef.current && curData.liquidation_pools) {
                curData.liquidation_pools.forEach((p) => candidates.push(Number(p.price)));
            }
            if (showGEXRef.current && curData.gex_data) {
                if (curData.gex_data.call_wall) candidates.push(Number(curData.gex_data.call_wall));
                if (curData.gex_data.put_wall) candidates.push(Number(curData.gex_data.put_wall));
            }

            const tolerance = cp * 0.0035;
            let bestPrice: number | null = null;
            let bestDiff = tolerance;
            for (const p of candidates) {
                if (!Number.isFinite(p) || p <= 0) continue;
                const diff = Math.abs(p - clickedPrice);
                if (diff <= bestDiff) {
                    bestDiff = diff;
                    bestPrice = p;
                }
            }

            if (bestPrice !== null) {
                cb(bestPrice);
            }
        };

        const handleVisibilityChange = () => {
            if (typeof document !== 'undefined' && !document.hidden) {
                primitive.requestUpdate();
                scheduleAnimation();
            }
        };

        chart.subscribeCrosshairMove(crosshairHandler);
        chart.subscribeClick(clickHandler);
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibilityChange);
        }

        return () => {
            scheduleAnimationRef.current = () => {};
            chart.unsubscribeCrosshairMove(crosshairHandler);
            chart.unsubscribeClick(clickHandler);
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

    // Ingest historical ring-buffer snapshot & live WebSocket snapshots
    useEffect(() => {
        if (!data) {
            bookmapHistoryRef.current = [];
            bubblesRef.current = [];
            icebergsRef.current = [];
            hydratedKeyRef.current = null;
            setActiveIcebergsCount(0);
            return;
        }

        if (data.symbol && lastSymbolRef.current && lastSymbolRef.current !== data.symbol) {
            bookmapHistoryRef.current = [];
            bubblesRef.current = [];
            icebergsRef.current = [];
            hydratedKeyRef.current = null;
            setActiveIcebergsCount(0);
        }
        if (data.symbol) {
            lastSymbolRef.current = data.symbol;
        }

        const now = Date.now();
        const maxBookmapSnapshots = thermalGuardRef.current ? 120 : 480;

        // One-time historical ring-buffer hydration on connect
        if (data.history && hydratedKeyRef.current !== data.symbol) {
            hydratedKeyRef.current = data.symbol || 'active';

            if (showBookmap && Array.isArray(data.history.bookmap) && data.history.bookmap.length > 0) {
                const existingTimes = new Set(bookmapHistoryRef.current.map((s) => s.time));
                const merged = [
                    ...data.history.bookmap.filter((s) => !existingTimes.has(s.time)),
                    ...bookmapHistoryRef.current,
                ].sort((a, b) => a.time - b.time);
                bookmapHistoryRef.current = merged.slice(-maxBookmapSnapshots);
            }

            if (showBubbles && Array.isArray(data.history.bubbles)) {
                data.history.bubbles.forEach((wf) => {
                    if (wf.price && wf.timestamp) {
                        const exists = bubblesRef.current.some(
                            (b) => b.timestamp === wf.timestamp && b.price === wf.price
                        );
                        if (!exists) {
                            bubblesRef.current.push({ ...wf, createdAt: wf.timestamp });
                        }
                    }
                });
            }

            if (showTrueCVD && Array.isArray(data.history.icebergs)) {
                data.history.icebergs.forEach((ev) => {
                    if (ev.price && ev.timestamp) {
                        const exists = icebergsRef.current.some(
                            (b) => b.timestamp === ev.timestamp && b.price === ev.price
                        );
                        if (!exists) {
                            icebergsRef.current.push({ ...ev, createdAt: ev.timestamp });
                        }
                    }
                });
            }
        }

        if (showBookmap && data.orderbook_depth && data.orderbook_depth.length > 0) {
            const lastSnapshot = bookmapHistoryRef.current[bookmapHistoryRef.current.length - 1];
            const minSnapGap = thermalGuardRef.current ? 500 : 250;
            if (!lastSnapshot || now - lastSnapshot.time >= minSnapGap) {
                bookmapHistoryRef.current.push({
                    time: now,
                    depth: data.orderbook_depth.map((d) => ({ price: d.price, volume: d.volume })),
                });
                if (bookmapHistoryRef.current.length > maxBookmapSnapshots) {
                    bookmapHistoryRef.current = bookmapHistoryRef.current.slice(-maxBookmapSnapshots);
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
            hydratedKeyRef.current = null;
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
            showMagnetZones,
            showLeveragePools,
            showTrajectory,
            isDark,
            hasZoneClickHandler: Boolean(onZoneClick),
            isThermalGuard,
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
        showMagnetZones,
        showLeveragePools,
        showTrajectory,
        isDark,
        onZoneClick,
        isThermalGuard,
        candlesRef,
        candleTimes,
    ]);

    return (
        <>
            {showTrueCVD && data && data.true_cvd !== undefined && (
                <TrueCVDDraggableHUD data={data} icebergsCount={activeIcebergsCount} isThermalGuard={isThermalGuard} />
            )}
        </>
    );
};

interface TrueCVDDraggableHUDProps {
    data: GodModeState;
    icebergsCount?: number;
    isThermalGuard?: boolean;
}

export const TrueCVDDraggableHUD: React.FC<TrueCVDDraggableHUDProps> = ({
    data,
    icebergsCount = 0,
    isThermalGuard = false,
}) => {
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
    const cvdColor = cvd > 0 ? 'text-emerald-500 dark:text-emerald-400' : cvd < 0 ? 'text-rose-500 dark:text-rose-400' : 'text-slate-700 dark:text-slate-200';
    const cvdVal =
        Math.abs(cvd) >= 1000000
            ? (cvd / 1000000).toFixed(2) + 'M'
            : (cvd / 1000).toFixed(0) + 'k';
    const activeWalls = icebergsCount || data.iceberg_events?.length || 0;

    return (
        <div
            className={`absolute z-[25] pointer-events-auto select-none ${isThermalGuard ? '' : 'transition-all'} ${
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
            <div className={`flex items-center gap-2.5 ${isThermalGuard ? 'bg-white/95 dark:bg-slate-950/95' : 'bg-white/90 dark:bg-slate-950/90 backdrop-blur-md'} border border-purple-500/40 hover:border-purple-400/80 rounded-lg px-3 py-2 shadow-xl dark:shadow-2xl transition-colors`}>
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
                    <div className={`flex items-center gap-1 bg-purple-500/20 border border-purple-500/40 rounded px-1.5 py-0.5 ml-1 ${isThermalGuard ? '' : 'animate-pulse'}`}>
                        <span className="text-[10px] leading-none">🧊</span>
                        <span className="text-[9px] font-bold text-purple-700 dark:text-purple-300 font-mono whitespace-nowrap leading-none">
                            {activeWalls} Wall
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};
