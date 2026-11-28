import { useState, useEffect, useRef } from 'react';
import { marketDepthService } from '../services/marketDepthService';
import { HeatmapDataPoint } from '../components/features/market/LiquidityHeatmapRenderer';
import { isThermalGuardActive } from '@/utils/deviceProfile';
import { OrderBookLevel } from '@/services/liveMarketHub';
import {
    computeAdaptivePriceStep,
    snapPriceToStep,
} from '../utils/orderflowMath';
import { alignCandleBucketSec, toUnixSec } from '../utils/candleTime';

function aggregateLiveBookToLevels(
    bids: OrderBookLevel[],
    asks: OrderBookLevel[],
    preferredBucketSize?: number
): { levels: HeatmapDataPoint['levels']; bucketSize: number } {
    if ((!bids || bids.length === 0) && (!asks || asks.length === 0)) {
        return { levels: [], bucketSize: preferredBucketSize || 0 };
    }
    const bestBid = bids[0]?.price || 0;
    const bestAsk = asks[0]?.price || 0;
    const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : Math.max(bestBid, bestAsk);
    if (mid <= 0) return { levels: [], bucketSize: preferredBucketSize || 0 };

    const bucketSize =
        preferredBucketSize && preferredBucketSize > 0
            ? preferredBucketSize
            : computeAdaptivePriceStep(mid, 0.0008);

    const bidMap = new Map<number, number>();
    for (let i = 0; i < bids.length; i++) {
        const b = bids[i];
        if (!b || b.price <= 0 || b.size <= 0) continue;
        const bp = snapPriceToStep(b.price, bucketSize, 'floor');
        bidMap.set(bp, (bidMap.get(bp) || 0) + b.size);
    }

    const askMap = new Map<number, number>();
    for (let i = 0; i < asks.length; i++) {
        const a = asks[i];
        if (!a || a.price <= 0 || a.size <= 0) continue;
        const ap = snapPriceToStep(a.price, bucketSize, 'ceil');
        askMap.set(ap, (askMap.get(ap) || 0) + a.size);
    }

    const levels: HeatmapDataPoint['levels'] = [];
    bidMap.forEach((volume, price) => {
        levels.push({ price, volume, notional: price * volume, type: 'bid' });
    });
    askMap.forEach((volume, price) => {
        levels.push({ price, volume, notional: price * volume, type: 'ask' });
    });

    return { levels, bucketSize };
}

