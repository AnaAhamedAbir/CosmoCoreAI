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
    bidQty?: number;
    askQty?: number;
    timestamp: number;
}

export interface MarkPriceEvent {
    markPrice: number;
    indexPrice?: number;
    fundingRate?: number;
    nextFundingTime?: number;
    timestamp: number;
}

export type FeedHealthMode = 'direct' | 'relay' | 'connecting' | 'stale';

export interface FeedHealthSnapshot {
    mode: FeedHealthMode;
    lastEventAt: number;
    subscribers: number;
    isFutures: boolean;
}

export interface MarketDepthData {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
    walls: { price: number; type: 'buy' | 'sell'; size: number }[];
    currentPrice: number;
    bestBid?: number;
    bestAsk?: number;
    markPrice?: number;
    tradeEvent: TradeTickEvent | null;
}

export const EMPTY_MARKET_DEPTH_DATA: MarketDepthData = {
    bids: [],
    asks: [],
    walls: [],
    currentPrice: 0,
    bestBid: 0,
    bestAsk: 0,
    markPrice: 0,
    tradeEvent: null,
};

interface LiveMarketChannelState {
    tickListeners: Set<(tick: TradeTickEvent) => void>;
    tradeBatchListeners: Set<(ticks: TradeTickEvent[]) => void>;
    bboListeners: Set<(bbo: BboTickEvent) => void>;
    markListeners: Set<(mark: MarkPriceEvent) => void>;
    healthListeners: Set<(health: FeedHealthSnapshot) => void>;
    lastEmitAt: number;
    timer: ReturnType<typeof setTimeout> | null;
    rafId: number | null;
    pendingTick: TradeTickEvent | null;
    pendingTradeBatch: TradeTickEvent[];
    pendingBbo: BboTickEvent | null;
    latestTick: TradeTickEvent | null;
    latestBbo: BboTickEvent | null;
    latestMark: MarkPriceEvent | null;
    latestHealth: FeedHealthSnapshot;
    lastTickTs: number;
    lastTickWallAt: number;
    lastBboTs: number;
    lastBboWallAt: number;
    lastMarkTs: number;
    lastMarkWallAt: number;
    lastEmittedBid: number;
    lastEmittedAsk: number;
}

interface SharedMarketConnection {
    key: string;
    symbol: string;
    exchange: string;
    isFutures: boolean;
    refCount: number;
    dataListeners: Set<(data: MarketDepthData) => void>;
    currentData: MarketDepthData;
    pendingData: Partial<MarketDepthData> | null;
    flushTimer: ReturnType<typeof setTimeout> | null;
    ws: WebSocket | null;
    directBinanceSockets: WebSocket[];
    worker: Worker | null;
    reconnectTimer: ReturnType<typeof setTimeout> | null;
    directReconnectTimers: Map<number, ReturnType<typeof setTimeout>>;
    directBackoffMs: Map<number, number>;
    healthTimer: ReturnType<typeof setInterval> | null;
    unsubscribeDragEnd: (() => void) | null;
    visibilityHandler: (() => void) | null;
    disposed: boolean;
    lastDirectTradeTs: number;
    lastDirectTradeAt: number;
    lastDirectBboAt: number;
    lastDirectMarkAt: number;
    lastBackendTradeAt: number;
    lastBackendBboAt: number;
    lastBackendAnyAt: number;
    lastAcceptedBid: number;
    lastAcceptedAsk: number;
    connectToBackend: () => void;
    connectDirectBinance: () => void;
    forceReconnect: () => void;
}

const liveMarketChannels = new Map<string, LiveMarketChannelState>();
const sharedConnections = new Map<string, SharedMarketConnection>();

export function getMarketChannelKey(symbol: string, exchange: string): string {
    return `${String(exchange || '').trim().toLowerCase()}:${String(symbol || '').trim().toUpperCase()}`;
}

function normalizeTsMs(rawTs?: number): number {
    if (!rawTs || !Number.isFinite(rawTs) || rawTs <= 0) return Date.now();
    return rawTs < 10000000000 ? rawTs * 1000 : rawTs;
}

