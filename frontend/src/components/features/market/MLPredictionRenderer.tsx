import React, { useEffect, useRef } from 'react';
import { ISeriesApi, LineStyle, IPriceLine } from 'lightweight-charts';
import { PredictionResult } from './ModelPredictorModal';

interface MLPredictionRendererProps {
    series: ISeriesApi<"Candlestick"> | null;
    predictionResult: PredictionResult | null;
    currentCandleTime?: number | string | null;
    onSetMarker?: (marker: any | null) => void;
}

export const MLPredictionRenderer: React.FC<MLPredictionRendererProps> = ({ 
    series, 
    predictionResult, 
    currentCandleTime,
    onSetMarker 
}) => {
    const mlSlLineRef = useRef<IPriceLine | null>(null);
    const mlTpLineRef = useRef<IPriceLine | null>(null);
    const lastPredictionRef = useRef<string | null>(null);

    // Handle creating/updating lines
    useEffect(() => {
        if (!series) return;
        
        if (!predictionResult) {
            // Clean up if prediction is cleared
            if (mlSlLineRef.current) { series.removePriceLine(mlSlLineRef.current); mlSlLineRef.current = null; }
            if (mlTpLineRef.current) { series.removePriceLine(mlTpLineRef.current); mlTpLineRef.current = null; }
            lastPredictionRef.current = null;
            if (onSetMarker) onSetMarker(null);
            return;
        }

        const predKey = `${predictionResult.model_id}_${predictionResult.timestamp}`;
        if (lastPredictionRef.current === predKey) return;
        lastPredictionRef.current = predKey;

        // Clean up previous lines
        if (mlSlLineRef.current) { series.removePriceLine(mlSlLineRef.current); mlSlLineRef.current = null; }
        if (mlTpLineRef.current) { series.removePriceLine(mlTpLineRef.current); mlTpLineRef.current = null; }

        const isBuy = predictionResult.signal === 'BUY';
        
        if (predictionResult.sl !== undefined) {
            mlSlLineRef.current = series.createPriceLine({
                price: predictionResult.sl,
                color: '#ef4444',
                lineWidth: 2,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title: 'PRED SL',
            });
        }

        if (predictionResult.tp !== undefined) {
            mlTpLineRef.current = series.createPriceLine({
                price: predictionResult.tp,
                color: '#10b981',
                lineWidth: 2,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title: 'PRED TP',
            });
        }

        if (currentCandleTime && onSetMarker) {
            const marker = {
                time: currentCandleTime,
                position: isBuy ? 'belowBar' : 'aboveBar',
                color: isBuy ? '#22c55e' : '#ef4444',
                shape: isBuy ? 'arrowUp' : 'arrowDown',
                text: `${predictionResult.signal} (AI)`
            };
            onSetMarker(marker);
        }
    }, [series, predictionResult, currentCandleTime]); // Note: deliberately removed onSetMarker from deps to prevent re-triggering

    // Handle unmount cleanup
    useEffect(() => {
        return () => {
            if (series) {
                if (mlSlLineRef.current) { series.removePriceLine(mlSlLineRef.current); mlSlLineRef.current = null; }
                if (mlTpLineRef.current) { series.removePriceLine(mlTpLineRef.current); mlTpLineRef.current = null; }
            }
        };
    }, [series]);

    return null;
};
