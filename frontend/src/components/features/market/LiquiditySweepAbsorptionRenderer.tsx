import React, { useEffect, useMemo, useRef } from 'react';
import type {
    IChartApi,
    ISeriesApi,
    ISeriesPrimitive,
    IPrimitivePaneView,
    IPrimitivePaneRenderer,
    SeriesAttachedParameter,
} from 'lightweight-charts';
import { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { LiquidityAbsorptionZone } from '@/hooks/useLiquiditySweepAbsorption';

interface LiquiditySweepAbsorptionRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    zones: LiquidityAbsorptionZone[];
    candleTimes?: number[];
    candlesRef?: React.MutableRefObject<any[]>;
    visible: boolean;
    showIcebergMarkers: boolean;
    showLiquiditySwap: boolean;
    showHudSummary: boolean;
    currentPrice?: number;
}

const formatCompactUsd = (val: number): string => {
    if (!Number.isFinite(val) || val <= 0) return '$0';
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
    return `$${val.toFixed(0)}`;
};

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
    // Snap to the candle bar that contains or precedes targetSec
    return candleTimes[Math.max(0, hi)];
}

class LSAPaneRenderer implements IPrimitivePaneRenderer {
    private _primitive: LSAPrimitive;

    constructor(primitive: LSAPrimitive) {
        this._primitive = primitive;
    }

    draw(target: CanvasRenderingTarget2D): void {
        target.useMediaCoordinateSpace((scope) => {
            this._drawContent(scope.context, scope.mediaSize.width, scope.mediaSize.height);
        });
    }

