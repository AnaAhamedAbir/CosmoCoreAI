import React, { useEffect, useRef, useCallback } from 'react';
import { IChartApi, ISeriesApi } from 'lightweight-charts';

interface MLPredictionCloudRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<"Candlestick"> | null;
    modelId: string | null;
    exchange: string;
    symbol: string;
    currentPrice: number;
}

export const MLPredictionCloudRenderer: React.FC<MLPredictionCloudRendererProps> = ({
    chart,
    series,
    modelId,
    exchange,
    symbol,
    currentPrice
}) => {
    const wsRef = useRef<WebSocket | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    // Store latest prediction
    const predictionRef = useRef<{ tp: number, sl: number, entry: number } | null>(null);
    const drawRequested = useRef<boolean>(false);

    // Keep track of the latest price without triggering reconnects
    const currentPriceRef = useRef<number>(currentPrice);
    useEffect(() => {
        currentPriceRef.current = currentPrice;
    }, [currentPrice]);

    const requestDraw = useCallback(() => {
        if (!drawRequested.current) {
            drawRequested.current = true;
            requestAnimationFrame(() => {
                drawRequested.current = false;
                drawClouds();
            });
        }
    }, [chart, series]);

    const drawClouds = useCallback(() => {
        if (!canvasRef.current || !chart || !series || !predictionRef.current) {
            if (canvasRef.current) {
                const ctx = canvasRef.current.getContext('2d');
                if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            }
            return;
        }

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const parent = canvas.parentElement;
        if (parent) {
            if (canvas.width !== parent.clientWidth) canvas.width = parent.clientWidth;
            if (canvas.height !== parent.clientHeight) canvas.height = parent.clientHeight;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const { tp, sl, entry } = predictionRef.current;
        
        const yTP = series.priceToCoordinate(tp);
        const ySL = series.priceToCoordinate(sl);
        const yEntry = series.priceToCoordinate(entry);

        if (yTP === null || ySL === null || yEntry === null) return;

        // Draw cloud starting from the last candle
        let xStart = 0;
        try {
            const data = series.data();
            if (data && data.length > 0) {
                const lastItem = data[data.length - 1];
                const coord = chart.timeScale().timeToCoordinate(lastItem.time);
                if (coord !== null) {
                    xStart = coord;
                }
            }
        } catch (e) {
            console.error("Error getting series data:", e);
        }
        
        const xEnd = canvas.width;

        // Draw TP Cloud (Green)
        const topGreen = Math.min(yTP, yEntry);
        const heightGreen = Math.abs(yTP - yEntry);
        ctx.fillStyle = 'rgba(16, 185, 129, 0.15)'; // Emerald green transparent
        ctx.fillRect(xStart, topGreen, xEnd - xStart, heightGreen);

        // Draw SL Cloud (Red)
        const topRed = Math.min(ySL, yEntry);
        const heightRed = Math.abs(ySL - yEntry);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.15)'; // Red transparent
        ctx.fillRect(xStart, topRed, xEnd - xStart, heightRed);

        // Draw Lines
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);

        // TP Line
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.8)';
        ctx.beginPath();
        ctx.moveTo(xStart, yTP);
        ctx.lineTo(xEnd, yTP);
        ctx.stroke();

        // SL Line
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
        ctx.beginPath();
        ctx.moveTo(xStart, ySL);
        ctx.lineTo(xEnd, ySL);
        ctx.stroke();

        // Entry Line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.beginPath();
        ctx.moveTo(xStart, yEntry);
        ctx.lineTo(xEnd, yEntry);
        ctx.stroke();

        ctx.setLineDash([]);
        
        // Draw Labels
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        
        ctx.fillStyle = 'rgba(16, 185, 129, 1)';
        ctx.fillText(`AI TP: ${tp.toFixed(4)}`, xEnd - 60, yTP - 5);
        
        ctx.fillStyle = 'rgba(239, 68, 68, 1)';
        ctx.fillText(`AI SL: ${sl.toFixed(4)}`, xEnd - 60, ySL - 5);

    }, [chart, series]);

    useEffect(() => {
        if (!chart || !series) return;
        requestDraw();

        const timeScale = chart.timeScale();
        timeScale.subscribeVisibleTimeRangeChange(requestDraw);
        timeScale.subscribeSizeChange(requestDraw);
        chart.subscribeCrosshairMove(requestDraw);

        return () => {
            timeScale.unsubscribeVisibleTimeRangeChange(requestDraw);
            timeScale.unsubscribeSizeChange(requestDraw);
            chart.unsubscribeCrosshairMove(requestDraw);
        };
    }, [chart, series, requestDraw]);

    // Redraw periodically if price changes
    useEffect(() => {
        requestDraw();
    }, [currentPrice, requestDraw]);

    useEffect(() => {
        if (!chart || !series || !modelId) {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            predictionRef.current = null;
            requestDraw();
            return;
        }

        let reconnectTimeout: ReturnType<typeof setTimeout>;
        let isCleaningUp = false;

        const connectWebSocket = () => {
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsHost = import.meta.env.VITE_WS_URL ? import.meta.env.VITE_WS_URL.replace(/^https?:\/\//, '') : window.location.host;
            const wsUrl = `${wsProtocol}//${wsHost}/api/v1/ml-models/ws/inference/${modelId}/${exchange}/${symbol}`;
            
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.event === "AI_PREDICTION" && data.prediction) {
                        const tp = data.prediction.Target_TP;
                        const sl = data.prediction.Target_SL;

                        if (tp !== undefined && !isNaN(tp) && sl !== undefined && !isNaN(sl)) {
                            predictionRef.current = { tp, sl, entry: currentPriceRef.current };
                            requestDraw();
                        }
                    }
                } catch (e) {
                    console.error("Error parsing ML prediction WS data", e);
                }
            };
            
            ws.onclose = () => {
                if (!isCleaningUp) {
                    reconnectTimeout = setTimeout(() => {
                        connectWebSocket();
                    }, 5000);
                }
            };
        };
        
        connectWebSocket();

        return () => {
            isCleaningUp = true;
            clearTimeout(reconnectTimeout);
            if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
                wsRef.current.close();
            }
            predictionRef.current = null;
            requestDraw();
        };
    }, [chart, series, modelId, exchange, symbol, requestDraw]);

    return (
        <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 pointer-events-none"
            style={{ width: '100%', height: '100%' }}
        />
    );
};
