import { useState, useEffect, useRef } from 'react';

export interface TokenData {
    symbol: string;
    lastPrice: number;
    priceChangePercent: number;
    quoteVolume: number;
    hotScore: number;
    priceHistory: number[];
    upTicks: number;
    downTicks: number;
    buyPressure: number; // 0 to 100
}

export interface DashboardData {
    gainers: TokenData[];
    losers: TokenData[];
    hot: TokenData[];
    newTokens: TokenData[];
    volume: TokenData[];
}

export const useBinanceMarketData = (isOpen: boolean, baseMarket: string = 'USDT') => {
    const [data, setData] = useState<DashboardData>({
        gainers: [],
        losers: [],
        hot: [],
        newTokens: [],
        volume: []
    });
    
    const wsRef = useRef<WebSocket | null>(null);
    const lastUpdateRef = useRef<number>(0);
    const dataMapRef = useRef<Map<string, TokenData>>(new Map());

    useEffect(() => {
        if (!isOpen) {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            return;
        }

        // Initialize with REST API to avoid empty screen
        const fetchInitialData = async () => {
            try {
                const response = await fetch('https://api.binance.com/api/v3/ticker/24hr');
                const result = await response.json();
                
                const initialMap = new Map<string, TokenData>();
                
                result.forEach((item: any) => {
                    const isMatch = baseMarket === 'All' ? true : item.symbol.endsWith(baseMarket);
                    if (isMatch) {
                        const volume = parseFloat(item.quoteVolume);
                        const priceChangePercent = parseFloat(item.priceChangePercent);
                        const lastPrice = parseFloat(item.lastPrice);
                        initialMap.set(item.symbol, {
                            symbol: item.symbol,
                            lastPrice: lastPrice,
                            priceChangePercent: priceChangePercent,
                            quoteVolume: volume,
                            hotScore: volume * Math.abs(priceChangePercent),
                            priceHistory: [lastPrice],
                            upTicks: 0,
                            downTicks: 0,
                            buyPressure: 50 // Default neutral
                        });
                    }
                });
                
                dataMapRef.current = initialMap;
                updateDashboardState();
            } catch (error) {
                console.error("Error fetching initial Binance data:", error);
            }
        };

        const connectWebSocket = () => {
            const ws = new WebSocket('wss://stream.binance.com:9443/ws/!ticker@arr');
            
            ws.onmessage = (event) => {
                const tickers = JSON.parse(event.data);
                const now = Date.now();
                
                let hasChanges = false;
                
                tickers.forEach((t: any) => {
                    const isMatch = baseMarket === 'All' ? true : t.s.endsWith(baseMarket);
                    if (isMatch) {
                        const volume = parseFloat(t.q);
                        const priceChangePercent = parseFloat(t.P);
                        const currentPrice = parseFloat(t.c);
                        
                        const existing = dataMapRef.current.get(t.s);
                        let priceHistory = existing ? [...existing.priceHistory] : [currentPrice];
                        let upTicks = existing ? existing.upTicks : 0;
                        let downTicks = existing ? existing.downTicks : 0;
                        
                        if (existing && currentPrice !== existing.lastPrice) {
                            priceHistory.push(currentPrice);
                            if (priceHistory.length > 20) {
                                priceHistory.shift();
                            }
                            
                            // Calculate buy pressure based on recent ticks
                            if (currentPrice > existing.lastPrice) upTicks++;
                            else downTicks++;
                            
                            // Decay ticks slowly to keep it rolling
                            if (upTicks + downTicks > 100) {
                                upTicks = Math.floor(upTicks * 0.9);
                                downTicks = Math.floor(downTicks * 0.9);
                            }
                        }
                        
                        const totalTicks = upTicks + downTicks;
                        const buyPressure = totalTicks > 0 ? Math.round((upTicks / totalTicks) * 100) : 50;
                        
                        dataMapRef.current.set(t.s, {
                            symbol: t.s,
                            lastPrice: currentPrice,
                            priceChangePercent: priceChangePercent,
                            quoteVolume: volume,
                            hotScore: volume * Math.abs(priceChangePercent),
                            priceHistory,
                            upTicks,
                            downTicks,
                            buyPressure
                        });
                        hasChanges = true;
                    }
                });

                // Throttle React updates to every 1.5 seconds for performance
                if (hasChanges && now - lastUpdateRef.current > 1500) {
                    updateDashboardState();
                    lastUpdateRef.current = now;
                }
            };

            ws.onerror = (error) => {
                console.error("WebSocket error:", error);
            };

            ws.onclose = () => {
                // Auto reconnect if still open
                if (isOpen) {
                    setTimeout(connectWebSocket, 3000);
                }
            };

            wsRef.current = ws;
        };

        const updateDashboardState = () => {
            const allTokens = Array.from(dataMapRef.current.values());
            
            // Binance filters out very low volume, stablecoins, and leveraged tokens (UP/DOWN, BEAR/BULL)
            const validTokens = allTokens.filter(t => 
                !['USDCUSDT', 'FDUSDUSDT', 'TUSDUSDT', 'BUSDUSDT', 'EURUSDT'].includes(t.symbol) &&
                !t.symbol.endsWith('UPUSDT') &&
                !t.symbol.endsWith('DOWNUSDT') &&
                !t.symbol.endsWith('BEARUSDT') &&
                !t.symbol.endsWith('BULLUSDT') &&
                t.quoteVolume > 500000 // Minimum $500k volume to be considered a 'Top' gainer/loser
            );

            // 1. Gainers (Highest Price Change %)
            const gainers = [...validTokens].sort((a, b) => b.priceChangePercent - a.priceChangePercent).slice(0, 10);
            
            // 2. Losers (Lowest Price Change %)
            const losers = [...validTokens].sort((a, b) => a.priceChangePercent - b.priceChangePercent).slice(0, 10);
            
            // 3. Volume (Highest Quote Volume)
            const volume = [...validTokens].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 10);
            
            // 4. Hot Tokens (Binance mixes mega-caps like BNB/BTC/ETH/SOL with trending volume tokens)
            // We'll simulate this by picking top mega-caps first, then filling with top volume/trending
            const megaCaps = ['BNBUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
            const hotMega = validTokens.filter(t => megaCaps.includes(t.symbol));
            // Sort mega caps in the specific order
            hotMega.sort((a, b) => megaCaps.indexOf(a.symbol) - megaCaps.indexOf(b.symbol));
            
            const hotTrending = [...validTokens]
                .filter(t => !megaCaps.includes(t.symbol))
                .sort((a, b) => b.hotScore - a.hotScore)
                .slice(0, 10);
            
            const hot = [...hotMega, ...hotTrending].slice(0, 10);
            
            // 5. New Tokens (Proxy: mid-cap high volatility)
            const newTokens = [...validTokens]
                .filter(t => t.quoteVolume > 1000000 && t.quoteVolume < 50000000)
                .sort((a, b) => b.priceChangePercent - a.priceChangePercent)
                .slice(0, 10);

            setData({
                gainers,
                losers,
                volume,
                hot,
                newTokens
            });
        };

        fetchInitialData().then(() => {
            connectWebSocket();
        });

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [isOpen, baseMarket]);

    return data;
};
