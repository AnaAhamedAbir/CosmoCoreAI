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
    showBiasTag?: boolean;
    showDeltaStrip?: boolean;
    showSpoofing?: boolean;
    showGEX?: boolean;
    showBookmap?: boolean;
    bookmapIntensity?: number;
    bookmapHistoryMinutes?: number;
    spoofingThreshold?: number;
    smartMoneyBias?: boolean;
    showMagnetZones?: boolean;
    showDeepWalls?: boolean;
    deepRangePct?: number;
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
    tierBreakdown?: string;
    distPct?: number;
    horizon?: string;
    oiWeighted?: boolean;
    depletedUsd?: number;
    isSweeping?: boolean;
    estimatedUsd?: number;
    exchanges?: string[];
    exchangeCount?: number;
    isConfluence?: boolean;
    exchangeBreakdown?: Record<string, number>;
    kind: 'magnet' | 'pool' | 'deep_wall';
    side?: 'SHORT_LIQ' | 'LONG_LIQ' | 'bid' | 'ask';
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

function findCandleIndex(targetSec: number, candleTimes: number[]): number {
    let lo = 0;
    let hi = candleTimes.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const val = candleTimes[mid];
        if (val === targetSec) return mid;
        if (val < targetSec) lo = mid + 1;
        else hi = mid - 1;
    }
    return Math.max(0, Math.min(candleTimes.length - 1, hi));
}

