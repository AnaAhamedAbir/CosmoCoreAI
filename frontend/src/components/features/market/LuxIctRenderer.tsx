import React, { useEffect, useRef } from 'react';
import {
    IChartApi,
    ISeriesApi,
    Time,
    ISeriesPrimitive,
    IPrimitivePaneView,
    IPrimitivePaneRenderer,
    SeriesAttachedParameter
} from 'lightweight-charts';
import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { LuxIctConfigs, LuxIctResult } from '../../../utils/luxIctConcepts';

interface LuxIctRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    luxIctData: LuxIctResult | null;
    configs: LuxIctConfigs;
    visibleLogicalRange?: any;
}

class LuxIctRendererImpl implements IPrimitivePaneRenderer {
    private _primitive: LuxIctPrimitive;

    constructor(primitive: LuxIctPrimitive) {
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
        const currentData = this._primitive.data;
        const currentConfigs = this._primitive.configs;

        if (!chart || !series || !currentData || !currentConfigs.luxShowIndicator) return;

        const timeScale = chart.timeScale();
        const priceScale = series.priceScale();
        if (!timeScale || !priceScale) return;

        const getX = (time: any) => {
            let tsTime = time;
            if (typeof time === 'number' && time > 10000000000) {
                tsTime = Math.floor(time / 1000) as Time;
            }
            const coord = timeScale.timeToCoordinate(tsTime);
            return coord !== null ? coord : -1;
        };

        const getY = (price: number) => {
            const coord = series.priceToCoordinate(price);
            return coord !== null ? coord : -1;
        };

        const drawFib = (x1: number, x2: number, yt: number, yb: number, color: string, modeType: string) => {
            if (currentConfigs.fibMode !== modeType) return;
            const rightX = currentConfigs.fibExtend ? width : x2;

            const yMid = (yt + yb) / 2;
            ctx.beginPath();
            ctx.moveTo(x1, yMid);
            ctx.lineTo(rightX, yMid);
            ctx.strokeStyle = color;
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.font = '8px Arial';
            ctx.fillStyle = color;
            ctx.textAlign = 'right';
            ctx.fillText('0.5/EQ', rightX - 2, yMid - 2);
        };

        ctx.save();

        // 1. Draw MSS & BOS (ZigZag Lines)
        if (currentConfigs.showMSS || currentConfigs.showBOS) {
            currentData.msLines.forEach(line => {
                const x1 = getX(line.x1);
                const x2 = getX(line.x2);
                const y = getY(line.y);
                if (x1 !== -1 && x2 !== -1 && y !== -1) {
                    ctx.beginPath();
                    ctx.moveTo(x1, y);
                    ctx.lineTo(x2, y);
                    ctx.strokeStyle = line.dir === 'bull' ? '#00e6a1' : '#e60400';
                    ctx.setLineDash([2, 4]);
                    ctx.lineWidth = 1;
                    ctx.stroke();

                    ctx.font = '10px Arial';
                    ctx.fillStyle = line.dir === 'bull' ? '#00e6a1' : '#e60400';
                    ctx.textAlign = 'center';
                    ctx.fillText(line.type, (x1 + x2) / 2, line.dir === 'bull' ? y + 12 : y - 4);
                }
            });
            ctx.setLineDash([]);
        }

        // 2. Draw Volume Imbalances (VI)
        if (currentConfigs.showVIMB) {
            currentData.vimbs.forEach(vimb => {
                const x1 = getX(vimb.x1);
                const x2 = x1 + 20;
                const yt = getY(vimb.top);
                const yb = getY(vimb.bottom);
                if (x1 !== -1 && yt !== -1 && yb !== -1) {
                    ctx.fillStyle = 'rgba(6, 178, 208, 0.18)';
                    ctx.fillRect(x1, yt, x2 - x1, yb - yt);
                    ctx.strokeStyle = 'rgba(6, 178, 208, 0.5)';
                    ctx.strokeRect(x1, yt, x2 - x1, yb - yt);
                    drawFib(x1, x2, yt, yb, '#06b2d0', 'VI');
                }
            });
        }

        // 3. Draw Order Blocks (OB)
        if (currentConfigs.showOB) {
            currentData.obs.forEach(ob => {
                const x1 = getX(ob.left);
                const x2 = Math.max(x1 + 10, getX(ob.right));
                const yt = getY(ob.top);
                const yb = getY(ob.bottom);

                if (x1 !== -1 && yt !== -1 && yb !== -1 && x2 !== -1) {
                    const colorStr = ob.type === 'bull' ? '#3e89fa' : '#FF3131';
                    ctx.fillStyle = ob.type === 'bull'
                        ? (ob.breaker ? 'rgba(71, 133, 249, 0.12)' : 'rgba(62, 137, 250, 0.20)')
                        : (ob.breaker ? 'rgba(249, 255, 87, 0.12)' : 'rgba(255, 49, 49, 0.20)');

                    ctx.fillRect(x1, yt, x2 - x1, yb - yt);

                    if (currentConfigs.showOBLabels) {
                        ctx.font = '9px Arial';
                        ctx.fillStyle = colorStr;
                        ctx.textAlign = 'left';
                        ctx.fillText(`OB ${ob.breaker ? 'BRK' : ''}`, x1 + 2, yt - 4);
                    }
                    drawFib(x1, x2, yt, yb, colorStr, 'OB');
                }
            });
        }

        // 4. Draw Liquidity (EqH / EqL)
        if (currentConfigs.showLiq) {
            currentData.liqs.forEach(liq => {
                const x1 = getX(liq.left);
                const x2 = Math.max(x1 + 10, getX(liq.right));
                const yt = getY(liq.top);
                const yb = getY(liq.bottom);

                if (x1 !== -1 && x2 !== -1 && yt !== -1 && yb !== -1) {
                    const colorStr = liq.type === 'buyside' ? '#fa451c' : '#1ce4fa';
                    ctx.fillStyle = liq.type === 'buyside'
                        ? (liq.broken ? 'rgba(250, 69, 28, 0.5)' : 'rgba(250, 69, 28, 0.12)')
                        : (liq.broken ? 'rgba(28, 228, 250, 0.5)' : 'rgba(28, 228, 250, 0.12)');
                    ctx.fillRect(x1, yt, x2 - x1, yb - yt);

                    ctx.font = '9px Arial';
                    ctx.fillStyle = colorStr;
                    ctx.textAlign = 'left';
                    ctx.fillText(liq.type === 'buyside' ? 'Buyside Liquidity' : 'Sellside Liquidity', x1 + 2, yt - 4);
                    drawFib(x1, x2, yt, yb, colorStr, 'Liq');
                }
            });
        }

        // 5. Draw FVGs
        if (currentConfigs.showFVG) {
            currentData.fvgs.forEach(fvg => {
                const x1 = getX(fvg.left);
                const x2 = Math.max(x1 + 10, getX(fvg.right));
                const yt = getY(fvg.top);
                const yb = getY(fvg.bottom);

                if (x1 !== -1 && x2 !== -1 && yt !== -1 && yb !== -1) {
                    const color = fvg.type === 'bull' ? '#00e676' : '#ff5252';
                    ctx.fillStyle = fvg.type === 'bull'
                        ? (fvg.broken ? 'rgba(0, 230, 118, 0.08)' : 'rgba(0, 230, 118, 0.20)')
                        : (fvg.broken ? 'rgba(255, 82, 82, 0.08)' : 'rgba(255, 82, 82, 0.20)');
                    ctx.fillRect(x1, yt, x2 - x1, yb - yt);

                    ctx.strokeStyle = `${color}40`;
                    if (fvg.broken) ctx.setLineDash([2, 2]);
                    ctx.strokeRect(x1, yt, x2 - x1, yb - yt);
                    ctx.setLineDash([]);
                    drawFib(x1, x2, yt, yb, color, 'FVG');
                }
            });
        }

        // 6. Draw BPRs
        if (currentConfigs.bpr) {
            currentData.bprs.forEach(bpr => {
                const x1 = getX(bpr.left);
                const x2 = Math.max(x1 + 10, getX(bpr.right));
                const yt = getY(bpr.top);
                const yb = getY(bpr.bottom);

                if (x1 !== -1 && x2 !== -1 && yt !== -1 && yb !== -1) {
                    const color = bpr.type === 'bull' ? '#00e676' : '#ff5252';
                    ctx.fillStyle = bpr.type === 'bull' ? 'rgba(0, 230, 118, 0.35)' : 'rgba(255, 82, 82, 0.35)';
                    ctx.fillRect(x1, yt, x2 - x1, yb - yt);

                    ctx.font = 'bold 9px Arial';
                    ctx.fillStyle = color;
                    ctx.textAlign = 'right';
                    ctx.fillText('BPR', x2 - 2, yt + 12);
                    drawFib(x1, x2, yt, yb, color, 'BPR');
                }
            });
        }

        // 7. Draw NWOG / NDOG
        if (currentConfigs.showNWOG || currentConfigs.showNDOG) {
            currentData.gaps.forEach(gap => {
                const x1 = getX(gap.left);
                const x2 = width;
                const yt = getY(gap.top);
                const yb = getY(gap.bottom);

                if (x1 !== -1 && yt !== -1 && yb !== -1) {
                    const colorLine = gap.type === 'NWOG' ? '#ff5252' : '#ff9800';
                    const colorBg = gap.type === 'NWOG' ? 'rgba(178, 181, 190, 0.28)' : 'rgba(77, 208, 225, 0.32)';

                    ctx.fillStyle = colorBg;
                    ctx.fillRect(x1, yt, x2 - x1, yb - yt);

                    ctx.beginPath();
                    ctx.moveTo(x1, (yt + yb) / 2);
                    ctx.lineTo(x2, (yt + yb) / 2);
                    ctx.strokeStyle = colorLine;
                    ctx.setLineDash([2, 4]);
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    ctx.setLineDash([]);

                    ctx.font = '9px Arial';
                    ctx.fillStyle = colorLine;
                    ctx.textAlign = 'left';
                    ctx.fillText(gap.type, x1 + 2, yt - 2);
                    drawFib(x1, width, yt, yb, colorLine, 'NWOG');
                }
            });
        }

        ctx.restore();
    }
}

