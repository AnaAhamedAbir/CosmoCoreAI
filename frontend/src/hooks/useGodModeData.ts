import { useState, useEffect, useRef } from 'react';
import { isThermalGuardActive, subscribeThermalProfile } from '@/utils/deviceProfile';

export type LiquidationPoolHorizon = '24h' | '3d' | '7d';

export interface LiquidationPoolSummary {
    horizon: LiquidationPoolHorizon;
    total_short_liq_usd: number;
    total_long_liq_usd: number;
    imbalance_ratio: number;
    dominant_side: 'ABOVE' | 'BELOW' | 'BALANCED';
    nearest_short_pool?: {
        price: number;
        estimated_usd: number;
        leverage: string;
        dist_pct: number;
    } | null;
    nearest_long_pool?: {
        price: number;
        estimated_usd: number;
        leverage: string;
        dist_pct: number;
    } | null;
    oi_weighted: boolean;
    swept_count_filtered: number;
}

export interface DeepL2Wall {
    price: number;
    side: 'bid' | 'ask';
    total_usd: number;
    intensity: number;
    dist_pct: number;
    exchanges: string[];
    exchange_count: number;
    is_confluence: boolean;
    exchange_breakdown?: Record<string, number>;
}

export interface DeepL2Summary {
    range_pct: number;
    exchanges_active: string[];
    exchange_count: number;
    total_bids_10pct_usd: number;
    total_asks_10pct_usd: number;
    total_bids_5pct_usd: number;
    total_asks_5pct_usd: number;
    global_bid_ratio: number;
    book_bias: 'BID_HEAVY' | 'ASK_HEAVY' | 'BALANCED';
    strongest_bid_wall?: {
        price: number;
        total_usd: number;
        dist_pct: number;
        exchange_count: number;
        exchanges: string[];
    } | null;
    strongest_ask_wall?: {
        price: number;
        total_usd: number;
        dist_pct: number;
        exchange_count: number;
        exchanges: string[];
    } | null;
}

export interface CandleOrderflowState {
    bar_time: number;
    seconds_left: number;
    phase: 'EARLY' | 'MID' | 'CLOSING_PUSH';
    bar_open: number;
    bar_close: number;
    bar_buy_usd: number;
    bar_sell_usd: number;
    bar_delta_usd: number;
    max_delta_usd: number;
    min_delta_usd: number;
    buy_pct: number;
    whale_delta_usd: number;
    retail_delta_usd: number;
    velocity_10s_usd: number;
    bull_prob: number;
    close_bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    confidence: number;
    reason: string;
    divergence?: 'BULL_DIV' | 'BEAR_DIV' | null;
    active_absorption?: 'BULLISH_ABSORPTION' | 'BEARISH_ABSORPTION' | null;
}

export interface BarDeltaPoint {
    time: number; // unix seconds (1m bar start)
    open: number;
    close: number;
    buy_usd: number;
    sell_usd: number;
    delta_usd: number;
    max_delta_usd: number;
    min_delta_usd: number;
    whale_delta_usd: number;
    retail_delta_usd: number;
    divergence?: 'BULL_DIV' | 'BEAR_DIV' | null;
    absorption?: 'BULLISH_ABSORPTION' | 'BEARISH_ABSORPTION' | null;
}

export interface GodModeState {
    symbol: string;
    exchange?: string;
    pool_horizon?: LiquidationPoolHorizon;
    vulnerability: any[];
    arbitrage: any[];
    pain_threshold: { level: number, status: string, value: number };
    smart_money: number;
    dumb_money: number;
    cvd_spoof?: string;
    true_cvd?: number;
    candle_orderflow?: CandleOrderflowState | null;
    bar_deltas?: BarDeltaPoint[];
    funding_rate?: number;
    open_interest_usd?: number;
    quote_volume_24h?: number;
    adaptive_thresholds?: {
        scale: number;
        whale_usd: number;
        smart_usd: number;
        absorption_usd: number;
        spoof_usd: number;
        pain_max_usd: number;
        twls_prune_usd: number;
    };
    gex_data?: {
        call_wall: number;
        call_oi: number;
        put_wall: number;
        put_oi: number;
    } | null;
    whale_feed: any[];
    magnet_zones: { price: number, intensity: number, volume?: number }[];
    smoothed_zones?: { price: number, intensity: number, volume?: number }[];
    liquidation_pools?: {
        price: number;
        intensity: number;
        base_intensity?: number;
        estimated_usd?: number;
        depleted_usd?: number;
        is_sweeping?: boolean;
        side: 'SHORT_LIQ' | 'LONG_LIQ';
        leverage: string;
        tier_breakdown?: string;
        dist_pct?: number;
        horizon?: LiquidationPoolHorizon;
        oi_weighted?: boolean;
        source?: string;
    }[];
    liquidation_pool_summary?: LiquidationPoolSummary;
    deep_l2_walls?: DeepL2Wall[];
    deep_l2_summary?: DeepL2Summary;
    orderbook_depth?: { price: number, volume: number, type: 'bid' | 'ask' }[];
    spoofed_zones?: { price: number, volume: number, timestamp: number, type: string }[];
    cascade_probs: { price: number, prob: number, volume?: number }[];
    trailing_liquidity?: {
        long_level: number;
        short_level: number;
        long_intensity: number;
        short_intensity: number;
    };
    ai_trajectory?: { target_price: number, strength: number, direction: 'UP' | 'DOWN' | 'NEUTRAL' };
    smart_trajectory?: {
        target_price: number, strength: number, direction: 'UP' | 'DOWN' | 'NEUTRAL',
        raw_bid_force?: number, raw_ask_force?: number,
        smoothed_bid_force?: number, smoothed_ask_force?: number,
        bid_dominance?: number, ask_dominance?: number,
        funding_rate?: number,
        total_bids_liquidity?: number, total_asks_liquidity?: number
    };
    current_price: number;
    iceberg_events?: any[];
    history?: {
        bookmap?: { time: number; depth: { price: number; volume: number }[] }[];
        bookmap_coverage_min?: number;
        bubbles?: any[];
        icebergs?: any[];
        spoofs?: any[];
    };
}

