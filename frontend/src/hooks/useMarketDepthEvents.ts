import { useEffect, useRef } from 'react';

export type MarketDepthEventListener = (data: any) => void;

interface MarketDepthChannel {
    ws: WebSocket | null;
    subscribers: Set<MarketDepthEventListener>;
    reconnectTimer: number | null;
    disposed: boolean;
}

const channels = new Map<string, MarketDepthChannel>();

function buildMarketDepthEventsWsUrl(symbol: string): string {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const apiUrl = (import.meta as any).env?.VITE_API_URL as string | undefined;
    const host = apiUrl
        ? apiUrl.replace(/^https?:\/\//, '')
        : window.location.host;

    return `${wsProtocol}//${host}/api/v1/market-depth/ws/events?symbol=${encodeURIComponent(symbol)}`;
}

function connectChannel(symbol: string, channel: MarketDepthChannel) {
    if (channel.disposed || channel.subscribers.size === 0) return;

    const wsUrl = buildMarketDepthEventsWsUrl(symbol);
    const ws = new WebSocket(wsUrl);
    channel.ws = ws;

    ws.onmessage = (event) => {
        if (channel.disposed) return;
        try {
            const data = JSON.parse(event.data);
            channel.subscribers.forEach((listener) => {
                try {
                    listener(data);
                } catch {
                    // ignore subscriber errors
                }
            });
        } catch {
            // ignore parse errors
        }
    };

    ws.onerror = () => {
        // silent fail — WS may not be available in dev without bot running
    };

    ws.onclose = () => {
        if (channel.ws === ws) {
            channel.ws = null;
        }
        if (!channel.disposed && channel.subscribers.size > 0 && channel.reconnectTimer === null) {
            channel.reconnectTimer = window.setTimeout(() => {
                channel.reconnectTimer = null;
                connectChannel(symbol, channel);
            }, 5000);
        }
    };
}

/**
 * Subscribe to the ref-counted shared `/api/v1/market-depth/ws/events` WebSocket for `symbol`.
 */
export function subscribeMarketDepthEvents(
    symbol: string,
    listener: MarketDepthEventListener
): () => void {
    if (!symbol) return () => {};

    let channel = channels.get(symbol);
    if (!channel) {
        channel = {
            ws: null,
            subscribers: new Set(),
            reconnectTimer: null,
            disposed: false,
        };
        channels.set(symbol, channel);
    }

    channel.disposed = false;
    channel.subscribers.add(listener);

    if (!channel.ws && channel.reconnectTimer === null) {
        connectChannel(symbol, channel);
    }

    return () => {
        const current = channels.get(symbol);
        if (!current) return;

        current.subscribers.delete(listener);
        if (current.subscribers.size === 0) {
            current.disposed = true;
            if (current.reconnectTimer !== null) {
                window.clearTimeout(current.reconnectTimer);
                current.reconnectTimer = null;
            }
            if (current.ws) {
                const ws = current.ws;
                current.ws = null;
                ws.onclose = null;
                if (ws.readyState === WebSocket.CONNECTING) {
                    ws.onopen = () => ws.close();
                } else if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
            }
            channels.delete(symbol);
        }
    };
}

export function useMarketDepthEvents(
    symbol: string,
    onEvent: MarketDepthEventListener,
    enabled: boolean = true
) {
    const onEventRef = useRef(onEvent);
    onEventRef.current = onEvent;

    useEffect(() => {
        if (!symbol || !enabled) return;
        return subscribeMarketDepthEvents(symbol, (data) => {
            onEventRef.current(data);
        });
    }, [symbol, enabled]);
}
