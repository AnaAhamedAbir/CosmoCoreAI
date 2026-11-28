import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/context/ThemeContext';
import { formatCompactOrderflowNumber } from '../../../utils/orderflowMath';

export interface TooltipCandleData {
    time: number; // timestamp in seconds or ms
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    delta?: number;
    buyPct?: number;
    pocPrice?: number;
}

interface CandlestickTooltipProps {
    candle: TooltipCandleData | null;
    position: { x: number; y: number } | null;
    chartContainerRef: React.RefObject<HTMLDivElement | null>;
    leftAxisOffset?: number;
}

export const CandlestickTooltip: React.FC<CandlestickTooltipProps> = ({
    candle,
    position,
    chartContainerRef,
    leftAxisOffset = 0,
}) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const tooltipRef = useRef<HTMLDivElement>(null);
    const [adjustedPos, setAdjustedPos] = useState<{ x: number; y: number } | null>(null);

    useEffect(() => {
        if (!position || !tooltipRef.current || !chartContainerRef.current) {
            return;
        }

        const tooltipRect = tooltipRef.current.getBoundingClientRect();
        const containerRect = chartContainerRef.current.getBoundingClientRect();

        const offsetX = 16;
        const offsetY = 16;
        const originX = position.x + leftAxisOffset;

        let finalX = originX + offsetX;
        let finalY = position.y + offsetY;

        if (finalX + tooltipRect.width > containerRect.width - 8) {
            finalX = originX - tooltipRect.width - offsetX;
        }
        if (finalY + tooltipRect.height > containerRect.height - 8) {
            finalY = position.y - tooltipRect.height - offsetY;
        }

        finalX = Math.max(10 + leftAxisOffset, finalX);
        finalY = Math.max(10, finalY);

        setAdjustedPos({ x: finalX, y: finalY });
    }, [position, candle, chartContainerRef, leftAxisOffset]);

    const formatPrice = (p: number) => {
        if (!Number.isFinite(p)) return '0.00';
        const abs = Math.abs(p);
        if (abs === 0) return '0.00';
        if (abs < 0.0001) return p.toFixed(8);
        if (abs < 1) return p.toFixed(5);
        if (abs < 10) return p.toFixed(4);
        return p.toFixed(2);
    };

    const formatVol = (v: number) => {
        if (!Number.isFinite(v)) return '0';
        if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
        if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
        if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
        return v.toFixed(2);
    };

    const isVisible = Boolean(candle && position);

    let isBullish = true;
    let change = 0;
    let percentChange = 0;
    let range = 0;
    let formattedTime = '';

    if (candle) {
        isBullish = candle.close >= candle.open;
        change = candle.close - candle.open;
        percentChange = candle.open > 0 ? (change / candle.open) * 100 : 0;
        range = Math.max(0, candle.high - candle.low);

        const timeMs = candle.time > 1e11 ? candle.time : candle.time * 1000;
        const dateObj = new Date(timeMs);
        const day = dateObj.getUTCDate().toString().padStart(2, '0');
        const month = dateObj.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
        const year = dateObj.getUTCFullYear();
        const hours = dateObj.getUTCHours().toString().padStart(2, '0');
        const minutes = dateObj.getUTCMinutes().toString().padStart(2, '0');
        const seconds = dateObj.getUTCSeconds().toString().padStart(2, '0');
        formattedTime =
            seconds !== '00'
                ? `${day} ${month} ${year}, ${hours}:${minutes}:${seconds} UTC`
                : `${day} ${month} ${year}, ${hours}:${minutes} UTC`;
    }

    const colorClass = isBullish
        ? isDark ? 'text-emerald-400' : 'text-emerald-600'
        : isDark ? 'text-rose-400' : 'text-rose-600';
    const bgColorClass = isBullish ? 'bg-emerald-500/15' : 'bg-rose-500/15';
    const borderColorClass = isBullish
        ? isDark ? 'border-emerald-500/35' : 'border-emerald-500/40'
        : isDark ? 'border-rose-500/35' : 'border-rose-500/40';

    const renderPos = adjustedPos || {
        x: (position?.x || 0) + leftAxisOffset + 16,
        y: (position?.y || 0) + 16,
    };

    const hasOrderflow =
        candle &&
        (candle.delta !== undefined || candle.pocPrice !== undefined || candle.buyPct !== undefined);

    return (
        <AnimatePresence>
            {isVisible && candle && (
                <motion.div
                    key="candlestick-tooltip"
                    ref={tooltipRef}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.12 }}
                    style={{
                        left: renderPos.x,
                        top: renderPos.y,
                    }}
                    className={`absolute z-50 pointer-events-none min-w-[208px] backdrop-blur-xl ${
                        isDark
                            ? 'bg-slate-950/88 text-slate-200 shadow-2xl'
                            : 'bg-white/95 text-slate-800 shadow-xl'
                    } border ${borderColorClass} rounded-xl p-3 flex flex-col gap-2 font-mono text-[11px]`}
                >
                    {/* Header: Date & Time */}
                    <div
                        className={`flex justify-between items-center border-b pb-1.5 ${
                            isDark ? 'border-slate-700/60' : 'border-slate-200'
                        }`}
                    >
                        <span className={`font-semibold tracking-wide text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                            {formattedTime}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold ${bgColorClass} ${colorClass}`}>
                            {isBullish ? 'BULL' : 'BEAR'}
                        </span>
                    </div>

                    {/* OHLCV Metrics */}
                    <div className="flex flex-col gap-1">
                        <div className="flex justify-between gap-6">
                            <span className="text-slate-500">Open</span>
                            <span className="font-medium">{formatPrice(candle.open)}</span>
                        </div>
                        <div className="flex justify-between gap-6">
                            <span className="text-slate-500">High</span>
                            <span className="font-medium">{formatPrice(candle.high)}</span>
                        </div>
                        <div className="flex justify-between gap-6">
                            <span className="text-slate-500">Low</span>
                            <span className="font-medium">{formatPrice(candle.low)}</span>
                        </div>
                        <div className="flex justify-between gap-6">
                            <span className="text-slate-500">Close</span>
                            <span className={`font-semibold ${colorClass}`}>{formatPrice(candle.close)}</span>
                        </div>

                        <div className={`w-full h-px my-1 ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />

                        <div className="flex justify-between gap-6">
                            <span className="text-slate-500">Change</span>
                            <span className={`font-semibold ${colorClass}`}>
                                {change > 0 ? '+' : ''}
                                {formatPrice(change)} ({change > 0 ? '+' : ''}
                                {percentChange.toFixed(2)}%)
                            </span>
                        </div>
                        <div className="flex justify-between gap-6">
                            <span className="text-slate-500">Range</span>
                            <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>{formatPrice(range)}</span>
                        </div>
                        <div className="flex justify-between gap-6">
                            <span className="text-slate-500">Volume</span>
                            <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>{formatVol(candle.volume)}</span>
                        </div>

                        {hasOrderflow && (
                            <>
                                <div className={`w-full h-px my-1 ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
                                {candle.delta !== undefined && (
                                    <div className="flex justify-between gap-6">
                                        <span className="text-slate-500">Delta</span>
                                        <span
                                            className={`font-semibold ${
                                                candle.delta >= 0
                                                    ? isDark ? 'text-emerald-400' : 'text-emerald-600'
                                                    : isDark ? 'text-rose-400' : 'text-rose-600'
                                            }`}
                                        >
                                            {formatCompactOrderflowNumber(candle.delta, true)}
                                            {candle.buyPct !== undefined ? ` (${candle.buyPct.toFixed(0)}% B)` : ''}
                                        </span>
                                    </div>
                                )}
                                {candle.pocPrice !== undefined && candle.pocPrice > 0 && (
                                    <div className="flex justify-between gap-6">
                                        <span className="text-slate-500">Bar POC</span>
                                        <span className={isDark ? 'text-amber-300 font-semibold' : 'text-amber-600 font-semibold'}>
                                            {formatPrice(candle.pocPrice)}
                                        </span>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