export const useGodModeStream = (
    symbol: string,
    enabled: boolean = true,
    exchange: string = 'binance',
    poolHorizon: LiquidationPoolHorizon = '24h'
): { state: GodModeState | null; isConnected: boolean } => {
    const [godModeData, setGodModeData] = useState<GodModeState | null>(null);
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const wsRef = useRef<WebSocket | null>(null);
    const thermalGuardRef = useRef<boolean>(isThermalGuardActive());
    const lastEmitAtRef = useRef<number>(0);
    const poolHorizonRef = useRef<LiquidationPoolHorizon>(poolHorizon || '24h');
    const lastPayloadHorizonRef = useRef<string>('');
    poolHorizonRef.current = poolHorizon || '24h';

    useEffect(() => {
        thermalGuardRef.current = isThermalGuardActive();
        return subscribeThermalProfile((profile) => {
            thermalGuardRef.current = profile.isThermalGuardActive;
        });
    }, []);

    // Dynamically switch liquidation pool horizon over the existing open WebSocket (zero reconnect lag)
    useEffect(() => {
        const ws = wsRef.current;
        if (!enabled || !ws || ws.readyState !== WebSocket.OPEN) return;
        try {
            ws.send(JSON.stringify({ type: 'set_horizon', horizon: poolHorizon || '24h' }));
        } catch {
            // Ignore transient send errors while reconnecting
        }
    }, [poolHorizon, enabled]);

    useEffect(() => {
        if (!symbol || !enabled) {
            setGodModeData(null);
            setIsConnected(false);
            return;
        }

        // Clear previous symbol's stale zones/HUD immediately on symbol or exchange switch
        setGodModeData(null);
        setIsConnected(false);
        lastEmitAtRef.current = 0;
        lastPayloadHorizonRef.current = '';

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const baseUrl = `${protocol}//${window.location.host}`;

        let ws: WebSocket | null = null;
        let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
        let isSubscribed = true;
        const expectedSymbol = symbol.toUpperCase();

        const connect = () => {
            if (!isSubscribed) return;
            const connectHorizon = poolHorizonRef.current;
            const wsUrl = `${baseUrl}/api/v1/advanced_liquidation/ws/god-mode?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange || 'binance')}&horizon=${encodeURIComponent(connectHorizon)}`;
            ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                if (!isSubscribed) return;
                setIsConnected(true);
                console.log(`📡 Connected to God Mode Stream: ${symbol} (${exchange}, ${connectHorizon})`);
                // If user changed horizon while WebSocket was still CONNECTING, sync immediately
                if (poolHorizonRef.current !== connectHorizon && ws && ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(JSON.stringify({ type: 'set_horizon', horizon: poolHorizonRef.current }));
                    } catch {
                        // Ignore transient send error
                    }
                }
            };

            ws.onmessage = (event) => {
                if (!isSubscribed) return;
                if (typeof document !== 'undefined' && document.hidden) return;
                try {
                    const data = JSON.parse(event.data);
                    const payload = data.data || data;
                    if (
                        !payload ||
                        payload.magnet_zones === undefined ||
                        (payload.symbol && String(payload.symbol).toUpperCase() !== expectedSymbol)
                    ) {
                        return;
                    }

                    // Always accept initial history hydration or horizon switches immediately; throttle steady ticks on mobile/tablet
                    const now = Date.now();
                    const minIntervalMs = thermalGuardRef.current ? 1000 : 0;
                    const hasHistory = Boolean(payload.history);
                    const incomingHorizon = String(payload.pool_horizon || '');
                    const horizonChanged = Boolean(incomingHorizon && incomingHorizon !== lastPayloadHorizonRef.current);
                    if (!hasHistory && !horizonChanged && minIntervalMs > 0 && now - lastEmitAtRef.current < minIntervalMs) {
                        return;
                    }
                    lastEmitAtRef.current = now;
                    if (incomingHorizon) {
                        lastPayloadHorizonRef.current = incomingHorizon;
                    }
                    setGodModeData(payload);
                } catch {
                    // silently fail on parse error to avoid spam
                }
            };

            ws.onerror = (error) => {
                console.error('God Mode WebSocket error:', error);
            };

            ws.onclose = () => {
                if (!isSubscribed) return;
                setIsConnected(false);
                console.log('God Mode Disconnected. Reconnecting in 3s...');
                reconnectTimeout = setTimeout(connect, 3000);
            };
        };

        connect();

        return () => {
            isSubscribed = false;
            setIsConnected(false);
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            if (ws) {
                ws.onclose = null;
                if (ws.readyState === WebSocket.CONNECTING) {
                    const closingWs = ws;
                    closingWs.onopen = () => closingWs.close();
                } else if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
            }
            wsRef.current = null;
        };
    }, [symbol, enabled, exchange]);

    return { state: godModeData, isConnected };
};

export const useGodModeData = (
    symbol: string,
    enabled: boolean = true,
    exchange: string = 'binance',
    poolHorizon: LiquidationPoolHorizon = '24h'
) => {
    const { state } = useGodModeStream(symbol, enabled, exchange, poolHorizon);
    return state;
};
