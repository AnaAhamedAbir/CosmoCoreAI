import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { marketDepthService } from '@/services/marketDepthService';
import { subscribeMarketDepthEvents } from '@/hooks/useMarketDepthEvents';
import type { IndicatorSettings } from '@/components/features/market/IndicatorSelector';

export type AbsorptionZoneStatus = 'ABSORBING' | 'REVERSAL_CONFIRMED' | 'EXHAUSTING' | 'BREAKDOWN';

export interface LiquidityAbsorptionZone {
    id: string;
    source: 'live' | 'historical';
    side: 'bullish' | 'bearish';
    status: AbsorptionZoneStatus;
    price: number;
    zone_top: number;
    zone_bottom: number;
    start_time: number;
    end_time: number | null;
    last_updated: number;
    absorbed_usd: number;
    visible_wall_usd: number;
    peak_wall_usd: number;
    reload_count: number;
    is_iceberg: boolean;
    sweep_detected: boolean;
    swept_level: number | null;
    liquidity_swap: boolean;
    delta_before: number;
    delta_after: number;
    reversal_score: number;
    breakdown_risk: number;
}

export interface LiquiditySweepAbsorptionResult {
    zones: LiquidityAbsorptionZone[];
    liveZones: LiquidityAbsorptionZone[];
    historicalZones: LiquidityAbsorptionZone[];
    loading: boolean;
}

