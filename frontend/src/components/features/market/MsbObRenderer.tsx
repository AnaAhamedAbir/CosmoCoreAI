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

        const getX = (time: any): number | null => {
            if (time === undefined || time === null) return null;
            let ts = time;
            if (typeof time === 'number' && time > 10_000_000_000) {
                ts = Math.floor(time / 1000);
            }
            try {
                return timeScale.timeToCoordinate(ts as any);
            } catch {
                return null;
            }
        };

        const getY = (price: number): number | null => {
            if (typeof price !== 'number' || isNaN(price)) return null;
            try {
                return series.priceToCoordinate(price);
            } catch {
                return null;
            }
        };

        const startIdx = Math.max(0, Math.floor(logicalRange.from) - 5);
        const endIdx = Math.min(data.points.length - 1, Math.ceil(logicalRange.to) + 5);

        ctx.save();

        // --- 1. Draw ZigZag ---
        if (showZigzag) {
            const zPoints = (data.zigzagPoints && data.zigzagPoints.length > 0)
                ? data.zigzagPoints
                : data.points.filter((p) => p.isHigh || p.isLow);

            if (zPoints.length > 0) {
                ctx.beginPath();
                ctx.setLineDash([3, 3]);
                ctx.strokeStyle = '#f97316';
                ctx.lineWidth = 1.5;

                let started = false;
                for (const zp of zPoints) {
                    const x = getX(zp.time);
                    const price = 'price' in zp ? (zp as any).price : (zp.isHigh ? zp.high : zp.low);
                    const y = getY(price);
                    if (x !== null && y !== null) {
                        if (!started) {
                            ctx.moveTo(x, y);
                            started = true;
                        } else {
                            ctx.lineTo(x, y);
                        }
                    }
                }
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        // --- 2. Draw Zones (OB/BB) ---
        const viewWidth = width;
        data.zones.forEach((zone) => {
            const startTime = zone.startTime ?? ohlcData[zone.startX]?.time;
            const startX = getX(startTime);

            let endX: number | null = null;
            if (zone.endTime) {
                endX = getX(zone.endTime);
            } else if (zone.endX < ohlcData.length) {
                endX = getX(ohlcData[zone.endX]?.time);
            }
            if (endX === null) {
                endX = viewWidth + 50;
            }

            // Allow zones starting prior to visible range to display across visible screen
            let resolvedStartX = startX;
            if (resolvedStartX === null) {
                if (zone.startX < startIdx) {
                    resolvedStartX = -10;
                }
            }

            if (resolvedStartX === null) return;
            if (endX < -50 || resolvedStartX > viewWidth + 50) return;

            const topY = getY(zone.top);
            const bottomY = getY(zone.bottom);

            if (topY !== null && bottomY !== null) {
                const isBull = zone.type.startsWith('Bu');
                const bgColor = isBull ? 'rgba(34, 197, 94, 0.18)' : 'rgba(239, 68, 68, 0.18)';
                const borderColor = isBull ? 'rgba(34, 197, 94, 0.65)' : 'rgba(239, 68, 68, 0.65)';
                const textColor = isBull ? '#22c55e' : '#ef4444';

                const boxLeft = Math.max(-10, Math.min(resolvedStartX, endX));
                const boxRight = Math.min(viewWidth + 50, Math.max(resolvedStartX, endX));
                const boxTop = Math.min(topY, bottomY);
                const boxHeight = Math.max(2, Math.abs(bottomY - topY));
                const boxWidth = Math.max(2, boxRight - boxLeft);

                ctx.fillStyle = bgColor;
                ctx.fillRect(boxLeft, boxTop, boxWidth, boxHeight);
                ctx.strokeStyle = borderColor;
                ctx.lineWidth = 1;
                ctx.strokeRect(boxLeft, boxTop, boxWidth, boxHeight);

                ctx.font = 'bold 9px Inter, sans-serif';
                ctx.fillStyle = textColor;
                ctx.textAlign = 'right';
                ctx.fillText(zone.type, Math.min(viewWidth - 6, boxRight - 4), boxTop + 11);
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

                    ctx.save();
                    ctx.beginPath();
                    ctx.setLineDash([4, 2]);
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.5;
                    const prevX = getX(ohlcData[Math.max(0, i - 10)]?.time);
                    const lineStartX = prevX !== null ? prevX : x - 50;
                    ctx.moveTo(lineStartX, y);
                    ctx.lineTo(x, y);
                    ctx.stroke();

                    ctx.font = 'bold 10px Inter, sans-serif';
                    ctx.fillStyle = color;
                    ctx.textAlign = 'center';
                    const labelY = isBull ? y - 12 : y + 20;
                    ctx.fillText(`MSB (${isBull ? '▲' : '▼'})`, x, labelY);
                    ctx.restore();
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
