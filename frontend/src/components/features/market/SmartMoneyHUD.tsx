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

    const glowShadow = data.direction === 'UP' ? 'shadow-[0_0_50px_-12px_rgba(16,185,129,0.3)]' :
                       data.direction === 'DOWN' ? 'shadow-[0_0_50px_-12px_rgba(244,63,94,0.3)]' :
                       'shadow-[0_0_30px_rgba(0,0,0,0.8)]';

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
    
    // Fill paths for sparkline gradients
    const askFillPath = `${askPath} 100,100 0,100`;
    const bidFillPath = `${bidPath} 100,100 0,100`;

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
            <div className={`bg-black/70 backdrop-blur-xl border border-white/20 rounded-2xl overflow-hidden ${glowShadow} w-[400px] font-mono text-sm pointer-events-auto transition-shadow duration-500`}>
                {/* Header (Draggable Handle) */}
                <div 
                    className="flex justify-between items-center px-5 py-3 bg-gradient-to-r from-gray-900/90 to-gray-800/90 border-b border-white/20 select-none cursor-grab active:cursor-grabbing"
                    onDoubleClick={() => setIsMinimized(!isMinimized)}
                >
                    <div className="flex items-center gap-3">
                        <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.8)]"></div>
                        <span className="font-bold text-gray-100 tracking-widest text-sm">SMART MONEY HUD</span>
                    </div>
                    <button 
                        onClick={() => setIsMinimized(!isMinimized)}
                        className="text-gray-400 hover:text-white transition-colors cursor-pointer z-10 p-1"
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
                            <div className="p-5 space-y-5">
                                
                                {/* Divergence Alert */}
                                <AnimatePresence>
                                    {(isBullTrap || isBearTrap) && (
                                        <motion.div 
                                            initial={{ opacity: 0, y: -10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, height: 0 }}
                                            className={`px-3 py-2.5 rounded-md animate-pulse text-center font-bold text-xs uppercase tracking-widest shadow-[inset_0_0_20px_rgba(0,0,0,0.5)] ${isBullTrap ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'}`}
                                        >
                                            <span className="mr-2 text-sm">⚠️</span> 
                                            {isBullTrap ? 'BULL TRAP DETECTED - FAKEOUT' : 'BEAR TRAP DETECTED - FAKEOUT'}
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                                {/* Target & Direction */}
                                <div className="flex justify-between items-center bg-black/50 p-4 rounded-xl border border-white/10 shadow-[inset_0_0_15px_rgba(255,255,255,0.02)]">
                                    <div>
                                        <div className="text-gray-500 text-xs uppercase font-semibold tracking-wider">AI Target</div>
                                        <div className={`text-3xl font-black ${dirColor} drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] mt-1`}>
                                            ${data.target_price.toFixed(2)}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-gray-500 text-xs uppercase font-semibold tracking-wider">Direction</div>
                                        <div className={`text-2xl font-black tracking-widest ${dirColor} mt-1 flex items-center justify-end gap-2`}>
                                            {data.direction} 
                                            <span className="text-3xl leading-none">
                                                {data.direction === 'UP' ? '▲' : data.direction === 'DOWN' ? '▼' : '●'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Liquidity Dominance (EMA Smoothed) */}
                                <div className="space-y-1.5">
                                    <div className="flex justify-between text-xs text-gray-400 uppercase font-semibold">
                                        <span>Bulls (Ask Force)</span>
                                        <span>Bears (Bid Force)</span>
                                    </div>
                                    <div className="flex justify-between font-black text-lg">
                                        <span className="text-emerald-400 drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]">{formatPct(data.ask_dominance)}</span>
                                        <span className="text-rose-400 drop-shadow-[0_0_5px_rgba(244,63,94,0.5)]">{formatPct(data.bid_dominance)}</span>
                                    </div>
                                    <div className="relative h-3 w-full bg-gray-900 rounded-full overflow-hidden flex shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] mt-2">
                                        {/* Hysteresis Markers */}
                                        <div className="absolute top-0 bottom-0 left-[48%] w-[2px] bg-white/30 z-10 shadow-[0_0_4px_rgba(255,255,255,0.8)]"></div>
                                        <div className="absolute top-0 bottom-0 left-[52%] w-[2px] bg-white/30 z-10 shadow-[0_0_4px_rgba(255,255,255,0.8)]"></div>
                                        
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
                                        <div className="absolute top-0 left-[48%] -translate-x-1/2 text-[9px] font-bold text-gray-500">48</div>
                                        <div className="absolute top-0 left-[52%] -translate-x-1/2 text-[9px] font-bold text-gray-500">52</div>
                                    </div>
                                    <div className="flex justify-between text-xs font-bold text-gray-500 pt-3">
                                        <span>{formatForce(data.smoothed_ask_force)} EMA</span>
                                        <span>{formatForce(data.smoothed_bid_force)} EMA</span>
                                    </div>
                                    
                                    {/* Momentum Sparkline */}
                                    <div className="relative h-10 w-full mt-3 border-b border-white/10">
                                        <svg className="w-full h-full overflow-visible preserve-3d" viewBox="0 0 100 100" preserveAspectRatio="none">
                                            {/* Gradients for fills */}
                                            <defs>
                                                <linearGradient id="askGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor="#34D399" stopOpacity="0.3"/>
                                                    <stop offset="100%" stopColor="#34D399" stopOpacity="0.0"/>
                                                </linearGradient>
                                                <linearGradient id="bidGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor="#F43F5E" stopOpacity="0.3"/>
                                                    <stop offset="100%" stopColor="#F43F5E" stopOpacity="0.0"/>
                                                </linearGradient>
                                            </defs>
                                            <polygon points={askFillPath} fill="url(#askGrad)" />
                                            <polygon points={bidFillPath} fill="url(#bidGrad)" />
                                            <polyline points={askPath} fill="none" stroke="#34D399" strokeWidth="4" opacity="0.9" vectorEffect="non-scaling-stroke" />
                                            <polyline points={bidPath} fill="none" stroke="#F43F5E" strokeWidth="4" opacity="0.9" vectorEffect="non-scaling-stroke" />
                                        </svg>
                                    </div>
                                </div>

                                {/* Raw Forces & Liquidity */}
                                <div className="grid grid-cols-2 gap-3 bg-black/40 p-3 rounded-xl border border-white/5">
                                    <div className="space-y-1">
                                        <div className="text-gray-500 text-[10px] uppercase font-bold tracking-widest">Raw Bull Force</div>
                                        <div className="text-emerald-400/90 font-black text-lg pb-1">{formatForce(data.raw_ask_force)}</div>
                                        <div className="text-gray-500 text-[10px] uppercase font-bold tracking-widest">Ask Liquidity</div>
                                        <div className="text-emerald-400/70 text-sm font-semibold">${((data.total_asks_liquidity || 0) / 1000000).toFixed(2)}M</div>
                                    </div>
                                    <div className="text-right space-y-1">
                                        <div className="text-gray-500 text-[10px] uppercase font-bold tracking-widest">Raw Bear Force</div>
                                        <div className="text-rose-400/90 font-black text-lg pb-1">{formatForce(data.raw_bid_force)}</div>
                                        <div className="text-gray-500 text-[10px] uppercase font-bold tracking-widest">Bid Liquidity</div>
                                        <div className="text-rose-400/70 text-sm font-semibold">${((data.total_bids_liquidity || 0) / 1000000).toFixed(2)}M</div>
                                    </div>
                                </div>

                                {/* Market Sentiment & Squeeze */}
                                <div className="pt-4 border-t border-white/10 space-y-3">
                                    <div className="flex justify-between items-center">
                                        <span className="text-gray-400 text-xs uppercase font-bold tracking-wider">Retail Funding</span>
                                        <span className="text-gray-100 font-mono text-sm bg-white/10 px-2 py-0.5 rounded">{formatFunding(data.funding_rate)}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-gray-400 text-xs uppercase font-bold tracking-wider">Smart Bias</span>
                                        <span className={`font-black text-xs px-2 py-0.5 rounded border border-white/10 bg-black/50 ${biasColor}`}>{biasText}</span>
                                    </div>
                                    
                                    {/* Squeeze Gauge */}
                                    {squeezeProb > 20 && (
                                        <div className="pt-1">
                                            <div className="flex justify-between text-[10px] font-black uppercase mb-1.5 tracking-wider">
                                                <span className={isShortSqueeze ? 'text-emerald-400 drop-shadow-[0_0_2px_rgba(16,185,129,0.5)]' : 'text-rose-400 drop-shadow-[0_0_2px_rgba(244,63,94,0.5)]'}>
                                                    {isShortSqueeze ? '🚀 SHORT SQUEEZE PROBABILITY' : '🩸 LONG SQUEEZE PROBABILITY'}
                                                </span>
                                                <span className="text-white bg-black/60 px-1 rounded">{squeezeProb.toFixed(0)}%</span>
                                            </div>
                                            <div className="w-full bg-black/80 h-2.5 rounded-full overflow-hidden shadow-[inset_0_1px_3px_rgba(0,0,0,0.8)] border border-white/5">
                                                <div 
                                                    className={`h-full ${isShortSqueeze ? 'bg-gradient-to-r from-emerald-600 to-emerald-400 shadow-[0_0_10px_rgba(16,185,129,1)]' : 'bg-gradient-to-r from-rose-600 to-rose-400 shadow-[0_0_10px_rgba(244,63,94,1)]'}`} 
                                                    style={{ width: `${squeezeProb}%` }}
                                                ></div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                
                                {/* Liquidation Magnet Radar */}
                                {magnets.length > 0 && (
                                    <div className="pt-4 border-t border-white/10">
                                        <div className="text-xs text-gray-400 uppercase font-black tracking-widest mb-2 flex items-center gap-2">
                                            <span className="animate-pulse text-sm">🧲</span> CLOSEST MAGNETS
                                        </div>
                                        <div className="space-y-1.5">
                                            {magnets.map((mag, i) => {
                                                const dist = Math.abs(((mag.price - currentPrice) / currentPrice) * 100);
                                                return (
                                                    <div key={i} className="flex justify-between items-center text-xs bg-gradient-to-r from-black/60 to-black/30 p-2 rounded-md border-l-4 hover:bg-white/5 transition-colors" style={{ borderLeftColor: mag.price > currentPrice ? '#10B981' : '#F43F5E' }}>
                                                        <span className="text-gray-200 font-black tracking-wider">${mag.price}</span>
                                                        <span className="text-gray-400 font-mono text-[10px] bg-black/40 px-1.5 py-0.5 rounded">{dist.toFixed(2)}% AWAY</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                
                                {/* Whale Order Feed */}
                                {icebergEvents && icebergEvents.length > 0 && (
                                    <div className="pt-4 border-t border-white/10">
                                        <div className="text-xs text-gray-400 uppercase font-black tracking-widest mb-2 flex items-center gap-2">
                                            <span className="animate-pulse text-sm">🐋</span> LIVE WHALE FEED
                                        </div>
                                        <div className="space-y-1.5 max-h-24 overflow-y-auto custom-scrollbar pr-2">
                                            {icebergEvents.slice(0, 4).map((ev, i) => (
                                                <div key={i} className="text-xs flex justify-between items-center bg-black/40 p-2 rounded-md hover:bg-white/5 transition-colors border border-white/5">
                                                    <span className={`font-black tracking-widest px-1.5 py-0.5 rounded ${ev.type === 'buy' ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'}`}>
                                                        {ev.type === 'buy' ? 'BUY' : 'SELL'}
                                                    </span>
                                                    <span className="text-gray-200 font-mono">
                                                        <span className="font-bold">{(ev.volume || 0).toFixed(1)}</span> 
                                                        <span className="text-gray-600 mx-1">@</span> 
                                                        <span className="text-gray-400">${ev.price}</span>
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
