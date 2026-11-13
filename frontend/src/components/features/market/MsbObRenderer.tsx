import React, { useEffect, useRef } from 'react';
import {
    IChartApi,
    ISeriesApi,
    ISeriesPrimitive,
    IPrimitivePaneView,
    IPrimitivePaneRenderer,
    SeriesAttachedParameter
} from 'lightweight-charts';
import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { MsbObResult } from '../../../utils/indicators';

interface MsbObRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    data: MsbObResult;
    ohlcData: { time: any; high: number; low: number; close: number; open: number }[];
    showZigzag: boolean;
}

class MsbObRendererImpl implements IPrimitivePaneRenderer {
    private _primitive: MsbObPrimitive;

    constructor(primitive: MsbObPrimitive) {
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
        const ohlcData = this._primitive.ohlcData;
        const showZigzag = this._primitive.showZigzag;

        if (!chart || !series || !data || data.points.length === 0) return;

        const timeScale = chart.timeScale();
        const priceScale = series.priceScale();
        if (!timeScale || !priceScale) return;

        const logicalRange = timeScale.getVisibleLogicalRange();
        if (!logicalRange) return;

        const getX = (time: any) => timeScale.timeToCoordinate(time);
        const getY = (price: number) => series.priceToCoordinate(price);

        const startIdx = Math.max(0, Math.floor(logicalRange.from) - 5);
        const endIdx = Math.min(data.points.length - 1, Math.ceil(logicalRange.to) + 5);

        ctx.save();

        // --- 1. Draw ZigZag ---
        if (showZigzag) {
            let lastX: number | null = null;
            let lastY: number | null = null;

            ctx.beginPath();
            ctx.setLineDash([2, 4]);
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = 1;

            for (let i = startIdx; i <= endIdx; i++) {
                const pt = data.points[i];
                if (pt && pt.zigzagPrice !== null) {
                    const x = getX(pt.time);
                    const y = getY(pt.zigzagPrice);
                    if (x !== null && y !== null) {
                        if (lastX !== null && lastY !== null) {
                            ctx.moveTo(lastX, lastY);
                            ctx.lineTo(x, y);
                        }
                        lastX = x;
                        lastY = y;
                    }
                }
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // --- 2. Draw Zones (OB/BB) ---
        const viewWidth = width;
        data.zones.forEach((zone) => {
            const startX = getX(ohlcData[zone.startX]?.time);
            const endX = getX(ohlcData[Math.min(zone.endX, ohlcData.length - 1)]?.time) || viewWidth + 50;
            if (startX !== null && endX < -50) return;
            if (startX !== null && startX > viewWidth + 50) return;

            const topY = getY(zone.top);
            const bottomY = getY(zone.bottom);

            if (startX !== null && topY !== null && bottomY !== null) {
                const isBull = zone.type.startsWith('Bu');
                const bgColor = isBull ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)';
                const borderColor = isBull ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)';
                const textColor = isBull ? '#22c55e' : '#ef4444';

                const zWidth = endX - startX;
                const zHeight = bottomY - topY;

                ctx.fillStyle = bgColor;
                ctx.fillRect(startX, topY, zWidth, zHeight);
                ctx.strokeStyle = borderColor;
                ctx.lineWidth = 1;
                ctx.strokeRect(startX, topY, zWidth, zHeight);

                ctx.font = 'bold 9px Inter, sans-serif';
                ctx.fillStyle = textColor;
                ctx.textAlign = 'right';
                ctx.fillText(zone.type, Math.min(viewWidth - 5, endX - 2), topY + 12);
            }
        });

        // --- 3. Draw MSB Labels & Lines ---
        for (let i = startIdx; i <= endIdx; i++) {
            const pt = data.points[i];
            if (pt && pt.msbType && pt.msbPrice !== null) {
                const x = getX(pt.time);
                const y = getY(pt.msbPrice);

                if (x !== null && y !== null) {
                    const isBull = pt.msbType === 'Bullish';
                    const color = isBull ? '#22c55e' : '#ef4444';

                    ctx.beginPath();
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;
                    const startX = getX(ohlcData[Math.max(0, i - 10)]?.time) || x - 50;
                    ctx.moveTo(startX, y);
                    ctx.lineTo(x, y);
                    ctx.stroke();

                    ctx.font = 'bold 10px Inter, sans-serif';
                    ctx.fillStyle = color;
                    ctx.textAlign = 'center';
                    const labelY = isBull ? y - 15 : y + 25;
                    ctx.fillText('MSB', x, labelY);
                }
            }
        }

        ctx.restore();
    }
}

class MsbObPaneView implements IPrimitivePaneView {
    private _renderer: MsbObRendererImpl;

    constructor(primitive: MsbObPrimitive) {
        this._renderer = new MsbObRendererImpl(primitive);
    }

    zOrder(): 'bottom' {
        return 'bottom';
    }

    renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

class MsbObPrimitive implements ISeriesPrimitive<any> {
    public chart: IChartApi | null = null;
    public series: ISeriesApi<'Candlestick'> | null = null;
    public data: MsbObResult;
    public ohlcData: { time: any; high: number; low: number; close: number; open: number }[];
    public showZigzag: boolean = false;

    private _requestUpdate?: () => void;
    private _paneViews: MsbObPaneView[];

    constructor(
        data: MsbObResult,
        ohlcData: { time: any; high: number; low: number; close: number; open: number }[],
        showZigzag: boolean
    ) {
        this.data = data;
        this.ohlcData = ohlcData;
        this.showZigzag = showZigzag;
        this._paneViews = [new MsbObPaneView(this)];
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
        data: MsbObResult,
        ohlcData: { time: any; high: number; low: number; close: number; open: number }[],
        showZigzag: boolean
    ): void {
        this.data = data;
        this.ohlcData = ohlcData;
        this.showZigzag = showZigzag;
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

export const MsbObRenderer: React.FC<MsbObRendererProps> = ({
    chart,
    series,
    data,
    ohlcData,
    showZigzag,
}) => {
    const primitiveRef = useRef<MsbObPrimitive | null>(null);

    useEffect(() => {
        if (!series || !chart) return;

        const primitive = new MsbObPrimitive(data, ohlcData, showZigzag);
        primitiveRef.current = primitive;
        series.attachPrimitive(primitive);

        return () => {
            try {
                series.detachPrimitive(primitive);
            } catch (e) {}
            primitiveRef.current = null;
        };
    }, [chart, series]);

    useEffect(() => {
        if (primitiveRef.current) {
            primitiveRef.current.updateParams(data, ohlcData, showZigzag);
        }
    }, [data, ohlcData, showZigzag]);

    return null;
};
