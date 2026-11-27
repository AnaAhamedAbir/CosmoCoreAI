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

interface LiveMarketChannelState {
    tickListeners: Set<(tick: TradeTickEvent) => void>;
    bboListeners: Set<(bbo: BboTickEvent) => void>;
    lastEmitAt: number;
    timer: ReturnType<typeof setTimeout> | null;
    rafId: number | null;
    pendingTick: TradeTickEvent | null;
    pendingBbo: BboTickEvent | null;
    latestTick: TradeTickEvent | null;
    latestBbo: BboTickEvent | null;
    lastTickTs: number;
    lastTickWallAt: number;
    lastBboTs: number;
    lastBboWallAt: number;
    lastEmittedBid: number;
    lastEmittedAsk: number;
}

const EMPTY_MARKET_DEPTH_DATA: MarketDepthData = {
    bids: [],
    asks: [],
    walls: [],
    currentPrice: 0,
    bestBid: 0,
    bestAsk: 0,
    tradeEvent: null,
};

const liveMarketChannels = new Map<string, LiveMarketChannelState>();

function getTickChannelKey(symbol: string, exchange: string): string {
    return `${exchange}:${symbol}`;
}

function getOrCreateChannel(symbol: string, exchange: string): LiveMarketChannelState {
    const key = getTickChannelKey(symbol, exchange);
    let channel = liveMarketChannels.get(key);
    if (!channel) {
        channel = {
            tickListeners: new Set(),
            bboListeners: new Set(),
            lastEmitAt: 0,
            timer: null,
            rafId: null,
            pendingTick: null,
            pendingBbo: null,
            latestTick: null,
            latestBbo: null,
            lastTickTs: 0,
            lastTickWallAt: 0,
            lastBboTs: 0,
            lastBboWallAt: 0,
            lastEmittedBid: 0,
            lastEmittedAsk: 0,
        };
        liveMarketChannels.set(key, channel);
    }
    return channel;
}

function cancelChannelSchedulers(channel: LiveMarketChannelState) {
    if (channel.timer) {
        clearTimeout(channel.timer);
        channel.timer = null;
    }
    if (channel.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(channel.rafId);
        channel.rafId = null;
    }
}

function cleanupChannelIfUnused(key: string) {
    const existing = liveMarketChannels.get(key);
    if (!existing) return;
    if (existing.tickListeners.size === 0 && existing.bboListeners.size === 0) {
        cancelChannelSchedulers(existing);
        existing.pendingTick = null;
        existing.pendingBbo = null;
        liveMarketChannels.delete(key);
    }
}

function normalizeTsMs(rawTs?: number): number {
    if (!rawTs || !Number.isFinite(rawTs) || rawTs <= 0) return Date.now();
    return rawTs < 10000000000 ? rawTs * 1000 : rawTs;
}

function dispatchChannelFrame(channel: LiveMarketChannelState, tick: TradeTickEvent | null, bbo: BboTickEvent | null) {
    // Dispatch both trade tick and BBO in the exact same synchronous frame so
    // last-trade line and bid/ask lines never drift or move in opposite directions.
    if (tick && channel.tickListeners.size > 0) {
        channel.tickListeners.forEach((cb) => {
            try {
                cb(tick);
            } catch (err) {
                console.error('Live trade tick subscriber error:', err);
            }
        });
    }
    if (bbo && channel.bboListeners.size > 0) {
        channel.lastEmittedBid = bbo.bestBid;
        channel.lastEmittedAsk = bbo.bestAsk;
        channel.bboListeners.forEach((cb) => {
            try {
                cb(bbo);
            } catch (err) {
                console.error('Live BBO subscriber error:', err);
            }
        });
    }
}

function flushPendingChannel(channel: LiveMarketChannelState) {
    const tick = channel.pendingTick;
    const bbo = channel.pendingBbo;
    channel.pendingTick = null;
    channel.pendingBbo = null;
    if ((!tick && !bbo) || (channel.tickListeners.size === 0 && channel.bboListeners.size === 0)) {
        return;
    }
    if (typeof document !== 'undefined' && document.hidden) {
        channel.pendingTick = tick;
        channel.pendingBbo = bbo;
        return;
    }
    channel.lastEmitAt = Date.now();
    dispatchChannelFrame(channel, tick, bbo);
}

function scheduleRafFlush(channel: LiveMarketChannelState) {
    if (channel.rafId !== null) return;
    if (typeof requestAnimationFrame !== 'undefined') {
        channel.rafId = requestAnimationFrame(() => {
            channel.rafId = null;
            flushPendingChannel(channel);
        });
    } else {
        flushPendingChannel(channel);
    }
}

