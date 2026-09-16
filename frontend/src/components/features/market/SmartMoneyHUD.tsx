import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface SmartMoneyHUDProps {
    data: {
        direction: 'UP' | 'DOWN' | 'NEUTRAL';
        strength: number;
        target_price: number;
        raw_bid_force?: number;
        raw_ask_force?: number;
        smoothed_bid_force?: number;
        smoothed_ask_force?: number;
        bid_dominance?: number;
        ask_dominance?: number;
        funding_rate?: number;
        total_bids_liquidity?: number;
        total_asks_liquidity?: number;
    };
    currentPrice: number;
    icebergEvents?: any[];
    magnetZones?: any[];
    visible: boolean;
}

export const SmartMoneyHUD: React.FC<SmartMoneyHUDProps> = React.memo(({ data, currentPrice, icebergEvents, magnetZones, visible }) => {
    const [isMinimized, setIsMinimized] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [history, setHistory] = useState<{ask: number, bid: number}[]>([]);

    useEffect(() => {
        setMounted(true);
        return () => setMounted(false);
    }, []);

    useEffect(() => {
        if (data && data.ask_dominance !== undefined && data.bid_dominance !== undefined) {
            setHistory(prev => {
                const next = [...prev, { ask: data.ask_dominance!, bid: data.bid_dominance! }];
                return next.slice(-40); // Keep last 40 points for sparkline
            });
        }
    }, [data?.ask_dominance, data?.bid_dominance]);

    if (!visible || !data || !mounted) return null;

    // Formatting helpers
    const formatForce = (force?: number) => {
        if (force === undefined) return '0.00M';
        return (force / 1_000_000).toFixed(2) + 'M';
    };

    const formatPct = (pct?: number) => {
        if (pct === undefined) return '50.0%';
        return (pct * 100).toFixed(1) + '%';
    };

    const formatFunding = (fr?: number) => {
        if (fr === undefined) return '0.0000%';
        return (fr * 100).toFixed(4) + '%';
    };

    const isLongBias = (data.funding_rate || 0) < -0.0001; // Negative funding = Retail Shorting -> Smart Money Pump
    const isShortBias = (data.funding_rate || 0) > 0.0001; // Positive funding = Retail Longing -> Smart Money Dump
    const biasText = isLongBias ? "BULLISH BIAS (1.5x Asks)" : isShortBias ? "BEARISH BIAS (1.5x Bids)" : "NEUTRAL";
    const biasColor = isLongBias ? "text-emerald-400" : isShortBias ? "text-rose-400" : "text-gray-400";

    const dirColor = data.direction === 'UP' ? 'text-emerald-400' : 
                     data.direction === 'DOWN' ? 'text-rose-400' : 
                     'text-gray-400';

    // Divergence Logic (Trap Detection)
    const isBullTrap = data.direction === 'UP' && (data.raw_ask_force || 0) < (data.raw_bid_force || 0) * 0.9;
    const isBearTrap = data.direction === 'DOWN' && (data.raw_bid_force || 0) < (data.raw_ask_force || 0) * 0.9;

    // Sparkline paths
    const maxPoints = 40;
    const askPath = history.map((h, i) => `${(i / (maxPoints - 1)) * 100},${100 - h.ask * 100}`).join(' ');
    const bidPath = history.map((h, i) => `${(i / (maxPoints - 1)) * 100},${100 - h.bid * 100}`).join(' ');

    // Squeeze Probability
    const funding = data.funding_rate || 0;
    const squeezeProb = Math.min(Math.abs(funding) * 10000, 99); // Ex: 0.0080 -> 80%
    const isShortSqueeze = funding < 0;
    
    // Magnet Radar
    const magnets = magnetZones ? [...magnetZones].sort((a, b) => b.intensity - a.intensity).slice(0, 3) : [];

    const hudContent = (
        <motion.div
            drag
            dragMomentum={false}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed z-[9999] top-24 right-20 flex flex-col pointer-events-auto"
            style={{ touchAction: 'none' }} // Prevent scrolling when dragging
        >
            <div className="bg-black/80 backdrop-blur-md border border-white/20 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.9)] w-72 font-mono text-xs pointer-events-auto">
                {/* Header (Draggable Handle) */}
                <div 
                    className="flex justify-between items-center px-4 py-2 bg-gradient-to-r from-gray-900 to-gray-800 border-b border-white/20 select-none cursor-grab active:cursor-grabbing"
                    onDoubleClick={() => setIsMinimized(!isMinimized)}
                >
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.8)]"></div>
                        <span className="font-bold text-gray-200 tracking-wider">SMART MONEY HUD</span>
                    </div>
                    <button 
                        onClick={() => setIsMinimized(!isMinimized)}
                        className="text-gray-400 hover:text-white transition-colors cursor-pointer z-10"
                    >
                        {isMinimized ? '▼' : '▲'}
                    </button>
                </div>

                {/* Body */}
                <AnimatePresence>
                    {!isMinimized && (
                        <motion.div 
                            initial={{ height: 0 }}
                            animate={{ height: 'auto' }}
                            exit={{ height: 0 }}
                            className="overflow-hidden"
                        >
                            <div className="p-4 space-y-4">
                                
                                {/* Divergence Alert */}
                                {(isBullTrap || isBearTrap) && (
                                    <div className={`px-2 py-1.5 rounded animate-pulse text-center font-bold text-[10px] uppercase tracking-widest shadow-inner ${isBullTrap ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'}`}>
                                        ⚠️ {isBullTrap ? 'BULL TRAP DETECTED' : 'BEAR TRAP DETECTED'}
                                    </div>
                                )}

                                {/* Target & Direction */}
                                <div className="flex justify-between items-center bg-black/40 p-3 rounded-lg border border-white/5">
                                    <div>
                                        <div className="text-gray-500 text-[10px] uppercase">AI Target</div>
                                        <div className={`text-xl font-bold ${dirColor} drop-shadow-md`}>
                                            ${data.target_price.toFixed(2)}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-gray-500 text-[10px] uppercase">Direction</div>
                                        <div className={`text-lg font-bold tracking-widest ${dirColor}`}>
                                            {data.direction} {data.direction === 'UP' ? '▲' : data.direction === 'DOWN' ? '▼' : '●'}
                                        </div>
                                    </div>
                                </div>

                                {/* Liquidity Dominance (EMA Smoothed) */}
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[10px] text-gray-400 uppercase font-semibold">
                                        <span>Bulls (Ask Force)</span>
                                        <span>Bears (Bid Force)</span>
                                    </div>
                                    <div className="flex justify-between font-bold">
                                        <span className="text-emerald-400">{formatPct(data.ask_dominance)}</span>
                                        <span className="text-rose-400">{formatPct(data.bid_dominance)}</span>
                                    </div>
                                    <div className="relative h-2.5 w-full bg-gray-800 rounded-full overflow-hidden flex shadow-inner mt-2">
                                        {/* Hysteresis Markers */}
                                        <div className="absolute top-0 bottom-0 left-[48%] w-[1px] bg-white/20 z-10"></div>
                                        <div className="absolute top-0 bottom-0 left-[52%] w-[1px] bg-white/20 z-10"></div>
                                        
                                        <motion.div 
                                            className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400"
                                            initial={{ width: '50%' }}
                                            animate={{ width: `${(data.ask_dominance || 0.5) * 100}%` }}
                                            transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                                        />
                                        <motion.div 
                                            className="h-full bg-gradient-to-l from-rose-600 to-rose-400 flex-1"
                                        />
                                    </div>
                                    <div className="relative h-2 w-full mt-1">
                                        <div className="absolute top-0 left-[48%] -translate-x-1/2 text-[8px] text-gray-500">48</div>
                                        <div className="absolute top-0 left-[52%] -translate-x-1/2 text-[8px] text-gray-500">52</div>
                                    </div>
                                    <div className="flex justify-between text-[10px] text-gray-500 pt-2">
                                        <span>{formatForce(data.smoothed_ask_force)} EMA</span>
                                        <span>{formatForce(data.smoothed_bid_force)} EMA</span>
                                    </div>
                                    
                                    {/* Momentum Sparkline */}
                                    <div className="relative h-6 w-full mt-2 border-b border-white/5">
                                        <svg className="w-full h-full overflow-visible preserve-3d" viewBox="0 0 100 100" preserveAspectRatio="none">
                                            <polyline points={askPath} fill="none" stroke="#34D399" strokeWidth="3" opacity="0.8" vectorEffect="non-scaling-stroke" />
                                            <polyline points={bidPath} fill="none" stroke="#F43F5E" strokeWidth="3" opacity="0.8" vectorEffect="non-scaling-stroke" />
                                        </svg>
                                    </div>
                                </div>

                                {/* Raw Forces & Liquidity */}
                                <div className="grid grid-cols-2 gap-2 bg-black/40 p-2 rounded-lg border border-white/5">
                                    <div>
                                        <div className="text-gray-500 text-[9px] uppercase">Raw Bull Force</div>
                                        <div className="text-emerald-400/80 mb-1">{formatForce(data.raw_ask_force)}</div>
                                        <div className="text-gray-500 text-[9px] uppercase">Ask Liquidity</div>
                                        <div className="text-emerald-400/60 text-[10px]">${((data.total_asks_liquidity || 0) / 1000000).toFixed(2)}M</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-gray-500 text-[9px] uppercase">Raw Bear Force</div>
                                        <div className="text-rose-400/80 mb-1">{formatForce(data.raw_bid_force)}</div>
                                        <div className="text-gray-500 text-[9px] uppercase">Bid Liquidity</div>
                                        <div className="text-rose-400/60 text-[10px]">${((data.total_bids_liquidity || 0) / 1000000).toFixed(2)}M</div>
                                    </div>
                                </div>

                                {/* Market Sentiment & Squeeze */}
                                <div className="pt-2 border-t border-white/10">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-gray-400 text-[10px] uppercase">Retail Funding</span>
                                        <span className="text-gray-200">{formatFunding(data.funding_rate)}</span>
                                    </div>
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-gray-400 text-[10px] uppercase">Smart Money Bias</span>
                                        <span className={`font-bold text-[10px] ${biasColor}`}>{biasText}</span>
                                    </div>
                                    
                                    {/* Squeeze Gauge */}
                                    {squeezeProb > 20 && (
                                        <div className="mt-2">
                                            <div className="flex justify-between text-[9px] font-bold uppercase mb-1">
                                                <span className={isShortSqueeze ? 'text-emerald-400' : 'text-rose-400'}>
                                                    {isShortSqueeze ? '🚀 SHORT SQUEEZE PROB.' : '🩸 LONG SQUEEZE PROB.'}
                                                </span>
                                                <span className="text-white">{squeezeProb.toFixed(0)}%</span>
                                            </div>
                                            <div className="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
                                                <div 
                                                    className={`h-full ${isShortSqueeze ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]'}`} 
                                                    style={{ width: `${squeezeProb}%` }}
                                                ></div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                
                                {/* Liquidation Magnet Radar */}
                                {magnets.length > 0 && (
                                    <div className="pt-2 border-t border-white/10">
                                        <div className="text-[9px] text-gray-500 uppercase font-bold mb-1 flex items-center gap-1">
                                            <span className="animate-pulse">🧲</span> CLOSEST MAGNETS
                                        </div>
                                        <div className="space-y-1">
                                            {magnets.map((mag, i) => {
                                                const dist = Math.abs(((mag.price - currentPrice) / currentPrice) * 100);
                                                return (
                                                    <div key={i} className="flex justify-between items-center text-[9px] bg-black/40 p-1 rounded border-l-2" style={{ borderLeftColor: mag.price > currentPrice ? '#10B981' : '#F43F5E' }}>
                                                        <span className="text-gray-300 font-bold">${mag.price}</span>
                                                        <span className="text-gray-500">{dist.toFixed(2)}% away</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                
                                {/* Whale Order Feed */}
                                {icebergEvents && icebergEvents.length > 0 && (
                                    <div className="pt-2 border-t border-white/10 overflow-hidden">
                                        <div className="text-[9px] text-gray-500 uppercase font-bold mb-1 flex items-center gap-1">
                                            <span className="animate-pulse">🐋</span> WHALE & ICEBERG FEED
                                        </div>
                                        <div className="space-y-1 max-h-16 overflow-y-auto custom-scrollbar pr-1">
                                            {icebergEvents.slice(0, 3).map((ev, i) => (
                                                <div key={i} className="text-[9px] flex justify-between items-center bg-black/40 p-1 rounded">
                                                    <span className={ev.type === 'buy' ? 'text-emerald-400' : 'text-rose-400'}>
                                                        {ev.type === 'buy' ? 'BUY' : 'SELL'}
                                                    </span>
                                                    <span className="text-gray-300">
                                                        {(ev.volume || 0).toFixed(1)} <span className="text-gray-500">@</span> ${ev.price}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );

    return createPortal(hudContent, document.body);
});