function compactBookmapHistory(
    snapshots: BookmapSnapshot[],
    maxSnapshots: number,
    retentionMs: number,
    nowMs: number
): BookmapSnapshot[] {
    const cutoff = nowMs - retentionMs;
    let filtered = snapshots.filter((s) => s.time >= cutoff);
    if (filtered.length <= maxSnapshots) return filtered;

    // Two-tier compaction: preserve crisp high-res recent 10 minutes, downsample only older archive
    const recentSplit = nowMs - 10 * 60 * 1000;
    const older: BookmapSnapshot[] = [];
    const recent: BookmapSnapshot[] = [];
    for (let i = 0; i < filtered.length; i++) {
        if (filtered[i].time < recentSplit) older.push(filtered[i]);
        else recent.push(filtered[i]);
    }

    const recentBudget = Math.min(recent.length, Math.max(120, Math.floor(maxSnapshots * 0.45)));
    const olderBudget = Math.max(40, maxSnapshots - recentBudget);

    const downsample = (arr: BookmapSnapshot[], target: number): BookmapSnapshot[] => {
        if (arr.length <= target || target <= 0) return arr;
        if (target === 1) return [arr[arr.length - 1]];
        const step = (arr.length - 1) / (target - 1);
        const out: BookmapSnapshot[] = [];
        let lastIdx = -1;
        for (let k = 0; k < target; k++) {
            const idx = Math.min(arr.length - 1, Math.round(k * step));
            if (idx !== lastIdx) {
                out.push(arr[idx]);
                lastIdx = idx;
            }
        }
        return out;
    };

    return [...downsample(older, olderBudget), ...downsample(recent, recentBudget)];
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
            showBiasTag,
            showDeltaStrip,
            showSpoofing,
            showGEX,
            showBookmap,
            bookmapIntensity,
            bookmapHistoryMinutes,
            spoofingThreshold,
            smartMoneyBias,
            showMagnetZones,
            showDeepWalls,
            deepRangePct,
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

        // 1.25 Draw Estimated Leveraged Liquidation Pools (5x / 10x / 25x / 50x / 100x — OI-Delta & Unswept)
        if (showLeveragePools && data.liquidation_pools && data.liquidation_pools.length > 0) {
            data.liquidation_pools.forEach((pool) => {
                const p = Number(pool.price);
                const intensity = Number(pool.intensity);
                if (!Number.isFinite(p) || !Number.isFinite(intensity) || intensity < 12) return;

                allInteractiveZones.push({
                    price: p,
                    intensity,
                    leverage: pool.leverage,
                    tierBreakdown: pool.tier_breakdown,
                    distPct: pool.dist_pct,
                    horizon: pool.horizon,
                    oiWeighted: pool.oi_weighted,
                    depletedUsd: pool.depleted_usd,
                    isSweeping: pool.is_sweeping,
                    estimatedUsd: pool.estimated_usd,
                    kind: 'pool',
                    side: pool.side,
                });

                const yCenter = toY(p);
                if (yCenter === null || yCenter < -30 || yCenter > H + 30) return;

                const isShortPool = pool.side === 'SHORT_LIQ' || (currentPrice > 0 && p > currentPrice);
                const barHeight = Math.max(3, Math.min(12, (intensity / 100) * 12));
                const alpha = Math.min(0.68, (intensity / 100) * (effectiveIntensityScale / 100) * 0.58);
                const rgb = isShortPool ? '245, 158, 11' : '6, 182, 212'; // Amber for Short Liq Pools, Cyan for Long Liq Pools

                const grad = ctx.createLinearGradient(0, 0, W, 0);
                grad.addColorStop(0, `rgba(${rgb}, ${alpha * 0.15})`);
                grad.addColorStop(0.65, `rgba(${rgb}, ${alpha * 0.35})`);
                grad.addColorStop(1, `rgba(${rgb}, ${alpha * 0.78})`);
                ctx.fillStyle = grad;
                ctx.fillRect(0, yCenter - barHeight / 2, W, barHeight);

                if (pool.is_sweeping) {
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(${rgb}, 0.9)`;
                    ctx.setLineDash([6, 3]);
                    ctx.lineWidth = 1;
                    ctx.strokeRect(0, yCenter - barHeight / 2, W, barHeight);
                    ctx.setLineDash([]);
                }

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
                    const horizonTag = pool.horizon && pool.horizon !== '24h' ? ` · ${pool.horizon.toUpperCase()}` : '';
                    const sweepTag = pool.is_sweeping ? ' [SWEEPING]' : '';
                    ctx.fillText(
                        `⚡ ${pool.leverage} POOL${usdTag}${horizonTag}${sweepTag} @ ${formatPriceLabel(p)}`,
                        W - 8,
                        textY
                    );
                }
            });
        }

        // 1.35 Draw Global Multi-Exchange Deep L2 Walls (±5% / ±10% Confluence Whale Walls)
        if (showDeepWalls && data.deep_l2_walls && data.deep_l2_walls.length > 0) {
            const maxDistPct = Math.max(5, Math.min(10, Number(deepRangePct) || 10));
            data.deep_l2_walls.forEach((wall) => {
                const p = Number(wall.price);
                const intensity = Number(wall.intensity);
                if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(intensity)) return;
                // Skip stale crossed walls between 8s deep REST polls so a crossed bid never renders as an ask
                if (currentPrice > 0 && ((wall.side === 'bid' && p >= currentPrice) || (wall.side === 'ask' && p <= currentPrice))) {
                    return;
                }
                const distPct =
                    currentPrice > 0
                        ? (Math.abs(p - currentPrice) / currentPrice) * 100
                        : Number(wall.dist_pct ?? 0);
                if (distPct > maxDistPct) return;

                allInteractiveZones.push({
                    price: p,
                    intensity,
                    volume: wall.total_usd,
                    distPct,
                    exchanges: wall.exchanges,
                    exchangeCount: wall.exchange_count,
                    isConfluence: wall.is_confluence,
                    exchangeBreakdown: wall.exchange_breakdown,
                    kind: 'deep_wall',
                    side: wall.side,
                });

                const yCenter = toY(p);
                if (yCenter === null || yCenter < -30 || yCenter > H + 30) return;

                const isAskWall = wall.side === 'ask';
                const barHeight = Math.max(4, Math.min(14, (intensity / 100) * 14));
                const alpha = Math.min(0.75, (intensity / 100) * (effectiveIntensityScale / 100) * 0.62);
                // Distinct institutional palette: Fuchsia for Global Ask Walls, Sky-Teal for Global Bid Walls
                const rgb = isAskWall ? '217, 70, 239' : '14, 165, 233';

                const grad = ctx.createLinearGradient(0, 0, W, 0);
                grad.addColorStop(0, `rgba(${rgb}, ${alpha * 0.08})`);
                grad.addColorStop(0.55, `rgba(${rgb}, ${alpha * 0.28})`);
                grad.addColorStop(1, `rgba(${rgb}, ${alpha * 0.72})`);
                ctx.fillStyle = grad;
                ctx.fillRect(0, yCenter - barHeight / 2, W, barHeight);

                // Solid bright core line for multi-exchange confluence walls (2+ exchanges stacked at same level)
                if (wall.is_confluence) {
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(${rgb}, ${Math.min(0.95, alpha + 0.25)})`;
                    ctx.lineWidth = 1.5;
                    ctx.moveTo(0, yCenter);
                    ctx.lineTo(W, yCenter);
                    ctx.stroke();
                }

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
                        ? `rgba(${rgb}, 0.98)`
                        : isAskWall
                        ? 'rgba(162, 28, 175, 0.95)'
                        : 'rgba(3, 105, 161, 0.95)';
                    ctx.font = 'bold 10px Inter, sans-serif';
                    ctx.textAlign = 'right';
                    ctx.textBaseline = 'middle';
                    const exTag = wall.exchange_count >= 2 ? ` [${wall.exchange_count}x EX]` : '';
                    const sideLbl = isAskWall ? 'ASK WALL' : 'BID WALL';
                    ctx.fillText(
                        `🌐 ${sideLbl} ${formatCompactUsd(wall.total_usd)}${exTag} @ ${formatPriceLabel(p)}`,
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

        // 1.6 Draw Bookmap Style Continuous Clouds & Liquidity Lines (True Candle-Time Aligned, 2H Scrollback)
        if (showBookmap && bookmapHistoryRef.current.length > 0 && effectiveCandleTimes.length >= 2) {
            const windowMs = Math.max(15, Math.min(120, Number(bookmapHistoryMinutes) || 120)) * 60 * 1000;
            const windowCutoff = now - windowMs;
            const allSnapshots = bookmapHistoryRef.current;
            const snapshots =
                allSnapshots[0].time >= windowCutoff
                    ? allSnapshots
                    : allSnapshots.filter((s) => s.time >= windowCutoff);

            if (snapshots.length > 0) {
                const lastIdx = effectiveCandleTimes.length - 1;
                const lastBarTime = effectiveCandleTimes[lastIdx];
                // Compute robust median bar interval over recent bars (immune to duplicate ticks/gaps)
                const recentDiffs: number[] = [];
                for (let idx = Math.max(1, lastIdx - 5); idx <= lastIdx; idx++) {
                    const diff = effectiveCandleTimes[idx] - effectiveCandleTimes[idx - 1];
                    if (diff > 0) recentDiffs.push(diff);
                }
                recentDiffs.sort((a, b) => a - b);
                const barIntervalSec =
                    recentDiffs.length > 0
                        ? recentDiffs[Math.floor(recentDiffs.length / 2)]
                        : Math.max(1, lastBarTime - effectiveCandleTimes[lastIdx - 1]);

                const hasLogicalToCoord = typeof (timeScale as any).logicalToCoordinate === 'function';
                const coordForIndex = (idx: number): number | null => {
                    try {
                        if (hasLogicalToCoord) {
                            const c = (timeScale as any).logicalToCoordinate(idx) as number | null;
                            if (c !== null && Number.isFinite(c)) return c;
                        }
                        const tc = timeScale.timeToCoordinate(effectiveCandleTimes[idx] as any) as number | null;
                        return tc !== null && Number.isFinite(tc) ? tc : null;
                    } catch {
                        return null;
                    }
                };

                let barSpacingPx = 8;
                const xLast = coordForIndex(lastIdx);
                const xPrev = coordForIndex(lastIdx - 1);
                if (xLast !== null && xPrev !== null && xLast > xPrev) {
                    barSpacingPx = xLast - xPrev;
                } else {
                    const logicalRange = timeScale.getVisibleLogicalRange();
                    if (logicalRange && logicalRange.to > logicalRange.from) {
                        barSpacingPx = Math.max(2, W / (logicalRange.to - logicalRange.from));
                    }
                }

                const firstBarTime = effectiveCandleTimes[0];
                const firstX = coordForIndex(0);
                const toTimeX = (timeMs: number): number | null => {
                    const tSec = timeMs / 1000;
                    if (tSec >= lastBarTime) {
                        if (xLast === null) return null;
                        const frac = Math.max(0, Math.min(2.0, (tSec - lastBarTime) / barIntervalSec));
                        return xLast + (frac - 0.5) * barSpacingPx;
                    }
                    if (tSec <= firstBarTime) {
                        if (firstX === null) return null;
                        const barsBack = (firstBarTime - tSec) / barIntervalSec;
                        return firstX - (barsBack + 0.5) * barSpacingPx;
                    }
                    const k = findCandleIndex(tSec, effectiveCandleTimes);
                    const xK = coordForIndex(k);
                    if (xK === null) return null;
                    const nextT = k + 1 <= lastIdx ? effectiveCandleTimes[k + 1] : effectiveCandleTimes[k] + barIntervalSec;
                    const stepSec = Math.max(1, nextT - effectiveCandleTimes[k]);
                    const frac = Math.max(0, Math.min(1, (tSec - effectiveCandleTimes[k]) / stepSec));
                    return xK + (frac - 0.5) * barSpacingPx;
                };

                const xPositions: (number | null)[] = snapshots.map((s) => toTimeX(s.time));
                const maxGapSec = Math.max(90, barIntervalSec * 1.5);

                // Viewport-aware contrast normalization so scrolling back 1-2h stays crisp and readable
                let maxVol = 0;
                for (let i = 0; i < snapshots.length; i++) {
                    const xs = xPositions[i];
                    if (xs === null) continue;
                    const nextXs = i < snapshots.length - 1 ? xPositions[i + 1] : xs + barSpacingPx * 2;
                    const xe = nextXs !== null ? nextXs : xs + barSpacingPx;
                    if (xe < -20 || xs > W + 20) continue;
                    const d = snapshots[i].depth;
                    for (let j = 0; j < d.length; j++) {
                        if (d[j].volume > maxVol) maxVol = d[j].volume;
                    }
                }
                if (maxVol <= 0) {
                    const recentSlice = snapshots.slice(-15);
                    for (let i = 0; i < recentSlice.length; i++) {
                        const d = recentSlice[i].depth;
                        for (let j = 0; j < d.length; j++) {
                            if (d[j].volume > maxVol) maxVol = d[j].volume;
                        }
                    }
                }
                if (maxVol <= 0) maxVol = 1;

                // Match BookmapHeatmapService bucket size (0.2% when ±10% deep L2 active, 0.1% for ±5% inner book)
                const refPrice = currentPrice > 0 ? currentPrice : 1;
                const latestSnapDepth = snapshots[snapshots.length - 1]?.depth || [];
                const hasWideDepth =
                    Boolean(data.deep_l2_summary && data.deep_l2_summary.exchange_count > 0) ||
                    latestSnapDepth.some((lvl) => Math.abs(lvl.price - refPrice) / refPrice > 0.055);
                const bucketStepPct = hasWideDepth ? 0.002 : 0.001;
                const yRef1 = toY(refPrice);
                const yRef2 = toY(refPrice * (1 + bucketStepPct));
                const bandHeight =
                    yRef1 !== null && yRef2 !== null
                        ? Math.max(2.5, Math.min(14, Math.abs(yRef2 - yRef1) * 0.96))
                        : hasWideDepth
                        ? 5
                        : 3.5;

                const intensityMultiplier = (bookmapIntensity || 50) / 50;
                const minCellThreshold = isThermalGuard ? 0.14 : 0.08;
                const minMobileColPx = isThermalGuard ? 3 : 0;
                let lastMobileEndX = -Infinity;

                for (let i = 0; i < snapshots.length; i++) {
                    const xStart = xPositions[i];
                    if (xStart === null) continue;

                    let xEnd: number;
                    if (i < snapshots.length - 1) {
                        const nextX = xPositions[i + 1];
                        const gapSec = (snapshots[i + 1].time - snapshots[i].time) / 1000;
                        if (nextX !== null && gapSec <= maxGapSec) {
                            xEnd = nextX;
                        } else {
                            // Cap strip width cleanly across offline/disconnected gaps instead of smearing
                            const capPx = Math.max(2, Math.min(barSpacingPx * 1.2, (maxGapSec / barIntervalSec) * barSpacingPx));
                            xEnd = xStart + capPx;
                        }
                    } else {
                        xEnd = Math.min(W, xStart + Math.max(24, barSpacingPx * 2.0));
                    }

                    if (xEnd < 0 || xStart > W) continue;
                    // On mobile/tablet ECO mode, skip sub-3px overlapping columns when zoomed out to 2H
                    if (minMobileColPx > 0 && i < snapshots.length - 1 && xEnd - xStart < minMobileColPx && xStart < lastMobileEndX) {
                        continue;
                    }
                    const baseWidth = Math.max(1.5, xEnd - xStart + 0.6);
                    const stripWidth =
                        minMobileColPx > 0 && i < snapshots.length - 1
                            ? Math.max(baseWidth, Math.min(minMobileColPx + 0.4, W - xStart))
                            : baseWidth;
                    if (minMobileColPx > 0) {
                        lastMobileEndX = xStart + stripWidth;
                    }
                    // Gentle age fade across the 2h window while keeping scrolled history clearly legible (min 0.45)
                    const ageFrac = Math.max(0, Math.min(1, (now - snapshots[i].time) / windowMs));
                    const ageFade = Math.max(0.45, 1 - ageFrac * 0.45);

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

        // 2.6 Draw True CVD & Iceberg Events (ExoCharts/ATAS Style: Micro Shelf + Wick-Offset Glass Pill)
        if (showTrueCVD && icebergsRef.current.length > 0) {
            const rawCandles = candlesRef?.current || [];
            // Build screen-space items and deduplicate closely overlapping events (keep peak absorbed volume)
            interface IcebergScreenItem {
                x: number;
                y: number;
                candleHighY: number | null;
                candleLowY: number | null;
                isBullish: boolean;
                volume: number;
                alpha: number;
            }
            const clustered: IcebergScreenItem[] = [];

            icebergsRef.current.forEach((iceberg) => {
                const x = toSnappedX(iceberg.timestamp);
                const y = toY(iceberg.price);
                if (x === null || y === null || x < -40 || x > W + 40 || y < -40 || y > H + 40) return;

                const age = now - iceberg.createdAt;
                if (age >= 15000) return;
                // Crisp full visibility for 10s, then smooth 5s fade-out
                const alpha = age < 10000 ? 1 : Math.max(0, 1 - (age - 10000) / 5000);
                const isBullish = iceberg.type === 'BULLISH_ABSORPTION';
                const vol = Number(iceberg.absorbed_volume) || 0;

                // Look up snapped candle high/low so the pill sits cleanly outside the wick
                let candleHighY: number | null = null;
                let candleLowY: number | null = null;
                if (rawCandles.length > 0 && effectiveCandleTimes.length > 0) {
                    const sec = iceberg.timestamp > 10_000_000_000 ? iceberg.timestamp / 1000 : iceberg.timestamp;
                    const idx = findCandleIndex(sec, effectiveCandleTimes);
                    const c = rawCandles[idx];
                    if (c) {
                        const hi = Number(c.high);
                        const lo = Number(c.low);
                        if (Number.isFinite(hi) && hi > 0) candleHighY = toY(hi);
                        if (Number.isFinite(lo) && lo > 0) candleLowY = toY(lo);
                    }
                }

                const nearby = clustered.find(
                    (it) => it.isBullish === isBullish && Math.abs(it.x - x) < 18 && Math.abs(it.y - y) < 22
                );
                if (nearby) {
                    if (vol >= nearby.volume) {
                        nearby.volume = vol;
                        nearby.y = y;
                        nearby.alpha = Math.max(nearby.alpha, alpha);
                    }
                } else {
                    clustered.push({ x, y, candleHighY, candleLowY, isBullish, volume: vol, alpha });
                }
            });

            const placedPills: { x1: number; y1: number; x2: number; y2: number }[] = [];

            clustered.forEach((item) => {
                const { x, y, candleHighY, candleLowY, isBullish, volume, alpha } = item;
                // Distinct institutional directional accents: Emerald for Bullish floor, Rose/Fuchsia for Bearish ceiling
                const accentRgb = isBullish ? '16, 185, 129' : '244, 63, 94';
                const textHex = isBullish
                    ? isDark
                        ? '#34d399'
                        : '#047857'
                    : isDark
                    ? '#fb7185'
                    : '#be123c';

                // 1) Crisp horizontal micro-shelf at exact absorption price (zero candle occlusion)
                ctx.save();
                ctx.beginPath();
                ctx.strokeStyle = `rgba(${accentRgb}, ${alpha * 0.85})`;
                ctx.lineWidth = 1.5;
                ctx.moveTo(x - 10, y);
                ctx.lineTo(x + 18, y);
                ctx.stroke();

                // 2) Subtle outer halo + crisp 3.5px hollow ring dot at exact tick price
                ctx.beginPath();
                ctx.fillStyle = `rgba(${accentRgb}, ${alpha * 0.16})`;
                ctx.arc(x, y, 7, 0, 2 * Math.PI);
                ctx.fill();

                ctx.beginPath();
                ctx.fillStyle = isDark ? `rgba(15, 23, 42, ${alpha * 0.9})` : `rgba(255, 255, 255, ${alpha * 0.95})`;
                ctx.strokeStyle = `rgba(${accentRgb}, ${alpha})`;
                ctx.lineWidth = 1.6;
                ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
                ctx.fill();
                ctx.stroke();

                // 3) Compact glass pill badge offset cleanly ABOVE candle high (Bearish) or BELOW candle low (Bullish)
                const volLabel =
                    volume >= 1_000_000
                        ? `${(volume / 1_000_000).toFixed(1)}M`
                        : `${Math.max(1, Math.round(volume / 1000))}k`;
                const dirArrow = isBullish ? '▲' : '▼';
                const badgeText = `🛡️ ${volLabel} ${dirArrow}`;

                ctx.font = 'bold 9.5px Inter, sans-serif';
                const textW = ctx.measureText(badgeText).width;
                const pillW = Math.ceil(textW + 12);
                const pillH = 18;
                const pillX = Math.max(6, Math.min(W - pillW - 6, x - pillW / 2));

                // Anchor outside the candle wick so body & wicks stay 100% clear
                let pillCenterY = isBullish
                    ? Math.max(y, candleLowY ?? y) + 22
                    : Math.min(y, candleHighY ?? y) - 22;
                pillCenterY = Math.max(pillH / 2 + 6, Math.min(H - pillH / 2 - 6, pillCenterY));

                // Prevent pill-to-pill overlap
                for (let attempt = 0; attempt < 5; attempt++) {
                    const y1 = pillCenterY - pillH / 2;
                    const y2 = pillCenterY + pillH / 2;
                    const collides = placedPills.some(
                        (p) => pillX < p.x2 + 4 && pillX + pillW > p.x1 - 4 && y1 < p.y2 + 3 && y2 > p.y1 - 3
                    );
                    if (!collides) break;
                    pillCenterY += isBullish ? 21 : -21;
                    pillCenterY = Math.max(pillH / 2 + 6, Math.min(H - pillH / 2 - 6, pillCenterY));
                }

                const pillY = pillCenterY - pillH / 2;
                placedPills.push({ x1: pillX, y1: pillY, x2: pillX + pillW, y2: pillY + pillH });

                // Dotted vertical leader connecting exact price dot to offset pill
                const stemStartY = isBullish ? y + 4 : y - 4;
                const stemEndY = isBullish ? pillY : pillY + pillH;
                if (Math.abs(stemEndY - stemStartY) > 3) {
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(${accentRgb}, ${alpha * 0.55})`;
                    ctx.lineWidth = 1;
                    ctx.setLineDash([2, 2]);
                    ctx.moveTo(x, stemStartY);
                    ctx.lineTo(x, stemEndY);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                // Rounded glass pill container
                const r = 5;
                ctx.beginPath();
                ctx.moveTo(pillX + r, pillY);
                ctx.lineTo(pillX + pillW - r, pillY);
                ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + r);
                ctx.lineTo(pillX + pillW, pillY + pillH - r);
                ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - r, pillY + pillH);
                ctx.lineTo(pillX + r, pillY + pillH);
                ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - r);
                ctx.lineTo(pillX, pillY + r);
                ctx.quadraticCurveTo(pillX, pillY, pillX + r, pillY);
                ctx.closePath();

                ctx.fillStyle = isDark
                    ? `rgba(15, 23, 42, ${alpha * 0.9})`
                    : `rgba(255, 255, 255, ${alpha * 0.95})`;
                ctx.fill();
                ctx.strokeStyle = `rgba(${accentRgb}, ${alpha * 0.85})`;
                ctx.lineWidth = 1;
                ctx.stroke();

                // Crisp pill label
                ctx.fillStyle = textHex;
                ctx.globalAlpha = alpha;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(badgeText, pillX + pillW / 2, pillCenterY + 0.5);
                ctx.restore();
            });
        }

        // 2.65 Draw Bottom Mini 1M Bar Delta Histogram Strip (Aggregated cleanly per snapped candle across any TF)
        if (showTrueCVD && showDeltaStrip && data.bar_deltas && data.bar_deltas.length > 0 && H > 140) {
            const bars = data.bar_deltas;
            const groupedByCandle = new Map<
                number,
                { x: number; delta_usd: number; absorption: string | null; divergence: string | null }
            >();

            for (let i = 0; i < bars.length; i++) {
                const b = bars[i];
                const snappedSec = snapToNearestCandleTime(b.time, effectiveCandleTimes);
                if (snappedSec === null) continue;
                let x: number | null = null;
                try {
                    x = timeScale.timeToCoordinate(snappedSec as any);
                } catch {
                    x = null;
                }
                if (x === null || x < -16 || x > W + 16) continue;
                const existing = groupedByCandle.get(snappedSec);
                if (existing) {
                    existing.delta_usd += b.delta_usd || 0;
                    if (b.absorption) existing.absorption = b.absorption;
                    if (b.divergence) existing.divergence = b.divergence;
                } else {
                    groupedByCandle.set(snappedSec, {
                        x,
                        delta_usd: b.delta_usd || 0,
                        absorption: b.absorption || null,
                        divergence: b.divergence || null,
                    });
                }
            }

            const visibleBars = Array.from(groupedByCandle.values());
            let maxAbsDelta = 0;
            for (let i = 0; i < visibleBars.length; i++) {
                const absD = Math.abs(visibleBars[i].delta_usd);
                if (absD > maxAbsDelta) maxAbsDelta = absD;
            }

            if (visibleBars.length > 0 && maxAbsDelta > 0) {
                const barSpacingPx = Math.max(3, Math.min(28, Number((timeScale.options() as any)?.barSpacing) || 8));
                const barW = Math.max(3, Math.min(10, barSpacingPx * 0.58));
                const maxBarH = Math.max(20, Math.min(40, H * 0.085));
                const baseY = H - 6;

                ctx.save();
                // Subtle baseline across bottom
                ctx.beginPath();
                ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.16)' : 'rgba(100, 116, 139, 0.18)';
                ctx.lineWidth = 1;
                ctx.moveTo(0, baseY);
                ctx.lineTo(W, baseY);
                ctx.stroke();

                for (let i = 0; i < visibleBars.length; i++) {
                    const bar = visibleBars[i];
                    const x = bar.x;
                    const d = bar.delta_usd || 0;
                    const ratio = Math.min(1, Math.abs(d) / maxAbsDelta);
                    const h = Math.max(3, ratio * maxBarH);
                    const isPos = d >= 0;

                    ctx.fillStyle = isPos
                        ? isDark
                            ? 'rgba(16, 185, 129, 0.52)'
                            : 'rgba(5, 150, 105, 0.50)'
                        : isDark
                        ? 'rgba(244, 63, 94, 0.52)'
                        : 'rgba(225, 29, 72, 0.50)';
                    ctx.fillRect(x - barW / 2, baseY - h, barW, h);

                    // Crisp top cap highlight
                    ctx.fillStyle = isPos ? 'rgba(52, 211, 153, 0.9)' : 'rgba(251, 113, 133, 0.9)';
                    ctx.fillRect(x - barW / 2, baseY - h, barW, 1.5);

                    // Gold/Purple dot above bar when Intra-Bar Divergence or Iceberg Absorption occurred
                    if (bar.absorption || bar.divergence) {
                        const dotColor = bar.absorption
                            ? '#c084fc' // Purple for confirmed Iceberg Absorption
                            : '#f59e0b'; // Amber for Delta Divergence
                        ctx.beginPath();
                        ctx.fillStyle = dotColor;
                        ctx.arc(x, baseY - h - 5, 2.4, 0, 2 * Math.PI);
                        ctx.fill();
                    }
                }

                // Micro watermark on bottom-left
                ctx.font = 'bold 8.5px monospace';
                ctx.fillStyle = isDark ? 'rgba(148, 163, 184, 0.55)' : 'rgba(71, 85, 105, 0.6)';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'bottom';
                ctx.fillText('1M Δ', 6, baseY - 2);
                ctx.restore();
            }
        }

        // 2.66 Draw Live 1M Candle Close-Bias Micro-Tag (Empty Right Space Beside Active Candle)
        if (
            showTrueCVD &&
            showBiasTag &&
            data.candle_orderflow &&
            data.candle_orderflow.close_bias !== 'NEUTRAL' &&
            data.candle_orderflow.confidence >= 62 &&
            currentPrice > 0
        ) {
            const cof = data.candle_orderflow;
            const liveY = toY(currentPrice);
            const lastCandleSec =
                effectiveCandleTimes.length > 0 ? effectiveCandleTimes[effectiveCandleTimes.length - 1] : null;
            const lastX = lastCandleSec !== null ? toSnappedX(lastCandleSec) : null;

            if (liveY !== null && lastX !== null && liveY >= 16 && liveY <= H - 16) {
                const isBull = cof.close_bias === 'BULLISH';
                const isClosingPush = cof.phase === 'CLOSING_PUSH';
                const accentRgb = isBull ? '16, 185, 129' : '244, 63, 94';
                const textHex = isBull
                    ? isDark
                        ? '#34d399'
                        : '#047857'
                    : isDark
                    ? '#fb7185'
                    : '#be123c';
                const tagText = `${isBull ? '▲' : '▼'} ${cof.confidence}% · ${String(cof.seconds_left).padStart(2, '0')}s`;

                ctx.save();
                ctx.font = 'bold 9.5px monospace';
                const textW = ctx.measureText(tagText).width;
                const pillW = Math.ceil(textW + 12);
                const pillH = 18;
                const barSpacingPx = Math.max(4, Math.min(28, Number((timeScale.options() as any)?.barSpacing) || 8));
                const rawX = lastX + Math.max(12, barSpacingPx * 0.75);
                const pillX = Math.max(8, Math.min(W - pillW - 8, rawX));
                const pillY = Math.max(6, Math.min(H - pillH - 6, liveY - pillH / 2));

                const r = 5;
                ctx.beginPath();
                ctx.moveTo(pillX + r, pillY);
                ctx.lineTo(pillX + pillW - r, pillY);
                ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + r);
                ctx.lineTo(pillX + pillW, pillY + pillH - r);
                ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - r, pillY + pillH);
                ctx.lineTo(pillX + r, pillY + pillH);
                ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - r);
                ctx.lineTo(pillX, pillY + r);
                ctx.quadraticCurveTo(pillX, pillY, pillX + r, pillY);
                ctx.closePath();

                ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.90)' : 'rgba(255, 255, 255, 0.94)';
                ctx.fill();
                ctx.strokeStyle = `rgba(${accentRgb}, ${isClosingPush ? 0.95 : 0.65})`;
                ctx.lineWidth = isClosingPush ? 1.5 : 1;
                ctx.stroke();

                ctx.fillStyle = textHex;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(tagText, pillX + pillW / 2, pillY + pillH / 2 + 0.5);
                ctx.restore();
            }
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

        // 3. Draw Interactive Tooltip for closest hovered zone (clamped inside pane)
        if (crosshairRef.current.visible && currentPrice > 0) {
            const hoverTolerance = currentPrice * 0.0035;
            let hoveredZone: MergedZone | undefined;
            let bestHoverDiff = hoverTolerance;
            for (let i = 0; i < allInteractiveZones.length; i++) {
                const z = allInteractiveZones[i];
                const diff = Math.abs(z.price - crosshairRef.current.price);
                if (diff < bestHoverDiff) {
                    bestHoverDiff = diff;
                    hoveredZone = z;
                }
            }
            if (hoveredZone) {
                const isShortZone = hoveredZone.price > currentPrice;

                const depTag =
                    hoveredZone.depletedUsd && hoveredZone.depletedUsd > 0
                        ? ` (-${formatCompactUsd(hoveredZone.depletedUsd)})`
                        : '';
                const distancePct = Math.abs(currentPrice - hoveredZone.price) / currentPrice;
                const distLabel = `${(distancePct * 100).toFixed(2)}%`;

                let typeText: string;
                let volText: string;
                let levText: string;

                if (hoveredZone.kind === 'deep_wall') {
                    const exCountTag =
                        hoveredZone.exchangeCount && hoveredZone.exchangeCount >= 2
                            ? ` [${hoveredZone.exchangeCount}x EX]`
                            : '';
                    typeText = isShortZone ? `Global Ask Wall${exCountTag}` : `Global Bid Wall${exCountTag}`;
                    volText = `Total: ${formatCompactUsd(hoveredZone.volume || 0)} · ${distLabel}`;
                    const exShort: Record<string, string> = {
                        binance: 'BN',
                        bybit: 'BB',
                        okx: 'OKX',
                        bitget: 'BG',
                    };
                    const bd = hoveredZone.exchangeBreakdown || {};
                    const parts = Object.entries(bd)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(([k, v]) => `${exShort[k] || k.toUpperCase()} ${formatCompactUsd(v)}`);
                    levText = parts.length > 0 ? parts.join(' · ') : `Exchanges: ${(hoveredZone.exchanges || []).join(', ')}`;
                } else {
                    volText = hoveredZone.estimatedUsd
                        ? `Untapped: ${formatCompactUsd(hoveredZone.estimatedUsd)}${depTag}`
                        : hoveredZone.volume
                        ? `Vol: ${formatCompactUsd(hoveredZone.volume)}`
                        : `Int: ${Math.round(hoveredZone.intensity)}%`;
                    const oiTag = hoveredZone.kind === 'pool' && hoveredZone.oiWeighted ? ' [OI-Δ]' : '';
                    typeText =
                        hoveredZone.kind === 'pool'
                            ? isShortZone
                                ? `Short Lev. Pool${oiTag}`
                                : `Long Lev. Pool${oiTag}`
                            : isShortZone
                            ? 'Short Liq. Zone'
                            : 'Long Liq. Zone';

                    levText = hoveredZone.leverage
                        ? `Tier: ${hoveredZone.tierBreakdown || hoveredZone.leverage} · ${distLabel}`
                        : 'Est. Lev: ';
                    if (!hoveredZone.leverage) {
                        if (distancePct <= 0.015) levText += '100x';
                        else if (distancePct <= 0.03) levText += '50x';
                        else if (distancePct <= 0.055) levText += '20x-25x';
                        else if (distancePct <= 0.11) levText += '10x';
                        else levText += '<10x';
                    }
                }

                // Measure rendered text so tooltip box never clips long USD/depletion strings
                ctx.font = 'bold 10px Inter, sans-serif';
                const wType = ctx.measureText(typeText).width;
                ctx.font = '9px Inter, sans-serif';
                const wVol = ctx.measureText(volText).width;
                const wLev = ctx.measureText(levText).width;
                const minBoxW = hasZoneClickHandler ? 138 : 124;
                const boxW = Math.ceil(Math.max(minBoxW, wType, wVol, wLev) + 16);
                const boxH = hasZoneClickHandler ? 64 : 52;
                const ttX = Math.max(8, Math.min(W - boxW - 8, crosshairRef.current.x + 15));
                const ttY = Math.max(boxH + 8, Math.min(H - 8, crosshairRef.current.y - 10));

                ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.96)';
                ctx.strokeStyle =
                    hoveredZone.kind === 'deep_wall'
                        ? isShortZone
                            ? 'rgba(217, 70, 239, 0.75)'
                            : 'rgba(14, 165, 233, 0.75)'
                        : hoveredZone.kind === 'pool'
                        ? isShortZone
                            ? 'rgba(245, 158, 11, 0.7)'
                            : 'rgba(6, 182, 212, 0.7)'
                        : isShortZone
                        ? 'rgba(244, 63, 94, 0.65)'
                        : 'rgba(16, 185, 129, 0.65)';
                ctx.lineWidth = 1;

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
    public showBiasTag = true;
    public showDeltaStrip = true;
    public showSpoofing = true;
    public showGEX = true;
    public showBookmap = true;
    public bookmapIntensity = 50;
    public bookmapHistoryMinutes = 120;
    public spoofingThreshold = 500000;
    public smartMoneyBias = false;
    public showMagnetZones = true;
    public showDeepWalls = true;
    public deepRangePct = 10;
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
        showBiasTag: boolean;
        showDeltaStrip: boolean;
        showSpoofing: boolean;
        showGEX: boolean;
        showBookmap: boolean;
        bookmapIntensity: number;
        bookmapHistoryMinutes: number;
        spoofingThreshold: number;
        smartMoneyBias: boolean;
        showMagnetZones: boolean;
        showDeepWalls: boolean;
        deepRangePct: number;
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
        this.showBiasTag = params.showBiasTag;
        this.showDeltaStrip = params.showDeltaStrip;
        this.showSpoofing = params.showSpoofing;
        this.showGEX = params.showGEX;
        this.showBookmap = params.showBookmap;
        this.bookmapIntensity = params.bookmapIntensity;
        this.bookmapHistoryMinutes = params.bookmapHistoryMinutes;
        this.spoofingThreshold = params.spoofingThreshold;
        this.smartMoneyBias = params.smartMoneyBias;
        this.showMagnetZones = params.showMagnetZones;
        this.showDeepWalls = params.showDeepWalls;
        this.deepRangePct = params.deepRangePct;
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
    showBiasTag = true,
    showDeltaStrip = true,
    showSpoofing = true,
    showGEX = true,
    showBookmap = true,
    bookmapIntensity = 50,
    bookmapHistoryMinutes = 120,
    spoofingThreshold = 500000,
    smartMoneyBias = false,
    showMagnetZones = true,
    showDeepWalls = true,
    deepRangePct = 10,
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
    const lastStreamKeyRef = useRef<string | null>(null);
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
    const showDeepWallsRef = useRef(showDeepWalls);
    showDeepWallsRef.current = showDeepWalls;
    const deepRangePctRef = useRef(deepRangePct);
    deepRangePctRef.current = deepRangePct;
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
            showBiasTag,
            showDeltaStrip,
            showSpoofing,
            showGEX,
            showBookmap,
            bookmapIntensity,
            bookmapHistoryMinutes,
            spoofingThreshold,
            smartMoneyBias,
            showMagnetZones,
            showDeepWalls,
            deepRangePct,
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
            if (showDeepWallsRef.current && curData.deep_l2_walls) {
                const maxDist = Math.max(5, Math.min(10, Number(deepRangePctRef.current) || 10));
                curData.deep_l2_walls.forEach((w) => {
                    const p = Number(w.price);
                    if (!Number.isFinite(p) || p <= 0) return;
                    if ((w.side === 'bid' && p >= cp) || (w.side === 'ask' && p <= cp)) return;
                    const dist = (Math.abs(p - cp) / cp) * 100;
                    if (dist <= maxDist) candidates.push(p);
                });
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
            lastStreamKeyRef.current = null;
            setActiveIcebergsCount(0);
            return;
        }

        const hydrateKey = `${data.symbol || 'active'}:${data.exchange || 'binance'}`;
        if (lastStreamKeyRef.current && lastStreamKeyRef.current !== hydrateKey) {
            bookmapHistoryRef.current = [];
            bubblesRef.current = [];
            icebergsRef.current = [];
            hydratedKeyRef.current = null;
            setActiveIcebergsCount(0);
        }
        lastStreamKeyRef.current = hydrateKey;
        if (data.symbol) {
            lastSymbolRef.current = data.symbol;
        }

        const now = Date.now();
        const maxBookmapSnapshots = thermalGuardRef.current ? 360 : 1000;
        const retentionMs = 120 * 60 * 1000; // Always retain up to 2h locally so 15M/1H/2H toggle is instant

        // One-time historical ring-buffer + persisted 2h Bookmap hydration on connect
        if (data.history && hydratedKeyRef.current !== hydrateKey) {
            hydratedKeyRef.current = hydrateKey;

            if (Array.isArray(data.history.bookmap) && data.history.bookmap.length > 0) {
                const existingTimes = new Set(bookmapHistoryRef.current.map((s) => s.time));
                const merged = [
                    ...data.history.bookmap.filter((s) => !existingTimes.has(s.time)),
                    ...bookmapHistoryRef.current,
                ].sort((a, b) => a.time - b.time);
                bookmapHistoryRef.current = compactBookmapHistory(merged, maxBookmapSnapshots, retentionMs, now);
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

        if (data.orderbook_depth && data.orderbook_depth.length > 0) {
            const lastSnapshot = bookmapHistoryRef.current[bookmapHistoryRef.current.length - 1];
            // Record live ticks (2.5s when hidden/mobile, 1.5s when visible on PC) & filter <3% dust to cut RAM/draw cost
            const minSnapGap = !showBookmap || thermalGuardRef.current ? 2500 : 1500;
            if (!lastSnapshot || now - lastSnapshot.time >= minSnapGap) {
                let snapPeak = 0;
                for (let i = 0; i < data.orderbook_depth.length; i++) {
                    if (data.orderbook_depth[i].volume > snapPeak) snapPeak = data.orderbook_depth[i].volume;
                }
                const dustCutoff = snapPeak * 0.03;
                const compactDepth = data.orderbook_depth
                    .filter((d) => d.volume >= dustCutoff)
                    .map((d) => ({ price: d.price, volume: d.volume }));
                if (compactDepth.length > 0) {
                    bookmapHistoryRef.current.push({
                        time: now,
                        depth: compactDepth,
                    });
                    if (bookmapHistoryRef.current.length > maxBookmapSnapshots) {
                        bookmapHistoryRef.current = compactBookmapHistory(
                            bookmapHistoryRef.current,
                            maxBookmapSnapshots,
                            retentionMs,
                            now
                        );
                    }
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
                        (b) =>
                            (b.timestamp === ev.timestamp && b.price === ev.price) ||
                            (b.type === ev.type &&
                                b.price > 0 &&
                                Math.abs(ev.price - b.price) / b.price <= 0.0015 &&
                                Math.abs(ev.timestamp - b.timestamp) <= 12000)
                    );
                    if (existing) {
                        // Update existing clustered iceberg in place instead of stacking duplicates
                        existing.price = ev.price;
                        existing.absorbed_volume = Math.max(existing.absorbed_volume || 0, ev.absorbed_volume || 0);
                        if (ev.timestamp > existing.timestamp) {
                            existing.timestamp = ev.timestamp;
                            existing.createdAt = now;
                        }
                    } else {
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
            showBiasTag,
            showDeltaStrip,
            showSpoofing,
            showGEX,
            showBookmap,
            bookmapIntensity,
            bookmapHistoryMinutes,
            spoofingThreshold,
            smartMoneyBias,
            showMagnetZones,
            showDeepWalls,
            deepRangePct,
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
        showBiasTag,
        showDeltaStrip,
        showSpoofing,
        showGEX,
        showBookmap,
        bookmapIntensity,
        bookmapHistoryMinutes,
        spoofingThreshold,
        smartMoneyBias,
        showMagnetZones,
        showDeepWalls,
        deepRangePct,
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
                if (Number.isFinite(Number(parsed?.x)) && Number.isFinite(Number(parsed?.y))) {
                    return { x: Number(parsed.x), y: Number(parsed.y) };
                }
            }
        } catch {}
        return { x: 0, y: 0 };
    });

    const [isDragging, setIsDragging] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
        try {
            return localStorage.getItem('true_cvd_hud_collapsed') === '1';
        } catch {
            return false;
        }
    });
    const toggleCollapsed = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsCollapsed((prev) => {
            const next = !prev;
            try {
                localStorage.setItem('true_cvd_hud_collapsed', next ? '1' : '0');
            } catch {}
            return next;
        });
    };
    const hudRef = useRef<HTMLDivElement | null>(null);
    const latestPosRef = useRef(position);
    const dragRef = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        initX: number;
        initY: number;
    } | null>(null);

    const BASE_LEFT = 16;
    const BASE_BOTTOM = 46;
    const MARGIN = 8;

    const clampOffset = (x: number, y: number): { x: number; y: number } => {
        if (typeof window === 'undefined' || !hudRef.current) return { x, y };
        const el = hudRef.current;
        const parent = el.offsetParent as HTMLElement | null;
        const hudW = el.offsetWidth || 385;
        const hudH = el.offsetHeight || 185;

        if (!parent) {
            return { x, y };
        }
        const pRect = parent.getBoundingClientRect();
        const parentW = parent.clientWidth || pRect.width || window.innerWidth;
        const parentH = parent.clientHeight || pRect.height || window.innerHeight;
        const baseTop = parentH - BASE_BOTTOM - hudH;

        // Bound strictly inside BOTH the chart container and the visible browser viewport
        const minXContainer = MARGIN - BASE_LEFT;
        const maxXContainer = Math.max(minXContainer, parentW - hudW - MARGIN - BASE_LEFT);
        const minXViewport = MARGIN - (pRect.left + BASE_LEFT);
        const maxXViewport = Math.max(minXViewport, window.innerWidth - hudW - MARGIN - (pRect.left + BASE_LEFT));
        const minX = Math.max(minXContainer, minXViewport);
        const maxX = Math.max(minX, Math.min(maxXContainer, maxXViewport));

        const minYContainer = MARGIN - baseTop;
        const maxYContainer = Math.max(minYContainer, parentH - hudH - MARGIN - baseTop);
        const minYViewport = MARGIN - (pRect.top + baseTop);
        const maxYViewport = Math.max(minYViewport, window.innerHeight - hudH - MARGIN - (pRect.top + baseTop));
        const minY = Math.max(minYContainer, minYViewport);
        const maxY = Math.max(minY, Math.min(maxYContainer, maxYViewport));

        return {
            x: Math.round(Math.max(minX, Math.min(maxX, x))),
            y: Math.round(Math.max(minY, Math.min(maxY, y))),
        };
    };

    const applyTransform = (x: number, y: number) => {
        latestPosRef.current = { x, y };
        if (hudRef.current) {
            hudRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        }
    };

    // Keep HUD strictly inside screen/chart on mount, resize, or collapse/expand
    useEffect(() => {
        const syncBounds = () => {
            if (dragRef.current) return;
            const clamped = clampOffset(latestPosRef.current.x, latestPosRef.current.y);
            if (clamped.x !== latestPosRef.current.x || clamped.y !== latestPosRef.current.y) {
                applyTransform(clamped.x, clamped.y);
                setPosition(clamped);
            }
        };
        const rafId = window.requestAnimationFrame(syncBounds);
        window.addEventListener('resize', syncBounds);
        let ro: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined' && hudRef.current) {
            ro = new ResizeObserver(syncBounds);
            ro.observe(hudRef.current);
            const parent = hudRef.current.offsetParent as HTMLElement | null;
            if (parent) ro.observe(parent);
        }
        return () => {
            window.cancelAnimationFrame(rafId);
            window.removeEventListener('resize', syncBounds);
            ro?.disconnect();
        };
    }, [isCollapsed]);

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {}
        dragRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            initX: latestPosRef.current.x,
            initY: latestPosRef.current.y,
        };
        setIsDragging(true);
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        const clamped = clampOffset(
            drag.initX + (e.clientX - drag.startX),
            drag.initY + (e.clientY - drag.startY)
        );
        applyTransform(clamped.x, clamped.y);
    };

    const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        dragRef.current = null;
        try {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
        } catch {}
        setIsDragging(false);
        const finalPos = clampOffset(latestPosRef.current.x, latestPosRef.current.y);
        applyTransform(finalPos.x, finalPos.y);
        setPosition(finalPos);
        try {
            localStorage.setItem('true_cvd_hud_pos', JSON.stringify(finalPos));
        } catch {}
    };

    const resetPosition = (e: React.MouseEvent) => {
        e.stopPropagation();
        const clamped = clampOffset(0, 0);
        applyTransform(clamped.x, clamped.y);
        setPosition(clamped);
        try {
            localStorage.removeItem('true_cvd_hud_pos');
        } catch {}
    };

    const fmtSignedUsd = (v: number) => {
        const sign = v > 0 ? '+' : v < 0 ? '-' : '';
        const abs = Math.abs(v);
        if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
        if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
        return `${sign}$${Math.round(abs)}`;
    };

    const cvd = data.true_cvd ?? 0;
    const cvdColor =
        cvd > 0
            ? 'text-emerald-500 dark:text-emerald-400'
            : cvd < 0
            ? 'text-rose-500 dark:text-rose-400'
            : 'text-slate-700 dark:text-slate-200';
    const activeWalls = icebergsCount || data.iceberg_events?.length || 0;

    const cof = data.candle_orderflow;
    const bias = cof?.close_bias || 'NEUTRAL';
    const conf = cof?.confidence ?? 50;
    const secLeft = cof?.seconds_left ?? 0;
    const isClosingPush = cof?.phase === 'CLOSING_PUSH';
    const buyPct = Math.max(0, Math.min(100, cof?.buy_pct ?? 50));
    const barDelta = cof?.bar_delta_usd ?? 0;
    const whaleDelta = cof?.whale_delta_usd ?? 0;
    const retailDelta = cof?.retail_delta_usd ?? 0;
    const vel10 = cof?.velocity_10s_usd ?? 0;

    const biasBadge =
        bias === 'BULLISH'
            ? { text: `BULL ${conf}% ▲`, cls: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/40' }
            : bias === 'BEARISH'
            ? { text: `BEAR ${conf}% ▼`, cls: 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/40' }
            : { text: `CHOP ${conf}%`, cls: 'bg-slate-200/80 dark:bg-white/10 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-white/15' };

    const borderGlow =
        bias === 'BULLISH'
            ? 'border-emerald-500/45 hover:border-emerald-400/80'
            : bias === 'BEARISH'
            ? 'border-rose-500/45 hover:border-rose-400/80'
            : 'border-purple-500/40 hover:border-purple-400/80';

    return (
        <div
            ref={hudRef}
            className={`absolute z-[25] pointer-events-auto select-none ${
                isDragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            style={{
                left: `${BASE_LEFT}px`,
                bottom: `${BASE_BOTTOM}px`,
                transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
                touchAction: 'none',
                willChange: isDragging ? 'transform' : undefined,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={resetPosition}
            title="Drag to reposition within chart • Double-click to reset position"
        >
            <div
                className={`${isCollapsed ? 'w-auto max-w-[calc(100vw-24px)]' : 'w-[385px] max-w-[calc(100vw-24px)]'} ${
                    isThermalGuard ? 'bg-white/95 dark:bg-slate-950/95' : 'bg-white/90 dark:bg-slate-950/90 backdrop-blur-md'
                } border ${borderGlow} ${
                    isDragging
                        ? 'shadow-[0_0_28px_rgba(168,85,247,0.48)]'
                        : 'shadow-2xl hover:shadow-[0_0_18px_rgba(168,85,247,0.24)]'
                } rounded-2xl ${isCollapsed ? 'px-3.5 py-2' : 'px-4 py-3.5'} transition-colors font-mono`}
            >
                {/* Header Row: Title + Live 1m Countdown + Close-Bias Badge + Minimize/Expand Button */}
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base leading-none">🛡️</span>
                        <span className="text-[13px] font-bold tracking-wider text-purple-700 dark:text-purple-300 uppercase leading-none truncate">
                            {isCollapsed ? '1M' : '1M ORDERFLOW'}
                        </span>
                        {cof && (
                            <span
                                className={`text-xs font-bold px-2 py-0.5 rounded-md leading-none shrink-0 ${
                                    isClosingPush
                                        ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/40'
                                        : 'bg-slate-200/75 dark:bg-white/10 text-slate-600 dark:text-slate-300'
                                }`}
                            >
                                ⏱{String(secLeft).padStart(2, '0')}s
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        {cof && (
                            <span className={`text-xs font-black px-2 py-0.5 rounded-md border leading-none ${biasBadge.cls}`}>
                                {biasBadge.text}
                            </span>
                        )}
                        {isCollapsed && (
                            <span
                                className={`text-xs font-black leading-none ${
                                    barDelta > 0
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : barDelta < 0
                                        ? 'text-rose-600 dark:text-rose-400'
                                        : 'text-slate-500 dark:text-slate-300'
                                }`}
                            >
                                {fmtSignedUsd(barDelta)}
                            </span>
                        )}
                        <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => e.stopPropagation()}
                            onClick={toggleCollapsed}
                            className="w-6 h-6 flex items-center justify-center text-sm font-bold text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-md bg-slate-200/60 dark:bg-white/10 hover:bg-slate-300/80 dark:hover:bg-white/20 transition-colors leading-none cursor-pointer"
                            title={isCollapsed ? 'Expand 1M Orderflow Cockpit' : 'Minimize 1M Orderflow Cockpit'}
                            aria-label={isCollapsed ? 'Expand 1M Orderflow Cockpit' : 'Minimize 1M Orderflow Cockpit'}
                        >
                            {isCollapsed ? '+' : '−'}
                        </button>
                    </div>
                </div>

                {!isCollapsed && (
                    <div className="mt-3 space-y-2.5">
                        {/* Aggressive Buy vs Sell Pressure Split Bar */}
                        {cof && (
                            <div>
                                <div className="w-full h-2.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden flex shadow-inner">
                                    <div
                                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-[width] duration-300"
                                        style={{ width: `${buyPct}%` }}
                                    />
                                    <div className="h-full bg-gradient-to-r from-rose-500 to-pink-500 flex-1" />
                                </div>
                                <div className="flex justify-between mt-1.5 text-xs font-bold">
                                    <span className="text-emerald-600 dark:text-emerald-400">BUY {buyPct.toFixed(0)}%</span>
                                    <span className="text-rose-600 dark:text-rose-400">SELL {(100 - buyPct).toFixed(0)}%</span>
                                </div>
                            </div>
                        )}

                        {/* 1M Bar Delta + 60s True CVD Row */}
                        <div className="flex items-center justify-between text-sm pt-2 border-t border-slate-200/75 dark:border-white/10">
                            <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">1m Δ</span>
                                <span
                                    className={`font-black ${
                                        barDelta > 0
                                            ? 'text-emerald-600 dark:text-emerald-400'
                                            : barDelta < 0
                                            ? 'text-rose-600 dark:text-rose-400'
                                            : 'text-slate-600 dark:text-slate-300'
                                    }`}
                                >
                                    {fmtSignedUsd(barDelta)}
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">60s CVD</span>
                                <span className={`font-black ${cvdColor}`}>{fmtSignedUsd(cvd)}</span>
                            </div>
                        </div>

                        {/* Whale vs Retail Trade Segmentation Row */}
                        {cof && (
                            <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200/75 dark:border-white/10">
                                <span className="flex items-center gap-1.5" title="Whale Print Delta">
                                    <span className="text-sm">🐋</span>
                                    <span
                                        className={`font-bold ${
                                            whaleDelta > 0
                                                ? 'text-emerald-600 dark:text-emerald-400'
                                                : whaleDelta < 0
                                                ? 'text-rose-600 dark:text-rose-400'
                                                : 'text-slate-500 dark:text-slate-400'
                                        }`}
                                    >
                                        {fmtSignedUsd(whaleDelta)}
                                    </span>
                                </span>
                                <span className="flex items-center gap-1.5" title="Retail Print Delta">
                                    <span className="text-sm">🐟</span>
                                    <span
                                        className={`font-bold ${
                                            retailDelta > 0
                                                ? 'text-emerald-600 dark:text-emerald-400'
                                                : retailDelta < 0
                                                ? 'text-rose-600 dark:text-rose-400'
                                                : 'text-slate-500 dark:text-slate-400'
                                        }`}
                                    >
                                        {fmtSignedUsd(retailDelta)}
                                    </span>
                                </span>
                                <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400" title="Last 10s Closing Tape Velocity">
                                    <span>10s</span>
                                    <span
                                        className={`font-bold ${
                                            vel10 > 0
                                                ? 'text-emerald-500'
                                                : vel10 < 0
                                                ? 'text-rose-500'
                                                : 'text-slate-400'
                                        }`}
                                    >
                                        {fmtSignedUsd(vel10)}
                                    </span>
                                </span>
                            </div>
                        )}

                        {/* Live Microstructure Reason + Active Iceberg Badge */}
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/75 dark:border-white/10">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200 truncate">
                                ⚡ {cof?.reason || 'LIVE TAPE'}
                                {cof?.divergence ? ` · ${cof.divergence === 'BULL_DIV' ? 'DIV ↑' : 'DIV ↓'}` : ''}
                            </span>
                            {activeWalls > 0 && (
                                <span
                                    className={`flex items-center gap-1 bg-purple-500/20 border border-purple-500/40 rounded-md px-2 py-0.5 text-[11px] font-bold text-purple-700 dark:text-purple-300 shrink-0 ${
                                        isThermalGuard ? '' : 'animate-pulse'
                                    }`}
                                >
                                    🧊 {activeWalls} Wall
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
