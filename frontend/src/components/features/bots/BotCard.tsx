import React, { useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Cpu, Zap, Settings, Activity, Trash2, BarChart2, Copy, ShieldAlert } from 'lucide-react';
import Button from '@/components/common/Button';
import AnimatedNumber from '@/components/common/AnimatedNumber';
import { useBotStatus } from '@/hooks/useBotStatus';
import type { ActiveBot } from '@/types';

const MiniEquityChart: React.FC<{ isPositive: boolean; id: string; data?: number[] }> = ({ isPositive, id, data }) => {
    const chartData = useMemo(() => {
        if (!data || data.length === 0) {
            return Array.from({ length: 16 }, (_, i) => ({ i, value: 100 }));
        }
        return data.map((val, i) => ({ i, value: val }));
    }, [data]);

    const color = isPositive ? '#10B981' : '#F43F5E';
    const hasData = Boolean(data && data.length > 0);

    return (
        <div className="h-20 w-full absolute bottom-0 left-0 right-0 opacity-20 group-hover:opacity-35 transition-opacity duration-300 pointer-events-none">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                    <defs>
                        <linearGradient id={`gradient-${id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={hasData ? color : '#64748b'} stopOpacity={hasData ? 0.35 : 0.1} />
                            <stop offset="95%" stopColor={hasData ? color : '#64748b'} stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <Area
                        type="monotone"
                        dataKey="value"
                        stroke={hasData ? color : '#64748b'}
                        strokeWidth={hasData ? 2 : 1}
                        strokeDasharray={hasData ? undefined : '3 3'}
                        fill={`url(#gradient-${id})`}
                        isAnimationActive={false}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
};

interface BotCardProps {
    bot: ActiveBot;
    index: number;
    isLoading?: boolean;
    onRunBacktest: (bot: ActiveBot) => void;
    onToggleStatus: (id: string, currentStatus?: string) => void;
    onDelete: (id: string) => void;
    onDetails: (bot: ActiveBot) => void;
    onSettings: (bot: ActiveBot) => void;
    onClone?: (bot: ActiveBot) => void;
    onEmergencySell?: (bot: ActiveBot) => void;
}

const BotCard: React.FC<BotCardProps> = ({
    bot: initialBot,
    index,
    isLoading,
    onRunBacktest,
    onToggleStatus,
    onDelete,
    onDetails,
    onSettings,
    onClone,
    onEmergencySell,
}) => {
    const { liveBot: bot, isConnected } = useBotStatus(initialBot);
    const isPositive = (bot.pnl ?? 0) >= 0;
    const roiPct = Number(bot.pnlPercent ?? bot.pnl_percent ?? 0);
    const isRoiPositive = roiPct >= 0;
    const isPaper = bot.is_paper_trading !== false;
    const leverage = bot.config?.leverage ?? bot.config?.riskParams?.leverage ?? 1;
    const sl = bot.config?.stop_loss ?? bot.config?.riskParams?.stopLoss ?? 0;
    const tp =
        bot.config?.take_profit ??
        (typeof bot.config?.riskParams?.takeProfit === 'number' ? bot.config.riskParams.takeProfit : undefined) ??
        bot.config?.riskParams?.takeProfits?.[0]?.target ??
        0;
    const orderSize = bot.trade_value ?? bot.tradeValue ?? bot.config?.amount_per_trade ?? 0;
    const winRate = Number(bot.win_rate ?? 0);

    return (
        <div
            className="group relative bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-2xl overflow-hidden hover:border-cyan-500/50 transition-all duration-300 flex flex-col"
            style={{ animation: `fadeInUp 0.4s ease-out ${Math.min(index * 0.05, 0.3)}s backwards` }}
        >
            {/* Top Status Accent Bar */}
            <div
                className={`h-[2px] w-full ${
                    bot.status === 'active'
                        ? 'bg-gradient-to-r from-emerald-500 via-cyan-400 to-blue-500'
                        : 'bg-slate-200 dark:bg-[#1A1A1A]'
                }`}
            />

            <div className="p-4 relative z-10 flex flex-col h-full space-y-3.5">
                {/* Header */}
                <div className="flex justify-between items-start gap-2">
                    <div className="flex items-start gap-2.5 min-w-0">
                        <div className={`p-2 rounded-xl shrink-0 ${bot.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-100 dark:bg-[#141414] text-slate-500'}`}>
                            <Cpu size={17} />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                                <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate">{bot.name}</h3>
                                {bot.isRegimeAware && <Zap size={12} className="text-purple-400 shrink-0" />}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px] font-mono">
                                <span className={`px-1.5 py-0.5 rounded font-bold ${isPaper ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
                                    {isPaper ? 'PAPER' : 'LIVE'}
                                </span>
                                {bot.exchange && (
                                    <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#141414] text-slate-500 uppercase">
                                        {bot.exchange}
                                    </span>
                                )}
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#141414] text-slate-700 dark:text-slate-300 font-bold">
                                    {bot.market}
                                </span>
                                {bot.timeframe && (
                                    <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#141414] text-slate-400">
                                        {bot.timeframe}
                                    </span>
                                )}
                                {Number(leverage) > 1 && (
                                    <span className="px-1.5 py-0.5 rounded bg-brand-primary/15 text-brand-primary font-bold">
                                        {leverage}x
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {bot.status === 'active' && (
                            <span
                                className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}
                                title={isConnected ? 'WebSocket Connected' : 'Connecting...'}
                            />
                        )}
                        <button
                            onClick={(e) => { e.stopPropagation(); onToggleStatus(bot.id, bot.status); }}
                            className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${bot.status === 'active' ? 'bg-emerald-500/30 border border-emerald-500/40' : 'bg-slate-200 dark:bg-[#1A1A1A] border border-slate-300 dark:border-[#2A2A2A]'}`}
                            title={bot.status === 'active' ? 'Stop Bot' : 'Start Bot'}
                        >
                            <div className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full transition-all duration-200 ${bot.status === 'active' ? 'translate-x-5 bg-emerald-400' : 'bg-slate-400'}`} />
                        </button>
                    </div>
                </div>

                {/* PnL & ROI Strip */}
                <div className="grid grid-cols-3 gap-2">
                    <div className="bg-slate-50 dark:bg-[#111] rounded-xl p-2.5 border border-slate-200 dark:border-[#1F1F1F]">
                        <p className="text-[9px] text-slate-500 uppercase font-bold">Net PnL</p>
                        <div className={`text-sm font-bold font-mono tabular-nums mt-0.5 ${isPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {isPositive ? '+' : '-'}<AnimatedNumber value={Math.abs(bot.pnl ?? 0)} prefix="$" />
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-[#111] rounded-xl p-2.5 border border-slate-200 dark:border-[#1F1F1F]">
                        <p className="text-[9px] text-slate-500 uppercase font-bold">ROI</p>
                        <div className={`text-sm font-bold font-mono tabular-nums mt-0.5 ${isRoiPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {isRoiPositive ? '+' : ''}{roiPct.toFixed(2)}%
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-[#111] rounded-xl p-2.5 border border-slate-200 dark:border-[#1F1F1F]">
                        <p className="text-[9px] text-slate-500 uppercase font-bold">Win Rate</p>
                        <div className="text-sm font-bold font-mono tabular-nums text-blue-400 mt-0.5">
                            {winRate.toFixed(1)}%
                        </div>
                    </div>
                </div>

                {/* Strategy & Risk Telemetry */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-500 px-0.5">
                    <span className="truncate max-w-[150px] font-sans font-medium text-slate-700 dark:text-slate-300" title={bot.strategy}>
                        {bot.strategy}
                    </span>
                    <div className="flex items-center gap-2">
                        <span>Size: <b className="text-slate-800 dark:text-slate-200">${orderSize}</b></span>
                        <span>•</span>
                        <span>
                            SL <b className="text-rose-400">{sl || 0}%</b> / TP <b className="text-emerald-400">{tp || 0}%</b>
                        </span>
                    </div>
                </div>

                {/* Action Bar */}
                <div className="flex justify-between items-center mt-auto pt-3 border-t border-slate-200 dark:border-[#1F1F1F]">
                    <div className="flex items-center gap-1">
                        <button
                            onClick={(e) => { e.stopPropagation(); onSettings(bot); }}
                            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#1A1A1A] text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                            title="Configure Bot"
                        >
                            <Settings size={14} />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onDetails(bot); }}
                            className="p-1.5 rounded-lg hover:bg-blue-500/15 text-slate-400 hover:text-blue-400 transition-colors"
                            title="Telemetry, Trades & Live Logs"
                        >
                            <Activity size={14} />
                        </button>
                        {onClone && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onClone(bot); }}
                                className="p-1.5 rounded-lg hover:bg-purple-500/15 text-slate-400 hover:text-purple-400 transition-colors"
                                title="Clone Bot"
                            >
                                <Copy size={14} />
                            </button>
                        )}
                        {bot.status === 'active' && onEmergencySell && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onEmergencySell(bot); }}
                                className="p-1.5 rounded-lg hover:bg-amber-500/15 text-amber-400 transition-colors"
                                title="Emergency Market Close Position"
                            >
                                <ShieldAlert size={14} />
                            </button>
                        )}
                        <button
                            onClick={(e) => { e.stopPropagation(); onDelete(bot.id); }}
                            className="p-1.5 rounded-lg hover:bg-rose-500/15 text-slate-400 hover:text-rose-400 transition-colors"
                            title="Delete Bot"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>

                    <Button
                        size="sm"
                        className="bg-brand-primary/10 hover:bg-brand-primary text-brand-primary hover:text-white border border-brand-primary/30 text-[11px] font-bold px-3 h-7 transition-all"
                        onClick={() => onRunBacktest(bot)}
                        disabled={isLoading}
                    >
                        <span className="flex items-center gap-1.5">
                            {isLoading ? <span className="animate-spin">⟳</span> : <BarChart2 size={12} />}
                            Simulate
                        </span>
                    </Button>
                </div>
            </div>

            <MiniEquityChart isPositive={isPositive} id={bot.id} data={bot.equity_history} />
        </div>
    );
};

export default BotCard;
