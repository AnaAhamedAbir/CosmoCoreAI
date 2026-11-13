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
import { IchimokuDataPoint } from '../../../utils/indicators';

interface IchimokuRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    data: IchimokuDataPoint[];
    displacement: number;
}

class IchimokuRendererImpl implements IPrimitivePaneRenderer {
    private _primitive: IchimokuPrimitive;

    constructor(primitive: IchimokuPrimitive) {
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
        const displacement = this._primitive.displacement;

        if (!chart || !series || data.length === 0) return;

        const timeScale = chart.timeScale();
        const priceScale = series.priceScale();
        if (!timeScale || !priceScale) return;

        const logicalRange = timeScale.getVisibleLogicalRange();
        if (!logicalRange) return;

        // Colors
        const colors = {
            tenkan: '#00bfff', // Deep Sky Blue
            kijun: '#ff4500',   // Orange Red
            senkouA: 'rgba(0, 255, 0, 0.5)', // Greenish
            senkouB: 'rgba(255, 0, 0, 0.5)', // Reddish
            chikou: '#9370db',  // Medium Purple
            cloudUp: 'rgba(0, 255, 0, 0.12)',
            cloudDown: 'rgba(255, 0, 0, 0.12)'
        };

        const timeWidth = width;
        const barSpacing = timeWidth / Math.max(1, (logicalRange.to - logicalRange.from));

        const getX = (i: number) => {
            if (i >= 0 && i < data.length) {
                return timeScale.timeToCoordinate(data[i].time as any);
            }
            const lastIdx = data.length - 1;
            const lastX = timeScale.timeToCoordinate(data[lastIdx].time as any);
            if (lastX === null) return null;
            return lastX + (i - lastIdx) * barSpacing;
        };

        const startIdx = Math.max(0, Math.floor(logicalRange.from) - displacement - 5);
        const endIdx = Math.min(data.length - 1, Math.ceil(logicalRange.to) + displacement + 5);
        if (startIdx >= endIdx) return;

        ctx.save();

        // 1. Draw Kumo (Cloud) for visible range
        for (let i = startIdx; i <= endIdx; i++) {
            const pt = data[i];
            if (!pt || pt.senkouA === null || pt.senkouB === null) continue;

            const futureIdx = i + displacement;
            const x = getX(futureIdx);
            const xNext = getX(futureIdx + 1);
            if (x === null || xNext === null) continue;
            if (xNext < 0 || x > width) continue;

            const yA = series.priceToCoordinate(pt.senkouA);
            const yB = series.priceToCoordinate(pt.senkouB);
            if (yA === null || yB === null) continue;

            ctx.fillStyle = pt.senkouA > pt.senkouB ? colors.cloudUp : colors.cloudDown;
            ctx.fillRect(x, Math.min(yA, yB), Math.max(1, xNext - x), Math.abs(yA - yB));
        }

        // 2. Draw Tenkan Line (Single continuous path)
        ctx.setLineDash([]);
        ctx.strokeStyle = colors.tenkan;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let tenkanStarted = false;
        for (let i = startIdx; i <= endIdx; i++) {
            if (data[i] && data[i].tenkan !== null) {
                const x = getX(i);
                const y = series.priceToCoordinate(data[i].tenkan!);
                if (x !== null && y !== null) {
                    if (!tenkanStarted) { ctx.moveTo(x, y); tenkanStarted = true; }
                    else { ctx.lineTo(x, y); }
                }
            }
        }
        if (tenkanStarted) ctx.stroke();

        // 3. Draw Kijun Line (Single continuous path)
        ctx.strokeStyle = colors.kijun;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let kijunStarted = false;
        for (let i = startIdx; i <= endIdx; i++) {
            if (data[i] && data[i].kijun !== null) {
                const x = getX(i);
                const y = series.priceToCoordinate(data[i].kijun!);
                if (x !== null && y !== null) {
                    if (!kijunStarted) { ctx.moveTo(x, y); kijunStarted = true; }
                    else { ctx.lineTo(x, y); }
                }
            }
        }
        if (kijunStarted) ctx.stroke();

        // 4. Draw Chikou Span (Single continuous path)
        ctx.strokeStyle = colors.chikou;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let chikouStarted = false;
        for (let i = startIdx; i <= endIdx; i++) {
            if (data[i] && data[i].chikou !== null) {
                const x = getX(i);
                const y = series.priceToCoordinate(data[i].chikou!);
                if (x !== null && y !== null) {
                    if (!chikouStarted) { ctx.moveTo(x, y); chikouStarted = true; }
                    else { ctx.lineTo(x, y); }
                }
            }
        }
        if (chikouStarted) ctx.stroke();

        ctx.restore();
    }
}

class IchimokuPaneView implements IPrimitivePaneView {
    private _renderer: IchimokuRendererImpl;

    constructor(primitive: IchimokuPrimitive) {
        this._renderer = new IchimokuRendererImpl(primitive);
    }

    zOrder(): 'bottom' {
        return 'bottom';
    }

    renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

class IchimokuPrimitive implements ISeriesPrimitive<any> {
    public chart: IChartApi | null = null;
    public series: ISeriesApi<'Candlestick'> | null = null;
    public data: IchimokuDataPoint[] = [];
    public displacement: number = 26;

    private _requestUpdate?: () => void;
    private _paneViews: IchimokuPaneView[];

    constructor(data: IchimokuDataPoint[], displacement: number) {
        this.data = data;
        this.displacement = displacement;
        this._paneViews = [new IchimokuPaneView(this)];
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

    updateParams(data: IchimokuDataPoint[], displacement: number): void {
        this.data = data;
        this.displacement = displacement;
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

export const IchimokuRenderer: React.FC<IchimokuRendererProps> = ({ chart, series, data, displacement }) => {
    const primitiveRef = useRef<IchimokuPrimitive | null>(null);

    useEffect(() => {
        if (!series || !chart) return;

        const primitive = new IchimokuPrimitive(data, displacement);
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
            primitiveRef.current.updateParams(data, displacement);
        }
    }, [data, displacement]);

    return null;
};
