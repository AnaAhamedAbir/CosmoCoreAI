import { useState, useEffect } from 'react';
import { getThermalProfile, isThermalGuardActive } from '@/utils/deviceProfile';

export interface OrderBookLevel {
    price: number;
    size: number;
    total: number;
}

export interface TradeTickEvent {
    price: number;
    high?: number;
    low?: number;
    volume: number;
    timestamp: number;
    side?: 'buy' | 'sell' | null;
    quantity?: number;
    isBuyerMaker?: boolean;
}

export interface MarketDepthData {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
    walls: { price: number; type: 'buy' | 'sell'; size: number }[];
    currentPrice: number;
    tradeEvent: TradeTickEvent | null;
}

interface TickChannelState {
    listeners: Set<(tick: TradeTickEvent) => void>;
    lastEmitAt: number;
    timer: ReturnType<typeof setTimeout> | null;
    pendingTick: TradeTickEvent | null;
}

const liveTickChannels = new Map<string, TickChannelState>();

function getTickChannelKey(symbol: string, exchange: string): string {
    return `${exchange}:${symbol}`;
}

function dispatchTickToListeners(channel: TickChannelState, tick: TradeTickEvent) {
    channel.listeners.forEach((cb) => {
        try {
            cb(tick);
        } catch (err) {
            console.error('Live trade tick subscriber error:', err);
        }
    });
}

function emitLiveTradeTick(symbol: string, exchange: string, tick: TradeTickEvent) {
    const key = getTickChannelKey(symbol, exchange);
    const channel = liveTickChannels.get(key);
    if (!channel || channel.listeners.size === 0) return;

    if (!isThermalGuardActive()) {
        dispatchTickToListeners(channel, tick);
        return;
    }

    if (typeof document !== 'undefined' && document.hidden) {
        return;
    }

    const throttleMs = getThermalProfile().timings.tradeTickChartMs;
    if (throttleMs <= 0) {
        dispatchTickToListeners(channel, tick);
        return;
    }

    const now = Date.now();
    const elapsed = now - channel.lastEmitAt;

    if (elapsed >= throttleMs && !channel.timer) {
        channel.lastEmitAt = now;
        channel.pendingTick = null;
        dispatchTickToListeners(channel, tick);
        return;
    }

    const prev = channel.pendingTick;
    channel.pendingTick = prev
        ? {
              ...tick,
              high: Math.max(prev.high ?? prev.price, tick.high ?? tick.price, tick.price),
              low: Math.min(prev.low ?? prev.price, tick.low ?? tick.price, tick.price),
              volume: (prev.volume || 0) + (tick.volume || 0),
              quantity: (prev.quantity ?? prev.volume ?? 0) + (tick.quantity ?? tick.volume ?? 0),
          }
        : tick;

    if (!channel.timer) {
        const delay = Math.max(0, throttleMs - elapsed);
        channel.timer = setTimeout(() => {
            channel.timer = null;
            const pending = channel.pendingTick;
            channel.pendingTick = null;
            if (!pending || channel.listeners.size === 0) return;
            if (typeof document !== 'undefined' && document.hidden) return;
            channel.lastEmitAt = Date.now();
            dispatchTickToListeners(channel, pending);
        }, delay);
    }
}

export function subscribeLiveTradeTicks(
    symbol: string,
    exchange: string,
    cb: (tick: TradeTickEvent) => void
): () => void {
    if (!symbol || !exchange) return () => {};
    const key = getTickChannelKey(symbol, exchange);
    let channel = liveTickChannels.get(key);
    if (!channel) {
        channel = {
            listeners: new Set(),
            lastEmitAt: 0,
            timer: null,
            pendingTick: null,
        };
        liveTickChannels.set(key, channel);
    }
    channel.listeners.add(cb);

    return () => {
        const existing = liveTickChannels.get(key);
        if (!existing) return;
        existing.listeners.delete(cb);
        if (existing.listeners.size === 0) {
            if (existing.timer) {
                clearTimeout(existing.timer);
                existing.timer = null;
            }
            existing.pendingTick = null;
            liveTickChannels.delete(key);
        }
    };
}

