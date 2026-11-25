import React, { useState, useEffect, useMemo } from 'react';
import { Skull, TrendingUp, Activity, Layers, Plus, ShieldAlert, AlertTriangle, Wallet } from 'lucide-react';
import AnimatedNumber from '@/components/common/AnimatedNumber';
import { systemService } from '@/services/systemService';
import { botService } from '@/services/botService';
import { useToast } from '@/context/ToastContext';
import type { ActiveBot } from '@/types';

interface BotLabHeaderProps {
    bots: ActiveBot[];
    stats: {
        total_pnl: number;
        average_win_rate: number;
        active_bots: number;
        total_bots: number;
    };
    onOpenCreate: () => void;
    onFleetChanged?: () => void;
}

const BotLabHeader: React.FC<BotLabHeaderProps> = ({ bots, stats, onOpenCreate, onFleetChanged }) => {
    const { showToast } = useToast();
    const [killSwitchActive, setKillSwitchActive] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isPanicLosing, setIsPanicLosing] = useState(false);
    const [liquidateOnPanic, setLiquidateOnPanic] = useState(false);

    useEffect(() => {
        systemService.getKillSwitchStatus().then((data) => setKillSwitchActive(Boolean(data?.active))).catch(() => {});
    }, []);

    const fleetMetrics = useMemo(() => {
        const activeList = bots.filter((b) => b.status === 'active');
        const activeCapital = activeList.reduce((acc, b) => acc + Number(b.trade_value ?? b.tradeValue ?? 0), 0);
        const liveCount = bots.filter((b) => b.is_paper_trading === false).length;
        const paperCount = bots.length - liveCount;
        const winningCount = bots.filter((b) => (b.pnl || 0) > 0).length;
        const losingActiveCount = activeList.filter((b) => (b.pnl || 0) < 0).length;
        return { activeCapital, liveCount, paperCount, winningCount, losingActiveCount };
    }, [bots]);

    const toggleKillSwitch = async () => {
        if (!killSwitchActive) {
            const msg = liquidateOnPanic
                ? 'EMERGENCY HALT: Stop ALL bots and MARKET-LIQUIDATE open positions?'
                : 'EMERGENCY HALT: Stop ALL active bots immediately?';
            if (!window.confirm(msg)) return;
        }
        setIsLoading(true);
        try {
            if (!killSwitchActive) {
                await botService.panicStop('all', undefined, liquidateOnPanic).catch(() => null);
            }
            const data = await systemService.toggleKillSwitch(!killSwitchActive);
            setKillSwitchActive(Boolean(data.active));
            showToast(data.active ? 'KILL SWITCH ACTIVATED — All bots halted.' : 'Kill switch disarmed.', data.active ? 'error' : 'success');
            onFleetChanged?.();
        } catch {
            showToast('Failed to toggle kill switch', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleStopLosingBots = async () => {
        if (fleetMetrics.losingActiveCount === 0) {
            showToast('No active losing bots to stop.', 'info');
            return;
        }
        const msg = `Stop ${fleetMetrics.losingActiveCount} active losing bot(s)${liquidateOnPanic ? ' and liquidate their positions' : ''}?`;
        if (!window.confirm(msg)) return;

        setIsPanicLosing(true);
        try {
            const res = await botService.panicStop('losing', undefined, liquidateOnPanic);
            showToast(res.message || `Stopped ${res.stopped_count} losing bots`, 'info');
            onFleetChanged?.();
        } catch (err: any) {
            showToast(err?.response?.data?.detail || 'Panic stop failed', 'error');
        } finally {
            setIsPanicLosing(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                {/* Total Fleet PnL */}
                <div className="col-span-2 lg:col-span-1 bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-700 rounded-xl p-4 text-white relative overflow-hidden">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-100 mb-1">Fleet Net PnL</p>
                    <div className="text-2xl font-bold font-mono tabular-nums">
                        {stats.total_pnl >= 0 ? '+' : '-'}<AnimatedNumber value={Math.abs(stats.total_pnl)} prefix="$" />
                    </div>
                    <p className="text-[10px] text-indigo-100/80 font-mono mt-1">
                        {fleetMetrics.winningCount} profitable / {bots.length} loaded
                    </p>
                    <TrendingUp className="absolute right-[-8px] bottom-[-8px] w-16 h-16 text-white/10 rotate-[-10deg]" />
                </div>

                {/* Active Units */}
                <div className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-xl p-4 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                        <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Active Units</p>
                        <Activity size={14} className="text-emerald-500" />
                    </div>
                    <div className="flex items-baseline gap-1.5 mt-1 font-mono">
                        <span className="text-2xl font-bold text-slate-900 dark:text-white">{stats.active_bots}</span>
                        <span className="text-xs text-slate-500">/ {stats.total_bots}</span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-[#161616] rounded-full h-1.5 mt-2 overflow-hidden">
                        <div
                            className="bg-emerald-500 h-full rounded-full transition-all duration-700"
                            style={{ width: `${(stats.active_bots / (stats.total_bots || 1)) * 100}%` }}
                        />
                    </div>
                </div>

                {/* Deployed Capital */}
                <div className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-xl p-4 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                        <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Active Exposure</p>
                        <Wallet size={14} className="text-blue-400" />
                    </div>
                    <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                        ${fleetMetrics.activeCapital.toLocaleString()}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-mono mt-1">
                        <span className="text-emerald-500 font-bold">{fleetMetrics.liveCount} LIVE</span>
                        <span className="text-slate-600">•</span>
                        <span className="text-amber-400 font-bold">{fleetMetrics.paperCount} PAPER</span>
                    </div>
                </div>

                {/* Fleet Win Rate */}
                <div className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-xl p-4 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                        <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Avg Win Rate</p>
                        <Layers size={14} className="text-cyan-500" />
                    </div>
                    <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                        {stats.average_win_rate.toFixed(1)}%
                    </div>
                    <p className="text-[10px] text-slate-500 font-mono mt-1">Across fleet trades</p>
                </div>

                {/* Granular Panic: Stop Losing Bots */}
                <div className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-xl p-3 flex flex-col justify-between gap-2">
                    <button
                        onClick={handleStopLosingBots}
                        disabled={isPanicLosing}
                        className="w-full flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[11px] font-bold transition-colors disabled:opacity-50"
                    >
                        <AlertTriangle size={13} />
                        {isPanicLosing ? 'Halting...' : `Stop Losing (${fleetMetrics.losingActiveCount})`}
                    </button>
                    <label className="flex items-center gap-1.5 text-[10px] text-slate-500 cursor-pointer select-none px-1">
                        <input
                            type="checkbox"
                            checked={liquidateOnPanic}
                            onChange={(e) => setLiquidateOnPanic(e.target.checked)}
                            className="accent-rose-500"
                        />
                        Liquidate positions on panic
                    </label>
                </div>

                {/* Global Kill Switch + Quick Deploy */}
                <div className="grid grid-cols-2 gap-2">
                    <button
                        onClick={toggleKillSwitch}
                        disabled={isLoading}
                        className={`rounded-xl p-3 border flex flex-col items-center justify-center text-center transition-all ${
                            killSwitchActive
                                ? 'bg-rose-600 border-rose-500 text-white animate-pulse'
                                : 'bg-white dark:bg-[#0A0A0A] border-slate-200 dark:border-[#1F1F1F] hover:border-rose-500/60 hover:bg-rose-500/10 text-rose-500'
                        }`}
                        title="Emergency Kill Switch"
                    >
                        <Skull size={18} className="mb-1" />
                        <span className="text-[10px] font-bold uppercase tracking-wider leading-tight">
                            {isLoading ? '...' : killSwitchActive ? 'HALTED' : 'Kill All'}
                        </span>
                    </button>

                    <button
                        onClick={onOpenCreate}
                        className="rounded-xl p-3 border border-dashed border-slate-300 dark:border-[#262626] hover:border-brand-primary bg-white dark:bg-[#0A0A0A] hover:bg-brand-primary/10 flex flex-col items-center justify-center text-center transition-all text-brand-primary"
                        title="Deploy New Bot"
                    >
                        <Plus size={18} className="mb-1" />
                        <span className="text-[10px] font-bold uppercase tracking-wider leading-tight">Deploy</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BotLabHeader;