function scheduleOrDispatchChannel(channel: LiveMarketChannelState) {
    if (channel.tickListeners.size === 0 && channel.bboListeners.size === 0) {
        channel.pendingTick = null;
        channel.pendingBbo = null;
        return;
    }

    if (typeof document !== 'undefined' && document.hidden) {
        return;
    }

    const modalDragging = isFloatingModalDragging();
    const throttleMs = modalDragging
        ? 250
        : isThermalGuardActive()
            ? getThermalProfile().timings.tradeTickChartMs
            : 0;

    // On PC (throttleMs === 0), coalesce within the current vsync animation frame (rAF) so
    // paired @bookTicker + @aggTrade arriving 1-5ms apart ALWAYS paint together in ONE frame.
    if (throttleMs <= 0) {
        if (channel.timer) {
            clearTimeout(channel.timer);
            channel.timer = null;
        }
        scheduleRafFlush(channel);
        return;
    }

    // Already scheduled for upcoming vsync or trailing throttle flush
    if (channel.rafId !== null || channel.timer !== null) {
        return;
    }

    const now = Date.now();
    const elapsed = now - channel.lastEmitAt;

    // Instead of immediate leading-edge dispatch (which would split @bookTicker at t=0ms
    // from its matching @aggTrade at t=2ms by 38ms!), coalesce into the next vsync rAF
    // so both lines always move together in exact lockstep.
    if (elapsed >= throttleMs) {
        scheduleRafFlush(channel);
        return;
    }

    const delay = Math.max(0, throttleMs - elapsed);
    channel.timer = setTimeout(() => {
        channel.timer = null;
        scheduleRafFlush(channel);
    }, delay);
}

function flushChannelOnVisible(symbol: string, exchange: string) {
    const channel = liveMarketChannels.get(getTickChannelKey(symbol, exchange));
    if (!channel) return;
    if (!channel.pendingTick && !channel.pendingBbo) return;
    cancelChannelSchedulers(channel);
    flushPendingChannel(channel);
}

export function getLatestLiveBbo(symbol: string, exchange: string): BboTickEvent | null {
    if (!symbol || !exchange) return null;
    const channel = liveMarketChannels.get(getTickChannelKey(symbol, exchange));
    if (!channel || !channel.latestBbo) return null;
    if (Date.now() - channel.lastBboWallAt > 15000) return null;
    return channel.latestBbo;
}

export function getLatestLiveTick(symbol: string, exchange: string): TradeTickEvent | null {
    if (!symbol || !exchange) return null;
    const channel = liveMarketChannels.get(getTickChannelKey(symbol, exchange));
    if (!channel || !channel.latestTick) return null;
    if (Date.now() - channel.lastTickWallAt > 15000) return null;
    return channel.latestTick;
}

function emitLiveBboTick(symbol: string, exchange: string, bbo: BboTickEvent) {
    if (!bbo || !Number.isFinite(bbo.bestBid) || !Number.isFinite(bbo.bestAsk)) return;
    if (bbo.bestBid <= 0 || bbo.bestAsk <= 0 || bbo.bestAsk < bbo.bestBid) return;

    const channel = liveMarketChannels.get(getTickChannelKey(symbol, exchange));
    if (!channel) return;

    const now = Date.now();
    const ts = normalizeTsMs(bbo.timestamp);

    // Reject strictly older out-of-order BBO frames (e.g. dual WS or slower orderbook snapshot),
    // while allowing automatic cursor reset if the previous source went silent for > 2.5s.
    const sourceTimedOut = channel.lastBboWallAt > 0 && (now - channel.lastBboWallAt) > 2500;
    if (!sourceTimedOut && ts < channel.lastBboTs) {
        return;
    }

    const normalizedBbo: BboTickEvent = {
        bestBid: bbo.bestBid,
        bestAsk: bbo.bestAsk,
        timestamp: ts,
    };

    channel.lastBboTs = ts;
    channel.lastBboWallAt = now;
    channel.latestBbo = normalizedBbo;

    if (channel.bboListeners.size === 0) return;

    // Deduplicate identical bid/ask prices (ignores @bookTicker size-only churn)
    const refBid = channel.pendingBbo ? channel.pendingBbo.bestBid : channel.lastEmittedBid;
    const refAsk = channel.pendingBbo ? channel.pendingBbo.bestAsk : channel.lastEmittedAsk;
    if (normalizedBbo.bestBid === refBid && normalizedBbo.bestAsk === refAsk) {
        return;
    }

    channel.pendingBbo = normalizedBbo;
    scheduleOrDispatchChannel(channel);
}

