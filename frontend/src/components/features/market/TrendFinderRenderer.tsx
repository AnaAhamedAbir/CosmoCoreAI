import React, { useEffect, useRef } from 'react';
import {
    IChartApi,
    ISeriesApi,
    LineSeries,
    ISeriesPrimitive,
    IPrimitivePaneView,
    IPrimitivePaneRenderer,
    SeriesAttachedParameter
} from 'lightweight-charts';
import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { TrendFinderResult } from '../../../utils/indicators';

interface TrendFinderRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    data: TrendFinderResult | null;
    visible?: boolean;
    threshold?: string;
    hideLowConfidenceTrend?: boolean;
}

class TrendFinderPrimitiveRenderer implements IPrimitivePaneRenderer {
    private _primitive: TrendFinderPrimitive;

    constructor(primitive: TrendFinderPrimitive) {
        this._primitive = primitive;
    }

    draw(target: CanvasRenderingTarget2D): void {
        target.useMediaCoordinateSpace((scope) => {
            const ctx = scope.context;
            this._drawContent(ctx, scope.mediaSize.width, scope.mediaSize.height);
        });
    }

    private _drawContent(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        const chart = this._primitive.chart;
        const series = this._primitive.series;
        const data = this._primitive.data;
        const visible = this._primitive.visible;
        const threshold = this._primitive.threshold;
        const hideLowConfidenceTrend = this._primitive.hideLowConfidenceTrend;

        if (!chart || !series || !visible || !data || data.points.length === 0) return;

        const timeScale = chart.timeScale();
        const priceScale = series.priceScale();
        if (!timeScale || !priceScale) return;

        const isBearish = data.trendDirection === 'bearish';

        const confidence_levels: { [key: string]: number } = {
            'Extremely Weak': 0.1,
            'Very Weak': 0.2,
            'Weak': 0.3,
            'Mostly Weak': 0.4,
            'Somewhat Weak': 0.5,
            'Moderately Weak': 0.6,
            'Moderate': 0.7,
            'Moderately Strong': 0.8,
            'Mostly Strong': 0.9,
            'Strong': 0.92,
            'Very Strong': 0.94,
            'Exceptionally Strong': 0.96,
            'Ultra Strong': 0.98
        };

        const currentConf = confidence_levels[data.confidence] || 0.1;
        const targetConf = confidence_levels[threshold] || 0.92;
        const isMet = currentConf >= targetConf;

        if (hideLowConfidenceTrend && !isMet) {
            return;
        }

        ctx.save();

        // Rounded rect helper
        const roundedRect = (x: number, y: number, w: number, h: number, r: number) => {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r);
            ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        };

        // --- DRAW TOP TREND BADGE ---
        const badgeX = 20;
        const badgeY = 20;
        const badgeWidth = 240;
        const badgeHeight = 35;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.strokeStyle = isMet ? (isBearish ? '#ef4444' : '#22c55e') : 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 8);

        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('TREND', badgeX + 10, badgeY + 22);

        ctx.font = '900 12px Inter, sans-serif';
        const statusColor = isMet ? (isBearish ? '#ef4444' : '#22c55e') : '#64748b';
        ctx.fillStyle = statusColor;
        const displayStatus = `${data.trendDirection.toUpperCase()} | ${data.confidence.toUpperCase()}`;
        ctx.fillText(displayStatus, badgeX + 50, badgeY + 22);

        // --- DRAW BOTTOM VOLUME BADGE ---
        const volBadgeX = 20;
        const volBadgeY = height - 55;
        const volBadgeWidth = 180;
        const volBadgeHeight = 30;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.strokeStyle = data.volumeConfirmed ? '#22c55e' : '#ef4444';
        ctx.lineWidth = 1;
        roundedRect(volBadgeX, volBadgeY, volBadgeWidth, volBadgeHeight, 6);

        const formatVol = (v: number) => {
            if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
            if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
            return v.toFixed(0);
        };

        ctx.font = 'bold 9px Inter, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('VOL CONFIRMATION', volBadgeX + 10, volBadgeY + 18);

        const volText = `${formatVol(data.currentVolume)} / ${formatVol(data.requiredVolume)}`;
        const volColor = data.volumeConfirmed ? '#22c55e' : '#ef4444';
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.fillStyle = volColor;
        ctx.fillText(volText, volBadgeX + 105, volBadgeY + 18);

        // --- DRAW CLOUD ---
        const opacity = isMet ? 0.25 : 0.08;
        ctx.fillStyle = isBearish
            ? `rgba(239, 68, 68, ${opacity})`
            : `rgba(34, 197, 94, ${opacity})`;

        ctx.beginPath();
        let started = false;

        // 1. Draw top band going FORWARDS
        for (let i = 0; i < data.points.length; i++) {
            const pt = data.points[i];
            const x = timeScale.timeToCoordinate(pt.time as any);
            const yTop = series.priceToCoordinate(pt.upper);
            if (x !== null && yTop !== null) {
                if (!started) {
                    ctx.moveTo(x, yTop);
                    started = true;
                } else {
                    ctx.lineTo(x, yTop);
                }
            }
        }

        // 2. Draw bottom band going BACKWARDS
        for (let i = data.points.length - 1; i >= 0; i--) {
            const pt = data.points[i];
            const x = timeScale.timeToCoordinate(pt.time as any);
            const yBot = series.priceToCoordinate(pt.lower);
            if (x !== null && yBot !== null) {
                ctx.lineTo(x, yBot);
            }
        }

        if (started) {
            ctx.closePath();
            ctx.fill();
        }

        ctx.restore();
    }
}

