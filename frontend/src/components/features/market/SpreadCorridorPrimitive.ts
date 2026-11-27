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
        target.useMediaCoordinateSpace((scope) => {
            const p = this._primitive;
            if (!p.visible || !p.series || p.bestBid <= 0 || p.bestAsk <= 0 || p.bestAsk < p.bestBid) {
                return;
            }

            const yAsk = p.series.priceToCoordinate(p.bestAsk);
            const yBid = p.series.priceToCoordinate(p.bestBid);
            if (yAsk === null || yBid === null) return;

            const top = Math.min(yAsk, yBid);
            const bottom = Math.max(yAsk, yBid);
            const rawHeight = bottom - top;
            const height = Math.max(1.5, rawHeight);

            const ctx = scope.context;
            const width = scope.mediaSize.width;
            if (width <= 0) return;

            // Imbalance-tinted translucent corridor between Best Bid and Best Ask:
            // bid-heavy => emerald tint, ask-heavy => rose tint, balanced => soft indigo-cyan tint
            let fillColor = 'rgba(99, 102, 241, 0.09)';
            let edgeColor = 'rgba(99, 102, 241, 0.45)';
            if (p.bidQty > 0 && p.askQty > 0) {
                const ratio = p.bidQty / p.askQty;
                if (ratio >= 1.25) {
                    fillColor = 'rgba(22, 163, 74, 0.12)';
                    edgeColor = 'rgba(34, 197, 94, 0.55)';
                } else if (ratio <= 0.8) {
                    fillColor = 'rgba(220, 38, 38, 0.12)';
                    edgeColor = 'rgba(239, 68, 68, 0.55)';
                }
            }

            ctx.save();
            ctx.fillStyle = fillColor;
            ctx.fillRect(0, top, width, height);

            // Crisp micro vertical bracket at right edge near price scale so even a 1-tick tight spread is visible
            ctx.fillStyle = edgeColor;
            ctx.fillRect(Math.max(0, width - 3), top, 3, height);
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
 * Lightweight Charts v5 Series Primitive that renders a zero-React-overhead
 * translucent Bid–Ask spread corridor tinted by top-of-book liquidity imbalance.
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
