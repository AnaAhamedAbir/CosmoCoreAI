import { useState, useEffect } from 'react';
import api from '../services/api';
import { AdvancedMetricsSettings } from './useAdvancedMetricsSettings';

export const useAdvancedMetrics = (symbol: string, exchange: string, interval: string, settings: AdvancedMetricsSettings) => {
    const [tpoData, setTpoData] = useState<any>(null);
    const [deltaProfile, setDeltaProfile] = useState<any[]>([]);
    const [tradeBubbles, setTradeBubbles] = useState<any[]>([]);
    const [oibData, setOibData] = useState<any>(null);
    const [spoofingData, setSpoofingData] = useState<any[]>([]);
    const [vwapData, setVwapData] = useState<any[]>([]);
    const [divergenceData, setDivergenceData] = useState<any[]>([]);
    const [footprintData, setFootprintData] = useState<any[]>([]);

    useEffect(() => {
        let isMounted = true;

        const fetchData = async () => {
            try {
                const promises: Promise<any>[] = [];
                const keys: string[] = [];

                if (settings.showTPOProfile) {
                    promises.push(api.get('/advanced-metrics/tpo', { params: { symbol, exchange, interval: "5m", limit: 200 } }));
                    keys.push('tpo');
                } else { setTpoData(null); }

                if (settings.showDeltaProfile) {
                    promises.push(api.get('/advanced-metrics/delta-profile', { params: { symbol, exchange, limit: 1000 } }));
                    keys.push('delta');
                } else { setDeltaProfile([]); }

                if (settings.showTradeBubbles) {
                    promises.push(api.get('/advanced-metrics/trade-bubbles', { params: { symbol, exchange, limit: 1000 } }));
                    keys.push('bubbles');
                } else { setTradeBubbles([]); }

                if (settings.showOIBOscillator) {
                    promises.push(api.get('/advanced-metrics/oib-oscillator', { params: { symbol, exchange } }));
                    keys.push('oib');
                } else { setOibData(null); }

                if (settings.showSpoofingDetection) {
                    promises.push(api.get('/advanced-metrics/spoofing', { params: { symbol, exchange } }));
                    keys.push('spoofing');
                } else { setSpoofingData([]); }

                if (settings.showAnchoredVWAP) {
                    promises.push(api.get('/advanced-metrics/anchored-vwap', { params: { symbol, exchange, limit: 200 } }));
                    keys.push('vwap');
                } else { setVwapData([]); }

                if (settings.showDeltaDivergence) {
                    promises.push(api.get('/advanced-metrics/delta-divergence', { params: { symbol, exchange } }));
                    keys.push('divergence');
                } else { setDivergenceData([]); }

                if (settings.showFootprintImbalance) {
                    promises.push(api.get('/advanced-metrics/footprint-imbalances', { params: { symbol, exchange, limit: 1000 } }));
                    keys.push('footprint');
                } else { setFootprintData([]); }

                if (promises.length === 0) return;

                const results = await Promise.allSettled(promises);
                if (!isMounted) return;

                results.forEach((res, index) => {
                    const key = keys[index];
                    if (res.status === 'fulfilled' && res.value.data?.status === 'success') {
                        const data = res.value.data.data;
                        if (key === 'tpo') setTpoData(data);
                        if (key === 'delta') setDeltaProfile(data);
                        if (key === 'bubbles') setTradeBubbles(data);
                        if (key === 'oib') setOibData(data);
                        if (key === 'spoofing') setSpoofingData(data);
                        if (key === 'vwap') setVwapData(data);
                        if (key === 'divergence') setDivergenceData(data);
                        if (key === 'footprint') setFootprintData(data);
                    }
                });

            } catch (err) {
                console.warn('Error fetching Advanced Metrics:', err);
            }
        };

        fetchData();
        
        // Refresh every 60 seconds for dynamic metrics to avoid backend rate limiting
        const refreshInterval = setInterval(fetchData, 60000);

        return () => {
            isMounted = false;
            clearInterval(refreshInterval);
        };
    }, [symbol, exchange, interval, settings]);

    return { tpoData, deltaProfile, tradeBubbles, oibData, spoofingData, vwapData, divergenceData, footprintData };
};
