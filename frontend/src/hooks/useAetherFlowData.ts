import { useState, useEffect } from 'react';
import axios from 'axios';
import { AetherFlowData } from '../components/features/market/AetherFlowRenderer';

export const useAetherFlowData = (symbol: string, exchange: string, interval: string, enabled: boolean) => {
    const [data, setData] = useState<AetherFlowData | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!enabled) {
            setData(null);
            return;
        }

        let isMounted = true;
        
        const fetchData = async () => {
            setLoading(true);
            try {
                // Ensure symbol is formatted correctly (e.g. BTC/USDT)
                const formattedSymbol = symbol.includes('/') ? symbol : `${symbol.substring(0, symbol.length-4)}/${symbol.substring(symbol.length-4)}`;
                const response = await axios.get<AetherFlowData>(`/api/v1/market-data/aether-flow`, {
                    params: {
                        symbol: formattedSymbol,
                        exchange: exchange,
                        interval: interval,
                        limit: 500
                    }
                });
                
                if (isMounted) {
                    setData(response.data);
                    setError(null);
                }
            } catch (err: any) {
                if (isMounted) {
                    console.error("Failed to fetch Aether Flow data", err);
                    setError(err.message || 'Error fetching Aether Flow data');
                }
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchData();
        
        // Refresh every minute to simulate live update without hammering
        const intervalId = setInterval(fetchData, 60000);
        
        return () => {
            isMounted = false;
            clearInterval(intervalId);
        };
    }, [symbol, exchange, interval, enabled]);

    return { data, loading, error };
};
