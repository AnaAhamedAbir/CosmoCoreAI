import React, { useEffect, useRef } from 'react';
import type {
    IChartApi,
    ISeriesApi,
    ISeriesPrimitive,
    IPrimitivePaneView,
    IPrimitivePaneRenderer,
    SeriesAttachedParameter
} from 'lightweight-charts';
import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { ICTResult } from '../../../utils/ictKillzones';

interface ICTKillzonesRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    data: ICTResult | null;
    visible: boolean;
    settings: any;
}

const hexToRgba = (hex: string, alpha: number) => {
    if (!hex || hex.length < 7) return `rgba(255, 255, 255, ${alpha})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

class ICTKillzonesRendererImpl implements IPrimitivePaneRenderer {
    private _primitive: ICTKillzonesPrimitive;

    constructor(primitive: ICTKillzonesPrimitive) {
        this._primitive = primitive;
    }

    draw(target: CanvasRenderingTarget2D): void {
        target.useMediaCoordinateSpace((scope) => {
            const ctx = scope.context;
            this._drawContent(ctx, scope.mediaSize.width, scope.mediaSize.height);
        });
    }

    private _drawContent(ctx: CanvasRenderingContext2D, W: number, H: number): void {
        const chart = this._primitive.chart;
        const series = this._primitive.series;
        const data = this._primitive.data;
        const visible = this._primitive.visible;
        const settings = this._primitive.settings;

        if (!chart || !series || !data || !visible) return;

        const timeScale = chart.timeScale();
        const priceScale = series.priceScale();
        if (!timeScale || !priceScale) return;

        const toX = (time: number): number | null => {
            try {
                const t = time < 10_000_000_000 ? time : Math.floor(time / 1000);
                return timeScale.timeToCoordinate(t as any);
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

        ctx.save();

        const drawBox = (x1: number, y1: number, x2: number, y2: number, bg: string, border: string = 'transparent', text?: string) => {
            const left = Math.max(0, Math.min(x1, x2));
            const top = Math.max(0, Math.min(y1, y2));
            const width = Math.abs(x2 - x1);
            const height = Math.abs(y2 - y1);
            if (width < 1 || height < 1) return;

            ctx.fillStyle = bg;
            ctx.fillRect(left, top, Math.min(width, W - left), Math.min(height, H - top));

            if (border && border !== 'transparent') {
                ctx.strokeStyle = border;
                ctx.lineWidth = 1;
                ctx.strokeRect(left, top, Math.min(width, W - left), Math.min(height, H - top));
            }

            if (text) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
                ctx.font = 'bold 10px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(text.toUpperCase(), left + width / 2, top + height / 2);
            }
        };

        const drawLine = (x1: number, y1: number, x2: number, y2: number, color: string, style: 'solid' | 'dashed' | 'dotted' = 'solid', width: number = 1, label?: string) => {
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = width;

            if (style === 'dashed') ctx.setLineDash([4, 4]);
            else if (style === 'dotted') ctx.setLineDash([2, 2]);
            else ctx.setLineDash([]);

            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.setLineDash([]);

            if (label) {
                ctx.fillStyle = color;
                ctx.font = 'bold 9px Inter, sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, x2 + 4, y2);
            }
        };

        // ── 1. Killzone Boxes ────────────────────────────────────────────────
        data.killzones.forEach(kz => {
            const x1 = toX(kz.startTime);
            const x2 = toX(kz.endTime || Date.now());
            const y1 = toY(kz.high);
            const y2 = toY(kz.low);
            if (x1 === null || x2 === null || y1 === null || y2 === null) return;

            drawBox(x1, y1, x2, y2, hexToRgba(kz.color, 0.15), kz.color, kz.name);

            // ── 1.a Equilibrium Line ──────────────────────────────────────────
            if (settings.ictShowEquilibrium) {
                const midPrice = (kz.high + kz.low) / 2;
                const yMid = toY(midPrice);
                if (yMid !== null) {
                    const left = Math.max(0, Math.min(x1, x2));
                    const right = Math.min(W, Math.max(x1, x2));
                    drawLine(left, yMid, right, yMid, hexToRgba(kz.color, 0.6), 'dashed', 1);
                }
            }
        });

        // ── 2. Pivot Lines ───────────────────────────────────────────────────
        if (settings.ictShowPivots) {
            data.pivots.forEach(p => {
                const x1 = toX(p.time);
                const x2 = toX(p.endTime || Date.now()) ?? W;
                const y = toY(p.price);
                if (x1 === null || y === null) return;

                const labelText = `${p.sessionName.slice(0, 2)}.${p.type === 'high' ? 'H' : 'L'}`;
                drawLine(x1, y, x2, y, p.color, p.isMitigated ? 'dotted' : 'solid', 1, labelText);
            });
        }

        // ── 3. DWM Open & HL ────────────────────────────────────────────────
        if (settings.ictShowDWM && data.dwm) {
            const { dayOpen } = data.dwm;
            if (dayOpen) {
                const y = toY(dayOpen);
                if (y !== null) drawLine(0, y, W, y, '#3b82f6', 'dashed', 1, 'D. OPEN');
            }
        }

        // ── 3.a Silver Bullets ──────────────────────────────────────────────
        if (settings.ictShowSilverBullet && data.silverBullets) {
            data.silverBullets.forEach(sb => {
                const x1 = toX(sb.startTime);
                const x2 = toX(sb.endTime || Date.now());
                const y1 = toY(sb.high);
                const y2 = toY(sb.low);
                if (x1 === null || x2 === null || y1 === null || y2 === null) return;

                drawBox(x1, y1, x2, y2, hexToRgba('#ffd700', 0.12), '#ffd700', sb.name);
            });
        }

        // ── 3.b Opening Gaps (NDOG / NWOG) ──────────────────────────────────
        if (settings.ictShowGaps && data.gaps) {
            data.gaps.forEach(gap => {
                const x = toX(gap.time);
                const y = toY(gap.price);
                if (x !== null && y !== null) {
                    drawLine(x, y, W, y, gap.color, 'solid', 1.5, gap.type);
                }
            });
        }

        // ── 4. Opening Prices (Special Logs) ────────────────────────────────
        if (settings.ictShowOpeningPrices) {
            data.openingPrices.forEach(op => {
                const x = toX(op.time);
                const y = toY(op.price);
                if (x !== null && y !== null) {
                    drawLine(x, y, W, y, op.color, 'dotted', 1, op.label);
                }
            });
        }

        // ── 5. Vertical Timestamps ──────────────────────────────────────────
        if (settings.ictShowTimestamps) {
            data.timestamps.forEach(ts => {
                const x = toX(ts.time);
                if (x !== null) {
                    drawLine(x, 0, x, H, ts.color, 'dashed', 1);
                }
            });
        }

        // ── 6. Day Labels ──────────────────────────────────────────────────
        data.dayLabels.forEach(dl => {
            const x = toX(dl.time);
            if (x === null) return;

            ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
            ctx.font = 'bold 11px Inter, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText(dl.text, x, H - 20);
        });

        ctx.restore();
    }
}

class ICTKillzonesPaneView implements IPrimitivePaneView {
    private _renderer: ICTKillzonesRendererImpl;

    constructor(primitive: ICTKillzonesPrimitive) {
        this._renderer = new ICTKillzonesRendererImpl(primitive);
    }

    zOrder(): 'bottom' {
        return 'bottom';
    }

    renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

class ICTKillzonesPrimitive implements ISeriesPrimitive<any> {
    public chart: IChartApi | null = null;
    public series: ISeriesApi<'Candlestick'> | null = null;
    public data: ICTResult | null = null;
    public visible: boolean = true;
    public settings: any = {};

    private _requestUpdate?: () => void;
    private _paneViews: ICTKillzonesPaneView[];

    constructor(data: ICTResult | null, visible: boolean, settings: any) {
        this.data = data;
        this.visible = visible;
        this.settings = settings;
        this._paneViews = [new ICTKillzonesPaneView(this)];
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

    updateParams(data: ICTResult | null, visible: boolean, settings: any): void {
        this.data = data;
        this.visible = visible;
        this.settings = settings;
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

export const ICTKillzonesRenderer: React.FC<ICTKillzonesRendererProps> = ({
    chart,
    series,
    data,
    visible,
    settings,
}) => {
    const primitiveRef = useRef<ICTKillzonesPrimitive | null>(null);

    useEffect(() => {
        if (!series || !chart) return;

        const primitive = new ICTKillzonesPrimitive(data, visible, settings);
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
            primitiveRef.current.updateParams(data, visible, settings);
        }
    }, [data, visible, settings]);

    return null;
};
