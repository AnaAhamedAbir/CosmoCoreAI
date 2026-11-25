import React, { useState, useEffect, useRef } from 'react';
import CoinLogo from '@/components/common/CoinLogo';
import { isThermalGuardActive } from '@/utils/deviceProfile';
import { buildAuthenticatedWsUrl } from '@/utils/wsAuth';

interface CoinTickerItem {
    id: string;
    symbol: string;
    price: number;
    change: number;
    logoUrl?: string | null;
}

interface TickerItemProps {
    coin: CoinTickerItem;
    resolvedLogoUrl?: string | null;
    onClick?: () => void;
}

const TickerItem: React.FC<TickerItemProps> = ({ coin, resolvedLogoUrl, onClick }) => (
    <div
        className={`flex items-center mx-4 py-2 transition-opacity ${onClick ? 'cursor-pointer hover:opacity-75' : ''}`}
        onClick={onClick}
    >
        <CoinLogo symbol={coin.symbol} logoUrl={coin.logoUrl || resolvedLogoUrl} className="h-5 w-5" />
        <span className="ml-2 font-semibold text-sm text-slate-800 dark:text-slate-200">{coin.symbol}</span>
        <span className="ml-3 font-mono text-sm text-slate-700 dark:text-slate-300">
            ${coin.price > 100 ? coin.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : coin.price.toFixed(4)}
        </span>
        <span className={`ml-2 font-mono text-xs font-semibold ${coin.change >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
            {coin.change >= 0 ? '▲' : '▼'} {Math.abs(coin.change).toFixed(2)}%
        </span>
    </div>
);

const TickerItemOverlay: React.FC<TickerItemProps> = ({ coin, resolvedLogoUrl, onClick }) => (
    <div
        className={`flex items-center mx-3 my-1 py-1.5 px-3.5 rounded-lg bg-white/[0.04] border border-white/10 transition-colors ${onClick ? 'cursor-pointer hover:bg-cyan-500/10 hover:border-cyan-500/30' : ''}`}
        onClick={onClick}
    >
        <CoinLogo symbol={coin.symbol} logoUrl={coin.logoUrl || resolvedLogoUrl} className="h-5 w-5" />
        <span className="ml-2 font-semibold text-sm text-white">{coin.symbol}</span>
        <span className="ml-2.5 font-mono text-sm text-slate-200">
            ${coin.price > 100 ? coin.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : coin.price.toFixed(4)}
        </span>
        <span className={`ml-2 font-mono text-xs font-semibold ${coin.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {coin.change >= 0 ? '▲' : '▼'} {Math.abs(coin.change).toFixed(2)}%
        </span>
    </div>
);

interface MarketTickerProps {
    variant?: 'default' | 'overlay';
    onCoinClick?: (symbol: string) => void;
}

const PUBLIC_SEED_COINS: CoinTickerItem[] = [
    { id: 'BTC', symbol: 'BTC', price: 97420.5, change: 2.34 },
    { id: 'ETH', symbol: 'ETH', price: 3685.2, change: 1.82 },
    { id: 'SOL', symbol: 'SOL', price: 244.6, change: 4.15 },
    { id: 'BNB', symbol: 'BNB', price: 658.4, change: 0.94 },
    { id: 'XRP', symbol: 'XRP', price: 1.482, change: -0.65 },
    { id: 'ADA', symbol: 'ADA', price: 0.985, change: 2.18 },
    { id: 'DOGE', symbol: 'DOGE', price: 0.412, change: -1.12 },
    { id: 'AVAX', symbol: 'AVAX', price: 42.15, change: 2.04 },
    { id: 'LINK', symbol: 'LINK', price: 19.62, change: 1.47 },
    { id: 'SUI', symbol: 'SUI', price: 3.46, change: 5.08 },
    { id: 'APT', symbol: 'APT', price: 12.84, change: 3.12 },
    { id: 'DOT', symbol: 'DOT', price: 8.64, change: 1.25 },
];

const MarketTicker: React.FC<MarketTickerProps> = ({ variant = 'default', onCoinClick }) => {
    const [coins, setCoins] = useState<CoinTickerItem[]>([]);
    const [logoMap, setLogoMap] = useState<Record<string, string>>({});
    const [isPageHidden, setIsPageHidden] = useState<boolean>(() =>
        typeof document !== 'undefined' ? document.hidden : false
    );
    const pendingCoinsRef = useRef<CoinTickerItem[] | null>(null);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastFlushAtRef = useRef<number>(0);
    const hasWsDataRef = useRef<boolean>(false);

    useEffect(() => {
        const handleVisibility = () => {
            const hidden = document.hidden;
            setIsPageHidden(hidden);
            if (!hidden && pendingCoinsRef.current) {
                const queued = pendingCoinsRef.current;
                pendingCoinsRef.current = null;
                lastFlushAtRef.current = Date.now();
                setCoins(queued);
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, []);

    useEffect(() => {
        let isUnmounted = false;

        // Fetch cached official CoinGecko symbol -> logo map from backend once
        fetch('/api/v1/market-data/coin-logos')
            .then((r) => (r.ok ? r.json() : null))
            .then((payload) => {
                if (!isUnmounted && payload && typeof payload.logos === 'object' && payload.logos) {
                    setLogoMap(payload.logos);
                }
            })
            .catch(() => {});

        let socket: WebSocket | null = null;
        let retryTimeout: ReturnType<typeof setTimeout> | undefined;

        const flushCoins = (nextCoins: CoinTickerItem[]) => {
            if (isUnmounted) return;
            if (typeof document !== 'undefined' && document.hidden) {
                pendingCoinsRef.current = nextCoins;
                return;
            }
            if (!isThermalGuardActive()) {
                setCoins(nextCoins);
                return;
            }
            const throttleMs = 2000;
            const elapsed = Date.now() - lastFlushAtRef.current;
            pendingCoinsRef.current = nextCoins;
            if (elapsed >= throttleMs && !flushTimerRef.current) {
                const latest = pendingCoinsRef.current;
                pendingCoinsRef.current = null;
                lastFlushAtRef.current = Date.now();
                if (latest) setCoins(latest);
                return;
            }
            if (!flushTimerRef.current) {
                flushTimerRef.current = setTimeout(() => {
                    flushTimerRef.current = null;
                    if (isUnmounted || (typeof document !== 'undefined' && document.hidden)) return;
                    const latest = pendingCoinsRef.current;
                    pendingCoinsRef.current = null;
                    lastFlushAtRef.current = Date.now();
                    if (latest) setCoins(latest);
                }, Math.max(250, throttleMs - elapsed));
            }
        };

        const loadPublicOverview = async () => {
            if (!hasWsDataRef.current) {
                flushCoins(PUBLIC_SEED_COINS);
            }

            // 1. Prefer CosmoQuantAI backend public overview (cached + zero browser CORS/429 risk)
            try {
                const backendResp = await fetch('/api/v1/market-data/public-overview');
                if (backendResp.ok) {
                    const data = await backendResp.json();
                    if (!isUnmounted && !hasWsDataRef.current && Array.isArray(data?.coins) && data.coins.length > 0) {
                        const mapped: CoinTickerItem[] = data.coins.map((item: any) => {
                            const sym = String(item.symbol || '').split('/')[0].toUpperCase();
                            return {
                                id: sym,
                                symbol: sym,
                                price: Number(item.price) || 0,
                                change: Number(item.changePercent) || 0,
                                logoUrl: item.logoUrl || null,
                            };
                        }).filter((c: CoinTickerItem) => c.symbol && c.price > 0);
                        if (mapped.length > 0) {
                            flushCoins(mapped);
                            return;
                        }
                    }
                }
            } catch {
                // Fall back to direct public exchange snapshot below if backend is offline
            }

            // 2. Direct Binance public 24h ticker fallback when standalone frontend runs without backend
            try {
                const symbolsParam = encodeURIComponent(JSON.stringify(PUBLIC_SEED_COINS.map((c) => `${c.symbol}USDT`)));
                const resp = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${symbolsParam}`);
                if (!resp.ok) return;
                const rows = await resp.json();
                if (!Array.isArray(rows) || isUnmounted || hasWsDataRef.current) return;
                const liveCoins: CoinTickerItem[] = rows
                    .map((row: any) => {
                        const symbol = String(row.symbol || '').replace('USDT', '').toUpperCase();
                        return {
                            id: symbol,
                            symbol,
                            price: parseFloat(row.lastPrice),
                            change: parseFloat(row.priceChangePercent),
                        };
                    })
                    .filter((c: CoinTickerItem) => c.symbol && Number.isFinite(c.price));
                if (liveCoins.length > 0) flushCoins(liveCoins);
            } catch {
                // Keep seeded coins silently
            }
        };

        const connect = async () => {
            if (isUnmounted) return;
            const token = sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken');
            if (!token) {
                if (variant === 'overlay') {
                    await loadPublicOverview();
                } else {
                    retryTimeout = setTimeout(connect, 3000);
                }
                return;
            }

            // Immediately hydrate authenticated ticker too (e.g., Live Market page) instead of blocking on first WS tick
            loadPublicOverview().catch(() => {});

            const wsUrl = await buildAuthenticatedWsUrl('/ws');
            if (isUnmounted) return;

            socket = new WebSocket(wsUrl);

            socket.onmessage = (event) => {
                if (isUnmounted) return;
                if (isThermalGuardActive() && typeof document !== 'undefined' && document.hidden) {
                    return;
                }
                try {
                    const message = JSON.parse(event.data);

                    if (message.type === 'market_overview' && Array.isArray(message.data)) {
                        hasWsDataRef.current = true;
                        const newCoins: CoinTickerItem[] = message.data.map((item: any) => {
                            const symbol = String(item.symbol || '').split('/')[0].toUpperCase();
                            return {
                                id: symbol,
                                symbol,
                                price: parseFloat(item.price),
                                change: parseFloat(item.changePercent),
                                logoUrl: item.logoUrl || null,
                            };
                        });
                        flushCoins(newCoins);
                    }
                } catch (e) {
                    console.error('Ticker Parse Error:', e);
                }
            };

            socket.onclose = () => {
                if (isUnmounted) return;
                retryTimeout = setTimeout(connect, 3000);
            };

            socket.onerror = () => {
                if (isUnmounted) return;
                if (socket?.readyState === WebSocket.OPEN) {
                    socket.close();
                }
            };
        };

        connect();

        return () => {
            isUnmounted = true;
            if (retryTimeout) clearTimeout(retryTimeout);
            if (flushTimerRef.current) {
                clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
            }
            if (socket) {
                if (socket.readyState === WebSocket.OPEN) {
                    socket.close();
                } else if (socket.readyState === WebSocket.CONNECTING) {
                    const pendingSocket = socket;
                    pendingSocket.onopen = () => pendingSocket.close();
                    pendingSocket.onmessage = null;
                    pendingSocket.onerror = null;
                    pendingSocket.onclose = null;
                }
            }
        };
    }, [variant]);

    const thermalGuard = isThermalGuardActive();
    const visibleCoins = thermalGuard ? coins.slice(0, 20) : coins;
    const tickerItems = thermalGuard
        ? visibleCoins
        : (visibleCoins.length > 5 ? [...visibleCoins, ...visibleCoins] : visibleCoins);
    const ItemComponent = variant === 'overlay' ? TickerItemOverlay : TickerItem;

    if (coins.length === 0) {
        return variant === 'overlay'
            ? <div className="h-10 w-full bg-[#020A1A]/75" />
            : <div className="h-10 w-full bg-slate-200/70 dark:bg-white/5 mx-4 rounded" />;
    }

    if (thermalGuard) {
        return (
            <div className="w-full overflow-x-auto no-scrollbar">
                <div className="flex whitespace-nowrap">
                    {tickerItems.map((coin, index) => (
                        <ItemComponent
                            key={`${coin.id}-${index}`}
                            coin={coin}
                            resolvedLogoUrl={logoMap[coin.symbol]}
                            onClick={onCoinClick ? () => onCoinClick(coin.symbol) : undefined}
                        />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="w-full overflow-hidden">
            <div className="animate-marquee-slow hover:pause-animation" style={{ animationDuration: '500s', animationPlayState: isPageHidden ? 'paused' : 'running' }}>
                <div className="flex whitespace-nowrap">
                    {tickerItems.map((coin, index) => (
                        <ItemComponent
                            key={`${coin.id}-${index}`}
                            coin={coin}
                            resolvedLogoUrl={logoMap[coin.symbol]}
                            onClick={onCoinClick ? () => onCoinClick(coin.symbol) : undefined}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default MarketTicker;