export const useLiquiditySweepAbsorption = (
    symbol: string,
    exchange: string,
    interval: string,
    settings: IndicatorSettings,
    enabled: boolean,
    currentPrice: number = 0
): LiquiditySweepAbsorptionResult => {
    const [historicalZones, setHistoricalZones] = useState<LiquidityAbsorptionZone[]>([]);
    const [liveZones, setLiveZones] = useState<LiquidityAbsorptionZone[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const alertedKeysRef = useRef<Set<string>>(new Set());

    const lookback = settings.lsaSweepLookback ?? 20;
    const minAbsorbedUsd = settings.lsaMinAbsorbedUsd ?? 50000;
    const windowSec = settings.lsaAbsorptionWindowSec ?? 20;
    const includeHistorical = settings.lsaShowHistoricalZones !== false;
    const enableAlerts = Boolean(settings.lsaEnableAlerts);

    useEffect(() => {
        alertedKeysRef.current.clear();
    }, [symbol, exchange]);

    useEffect(() => {
        if (!enabled || !symbol || !exchange) {
            setHistoricalZones([]);
            setLiveZones([]);
            return;
        }

        let isMounted = true;

        const fetchSnapshot = async () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            setLoading(true);
            try {
                const res = await marketDepthService.getLiquiditySweepAbsorption({
                    symbol: symbol.toUpperCase(),
                    exchange,
                    interval,
                    limit: 350,
                    lookback,
                    min_absorbed_usd: minAbsorbedUsd,
                    window_sec: windowSec,
                    include_historical: includeHistorical,
                });
                if (!isMounted) return;
                setHistoricalZones(Array.isArray(res?.historical_zones) ? res.historical_zones : []);
                setLiveZones(Array.isArray(res?.live_zones) ? res.live_zones : []);
            } catch (err) {
                console.warn('[LiquiditySweepAbsorption] Snapshot fetch error:', err);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchSnapshot();
        const refreshId = setInterval(fetchSnapshot, 20000);

        return () => {
            isMounted = false;
            clearInterval(refreshId);
        };
    }, [enabled, symbol, exchange, interval, lookback, minAbsorbedUsd, windowSec, includeHistorical]);

    // Real-time WebSocket stream for live L2 Iceberg, Sweep & Liquidity Swap updates
    useEffect(() => {
        if (!enabled || !symbol) return;

        const normExchange = exchange.toLowerCase();

        return subscribeMarketDepthEvents(symbol, (event: any) => {
            if (!event) return;

            if (event.type === 'LIQUIDITY_ABSORPTION_UPDATE' && event.zone) {
                if (event.exchange) {
                    const evEx = String(event.exchange).toLowerCase();
                    if (!evEx.startsWith(normExchange) && !normExchange.startsWith(evEx)) {
                        return;
                    }
                }
                const incoming: LiquidityAbsorptionZone = event.zone;
                setLiveZones((prev) => {
                    const idx = prev.findIndex((z) => z.id === incoming.id);
                    if (idx >= 0) {
                        const next = [...prev];
                        next[idx] = incoming;
                        return next;
                    }
                    return [...prev.slice(-29), incoming];
                });

                if (
                    enableAlerts &&
                    incoming.absorbed_usd >= minAbsorbedUsd &&
                    (incoming.status === 'REVERSAL_CONFIRMED' || incoming.status === 'BREAKDOWN')
                ) {
                    const alertKey = `${incoming.id}:${incoming.status}`;
                    if (!alertedKeysRef.current.has(alertKey)) {
                        alertedKeysRef.current.add(alertKey);
                        const usdK = `$${Math.round(incoming.absorbed_usd / 1000)}K`;
                        if (incoming.status === 'REVERSAL_CONFIRMED') {
                            toast.success(
                                `${symbol}: ${incoming.side === 'bullish' ? 'Bullish' : 'Bearish'} Sweep+Swap Reversal @ ${incoming.price} (${usdK})`,
                                { duration: 5000 }
                            );
                        } else {
                            toast.error(
                                `${symbol}: Wall Breakdown @ ${incoming.price} (${usdK} exhausted)`,
                                { duration: 5000 }
                            );
                        }
                    }
                }
            } else if (event.type === 'ICEBERG_DETECTED' && typeof event.price === 'number') {
                const nowSec = Math.floor(Date.now() / 1000);
                const side = event.side === 'buy' ? 'bullish' : 'bearish';
                const price = Number(event.price);
                const band = Math.max(price * 0.0005, 1e-8);
                const synthetic: LiquidityAbsorptionZone = {
                    id: `bot_iceberg:${side}:${price.toFixed(6)}`,
                    source: 'live',
                    side,
                    status: 'ABSORBING',
                    price,
                    zone_top: price + band,
                    zone_bottom: price - band,
                    start_time: nowSec,
                    end_time: null,
                    last_updated: nowSec,
                    absorbed_usd: Number(event.absorbed_vol || 0),
                    visible_wall_usd: Number(event.limit_vol_remaining || 0),
                    peak_wall_usd: Number(event.limit_vol_remaining || 0),
                    reload_count: 1,
                    is_iceberg: true,
                    sweep_detected: false,
                    swept_level: null,
                    liquidity_swap: false,
                    delta_before: 0,
                    delta_after: 0,
                    reversal_score: 70,
                    breakdown_risk: 20,
                };
                setLiveZones((prev) => {
                    const idx = prev.findIndex((z) => z.id === synthetic.id);
                    if (idx >= 0) {
                        const existing = prev[idx];
                        const next = [...prev];
                        next[idx] = {
                            ...synthetic,
                            start_time: existing.start_time,
                            reload_count: existing.reload_count + 1,
                            absorbed_usd: Math.max(existing.absorbed_usd, synthetic.absorbed_usd),
                        };
                        return next;
                    }
                    return [...prev.slice(-29), synthetic];
                });
            }
        });
    }, [enabled, symbol, exchange, enableAlerts, minAbsorbedUsd]);

    const zones = useMemo(() => {
        if (!enabled) return [];
        const showHistorical = settings.lsaShowHistoricalZones !== false;
        const showBreakdown = settings.lsaShowBreakdownZones !== false;
        const minReloads = settings.lsaMinReloads ?? 1;
        const maxZones = settings.lsaMaxZones ?? 20;
        const signalFilter = settings.lsaSignalFilter || 'All';

        // Reconcile active zones against instantaneous live price so breakdowns appear without delay
        const evaluateStatus = (z: LiquidityAbsorptionZone): LiquidityAbsorptionZone => {
            if (z.status === 'BREAKDOWN' || currentPrice <= 0) return z;
            const margin = Math.max((z.zone_top - z.zone_bottom) * 0.45, z.price * 0.0012);
            const brokenLive =
                (z.side === 'bullish' && currentPrice < z.zone_bottom - margin) ||
                (z.side === 'bearish' && currentPrice > z.zone_top + margin);
            if (brokenLive && z.source === 'historical') {
                return {
                    ...z,
                    status: 'BREAKDOWN',
                    end_time: Math.floor(Date.now() / 1000),
                    breakdown_risk: 88,
                    reversal_score: 25,
                };
            }
            return z;
        };

        const matchesFilter = (z: LiquidityAbsorptionZone): boolean => {
            if (!showBreakdown && z.status === 'BREAKDOWN') return false;
            if (signalFilter === 'Reversal') {
                return z.status === 'REVERSAL_CONFIRMED' || z.status === 'ABSORBING';
            }
            if (signalFilter === 'Breakdown') {
                return z.status === 'BREAKDOWN' || z.status === 'EXHAUSTING';
            }
            if (signalFilter === 'Iceberg') {
                return z.is_iceberg;
            }
            return true;
        };

        const filteredHist = showHistorical
            ? historicalZones
                  .map(evaluateStatus)
                  .filter((z) => z.absorbed_usd >= minAbsorbedUsd * 0.35 && matchesFilter(z))
            : [];

        const filteredLive = liveZones
            .map(evaluateStatus)
            .filter((z) => {
                if (z.absorbed_usd < minAbsorbedUsd) return false;
                if (minReloads > 0 && z.is_iceberg && z.reload_count < minReloads && !z.liquidity_swap) {
                    return false;
                }
                return matchesFilter(z);
            });

        const merged = [...filteredHist, ...filteredLive].sort((a, b) => a.start_time - b.start_time);
        return merged.slice(-maxZones);
    }, [
        enabled,
        historicalZones,
        liveZones,
        currentPrice,
        minAbsorbedUsd,
        settings.lsaShowHistoricalZones,
        settings.lsaShowBreakdownZones,
        settings.lsaMinReloads,
        settings.lsaMaxZones,
        settings.lsaSignalFilter,
    ]);

    return {
        zones,
        liveZones,
        historicalZones,
        loading,
    };
};
