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
import { SupertrendDataPoint } from '../../../utils/indicators';

interface SupertrendRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    data: SupertrendDataPoint[];
    ohlcData?: any[];
    showSignals?: boolean;
    highlighter?: boolean;
}

class SupertrendRendererImpl implements IPrimitivePaneRenderer {
    private _primitive: SupertrendPrimitive;

    constructor(primitive: SupertrendPrimitive) {
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
        const showSignals = this._primitive.showSignals;
        const highlighter = this._primitive.highlighter;

        if (!chart || !series || data.length === 0) return;

        const timeScale = chart.timeScale();
        const priceScale = series.priceScale();
        if (!timeScale || !priceScale) return;

        const logicalRange = timeScale.getVisibleLogicalRange();
        if (!logicalRange) return;

        const getX = (time: any) => timeScale.timeToCoordinate(time as any);

        const startIdx = Math.max(0, Math.floor(logicalRange.from) - 3);
        const endIdx = Math.min(data.length - 1, Math.ceil(logicalRange.to) + 3);
        if (startIdx >= endIdx) return;

        ctx.save();

        // --- 1. Draw Trend Lines and Highlighter ---
        for (let i = startIdx; i < endIdx; i++) {
            const pt1 = data[i];
            const pt2 = data[i + 1];
            if (!pt1 || !pt2) continue;

            const x1 = getX(pt1.time);
            const x2 = getX(pt2.time);
            if (x1 === null || x2 === null) continue;
            if (x2 < 0 || x1 > width) continue;

            const isUp = pt2.trend === 1;
            const color = isUp ? '#22c55e' : '#ef4444'; // Green / Red

            if (pt1.trend === pt2.trend) {
                const y1 = series.priceToCoordinate(pt1.value);
                const y2 = series.priceToCoordinate(pt2.value);
                if (y1 !== null && y2 !== null) {
                    // Line
                    ctx.beginPath();
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.5;
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();

                    // Highlighter (Area fill between Supertrend and OHLC4)
                    if (highlighter) {
                        const p1 = pt1.ohlc4 !== undefined ? pt1.ohlc4 : pt1.value;
                        const p2 = pt2.ohlc4 !== undefined ? pt2.ohlc4 : pt2.value;
                        const py1 = series.priceToCoordinate(p1);
                        const py2 = series.priceToCoordinate(p2);

                        if (py1 !== null && py2 !== null) {
                            ctx.beginPath();
                            ctx.fillStyle = isUp ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)';
                            ctx.moveTo(x1, y1);
                            ctx.lineTo(x2, y2);
                            ctx.lineTo(x2, py2);
                            ctx.lineTo(x1, py1);
                            ctx.closePath();
                            ctx.fill();
                        }
                    }
                }
            }
        }

