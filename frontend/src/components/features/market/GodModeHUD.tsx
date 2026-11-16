import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { GodModeState } from '../../../hooks/useGodModeData';
import { isThermalGuardActive, subscribeThermalProfile } from '@/utils/deviceProfile';

interface GodModeHUDProps {
    data: GodModeState | null;
    visible: boolean;
}

export const GodModeHUD: React.FC<GodModeHUDProps> = ({ data, visible }) => {
    const [position, setPosition] = useState({ x: 20, y: 80 });
    const [isDragging, setIsDragging] = useState(false);
    const [isThermalGuard, setIsThermalGuard] = useState<boolean>(() => isThermalGuardActive());
    const dragRef = useRef<{ startX: number; startY: number; initX: number; initY: number } | null>(null);

    useEffect(() => {
        return subscribeThermalProfile((profile) => {
            setIsThermalGuard(profile.isThermalGuardActive);
        });
    }, []);

    const onPointerDown = (e: React.PointerEvent) => {
        setIsDragging(true);
        dragRef.current = { startX: e.clientX, startY: e.clientY, initX: position.x, initY: position.y };
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!isDragging || !dragRef.current) return;
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        const maxX = typeof window !== 'undefined' ? Math.max(0, window.innerWidth - 264) : 9999;
        const maxY = typeof window !== 'undefined' ? Math.max(0, window.innerHeight - 160) : 9999;
        setPosition({
            x: Math.max(0, Math.min(maxX, dragRef.current.initX + dx)),
            y: Math.max(0, Math.min(maxY, dragRef.current.initY + dy)),
        });
    };

    const onPointerUp = (e: React.PointerEvent) => {
        setIsDragging(false);
        dragRef.current = null;
        try {
            e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {}
    };

    if (!visible || !data) return null;

    const { pain_threshold, smart_money, dumb_money, cvd_spoof } = data;
    
    // Normalize Smart vs Dumb UI
    const smart = smart_money || 0;
    const dumb = dumb_money || 0;
    const totalMoney = smart + dumb;
    const smartRatio = totalMoney > 0 ? (smart / totalMoney) * 100 : 50;

    // Backend provides level (0-100%), status ('NORMAL' | 'HIGH' | 'EXTREME'), and value (USD)
    const painPct = Math.min(100, Math.max(0, Number(pain_threshold?.level ?? 0)));
    const painStatus = String(pain_threshold?.status || 'NORMAL').toUpperCase();
    const isSqueezeImminent = painPct >= 90 || painStatus === 'CRITICAL' || painStatus === 'EXTREME';

    const rawSpoof = String(cvd_spoof || 'NEUTRAL').toUpperCase();
    const isHighSpoof = rawSpoof.includes('HIGH') || rawSpoof.includes('DETECTED');
    const isMediumSpoof = rawSpoof.includes('MEDIUM');
    const spoofLabel = isHighSpoof ? 'HIGH RISK' : isMediumSpoof ? 'MEDIUM' : 'Normal';

    const content = (
        <div 
            className="fixed z-[9999] flex flex-col gap-3 pointer-events-auto"
            style={{ left: position.x, top: position.y }}
        >
            {/* SQUEEZE ALERT */}
            {isSqueezeImminent && (
                <div className={`bg-red-600/20 border border-red-500/50 ${isThermalGuard ? 'bg-red-950/90' : 'backdrop-blur-md animate-pulse'} rounded-lg px-4 py-2 shadow-[0_0_20px_rgba(239,68,68,0.4)] cursor-default`}>
                    <h3 className="text-red-400 font-black text-sm uppercase tracking-widest flex items-center gap-2">
                        <span className="text-lg">🔥</span>
                        Squeeze Imminent 
                        <span className="text-lg">🔥</span>
                    </h3>
                    <p className="text-red-200/80 text-[10px] font-mono mt-0.5">Pain Threshold: {painPct}%</p>
                </div>
            )}

            {/* MAIN HUD */}
            <div 
                className={`w-64 ${isThermalGuard ? 'bg-white/95 dark:bg-slate-950/95' : 'bg-white/95 dark:bg-black/60 backdrop-blur-xl'} border border-gray-200 dark:border-white/10 rounded-xl p-3 shadow-2xl ${isThermalGuard ? '' : 'transition-all'} ${isDragging ? 'cursor-grabbing scale-105 border-brand-primary/50' : 'cursor-grab'} select-none`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
            >
                <div className="flex items-center justify-between mb-3 pointer-events-none">
                    <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 text-brand-primary" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/></svg>
                        God Mode AI
                    </h4>
                    <span className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full bg-green-500 ${isThermalGuard ? '' : 'animate-pulse'}`}></span>
                        <span className="text-[9px] text-green-600 dark:text-green-400 font-mono tracking-wider font-bold">
                            {isThermalGuard ? 'ECO' : 'LIVE'}
                        </span>
                    </span>
                </div>

                {/* PAIN THRESHOLD METER */}
                <div className="mb-3">
                    <div className="flex justify-between items-end mb-1">
                        <span className="text-[10px] text-gray-600 dark:text-gray-400 font-semibold uppercase">Pain Threshold</span>
                        <span className={`text-xs font-bold font-mono ${painPct > 80 ? 'text-red-500' : 'text-gray-800 dark:text-gray-200'}`}>
                            {painPct}%
                        </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
                        <div 
                            className={`h-full rounded-full transition-all duration-1000 ${painPct > 80 ? 'bg-gradient-to-r from-orange-500 to-red-500' : 'bg-gradient-to-r from-blue-500 to-indigo-500'}`}
                            style={{ width: `${painPct}%` }}
                        />
                    </div>
                </div>

                {/* SMART VS DUMB MONEY */}
                <div className="mb-3">
                    <div className="flex justify-between items-end mb-1">
                        <span className="text-[10px] text-gray-600 dark:text-gray-400 font-semibold uppercase">Smart vs Dumb Flow</span>
                    </div>
                    <div className="relative w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden flex">
                        <div 
                            className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-1000 relative"
                            style={{ width: `${smartRatio}%` }}
                        />
                        <div 
                            className="h-full bg-gradient-to-r from-red-500 to-orange-400 transition-all duration-1000 relative"
                            style={{ width: `${100 - smartRatio}%` }}
                        />
                    </div>
                    <div className="flex justify-between mt-1 px-0.5">
                        <span className="text-[9px] font-mono text-green-600 dark:text-green-400 font-bold">Smart ({(smartRatio).toFixed(1)}%)</span>
                        <span className="text-[9px] font-mono text-red-600 dark:text-red-400 font-bold">Dumb ({(100 - smartRatio).toFixed(1)}%)</span>
                    </div>
                </div>

                {/* CVD SPOOF STATUS */}
                <div className="bg-gray-100 dark:bg-white/5 rounded-lg p-2 flex justify-between items-center border border-gray-200 dark:border-white/5">
                    <span className="text-[10px] text-gray-600 dark:text-gray-400 font-semibold uppercase">Spoof Rating</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isHighSpoof ? 'bg-red-500/20 text-red-600 dark:text-red-400' : isMediumSpoof ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' : 'bg-gray-200 dark:bg-gray-500/20 text-gray-700 dark:text-gray-300'}`}>
                        {spoofLabel}
                    </span>
                </div>

                {/* OPEN INTEREST & ADAPTIVE THRESHOLD INFO */}
                {(Boolean(data.open_interest_usd) || Boolean(data.adaptive_thresholds?.whale_usd)) && (
                    <div className="mt-2 pt-2 border-t border-gray-200/70 dark:border-white/5 flex justify-between items-center text-[9px] font-mono text-gray-500 dark:text-gray-400">
                        <span>
                            OI: {data.open_interest_usd ? `$${(data.open_interest_usd / 1_000_000_000 >= 1 ? (data.open_interest_usd / 1_000_000_000).toFixed(2) + 'B' : (data.open_interest_usd / 1_000_000).toFixed(0) + 'M')}` : '--'}
                        </span>
                        <span>
                            Whale ≥ ${data.adaptive_thresholds?.whale_usd ? `${Math.round(data.adaptive_thresholds.whale_usd / 1000)}k` : '100k'}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );

    return typeof window !== 'undefined' ? createPortal(content, document.body) : null;
};
