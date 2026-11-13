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
import { SessionData } from '@/utils/indicators';
import { IndicatorSettings, SessionSettings } from './IndicatorSelector';

interface SessionsRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    sessionsData: {
        a: SessionData[];
        b: SessionData[];
        c: SessionData[];
        d: SessionData[];
    };
    settings: IndicatorSettings;
}

const hexToRgba = (hex: string, alpha: number) => {
    let r, g, b;
    if (hex.length === 4) {
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
    } else {
        r = parseInt(hex.slice(1, 3), 16);
        g = parseInt(hex.slice(3, 5), 16);
        b = parseInt(hex.slice(5, 7), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

class SessionsRendererImpl implements IPrimitivePaneRenderer {
    private _primitive: SessionsPrimitive;

    constructor(primitive: SessionsPrimitive) {
        this._primitive = primitive;
    }

    draw(target: CanvasRenderingTarget2D): void {
        target.useMediaCoordinateSpace((scope) => {
            const ctx = scope.context;
            this._drawContent(ctx, scope.mediaSize.width, scope.mediaSize.height);
        });
    }

    private _renderSessionBlock(
        ctx: CanvasRenderingContext2D,
        block: SessionData[],
        config: SessionSettings,
        color: string,
        alpha: number,
        timeScale: any,
        series: any,
        globalSettings: IndicatorSettings
    ): void {
        if (block.length === 0) return;

        const first = block[0];
        const last = block[block.length - 1];

        const x1 = timeScale.timeToCoordinate(first.time);
        const x2 = timeScale.timeToCoordinate(last.time);

        if (x1 === null || x2 === null) return;

        const blockWidth = x2 - x1;

        // 1. Draw Range Box
        const highPrice = last.high;
        const lowPrice = last.low;
        const yHigh = series.priceToCoordinate(highPrice);
        const yLow = series.priceToCoordinate(lowPrice);

        if (config.showRange && yHigh !== null && yLow !== null) {
            ctx.fillStyle = hexToRgba(color, alpha);
            ctx.fillRect(x1, yHigh, blockWidth, yLow - yHigh);

            if (globalSettings.showOutline) {
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.strokeRect(x1, yHigh, blockWidth, yLow - yHigh);
                ctx.setLineDash([]);
            }
        }

        // 2. Session Label
        if (globalSettings.showSessionLabel && yHigh !== null) {
            ctx.fillStyle = color;
            ctx.font = 'bold 10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(config.name, x1 + blockWidth / 2, yHigh - 5);
        }

        // 3. Overlays
        ctx.lineWidth = 1.5;

        if (config.showMean) {
            ctx.strokeStyle = color;
            ctx.beginPath();
            let started = false;
            block.forEach(d => {
                const x = timeScale.timeToCoordinate(d.time);
                const y = series.priceToCoordinate(d.avg);
                if (x !== null && y !== null) {
                    if (!started) { ctx.moveTo(x, y); started = true; }
                    else ctx.lineTo(x, y);
                }
            });
            ctx.stroke();
        }

        if (config.showVWAP) {
            ctx.strokeStyle = color;
            ctx.setLineDash([2, 1]);
            ctx.beginPath();
            let started = false;
            block.forEach(d => {
                const x = timeScale.timeToCoordinate(d.time);
                const y = series.priceToCoordinate(d.vwap);
                if (x !== null && y !== null) {
                    if (!started) { ctx.moveTo(x, y); started = true; }
                    else ctx.lineTo(x, y);
                }
            });
            ctx.stroke();
            ctx.setLineDash([]);
        }

        if (config.showMaxMin && yHigh !== null && yLow !== null) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 0.5;
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(x1, yHigh); ctx.lineTo(x2, yHigh);
            ctx.moveTo(x1, yLow); ctx.lineTo(x2, yLow);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        if (config.showTrendline && last.linReg) {
            const y1LR = series.priceToCoordinate(last.linReg.y1);
            const y2LR = series.priceToCoordinate(last.linReg.y2);
            if (y1LR !== null && y2LR !== null) {
                ctx.strokeStyle = color;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(x1, y1LR);
                ctx.lineTo(x2, y2LR);
                ctx.stroke();
            }
        }
    }

    private _drawContent(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        const chart = this._primitive.chart;
        const series = this._primitive.series;
        const sessionsData = this._primitive.sessionsData;
        const settings = this._primitive.settings;

        if (!chart || !series || !settings.showSessions) return;

        const timeScale = chart.timeScale();
        const priceScale = series.priceScale();
        if (!timeScale || !priceScale) return;

        ctx.save();

        const sessionConfigs = [
            { data: sessionsData.a, config: settings.sessionA, color: settings.sessionA.color, alpha: 0.15 },
            { data: sessionsData.b, config: settings.sessionB, color: settings.sessionB.color, alpha: 0.15 },
            { data: sessionsData.c, config: settings.sessionC, color: settings.sessionC.color, alpha: 0.15 },
            { data: sessionsData.d, config: settings.sessionD, color: settings.sessionD.color, alpha: 0.15 }
        ];

        sessionConfigs.forEach(({ data, config, color, alpha }) => {
            if (!config.show || !data || data.length === 0) return;

            // Group into contiguous session blocks
            let currentBlock: SessionData[] = [];
            for (let i = 0; i < data.length; i++) {
                const current = data[i];
                if (currentBlock.length === 0) {
                    currentBlock.push(current);
                } else {
                    const prev = currentBlock[currentBlock.length - 1];
                    const currentTime = typeof current.time === 'number' ? current.time : new Date(current.time).getTime() / 1000;
                    const prevTime = typeof prev.time === 'number' ? prev.time : new Date(prev.time).getTime() / 1000;

                    if (currentTime - prevTime <= 3600 * 2) {
                        currentBlock.push(current);
                    } else {
                        this._renderSessionBlock(ctx, currentBlock, config, color, alpha, timeScale, series, settings);
                        currentBlock = [current];
                    }
                }
            }

            if (currentBlock.length > 0) {
                this._renderSessionBlock(ctx, currentBlock, config, color, alpha, timeScale, series, settings);
            }
        });

        ctx.restore();
    }
}

class SessionsPaneView implements IPrimitivePaneView {
    private _renderer: SessionsRendererImpl;

    constructor(primitive: SessionsPrimitive) {
        this._renderer = new SessionsRendererImpl(primitive);
    }

    zOrder(): 'bottom' {
        return 'bottom';
    }

    renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

class SessionsPrimitive implements ISeriesPrimitive<any> {
    public chart: IChartApi | null = null;
    public series: ISeriesApi<'Candlestick'> | null = null;
    public sessionsData: {
        a: SessionData[];
        b: SessionData[];
        c: SessionData[];
        d: SessionData[];
    };
    public settings: IndicatorSettings;

    private _requestUpdate?: () => void;
    private _paneViews: SessionsPaneView[];

    constructor(
        sessionsData: {
            a: SessionData[];
            b: SessionData[];
            c: SessionData[];
            d: SessionData[];
        },
        settings: IndicatorSettings
    ) {
        this.sessionsData = sessionsData;
        this.settings = settings;
        this._paneViews = [new SessionsPaneView(this)];
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
        sessionsData: {
            a: SessionData[];
            b: SessionData[];
            c: SessionData[];
            d: SessionData[];
        },
        settings: IndicatorSettings
    ): void {
        this.sessionsData = sessionsData;
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

export const SessionsRenderer: React.FC<SessionsRendererProps> = ({ chart, series, sessionsData, settings }) => {
    const primitiveRef = useRef<SessionsPrimitive | null>(null);

    useEffect(() => {
        if (!series || !chart) return;

        const primitive = new SessionsPrimitive(sessionsData, settings);
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
            primitiveRef.current.updateParams(sessionsData, settings);
        }
    }, [sessionsData, settings]);

    return null;
};
