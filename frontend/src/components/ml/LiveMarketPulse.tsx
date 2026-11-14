import React, { useEffect, useRef, useState } from 'react';
import { Activity, TrendingUp, TrendingDown } from 'lucide-react';
import { motion } from 'framer-motion';
import { isThermalGuardActive } from '@/utils/deviceProfile';

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
    const lastFlushRef = useRef<number>(0);
    const thermalGuard = isThermalGuardActive();

    useEffect(() => {
        let ws: WebSocket | null = null;
        let isMounted = true;
        let pulseTimer: ReturnType<typeof setTimeout> | null = null;

        const host = import.meta.env.VITE_API_URL ? new URL(import.meta.env.VITE_API_URL).host : window.location.host;
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Connect directly to our backend unified market data stream
        const wsUrl = `${wsProtocol}//${host}/ws/market-data/${symbol}`;

        try {
            ws = new WebSocket(wsUrl);

            ws.onmessage = (event) => {
                if (!isMounted) return;
                if (isThermalGuardActive()) {
                    if (typeof document !== 'undefined' && document.hidden) return;
                    const now = Date.now();
                    if (now - lastFlushRef.current < 1000) return;
                    lastFlushRef.current = now;
                }
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
                    
                    if (!isThermalGuardActive()) {
                        setIsPulsing(true);
                        if (pulseTimer) clearTimeout(pulseTimer);
                        pulseTimer = setTimeout(() => {
                            if (isMounted) setIsPulsing(false);
                        }, 150);
                    }
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
            if (pulseTimer) clearTimeout(pulseTimer);
            if (ws) {
                ws.close();
            }
            setPrice(null);
            setChange(0);
            setVolume(0);
        };
    }, [symbol]);

    const isUp = change >= 0;
    const priceColor = !prevPrice || !price ? 'text-slate-900 dark:text-white' : price >= prevPrice ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';

    return (
        <div className="bg-white/80 dark:bg-black/30 backdrop-blur-xl border border-slate-200 dark:border-white/5 rounded-xl p-4 flex flex-col justify-center h-[76px] relative overflow-hidden group transition-all hover:border-cyan-500/30 shadow-sm dark:shadow-none">
            {/* Background glowing orb */}
            {!thermalGuard && (
                <div className={`absolute -right-6 -top-6 w-24 h-24 rounded-full blur-[30px] opacity-20 transition-colors duration-1000 ${isUp ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
            )}

            <div className="flex items-center justify-between z-10">
                <div className="flex items-center gap-2">
                    <Activity className={`w-4 h-4 ${isPulsing ? 'text-cyan-600 dark:text-cyan-400 opacity-100' : 'text-slate-400 dark:text-slate-500 opacity-75 dark:opacity-50'} transition-all`} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-400">Live Pulse</span>
                </div>
                
                <div className={`flex items-center gap-1 text-[10px] font-bold ${isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} bg-slate-100 dark:bg-black/50 px-2 py-0.5 rounded-full border border-slate-200 dark:border-white/5`}>
                    {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {Math.abs(change).toFixed(2)}%
                </div>
            </div>

            <div className="flex items-end justify-between mt-2 z-10">
                {thermalGuard ? (
                    <div className={`text-xl font-black font-mono tracking-tighter ${priceColor}`}>
                        {price ? `$${price > 10 ? price.toFixed(2) : price.toFixed(4)}` : 'Connecting...'}
                    </div>
                ) : (
                    <motion.div 
                        key={price}
                        initial={{ opacity: 0.8, y: -2 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`text-xl font-black font-mono tracking-tighter ${priceColor} dark:drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]`}
                    >
                        {price ? `$${price > 10 ? price.toFixed(2) : price.toFixed(4)}` : 'Connecting...'}
                    </motion.div>
                )}

                {volume > 0 && (
                    <div className="text-[9px] font-mono text-slate-600 dark:text-slate-500 font-bold uppercase tracking-wider text-right">
                        Vol: {volume > 1000000 ? (volume / 1000000).toFixed(2) + 'M' : volume > 1000 ? (volume / 1000).toFixed(2) + 'K' : volume.toFixed(0)}
                    </div>
                )}
            </div>
        </div>
    );
};

export default LiveMarketPulse;
