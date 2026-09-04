import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface TooltipCandleData {
    time: number; // timestamp in seconds or ms
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

interface CandlestickTooltipProps {
    candle: TooltipCandleData | null;
    position: { x: number, y: number } | null;
    chartContainerRef: React.RefObject<HTMLDivElement | null>;
}

export const CandlestickTooltip: React.FC<CandlestickTooltipProps> = ({ candle, position, chartContainerRef }) => {
    const tooltipRef = useRef<HTMLDivElement>(null);
    const [adjustedPos, setAdjustedPos] = useState<{ x: number, y: number } | null>(null);

    useEffect(() => {
        if (!position || !tooltipRef.current || !chartContainerRef.current) {
            return;
        }

        const tooltipRect = tooltipRef.current.getBoundingClientRect();
        const containerRect = chartContainerRef.current.getBoundingClientRect();

        // Base offsets from cursor
        const offsetX = 15;
        const offsetY = 15;

        let finalX = position.x + offsetX;
        let finalY = position.y + offsetY;

        // Prevent overflow on right side
        if (finalX + tooltipRect.width > containerRect.width) {
            finalX = position.x - tooltipRect.width - offsetX;
        }

        // Prevent overflow on bottom
        if (finalY + tooltipRect.height > containerRect.height) {
            finalY = position.y - tooltipRect.height - offsetY;
        }

        // Ensure it doesn't go off the left/top edges
        finalX = Math.max(10, finalX);
        finalY = Math.max(10, finalY);

        setAdjustedPos({ x: finalX, y: finalY });

    }, [position, candle, chartContainerRef]);

    if (!candle || !position) return null;

    const renderPos = adjustedPos || { x: position.x + 15, y: position.y + 15 };

    // Calculate derived data
    const isBullish = candle.close >= candle.open;
    const colorClass = isBullish ? 'text-green-400' : 'text-red-400';
    const bgColorClass = isBullish ? 'bg-green-500/10' : 'bg-red-500/10';
    const borderColorClass = isBullish ? 'border-green-500/30' : 'border-red-500/30';
    
    const change = candle.close - candle.open;
    const percentChange = (change / candle.open) * 100;
    const range = candle.high - candle.low;

    // Format numbers beautifully
    const formatPrice = (p: number) => {
        if (p < 0.0001) return p.toFixed(8);
        if (p < 1) return p.toFixed(5);
        if (p < 10) return p.toFixed(4);
        return p.toFixed(2);
    };

    const formatVol = (v: number) => {
        if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
        if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
        if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
        return v.toFixed(2);
    };

    // Format time natively
    const timeMs = candle.time > 1e11 ? candle.time : candle.time * 1000;
    const dateObj = new Date(timeMs);
    const day = dateObj.getDate().toString().padStart(2, '0');
    const month = dateObj.toLocaleString('en-US', { month: 'short' });
    const year = dateObj.getFullYear();
    const hours = dateObj.getHours().toString().padStart(2, '0');
    const minutes = dateObj.getMinutes().toString().padStart(2, '0');
    const formattedTime = `${day} ${month} ${year}, ${hours}:${minutes}`;

    return (
        <AnimatePresence>
            <motion.div
                ref={tooltipRef}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                style={{
                    left: renderPos.x,
                    top: renderPos.y,
                }}
                className={`absolute z-50 pointer-events-none min-w-[200px] backdrop-blur-xl bg-slate-900/80 border ${borderColorClass} shadow-2xl rounded-xl p-3 flex flex-col gap-2 font-mono text-[11px]`}
            >
                {/* Header: Date & Time */}
                <div className="flex justify-between items-center border-b border-slate-700/50 pb-2 mb-1">
                    <span className="text-slate-400 font-semibold tracking-wider">{formattedTime}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${bgColorClass} ${colorClass}`}>
                        {isBullish ? 'BULL' : 'BEAR'}
                    </span>
                </div>

                {/* Vertical Layout for all items */}
                <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between gap-6">
                        <span className="text-slate-500">Open</span>
                        <span className="text-slate-200 font-medium">{formatPrice(candle.open)}</span>
                    </div>
                    <div className="flex justify-between gap-6">
                        <span className="text-slate-500">High</span>
                        <span className="text-slate-200 font-medium">{formatPrice(candle.high)}</span>
                    </div>
                    <div className="flex justify-between gap-6">
                        <span className="text-slate-500">Low</span>
                        <span className="text-slate-200 font-medium">{formatPrice(candle.low)}</span>
                    </div>
                    <div className="flex justify-between gap-6">
                        <span className="text-slate-500">Close</span>
                        <span className={`font-medium ${colorClass}`}>{formatPrice(candle.close)}</span>
                    </div>

                    {/* Divider */}
                    <div className="w-full h-px bg-slate-700/50 my-1"></div>

                    <div className="flex justify-between gap-6">
                        <span className="text-slate-500">Change</span>
                        <span className={colorClass}>
                            {change > 0 ? '+' : ''}{formatPrice(change)} ({change > 0 ? '+' : ''}{percentChange.toFixed(2)}%)
                        </span>
                    </div>
                    <div className="flex justify-between gap-6">
                        <span className="text-slate-500">Range</span>
                        <span className="text-slate-300">{formatPrice(range)}</span>
                    </div>
                    <div className="flex justify-between gap-6">
                        <span className="text-slate-500">Volume</span>
                        <span className="text-slate-300">{formatVol(candle.volume)}</span>
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
};
