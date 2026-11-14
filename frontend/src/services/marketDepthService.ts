import apiClient from './client';

export const marketDepthService = {
    getOHLCV: async (symbol: string, exchange: string, timeframe: string, limit: number = 200) => {
        const response = await apiClient.get('/market-depth/ohlcv', {
            params: {
                symbol,
                exchange,
                timeframe,
                limit
            }
        });
        return response.data;
    },
    getRawOrderBook: async (symbol: string, exchange: string, limit: number = 100) => {
        const response = await apiClient.get('/market-depth/book', {
            params: {
                symbol,
                exchange,
                limit
            }
        });
        return response.data;
    },
    getLiquiditySweepAbsorption: async (params: {
        symbol: string;
        exchange: string;
        interval: string;
        limit?: number;
        lookback?: number;
        min_absorbed_usd?: number;
        window_sec?: number;
        include_historical?: boolean;
    }) => {
        const response = await apiClient.get('/market-depth/liquidity-sweep-absorption', { params });
        return response.data;
    }
};
