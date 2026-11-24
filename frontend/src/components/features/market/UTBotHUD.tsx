import React, { useState } from 'react';
import { UTBotActiveSetup, UTBotBacktestStats, UTBotSignalGrade } from '../../../utils/utBotPro';

/**
 * Plays a crisp, zero-dependency Web Audio API alert chime for live UT Bot signals.
 */
export const playUTBotSignalSound = (side: 'buy' | 'sell', grade: UTBotSignalGrade): void => {
    if (typeof window === 'undefined') return;
    try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;

        const freqs = side === 'buy'
            ? (grade === 'A+' ? [587.33, 880, 1174.66] : [523.25, 659.25])
            : (grade === 'A+' ? [523.25, 392, 293.66] : [440, 329.63]);

        freqs.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.085);
            gain.gain.setValueAtTime(0.001, now + idx * 0.085);
            gain.gain.exponentialRampToValueAtTime(0.08, now + idx * 0.085 + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.085 + 0.18);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + idx * 0.085);
            osc.stop(now + idx * 0.085 + 0.19);
        });

        setTimeout(() => {
            try { ctx.close(); } catch {}
        }, 600);
    } catch {
        // Ignore browser autoplay restrictions
    }
};

interface UTBotHUDProps {
    visible: boolean;
    marketBias: 'BULLISH' | 'BEARISH' | 'CHOP';
    backtest: UTBotBacktestStats;
    activeSetup: UTBotActiveSetup | null;
    latestAdx: number | null;
    latestRsi: number | null;
    alertsEnabled: boolean;
    isThermalGuard?: boolean;
    isCompactPhone?: boolean;
    formatPrice: (price: number) => string;
    onToggleAlerts: () => void;
    onSyncToBot: () => void;
}

export const UTBotHUD: React.FC<UTBotHUDProps> = ({
    visible,
    marketBias,
    backtest,
    activeSetup,
    latestAdx,
    latestRsi,
    alertsEnabled,
    isThermalGuard = false,
    isCompactPhone = false,
    formatPrice,
    onToggleAlerts,
    onSyncToBot,
}) => {
    const [collapsed, setCollapsed] = useState(false);

    if (!visible) return null;

    const biasBadgeClass =
        marketBias === 'BULLISH'
            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
            : marketBias === 'BEARISH'
                ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';

    const gradeBadgeClass =
        activeSetup?.grade === 'A+'
            ? 'bg-emerald-500 text-white'
            : activeSetup?.grade === 'B'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-500 text-white';

    return (
        <div
            className={`absolute ${isCompactPhone ? 'bottom-14 left-2 max-w-[215px]' : 'bottom-3 left-2 max-w-[270px]'} z-[12] pointer-events-auto select-none rounded-xl border border-slate-200 dark:border-white/10 ${isThermalGuard ? 'bg-white/95 dark:bg-[#090b10]/95' : 'bg-white/90 dark:bg-[#090b10]/85 backdrop-blur-md'} shadow-lg text-slate-800 dark:text-gray-100`}
        >
            {/* Header Bar */}
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-slate-200/70 dark:border-white/10">
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[10px] font-extrabold tracking-wider uppercase text-slate-700 dark:text-gray-200">
                        UT Bot Pro
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${biasBadgeClass}`}>
                        {marketBias}
                    </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <button
                        type="button"
                        onClick={onToggleAlerts}
                        title={alertsEnabled ? 'Mute UT Bot Signal Alerts' : 'Enable UT Bot Sound & Toast Alerts'}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition-colors cursor-pointer ${
                            alertsEnabled
                                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-gray-400 border-transparent hover:border-slate-300 dark:hover:border-white/20'
                        }`}
                    >
                        {alertsEnabled ? '🔔 ON' : '🔕'}
                    </button>
                    <button
                        type="button"
                        onClick={() => setCollapsed(c => !c)}
                        title={collapsed ? 'Expand UT Bot HUD' : 'Minimize UT Bot HUD'}
                        className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-white/10 cursor-pointer"
                    >
                        {collapsed ? '▾' : '▴'}
                    </button>
                </div>
            </div>

            {!collapsed && (
                <div className="p-2 flex flex-col gap-1.5 text-[10px]">
                    {/* Rolling Backtest & Regime Metrics */}
                    <div className="flex items-center justify-between gap-2 font-mono bg-slate-100/80 dark:bg-white/[0.04] px-2 py-1 rounded-md">
                        <div>
                            <span className="text-slate-500 dark:text-gray-400">WR </span>
                            <span className={`font-bold ${backtest.winRate >= 55 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                {backtest.totalTrades > 0 ? `${backtest.winRate}%` : '--'}
                            </span>
                            <span className="text-[9px] text-slate-400 ml-1">
                                ({backtest.wins}W/{backtest.losses}L)
                            </span>
                        </div>
                        <div>
                            <span className="text-slate-500 dark:text-gray-400">Net </span>
                            <span className={`font-bold ${backtest.netR >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {backtest.netR >= 0 ? `+${backtest.netR}R` : `${backtest.netR}R`}
                            </span>
                        </div>
                    </div>

                    {(latestAdx !== null || latestRsi !== null) && (
                        <div className="flex items-center justify-between text-[9px] text-slate-500 dark:text-gray-400 font-mono px-0.5">
                            <span>ADX: <strong className="text-slate-700 dark:text-gray-200">{latestAdx ?? '--'}</strong></span>
                            <span>RSI: <strong className="text-slate-700 dark:text-gray-200">{latestRsi ?? '--'}</strong></span>
                        </div>
                    )}

                    {/* Active Signal Setup */}
                    {activeSetup ? (
                        <div className="flex flex-col gap-1 border-t border-slate-200/70 dark:border-white/10 pt-1.5">
                            <div className="flex items-center justify-between">
                                <span className={`font-extrabold ${activeSetup.side === 'buy' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                    {activeSetup.kind.replace('_', ' ')} {activeSetup.isInvalidated ? '(SL Hit)' : ''}
                                </span>
                                <span className={`px-1.5 py-0.2 rounded text-[9px] font-extrabold ${gradeBadgeClass}`}>
                                    {activeSetup.grade} · {activeSetup.score}
                                </span>
                            </div>
                            <div className="grid grid-cols-3 gap-1 font-mono text-[9px]">
                                <div className="bg-rose-500/10 rounded px-1.5 py-0.5 text-rose-600 dark:text-rose-400">
                                    SL {formatPrice(activeSetup.sl)}
                                </div>
                                <div className="bg-emerald-500/10 rounded px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400">
                                    T1 {formatPrice(activeSetup.tp1)}
                                </div>
                                <div className="bg-emerald-500/10 rounded px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400">
                                    T2 {formatPrice(activeSetup.tp2)}
                                </div>
                            </div>
                            {activeSetup.reasons.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                    {activeSetup.reasons.slice(0, 3).map((r) => (
                                        <span key={r} className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-[8px] font-semibold text-slate-600 dark:text-gray-300">
                                            {r}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="text-[9px] text-slate-400 italic px-0.5">
                            No confirmed signal under active filters.
                        </div>
                    )}

                    {/* Sync to WallHunter Bot */}
                    <button
                        type="button"
                        onClick={onSyncToBot}
                        className="mt-0.5 w-full py-1 px-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-[9.5px] font-bold tracking-wide flex items-center justify-center gap-1 shadow-sm cursor-pointer transition-all"
                    >
                        <span>⚡ Sync UT Settings to WallHunter Bot</span>
                    </button>
                </div>
            )}
        </div>
    );
};
