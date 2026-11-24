import {
    IChartApi,
    ISeriesApi,
    ISeriesPrimitive,
    IPrimitivePaneRenderer,
    IPrimitivePaneView,
    SeriesAttachedParameter,
} from 'lightweight-charts';
import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { UTBotDataPoint } from '../../../utils/indicators';
import { UTBotActiveSetup } from '../../../utils/utBotPro';

interface ScreenPoint {
    x: number;
    y: number;
}

interface CurveRenderOptions {
    bullColor: string;
    bearColor: string;
    lineWidth: number;
    dash?: number[];
}

export interface UTBotRenderPayload {
    fastPoints: UTBotDataPoint[];
    slowPoints: UTBotDataPoint[];
    activeSetup: UTBotActiveSetup | null;
    showSLTP: boolean;
    tp1RR: number;
    tp2RR: number;
    visible: boolean;
}

class UTBotPaneRenderer implements IPrimitivePaneRenderer {
    private _primitive: UTBotPrimitive;

    constructor(primitive: UTBotPrimitive) {
        this._primitive = primitive;
    }

    draw(target: CanvasRenderingTarget2D): void {
        target.useMediaCoordinateSpace((scope) => {
            this._drawContent(scope.context, scope.mediaSize.width, scope.mediaSize.height);
        });
    }

    private _drawSmoothTrendCurve(
        ctx: CanvasRenderingContext2D,
        timeScale: ReturnType<IChartApi['timeScale']>,
        series: ISeriesApi<'Candlestick'>,
        width: number,
        points: UTBotDataPoint[],
        options: CurveRenderOptions
    ): void {
        if (!points || points.length === 0) return;

        const padPx = 60;
        const segments: { dir: 1 | -1; pts: ScreenPoint[] }[] = [];
        let currentSeg: { dir: 1 | -1; pts: ScreenPoint[] } | null = null;
        let enteredViewport = false;

        for (let i = 0; i < points.length; i++) {
            const pt = points[i];
            if (!pt || !Number.isFinite(pt.trailingStop)) continue;

            const x = timeScale.timeToCoordinate(pt.time as any);
            if (x === null) continue;

            if (x < -padPx) {
                const y = series.priceToCoordinate(pt.trailingStop);
                if (y !== null) {
                    const dir: 1 | -1 = pt.direction === -1 || (pt.direction === 0 && pt.color === 'red') ? -1 : 1;
                    currentSeg = { dir, pts: [{ x, y }] };
                }
                continue;
            }

            if (x > width + padPx) {
                if (enteredViewport) {
                    const y = series.priceToCoordinate(pt.trailingStop);
                    if (y !== null) {
                        const dir: 1 | -1 = pt.direction === -1 || (pt.direction === 0 && pt.color === 'red') ? -1 : 1;
                        if (currentSeg && currentSeg.dir === dir) {
                            currentSeg.pts.push({ x, y });
                        }
                    }
                    break;
                }
                continue;
            }

            enteredViewport = true;
            const y = series.priceToCoordinate(pt.trailingStop);
            if (y === null) continue;

            const dir: 1 | -1 = pt.direction === -1 || (pt.direction === 0 && pt.color === 'red') ? -1 : 1;

            if (!currentSeg) {
                currentSeg = { dir, pts: [{ x, y }] };
            } else if (currentSeg.dir === dir) {
                currentSeg.pts.push({ x, y });
            } else {
                segments.push(currentSeg);
                currentSeg = { dir, pts: [{ x, y }] };
            }
        }

        if (currentSeg && currentSeg.pts.length > 0) {
            segments.push(currentSeg);
        }
        if (segments.length === 0) return;

        ctx.save();
        ctx.lineWidth = options.lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (options.dash) ctx.setLineDash(options.dash);

        for (const seg of segments) {
            const pts = seg.pts;
            const strokeColor = seg.dir === 1 ? options.bullColor : options.bearColor;
            ctx.strokeStyle = strokeColor;
            ctx.fillStyle = strokeColor;

            if (pts.length === 1) {
                if (pts[0].x >= -padPx && pts[0].x <= width + padPx) {
                    ctx.beginPath();
                    ctx.arc(pts[0].x, pts[0].y, Math.max(1.8, options.lineWidth), 0, Math.PI * 2);
                    ctx.fill();
                }
                continue;
            }

            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);

            if (pts.length === 2) {
                ctx.lineTo(pts[1].x, pts[1].y);
            } else {
                for (let j = 1; j < pts.length - 1; j++) {
                    const midX = (pts[j].x + pts[j + 1].x) / 2;
                    const midY = (pts[j].y + pts[j + 1].y) / 2;
                    ctx.quadraticCurveTo(pts[j].x, pts[j].y, midX, midY);
                }
                const last = pts[pts.length - 1];
                ctx.lineTo(last.x, last.y);
            }

            ctx.stroke();
        }

