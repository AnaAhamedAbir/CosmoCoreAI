import { useState, useEffect } from 'react';
import { marketDepthService } from '../services/marketDepthService';
import { VPVRData } from '../components/features/market/VolumeProfileWidget';
import { CVDDataPoint, CVDMeta } from '../components/features/market/CVDChart';
import { FootprintCandleData, FootprintDataTick } from '../components/features/market/FootprintRenderer';
import { isThermalGuardActive } from '@/utils/deviceProfile';
import { subscribeLiveTradeTicks } from '@/services/liveMarketHub';
import {
    parseOrderflowIntervalSec,
    computeAdaptivePriceStep,
    snapPriceToStep,
    enrichFootprintCandleClient,
} from '../utils/orderflowMath';

interface OrderFlowData {
    vpvrData: VPVRData[];
    cvdData: CVDDataPoint[];
    cvdMeta: CVDMeta | null;
    footprintData: FootprintCandleData[];
    loading: boolean;
    error: string | null;
}

export const useOrderFlowData = (
    symbol: string,
    exchange: string = 'binance',
    interval: string = '1m',
    enabled: boolean = true,
    includeFootprint: boolean = true
): OrderFlowData => {
    const [vpvrData, setVpvrData] = useState<VPVRData[]>([]);
    const [cvdData, setCvdData] = useState<CVDDataPoint[]>([]);
    const [cvdMeta, setCvdMeta] = useState<CVDMeta | null>(null);
    const [footprintData, setFootprintData] = useState<FootprintCandleData[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!enabled || !symbol || !exchange || !interval) {
            setVpvrData([]);
            setCvdData([]);
            setCvdMeta(null);
            setFootprintData([]);
            setLoading(false);
            setError(null);
            return;
        }

        let isMounted = true;
        let activeFootprints: FootprintCandleData[] = [];
        let activeTickStep = 0;

        const fetchOrderFlowData = async () => {
            if (!symbol || !exchange || !interval || !enabled) return;

            setLoading(true);
            setError(null);

            try {
                const upperSym = symbol.toUpperCase();

                // Parallel fetch of modular backend endpoints:
                // 1) True-CVD (Binance taker_buy_volume + per-candle delta + divergence)
                // 2) Real trade-clustered Footprint history (recorded by FootprintRecorder)
                // 3) OHLCV (for VPVR + baseline context)
                const [cvdRes, fpRes, klinesRes] = await Promise.all([
                    marketDepthService.getOrderflowCVD(upperSym, exchange, interval, 1000).catch(() => null),
                    includeFootprint
                        ? marketDepthService.getOrderflowFootprint(upperSym, exchange, interval, 120).catch(() => null)
                        : Promise.resolve(null),
                    marketDepthService.getOHLCV(upperSym, exchange, interval, 1000).catch(() => []),
                ]);

                if (!isMounted) return;

                // ── 1. Institutional True-CVD Series ──
                if (cvdRes && Array.isArray(cvdRes.points) && cvdRes.points.length > 0) {
                    const parsedCvd: CVDDataPoint[] = cvdRes.points.map((p: any) => ({
                        time: Number(p.time),
                        value: Number(p.value),
                        delta: Number(p.delta || 0),
                        buyVolume: Number(p.buyVolume || 0),
                        sellVolume: Number(p.sellVolume || 0),
                    }));
                    setCvdData(parsedCvd);
                    setCvdMeta({
                        isTrueDelta: Boolean(cvdRes.is_true_delta),
                        buyPct: Number(cvdRes.summary?.buy_pct ?? 50),
                        sellPct: Number(cvdRes.summary?.sell_pct ?? 50),
                        divergence: cvdRes.summary?.divergence || null,
                    });
                } else {
                    setCvdData([]);
                    setCvdMeta(null);
                }

                // ── 2. VPVR from real OHLCV (using true buy/sell ratio when available) ──
                const rawKlines = Array.isArray(klinesRes) ? klinesRes : [];
                const cvdByTime = new Map<number, { buy: number; sell: number }>();
                if (cvdRes && Array.isArray(cvdRes.points)) {
                    for (let i = 0; i < cvdRes.points.length; i++) {
                        const p = cvdRes.points[i];
                        cvdByTime.set(Number(p.time), {
                            buy: Number(p.buyVolume || 0),
                            sell: Number(p.sellVolume || 0),
                        });
                    }
                }

                if (rawKlines.length > 0) {
                    const parsedKlines = rawKlines.map((k: any) => ({
                        time: Number(k.time),
                        open: parseFloat(k.open),
                        high: parseFloat(k.high),
                        low: parseFloat(k.low),
                        close: parseFloat(k.close),
                        volume: parseFloat(k.volume || 0),
                    }));

                    const minPrice = Math.min(...parsedKlines.map((c) => c.low));
                    const maxPrice = Math.max(...parsedKlines.map((c) => c.high));
                    const step = (maxPrice - minPrice) / 60 || computeAdaptivePriceStep(parsedKlines[parsedKlines.length - 1].close);

                    const priceBuckets = new Map<number, { vol: number; buy: number; sell: number }>();
                    for (let i = 0; i < parsedKlines.length; i++) {
                        const c = parsedKlines[i];
                        const trueSplit = cvdByTime.get(c.time);
                        let buyVol: number;
                        let sellVol: number;
                        if (trueSplit && (trueSplit.buy + trueSplit.sell) > 0) {
                            buyVol = trueSplit.buy;
                            sellVol = trueSplit.sell;
                        } else {
                            const range = c.high - c.low || 1;
                            const buyRatio = Math.max(0, Math.min(1, (c.close - c.low) / range));
                            buyVol = c.volume * buyRatio;
                            sellVol = c.volume - buyVol;
                        }
                        const bucketPrice = Math.floor(c.close / step) * step;
                        const existing = priceBuckets.get(bucketPrice) || { vol: 0, buy: 0, sell: 0 };
                        priceBuckets.set(bucketPrice, {
                            vol: existing.vol + c.volume,
                            buy: existing.buy + buyVol,
                            sell: existing.sell + sellVol,
                        });
                    }

                    const vpvr: VPVRData[] = Array.from(priceBuckets.entries()).map(([price, data]) => ({
                        price,
                        volume: data.vol,
                        buyVolume: data.buy,
                        sellVolume: data.sell,
                    }));
                    setVpvrData(vpvr);

                    // ── 3. Real Recorded Footprint Clusters + True-Delta Historical Context ──
                    const realFpMap = new Map<number, FootprintCandleData>();
                    if (fpRes && Array.isArray(fpRes.candles)) {
                        if (Number(fpRes.tick_step) > 0) {
                            activeTickStep = Number(fpRes.tick_step);
                        }
                        for (let i = 0; i < fpRes.candles.length; i++) {
                            const rc = fpRes.candles[i];
                            if (rc && Number.isFinite(Number(rc.time)) && Array.isArray(rc.ticks) && rc.ticks.length > 0) {
                                realFpMap.set(Number(rc.time), {
                                    time: Number(rc.time),
                                    open: Number(rc.open),
                                    high: Number(rc.high),
                                    low: Number(rc.low),
                                    close: Number(rc.close),
                                    pocPrice: Number(rc.pocPrice),
                                    totalDelta: Number(rc.totalDelta),
                                    totalVolume: Number(rc.totalVolume),
                                    hasDeltaDivergence: Boolean(rc.hasDeltaDivergence),
                                    divergenceType: rc.divergenceType || undefined,
                                    isRealCluster: true,
                                    tickStep: Number(rc.tickStep || activeTickStep || 0),
                                    ticks: rc.ticks.map((t: any) => ({
                                        price: Number(t.price),
                                        bidVolume: Number(t.bidVolume || 0),
                                        askVolume: Number(t.askVolume || 0),
                                        isImbalance: Boolean(t.isImbalance),
                                        imbalanceType: t.imbalanceType || undefined,
                                        isStackedImbalance: Boolean(t.isStackedImbalance),
                                        isUnfinishedAuction: Boolean(t.isUnfinishedAuction),
                                        isAbsorption: Boolean(t.isAbsorption),
                                    })),
                                });
                            }
                        }
                    }

                    const lastClose = parsedKlines[parsedKlines.length - 1].close;
                    if (!activeTickStep || activeTickStep <= 0) {
                        activeTickStep = computeAdaptivePriceStep(lastClose, 0.0004);
                    }

                    // Use REAL trade clusters wherever recorded; for older unrecorded bars, build clean
                    // body-weighted profile using TRUE taker buy/sell volumes (no fake equal-split bars).
                    const mergedFootprints: FootprintCandleData[] = [];
                    const recentKlines = parsedKlines.slice(-150);

                    for (let i = 0; i < recentKlines.length; i++) {
                        const c = recentKlines[i];
                        const realCluster = realFpMap.get(c.time);
                        if (realCluster) {
                            mergedFootprints.push(realCluster);
                            continue;
                        }

                        const trueSplit = cvdByTime.get(c.time);
                        const range = Math.max(c.high - c.low, activeTickStep);
                        let buyVol: number;
                        let sellVol: number;
                        if (trueSplit && (trueSplit.buy + trueSplit.sell) > 0) {
                            buyVol = trueSplit.buy;
                            sellVol = trueSplit.sell;
                        } else {
                            const buyRatio = Math.max(0.05, Math.min(0.95, (c.close - c.low) / range));
                            buyVol = c.volume * buyRatio;
                            sellVol = c.volume - buyVol;
                        }

                        // Bell-curve concentration around candle body midpoint (more realistic than flat split)
                        const rowsCount = Math.min(10, Math.max(3, Math.round(range / activeTickStep)));
                        const rowStep = range / rowsCount;
                        const bodyMid = (c.open + c.close) / 2;
                        const rawWeights: { price: number; w: number; bias: number }[] = [];
                        let weightSum = 0;
                        const seenPx = new Set<number>();

                        for (let r = 0; r < rowsCount; r++) {
                            const rawP = c.low + (r + 0.5) * rowStep;
                            const snapped = snapPriceToStep(rawP, activeTickStep, 'floor');
                            if (seenPx.has(snapped)) continue;
                            seenPx.add(snapped);
                            const dist = Math.abs(rawP - bodyMid) / (range * 0.5 + 1e-9);
                            const w = Math.exp(-dist * dist * 1.4);
                            // Higher prices skew slightly toward asks, lower prices toward bids
                            const posNorm = (rawP - c.low) / (range + 1e-9);
                            rawWeights.push({ price: snapped, w, bias: posNorm });
                            weightSum += w;
                        }

                        const ticks: FootprintDataTick[] = rawWeights.map(({ price, w, bias }) => {
                            const share = weightSum > 0 ? w / weightSum : 1 / Math.max(1, rawWeights.length);
                            const askFactor = 0.7 + bias * 0.6;
                            const bidFactor = 1.3 - bias * 0.6;
                            return {
                                price,
                                bidVolume: sellVol * share * bidFactor,
                                askVolume: buyVol * share * askFactor,
                            };
                        });

                        const enriched = enrichFootprintCandleClient({
                            time: c.time,
                            open: c.open,
                            high: c.high,
                            low: c.low,
                            close: c.close,
                            isRealCluster: false,
                            tickStep: activeTickStep,
                            ticks,
                        });
                        mergedFootprints.push(enriched);
                    }

                    activeFootprints = mergedFootprints;
                    setFootprintData(mergedFootprints);
                } else {
                    setVpvrData([]);
                    activeFootprints = [];
                    setFootprintData([]);
                }
            } catch (err) {
                console.error('Failed to fetch order flow data:', err);
                if (isMounted) setError('Failed to load order flow data.');
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchOrderFlowData();

        // Real-time incremental updates via shared liveMarketHub (all exchanges, all timeframes)
        let pendingCvdDelta = 0;
        let pendingBuyVol = 0;
        let pendingSellVol = 0;
        let pendingCandleTime: number | null = null;
        let hasPendingFootprint = false;
        let orderFlowThrottleTimer: ReturnType<typeof setTimeout> | null = null;

        const flushOrderFlow = () => {
            if (!isMounted) {
                orderFlowThrottleTimer = null;
                return;
            }
            if (isThermalGuardActive() && typeof document !== 'undefined' && document.hidden) {
                orderFlowThrottleTimer = null;
                return;
            }
            if (pendingCvdDelta !== 0 && pendingCandleTime !== null) {
                const delta = pendingCvdDelta;
                const addBuy = pendingBuyVol;
                const addSell = pendingSellVol;
                const cTime = pendingCandleTime;
                pendingCvdDelta = 0;
                pendingBuyVol = 0;
                pendingSellVol = 0;

                setCvdData((prev) => {
                    if (prev.length === 0) {
                        return [{ time: cTime, value: delta, delta, buyVolume: addBuy, sellVolume: addSell }];
                    }
                    const lastPoint = prev[prev.length - 1];
                    if (cTime < lastPoint.time) return prev;
                    if (lastPoint.time === cTime) {
                        const updated = [...prev];
                        updated[updated.length - 1] = {
                            ...lastPoint,
                            value: lastPoint.value + delta,
                            delta: (lastPoint.delta ?? 0) + delta,
                            buyVolume: (lastPoint.buyVolume ?? 0) + addBuy,
                            sellVolume: (lastPoint.sellVolume ?? 0) + addSell,
                        };
                        return updated;
                    }
                    return [
                        ...prev.slice(-1000),
                        {
                            time: cTime,
                            value: lastPoint.value + delta,
                            delta,
                            buyVolume: addBuy,
                            sellVolume: addSell,
                        },
                    ];
                });
            }
            if (hasPendingFootprint) {
                hasPendingFootprint = false;
                setFootprintData([...activeFootprints.slice(-200)]);
            }
            orderFlowThrottleTimer = null;
        };

        const scheduleOrderFlowFlush = () => {
            if (!orderFlowThrottleTimer) {
                const flushDelayMs = isThermalGuardActive() ? 900 : 220;
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

        let unsubscribeLiveTicks: (() => void) | null = null;
        if (symbol && exchange) {
            const intervalSec = parseOrderflowIntervalSec(interval);
            unsubscribeLiveTicks = subscribeLiveTradeTicks(symbol, exchange, (tick) => {
                try {
                    const price = Number(tick.price);
                    const amount = Number(tick.quantity ?? tick.volume ?? 0);
                    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(amount) || amount <= 0) return;

                    const isBuy = tick.side ? tick.side === 'buy' : !tick.isBuyerMaker;
                    const rawTs = tick.timestamp || Date.now();
                    const tsSec = Math.floor((rawTs < 10000000000 ? rawTs * 1000 : rawTs) / 1000);
                    const currentCandleTime = Math.floor(tsSec / intervalSec) * intervalSec;

                    if (activeFootprints.length > 0 && currentCandleTime < Number(activeFootprints[activeFootprints.length - 1].time)) {
                        return;
                    }

                    if (!activeTickStep || activeTickStep <= 0) {
                        activeTickStep = computeAdaptivePriceStep(price, 0.0004);
                    }

                    const cvdDelta = isBuy ? amount : -amount;

                    // Spawn or update active live footprint candle (with real price-adaptive ticks!)
                    if (
                        activeFootprints.length === 0 ||
                        activeFootprints[activeFootprints.length - 1].time !== currentCandleTime
                    ) {
                        activeFootprints.push({
                            time: currentCandleTime,
                            open: price,
                            close: price,
                            high: price,
                            low: price,
                            pocPrice: price,
                            totalDelta: 0,
                            totalVolume: 0,
                            hasDeltaDivergence: false,
                            isRealCluster: true,
                            tickStep: activeTickStep,
                            ticks: [],
                        });
                    } else if (!activeFootprints[activeFootprints.length - 1].isRealCluster) {
                        // Promote live candle cleanly to a real cluster when real trades arrive
                        const existing = activeFootprints[activeFootprints.length - 1];
                        existing.isRealCluster = true;
                        existing.ticks = [];
                    }

                    const currentCandle = activeFootprints[activeFootprints.length - 1];
                    currentCandle.close = price;
                    if (price > currentCandle.high) currentCandle.high = price;
                    if (price < currentCandle.low) currentCandle.low = price;

                    const bucketPrice = snapPriceToStep(price, activeTickStep, 'floor');
                    let fpTick = currentCandle.ticks.find((t) => t.price === bucketPrice);
                    if (!fpTick) {
                        fpTick = { price: bucketPrice, bidVolume: 0, askVolume: 0 };
                        currentCandle.ticks.push(fpTick);
                    }
                    if (isBuy) fpTick.askVolume += amount;
                    else fpTick.bidVolume += amount;

                    enrichFootprintCandleClient(currentCandle);

                    if (isMounted) {
                        pendingCvdDelta += cvdDelta;
                        if (isBuy) pendingBuyVol += amount;
                        else pendingSellVol += amount;
                        pendingCandleTime = currentCandleTime;
                        hasPendingFootprint = true;
                        scheduleOrderFlowFlush();
                    }
                } catch (e) {
                    console.error('Order flow live tick error', e);
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
            if (unsubscribeLiveTicks) {
                unsubscribeLiveTicks();
                unsubscribeLiveTicks = null;
            }
        };
    }, [symbol, exchange, interval, enabled, includeFootprint]);

    return { vpvrData, cvdData, cvdMeta, footprintData, loading, error };
};