function getOrCreateChannel(symbol: string, exchange: string): LiveMarketChannelState {
    const key = getMarketChannelKey(symbol, exchange);
    let channel = liveMarketChannels.get(key);
    if (!channel) {
        channel = {
            tickListeners: new Set(),
            tradeBatchListeners: new Set(),
            bboListeners: new Set(),
            markListeners: new Set(),
            healthListeners: new Set(),
            lastEmitAt: 0,
            timer: null,
            rafId: null,
            pendingTick: null,
            pendingTradeBatch: [],
            pendingBbo: null,
            latestTick: null,
            latestBbo: null,
            latestMark: null,
            latestHealth: {
                mode: 'connecting',
                lastEventAt: 0,
                subscribers: 0,
                isFutures: symbol.includes(':'),
            },
            lastTickTs: 0,
            lastTickWallAt: 0,
            lastBboTs: 0,
            lastBboWallAt: 0,
            lastMarkTs: 0,
            lastMarkWallAt: 0,
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
    if (sharedConnections.has(key)) return;
    if (
        existing.tickListeners.size === 0 &&
        existing.tradeBatchListeners.size === 0 &&
        existing.bboListeners.size === 0 &&
        existing.markListeners.size === 0 &&
        existing.healthListeners.size === 0
    ) {
        cancelChannelSchedulers(existing);
        existing.pendingTick = null;
        existing.pendingTradeBatch = [];
        existing.pendingBbo = null;
        liveMarketChannels.delete(key);
    }
}

function dispatchChannelFrame(
    channel: LiveMarketChannelState,
    tick: TradeTickEvent | null,
    tradeBatch: TradeTickEvent[],
    bbo: BboTickEvent | null
) {
    // Dispatch trade tick, lossless trade batch, and BBO in the exact same synchronous frame so
    // last-trade line, bid/ask lines, CVD, and Footprint never drift out of sync.
    if (tick && channel.tickListeners.size > 0) {
        channel.tickListeners.forEach((cb) => {
            try {
                cb(tick);
            } catch (err) {
                console.error('Live trade tick subscriber error:', err);
            }
        });
    }
    if (tradeBatch.length > 0 && channel.tradeBatchListeners.size > 0) {
        channel.tradeBatchListeners.forEach((cb) => {
            try {
                cb(tradeBatch);
            } catch (err) {
                console.error('Live trade batch subscriber error:', err);
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
    const tradeBatch = channel.pendingTradeBatch;
    const bbo = channel.pendingBbo;
    channel.pendingTick = null;
    channel.pendingTradeBatch = [];
    channel.pendingBbo = null;
    if (
        (!tick && tradeBatch.length === 0 && !bbo) ||
        (channel.tickListeners.size === 0 && channel.tradeBatchListeners.size === 0 && channel.bboListeners.size === 0)
    ) {
        return;
    }
    if (typeof document !== 'undefined' && document.hidden) {
        channel.pendingTick = tick;
        channel.pendingBbo = bbo;
        // Drop unbounded raw batch backlog while hidden; visibilitychange triggers clean REST resync
        channel.pendingTradeBatch = [];
        return;
    }
    channel.lastEmitAt = Date.now();
    dispatchChannelFrame(channel, tick, tradeBatch, bbo);
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
    if (
        channel.tickListeners.size === 0 &&
        channel.tradeBatchListeners.size === 0 &&
        channel.bboListeners.size === 0
    ) {
        channel.pendingTick = null;
        channel.pendingTradeBatch = [];
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

    if (channel.rafId !== null || channel.timer !== null) {
        return;
    }

    const now = Date.now();
    const elapsed = now - channel.lastEmitAt;

    // Coalesce into next vsync rAF instead of immediate leading-edge dispatch so
    // @bookTicker (t=0ms) and its matching @aggTrade (t=2ms) never split across frames.
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
    const channel = liveMarketChannels.get(getMarketChannelKey(symbol, exchange));
    if (!channel) return;
    if (!channel.pendingTick && channel.pendingTradeBatch.length === 0 && !channel.pendingBbo) return;
    cancelChannelSchedulers(channel);
    flushPendingChannel(channel);
}

function emitLiveBboTick(symbol: string, exchange: string, bbo: BboTickEvent) {
    if (!bbo || !Number.isFinite(bbo.bestBid) || !Number.isFinite(bbo.bestAsk)) return;
    if (bbo.bestBid <= 0 || bbo.bestAsk <= 0 || bbo.bestAsk < bbo.bestBid) return;

    const channel = getOrCreateChannel(symbol, exchange);
    const now = Date.now();
    const ts = normalizeTsMs(bbo.timestamp);

    // Guard against minor clock skew when switching between direct exchange and backend relay clocks
    const sourceTimedOut = channel.lastBboWallAt > 0 && (now - channel.lastBboWallAt) > 2500;
    const clockSkewJump = channel.lastBboTs > 0 && (channel.lastBboTs - ts) > 300 && (channel.lastBboTs - ts) < 60000;
    if (!sourceTimedOut && !clockSkewJump && ts < channel.lastBboTs) {
        return;
    }

    const normalizedBbo: BboTickEvent = {
        bestBid: bbo.bestBid,
        bestAsk: bbo.bestAsk,
        bidQty: bbo.bidQty,
        askQty: bbo.askQty,
        timestamp: ts,
    };

    channel.lastBboTs = ts;
    channel.lastBboWallAt = now;
    channel.latestBbo = normalizedBbo;

    if (channel.bboListeners.size === 0) return;

    const refBid = channel.pendingBbo ? channel.pendingBbo.bestBid : channel.lastEmittedBid;
    const refAsk = channel.pendingBbo ? channel.pendingBbo.bestAsk : channel.lastEmittedAsk;
    if (normalizedBbo.bestBid === refBid && normalizedBbo.bestAsk === refAsk) {
        // Keep latest bidQty/askQty attached if already queued, without forcing a price redraw
        if (channel.pendingBbo) {
            channel.pendingBbo = normalizedBbo;
        }
        return;
    }

    channel.pendingBbo = normalizedBbo;
    scheduleOrDispatchChannel(channel);
}

function emitLiveTradeTick(symbol: string, exchange: string, tick: TradeTickEvent) {
    if (!tick || !Number.isFinite(tick.price) || tick.price <= 0) return;

    const channel = getOrCreateChannel(symbol, exchange);
    const now = Date.now();
    const ts = normalizeTsMs(tick.timestamp);
    const sourceTimedOut = channel.lastTickWallAt > 0 && (now - channel.lastTickWallAt) > 2500;
    const clockSkewJump = channel.lastTickTs > 0 && (channel.lastTickTs - ts) > 300 && (channel.lastTickTs - ts) < 60000;
    if (!sourceTimedOut && !clockSkewJump && ts < channel.lastTickTs) {
        return;
    }

    const normalizedTick: TradeTickEvent = {
        ...tick,
        timestamp: ts,
    };

    channel.lastTickTs = ts;
    channel.lastTickWallAt = now;
    channel.latestTick = normalizedTick;

    if (channel.tickListeners.size === 0 && channel.tradeBatchListeners.size === 0) return;

    if (channel.tickListeners.size > 0) {
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
    }

    // Lossless per-trade batch queue for institutional CVD & Footprint consumers (preserves exact price, side, volume, ts)
    if (channel.tradeBatchListeners.size > 0 && (typeof document === 'undefined' || !document.hidden)) {
        if (channel.pendingTradeBatch.length < 500) {
            channel.pendingTradeBatch.push(normalizedTick);
        }
    }

    scheduleOrDispatchChannel(channel);
}

function emitLiveMarkPrice(symbol: string, exchange: string, mark: MarkPriceEvent) {
    if (!mark || !Number.isFinite(mark.markPrice) || mark.markPrice <= 0) return;

    const channel = getOrCreateChannel(symbol, exchange);
    const now = Date.now();
    const ts = normalizeTsMs(mark.timestamp);
    if (channel.lastMarkWallAt > 0 && (now - channel.lastMarkWallAt) <= 5000 && ts < channel.lastMarkTs) {
        return;
    }

    const normalizedMark: MarkPriceEvent = {
        markPrice: mark.markPrice,
        indexPrice: mark.indexPrice,
        fundingRate: mark.fundingRate,
        nextFundingTime: mark.nextFundingTime,
        timestamp: ts,
    };

    channel.lastMarkTs = ts;
    channel.lastMarkWallAt = now;
    channel.latestMark = normalizedMark;

    if (typeof document !== 'undefined' && document.hidden) return;
    if (channel.markListeners.size === 0) return;

    channel.markListeners.forEach((cb) => {
        try {
            cb(normalizedMark);
        } catch (err) {
            console.error('Live mark price subscriber error:', err);
        }
    });
}

function emitFeedHealth(symbol: string, exchange: string, next: FeedHealthSnapshot) {
    const channel = getOrCreateChannel(symbol, exchange);
    const prev = channel.latestHealth;
    const changed =
        prev.mode !== next.mode ||
        prev.subscribers !== next.subscribers ||
        (next.mode === 'stale' && prev.lastEventAt !== next.lastEventAt);

    channel.latestHealth = next;
    if (!changed || channel.healthListeners.size === 0) return;

    channel.healthListeners.forEach((cb) => {
        try {
            cb(next);
        } catch (err) {
            console.error('Live feed health subscriber error:', err);
        }
    });
}

export function getLatestLiveBbo(symbol: string, exchange: string): BboTickEvent | null {
    if (!symbol || !exchange) return null;
    const channel = liveMarketChannels.get(getMarketChannelKey(symbol, exchange));
    if (!channel || !channel.latestBbo) return null;
    if (Date.now() - channel.lastBboWallAt > 15000) return null;
    return channel.latestBbo;
}

export function getLatestLiveTick(symbol: string, exchange: string): TradeTickEvent | null {
    if (!symbol || !exchange) return null;
    const channel = liveMarketChannels.get(getMarketChannelKey(symbol, exchange));
    if (!channel || !channel.latestTick) return null;
    if (Date.now() - channel.lastTickWallAt > 15000) return null;
    return channel.latestTick;
}

export function getLatestMarkPrice(symbol: string, exchange: string): MarkPriceEvent | null {
    if (!symbol || !exchange) return null;
    const channel = liveMarketChannels.get(getMarketChannelKey(symbol, exchange));
    if (!channel || !channel.latestMark) return null;
    if (Date.now() - channel.lastMarkWallAt > 30000) return null;
    return channel.latestMark;
}

export function getFeedHealth(symbol: string, exchange: string): FeedHealthSnapshot {
    if (!symbol || !exchange) {
        return { mode: 'connecting', lastEventAt: 0, subscribers: 0, isFutures: false };
    }
    const channel = liveMarketChannels.get(getMarketChannelKey(symbol, exchange));
    if (!channel) {
        return { mode: 'connecting', lastEventAt: 0, subscribers: 0, isFutures: symbol.includes(':') };
    }
    return channel.latestHealth;
}

export function subscribeLiveBbo(
    symbol: string,
    exchange: string,
    cb: (bbo: BboTickEvent) => void
): () => void {
    if (!symbol || !exchange) return () => {};
    const key = getMarketChannelKey(symbol, exchange);
    const channel = getOrCreateChannel(symbol, exchange);
    channel.bboListeners.add(cb);

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

export function subscribeLiveTradeTicks(
    symbol: string,
    exchange: string,
    cb: (tick: TradeTickEvent) => void
): () => void {
    if (!symbol || !exchange) return () => {};
    const key = getMarketChannelKey(symbol, exchange);
    const channel = getOrCreateChannel(symbol, exchange);
    channel.tickListeners.add(cb);

    return () => {
        const existing = liveMarketChannels.get(key);
        if (!existing) return;
        existing.tickListeners.delete(cb);
        cleanupChannelIfUnused(key);
    };
}

/**
 * Lossless batched trade stream for institutional order-flow consumers (CVD, Footprint).
 * Preserves every individual trade's exact price, volume, side, and timestamp within a frame.
 */
export function subscribeLiveTradeBatch(
    symbol: string,
    exchange: string,
    cb: (ticks: TradeTickEvent[]) => void
): () => void {
    if (!symbol || !exchange) return () => {};
    const key = getMarketChannelKey(symbol, exchange);
    const channel = getOrCreateChannel(symbol, exchange);
    channel.tradeBatchListeners.add(cb);

    return () => {
        const existing = liveMarketChannels.get(key);
        if (!existing) return;
        existing.tradeBatchListeners.delete(cb);
        cleanupChannelIfUnused(key);
    };
}

export function subscribeLiveMarkPrice(
    symbol: string,
    exchange: string,
    cb: (mark: MarkPriceEvent) => void
): () => void {
    if (!symbol || !exchange) return () => {};
    const key = getMarketChannelKey(symbol, exchange);
    const channel = getOrCreateChannel(symbol, exchange);
    channel.markListeners.add(cb);

    if (channel.latestMark && (Date.now() - channel.lastMarkWallAt) <= 30000) {
        try {
            cb(channel.latestMark);
        } catch (err) {
            console.error('Live mark price initial subscriber error:', err);
        }
    }

    return () => {
        const existing = liveMarketChannels.get(key);
        if (!existing) return;
        existing.markListeners.delete(cb);
        cleanupChannelIfUnused(key);
    };
}

export function subscribeFeedHealth(
    symbol: string,
    exchange: string,
    cb: (health: FeedHealthSnapshot) => void
): () => void {
    if (!symbol || !exchange) return () => {};
    const key = getMarketChannelKey(symbol, exchange);
    const channel = getOrCreateChannel(symbol, exchange);
    channel.healthListeners.add(cb);

    try {
        cb(channel.latestHealth);
    } catch (err) {
        console.error('Live feed health initial subscriber error:', err);
    }

    return () => {
        const existing = liveMarketChannels.get(key);
        if (!existing) return;
        existing.healthListeners.delete(cb);
        cleanupChannelIfUnused(key);
    };
}

function buildBinancePublicStreamUrls(symbol: string): string[] {
    const clean = symbol.trim();
    if (!clean.includes('/')) return [];
    const isFutures = clean.includes(':');
    const [pairPart, settleRaw] = clean.split(':');
    const [baseRaw, quoteRaw] = pairPart.split('/');
    if (!baseRaw || !quoteRaw) return [];
    const base = baseRaw.toLowerCase();
    const quote = quoteRaw.toLowerCase();
    const settle = (settleRaw || '').toLowerCase();

    if (isFutures) {
        if (settle && settle === base) {
            // COIN-M Delivery/Perp supports combined aggTrade + bookTicker + markPrice on /stream
            const streamSym = `${base}${quote}_perp`;
            return [
                `wss://dstream.binance.com/stream?streams=${streamSym}@aggTrade/${streamSym}@bookTicker/${streamSym}@markPrice@1s`,
            ];
        }
        // USDT-M Futures enforces route separation:
        //  - /public/stream delivers @bookTicker (silently drops @aggTrade/@markPrice)
        //  - /market/stream delivers @aggTrade and @markPrice@1s (silently drops @bookTicker)
        const streamSym = `${base}${quote}`;
        return [
            `wss://fstream.binance.com/public/stream?streams=${streamSym}@bookTicker`,
            `wss://fstream.binance.com/market/stream?streams=${streamSym}@aggTrade/${streamSym}@markPrice@1s`,
        ];
    }
    const streamSym = `${base}${quote}`;
    return [`wss://stream.binance.com:9443/stream?streams=${streamSym}@aggTrade/${streamSym}@bookTicker`];
}

function closeSocketSafely(socket: WebSocket | null) {
    if (!socket) return;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    try {
        if (socket.readyState === WebSocket.CONNECTING) {
            socket.onopen = () => {
                try {
                    socket.close();
                } catch {}
            };
        } else if (socket.readyState === WebSocket.OPEN) {
            socket.close();
        }
    } catch {}
}

function computeConnectionHealth(conn: SharedMarketConnection, now: number): FeedHealthSnapshot {
    const lastDirect = Math.max(conn.lastDirectTradeAt, conn.lastDirectBboAt, conn.lastDirectMarkAt);
    const lastBackend = Math.max(conn.lastBackendTradeAt, conn.lastBackendBboAt, conn.lastBackendAnyAt);
    const lastEventAt = Math.max(lastDirect, lastBackend);
    const directOpen = conn.directBinanceSockets.some((s) => s.readyState === WebSocket.OPEN);
    const backendOpen = conn.ws?.readyState === WebSocket.OPEN;

    // Avoid false-positive STALE flashes on quiet Spot pairs when sockets are genuinely OPEN,
    // while flagging dead/disconnected sockets quickly (~4.5s) and silent sockets after 12s.
    const directFreshMs = directOpen ? 10000 : 4000;
    const backendFreshMs = backendOpen ? 12000 : 4500;

    let mode: FeedHealthMode = 'connecting';
    if (lastDirect > 0 && (now - lastDirect) < directFreshMs) {
        mode = 'direct';
    } else if (lastBackend > 0 && (now - lastBackend) < backendFreshMs) {
        mode = 'relay';
    } else if (lastEventAt > 0 && (now - lastEventAt) >= Math.min(directFreshMs, backendFreshMs)) {
        mode = 'stale';
    }

    return {
        mode,
        lastEventAt,
        subscribers: conn.refCount,
        isFutures: conn.isFutures,
    };
}

function createSharedConnection(symbol: string, exchange: string): SharedMarketConnection {
    const key = getMarketChannelKey(symbol, exchange);
    const isFutures = symbol.includes(':');
    getOrCreateChannel(symbol, exchange);

    const conn: SharedMarketConnection = {
        key,
        symbol,
        exchange,
        isFutures,
        refCount: 0,
        dataListeners: new Set(),
        currentData: EMPTY_MARKET_DEPTH_DATA,
        pendingData: null,
        flushTimer: null,
        ws: null,
        directBinanceSockets: [],
        worker: null,
        reconnectTimer: null,
        directReconnectTimers: new Map(),
        directBackoffMs: new Map(),
        healthTimer: null,
        unsubscribeDragEnd: null,
        visibilityHandler: null,
        disposed: false,
        lastDirectTradeTs: 0,
        lastDirectTradeAt: 0,
        lastDirectBboAt: 0,
        lastDirectMarkAt: 0,
        lastBackendTradeAt: 0,
        lastBackendBboAt: 0,
        lastBackendAnyAt: 0,
        lastAcceptedBid: 0,
        lastAcceptedAsk: 0,
        connectToBackend: () => {},
        connectDirectBinance: () => {},
        forceReconnect: () => {},
    };

    const publishHealth = (now = Date.now()) => {
        if (conn.disposed) return;
        emitFeedHealth(symbol, exchange, computeConnectionHealth(conn, now));
    };

    const flushUpdate = () => {
        if (!conn.pendingData || conn.disposed) {
            conn.flushTimer = null;
            return;
        }
        if (isFloatingModalDragging()) {
            conn.flushTimer = null;
            return;
        }
        if (isThermalGuardActive() && typeof document !== 'undefined' && document.hidden) {
            conn.flushTimer = null;
            return;
        }

        const nextPatch = conn.pendingData;
        conn.pendingData = null;
        conn.flushTimer = null;

        const nextData: MarketDepthData = {
            ...conn.currentData,
            ...nextPatch,
            tradeEvent: nextPatch.tradeEvent !== undefined ? nextPatch.tradeEvent : conn.currentData.tradeEvent,
        };
        conn.currentData = nextData;

        conn.dataListeners.forEach((listener) => {
            try {
                listener(nextData);
            } catch (err) {
                console.error('Shared L2 subscriber error:', err);
            }
        });
    };

    const scheduleFlush = () => {
        if (!conn.flushTimer && !isFloatingModalDragging() && !conn.disposed) {
            const delay = getThermalProfile().timings.l2FlushMs;
            conn.flushTimer = setTimeout(flushUpdate, delay);
        }
    };

    conn.unsubscribeDragEnd = subscribeFloatingModalDragEnd(() => {
        if (conn.disposed) return;
        flushChannelOnVisible(symbol, exchange);
        if (conn.pendingData) {
            scheduleFlush();
        }
    });

    conn.visibilityHandler = () => {
        if (typeof document !== 'undefined' && !document.hidden && !conn.disposed) {
            flushChannelOnVisible(symbol, exchange);
            if (conn.pendingData) {
                flushUpdate();
            }
            const now = Date.now();
            const lastAny = Math.max(
                conn.lastDirectTradeAt,
                conn.lastDirectBboAt,
                conn.lastDirectMarkAt,
                conn.lastBackendTradeAt,
                conn.lastBackendBboAt,
                conn.lastBackendAnyAt
            );
            // Mobile/tablet OS (Android/iOS) often suspends background sockets without firing onclose;
            // auto-recover cleanly if we wake up after >10s of silence.
            if (lastAny > 0 && (now - lastAny) > 10000) {
                conn.forceReconnect();
            } else {
                publishHealth(now);
            }
        }
    };

    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', conn.visibilityHandler);
    }

    conn.connectToBackend = () => {
        if (conn.disposed) return;
        if (conn.reconnectTimer) {
            clearTimeout(conn.reconnectTimer);
            conn.reconnectTimer = null;
        }
        closeSocketSafely(conn.ws);
        conn.ws = null;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const baseUrl = `${protocol}//${window.location.host}`;
        const backendWsUrl = `${baseUrl}/api/v1/market-depth/ws/${exchange}/${symbol}`;

        try {
            if (!conn.worker) {
                conn.worker = new Worker(new URL('../workers/marketDataWorker.ts', import.meta.url), { type: 'module' });
            }

            conn.worker.onmessage = (e) => {
                if (conn.disposed) return;
                const now = Date.now();
                conn.lastBackendAnyAt = now;
                const directTradeLive = conn.lastDirectTradeAt > 0 && (now - conn.lastDirectTradeAt) < 2500;
                const directBboLive = conn.lastDirectBboAt > 0 && (now - conn.lastDirectBboAt) < 2500;
                const backendTradeLive = conn.lastBackendTradeAt > 0 && (now - conn.lastBackendTradeAt) < 2500;
                const backendBboLive = conn.lastBackendBboAt > 0 && (now - conn.lastBackendBboAt) < 2500;

                if (e.data.type === 'DATA_READY') {
                    const incoming = { ...e.data.data };
                    if (
                        directTradeLive ||
                        backendTradeLive ||
                        !Number.isFinite(Number(incoming.currentPrice)) ||
                        Number(incoming.currentPrice) <= 0
                    ) {
                        delete incoming.currentPrice;
                    }
                    if (!directBboLive && !backendBboLive && incoming.bids?.length && incoming.asks?.length) {
                        const obBid = Number(incoming.bids[0]?.price || 0);
                        const obAsk = Number(incoming.asks[0]?.price || 0);
                        const obBidQty = Number(incoming.bids[0]?.size || 0);
                        const obAskQty = Number(incoming.asks[0]?.size || 0);
                        if (obBid > 0 && obAsk > 0 && obAsk >= obBid) {
                            incoming.bestBid = obBid;
                            incoming.bestAsk = obAsk;
                            if (obBid !== conn.lastAcceptedBid || obAsk !== conn.lastAcceptedAsk) {
                                conn.lastAcceptedBid = obBid;
                                conn.lastAcceptedAsk = obAsk;
                                emitLiveBboTick(symbol, exchange, {
                                    bestBid: obBid,
                                    bestAsk: obAsk,
                                    bidQty: obBidQty > 0 ? obBidQty : undefined,
                                    askQty: obAskQty > 0 ? obAskQty : undefined,
                                    timestamp: now,
                                });
                            }
                        }
                    }
                    conn.pendingData = {
                        ...(conn.pendingData || {}),
                        ...incoming,
                    };
                    scheduleFlush();
                    publishHealth(now);
                } else if (e.data.type === 'BBO_READY') {
                    if (directBboLive) return;
                    const bestBid = Number(e.data.data?.bestBid || 0);
                    const bestAsk = Number(e.data.data?.bestAsk || 0);
                    if (bestBid > 0 && bestAsk > 0 && bestAsk >= bestBid) {
                        conn.lastBackendBboAt = now;
                        const bboChanged = bestBid !== conn.lastAcceptedBid || bestAsk !== conn.lastAcceptedAsk;
                        conn.lastAcceptedBid = bestBid;
                        conn.lastAcceptedAsk = bestAsk;
                        if (!bboChanged) return;
                        const ts = normalizeTsMs(Number(e.data.data?.ts || now));
                        emitLiveBboTick(symbol, exchange, { bestBid, bestAsk, timestamp: ts });
                        conn.pendingData = {
                            ...(conn.pendingData || {}),
                            bestBid,
                            bestAsk,
                        };
                        scheduleFlush();
                        publishHealth(now);
                    }
                } else if (e.data.type === 'TRADE_READY') {
                    const rawTick = e.data.data;
                    const price = Number(rawTick?.price || 0);
                    if (!Number.isFinite(price) || price <= 0) return;
                    const tickTs = normalizeTsMs(Number(rawTick.timestamp || now));
                    if (directTradeLive && tickTs <= conn.lastDirectTradeTs) {
                        return;
                    }
                    conn.lastBackendTradeAt = now;
                    // If backend included lossless compact trade tuples [px, amt, isBuy, ts], emit each cleanly
                    const compactTrades = Array.isArray(rawTick.trades) ? rawTick.trades : null;
                    if (compactTrades && compactTrades.length > 0) {
                        for (let i = 0; i < compactTrades.length; i++) {
                            const tuple = compactTrades[i];
                            if (!Array.isArray(tuple) || tuple.length < 4) continue;
                            const tp = Number(tuple[0]);
                            const ta = Number(tuple[1]);
                            const isBuy = Boolean(tuple[2]);
                            const tts = normalizeTsMs(Number(tuple[3] || tickTs));
                            if (!Number.isFinite(tp) || tp <= 0 || !Number.isFinite(ta) || ta <= 0) continue;
                            emitLiveTradeTick(symbol, exchange, {
                                price: tp,
                                volume: ta,
                                quantity: ta,
                                timestamp: tts,
                                side: isBuy ? 'buy' : 'sell',
                                isBuyerMaker: !isBuy,
                            });
                        }
                    } else {
                        const tick: TradeTickEvent = {
                            ...rawTick,
                            price,
                            timestamp: tickTs,
                            quantity: rawTick.quantity ?? rawTick.volume ?? 0,
                            isBuyerMaker: rawTick.isBuyerMaker ?? (rawTick.side === 'sell'),
                        };
                        emitLiveTradeTick(symbol, exchange, tick);
                    }
                    const summaryTick: TradeTickEvent = {
                        ...rawTick,
                        price,
                        timestamp: tickTs,
                        quantity: rawTick.quantity ?? rawTick.volume ?? 0,
                        isBuyerMaker: rawTick.isBuyerMaker ?? (rawTick.side === 'sell'),
                    };
                    conn.pendingData = {
                        ...(conn.pendingData || {}),
                        currentPrice: summaryTick.price,
                        tradeEvent: summaryTick,
                    };
                    scheduleFlush();
                    publishHealth(now);
                }
            };

            conn.worker.onerror = (err) => {
                console.error('Worker encountered an error:', err);
            };

            const ws = new WebSocket(backendWsUrl);
            conn.ws = ws;

            ws.onopen = () => {
                console.log(`Connected to Shared Level 2 Stream for ${symbol} on ${exchange}`);
            };

            ws.onmessage = (event) => {
                if (conn.disposed || !conn.worker) return;
                conn.worker.postMessage({ type: 'PROCESS_MESSAGE', payload: event.data });
            };

            ws.onerror = (err) => {
                console.error('WebSocket error on market depth stream:', err);
            };

            ws.onclose = () => {
                if (!conn.disposed) {
                    conn.reconnectTimer = setTimeout(conn.connectToBackend, 5000);
                }
            };
        } catch (error) {
            console.error('Error creating WebSocket or Worker:', error);
            if (!conn.disposed) {
                conn.reconnectTimer = setTimeout(conn.connectToBackend, 5000);
            }
        }
    };

    conn.connectDirectBinance = () => {
        if (conn.disposed || exchange.toLowerCase() !== 'binance') return;
        conn.directReconnectTimers.forEach((t) => clearTimeout(t));
        conn.directReconnectTimers.clear();
        conn.directBackoffMs.clear();
        conn.directBinanceSockets.forEach((s) => closeSocketSafely(s));
        conn.directBinanceSockets = [];

        const streamUrls = buildBinancePublicStreamUrls(symbol);
        if (streamUrls.length === 0) return;

        const handleDirectMessage = (ev: MessageEvent) => {
            if (conn.disposed) return;
            try {
                const msg = JSON.parse(ev.data);
                const d = msg?.data || msg;
                if (!d) return;

                if (d.e === 'aggTrade' || d.e === 'trade') {
                    const price = Number(d.p || 0);
                    const qty = Number(d.q || 0);
                    if (price > 0) {
                        const now = Date.now();
                        const ts = normalizeTsMs(Number(d.T || d.E || now));
                        const isBuyerMaker = Boolean(d.m);
                        conn.lastDirectTradeTs = ts;
                        conn.lastDirectTradeAt = now;
                        const tick: TradeTickEvent = {
                            price,
                            volume: qty,
                            quantity: qty,
                            timestamp: ts,
                            side: isBuyerMaker ? 'sell' : 'buy',
                            isBuyerMaker,
                        };
                        emitLiveTradeTick(symbol, exchange, tick);
                        conn.pendingData = {
                            ...(conn.pendingData || {}),
                            currentPrice: price,
                            tradeEvent: tick,
                        };
                        scheduleFlush();
                        publishHealth(now);
                    }
                } else if (d.e === 'markPriceUpdate') {
                    const markPrice = Number(d.p || 0);
                    if (markPrice > 0) {
                        const now = Date.now();
                        conn.lastDirectMarkAt = now;
                        const indexPrice = Number(d.i || 0);
                        const fundingRate = d.r !== undefined ? Number(d.r) : undefined;
                        const nextFundingTime = d.T !== undefined ? Number(d.T) : undefined;
                        const ts = normalizeTsMs(Number(d.E || now));
                        emitLiveMarkPrice(symbol, exchange, {
                            markPrice,
                            indexPrice: indexPrice > 0 ? indexPrice : undefined,
                            fundingRate: Number.isFinite(fundingRate) ? fundingRate : undefined,
                            nextFundingTime: Number.isFinite(nextFundingTime) ? nextFundingTime : undefined,
                            timestamp: ts,
                        });
                        conn.pendingData = {
                            ...(conn.pendingData || {}),
                            markPrice,
                        };
                        scheduleFlush();
                        publishHealth(now);
                    }
                } else if (d.b !== undefined && d.a !== undefined) {
                    const bestBid = Number(d.b || 0);
                    const bestAsk = Number(d.a || 0);
                    const bidQty = Number(d.B || 0);
                    const askQty = Number(d.A || 0);
                    if (bestBid > 0 && bestAsk > 0 && bestAsk >= bestBid) {
                        const now = Date.now();
                        conn.lastDirectBboAt = now;
                        const bboChanged = bestBid !== conn.lastAcceptedBid || bestAsk !== conn.lastAcceptedAsk;
                        conn.lastAcceptedBid = bestBid;
                        conn.lastAcceptedAsk = bestAsk;
                        const ts = normalizeTsMs(Number(d.T || d.E || now));
                        if (!bboChanged) {
                            const ch = liveMarketChannels.get(key);
                            if (ch && ch.latestBbo) {
                                ch.latestBbo = {
                                    ...ch.latestBbo,
                                    bidQty: bidQty > 0 ? bidQty : ch.latestBbo.bidQty,
                                    askQty: askQty > 0 ? askQty : ch.latestBbo.askQty,
                                    timestamp: ts,
                                };
                                ch.lastBboWallAt = now;
                            }
                            publishHealth(now);
                            return;
                        }
                        emitLiveBboTick(symbol, exchange, {
                            bestBid,
                            bestAsk,
                            bidQty: bidQty > 0 ? bidQty : undefined,
                            askQty: askQty > 0 ? askQty : undefined,
                            timestamp: ts,
                        });
                        conn.pendingData = {
                            ...(conn.pendingData || {}),
                            bestBid,
                            bestAsk,
                        };
                        scheduleFlush();
                        publishHealth(now);
                    }
                }
            } catch {
                // ignore malformed frame
            }
        };

        const openRoutedSocket = (url: string, slotIndex: number) => {
            if (conn.disposed) return;
            const prevTimer = conn.directReconnectTimers.get(slotIndex);
            if (prevTimer) {
                clearTimeout(prevTimer);
                conn.directReconnectTimers.delete(slotIndex);
            }
            try {
                const directWs = new WebSocket(url);
                conn.directBinanceSockets[slotIndex] = directWs;
                directWs.onopen = () => {
                    conn.directBackoffMs.set(slotIndex, 2000);
                };
                directWs.onmessage = handleDirectMessage;
                directWs.onerror = () => {
                    try {
                        directWs.close();
                    } catch {}
                };
                directWs.onclose = () => {
                    if (conn.disposed) return;
                    const delay = conn.directBackoffMs.get(slotIndex) ?? 2000;
                    conn.directBackoffMs.set(slotIndex, Math.min(delay * 2, 30000));
                    const timer = setTimeout(() => {
                        conn.directReconnectTimers.delete(slotIndex);
                        if (!conn.disposed && conn.directBinanceSockets[slotIndex] === directWs) {
                            openRoutedSocket(url, slotIndex);
                        }
                    }, delay);
                    conn.directReconnectTimers.set(slotIndex, timer);
                };
            } catch {
                // Backend stream serves as automatic seamless fallback
            }
        };

        streamUrls.forEach((url, idx) => openRoutedSocket(url, idx));
    };

    conn.forceReconnect = () => {
        if (conn.disposed) return;
        conn.lastDirectTradeAt = 0;
        conn.lastDirectBboAt = 0;
        conn.lastDirectMarkAt = 0;
        conn.lastBackendTradeAt = 0;
        conn.lastBackendBboAt = 0;
        conn.lastBackendAnyAt = 0;
        conn.lastAcceptedBid = 0;
        conn.lastAcceptedAsk = 0;
        const ch = liveMarketChannels.get(key);
        if (ch) {
            ch.lastEmittedBid = 0;
            ch.lastEmittedAsk = 0;
            ch.lastBboWallAt = 0;
            ch.lastTickWallAt = 0;
            ch.lastMarkWallAt = 0;
        }
        emitFeedHealth(symbol, exchange, {
            mode: 'connecting',
            lastEventAt: 0,
            subscribers: conn.refCount,
            isFutures: conn.isFutures,
        });
        conn.connectToBackend();
        conn.connectDirectBinance();
    };

    // Lightweight periodic health evaluator (detects silent/stale feeds when 0 messages arrive)
    conn.healthTimer = setInterval(() => {
        if (conn.disposed) return;
        if (typeof document !== 'undefined' && document.hidden) return;
        publishHealth();
    }, 1500);

    conn.connectToBackend();
    conn.connectDirectBinance();

    return conn;
}

function disposeSharedConnection(conn: SharedMarketConnection) {
    conn.disposed = true;
    sharedConnections.delete(conn.key);

    if (conn.unsubscribeDragEnd) {
        conn.unsubscribeDragEnd();
        conn.unsubscribeDragEnd = null;
    }
    if (conn.visibilityHandler && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', conn.visibilityHandler);
        conn.visibilityHandler = null;
    }
    if (conn.flushTimer) {
        clearTimeout(conn.flushTimer);
        conn.flushTimer = null;
    }
    if (conn.reconnectTimer) {
        clearTimeout(conn.reconnectTimer);
        conn.reconnectTimer = null;
    }
    conn.directReconnectTimers.forEach((t) => clearTimeout(t));
    conn.directReconnectTimers.clear();
    conn.directBackoffMs.clear();
    if (conn.healthTimer) {
        clearInterval(conn.healthTimer);
        conn.healthTimer = null;
    }

    conn.directBinanceSockets.forEach((s) => closeSocketSafely(s));
    conn.directBinanceSockets = [];
    closeSocketSafely(conn.ws);
    conn.ws = null;

    if (conn.worker) {
        conn.worker.terminate();
        conn.worker = null;
    }

    cleanupChannelIfUnused(conn.key);
}

export function acquireMarketStream(
    symbol: string,
    exchange: string,
    onData: (data: MarketDepthData) => void
): () => void {
    if (!symbol || !exchange) return () => {};
    const key = getMarketChannelKey(symbol, exchange);
    let conn = sharedConnections.get(key);
    if (!conn) {
        conn = createSharedConnection(symbol, exchange);
        sharedConnections.set(key, conn);
    }

    conn.refCount += 1;
    conn.dataListeners.add(onData);
    emitFeedHealth(symbol, exchange, computeConnectionHealth(conn, Date.now()));

    // Immediately hydrate new subscriber (e.g. a newly opened split chart on the same symbol)
    if (conn.currentData !== EMPTY_MARKET_DEPTH_DATA) {
        try {
            onData(conn.currentData);
        } catch (err) {
            console.error('Shared L2 initial hydrate error:', err);
        }
    }

    let released = false;
    return () => {
        if (released) return;
        released = true;
        const active = sharedConnections.get(key);
        if (!active) return;
        active.dataListeners.delete(onData);
        active.refCount = Math.max(0, active.refCount - 1);
        if (active.refCount === 0) {
            disposeSharedConnection(active);
        } else {
            emitFeedHealth(symbol, exchange, computeConnectionHealth(active, Date.now()));
        }
    };
}

export function reconnectMarketStream(symbol: string, exchange: string): void {
    if (!symbol || !exchange) return;
    const conn = sharedConnections.get(getMarketChannelKey(symbol, exchange));
    if (conn && !conn.disposed) {
        conn.forceReconnect();
    }
}