    private _drawContent(ctx: CanvasRenderingContext2D, W: number, H: number): void {
        const { chart, series, zones, candleTimes, candlesRef, visible, showIcebergMarkers, showLiquiditySwap } = this._primitive;
        if (!chart || !series || !visible || !zones || zones.length === 0) return;

        const effectiveCandleTimes: number[] =
            candlesRef?.current && candlesRef.current.length > 0
                ? candlesRef.current.map((c: any) => Number(c.time))
                : candleTimes;

        const timeScale = chart.timeScale();
        if (!timeScale) return;

        const toX = (timeSec: number): number | null => {
            const snapped = snapToNearestCandleTime(timeSec, effectiveCandleTimes);
            if (snapped === null) return null;
            try {
                return timeScale.timeToCoordinate(snapped as any);
            } catch {
                return null;
            }
        };

        const toY = (price: number): number | null => {
            try {
                return series.priceToCoordinate(price);
            } catch {
                return null;
            }
        };

        const lastCandleTime = effectiveCandleTimes.length > 0 ? effectiveCandleTimes[effectiveCandleTimes.length - 1] : null;
        const latestX = lastCandleTime !== null ? toX(lastCandleTime) : null;

        ctx.save();

        for (const z of zones) {
            const xStartRaw = toX(z.start_time);
            if (xStartRaw === null) continue;

            let xEndRaw: number;
            if (z.end_time) {
                const ex = toX(z.end_time);
                xEndRaw = ex !== null ? ex : xStartRaw + 60;
            } else {
                // Active zone extends cleanly slightly past the latest candle
                xEndRaw = latestX !== null ? Math.min(W - 8, latestX + 75) : Math.min(W - 8, xStartRaw + 120);
            }

            const x1 = Math.max(-20, xStartRaw);
            const x2 = Math.min(W + 20, Math.max(xStartRaw + 28, xEndRaw));
            if (x2 < 0 || x1 > W) continue;

            const yTopRaw = toY(z.zone_top);
            const yBotRaw = toY(z.zone_bottom);
            if (yTopRaw === null || yBotRaw === null) continue;

            const yTop = Math.min(yTopRaw, yBotRaw);
            const yBot = Math.max(yTopRaw, yBotRaw);
            const boxH = Math.max(10, yBot - yTop);
            const boxW = Math.max(24, x2 - x1);
            const yMid = yTop + boxH / 2;

            const isBull = z.side === 'bullish';
            const isBroken = z.status === 'BREAKDOWN';
            const isExhausting = z.status === 'EXHAUSTING';
            const isConfirmed = z.status === 'REVERSAL_CONFIRMED';

            let fillColor: string;
            let borderColor: string;
            let badgeBg: string;
            let badgeText: string;

            if (isBroken) {
                fillColor = 'rgba(148, 163, 184, 0.08)';
                borderColor = 'rgba(239, 68, 68, 0.55)';
                badgeBg = 'rgba(127, 29, 29, 0.85)';
                badgeText = '#fca5a5';
            } else if (isExhausting) {
                fillColor = 'rgba(245, 158, 11, 0.14)';
                borderColor = 'rgba(245, 158, 11, 0.75)';
                badgeBg = 'rgba(120, 53, 15, 0.88)';
                badgeText = '#fde68a';
            } else if (isBull) {
                fillColor = isConfirmed ? 'rgba(16, 185, 129, 0.20)' : 'rgba(6, 182, 212, 0.14)';
                borderColor = isConfirmed ? 'rgba(16, 185, 129, 0.85)' : 'rgba(34, 211, 238, 0.65)';
                badgeBg = isConfirmed ? 'rgba(6, 78, 59, 0.90)' : 'rgba(8, 51, 68, 0.88)';
                badgeText = isConfirmed ? '#6ee7b7' : '#67e8f9';
            } else {
                fillColor = isConfirmed ? 'rgba(244, 63, 94, 0.20)' : 'rgba(251, 113, 133, 0.14)';
                borderColor = isConfirmed ? 'rgba(244, 63, 94, 0.85)' : 'rgba(251, 146, 60, 0.65)';
                badgeBg = isConfirmed ? 'rgba(136, 19, 55, 0.90)' : 'rgba(124, 45, 18, 0.88)';
                badgeText = isConfirmed ? '#fda4af' : '#fdba74';
            }

            // 1. Zone Rectangle
            ctx.fillStyle = fillColor;
            ctx.fillRect(x1, yTop, boxW, boxH);

            ctx.strokeStyle = borderColor;
            ctx.lineWidth = z.source === 'live' ? 1.5 : 1;
            if (isBroken || isExhausting || z.source === 'historical') {
                ctx.setLineDash([4, 3]);
            } else {
                ctx.setLineDash([]);
            }
            ctx.strokeRect(x1, yTop, boxW, boxH);
            ctx.setLineDash([]);

            // 2. Swept Level Line (if sweep occurred)
            if (z.sweep_detected && z.swept_level) {
                const ySweep = toY(z.swept_level);
                if (ySweep !== null && ySweep >= 0 && ySweep <= H) {
                    ctx.beginPath();
                    ctx.strokeStyle = isBull ? 'rgba(52, 211, 153, 0.45)' : 'rgba(251, 113, 133, 0.45)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([2, 3]);
                    ctx.moveTo(Math.max(0, x1 - 24), ySweep);
                    ctx.lineTo(x1 + Math.min(48, boxW), ySweep);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
            }

            // 3. Iceberg Diamond Marker at origin bar
            if (showIcebergMarkers && z.is_iceberg && xStartRaw >= -10 && xStartRaw <= W + 10) {
                const r = z.source === 'live' ? 6 : 4.5;
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(xStartRaw, yMid - r);
                ctx.lineTo(xStartRaw + r, yMid);
                ctx.lineTo(xStartRaw, yMid + r);
                ctx.lineTo(xStartRaw - r, yMid);
                ctx.closePath();
                ctx.fillStyle = isBroken ? '#ef4444' : isBull ? '#22d3ee' : '#fb7185';
                ctx.fill();
                ctx.strokeStyle = '#0f172a';
                ctx.lineWidth = 1.2;
                ctx.stroke();
                ctx.restore();
            }

            // 4. Concise Status & Absorption Pill Label
            const parts: string[] = [];
            if (isBroken) {
                parts.push(`✕ BREAKDOWN ${z.breakdown_risk}%`);
            } else if (isExhausting) {
                parts.push(`⚠ EXHAUSTING ${z.breakdown_risk}%`);
            } else {
                if (showLiquiditySwap && z.liquidity_swap) {
                    parts.push(`⇄ SWAP`);
                }
                if (isConfirmed) {
                    parts.push(`REV ${z.reversal_score}%`);
                } else {
                    parts.push(`ABSORB ${z.reversal_score}%`);
                }
            }

            if (z.is_iceberg && showIcebergMarkers) {
                const reloadStr = z.reload_count > 0 ? `x${z.reload_count}` : '';
                parts.push(`💎${reloadStr}`);
            }

            parts.push(formatCompactUsd(z.absorbed_usd));
            if (z.source === 'live' && z.visible_wall_usd > 0 && !isBroken) {
                parts.push(`Wall:${formatCompactUsd(z.visible_wall_usd)}`);
            }

            const labelText = parts.join(' · ');
            ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
            const textMetrics = ctx.measureText(labelText);
            const pillW = textMetrics.width + 10;
            const pillH = 16;

            // Only draw label if box has enough visibility or is live
            if (z.source === 'live' || boxW >= 40) {
                const pillX = Math.min(W - pillW - 6, Math.max(4, x2 - pillW));
                const pillY = Math.max(4, Math.min(H - pillH - 4, yTop - pillH - 2 < 4 ? yTop + 2 : yTop - pillH - 2));

                ctx.fillStyle = badgeBg;
                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') {
                    ctx.roundRect(pillX, pillY, pillW, pillH, 4);
                } else {
                    ctx.rect(pillX, pillY, pillW, pillH);
                }
                ctx.fill();

                ctx.strokeStyle = borderColor;
                ctx.lineWidth = 0.8;
                ctx.stroke();

                ctx.fillStyle = badgeText;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(labelText, pillX + 5, pillY + pillH / 2 + 0.5);
            }
        }

        ctx.restore();
    }
}