class TrendFinderPaneView implements IPrimitivePaneView {
    private _renderer: TrendFinderPrimitiveRenderer;

    constructor(primitive: TrendFinderPrimitive) {
        this._renderer = new TrendFinderPrimitiveRenderer(primitive);
    }

    zOrder(): 'bottom' {
        return 'bottom';
    }

    renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

class TrendFinderPrimitive implements ISeriesPrimitive<any> {
    public chart: IChartApi | null = null;
    public series: ISeriesApi<'Candlestick'> | null = null;
    public data: TrendFinderResult | null = null;
    public visible: boolean = true;
    public threshold: string = 'Strong';
    public hideLowConfidenceTrend: boolean = false;

    private _requestUpdate?: () => void;
    private _paneViews: TrendFinderPaneView[];

    constructor(
        data: TrendFinderResult | null,
        visible: boolean,
        threshold: string,
        hideLowConfidenceTrend: boolean
    ) {
        this.data = data;
        this.visible = visible;
        this.threshold = threshold;
        this.hideLowConfidenceTrend = hideLowConfidenceTrend;
        this._paneViews = [new TrendFinderPaneView(this)];
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
        data: TrendFinderResult | null,
        visible: boolean,
        threshold: string,
        hideLowConfidenceTrend: boolean
    ): void {
        this.data = data;
        this.visible = visible;
        this.threshold = threshold;
        this.hideLowConfidenceTrend = hideLowConfidenceTrend;
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

export const TrendFinderRenderer: React.FC<TrendFinderRendererProps> = ({
    chart,
    series,
    data,
    visible = true,
    threshold = 'Strong',
    hideLowConfidenceTrend = false,
}) => {
    const midlineRef = useRef<ISeriesApi<'Line'> | null>(null);
    const upperLineRef = useRef<ISeriesApi<'Line'> | null>(null);
    const lowerLineRef = useRef<ISeriesApi<'Line'> | null>(null);
    const initedRef = useRef<boolean>(false);
    const primitiveRef = useRef<TrendFinderPrimitive | null>(null);

    // Setup native LineSeries for Mid/Upper/Lower
    useEffect(() => {
        if (!chart || !series) return;

        if (!initedRef.current) {
            midlineRef.current = chart.addSeries(LineSeries, {
                color: '#3b82f6',
                lineWidth: 1,
                lastValueVisible: false,
                priceLineVisible: false,
                crosshairMarkerVisible: false,
            });

            upperLineRef.current = chart.addSeries(LineSeries, {
                color: '#22c55e',
                lineWidth: 1,
                lastValueVisible: false,
                priceLineVisible: false,
                crosshairMarkerVisible: false,
            });

            lowerLineRef.current = chart.addSeries(LineSeries, {
                color: '#ef4444',
                lineWidth: 1,
                lastValueVisible: false,
                priceLineVisible: false,
                crosshairMarkerVisible: false,
            });

            initedRef.current = true;
        }

        const primitive = new TrendFinderPrimitive(data, visible, threshold, hideLowConfidenceTrend);
        primitiveRef.current = primitive;
        series.attachPrimitive(primitive);

        return () => {
            if (chart) {
                if (midlineRef.current) {
                    try { chart.removeSeries(midlineRef.current); } catch(e) {}
                    midlineRef.current = null;
                }
                if (upperLineRef.current) {
                    try { chart.removeSeries(upperLineRef.current); } catch(e) {}
                    upperLineRef.current = null;
                }
                if (lowerLineRef.current) {
                    try { chart.removeSeries(lowerLineRef.current); } catch(e) {}
                    lowerLineRef.current = null;
                }
                initedRef.current = false;
            }
            try {
                series.detachPrimitive(primitive);
            } catch (e) {}
            primitiveRef.current = null;
        };
    }, [chart, series]);

    useEffect(() => {
        if (primitiveRef.current) {
            primitiveRef.current.updateParams(data, visible, threshold, hideLowConfidenceTrend);
        }

        if (!visible || !data || !initedRef.current) {
            midlineRef.current?.setData([]);
            upperLineRef.current?.setData([]);
            lowerLineRef.current?.setData([]);
            return;
        }

        try {
            const validPoints = data.points.filter((p: any) =>
                p && p.time &&
                !isNaN(p.value) && isFinite(p.value) &&
                !isNaN(p.upper) && isFinite(p.upper) &&
                !isNaN(p.lower) && isFinite(p.lower)
            );

            const deduplicated: any[] = [];
            const seenTimes = new Set<number>();

            for (const p of validPoints) {
                const t = Number(p.time);
                if (!seenTimes.has(t)) {
                    seenTimes.add(t);
                    deduplicated.push(p);
                }
            }

            deduplicated.sort((a, b) => Number(a.time) - Number(b.time));

            if (deduplicated.length > 0) {
                const midData = deduplicated.map(p => ({ time: p.time as any, value: p.value }));
                const upperData = deduplicated.map(p => ({ time: p.time as any, value: p.upper }));
                const lowerData = deduplicated.map(p => ({ time: p.time as any, value: p.lower }));

                midlineRef.current?.setData(midData);
                upperLineRef.current?.setData(upperData);
                lowerLineRef.current?.setData(lowerData);
            } else {
                midlineRef.current?.setData([]);
                upperLineRef.current?.setData([]);
                lowerLineRef.current?.setData([]);
            }
        } catch (err) {
            console.error('[TrendFinderRenderer] Error setting data:', err);
        }
    }, [data, visible, threshold, hideLowConfidenceTrend]);

    return null;
};
