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
import { BollingerBandsDataPoint } from '../../../utils/indicators';
import { useTheme } from '../../../context/ThemeContext';

interface BollingerBandsRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    data: BollingerBandsDataPoint[];
    visible: boolean;
}

class BollingerBandsCloudRenderer implements IPrimitivePaneRenderer {
    private _primitive: BollingerBandsCloudPrimitive;

    constructor(primitive: BollingerBandsCloudPrimitive) {
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
        const isDark = this._primitive.isDark;
        const visible = this._primitive.visible;

        if (!visible || !chart || !series || !data || data.length === 0) return;

        const timeScale = chart.timeScale();
        const priceScale = series.priceScale();
        if (!timeScale || !priceScale) return;

        const logicalRange = timeScale.getVisibleLogicalRange();
        if (!logicalRange) return;

        let startIdx = 0;
        let endIdx = data.length - 1;

        if (logicalRange) {
            startIdx = Math.max(0, Math.floor(logicalRange.from) - 2);
            endIdx = Math.min(data.length - 1, Math.ceil(logicalRange.to) + 2);
        }

        // Expand bounds outward to guarantee zero edge truncation on pan / zoom
        while (startIdx > 0) {
            const prevX = timeScale.timeToCoordinate(data[startIdx].time as any);
            if (prevX !== null && prevX < 0) {
                break;
            }
            startIdx--;
        }

        while (endIdx < data.length - 1) {
            const nextX = timeScale.timeToCoordinate(data[endIdx].time as any);
            if (nextX !== null && nextX > width) {
                break;
            }
            endIdx++;
        }

        if (startIdx >= endIdx) return;

        // Collect coordinates for upper cloud & lower cloud
        const pts: { x: number; yUpper: number; yMid: number; yLow: number }[] = [];
        for (let i = startIdx; i <= endIdx; i++) {
            const pt = data[i];
            if (!pt) continue;
            const x = timeScale.timeToCoordinate(pt.time as any);
            if (x === null) continue;
            const yUpper = series.priceToCoordinate(pt.upper);
            const yMid = series.priceToCoordinate(pt.middle);
            const yLow = series.priceToCoordinate(pt.lower);

            if (yUpper !== null && yMid !== null && yLow !== null) {
                pts.push({ x, yUpper, yMid, yLow });
            }
        }

        if (pts.length < 2) return;

        ctx.save();
        // Dark Mode: soft cyber cyan cloud matching the dark background
        // Light Mode: crisp, clearly visible sky-blue tint (20% opacity) that stands out cleanly on light canvas
        ctx.fillStyle = isDark ? 'rgba(56, 189, 248, 0.12)' : 'rgba(2, 132, 199, 0.20)';

        // 1. Upper Cloud (Upper forward, Middle backward)
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].yUpper);
        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].yUpper);
        }
        for (let i = pts.length - 1; i >= 0; i--) {
            ctx.lineTo(pts[i].x, pts[i].yMid);
        }
        ctx.closePath();
        ctx.fill();

        // 2. Lower Cloud (Middle forward, Lower backward)
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].yMid);
        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].yMid);
        }
        for (let i = pts.length - 1; i >= 0; i--) {
            ctx.lineTo(pts[i].x, pts[i].yLow);
        }
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }
}

class BollingerBandsCloudPaneView implements IPrimitivePaneView {
    private _renderer: BollingerBandsCloudRenderer;

    constructor(primitive: BollingerBandsCloudPrimitive) {
        this._renderer = new BollingerBandsCloudRenderer(primitive);
    }

    zOrder(): 'bottom' {
        return 'bottom';
    }

    renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

class BollingerBandsCloudPrimitive implements ISeriesPrimitive<any> {
    public chart: IChartApi | null = null;
    public series: ISeriesApi<'Candlestick'> | null = null;
    public data: BollingerBandsDataPoint[] = [];
    public isDark: boolean = true;
    public visible: boolean = true;

    private _requestUpdate?: () => void;
    private _paneViews: BollingerBandsCloudPaneView[];

    constructor(isDark: boolean, visible: boolean, data: BollingerBandsDataPoint[]) {
        this.isDark = isDark;
        this.visible = visible;
        this.data = data;
        this._paneViews = [new BollingerBandsCloudPaneView(this)];
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

    updateParams(data: BollingerBandsDataPoint[], isDark: boolean, visible: boolean): void {
        this.data = data;
        this.isDark = isDark;
        this.visible = visible;
        this.requestUpdate();
    }

    requestUpdate(): void {
        this._requestUpdate?.();
    }

    updateAllViews(): void {
        // Called by Lightweight Charts when coordinates, size, or viewport changes
    }

    paneViews(): readonly IPrimitivePaneView[] {
        return this._paneViews;
    }
}

export const BollingerBandsRenderer: React.FC<BollingerBandsRendererProps> = ({ chart, series, data, visible }) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const primitiveRef = useRef<BollingerBandsCloudPrimitive | null>(null);

    useEffect(() => {
        if (!series || !chart) return;

        const primitive = new BollingerBandsCloudPrimitive(isDark, visible, data);
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
            primitiveRef.current.updateParams(data, isDark, visible);
        }
    }, [data, isDark, visible]);

    return null;
};