        ctx.restore();
    }

    private _drawActiveSetup(
        ctx: CanvasRenderingContext2D,
        timeScale: ReturnType<IChartApi['timeScale']>,
        series: ISeriesApi<'Candlestick'>,
        width: number,
        height: number
    ): void {
        const setup = this._primitive.activeSetup;
        if (!this._primitive.showSLTP || !setup || setup.isInvalidated) return;

        const rawStartX = timeScale.timeToCoordinate(setup.time as any);
        const startX = rawStartX !== null ? Math.max(8, Math.min(width - 90, rawStartX)) : Math.max(8, width * 0.6);
        const endX = Math.max(startX + 40, width - 6);

        const effTp2RR = Math.max(this._primitive.tp1RR, this._primitive.tp2RR);
        const entryTag =
            setup.kind === 'SWEEP_BUY' || setup.kind === 'SWEEP_SELL'
                ? `SWEEP ${setup.side === 'buy' ? 'L' : 'S'} ${setup.grade}`
                : setup.kind === 'DIP_BUY' || setup.kind === 'DIP_SELL'
                    ? `DIP ${setup.side === 'buy' ? 'LONG' : 'SHORT'} ${setup.grade}`
                    : setup.kind === 'SNIPE_BUY' || setup.kind === 'SNIPE_SELL'
                        ? `SNIPE ${setup.side === 'buy' ? 'L' : 'S'} ${setup.grade}`
                        : `${setup.side === 'buy' ? 'LONG' : 'SHORT'} ${setup.grade}`;
        const levels = [
            { price: setup.tp2, label: `TP2 ${effTp2RR}R`, color: '#10b981', fill: 'rgba(16, 185, 129, 0.14)', dash: [4, 4] },
            { price: setup.tp1, label: `TP1 ${this._primitive.tp1RR}R`, color: '#22c55e', fill: 'rgba(34, 197, 94, 0.18)', dash: [5, 3] },
            { price: setup.entry, label: entryTag, color: '#38bdf8', fill: 'rgba(56, 189, 248, 0.16)', dash: [2, 3] },
            { price: setup.sl, label: 'SL', color: '#ef4444', fill: 'rgba(239, 68, 68, 0.18)', dash: [4, 3] },
        ];

        ctx.save();
        ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textBaseline = 'middle';

        for (const lvl of levels) {
            const y = series.priceToCoordinate(lvl.price);
            if (y === null || y < 8 || y > height - 8) continue;

            ctx.beginPath();
            ctx.setLineDash(lvl.dash);
            ctx.strokeStyle = lvl.color;
            ctx.lineWidth = 1.25;
            ctx.moveTo(startX, y);
            ctx.lineTo(endX, y);
            ctx.stroke();

            // Compact pill label on the right end of the setup line
            ctx.setLineDash([]);
            const textW = ctx.measureText(lvl.label).width;
            const pillW = textW + 10;
            const pillH = 16;
            const pillX = endX - pillW;
            const pillY = y - pillH / 2;

            ctx.fillStyle = lvl.fill;
            ctx.strokeStyle = lvl.color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
                ctx.roundRect(pillX, pillY, pillW, pillH, 4);
            } else {
                ctx.rect(pillX, pillY, pillW, pillH);
            }
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = lvl.color;
            ctx.textAlign = 'center';
            ctx.fillText(lvl.label, pillX + pillW / 2, y + 0.5);
        }

        ctx.restore();
    }

    private _drawContent(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        const chart = this._primitive.chart;
        const series = this._primitive.series;

        if (!this._primitive.visible || !chart || !series) return;

        const timeScale = chart.timeScale();
        if (!timeScale) return;

        // Draw macro Slow UT Bot trend line behind Fast UT Bot line when Dual Mode is active
        if (this._primitive.slowPoints.length > 0) {
            this._drawSmoothTrendCurve(ctx, timeScale, series, width, this._primitive.slowPoints, {
                bullColor: 'rgba(16, 185, 129, 0.42)',
                bearColor: 'rgba(244, 63, 94, 0.42)',
                lineWidth: 3.5,
                dash: [6, 4],
            });
        }

        if (this._primitive.fastPoints.length > 0) {
            this._drawSmoothTrendCurve(ctx, timeScale, series, width, this._primitive.fastPoints, {
                bullColor: '#22c55e',
                bearColor: '#ef4444',
                lineWidth: 2,
            });
        }

        this._drawActiveSetup(ctx, timeScale, series, width, height);
    }
}

