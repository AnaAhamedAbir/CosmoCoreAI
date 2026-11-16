import { useState, useEffect, useRef } from 'react';
import { isThermalGuardActive, subscribeThermalProfile } from '@/utils/deviceProfile';

export interface GodModeState {
    symbol: string;
    exchange?: string;
    vulnerability: any[];
    arbitrage: any[];
    pain_threshold: { level: number, status: string, value: number };
    smart_money: number;
    dumb_money: number;
    cvd_spoof?: string;
    true_cvd?: number;
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
        estimated_usd?: number;
        side: 'SHORT_LIQ' | 'LONG_LIQ';
        leverage: string;
        source?: string;
    }[];
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
        bubbles?: any[];
        icebergs?: any[];
        spoofs?: any[];
    };
}

export const useGodModeData = (
    symbol: string,
    enabled: boolean = true,
    exchange: string = 'binance'
) => {
    const [godModeData, setGodModeData] = useState<GodModeState | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const thermalGuardRef = useRef<boolean>(isThermalGuardActive());
    const lastEmitAtRef = useRef<number>(0);

    useEffect(() => {
        thermalGuardRef.current = isThermalGuardActive();
        return subscribeThermalProfile((profile) => {
            thermalGuardRef.current = profile.isThermalGuardActive;
        });
    }, []);

    useEffect(() => {
        if (!symbol || !enabled) {
            setGodModeData(null);
            return;
        }

        // Clear previous symbol's stale zones/HUD immediately on symbol or exchange switch
        setGodModeData(null);
        lastEmitAtRef.current = 0;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const baseUrl = `${protocol}//${window.location.host}`;
        const wsUrl = `${baseUrl}/api/v1/advanced_liquidation/ws/god-mode?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange || 'binance')}`;

        let ws: WebSocket | null = null;
        let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
        let isSubscribed = true;
        const expectedSymbol = symbol.toUpperCase();

        const connect = () => {
            if (!isSubscribed) return;
            ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log(`📡 Connected to God Mode Stream: ${symbol} (${exchange})`);
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

                    // Always accept initial history hydration immediately; throttle steady ticks on mobile/tablet
                    const now = Date.now();
                    const minIntervalMs = thermalGuardRef.current ? 1000 : 0;
                    const hasHistory = Boolean(payload.history);
                    if (!hasHistory && minIntervalMs > 0 && now - lastEmitAtRef.current < minIntervalMs) {
                        return;
                    }
                    lastEmitAtRef.current = now;
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
                console.log('God Mode Disconnected. Reconnecting in 3s...');
                reconnectTimeout = setTimeout(connect, 3000);
            };
        };

        connect();

        return () => {
            isSubscribed = false;
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

    return godModeData;
};
