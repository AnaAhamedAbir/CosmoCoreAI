import apiClient from './client';

export const marketDepthService = {
    getOHLCV: async (
        symbol: string,
        exchange: string,
        timeframe: string,
        limit: number = 200,
        before?: number
    ) => {
        const params: Record<string, any> = {
            symbol,
            exchange,
            timeframe,
            limit,
        };
        if (before !== undefined && Number.isFinite(before) && before > 0) {
            params.before = Math.floor(before);
        }
        const response = await apiClient.get('/market-depth/ohlcv', { params });
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
    },
    getOrderflowCVD: async (symbol: string, exchange: string, interval: string, limit: number = 500) => {
        const response = await apiClient.get('/market-depth/orderflow/cvd', {
            params: { symbol, exchange, interval, limit }
        });
        return response.data;
    },
    getOrderflowHeatmapHistory: async (symbol: string, exchange: string, interval: string, limit: number = 200) => {
        const response = await apiClient.get('/market-depth/orderflow/heatmap-history', {
            params: { symbol, exchange, interval, limit }
        });
        return response.data;
    },
    getOrderflowFootprint: async (symbol: string, exchange: string, interval: string, limit: number = 120) => {
        const response = await apiClient.get('/market-depth/orderflow/footprint', {
            params: { symbol, exchange, interval, limit }
        });
        return response.data;
    }
};