class LuxIctPaneView implements IPrimitivePaneView {
    private _renderer: LuxIctRendererImpl;

    constructor(primitive: LuxIctPrimitive) {
        this._renderer = new LuxIctRendererImpl(primitive);
    }

    zOrder(): 'bottom' {
        return 'bottom';
    }

    renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

class LuxIctPrimitive implements ISeriesPrimitive<any> {
    public chart: IChartApi | null = null;
    public series: ISeriesApi<'Candlestick'> | null = null;
    public data: LuxIctResult | null = null;
    public configs: LuxIctConfigs;

    private _requestUpdate?: () => void;
    private _paneViews: LuxIctPaneView[];

    constructor(data: LuxIctResult | null, configs: LuxIctConfigs) {
        this.data = data;
        this.configs = configs;
        this._paneViews = [new LuxIctPaneView(this)];
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

    updateParams(data: LuxIctResult | null, configs: LuxIctConfigs): void {
        this.data = data;
        this.configs = configs;
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

export const LuxIctRenderer: React.FC<LuxIctRendererProps> = ({
    chart,
    series,
    luxIctData,
    configs,
}) => {
    const primitiveRef = useRef<LuxIctPrimitive | null>(null);

    useEffect(() => {
        if (!series || !chart) return;

        const primitive = new LuxIctPrimitive(luxIctData, configs);
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
            primitiveRef.current.updateParams(luxIctData, configs);
        }
    }, [luxIctData, configs]);

    return null;
};
