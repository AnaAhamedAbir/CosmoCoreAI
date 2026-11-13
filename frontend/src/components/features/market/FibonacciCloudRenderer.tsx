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

export interface FibonacciLevel {
    level: number;
    price: number;
    title: string;
    color: string;
    cloudColor: string;
}

export interface FibonacciData {
    highest: number;
    lowest: number;
    highTime: number;
    lowTime: number;
    levels: FibonacciLevel[];
}

interface FibonacciCloudRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    data: FibonacciData | null;
}

class FibonacciCloudRendererImpl implements IPrimitivePaneRenderer {
    private _primitive: FibonacciCloudPrimitive;

    constructor(primitive: FibonacciCloudPrimitive) {
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

        if (!chart || !series || !data) return;

        const timeScale = chart.timeScale();
        const priceScale = series.priceScale();
        if (!timeScale || !priceScale) return;

        const timeWidth = width;
        const { levels, highest, lowest, highTime, lowTime } = data;

        ctx.save();

        // 1. Draw Clouds
        for (let i = 0; i < levels.length - 1; i++) {
            const top = levels[i + 1];
            const bottom = levels[i];

            const yTop = series.priceToCoordinate(top.price);
            const yBottom = series.priceToCoordinate(bottom.price);

            if (yTop !== null && yBottom !== null) {
                ctx.fillStyle = top.cloudColor;
                // Draw from the earlier of highTime/lowTime to the right edge
                const startTime = Math.min(highTime, lowTime);
                const xStart = timeScale.timeToCoordinate(startTime as any);
                const xEnd = timeWidth;

                const drawX = xStart !== null ? Math.max(0, xStart) : 0;

                ctx.fillRect(drawX, Math.min(yTop, yBottom), Math.max(0, xEnd - drawX), Math.abs(yTop - yBottom));
            }
        }

        // 2. Draw Fibonacci Lines & Labels
        levels.forEach(lvl => {
            const y = series.priceToCoordinate(lvl.price);
            if (y !== null) {
                const startTime = Math.min(highTime, lowTime);
                const xStart = timeScale.timeToCoordinate(startTime as any);
                const xEnd = timeWidth;
                const drawX = xStart !== null ? Math.max(0, xStart) : 0;

                // Line
                ctx.beginPath();
                ctx.strokeStyle = lvl.color;
                ctx.lineWidth = 1;
                ctx.moveTo(drawX, y);
                ctx.lineTo(xEnd, y);
                ctx.stroke();

                // Label: level(price)
                ctx.fillStyle = lvl.color;
                ctx.font = 'bold 11px monospace, sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'bottom';

                const formattedPrice = lvl.price < 0.0001
                    ? lvl.price.toFixed(8)
                    : lvl.price < 1
                    ? lvl.price.toFixed(5)
                    : lvl.price.toFixed(2);
                const label = `${lvl.level}(${formattedPrice})`;
                ctx.fillText(label, drawX + 8, y - 4);
            }
        });

        // 3. Draw Diagonal Trend Line (High to Low)
        const xHigh = timeScale.timeToCoordinate(highTime as any);
        const yHigh = series.priceToCoordinate(highest);
        const xLow = timeScale.timeToCoordinate(lowTime as any);
        const yLow = series.priceToCoordinate(lowest);

        if (xHigh !== null && yHigh !== null && xLow !== null && yLow !== null) {
            ctx.beginPath();
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = 1;
            ctx.moveTo(xHigh, yHigh);
            ctx.lineTo(xLow, yLow);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.restore();
    }
}

class FibonacciCloudPaneView implements IPrimitivePaneView {
    private _renderer: FibonacciCloudRendererImpl;

    constructor(primitive: FibonacciCloudPrimitive) {
        this._renderer = new FibonacciCloudRendererImpl(primitive);
    }

    zOrder(): 'bottom' {
        return 'bottom';
    }

    renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

class FibonacciCloudPrimitive implements ISeriesPrimitive<any> {
    public chart: IChartApi | null = null;
    public series: ISeriesApi<'Candlestick'> | null = null;
    public data: FibonacciData | null = null;

    private _requestUpdate?: () => void;
    private _paneViews: FibonacciCloudPaneView[];

    constructor(data: FibonacciData | null) {
        this.data = data;
        this._paneViews = [new FibonacciCloudPaneView(this)];
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

    updateParams(data: FibonacciData | null): void {
        this.data = data;
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

export const FibonacciCloudRenderer: React.FC<FibonacciCloudRendererProps> = ({ chart, series, data }) => {
    const primitiveRef = useRef<FibonacciCloudPrimitive | null>(null);

    useEffect(() => {
        if (!series || !chart) return;

        const primitive = new FibonacciCloudPrimitive(data);
        primitiveRef.current = primitive;
        series.attachPrimitive(primitive);

        return () => {
            try {
                series.detachPrimitive(primitive);
            } catch (e) {
                // Ignore if already destroyed
            }
            primitiveRef.current = null;
        };
    }, [chart, series]);

    useEffect(() => {
        if (primitiveRef.current) {
            primitiveRef.current.updateParams(data);
        }
    }, [data]);

    return null;
};
