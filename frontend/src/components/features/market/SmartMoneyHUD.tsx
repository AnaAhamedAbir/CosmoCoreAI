import React, { useState } from 'react';
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
    visible: boolean;
}

export const SmartMoneyHUD: React.FC<SmartMoneyHUDProps> = React.memo(({ data, visible }) => {
    const [isMinimized, setIsMinimized] = useState(false);

    if (!visible || !data) return null;

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

    return (
        <motion.div
            drag
            dragMomentum={false}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute z-[100] top-24 right-20 flex flex-col pointer-events-auto"
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
                                </div>

                                {/* Raw Forces & Liquidity */}
                                <div className="grid grid-cols-2 gap-2 bg-black/40 p-2 rounded-lg border border-white/5">
                                    <div>
                                        <div className="text-gray-500 text-[9px] uppercase">Raw Bull Force</div>
                                        <div className="text-emerald-400/80 mb-1">{formatForce(data.raw_ask_force)}</div>
                                        <div className="text-gray-500 text-[9px] uppercase">Ask Liquidity</div>
                                        <div className="text-emerald-400/60 text-[10px]">{((data.total_asks_liquidity || 0)).toFixed(2)} VOL</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-gray-500 text-[9px] uppercase">Raw Bear Force</div>
                                        <div className="text-rose-400/80 mb-1">{formatForce(data.raw_bid_force)}</div>
                                        <div className="text-gray-500 text-[9px] uppercase">Bid Liquidity</div>
                                        <div className="text-rose-400/60 text-[10px]">{((data.total_bids_liquidity || 0)).toFixed(2)} VOL</div>
                                    </div>
                                </div>

                                {/* Market Sentiment */}
                                <div className="pt-2 border-t border-white/10">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-gray-400 text-[10px] uppercase">Retail Funding</span>
                                        <span className="text-gray-200">{formatFunding(data.funding_rate)}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-gray-400 text-[10px] uppercase">Smart Money Bias</span>
                                        <span className={`font-bold text-[10px] ${biasColor}`}>{biasText}</span>
                                    </div>
                                </div>
                                
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
});