        // --- 2. Draw Buy/Sell Signals ---
        if (showSignals) {
            for (let i = startIdx; i <= endIdx; i++) {
                const pt = data[i];
                if (!pt || (!pt.isBuy && !pt.isSell)) continue;

                const x = getX(pt.time);
                if (x === null || x < 0 || x > width) continue;

                if (pt.isBuy) {
                    const low = pt.low !== undefined ? pt.low : pt.value;
                    const y = series.priceToCoordinate(low);
                    if (y === null) continue;

                    const buyY = y + 70;
                    const pillWidth = 45;
                    const pillHeight = 22;
                    const radius = 6;

                    // Draw Dotted Line
                    ctx.beginPath();
                    ctx.setLineDash([3, 3]);
                    ctx.strokeStyle = 'rgba(34, 197, 94, 0.4)';
                    ctx.moveTo(x, y);
                    ctx.lineTo(x, buyY);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // Draw Pill
                    ctx.beginPath();
                    if (typeof ctx.roundRect === 'function') {
                        ctx.roundRect(x - pillWidth / 2, buyY, pillWidth, pillHeight, radius);
                    } else {
                        ctx.rect(x - pillWidth / 2, buyY, pillWidth, pillHeight);
                    }
                    ctx.fillStyle = '#22c55e';
                    ctx.fill();

                    // Draw Arrow Icon (Triangle)
                    ctx.beginPath();
                    ctx.moveTo(x - 12, buyY + 14);
                    ctx.lineTo(x - 8, buyY + 8);
                    ctx.lineTo(x - 4, buyY + 14);
                    ctx.fillStyle = 'white';
                    ctx.fill();

                    // Draw Text
                    ctx.font = 'bold 11px Inter, sans-serif';
                    ctx.fillStyle = 'white';
                    ctx.textAlign = 'left';
                    ctx.fillText('BUY', x, buyY + 15);
                } else if (pt.isSell) {
                    const high = pt.high !== undefined ? pt.high : pt.value;
                    const y = series.priceToCoordinate(high);
                    if (y === null) continue;

                    const sellY = y - 70;
                    const pillWidth = 45;
                    const pillHeight = 22;
                    const radius = 6;

                    // Draw Dotted Line
                    ctx.beginPath();
                    ctx.setLineDash([3, 3]);
                    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
                    ctx.moveTo(x, y);
                    ctx.lineTo(x, sellY + pillHeight);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // Draw Pill
                    ctx.beginPath();
                    if (typeof ctx.roundRect === 'function') {
                        ctx.roundRect(x - pillWidth / 2, sellY, pillWidth, pillHeight, radius);
                    } else {
                        ctx.rect(x - pillWidth / 2, sellY, pillWidth, pillHeight);
                    }
                    ctx.fillStyle = '#ef4444';
                    ctx.fill();

                    // Draw Arrow Icon (Triangle Down)
                    ctx.beginPath();
                    ctx.moveTo(x - 12, sellY + 8);
                    ctx.lineTo(x - 8, sellY + 14);
                    ctx.lineTo(x - 4, sellY + 8);
                    ctx.fillStyle = 'white';
                    ctx.fill();

                    // Draw Text
                    ctx.font = 'bold 11px Inter, sans-serif';
                    ctx.fillStyle = 'white';
                    ctx.textAlign = 'left';
                    ctx.fillText('SELL', x, sellY + 15);
                }
            }
        }

        ctx.restore();
    }
}

class SupertrendPaneView implements IPrimitivePaneView {
    private _renderer: SupertrendRendererImpl;

    constructor(primitive: SupertrendPrimitive) {
        this._renderer = new SupertrendRendererImpl(primitive);
    }

    zOrder(): 'bottom' {
        return 'bottom';
    }

    renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

class SupertrendPrimitive implements ISeriesPrimitive<any> {
    public chart: IChartApi | null = null;
    public series: ISeriesApi<'Candlestick'> | null = null;
    public data: SupertrendDataPoint[] = [];
    public showSignals: boolean = true;
    public highlighter: boolean = true;

    private _requestUpdate?: () => void;
    private _paneViews: SupertrendPaneView[];

    constructor(data: SupertrendDataPoint[], showSignals: boolean, highlighter: boolean) {
        this.data = data;
        this.showSignals = showSignals;
        this.highlighter = highlighter;
        this._paneViews = [new SupertrendPaneView(this)];
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

    updateParams(data: SupertrendDataPoint[], showSignals: boolean, highlighter: boolean): void {
        this.data = data;
        this.showSignals = showSignals;
        this.highlighter = highlighter;
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

export const SupertrendRenderer: React.FC<SupertrendRendererProps> = ({
    chart,
    series,
    data,
    showSignals = true,
    highlighter = true,
}) => {
    const primitiveRef = useRef<SupertrendPrimitive | null>(null);

    useEffect(() => {
        if (!series || !chart) return;

        const primitive = new SupertrendPrimitive(data, showSignals, highlighter);
        primitiveRef.current = primitive;
        series.attachPrimitive(primitive);

        return () => {
            try {
                series.detachPrimitive(primitive);
            } catch (e) {
                // Ignore detachment error if series already destroyed
            }
            primitiveRef.current = null;
        };
    }, [chart, series]);

    useEffect(() => {
        if (primitiveRef.current) {
            primitiveRef.current.updateParams(data, showSignals, highlighter);
        }
    }, [data, showSignals, highlighter]);

    return null;
};