export const useHeatmapData = (
    symbol: string,
    exchange: string = 'binance',
    enabled: boolean = true,
    interval: string = '1m',
    liveBids: OrderBookLevel[] = [],
    liveAsks: OrderBookLevel[] = []
) => {
    const [heatmapData, setHeatmapData] = useState<HeatmapDataPoint[]>([]);
    const [bucketSize, setBucketSize] = useState<number>(0);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const bucketSizeRef = useRef<number>(0);
    const lastLiveMergeAtRef = useRef<number>(0);

    // 1. Fetch candle-aligned historical L2 heatmap snapshots from modular backend recorder
    useEffect(() => {
        let isMounted = true;
        setHeatmapData([]);
        setBucketSize(0);
        bucketSizeRef.current = 0;

        if (!symbol || !exchange || !enabled) {
            setLoading(false);
            setError(null);
            return;
        }

        const fetchHistory = async () => {
            if (!symbol || !exchange) return;
            if (isThermalGuardActive() && typeof document !== 'undefined' && document.hidden) return;
            try {
                const res = await marketDepthService.getOrderflowHeatmapHistory(
                    symbol.toUpperCase(),
                    exchange,
                    interval,
                    200
                );
                if (!isMounted) return;

                const serverBucket = Number(res?.bucket_size || 0);
                if (serverBucket > 0) {
                    bucketSizeRef.current = serverBucket;
                    setBucketSize(serverBucket);
                }

                const snaps = Array.isArray(res?.snapshots) ? res.snapshots : [];
                const parsed: HeatmapDataPoint[] = snaps
                    .filter((s: any) => s && Number.isFinite(Number(s.time)) && Array.isArray(s.levels))
                    .map((s: any) => ({
                        time: alignCandleBucketSec(toUnixSec(Number(s.time)), interval),
                        bucketSize: Number(s.bucket_size || serverBucket || 0),
                        levels: s.levels.map((lv: any) => ({
                            price: Number(lv.price),
                            volume: Number(lv.volume),
                            peakVolume: Number(lv.peak_volume || lv.volume),
                            pulledDelta: Number(lv.pulled_delta || 0),
                            notional: Number(lv.notional || Number(lv.price) * Number(lv.volume)),
                            type: lv.type === 'bid' ? 'bid' : 'ask',
                        })),
                    }));

                if (parsed.length > 0) {
                    setHeatmapData((prev) => {
                        const merged = new Map<number, HeatmapDataPoint>();
                        prev.forEach((p) => merged.set(p.time, p));
                        parsed.forEach((p) => merged.set(p.time, p));
                        return Array.from(merged.values())
                            .sort((a, b) => a.time - b.time)
                            .slice(-240);
                    });
                }
                setError(null);
            } catch (err) {
                console.error('Failed to fetch aligned L2 heatmap history:', err);
                if (isMounted) setError('Failed to load L2 heatmap data.');
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        setLoading(true);
        fetchHistory();

        const pollMs = isThermalGuardActive() ? 25000 : 12000;
        intervalRef.current = setInterval(fetchHistory, pollMs);

        return () => {
            isMounted = false;
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [symbol, exchange, interval, enabled]);

    // 2. Real-time candle-aligned heatmap updates directly from liveMarketHub L2 bids/asks (0 REST calls!)
    useEffect(() => {
        if (!enabled || !symbol || !exchange) return;
        if (liveBids.length === 0 && liveAsks.length === 0) return;

        const nowMs = Date.now();
        const minThrottleMs = isThermalGuardActive() ? 2000 : 750;
        if (nowMs - lastLiveMergeAtRef.current < minThrottleMs) return;
        lastLiveMergeAtRef.current = nowMs;

        const barTime = alignCandleBucketSec(Math.floor(nowMs / 1000), interval);
        const { levels, bucketSize: calcBucket } = aggregateLiveBookToLevels(
            liveBids,
            liveAsks,
            bucketSizeRef.current > 0 ? bucketSizeRef.current : undefined
        );
        if (levels.length === 0) return;

        if (calcBucket > 0 && bucketSizeRef.current === 0) {
            bucketSizeRef.current = calcBucket;
            setBucketSize(calcBucket);
        }

        const livePoint: HeatmapDataPoint = {
            time: barTime,
            bucketSize: calcBucket || bucketSizeRef.current,
            levels,
        };

        setHeatmapData((prev) => {
            if (prev.length > 0 && barTime < prev[prev.length - 1].time) {
                return prev;
            }
            if (prev.length > 0 && prev[prev.length - 1].time === barTime) {
                // Preserve peakVolume across live updates in the same candle bar to detect pulled/spoofed walls
                const prevBar = prev[prev.length - 1];
                const prevPeaks = new Map<string, number>();
                for (let i = 0; i < prevBar.levels.length; i++) {
                    const lv = prevBar.levels[i];
                    prevPeaks.set(`${lv.type}:${lv.price}`, lv.peakVolume ?? lv.volume);
                }
                const enrichedLevels = levels.map((lv) => {
                    const prevPeak = prevPeaks.get(`${lv.type}:${lv.price}`) ?? lv.volume;
                    const peakVolume = Math.max(prevPeak, lv.volume);
                    return {
                        ...lv,
                        peakVolume,
                        pulledDelta: lv.volume - peakVolume,
                    };
                });
                return [...prev.slice(0, -1), { ...livePoint, levels: enrichedLevels }];
            }
            const next = [...prev, livePoint];
            return next.length > 240 ? next.slice(-240) : next;
        });
    }, [enabled, symbol, exchange, interval, liveBids, liveAsks]);

    return { heatmapData, bucketSize, loading, error };
};
