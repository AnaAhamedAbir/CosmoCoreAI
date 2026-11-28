import { useState, useEffect, useRef, useCallback } from 'react';

export interface LiquidationEvent {
    id: number;
    time: string;
    type: 'Long' | 'Short';
    amount: number;
    price: number;
    symbol?: string;
    timestamp: number; // Raw timestamp for charting
    isNew?: boolean;
    isWhale?: boolean;
}

export interface CldData {
    time: number;
    value: number;
}

export interface AggregatedStats {
    longLiqs: number;
    shortLiqs: number;
    totalVol: number;
}

const MAX_FEED_LENGTH = 50; // Increased buffer
const MAX_CLD_POINTS = 100;

export const normalizePairSymbol = (sym?: string): string => {
    if (!sym) return '';
    return sym.split(':')[0].replace('/', '').trim().toUpperCase();
};

export const canonicalPairLabel = (sym?: string): string => {
    if (!sym) return 'BTC/USDT';
    return sym.split(':')[0].trim().toUpperCase();
};

export const useLiquidationWebSocket = (activeExchange: string, activePair: string, enabled: boolean = true) => {
    const [isConnected, setIsConnected] = useState(false);
    const [liveFeed, setLiveFeed] = useState<LiquidationEvent[]>([]);
    const [cldData, setCldData] = useState<CldData[]>([]);
    const [aggregatedStats, setAggregatedStats] = useState<AggregatedStats>({ longLiqs: 0, shortLiqs: 0, totalVol: 0 });
    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const [priceUpdateStatus, setPriceUpdateStatus] = useState<'up' | 'down' | 'none'>('none');

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<any>(null);
    const currentPriceRef = useRef<number>(0);
    const priceStatusTimeoutRef = useRef<any>(null);

    const connect = useCallback(() => {
        try {
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
            if (wsRef.current) {
                wsRef.current.onclose = null;
                wsRef.current.onerror = null;
                wsRef.current.close();
                wsRef.current = null;
            }

            const cleanPair = canonicalPairLabel(activePair);
            const cleanExchange = (activeExchange || 'binance').toLowerCase();

            console.log(`Connecting to Liquidation Stream for ${cleanExchange}:${cleanPair}...`);
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.host;
            const WS_URL = `${protocol}//${host}/api/v1/liquidation/ws/stream`;

            const params = new URLSearchParams({
                exchange: cleanExchange,
                symbol: cleanPair
            });
            const ws = new WebSocket(`${WS_URL}?${params.toString()}`);

            ws.onopen = () => {
                console.log(`Connected to Liquidation Stream (${cleanExchange}:${cleanPair})`);
                setIsConnected(true);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    const normalizedIncoming = normalizePairSymbol(data.symbol);
                    const normalizedTarget = normalizePairSymbol(cleanPair);

                    // Ignore cross-pair or cross-exchange messages
                    if (normalizedIncoming && normalizedTarget && normalizedIncoming !== normalizedTarget) {
                        return;
                    }
                    if (data.exchange && String(data.exchange).toLowerCase() !== cleanExchange) {
                        return;
                    }

                    const price = Number(data.price || 0);

                    // Initial Oracle price sync message (not a liquidation event)
                    if (data.event_type === 'price_sync') {
                        if (price > 0) {
                            currentPriceRef.current = price;
                            setCurrentPrice(price);
                        }
                        return;
                    }

                    const isLong = data.type === 'Long Liquidation';
                    const amount = Number(data.usd_value || 0);
                    const eventSymbol = canonicalPairLabel(data.symbol || cleanPair);

                    if (price <= 0 || amount <= 0) {
                        return;
                    }

                    const newEvent: LiquidationEvent = {
                        id: Date.now() + Math.random(),
                        time: new Date(data.timestamp).toLocaleTimeString(),
                        timestamp: data.timestamp,
                        type: isLong ? 'Long' : 'Short',
                        amount: amount,
                        price: price,
                        symbol: eventSymbol,
                        isNew: true,
                        isWhale: amount > 50000,
                    };

                    setLiveFeed(prev => {
                        const updated = [newEvent, ...prev.map(item => ({ ...item, isNew: false }))];
                        return updated.slice(0, MAX_FEED_LENGTH);
                    });

                    setAggregatedStats(prev => ({
                        longLiqs: prev.longLiqs + (isLong ? amount : 0),
                        shortLiqs: prev.shortLiqs + (!isLong ? amount : 0),
                        totalVol: prev.totalVol + amount
                    }));

                    // Update Oracle Price & direction flash cleanly outside state updater
                    const prevPrice = currentPriceRef.current;
                    currentPriceRef.current = price;
                    setCurrentPrice(price);
                    if (prevPrice > 0) {
                        if (price > prevPrice) setPriceUpdateStatus('up');
                        else if (price < prevPrice) setPriceUpdateStatus('down');
                        else setPriceUpdateStatus('none');
                        if (priceStatusTimeoutRef.current) {
                            clearTimeout(priceStatusTimeoutRef.current);
                        }
                        priceStatusTimeoutRef.current = setTimeout(() => setPriceUpdateStatus('none'), 500);
                    }

                    // Update Cumulative Liquidation Delta (CLD)
                    setCldData(prev => {
                        const lastValue = prev[prev.length - 1]?.value || 0;
                        const change = isLong ? -amount : amount;
                        const newValue = lastValue + change;
                        const newPoint = { time: data.timestamp, value: newValue };
                        return [...prev, newPoint].slice(-MAX_CLD_POINTS);
                    });

                } catch (e) {
                    console.error('Error parsing liquidation message:', e);
                }
            };

            ws.onclose = () => {
                console.log('Disconnected from Liquidation Stream');
                setIsConnected(false);
                reconnectTimeoutRef.current = setTimeout(connect, 3000);
            };

            ws.onerror = (err) => {
                console.error('WebSocket Error:', err);
                ws.close();
            };

            wsRef.current = ws;

        } catch (error) {
            console.error('Connection failed:', error);
            reconnectTimeoutRef.current = setTimeout(connect, 3000);
        }
    }, [activeExchange, activePair]);

    // Reset ALL pair-specific state when exchange or pair changes so stale pair data never bleeds across symbols
    useEffect(() => {
        if (priceStatusTimeoutRef.current) {
            clearTimeout(priceStatusTimeoutRef.current);
            priceStatusTimeoutRef.current = null;
        }
        currentPriceRef.current = 0;
        setLiveFeed([]);
        setAggregatedStats({ longLiqs: 0, shortLiqs: 0, totalVol: 0 });
        setCldData([]);
        setCurrentPrice(0);
        setPriceUpdateStatus('none');
    }, [activeExchange, activePair]);

    useEffect(() => {
        if (!enabled) {
            setIsConnected(false);
            return;
        }
        connect();
        return () => {
            if (wsRef.current) {
                wsRef.current.onclose = null;
                wsRef.current.onerror = null;
                wsRef.current.close();
                wsRef.current = null;
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
            if (priceStatusTimeoutRef.current) {
                clearTimeout(priceStatusTimeoutRef.current);
                priceStatusTimeoutRef.current = null;
            }
        };
    }, [connect, enabled]);

    return {
        isConnected,
        liveFeed,
        aggregatedStats,
        cldData,
        currentPrice,
        priceUpdateStatus
    };
};