class LSAPaneView implements IPrimitivePaneView {
    private _renderer: LSAPaneRenderer;

    constructor(primitive: LSAPrimitive) {
        this._renderer = new LSAPaneRenderer(primitive);
    }

    zOrder(): 'top' {
        return 'top';
    }

    renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

class LSAPrimitive implements ISeriesPrimitive<any> {
    public chart: IChartApi | null = null;
    public series: ISeriesApi<'Candlestick'> | null = null;
    public zones: LiquidityAbsorptionZone[] = [];
    public candleTimes: number[] = [];
    public candlesRef?: React.MutableRefObject<any[]>;
    public visible: boolean = true;
    public showIcebergMarkers: boolean = true;
    public showLiquiditySwap: boolean = true;

    private _requestUpdate?: () => void;
    private _paneViews: LSAPaneView[];

    constructor(
        zones: LiquidityAbsorptionZone[],
        candleTimes: number[],
        candlesRef: React.MutableRefObject<any[]> | undefined,
        visible: boolean,
        showIcebergMarkers: boolean,
        showLiquiditySwap: boolean
    ) {
        this.zones = zones;
        this.candleTimes = candleTimes;
        this.candlesRef = candlesRef;
        this.visible = visible;
        this.showIcebergMarkers = showIcebergMarkers;
        this.showLiquiditySwap = showLiquiditySwap;
        this._paneViews = [new LSAPaneView(this)];
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

    updateParams(
        zones: LiquidityAbsorptionZone[],
        candleTimes: number[],
        candlesRef: React.MutableRefObject<any[]> | undefined,
        visible: boolean,
        showIcebergMarkers: boolean,
        showLiquiditySwap: boolean
    ): void {
        this.zones = zones;
        this.candleTimes = candleTimes;
        this.candlesRef = candlesRef;
        this.visible = visible;
        this.showIcebergMarkers = showIcebergMarkers;
        this.showLiquiditySwap = showLiquiditySwap;
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

export const LiquiditySweepAbsorptionRenderer: React.FC<LiquiditySweepAbsorptionRendererProps> = ({
    chart,
    series,
    zones,
    candleTimes = [],
    candlesRef,
    visible,
    showIcebergMarkers,
    showLiquiditySwap,
    showHudSummary,
    currentPrice = 0,
}) => {
    const primitiveRef = useRef<LSAPrimitive | null>(null);

    useEffect(() => {
        if (!series || !chart) return;
        const primitive = new LSAPrimitive(
            zones,
            candleTimes,
            candlesRef,
            visible,
            showIcebergMarkers,
            showLiquiditySwap
        );
        primitiveRef.current = primitive;
        series.attachPrimitive(primitive);

        const onRangeChange = () => {
            primitive.requestUpdate();
        };
        chart.timeScale().subscribeVisibleTimeRangeChange(onRangeChange);

        return () => {
            try {
                chart.timeScale().unsubscribeVisibleTimeRangeChange(onRangeChange);
            } catch {
                // ignore
            }
            try {
                series.detachPrimitive(primitive);
            } catch {
                // ignore if chart unmounted
            }
            primitiveRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chart, series]);

    useEffect(() => {
        if (primitiveRef.current) {
            primitiveRef.current.updateParams(
                zones,
                candleTimes,
                candlesRef,
                visible,
                showIcebergMarkers,
                showLiquiditySwap
            );
        }
    }, [zones, candleTimes, candlesRef, visible, showIcebergMarkers, showLiquiditySwap]);

    const summary = useMemo(() => {
        if (!visible || !showHudSummary) return null;
        const activeZones = zones.filter((z) => z.status !== 'BREAKDOWN');
        const liveActive = activeZones.filter((z) => z.source === 'live');
        const brokenRecent = zones.filter((z) => z.status === 'BREAKDOWN').slice(-2);

        // Find nearest active zone to currentPrice (or latest active zone)
        let focusZone: LiquidityAbsorptionZone | null = null;
        if (activeZones.length > 0) {
            if (currentPrice > 0) {
                focusZone = activeZones.reduce((best, cur) =>
                    Math.abs(cur.price - currentPrice) < Math.abs(best.price - currentPrice) ? cur : best
                );
            } else {
                focusZone = activeZones[activeZones.length - 1];
            }
        }

        const totalLiveAbsorbed = liveActive.reduce((acc, z) => acc + z.absorbed_usd, 0);
        const totalReloads = liveActive.reduce((acc, z) => acc + z.reload_count, 0);

        return {
            activeCount: activeZones.length,
            liveCount: liveActive.length,
            brokenCount: brokenRecent.length,
            totalLiveAbsorbed,
            totalReloads,
            focusZone,
        };
    }, [visible, showHudSummary, zones, currentPrice]);

    if (!visible || !showHudSummary || !summary) return null;

    const focus = summary.focusZone;
    const isBull = focus?.side === 'bullish';
    const isExhausting = focus?.status === 'EXHAUSTING';
    const isConfirmed = focus?.status === 'REVERSAL_CONFIRMED';

    return (
        <div className="absolute bottom-10 left-3 z-20 pointer-events-none select-none">
            <div className="bg-[#0b0f19]/85 backdrop-blur-md border border-cyan-500/30 rounded-lg px-3 py-2 shadow-xl text-[11px] font-mono text-gray-200 max-w-[320px]">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-1 mb-1">
                    <span className="font-bold text-cyan-400 tracking-wide uppercase text-[10px]">
                        Sweep · Swap · Iceberg
                    </span>
                    <span className="text-[10px] text-gray-400">
                        Live: <strong className="text-white">{summary.liveCount}</strong> | Zones:{' '}
                        <strong className="text-white">{summary.activeCount}</strong>
                    </span>
                </div>

                {focus ? (
                    <div className="space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                            <span
                                className={`font-bold ${
                                    isExhausting
                                        ? 'text-amber-400'
                                        : isBull
                                        ? 'text-emerald-400'
                                        : 'text-rose-400'
                                }`}
                            >
                                {isExhausting
                                    ? '⚠ WALL EXHAUSTING'
                                    : isConfirmed
                                    ? isBull
                                        ? '▲ BULLISH REVERSAL ZONE'
                                        : '▼ BEARISH REVERSAL ZONE'
                                    : isBull
                                    ? '🛡 BID ABSORBING'
                                    : '🛡 ASK ABSORBING'}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/10 text-white font-bold">
                                {isExhausting
                                    ? `BreakRisk ${focus.breakdown_risk}%`
                                    : `Rev ${focus.reversal_score}%`}
                            </span>
                        </div>
                        <div className="text-[10px] text-gray-300 flex items-center justify-between gap-2">
                            <span>
                                Level: <strong className="text-white">{focus.price}</strong>
                            </span>
                            <span>
                                Absorbed:{' '}
                                <strong className="text-cyan-300">
                                    {formatCompactUsd(focus.absorbed_usd)}
                                </strong>
                            </span>
                        </div>
                        <div className="text-[10px] text-gray-400 flex items-center justify-between gap-2">
                            <span>
                                {focus.is_iceberg
                                    ? `💎 Iceberg${focus.reload_count > 0 ? ` (x${focus.reload_count} reloads)` : ''}`
                                    : 'Absorption Zone'}
                            </span>
                            <span>
                                {focus.liquidity_swap ? '⇄ Liq Swap Confirmed' : focus.sweep_detected ? '⚡ Sweep Active' : 'Defending'}
                            </span>
                        </div>
                    </div>
                ) : (
                    <div className="text-[10px] text-gray-400">
                        Scanning live L2 book &amp; tape for sweeps / icebergs...
                    </div>
                )}
            </div>
        </div>
    );
};
