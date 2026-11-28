import React, { useEffect, useRef } from 'react';
import type {
    IChartApi,
    ISeriesApi,
    ISeriesPrimitive,
    IPrimitivePaneView,
    IPrimitivePaneRenderer,
    SeriesAttachedParameter,
} from 'lightweight-charts';
import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { safeDetachPrimitive } from '@/utils/chartLifecycle';

interface LiquidationHeatmapGodModeRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    data: any; // godModeData
    visible: boolean;
}

class GodModeZonePaneRenderer implements IPrimitivePaneRenderer {
    private _primitive: GodModeZonePrimitive;

    constructor(primitive: GodModeZonePrimitive) {
        this._primitive = primitive;
    }

    draw(target: CanvasRenderingTarget2D): void {
        target.useMediaCoordinateSpace((scope) => {
            this._drawContent(scope.context, scope.mediaSize.width, scope.mediaSize.height);
        });
    }

    private _drawContent(ctx: CanvasRenderingContext2D, W: number, H: number): void {
        const { series, data, visible } = this._primitive;
        if (!series || !data || !visible || W <= 0 || H <= 0) return;

        const currentPrice = Number(data.current_price);
        if (!Number.isFinite(currentPrice) || currentPrice <= 0) return;

        const magnetZones = data.magnet_zones || [];
        if (magnetZones.length === 0) return;

        ctx.save();

        magnetZones.forEach((zone: any) => {
            const price = parseFloat(zone.price);
            const intensity = parseInt(zone.intensity, 10);
            if (!Number.isFinite(price) || !Number.isFinite(intensity) || intensity < 10) return;

            let y: number | null = null;
            try {
                y = series.priceToCoordinate(price);
            } catch {
                return;
            }
            if (y === null || y < -100 || y > H + 100) return;

            const isShort = price > currentPrice;
            const height = Math.max(4, Math.min(24, (intensity / 100) * 24));
            const normalizedIntensity = Math.min(100, Math.max(10, intensity));
            const opacity = Math.min(0.3, (normalizedIntensity / 100) * 0.25);
            const glowOpacity = Math.min(0.4, (normalizedIntensity / 100) * 0.2);
            const blurRadius = Math.min(10, height * 0.5);
            const top = y - height / 2;

            ctx.shadowColor = isShort
                ? `rgba(244, 63, 94, ${glowOpacity})`
                : `rgba(16, 185, 129, ${glowOpacity})`;
            ctx.shadowBlur = blurRadius;
            ctx.fillStyle = isShort
                ? `rgba(244, 63, 94, ${opacity})`
                : `rgba(16, 185, 129, ${opacity})`;
            ctx.fillRect(0, top, W, height);
            ctx.shadowBlur = 0;

            ctx.beginPath();
            ctx.strokeStyle = isShort
                ? `rgba(244, 63, 94, ${opacity + 0.1})`
                : `rgba(16, 185, 129, ${opacity + 0.1})`;
            ctx.lineWidth = 1;
            const borderY = isShort ? top : top + height;
            ctx.moveTo(0, borderY);
            ctx.lineTo(W, borderY);
            ctx.stroke();

            ctx.fillStyle = isShort ? 'rgba(255,228,230,0.85)' : 'rgba(209,250,229,0.85)';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(`LIQ ${intensity}%`, W - 6, y);
        });

        ctx.restore();
    }
}

class GodModeZonePaneView implements IPrimitivePaneView {
    private _renderer: GodModeZonePaneRenderer;

    constructor(primitive: GodModeZonePrimitive) {
        this._renderer = new GodModeZonePaneRenderer(primitive);
    }

    zOrder(): 'bottom' {
        return 'bottom';
    }

    renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

class GodModeZonePrimitive implements ISeriesPrimitive<any> {
    public chart: IChartApi | null = null;
    public series: ISeriesApi<'Candlestick'> | null = null;
    public data: any = null;
    public visible = false;

    private _requestUpdate?: () => void;
    private _paneViews: GodModeZonePaneView[];

    constructor() {
        this._paneViews = [new GodModeZonePaneView(this)];
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

    updateParams(data: any, visible: boolean): void {
        this.data = data;
        this.visible = visible;
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

export const LiquidationHeatmapGodModeRenderer: React.FC<LiquidationHeatmapGodModeRendererProps> = ({
    chart,
    series,
    data,
    visible,
}) => {
    const primitiveRef = useRef<GodModeZonePrimitive | null>(null);

    useEffect(() => {
        if (!chart || !series) return;
        const primitive = new GodModeZonePrimitive();
        primitiveRef.current = primitive;
        series.attachPrimitive(primitive);
        primitive.updateParams(data, visible);

        return () => {
            safeDetachPrimitive(chart, series, primitive);
            primitiveRef.current = null;
        };
    }, [chart, series]);

    useEffect(() => {
        primitiveRef.current?.updateParams(data, visible);
    }, [data, visible]);

    return null;
};
