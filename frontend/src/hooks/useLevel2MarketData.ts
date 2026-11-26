import { useState, useEffect } from 'react';
import { getThermalProfile, isThermalGuardActive } from '@/utils/deviceProfile';
import { isFloatingModalDragging, subscribeFloatingModalDragEnd } from '@/hooks/useFloatingModalDrag';

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

export interface BboTickEvent {
    bestBid: number;
    bestAsk: number;
    timestamp: number;
}

export interface MarketDepthData {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
    walls: { price: number; type: 'buy' | 'sell'; size: number }[];
    currentPrice: number;
    bestBid?: number;
    bestAsk?: number;
    tradeEvent: TradeTickEvent | null;
}

interface TickChannelState {
    listeners: Set<(tick: TradeTickEvent) => void>;
    lastEmitAt: number;
    timer: ReturnType<typeof setTimeout> | null;
    pendingTick: TradeTickEvent | null;
}

const liveTickChannels = new Map<string, TickChannelState>();
const liveBboListeners = new Map<string, Set<(bbo: BboTickEvent) => void>>();

function getTickChannelKey(symbol: string, exchange: string): string {
    return `${exchange}:${symbol}`;
}

function emitLiveBboTick(symbol: string, exchange: string, bbo: BboTickEvent) {
    const listeners = liveBboListeners.get(getTickChannelKey(symbol, exchange));
    if (!listeners || listeners.size === 0) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    listeners.forEach((cb) => {
        try {
            cb(bbo);
        } catch (err) {
            console.error('Live BBO subscriber error:', err);
        }
    });
}

export function subscribeLiveBbo(
    symbol: string,
    exchange: string,
    cb: (bbo: BboTickEvent) => void
): () => void {
    if (!symbol || !exchange) return () => {};
    const key = getTickChannelKey(symbol, exchange);
    let set = liveBboListeners.get(key);
    if (!set) {
        set = new Set();
        liveBboListeners.set(key, set);
    }
    set.add(cb);
    return () => {
        const existing = liveBboListeners.get(key);
        if (!existing) return;
        existing.delete(cb);
        if (existing.size === 0) liveBboListeners.delete(key);
    };
}

