import { useState, useEffect } from 'react';
import {
    acquireMarketStream,
    EMPTY_MARKET_DEPTH_DATA,
    getMarketChannelKey,
    MarketDepthData,
} from '@/services/liveMarketHub';

export type {
    OrderBookLevel,
    TradeTickEvent,
    BboTickEvent,
    MarkPriceEvent,
    FeedHealthMode,
    FeedHealthSnapshot,
    MarketDepthData,
} from '@/services/liveMarketHub';

export {
    subscribeLiveTradeTicks,
    subscribeLiveBbo,
    subscribeLiveMarkPrice,
    subscribeFeedHealth,
    getLatestLiveBbo,
    getLatestLiveTick,
    getLatestMarkPrice,
    getFeedHealth,
    reconnectMarketStream,
} from '@/services/liveMarketHub';

/**
 * React hook subscribed to the ref-counted shared Live Market Hub.
 * Multiple split charts or components watching the same `exchange:symbol`
 * automatically share ONE WebSocket + ONE Web Worker + ONE direct exchange feed.
 */
export const useLevel2MarketData = (symbol: string, exchange: string = 'binance'): MarketDepthData => {
    const currentKey = symbol && exchange ? getMarketChannelKey(symbol, exchange) : '';
    const [state, setState] = useState<{ key: string; data: MarketDepthData }>(() => ({
        key: currentKey,
        data: EMPTY_MARKET_DEPTH_DATA,
    }));

    useEffect(() => {
        if (!symbol || !exchange) {
            setState({ key: '', data: EMPTY_MARKET_DEPTH_DATA });
            return;
        }

        const effectKey = getMarketChannelKey(symbol, exchange);
        setState({ key: effectKey, data: EMPTY_MARKET_DEPTH_DATA });

        const release = acquireMarketStream(symbol, exchange, (nextData) => {
            setState({ key: effectKey, data: nextData });
        });

        return () => {
            release();
        };
    }, [symbol, exchange]);

    return state.key === currentKey ? state.data : EMPTY_MARKET_DEPTH_DATA;
};
