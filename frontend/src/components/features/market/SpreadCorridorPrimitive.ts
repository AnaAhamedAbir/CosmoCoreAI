import {
    ISeriesApi,
    ISeriesPrimitive,
    IPrimitivePaneRenderer,
    IPrimitivePaneView,
    SeriesAttachedParameter,
} from 'lightweight-charts';
import { CanvasRenderingTarget2D } from 'fancy-canvas';

class SpreadCorridorPaneRenderer implements IPrimitivePaneRenderer {
    private _primitive: SpreadCorridorPrimitive;

    constructor(primitive: SpreadCorridorPrimitive) {
        this._primitive = primitive;
    }

    draw(target: CanvasRenderingTarget2D): void {
        target.useBitmapCoordinateSpace((scope) => {
            const p = this._primitive;
            if (!p.visible || !p.series || p.bestBid <= 0 || p.bestAsk <= 0) {
                return;
            }

            const yAskMedia = p.series.priceToCoordinate(p.bestAsk);
            const yBidMedia = p.series.priceToCoordinate(p.bestBid);
            if (yAskMedia === null || yBidMedia === null) return;

            const vRatio = scope.verticalPixelRatio;
            const hRatio = scope.horizontalPixelRatio;
            const width = scope.bitmapSize.width;
            if (width <= 0) return;

            const yAsk = yAskMedia * vRatio;
            const yBid = yBidMedia * vRatio;
            const midY = (yAsk + yBid) / 2;
            const rawHeight = Math.abs(yBid - yAsk);
            const minHeight = Math.max(2, Math.round(1.5 * vRatio));
            const height = Math.max(minHeight, Math.round(rawHeight));
            const top = rawHeight < minHeight ? Math.round(midY - height / 2) : Math.round(Math.min(yAsk, yBid));

            const isCrossed = p.bestAsk < p.bestBid;

            // Imbalance-tinted translucent corridor between Best Bid and Best Ask:
            // bid-heavy => emerald tint, ask-heavy => rose tint, crossed => amber warning, balanced => indigo-cyan
            let fillColor = 'rgba(99, 102, 241, 0.09)';
            let edgeColor = 'rgba(99, 102, 241, 0.55)';
            let textColor = '#a5b4fc';

            if (isCrossed) {
                fillColor = 'rgba(245, 158, 11, 0.16)';
                edgeColor = 'rgba(245, 158, 11, 0.8)';
                textColor = '#fcd34d';
            } else if (p.bidQty > 0 && p.askQty > 0) {
                const ratio = p.bidQty / p.askQty;
                if (ratio >= 1.25) {
                    fillColor = 'rgba(22, 163, 74, 0.12)';
                    edgeColor = 'rgba(34, 197, 94, 0.65)';
                    textColor = '#6ee7b7';
                } else if (ratio <= 0.8) {
                    fillColor = 'rgba(220, 38, 38, 0.12)';
                    edgeColor = 'rgba(239, 68, 68, 0.65)';
                    textColor = '#fda4af';
                }
            }

            const ctx = scope.context;
            ctx.save();
            ctx.fillStyle = fillColor;
            ctx.fillRect(0, top, width, height);

            // Razor-sharp right-edge vertical bracket near price scale
            const bracketW = Math.max(2, Math.round(3 * hRatio));
            ctx.fillStyle = edgeColor;
            ctx.fillRect(Math.max(0, width - bracketW), top, bracketW, height);

            // Crisp right-edge Spread Micro-Badge (bps) when canvas is wide enough
            if (!isCrossed && width > 200 * hRatio) {
                const midPrice = (p.bestBid + p.bestAsk) / 2;
                const spreadBps = midPrice > 0 ? ((p.bestAsk - p.bestBid) / midPrice) * 10000 : 0;
                const bpsLabel =
                    spreadBps < 0.1
                        ? `${spreadBps.toFixed(2)}bp`
                        : spreadBps < 10
                          ? `${spreadBps.toFixed(1)}bp`
                          : `${spreadBps.toFixed(0)}bp`;

                const fontPx = Math.round(9 * vRatio);
                ctx.font = `bold ${fontPx}px monospace`;
                const tw = ctx.measureText(bpsLabel).width;
                const padX = Math.round(4 * hRatio);
                const badgeW = tw + padX * 2;
                const badgeH = Math.round(13 * vRatio);
                const badgeX = Math.max(0, width - bracketW - badgeW - Math.round(4 * hRatio));
                const badgeY = Math.round(midY - badgeH / 2);

                ctx.fillStyle = 'rgba(6, 10, 20, 0.78)';
                ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
                ctx.fillStyle = textColor;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(bpsLabel, badgeX + badgeW / 2, midY);
            }

            ctx.restore();
        });
    }
}

class SpreadCorridorPaneView implements IPrimitivePaneView {
    private _renderer: SpreadCorridorPaneRenderer;

    constructor(primitive: SpreadCorridorPrimitive) {
        this._renderer = new SpreadCorridorPaneRenderer(primitive);
    }

    zOrder(): 'bottom' {
        return 'bottom';
    }

    renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

/**
 * Lightweight Charts v5 Series Primitive that renders a zero-React-overhead HiDPI
 * translucent Bid-Ask spread corridor tinted by top-of-book liquidity imbalance + live bps badge.
 */
export class SpreadCorridorPrimitive implements ISeriesPrimitive<any> {
    public series: ISeriesApi<'Candlestick'> | null = null;
    public visible: boolean = false;
    public bestBid: number = 0;
    public bestAsk: number = 0;
    public bidQty: number = 0;
    public askQty: number = 0;

    private _requestUpdate?: () => void;
    private _paneViews: SpreadCorridorPaneView[];

    constructor(visible: boolean = false) {
        this.visible = visible;
        this._paneViews = [new SpreadCorridorPaneView(this)];
    }

    attached(param: SeriesAttachedParameter<any, any>): void {
        this.series = param.series as unknown as ISeriesApi<'Candlestick'>;
        this._requestUpdate = param.requestUpdate;
        this._requestUpdate?.();
    }

    detached(): void {
        this.series = null;
        this._requestUpdate = undefined;
    }

    setVisible(visible: boolean): void {
        if (this.visible === visible) return;
        this.visible = visible;
        this._requestUpdate?.();
    }

    updateSpread(bestBid: number, bestAsk: number, bidQty: number = 0, askQty: number = 0): void {
        if (
            this.bestBid === bestBid &&
            this.bestAsk === bestAsk &&
            this.bidQty === bidQty &&
            this.askQty === askQty
        ) {
            return;
        }
        this.bestBid = bestBid;
        this.bestAsk = bestAsk;
        this.bidQty = bidQty;
        this.askQty = askQty;
        if (this.visible) {
            this._requestUpdate?.();
        }
    }

    clear(): void {
        if (this.bestBid === 0 && this.bestAsk === 0) return;
        this.bestBid = 0;
        this.bestAsk = 0;
        this.bidQty = 0;
        this.askQty = 0;
        this._requestUpdate?.();
    }

    updateAllViews(): void {}

    paneViews(): readonly IPrimitivePaneView[] {
        return this._paneViews;
    }
}