export const useLevel2MarketData = (symbol: string, exchange: string = 'binance') => {
    const [data, setData] = useState<MarketDepthData>({ bids: [], asks: [], walls: [], currentPrice: 0, tradeEvent: null });

    useEffect(() => {
        if (!symbol) return;
        let ws: WebSocket | null = null;
        let isSubscribed = true;
        let worker: Worker | null = null;
        let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
        let pendingData: Partial<MarketDepthData> | null = null;
        let throttleTimer: ReturnType<typeof setTimeout> | null = null;

        const flushUpdate = () => {
            if (!pendingData || !isSubscribed) {
                throttleTimer = null;
                return;
            }
            if (isThermalGuardActive() && typeof document !== 'undefined' && document.hidden) {
                // Keep pendingData intact and flush when tab becomes visible again
                throttleTimer = null;
                return;
            }
            const nextData = pendingData;
            pendingData = null;
            throttleTimer = null;
            setData(prev => ({
                ...prev,
                ...nextData,
                tradeEvent: nextData.tradeEvent !== undefined ? nextData.tradeEvent : prev.tradeEvent
            }));
        };

        const scheduleFlush = () => {
            if (!throttleTimer) {
                const delay = getThermalProfile().timings.l2FlushMs;
                throttleTimer = setTimeout(flushUpdate, delay);
            }
        };

        const handleVisibilityChange = () => {
            if (typeof document !== 'undefined' && !document.hidden && pendingData && isSubscribed) {
                flushUpdate();
            }
        };

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibilityChange);
        }

        const connectToBackend = () => {
            if (!isSubscribed) return;
            // Use relative URL or env var for production, fallback to localhost for dev
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const baseUrl = `${protocol}//${window.location.host}`;

            // Pass the exchange and the exact symbol (e.g. BTC/USDT) since backend uses {symbol:path}
            const backendWsUrl = `${baseUrl}/api/v1/market-depth/ws/${exchange}/${symbol}`;

            try {
                // Initialize Web Worker
                if (!worker) {
                    worker = new Worker(new URL('../workers/marketDataWorker.ts', import.meta.url), { type: 'module' });
                }

                worker.onmessage = (e) => {
                    if (!isSubscribed) return;
                    if (e.data.type === 'DATA_READY') {
                        pendingData = {
                            ...(pendingData || {}),
                            ...e.data.data
                        };
                        scheduleFlush();
                    } else if (e.data.type === 'TRADE_READY') {
                        const rawTick = e.data.data;
                        const tick: TradeTickEvent = {
                            ...rawTick,
                            quantity: rawTick.quantity ?? rawTick.volume ?? 0,
                            isBuyerMaker: rawTick.isBuyerMaker ?? (rawTick.side === 'sell'),
                        };
                        emitLiveTradeTick(symbol, exchange, tick);

                        pendingData = {
                            ...(pendingData || {}),
                            currentPrice: tick.price,
                            tradeEvent: tick
                        };
                        if (isThermalGuardActive()) {
                            scheduleFlush();
                        } else {
                            // Light-speed instant flush for trades on desktop
                            if (throttleTimer) {
                                clearTimeout(throttleTimer);
                                throttleTimer = null;
                            }
                            flushUpdate();
                        }
                    }
                };

                worker.onerror = (err) => {
                    console.error("Worker encountered an error:", err);
                };

                ws = new WebSocket(backendWsUrl);

                ws.onopen = () => {
                    console.log(`Connected to Level 2 Market Data Stream for ${symbol} on ${exchange}`);
                };

                ws.onmessage = (event) => {
                    if (!isSubscribed || !worker) return;
                    // Offload processing to worker
                    worker.postMessage({ type: 'PROCESS_MESSAGE', payload: event.data });
                };

                ws.onerror = (err) => {
                    console.error("WebSocket error on market depth stream:", err);
                };

                ws.onclose = () => {
                    console.log(`Disconnected from market depth stream. Reconnecting in 5s...`);
                    if (isSubscribed) {
                        reconnectTimeout = setTimeout(connectToBackend, 5000);
                    }
                };
            } catch (error) {
                console.error("Error creating WebSocket or Worker:", error);
                if (isSubscribed) {
                    reconnectTimeout = setTimeout(connectToBackend, 5000);
                }
            }
        };

        if (symbol && exchange) {
            connectToBackend();
        }

        return () => {
            isSubscribed = false;
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityChange);
            }
            if (throttleTimer) {
                clearTimeout(throttleTimer);
            }
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
            }
            if (ws) {
                if (ws.readyState === WebSocket.CONNECTING) {
                    ws.onopen = () => ws?.close();
                } else if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
            }
            if (worker) {
                worker.terminate();
                worker = null;
            }
        };
    }, [symbol, exchange]);

    return data;
};