export function subscribeLiveBbo(
    symbol: string,
    exchange: string,
    cb: (bbo: BboTickEvent) => void
): () => void {
    if (!symbol || !exchange) return () => {};
    const key = getTickChannelKey(symbol, exchange);
    const channel = getOrCreateChannel(symbol, exchange);
    channel.bboListeners.add(cb);

    // Immediately sync subscriber with the freshest live BBO if available
    if (channel.latestBbo && (Date.now() - channel.lastBboWallAt) <= 15000) {
        channel.lastEmittedBid = channel.latestBbo.bestBid;
        channel.lastEmittedAsk = channel.latestBbo.bestAsk;
        try {
            cb(channel.latestBbo);
        } catch (err) {
            console.error('Live BBO initial subscriber error:', err);
        }
    }

    return () => {
        const existing = liveMarketChannels.get(key);
        if (!existing) return;
        existing.bboListeners.delete(cb);
        cleanupChannelIfUnused(key);
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

function emitLiveTradeTick(symbol: string, exchange: string, tick: TradeTickEvent) {
    if (!tick || !Number.isFinite(tick.price) || tick.price <= 0) return;

    const channel = liveMarketChannels.get(getTickChannelKey(symbol, exchange));
    if (!channel) return;

    const now = Date.now();
    const ts = normalizeTsMs(tick.timestamp);
    const sourceTimedOut = channel.lastTickWallAt > 0 && (now - channel.lastTickWallAt) > 2500;
    if (!sourceTimedOut && ts < channel.lastTickTs) {
        return;
    }

    const normalizedTick: TradeTickEvent = {
        ...tick,
        timestamp: ts,
    };

    channel.lastTickTs = ts;
    channel.lastTickWallAt = now;
    channel.latestTick = normalizedTick;

    if (channel.tickListeners.size === 0) return;

    const prev = channel.pendingTick;
    channel.pendingTick = prev
        ? {
              ...normalizedTick,
              high: Math.max(prev.high ?? prev.price, normalizedTick.high ?? normalizedTick.price, normalizedTick.price),
              low: Math.min(prev.low ?? prev.price, normalizedTick.low ?? normalizedTick.price, normalizedTick.price),
              volume: (prev.volume || 0) + (normalizedTick.volume || 0),
              quantity: (prev.quantity ?? prev.volume ?? 0) + (normalizedTick.quantity ?? normalizedTick.volume ?? 0),
          }
        : normalizedTick;

    scheduleOrDispatchChannel(channel);
}

export function subscribeLiveTradeTicks(
    symbol: string,
    exchange: string,
    cb: (tick: TradeTickEvent) => void
): () => void {
    if (!symbol || !exchange) return () => {};
    const key = getTickChannelKey(symbol, exchange);
    const channel = getOrCreateChannel(symbol, exchange);
    channel.tickListeners.add(cb);

    return () => {
        const existing = liveMarketChannels.get(key);
        if (!existing) return;
        existing.tickListeners.delete(cb);
        cleanupChannelIfUnused(key);
    };
}

export const useLevel2MarketData = (symbol: string, exchange: string = 'binance') => {
    const currentKey = symbol ? `${exchange}:${symbol}` : '';
    const [state, setState] = useState<{ key: string; data: MarketDepthData }>(() => ({
        key: currentKey,
        data: EMPTY_MARKET_DEPTH_DATA,
    }));

    useEffect(() => {
        if (!symbol) {
            setState({ key: '', data: EMPTY_MARKET_DEPTH_DATA });
            return;
        }
        const effectKey = `${exchange}:${symbol}`;
        setState({ key: effectKey, data: EMPTY_MARKET_DEPTH_DATA });
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
        let lastBackendTradeAt = 0;
        let lastBackendBboAt = 0;
        // Single unified BBO dedupe cursor shared across direct WS, backend BBO, and backend OB
        // so failover/reconnect between sources never drops a valid price return.
        let lastAcceptedBid = 0;
        let lastAcceptedAsk = 0;

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
            setState(prev => {
                const base = prev.key === effectKey ? prev.data : EMPTY_MARKET_DEPTH_DATA;
                return {
                    key: effectKey,
                    data: {
                        ...base,
                        ...nextData,
                        tradeEvent: nextData.tradeEvent !== undefined ? nextData.tradeEvent : base.tradeEvent,
                    },
                };
            });
        };

        const scheduleFlush = () => {
            if (!throttleTimer && !isFloatingModalDragging()) {
                const delay = getThermalProfile().timings.l2FlushMs;
                throttleTimer = setTimeout(flushUpdate, delay);
            }
        };

        const unsubscribeDragEnd = subscribeFloatingModalDragEnd(() => {
            if (!isSubscribed) return;
            flushChannelOnVisible(symbol, exchange);
            if (pendingData) {
                scheduleFlush();
            }
        });

        const handleVisibilityChange = () => {
            if (typeof document !== 'undefined' && !document.hidden && isSubscribed) {
                flushChannelOnVisible(symbol, exchange);
                if (pendingData) {
                    flushUpdate();
                }
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
                    const directTradeLive = lastDirectTradeAt > 0 && (now - lastDirectTradeAt) < 2500;
                    const directBboLive = lastDirectBboAt > 0 && (now - lastDirectBboAt) < 2500;
                    const backendTradeLive = lastBackendTradeAt > 0 && (now - lastBackendTradeAt) < 2500;
                    const backendBboLive = lastBackendBboAt > 0 && (now - lastBackendBboAt) < 2500;

                    if (e.data.type === 'DATA_READY') {
                        const incoming = { ...e.data.data };
                        // Never let slower L2 orderbook snapshots (or zero frames) overwrite live trade price
                        if (
                            directTradeLive ||
                            backendTradeLive ||
                            !Number.isFinite(Number(incoming.currentPrice)) ||
                            Number(incoming.currentPrice) <= 0
                        ) {
                            delete incoming.currentPrice;
                        }
                        // Only fall back to slower L2 orderbook top-of-book when NEITHER direct
                        // nor backend @bookTicker BBO streams are actively delivering quotes.
                        if (!directBboLive && !backendBboLive && incoming.bids?.length && incoming.asks?.length) {
                            const obBid = Number(incoming.bids[0]?.price || 0);
                            const obAsk = Number(incoming.asks[0]?.price || 0);
                            if (obBid > 0 && obAsk > 0 && obAsk >= obBid) {
                                incoming.bestBid = obBid;
                                incoming.bestAsk = obAsk;
                                if (obBid !== lastAcceptedBid || obAsk !== lastAcceptedAsk) {
                                    lastAcceptedBid = obBid;
                                    lastAcceptedAsk = obAsk;
                                    emitLiveBboTick(symbol, exchange, { bestBid: obBid, bestAsk: obAsk, timestamp: now });
                                }
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
                        if (bestBid > 0 && bestAsk > 0 && bestAsk >= bestBid) {
                            lastBackendBboAt = now;
                            const bboChanged = bestBid !== lastAcceptedBid || bestAsk !== lastAcceptedAsk;
                            lastAcceptedBid = bestBid;
                            lastAcceptedAsk = bestAsk;
                            if (!bboChanged) return;
                            const ts = normalizeTsMs(Number(e.data.data?.ts || now));
                            emitLiveBboTick(symbol, exchange, { bestBid, bestAsk, timestamp: ts });
                            pendingData = {
                                ...(pendingData || {}),
                                bestBid,
                                bestAsk,
                            };
                            scheduleFlush();
                        }
                    } else if (e.data.type === 'TRADE_READY') {
                        const rawTick = e.data.data;
                        const price = Number(rawTick?.price || 0);
                        if (!Number.isFinite(price) || price <= 0) return;
                        const tickTs = normalizeTsMs(Number(rawTick.timestamp || now));
                        if (directTradeLive && tickTs <= lastDirectTradeTs) {
                            return;
                        }
                        lastBackendTradeAt = now;
                        const tick: TradeTickEvent = {
                            ...rawTick,
                            price,
                            timestamp: tickTs,
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
                                const ts = normalizeTsMs(Number(d.T || d.E || Date.now()));
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
                            if (bestBid > 0 && bestAsk > 0 && bestAsk >= bestBid) {
                                const now = Date.now();
                                lastDirectBboAt = now;
                                // Binance @bookTicker fires on top-of-book quantity changes even when
                                // bid/ask prices are unchanged — skip no-op price frames to prevent
                                // canvas repaint storms on high-DPI mobile/tablet devices.
                                const bboChanged = bestBid !== lastAcceptedBid || bestAsk !== lastAcceptedAsk;
                                lastAcceptedBid = bestBid;
                                lastAcceptedAsk = bestAsk;
                                if (!bboChanged) return;
                                const ts = normalizeTsMs(Number(d.T || d.E || now));
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

    return state.key === currentKey ? state.data : EMPTY_MARKET_DEPTH_DATA;
};
