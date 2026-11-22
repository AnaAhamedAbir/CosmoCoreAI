import apiClient from './client';

export interface FearAndGreedData {
    value: number;
    value_classification: string;
    timestamp: number;
    time_until_update?: string;
    error?: string;
}

export const getFearAndGreedIndex = async (): Promise<FearAndGreedData> => {
    try {
        const response = await apiClient.get('/fng/latest');
        return response.data;
    } catch (error) {
        console.error('Error fetching Fear & Greed Index:', error);
        return {
            value: 50,
            value_classification: 'Neutral',
            timestamp: Date.now() / 1000,
            error: 'Failed to fetch data',
        };
    }
};