class UTBotPaneView implements IPrimitivePaneView {
    private _renderer: UTBotPaneRenderer;

    constructor(primitive: UTBotPrimitive) {
        this._renderer = new UTBotPaneRenderer(primitive);
    }

    zOrder(): 'normal' {
        return 'normal';
    }

    renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

/**
 * Lightweight Charts series primitive that renders UT Bot's Fast & Slow ATR trailing stops
 * as smooth, color-coded curves broken cleanly at trend flips, plus active Entry/SL/TP levels.
 */
export class UTBotPrimitive implements ISeriesPrimitive<any> {
    public chart: IChartApi | null = null;
    public series: ISeriesApi<'Candlestick'> | null = null;
    public fastPoints: UTBotDataPoint[] = [];
    public slowPoints: UTBotDataPoint[] = [];
    public activeSetup: UTBotActiveSetup | null = null;
    public showSLTP: boolean = false;
    public tp1RR: number = 1.5;
    public tp2RR: number = 2.5;
    public visible: boolean = false;

    private _requestUpdate?: () => void;
    private _paneViews: UTBotPaneView[];

    constructor(visible: boolean = false) {
        this.visible = visible;
        this._paneViews = [new UTBotPaneView(this)];
    }

    attached(param: SeriesAttachedParameter<any, any>): void {
        this.chart = param.chart as unknown as IChartApi;
        this.series = param.series as unknown as ISeriesApi<'Candlestick'>;
        this._requestUpdate = param.requestUpdate;
        this._requestUpdate?.();
    }

    detached(): void {
        this.chart = null;
        this.series = null;
        this._requestUpdate = undefined;
    }

    setPayload(payload: UTBotRenderPayload): void {
        this.fastPoints = payload.fastPoints;
        this.slowPoints = payload.slowPoints;
        this.activeSetup = payload.activeSetup;
        this.showSLTP = payload.showSLTP;
        this.tp1RR = payload.tp1RR;
        this.tp2RR = payload.tp2RR;
        this.visible = payload.visible;
        this._requestUpdate?.();
    }

    setVisible(visible: boolean): void {
        if (this.visible === visible) return;
        this.visible = visible;
        this._requestUpdate?.();
    }

    updateAllViews(): void {}

    paneViews(): readonly IPrimitivePaneView[] {
        return this._paneViews;
    }
}
