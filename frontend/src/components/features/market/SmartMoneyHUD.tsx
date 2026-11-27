import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { isThermalGuardActive, subscribeThermalProfile } from '@/utils/deviceProfile';
import type { GodModeState } from '../../../hooks/useGodModeData';

interface SmartTrajectoryData {
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
}

interface SmartMoneyHUDProps {
    data?: SmartTrajectoryData | null;
    godModeData?: GodModeState | null;
    currentPrice: number;
    icebergEvents?: any[];
    magnetZones?: any[];
    visible: boolean;
    symbol?: string;
}

const HUD_POS_STORAGE_KEY = 'cosmo_smart_money_hud_pos_v2';
const VIEWPORT_MARGIN = 8;

export const SmartMoneyHUD: React.FC<SmartMoneyHUDProps> = React.memo(({
    data,
    godModeData,
    currentPrice,
    icebergEvents,
    magnetZones,
    visible,
    symbol
}) => {
    const [isMinimized, setIsMinimized] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [isThermalGuard, setIsThermalGuard] = useState<boolean>(() => isThermalGuardActive());
    const [history, setHistory] = useState<{ ask: number; bid: number }[]>([]);

    const hudRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{
        pointerId: number;
        offsetX: number;
        offsetY: number;
        width: number;
        height: number;
    } | null>(null);

    const clampToViewport = useCallback((x: number, y: number, w?: number, h?: number) => {
        if (typeof window === 'undefined') return { x, y };
        const rect = hudRef.current?.getBoundingClientRect();
        const width = w ?? (rect?.width || Math.min(380, window.innerWidth - VIEWPORT_MARGIN * 2));
        const height = h ?? (rect?.height || (isMinimized ? 52 : 340));
        const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
        const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
        return {
            x: Math.round(Math.max(VIEWPORT_MARGIN, Math.min(x, maxX))),
            y: Math.round(Math.max(VIEWPORT_MARGIN, Math.min(y, maxY))),
        };
    }, [isMinimized]);

    const getInitialPosition = useCallback(() => {
        if (typeof window === 'undefined') return { x: 24, y: 88 };
        const defaultWidth = Math.min(380, window.innerWidth - VIEWPORT_MARGIN * 2);
        const fallback = {
            x: Math.max(VIEWPORT_MARGIN, window.innerWidth - defaultWidth - 76),
            y: 88,
        };
        try {
            const saved = localStorage.getItem(HUD_POS_STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Number.isFinite(Number(parsed?.x)) && Number.isFinite(Number(parsed?.y))) {
                    return clampToViewport(Number(parsed.x), Number(parsed.y), defaultWidth);
                }
            }
        } catch {
            // ignore storage errors
        }
        return clampToViewport(fallback.x, fallback.y, defaultWidth);
    }, [clampToViewport]);

    const [position, setPosition] = useState<{ x: number; y: number }>(() => getInitialPosition());
    const latestPosRef = useRef(position);

    const applyTransform = useCallback((x: number, y: number) => {
        latestPosRef.current = { x, y };
        if (hudRef.current) {
            hudRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        }
    }, []);

    useEffect(() => {
        setMounted(true);
        const unsub = subscribeThermalProfile((profile) => {
            setIsThermalGuard(profile.isThermalGuardActive);
        });
        return () => {
            setMounted(false);
            unsub();
        };
    }, []);

    useEffect(() => {
        setHistory([]);
    }, [symbol]);

    useEffect(() => {
        if (data && data.ask_dominance !== undefined && data.bid_dominance !== undefined) {
            setHistory(prev => {
                const next = [...prev, { ask: data.ask_dominance!, bid: data.bid_dominance! }];
                return next.slice(-40);
            });
        }
    }, [data?.ask_dominance, data?.bid_dominance]);

    // Keep HUD strictly inside visible screen on resize, orientation change, or content/minimize height change
    useEffect(() => {
        if (!visible || !mounted) return;

        const syncClampedPosition = () => {
            const rect = hudRef.current?.getBoundingClientRect();
            if (!rect) return;
            if (dragRef.current) {
                dragRef.current.width = rect.width;
                dragRef.current.height = rect.height;
                return;
            }
            const clamped = clampToViewport(latestPosRef.current.x, latestPosRef.current.y, rect.width, rect.height);
            if (clamped.x !== latestPosRef.current.x || clamped.y !== latestPosRef.current.y) {
                applyTransform(clamped.x, clamped.y);
                setPosition(clamped);
            }
        };

        const rafId = window.requestAnimationFrame(syncClampedPosition);
        window.addEventListener('resize', syncClampedPosition);

        let ro: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined' && hudRef.current) {
            ro = new ResizeObserver(syncClampedPosition);
            ro.observe(hudRef.current);
        }

        return () => {
            window.cancelAnimationFrame(rafId);
            window.removeEventListener('resize', syncClampedPosition);
            ro?.disconnect();
        };
    }, [visible, mounted, isMinimized, clampToViewport, applyTransform]);

    const handleDragPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!hudRef.current) return;
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            // ignore
        }
        const rect = hudRef.current.getBoundingClientRect();
        dragRef.current = {
            pointerId: e.pointerId,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
            width: rect.width,
            height: rect.height,
        };
        setIsDragging(true);
    };

    const handleDragPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        const clamped = clampToViewport(
            e.clientX - drag.offsetX,
            e.clientY - drag.offsetY,
            drag.width,
            drag.height
        );
        applyTransform(clamped.x, clamped.y);
    };

    const handleDragPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        dragRef.current = null;
        try {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
        } catch {
            // ignore
        }
        setIsDragging(false);
        const finalPos = latestPosRef.current;
        setPosition(finalPos);
        try {
            localStorage.setItem(HUD_POS_STORAGE_KEY, JSON.stringify(finalPos));
        } catch {
            // ignore storage errors
        }
    };

    if (!visible || (!data && !godModeData) || !mounted) return null;

    // Formatting helpers
    const formatPrice = (p?: number | null) => {
        const num = Number(p);
        if (p === undefined || p === null || !Number.isFinite(num)) return '0.00';
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 8
        }).format(num);
    };

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

    // Merged God Mode AI Telemetry
    const hasGodModeTelemetry = Boolean(godModeData);
    const painPct = Math.min(100, Math.max(0, Number(godModeData?.pain_threshold?.level ?? 0)));
    const painStatus = String(godModeData?.pain_threshold?.status || 'NORMAL').toUpperCase();
    const isSqueezeImminent = hasGodModeTelemetry && (painPct >= 90 || painStatus === 'CRITICAL' || painStatus === 'EXTREME');

    const smartFlow = godModeData?.smart_money || 0;
    const dumbFlow = godModeData?.dumb_money || 0;
    const totalFlow = smartFlow + dumbFlow;
    const smartRatio = totalFlow > 0 ? (smartFlow / totalFlow) * 100 : 50;

    const rawSpoof = String(godModeData?.cvd_spoof || 'NEUTRAL').toUpperCase();
    const isHighSpoof = rawSpoof.includes('HIGH') || rawSpoof.includes('DETECTED');
    const isMediumSpoof = rawSpoof.includes('MEDIUM');
    const spoofLabel = isHighSpoof ? 'HIGH RISK' : isMediumSpoof ? 'MEDIUM' : 'Normal';

    const effectiveFunding = data?.funding_rate ?? godModeData?.funding_rate ?? 0;
    const isLongBias = effectiveFunding < -0.0001;
    const isShortBias = effectiveFunding > 0.0001;
    const biasText = isLongBias ? "BULLISH BIAS (1.5x Asks)" : isShortBias ? "BEARISH BIAS (1.5x Bids)" : "NEUTRAL";
    const biasColor = isLongBias ? "text-emerald-600 dark:text-emerald-400" : isShortBias ? "text-rose-600 dark:text-rose-400" : "text-slate-500 dark:text-gray-400";

    const direction = data?.direction ?? 'NEUTRAL';
    const glowShadow = direction === 'UP' ? 'shadow-lg dark:shadow-[0_0_50px_-12px_rgba(16,185,129,0.3)]' :
                       direction === 'DOWN' ? 'shadow-lg dark:shadow-[0_0_50px_-12px_rgba(244,63,94,0.3)]' :
                       'shadow-lg dark:shadow-[0_0_30px_rgba(0,0,0,0.8)]';

    const dirColor = direction === 'UP' ? 'text-emerald-600 dark:text-emerald-400' :
                     direction === 'DOWN' ? 'text-rose-600 dark:text-rose-400' :
                     'text-slate-500 dark:text-gray-400';

    // Divergence Logic (Trap Detection)
    const isBullTrap = Boolean(data && data.direction === 'UP' && (data.raw_ask_force || 0) < (data.raw_bid_force || 0) * 0.9);
    const isBearTrap = Boolean(data && data.direction === 'DOWN' && (data.raw_bid_force || 0) < (data.raw_ask_force || 0) * 0.9);

    // Sparkline paths
    const maxPoints = 40;
    const askPath = history.map((h, i) => `${(i / (maxPoints - 1)) * 100},${100 - h.ask * 100}`).join(' ');
    const bidPath = history.map((h, i) => `${(i / (maxPoints - 1)) * 100},${100 - h.bid * 100}`).join(' ');
    const askFillPath = `${askPath} 100,100 0,100`;
    const bidFillPath = `${bidPath} 100,100 0,100`;

    // Squeeze Probability
    const squeezeProb = Math.min(Math.abs(effectiveFunding) * 10000, 99);
    const isShortSqueeze = effectiveFunding < 0;

    // Magnet Radar
    const magnets = magnetZones ? [...magnetZones].sort((a, b) => b.intensity - a.intensity).slice(0, 3) : [];
    const pulseAnimClass = isThermalGuard ? '' : 'animate-pulse';

    const hudContent = (
        <div
            ref={hudRef}
            style={{
                left: 0,
                top: 0,
                transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
            }}
            className={`fixed z-[9999] flex flex-col pointer-events-auto cosmo-gpu-drawer w-[340px] sm:w-[380px] max-w-[calc(100vw-16px)] ${isDragging ? 'select-none' : ''}`}
        >
            <div className={`${isThermalGuard ? 'bg-white/95 dark:bg-slate-950/95' : 'bg-white/95 dark:bg-black/75 backdrop-blur-xl'} border ${isDragging ? 'border-cyan-500/60' : 'border-slate-200 dark:border-white/20'} rounded-2xl overflow-hidden ${glowShadow} font-mono text-sm pointer-events-auto ${isThermalGuard || isDragging ? '' : 'transition-shadow duration-300'}`}>
                {/* Header (Strictly Bounded Touch + Mouse Drag Handle) */}
                <div
                    onPointerDown={handleDragPointerDown}
                    onPointerMove={handleDragPointerMove}
                    onPointerUp={handleDragPointerEnd}
                    onPointerCancel={handleDragPointerEnd}
                    onContextMenu={(e) => e.preventDefault()}
                    onDoubleClick={() => setIsMinimized(!isMinimized)}
                    style={{ touchAction: 'none' }}
                    className={`flex justify-between items-center px-4 py-2.5 bg-gradient-to-r from-slate-100 to-slate-50 dark:from-gray-900/95 dark:to-gray-800/95 border-b border-slate-200 dark:border-white/20 select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                    title="Drag to reposition within screen"
                >
                    <div className="flex items-center gap-2 min-w-0 pointer-events-none">
                        <div className={`w-2 h-2 rounded-full bg-blue-500 shrink-0 ${pulseAnimClass}`}></div>
                        <span className="font-bold text-slate-900 dark:text-gray-100 tracking-wider text-xs sm:text-sm truncate">SMART MONEY HUD</span>
                        {hasGodModeTelemetry && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-[9px] font-bold text-indigo-600 dark:text-indigo-300 uppercase tracking-wider shrink-0">
                                GOD AI · {isThermalGuard ? 'ECO' : 'LIVE'}
                            </span>
                        )}
                    </div>
                    <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setIsMinimized(!isMinimized)}
                        aria-label={isMinimized ? 'Expand Smart Money HUD' : 'Minimize Smart Money HUD'}
                        className="text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer z-10 px-2 py-1 rounded-md hover:bg-slate-200/60 dark:hover:bg-white/10 shrink-0"
                    >
                        {isMinimized ? '▼' : '▲'}
                    </button>
                </div>

                {/* Body */}
                {!isMinimized && (
                    <div className="p-4 space-y-4 max-h-[70dvh] overflow-y-auto custom-scrollbar touch-pan-y overscroll-y-contain">
                        {/* God Mode AI Squeeze Imminent Alert */}
                        {isSqueezeImminent && (
                            <div className="bg-red-600/20 border border-red-500/50 rounded-xl px-3.5 py-2.5 shadow-[0_0_20px_rgba(239,68,68,0.28)]">
                                <h3 className="text-red-500 dark:text-red-400 font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2">
                                    <span>🔥</span>
                                    Squeeze Imminent
                                    <span>🔥</span>
                                </h3>
                                <p className="text-center text-red-700 dark:text-red-200/80 text-[10px] font-mono mt-0.5">
                                    Pain Threshold: {painPct}%
                                </p>
                            </div>
                        )}

                        {/* Divergence Alert */}
                        {(isBullTrap || isBearTrap) && (
                            <div
                                className={`px-3 py-2 rounded-lg ${pulseAnimClass} text-center font-bold text-xs uppercase tracking-widest shadow-sm ${isBullTrap ? 'bg-rose-500/15 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/40 dark:border-rose-500/50' : 'bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 dark:border-emerald-500/50'}`}
                            >
                                <span className="mr-1.5 text-sm">⚠️</span>
                                {isBullTrap ? 'BULL TRAP DETECTED - FAKEOUT' : 'BEAR TRAP DETECTED - FAKEOUT'}
                            </div>
                        )}

                        {/* Merged God Mode AI Section (Pain Threshold, Smart vs Dumb Flow, Spoof Rating, OI/Whale) */}
                        {hasGodModeTelemetry && (
                            <div className="bg-slate-50 dark:bg-white/[0.04] p-3.5 rounded-xl border border-slate-200 dark:border-white/10 space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-300 uppercase tracking-widest flex items-center gap-1.5">
                                        <svg className="w-3.5 h-3.5 text-brand-primary" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z" /></svg>
                                        God Mode AI Telemetry
                                    </span>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isHighSpoof ? 'bg-red-500/20 text-red-600 dark:text-red-400' : isMediumSpoof ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' : 'bg-gray-200 dark:bg-gray-500/20 text-gray-700 dark:text-gray-300'}`}>
                                        Spoof: {spoofLabel}
                                    </span>
                                </div>

                                {/* Pain Threshold */}
                                <div>
                                    <div className="flex justify-between items-end mb-1">
                                        <span className="text-[10px] text-slate-600 dark:text-gray-400 font-semibold uppercase">Pain Threshold</span>
                                        <span className={`text-xs font-bold font-mono ${painPct > 80 ? 'text-red-500' : 'text-slate-800 dark:text-gray-200'}`}>
                                            {painPct}%
                                        </span>
                                    </div>
                                    <div className="w-full bg-slate-200 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-[width] duration-500 ${painPct > 80 ? 'bg-gradient-to-r from-orange-500 to-red-500' : 'bg-gradient-to-r from-blue-500 to-indigo-500'}`}
                                            style={{ width: `${painPct}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Smart vs Dumb Flow */}
                                <div>
                                    <div className="flex justify-between items-end mb-1">
                                        <span className="text-[10px] text-slate-600 dark:text-gray-400 font-semibold uppercase">Smart vs Dumb Flow</span>
                                    </div>
                                    <div className="relative w-full bg-slate-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden flex">
                                        <div
                                            className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-[width] duration-500"
                                            style={{ width: `${smartRatio}%` }}
                                        />
                                        <div
                                            className="h-full bg-gradient-to-r from-red-500 to-orange-400 flex-1"
                                        />
                                    </div>
                                    <div className="flex justify-between mt-1 px-0.5">
                                        <span className="text-[9px] font-mono text-green-600 dark:text-green-400 font-bold">Smart ({smartRatio.toFixed(1)}%)</span>
                                        <span className="text-[9px] font-mono text-red-600 dark:text-red-400 font-bold">Dumb ({(100 - smartRatio).toFixed(1)}%)</span>
                                    </div>
                                </div>

                                {/* Open Interest & Adaptive Whale Threshold */}
                                {(Boolean(godModeData?.open_interest_usd) || Boolean(godModeData?.adaptive_thresholds?.whale_usd)) && (
                                    <div className="pt-2 border-t border-slate-200/80 dark:border-white/5 flex justify-between items-center text-[10px] font-mono text-slate-500 dark:text-gray-400">
                                        <span>
                                            OI: {godModeData?.open_interest_usd ? `$${(godModeData.open_interest_usd / 1_000_000_000 >= 1 ? (godModeData.open_interest_usd / 1_000_000_000).toFixed(2) + 'B' : (godModeData.open_interest_usd / 1_000_000).toFixed(0) + 'M')}` : '--'}
                                        </span>
                                        <span>
                                            Whale ≥ ${godModeData?.adaptive_thresholds?.whale_usd ? `${Math.round(godModeData.adaptive_thresholds.whale_usd / 1000)}k` : '100k'}
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}

                        {data && (
                            <>
                                {/* Target & Direction */}
                                <div className="flex justify-between items-center bg-slate-50 dark:bg-black/50 p-3.5 rounded-xl border border-slate-200 dark:border-white/10 shadow-inner">
                                    <div>
                                        <div className="text-slate-500 dark:text-gray-500 text-xs uppercase font-semibold tracking-wider">AI Target</div>
                                        <div className={`text-2xl sm:text-3xl font-black ${dirColor} mt-1`}>
                                            ${formatPrice(data.target_price)}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-slate-500 dark:text-gray-500 text-xs uppercase font-semibold tracking-wider">Direction</div>
                                        <div className={`text-xl sm:text-2xl font-black tracking-widest ${dirColor} mt-1 flex items-center justify-end gap-2`}>
                                            {data.direction}
                                            <span className="text-2xl sm:text-3xl leading-none">
                                                {data.direction === 'UP' ? '▲' : data.direction === 'DOWN' ? '▼' : '●'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Liquidity Dominance (EMA Smoothed) */}
                                <div className="space-y-1.5">
                                    <div className="flex justify-between text-xs text-slate-500 dark:text-gray-400 uppercase font-semibold">
                                        <span>Bulls (Ask Force)</span>
                                        <span>Bears (Bid Force)</span>
                                    </div>
                                    <div className="flex justify-between font-black text-base sm:text-lg">
                                        <span className="text-emerald-600 dark:text-emerald-400">{formatPct(data.ask_dominance)}</span>
                                        <span className="text-rose-600 dark:text-rose-400">{formatPct(data.bid_dominance)}</span>
                                    </div>
                                    <div className="relative h-3 w-full bg-slate-200 dark:bg-gray-900 rounded-full overflow-hidden flex shadow-inner mt-2">
                                        <div className="absolute top-0 bottom-0 left-[48%] w-[2px] bg-slate-700/40 dark:bg-white/30 z-10"></div>
                                        <div className="absolute top-0 bottom-0 left-[52%] w-[2px] bg-slate-700/40 dark:bg-white/30 z-10"></div>

                                        <div
                                            className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-[width] duration-300"
                                            style={{ width: `${(data.ask_dominance || 0.5) * 100}%` }}
                                        />
                                        <div
                                            className="h-full bg-gradient-to-l from-rose-600 to-rose-400 flex-1"
                                        />
                                    </div>
                                    <div className="relative h-2 w-full mt-1">
                                        <div className="absolute top-0 left-[48%] -translate-x-1/2 text-[9px] font-bold text-slate-500 dark:text-gray-500">48</div>
                                        <div className="absolute top-0 left-[52%] -translate-x-1/2 text-[9px] font-bold text-slate-500 dark:text-gray-500">52</div>
                                    </div>
                                    <div className="flex justify-between text-xs font-bold text-slate-500 dark:text-gray-500 pt-2">
                                        <span>{formatForce(data.smoothed_ask_force)} EMA</span>
                                        <span>{formatForce(data.smoothed_bid_force)} EMA</span>
                                    </div>

                                    {/* Momentum Sparkline */}
                                    <div className="relative h-10 w-full mt-2 border-b border-slate-200 dark:border-white/10">
                                        <svg className="w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
                                            <defs>
                                                <linearGradient id="askGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor="#34D399" stopOpacity="0.3" />
                                                    <stop offset="100%" stopColor="#34D399" stopOpacity="0.0" />
                                                </linearGradient>
                                                <linearGradient id="bidGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor="#F43F5E" stopOpacity="0.3" />
                                                    <stop offset="100%" stopColor="#F43F5E" stopOpacity="0.0" />
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
                                <div className="grid grid-cols-2 gap-3 bg-slate-50 dark:bg-black/40 p-3 rounded-xl border border-slate-200 dark:border-white/5">
                                    <div className="space-y-1">
                                        <div className="text-slate-500 dark:text-gray-500 text-[10px] uppercase font-bold tracking-widest">Raw Bull Force</div>
                                        <div className="text-emerald-600 dark:text-emerald-400/90 font-black text-base sm:text-lg pb-1">{formatForce(data.raw_ask_force)}</div>
                                        <div className="text-slate-500 dark:text-gray-500 text-[10px] uppercase font-bold tracking-widest">Ask Liquidity</div>
                                        <div className="text-emerald-600/80 dark:text-emerald-400/70 text-xs sm:text-sm font-semibold">${((data.total_asks_liquidity || 0) / 1000000).toFixed(2)}M</div>
                                    </div>
                                    <div className="text-right space-y-1">
                                        <div className="text-slate-500 dark:text-gray-500 text-[10px] uppercase font-bold tracking-widest">Raw Bear Force</div>
                                        <div className="text-rose-600 dark:text-rose-400/90 font-black text-base sm:text-lg pb-1">{formatForce(data.raw_bid_force)}</div>
                                        <div className="text-slate-500 dark:text-gray-500 text-[10px] uppercase font-bold tracking-widest">Bid Liquidity</div>
                                        <div className="text-rose-600/80 dark:text-rose-400/70 text-xs sm:text-sm font-semibold">${((data.total_bids_liquidity || 0) / 1000000).toFixed(2)}M</div>
                                    </div>
                                </div>

                                {/* Market Sentiment & Squeeze */}
                                <div className="pt-3 border-t border-slate-200 dark:border-white/10 space-y-2.5">
                                    <div className="flex justify-between items-center">
                                        <span className="text-slate-500 dark:text-gray-400 text-xs uppercase font-bold tracking-wider">Retail Funding</span>
                                        <span className="text-slate-900 dark:text-gray-100 font-mono text-xs sm:text-sm bg-slate-100 dark:bg-white/10 px-2 py-0.5 rounded">{formatFunding(effectiveFunding)}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-slate-500 dark:text-gray-400 text-xs uppercase font-bold tracking-wider">Smart Bias</span>
                                        <span className={`font-black text-[11px] sm:text-xs px-2 py-0.5 rounded border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-black/50 ${biasColor}`}>{biasText}</span>
                                    </div>

                                    {squeezeProb > 20 && (
                                        <div className="pt-1">
                                            <div className="flex justify-between text-[10px] font-black uppercase mb-1.5 tracking-wider">
                                                <span className={isShortSqueeze ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                                                    {isShortSqueeze ? '🚀 SHORT SQUEEZE PROBABILITY' : '🩸 LONG SQUEEZE PROBABILITY'}
                                                </span>
                                                <span className="text-slate-900 dark:text-white bg-slate-200 dark:bg-black/60 px-1 rounded">{squeezeProb.toFixed(0)}%</span>
                                            </div>
                                            <div className="w-full bg-slate-200 dark:bg-black/80 h-2.5 rounded-full overflow-hidden border border-slate-300 dark:border-white/5">
                                                <div
                                                    className={`h-full ${isShortSqueeze ? 'bg-gradient-to-r from-emerald-600 to-emerald-400' : 'bg-gradient-to-r from-rose-600 to-rose-400'}`}
                                                    style={{ width: `${squeezeProb}%` }}
                                                ></div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}

                        {/* Liquidation Magnet Radar */}
                        {magnets.length > 0 && (
                            <div className="pt-3 border-t border-slate-200 dark:border-white/10">
                                <div className="text-xs text-slate-500 dark:text-gray-400 uppercase font-black tracking-widest mb-2 flex items-center gap-2">
                                    <span className={`${pulseAnimClass} text-sm`}>🧲</span> CLOSEST MAGNETS
                                </div>
                                <div className="space-y-1.5">
                                    {magnets.map((mag, i) => {
                                        const dist = currentPrice > 0 ? Math.abs(((mag.price - currentPrice) / currentPrice) * 100) : 0;
                                        return (
                                            <div key={i} className="flex justify-between items-center text-xs bg-slate-50 dark:bg-gradient-to-r dark:from-black/60 dark:to-black/30 p-2 rounded-md border-l-4 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors" style={{ borderLeftColor: mag.price > currentPrice ? '#10B981' : '#F43F5E' }}>
                                                <span className="text-slate-900 dark:text-gray-200 font-black tracking-wider">${formatPrice(mag.price)}</span>
                                                <span className="text-slate-500 dark:text-gray-400 font-mono text-[10px] bg-slate-200/80 dark:bg-black/40 px-1.5 py-0.5 rounded">{dist.toFixed(2)}% AWAY</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Whale Order Feed */}
                        {icebergEvents && icebergEvents.length > 0 && (
                            <div className="pt-3 border-t border-slate-200 dark:border-white/10">
                                <div className="text-xs text-slate-500 dark:text-gray-400 uppercase font-black tracking-widest mb-2 flex items-center gap-2">
                                    <span className={`${pulseAnimClass} text-sm`}>🐋</span> LIVE WHALE FEED
                                </div>
                                <div className="space-y-1.5 max-h-24 overflow-y-auto custom-scrollbar pr-2">
                                    {icebergEvents.slice(0, 4).map((ev, i) => {
                                        const isBull = ev.type === 'buy' || String(ev.type || '').toUpperCase().includes('BULLISH');
                                        const volUsd = Number(ev.absorbed_volume ?? ev.volume ?? 0);
                                        const formattedVol = volUsd >= 1_000_000
                                            ? `$${(volUsd / 1_000_000).toFixed(2)}M`
                                            : volUsd >= 1_000
                                                ? `$${(volUsd / 1_000).toFixed(0)}k`
                                                : `$${volUsd.toFixed(0)}`;
                                        return (
                                            <div key={i} className="text-xs flex justify-between items-center bg-slate-50 dark:bg-black/40 p-2 rounded-md hover:bg-slate-100 dark:hover:bg-white/5 transition-colors border border-slate-200 dark:border-white/5">
                                                <span className={`font-black tracking-widest px-1.5 py-0.5 rounded ${isBull ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' : 'text-rose-600 dark:text-rose-400 bg-rose-500/10'}`}>
                                                    {isBull ? 'BUY ABS' : 'SELL ABS'}
                                                </span>
                                                <span className="text-slate-900 dark:text-gray-200 font-mono">
                                                    <span className="font-bold">{formattedVol}</span>
                                                    <span className="text-slate-400 dark:text-gray-600 mx-1">@</span>
                                                    <span className="text-slate-600 dark:text-gray-400">${formatPrice(ev.price)}</span>
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );

    return createPortal(hudContent, document.body);
});