function buildBinancePublicStreamUrl(symbol: string): string | null {
    const clean = symbol.trim();
    if (!clean.includes('/')) return null;
    const isFutures = clean.includes(':');
    const [pairPart, settleRaw] = clean.split(':');
    const [baseRaw, quoteRaw] = pairPart.split('/');
    if (!baseRaw || !quoteRaw) return null;
    const base = baseRaw.toLowerCase();
    const quote = quoteRaw.toLowerCase();
    const settle = (settleRaw || '').toLowerCase();

    if (isFutures) {
        if (settle && settle === base) {
            const streamSym = `${base}${quote}_perp`;
            return `wss://dstream.binance.com/stream?streams=${streamSym}@aggTrade/${streamSym}@bookTicker`;
        }
        const streamSym = `${base}${quote}`;
        return `wss://fstream.binance.com/stream?streams=${streamSym}@aggTrade/${streamSym}@bookTicker`;
    }
    const streamSym = `${base}${quote}`;
    return `wss://stream.binance.com:9443/stream?streams=${streamSym}@aggTrade/${streamSym}@bookTicker`;
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

    const modalDragging = isFloatingModalDragging();

    if (!isThermalGuardActive() && !modalDragging) {
        dispatchTickToListeners(channel, tick);
        return;
    }

    if (typeof document !== 'undefined' && document.hidden) {
        return;
    }

    const throttleMs = modalDragging ? 250 : getThermalProfile().timings.tradeTickChartMs;
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
    const [data, setData] = useState<MarketDepthData>({ bids: [], asks: [], walls: [], currentPrice: 0, bestBid: 0, bestAsk: 0, tradeEvent: null });

    useEffect(() => {
        if (!symbol) return;
        setData({ bids: [], asks: [], walls: [], currentPrice: 0, bestBid: 0, bestAsk: 0, tradeEvent: null });
        let ws: WebSocket | null = null;
        let directBinanceWs: WebSocket | null = null;
        let directReconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let isSubscribed = true;
        let worker: Worker | null = null;
        let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
        let pendingData: Partial<MarketDepthData> | null = null;
        let throttleTimer: ReturnType<typeof setTimeout> | null = null;
        let lastDirectTradeTs = 0;
        let lastDirectTradeAt = 0;
        let lastDirectBboAt = 0;

        const flushUpdate = () => {
            if (!pendingData || !isSubscribed) {
                throttleTimer = null;
                return;
            }
            if (isFloatingModalDragging()) {
                // Defer React tree re-render while user is dragging a floating modal at 100Hz+
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
            if (!throttleTimer && !isFloatingModalDragging()) {
                const delay = getThermalProfile().timings.l2FlushMs;
                throttleTimer = setTimeout(flushUpdate, delay);
            }
        };

        const unsubscribeDragEnd = subscribeFloatingModalDragEnd(() => {
            if (pendingData && isSubscribed) {
                scheduleFlush();
            }
        });

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
                    const now = Date.now();
                    const directTradeLive = lastDirectTradeAt > 0 && (now - lastDirectTradeAt) < 1500;
                    const directBboLive = lastDirectBboAt > 0 && (now - lastDirectBboAt) < 1500;

                    if (e.data.type === 'DATA_READY') {
                        const incoming = { ...e.data.data };
                        if (directTradeLive && incoming.currentPrice) {
                            delete incoming.currentPrice;
                        }
                        if (!directBboLive && incoming.bids?.length && incoming.asks?.length) {
                            const obBid = Number(incoming.bids[0]?.price || 0);
                            const obAsk = Number(incoming.asks[0]?.price || 0);
                            if (obBid > 0 && obAsk > 0) {
                                incoming.bestBid = obBid;
                                incoming.bestAsk = obAsk;
                                emitLiveBboTick(symbol, exchange, { bestBid: obBid, bestAsk: obAsk, timestamp: now });
                            }
                        }
                        pendingData = {
                            ...(pendingData || {}),
                            ...incoming
                        };
                        scheduleFlush();
                    } else if (e.data.type === 'BBO_READY') {
                        if (directBboLive) return;
                        const bestBid = Number(e.data.data?.bestBid || 0);
                        const bestAsk = Number(e.data.data?.bestAsk || 0);
                        if (bestBid > 0 && bestAsk > 0) {
                            emitLiveBboTick(symbol, exchange, { bestBid, bestAsk, timestamp: Number(e.data.data?.ts || now) });
                            pendingData = {
                                ...(pendingData || {}),
                                bestBid,
                                bestAsk,
                            };
                            scheduleFlush();
                        }
                    } else if (e.data.type === 'TRADE_READY') {
                        const rawTick = e.data.data;
                        const tickTs = Number(rawTick.timestamp || now);
                        if (directTradeLive && tickTs <= lastDirectTradeTs) {
                            return;
                        }
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
                        scheduleFlush();
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

        const connectDirectBinance = () => {
            if (!isSubscribed || exchange.toLowerCase() !== 'binance') return;
            const streamUrl = buildBinancePublicStreamUrl(symbol);
            if (!streamUrl) return;
            try {
                directBinanceWs = new WebSocket(streamUrl);
                directBinanceWs.onmessage = (ev) => {
                    if (!isSubscribed) return;
                    try {
                        const msg = JSON.parse(ev.data);
                        const d = msg?.data || msg;
                        if (!d) return;

                        if (d.e === 'aggTrade' || d.e === 'trade') {
                            const price = Number(d.p || 0);
                            const qty = Number(d.q || 0);
                            if (price > 0) {
                                const ts = Number(d.T || d.E || Date.now());
                                const isBuyerMaker = Boolean(d.m);
                                lastDirectTradeTs = ts;
                                lastDirectTradeAt = Date.now();
                                const tick: TradeTickEvent = {
                                    price,
                                    volume: qty,
                                    quantity: qty,
                                    timestamp: ts,
                                    side: isBuyerMaker ? 'sell' : 'buy',
                                    isBuyerMaker,
                                };
                                emitLiveTradeTick(symbol, exchange, tick);
                                pendingData = {
                                    ...(pendingData || {}),
                                    currentPrice: price,
                                    tradeEvent: tick,
                                };
                                scheduleFlush();
                            }
                        } else if (d.b !== undefined && d.a !== undefined) {
                            const bestBid = Number(d.b || 0);
                            const bestAsk = Number(d.a || 0);
                            if (bestBid > 0 && bestAsk > 0) {
                                const ts = Number(d.T || d.E || Date.now());
                                lastDirectBboAt = Date.now();
                                emitLiveBboTick(symbol, exchange, { bestBid, bestAsk, timestamp: ts });
                                pendingData = {
                                    ...(pendingData || {}),
                                    bestBid,
                                    bestAsk,
                                };
                                scheduleFlush();
                            }
                        }
                    } catch {
                        // ignore malformed frame
                    }
                };
                directBinanceWs.onerror = () => {
                    try {
                        directBinanceWs?.close();
                    } catch {}
                };
                directBinanceWs.onclose = () => {
                    if (isSubscribed) {
                        directReconnectTimer = setTimeout(connectDirectBinance, 4000);
                    }
                };
            } catch {
                // Backend stream serves as automatic seamless fallback
            }
        };

        if (symbol && exchange) {
            connectToBackend();
            connectDirectBinance();
        }

        return () => {
            isSubscribed = false;
            unsubscribeDragEnd();
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityChange);
            }
            if (throttleTimer) {
                clearTimeout(throttleTimer);
            }
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
            }
            if (directReconnectTimer) {
                clearTimeout(directReconnectTimer);
            }
            if (directBinanceWs) {
                if (directBinanceWs.readyState === WebSocket.CONNECTING) {
                    directBinanceWs.onopen = () => directBinanceWs?.close();
                } else if (directBinanceWs.readyState === WebSocket.OPEN) {
                    directBinanceWs.close();
                }
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
