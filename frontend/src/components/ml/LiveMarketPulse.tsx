import React, { useEffect, useState } from 'react';
import { Activity, TrendingUp, TrendingDown } from 'lucide-react';
import { motion } from 'framer-motion';

interface LiveMarketPulseProps {
    symbol: string;
    exchange: string;
}

const LiveMarketPulse: React.FC<LiveMarketPulseProps> = ({ symbol, exchange }) => {
    const [price, setPrice] = useState<number | null>(null);
    const [change, setChange] = useState<number>(0);
    const [volume, setVolume] = useState<number>(0);
    const [isPulsing, setIsPulsing] = useState(false);
    const [prevPrice, setPrevPrice] = useState<number | null>(null);

    useEffect(() => {
        let ws: WebSocket | null = null;
        let isMounted = true;

        const host = import.meta.env.VITE_API_URL ? new URL(import.meta.env.VITE_API_URL).host : window.location.host;
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Connect directly to our backend unified market data stream
        const wsUrl = `${wsProtocol}//${host}/ws/market-data/${symbol}`;

        try {
            ws = new WebSocket(wsUrl);

            ws.onmessage = (event) => {
                const payload = JSON.parse(event.data);
                // Unified format: { "type": "ticker", "data": {...} }
                if (payload && payload.type === 'ticker' && payload.data) {
                    const data = payload.data;
                    const newPrice = parseFloat(data.price);
                    
                    setPrice(prev => {
                        setPrevPrice(prev);
                        return newPrice;
                    });
                    
                    setChange(parseFloat(data.changePercent || 0));
                    setVolume(parseFloat(data.volume || 0));
                    
                    setIsPulsing(true);
                    setTimeout(() => setIsPulsing(false), 150);
                }
            };
            
            ws.onerror = () => {
                console.warn(`WebSocket error for ${symbol}`);
            }
        } catch (e) {
            console.error(e);
        }

        return () => {
            isMounted = false;
            if (ws) {
                ws.close();
            }
            setPrice(null);
            setChange(0);
            setVolume(0);
        };
    }, [symbol]);

    const isUp = change >= 0;
    const priceColor = !prevPrice || !price ? 'text-white' : price >= prevPrice ? 'text-emerald-400' : 'text-red-400';

    return (
        <div className="bg-black/30 backdrop-blur-xl border border-white/5 rounded-xl p-4 flex flex-col justify-center h-[76px] relative overflow-hidden group transition-all hover:border-cyan-500/30">
            {/* Background glowing orb */}
            <div className={`absolute -right-6 -top-6 w-24 h-24 rounded-full blur-[30px] opacity-20 transition-colors duration-1000 ${isUp ? 'bg-emerald-500' : 'bg-red-500'}`}></div>

            <div className="flex items-center justify-between z-10">
                <div className="flex items-center gap-2">
                    <Activity className={`w-4 h-4 ${isPulsing ? 'text-cyan-400 opacity-100' : 'text-slate-500 opacity-50'} transition-all`} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Live Pulse</span>
                </div>
                
                <div className={`flex items-center gap-1 text-[10px] font-bold ${isUp ? 'text-emerald-400' : 'text-red-400'} bg-black/50 px-2 py-0.5 rounded-full border border-white/5`}>
                    {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {Math.abs(change).toFixed(2)}%
                </div>
            </div>

            <div className="flex items-end justify-between mt-2 z-10">
                <motion.div 
                    key={price}
                    initial={{ opacity: 0.8, y: -2 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`text-xl font-black font-mono tracking-tighter ${priceColor} drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]`}
                >
                    {price ? `$${price > 10 ? price.toFixed(2) : price.toFixed(4)}` : 'Connecting...'}
                </motion.div>

                {volume > 0 && (
                    <div className="text-[9px] font-mono text-slate-500 font-bold uppercase tracking-wider text-right">
                        Vol: {volume > 1000000 ? (volume / 1000000).toFixed(2) + 'M' : volume > 1000 ? (volume / 1000).toFixed(2) + 'K' : volume.toFixed(0)}
                    </div>
                )}
            </div>
        </div>
    );
};

export default LiveMarketPulse;
