import { useState, useEffect } from 'react';
import { subscribeMarketDepthEvents } from './useMarketDepthEvents';

export interface MLSetupEvent {
    type: string;
    symbol: string;
    side: string;
    sl_price: number;
    tp_price: number;
    rr_ratio: number;
    confidence: number;
    timestamp: number;
}

export const useMLSetupEvents = (symbol: string, enabled: boolean = true) => {
    const [mlSetup, setMlSetup] = useState<MLSetupEvent | null>(null);

    useEffect(() => {
        if (!symbol || !enabled) return;

        return subscribeMarketDepthEvents(symbol, (data: MLSetupEvent) => {
            if (data && data.type === 'ML_ADVANCED_SETUP') {
                setMlSetup({
                    ...data,
                    timestamp: Date.now(),
                });
            }
        });
    }, [symbol, enabled]);

    return mlSetup;
};
