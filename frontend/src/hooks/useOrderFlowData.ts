import { useState, useEffect } from 'react';
import api from '../services/api';
import { VPVRData } from '../components/features/market/VolumeProfileWidget';
import { CVDDataPoint } from '../components/features/market/CVDChart';
import { FootprintCandleData } from '../components/features/market/FootprintRenderer';
import { HeatmapDataPoint } from '../components/features/market/LiquidityHeatmapRenderer';
import { isThermalGuardActive } from '@/utils/deviceProfile';
import { subscribeLiveTradeTicks } from '@/services/liveMarketHub';

const parseOrderFlowIntervalMs = (interval: string): number => {
    const value = parseInt(interval, 10) || 1;
    const unit = interval.replace(/[0-9]/g, '') || 'm';
    switch (unit) {
        case 's': return value * 1000;
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        case 'w': return value * 7 * 24 * 60 * 60 * 1000;
        case 'M': return value * 30 * 24 * 60 * 60 * 1000;
        default: return value * 60 * 1000;
    }
};

interface OrderFlowData {
    heatmapData: HeatmapDataPoint[];
    vpvrData: VPVRData[];
    cvdData: CVDDataPoint[];
    footprintData: FootprintCandleData[];
    loading: boolean;
    error: string | null;
}

export const useOrderFlowData = (
    symbol: string,
    exchange: string = 'binance',
    interval: string = '1m',
    enabled: boolean = true
): OrderFlowData => {
    const [heatmapData, setHeatmapData] = useState<HeatmapDataPoint[]>([]);
    const [vpvrData, setVpvrData] = useState<VPVRData[]>([]);
    const [cvdData, setCvdData] = useState<CVDDataPoint[]>([]);
    const [footprintData, setFootprintData] = useState<FootprintCandleData[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!enabled || !symbol || !exchange || !interval) {
            setHeatmapData([]);
            setVpvrData([]);
            setCvdData([]);
            setFootprintData([]);
            setLoading(false);
            setError(null);
            return;
        }

        let isMounted = true;

        let activeFootprints: FootprintCandleData[] = [];
        const fetchOrderFlowData = async () => {
            if (!symbol || !exchange || !interval || !enabled) return;

            setLoading(true);
            setError(null);

            try {
                const params = { symbol: symbol.toUpperCase(), exchange, interval, limit: 1000 };

                // Fetch real historic klines and order book heatmap data
                const [klinesRes, heatmapRes] = await Promise.all([
                    api.get('/market-depth/ohlcv', { params: { symbol: symbol.toUpperCase(), exchange, timeframe: interval, limit: 1000 } }).catch(() => ({ data: [] })),
                    api.get('/market-depth/heatmap', { params: { symbol: symbol.toUpperCase(), exchange, bucket_size: 50.0, depth: 100 } }).catch(() => ({ data: { bids: [], asks: [] } }))
                ]);

                if (!isMounted) return;

                const rawKlines = klinesRes.data;
                const heatmap = heatmapRes.data?.bids ? [...heatmapRes.data.bids, ...heatmapRes.data.asks] : [];
                setHeatmapData(heatmap);

                if (rawKlines && rawKlines.length > 0) {
                    const parsedKlines = rawKlines.map((k: any) => ({
                        time: k.time,
                        open: parseFloat(k.open),
                        high: parseFloat(k.high),
                        low: parseFloat(k.low),
                        close: parseFloat(k.close),
                        volume: parseFloat(k.volume || 0),
                    }));

                    // 1. Calculate realistic VPVR (Volume Profile Visible Range) from real klines
                    const minPrice = Math.min(...parsedKlines.map((c: any) => c.low));
                    const maxPrice = Math.max(...parsedKlines.map((c: any) => c.high));
                    const step = (maxPrice - minPrice) / 60;

                    const priceBuckets = new Map<number, { vol: number; buy: number; sell: number }>();
                    let currentCvd = 0;
                    const cvd: CVDDataPoint[] = [];
                    const footprints: FootprintCandleData[] = [];

                    // Calculate basic CVD and VPVR from klines for historical context
                    parsedKlines.forEach((c: any) => {
                        const range = c.high - c.low || 1;
                        const buyRatio = Math.max(0, Math.min(1, (c.close - c.low) / range));
                        const sellRatio = 1 - buyRatio;
                        const buyVol = c.volume * buyRatio;
                        const sellVol = c.volume * sellRatio;
                        
                        const delta = buyVol - sellVol;
                        currentCvd += delta;
                        cvd.push({ time: c.time as any, value: currentCvd });

                        const bucketPrice = Math.floor(c.close / step) * step;
                        const existing = priceBuckets.get(bucketPrice) || { vol: 0, buy: 0, sell: 0 };
                        
                        priceBuckets.set(bucketPrice, {
                            vol: existing.vol + c.volume,
                            buy: existing.buy + buyVol,
                            sell: existing.sell + sellVol
                        });

                        // 2. Simulate Footprint Ticks for Historical Data
                        const ticks: import('../components/features/market/FootprintRenderer').FootprintDataTick[] = [];
                        let tickStep = 0.5;
                        if (c.close < 0.1) tickStep = 0.0001;
                        else if (c.close < 1) tickStep = 0.001;
                        else if (c.close < 10) tickStep = 0.01;
                        else if (c.close < 100) tickStep = 0.1;
                        
                        // Roughly 5-15 ticks per candle (clamped to prevent runaway loops)
                        const roughTicks = Math.min(15, Math.max(2, Math.floor(range / tickStep) || 2));
                        const tStep = range / roughTicks;
                        const seenPrices = new Set<number>();
                        
                        let currentPrice = c.low;
                        while(currentPrice <= c.high) {
                            const bPrice = Math.floor(currentPrice / tickStep) * tickStep;
                            if(!seenPrices.has(bPrice)) {
                                seenPrices.add(bPrice);
                                ticks.push({
                                    price: bPrice,
                                    bidVolume: sellVol / roughTicks,
                                    askVolume: buyVol / roughTicks,
                                    isImbalance: false,
                                    imbalanceType: undefined,
                                    isStackedImbalance: false,
                                    isUnfinishedAuction: false,
                                    isAbsorption: false
                                });
                            }
                            currentPrice += tStep;
                            if (tStep <= 0) break;
                        }
                        
                        // Post-process historic ticks
                        if (ticks.length > 0) {
                            ticks.sort((a,b) => b.price - a.price);
                            let totalVol = 0;
                            for (let i = 0; i < ticks.length; i++) {
                                totalVol += ticks[i].bidVolume + ticks[i].askVolume;
                            }
                            const avgTickVol = totalVol / ticks.length;

                            for (let i = 0; i < ticks.length; i++) {
                                const t = ticks[i];
                                t.isUnfinishedAuction = (i === 0 || i === ticks.length - 1) && t.bidVolume > 0 && t.askVolume > 0;
                                
                                t.isStackedImbalance = false;
                                if (t.isImbalance && t.imbalanceType) {
                                    if (i < ticks.length - 2) {
                                        const t2 = ticks[i + 1];
                                        const t3 = ticks[i + 2];
                                        if (t2.isImbalance && t3.isImbalance && 
                                            t.imbalanceType === (t2.bidVolume > t2.askVolume ? 'bid' : 'ask') && 
                                            t.imbalanceType === (t3.bidVolume > t3.askVolume ? 'bid' : 'ask')) {
                                                t.isStackedImbalance = true;
                                                t2.isStackedImbalance = true;
                                                t3.isStackedImbalance = true;
                                                t2.imbalanceType = t.imbalanceType;
                                                t3.imbalanceType = t.imbalanceType;
                                        }
                                    }
                                }
                                
                                const tVol = t.bidVolume + t.askVolume;
                                t.isAbsorption = tVol > (avgTickVol * 3.0) && tVol > 0;
                            }
                        }

                        let pocPrice = c.low;
                        let maxVol = 0;
                        let totalDelta = 0;

                        if (ticks.length > 0) {
                            for (let i = 0; i < ticks.length; i++) {
                                const tVol = ticks[i].bidVolume + ticks[i].askVolume;
                                totalDelta += (ticks[i].askVolume - ticks[i].bidVolume);
                                if (tVol > maxVol) {
                                    maxVol = tVol;
                                    pocPrice = ticks[i].price;
                                }
                            }
                        }

                        let isDivergent = false;
                        if (c.close > c.open && totalDelta < 0) isDivergent = true;
                        if (c.close < c.open && totalDelta > 0) isDivergent = true;

                        footprints.push({
                            time: c.time as any,
                            open: c.open,
                            close: c.close,
                            high: c.high,
                            low: c.low,
                            pocPrice: pocPrice,
                            totalDelta: totalDelta,
                            hasDeltaDivergence: isDivergent,
                            ticks: ticks
                        });
                    });

                    const vpvr: VPVRData[] = Array.from(priceBuckets.entries()).map(([price, data]) => ({
                        price,
                        volume: data.vol,
                        buyVolume: data.buy,
                        sellVolume: data.sell
                    }));

                    if (!isMounted) return;
                    setVpvrData(vpvr);
                    setCvdData(cvd); // Pre-fill with historical data
                    
                    // Initialize active footprints array so WebSocket knows where to append
                    activeFootprints = footprints.slice(); 
                    setFootprintData(footprints); // Pre-fill with simulated historical footprint data
                } else {
                    if (!isMounted) return;
                    setVpvrData([]);
                    setCvdData([]);
                    setFootprintData([]);
                }
            } catch (err) {
                console.error("Failed to fetch order flow data:", err);
                if (isMounted) setError("Failed to load order flow data.");
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchOrderFlowData();
        
        // Shared Live Market Hub subscription for Order Flow (Real-Time CVD & Footprints)
        let pendingCvdDelta = 0;
        let pendingCandleTime: number | null = null;
        let hasPendingFootprint = false;
        let orderFlowThrottleTimer: ReturnType<typeof setTimeout> | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

        const flushOrderFlow = () => {
            if (!isMounted) {
                orderFlowThrottleTimer = null;
                return;
            }
            if (isThermalGuardActive() && typeof document !== 'undefined' && document.hidden) {
                // Defer React flush while tab is hidden; keep pending values for when visible
                orderFlowThrottleTimer = null;
                return;
            }
            if (pendingCvdDelta !== 0 && pendingCandleTime !== null) {
                const delta = pendingCvdDelta;
                const cTime = pendingCandleTime;
                pendingCvdDelta = 0;
                setCvdData(prev => {
                    if (prev.length === 0) {
                        return [{ time: cTime as any, value: delta }];
                    }
                    const lastPoint = prev[prev.length - 1];
                    if (lastPoint.time === cTime) {
                        const newPrev = [...prev];
                        newPrev[newPrev.length - 1] = { time: cTime as any, value: lastPoint.value + delta };
                        return newPrev;
                    } else {
                        return [...prev.slice(-2000), { time: cTime as any, value: lastPoint.value + delta }];
                    }
                });
            }
            if (hasPendingFootprint) {
                hasPendingFootprint = false;
                setFootprintData([...activeFootprints.slice(-2000)]);
            }
            orderFlowThrottleTimer = null;
        };

        const scheduleOrderFlowFlush = () => {
            if (!orderFlowThrottleTimer) {
                const flushDelayMs = isThermalGuardActive() ? 1000 : 250;
                orderFlowThrottleTimer = setTimeout(flushOrderFlow, flushDelayMs);
            }
        };

        const handleVisibilityChange = () => {
            if (
                typeof document !== 'undefined' &&
                !document.hidden &&
                isMounted &&
                ((pendingCvdDelta !== 0 && pendingCandleTime !== null) || hasPendingFootprint)
            ) {
                flushOrderFlow();
            }
        };

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibilityChange);
        }

        // Subscribe to exchange-aware live trade ticks via shared liveMarketHub (works for ALL exchanges & sub-minute intervals)
        let unsubscribeLiveTicks: (() => void) | null = null;
        if (symbol && exchange) {
            const intervalMs = parseOrderFlowIntervalMs(interval);
            unsubscribeLiveTicks = subscribeLiveTradeTicks(symbol, exchange, (tick) => {
                try {
                    const price = Number(tick.price);
                    const amount = Number(tick.quantity ?? tick.volume ?? 0);
                    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(amount) || amount <= 0) return;

                    const isBuy = tick.side ? tick.side === 'buy' : !tick.isBuyerMaker;
                    const rawTs = tick.timestamp || Date.now();
                    const tsMs = rawTs < 10000000000 ? rawTs * 1000 : rawTs;
                    const currentCandleTime = Math.floor(tsMs / intervalMs) * (intervalMs / 1000);
                    const now = currentCandleTime;

                    // Guard against out-of-order older ticks corrupting chronological Footprint/CVD series
                    if (activeFootprints.length > 0 && now < Number(activeFootprints[activeFootprints.length - 1].time)) {
                        return;
                    }

                    const cvdDelta = isBuy ? amount : -amount;

                    // Update Footprint
                    if (activeFootprints.length === 0 || activeFootprints[activeFootprints.length - 1].time !== now) {
                        activeFootprints.push({
                            time: now as any,
                            open: price,
                            close: price,
                            high: price,
                            low: price,
                            pocPrice: price,
                            totalDelta: 0,
                            hasDeltaDivergence: false,
                            ticks: []
                        });
                    }

                    const currentCandle = activeFootprints[activeFootprints.length - 1];
                    currentCandle.close = price;
                    if (price > currentCandle.high) currentCandle.high = price;
                    if (price < currentCandle.low) currentCandle.low = price;

                    let tickStep = 0.5;
                    if (price < 0.1) tickStep = 0.0001;
                    else if (price < 1) tickStep = 0.001;
                    else if (price < 10) tickStep = 0.01;
                    else if (price < 100) tickStep = 0.1;

                    const bucketPrice = Math.floor(price / tickStep) * tickStep;
                    let fpTick = currentCandle.ticks.find(t => t.price === bucketPrice);

                    if (!fpTick) {
                        fpTick = { price: bucketPrice, bidVolume: 0, askVolume: 0, isImbalance: false };
                        currentCandle.ticks.push(fpTick);
                        currentCandle.ticks.sort((a, b) => b.price - a.price);
                    }

                    if (isBuy) fpTick.askVolume += amount;
                    else fpTick.bidVolume += amount;

                    fpTick.isImbalance = Math.max(fpTick.bidVolume, fpTick.askVolume) > Math.min(fpTick.bidVolume, fpTick.askVolume) * 2;
                    fpTick.imbalanceType = fpTick.isImbalance ? (fpTick.bidVolume > fpTick.askVolume ? 'bid' : 'ask') : undefined;

                    const ticks = currentCandle.ticks;
                    if (ticks.length > 0) {
                        let totalVol = 0;
                        for (let i = 0; i < ticks.length; i++) {
                            totalVol += ticks[i].bidVolume + ticks[i].askVolume;
                        }
                        const avgTickVol = totalVol / ticks.length;

                        for (let i = 0; i < ticks.length; i++) {
                            const t = ticks[i];
                            t.isUnfinishedAuction = (i === 0 || i === ticks.length - 1) && t.bidVolume > 0 && t.askVolume > 0;
                            t.isStackedImbalance = false;
                            if (t.isImbalance && t.imbalanceType && i < ticks.length - 2) {
                                const t2 = ticks[i + 1];
                                const t3 = ticks[i + 2];
                                if (
                                    t2.isImbalance && t3.isImbalance &&
                                    t.imbalanceType === (t2.bidVolume > t2.askVolume ? 'bid' : 'ask') &&
                                    t.imbalanceType === (t3.bidVolume > t3.askVolume ? 'bid' : 'ask')
                                ) {
                                    t.isStackedImbalance = true;
                                    t2.isStackedImbalance = true;
                                    t3.isStackedImbalance = true;
                                    t2.imbalanceType = t.imbalanceType;
                                    t3.imbalanceType = t.imbalanceType;
                                }
                            }
                            const tVol = t.bidVolume + t.askVolume;
                            t.isAbsorption = tVol > (avgTickVol * 3.0) && tVol > 0;
                        }

                        let pocPrice = currentCandle.low;
                        let maxVol = 0;
                        let totalDelta = 0;
                        for (let i = 0; i < ticks.length; i++) {
                            const tVol = ticks[i].bidVolume + ticks[i].askVolume;
                            totalDelta += (ticks[i].askVolume - ticks[i].bidVolume);
                            if (tVol > maxVol) {
                                maxVol = tVol;
                                pocPrice = ticks[i].price;
                            }
                        }
                        currentCandle.pocPrice = pocPrice;
                        currentCandle.totalDelta = totalDelta;

                        const cClose = currentCandle.close || currentCandle.low;
                        const cOpen = currentCandle.open || currentCandle.low;
                        currentCandle.hasDeltaDivergence = (cClose > cOpen && totalDelta < 0) || (cClose < cOpen && totalDelta > 0);
                    }

                    if (isMounted) {
                        pendingCvdDelta += cvdDelta;
                        pendingCandleTime = currentCandleTime;
                        hasPendingFootprint = true;
                        scheduleOrderFlowFlush();
                    }
                } catch (e) {
                    console.error("Order flow live tick error", e);
                }
            });
        }

        return () => {
            isMounted = false;
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityChange);
            }
            if (orderFlowThrottleTimer) {
                clearTimeout(orderFlowThrottleTimer);
                orderFlowThrottleTimer = null;
            }
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            if (unsubscribeLiveTicks) {
                unsubscribeLiveTicks();
                unsubscribeLiveTicks = null;
            }
        };
    }, [symbol, exchange, interval, enabled]);

    return { heatmapData, vpvrData, cvdData, footprintData, loading, error };
};
