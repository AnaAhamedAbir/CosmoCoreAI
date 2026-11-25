import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Cpu, X, Copy, Download, ShieldAlert } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useBotStatus } from '@/hooks/useBotStatus';
import BotLogViewer from '@/components/features/bots/BotLogViewer';
import { botService } from '@/services/botService';
import { useToast } from '@/context/ToastContext';
import type { ActiveBot, BotTradeRecord } from '@/types';

interface BotDetailsModalProps {
    bot: ActiveBot;
    onClose: () => void;
    onEmergencySell?: (bot: ActiveBot) => void;
}

const BotDetailsModal: React.FC<BotDetailsModalProps> = ({ bot: initialBot, onClose, onEmergencySell }) => {
    const { showToast } = useToast();
    const { liveBot: bot } = useBotStatus(initialBot);
    const [activeTab, setActiveTab] = useState<'overview' | 'trades' | 'config' | 'logs'>('overview');
    const [trades, setTrades] = useState<BotTradeRecord[]>([]);
    const [loadingTrades, setLoadingTrades] = useState(false);
    const [tradeFilter, setTradeFilter] = useState<'all' | 'wins' | 'losses' | 'open'>('all');

    useEffect(() => {
        if (activeTab === 'trades') {
            setLoadingTrades(true);
            botService
                .getBotTrades(bot.id)
                .then((rows) => setTrades(Array.isArray(rows) ? rows : []))
                .catch(() => setTrades([]))
                .finally(() => setLoadingTrades(false));
        }
    }, [activeTab, bot.id]);

    const filteredTrades = useMemo(() => {
        return trades.filter((t) => {
            if (tradeFilter === 'open') return t.status?.toUpperCase() === 'OPEN';
            if (tradeFilter === 'wins') return t.pnl > 0;
            if (tradeFilter === 'losses') return t.pnl < 0;
            return true;
        });
    }, [trades, tradeFilter]);

    const equityChartData = useMemo(() => {
        return (bot.equity_history || []).map((val, idx) => ({ step: `#${idx + 1}`, value: val }));
    }, [bot.equity_history]);

    const sl = bot.config?.stop_loss ?? bot.config?.riskParams?.stopLoss ?? 0;
    const tp =
        bot.config?.take_profit ??
        (typeof bot.config?.riskParams?.takeProfit === 'number' ? bot.config.riskParams.takeProfit : undefined) ??
        bot.config?.riskParams?.takeProfits?.[0]?.target ??
        0;
    const leverage = bot.config?.leverage ?? bot.config?.riskParams?.leverage ?? 1;
    const isPaper = bot.is_paper_trading !== false;

    const exportTrades = () => {
        if (!trades.length) return;
        const headers = ['id', 'symbol', 'side', 'status', 'entry_price', 'exit_price', 'quantity', 'pnl', 'pnl_percent', 'opened_at', 'closed_at'];
        const csv = [
            headers.join(','),
            ...trades.map((t: any) => headers.map((h) => `"${t[h] ?? ''}"`).join(',')),
        ].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${bot.name.replace(/\s+/g, '_')}_trades.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    return createPortal(
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-[70] flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] w-full max-w-5xl rounded-2xl shadow-2xl h-[84vh] flex flex-col overflow-hidden relative"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-200 dark:border-[#1F1F1F] flex flex-wrap justify-between items-center gap-3 bg-slate-50 dark:bg-[#111]">
                    <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-xl ${bot.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-200 dark:bg-[#1A1A1A] text-slate-400'}`}>
                            <Cpu size={20} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-bold text-slate-900 dark:text-white">{bot.name}</h2>
                                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${isPaper ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
                                    {isPaper ? 'PAPER' : 'LIVE'}
                                </span>
                                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase ${bot.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400'}`}>
                                    {bot.status}
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 font-mono mt-0.5">
                                ID #{bot.id} • {bot.exchange?.toUpperCase()} • {bot.market} • {bot.timeframe} • {bot.strategy}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {bot.status === 'active' && onEmergencySell && (
                            <button
                                onClick={() => onEmergencySell(bot)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500 text-rose-400 hover:text-white border border-rose-500/30 text-xs font-bold transition-colors"
                            >
                                <ShieldAlert size={13} /> Market Close
                            </button>
                        )}
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-[#1A1A1A] text-slate-400 hover:text-white transition-colors">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-200 dark:border-[#1F1F1F] px-5 bg-slate-50/70 dark:bg-[#0D0D0D]">
                    {(['overview', 'trades', 'config', 'logs'] as const).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-5 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
                                activeTab === tab
                                    ? 'border-brand-primary text-brand-primary'
                                    : 'border-transparent text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            {tab === 'trades' ? `Trades${trades.length ? ` (${trades.length})` : ''}` : tab}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden flex flex-col">
                    {activeTab === 'overview' && (
                        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                <div className="bg-slate-50 dark:bg-[#111] p-4 rounded-xl border border-slate-200 dark:border-[#1F1F1F]">
                                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Net / Live PnL</p>
                                    <p className={`text-2xl font-bold font-mono ${(bot.pnl ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                        {(bot.pnl ?? 0) >= 0 ? '+' : '-'}${Math.abs(bot.pnl ?? 0).toFixed(2)}
                                    </p>
                                </div>
                                <div className="bg-slate-50 dark:bg-[#111] p-4 rounded-xl border border-slate-200 dark:border-[#1F1F1F]">
                                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Total Realized</p>
                                    <p className={`text-2xl font-bold font-mono ${(bot.totalPnl ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                        {(bot.totalPnl ?? 0) >= 0 ? '+' : '-'}${Math.abs(bot.totalPnl ?? 0).toFixed(2)}
                                    </p>
                                </div>
                                <div className="bg-slate-50 dark:bg-[#111] p-4 rounded-xl border border-slate-200 dark:border-[#1F1F1F]">
                                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Win Rate</p>
                                    <p className="text-2xl font-bold font-mono text-blue-400">
                                        {Number(bot.win_rate ?? 0).toFixed(1)}%
                                    </p>
                                </div>
                                <div className="bg-slate-50 dark:bg-[#111] p-4 rounded-xl border border-slate-200 dark:border-[#1F1F1F]">
                                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Allocation & Lev</p>
                                    <p className="text-xl font-bold font-mono text-slate-900 dark:text-white">
                                        ${bot.trade_value ?? bot.tradeValue ?? 0} <span className="text-xs text-brand-primary">({leverage}x)</span>
                                    </p>
                                </div>
                                <div className="bg-slate-50 dark:bg-[#111] p-4 rounded-xl border border-slate-200 dark:border-[#1F1F1F]">
                                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">SL / TP</p>
                                    <p className="text-xl font-bold font-mono">
                                        <span className="text-rose-400">{sl}%</span> <span className="text-slate-600">/</span> <span className="text-emerald-400">{tp}%</span>
                                    </p>
                                </div>
                            </div>

                            <div className="bg-slate-50 dark:bg-[#111] p-4 rounded-xl border border-slate-200 dark:border-[#1F1F1F] h-[280px]">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                                    Recent Equity Trajectory (Last 20 Trades)
                                </h3>
                                {equityChartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="90%">
                                        <AreaChart data={equityChartData}>
                                            <defs>
                                                <linearGradient id="botDetailEq" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.35} />
                                                    <stop offset="95%" stopColor="#06B6D4" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#1F1F1F" />
                                            <XAxis dataKey="step" stroke="#64748b" fontSize={11} />
                                            <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `$${Number(v).toLocaleString()}`} />
                                            <Tooltip contentStyle={{ backgroundColor: '#0A0A0A', borderColor: '#1F1F1F', fontSize: '12px' }} />
                                            <Area type="monotone" dataKey="value" stroke="#06B6D4" strokeWidth={2} fill="url(#botDetailEq)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="h-full flex items-center justify-center text-xs text-slate-500">
                                        No executed trade history recorded yet for this unit.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'trades' && (
                        <div className="flex-1 flex flex-col overflow-hidden">
                            <div className="px-5 py-3 border-b border-slate-200 dark:border-[#1F1F1F] bg-slate-50 dark:bg-[#111] flex items-center justify-between">
                                <div className="flex gap-1.5">
                                    {(['all', 'wins', 'losses', 'open'] as const).map((f) => (
                                        <button
                                            key={f}
                                            onClick={() => setTradeFilter(f)}
                                            className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase ${
                                                tradeFilter === f ? 'bg-brand-primary text-white' : 'bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] text-slate-500'
                                            }`}
                                        >
                                            {f}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    onClick={exportTrades}
                                    disabled={!trades.length}
                                    className="flex items-center gap-1.5 px-3 py-1 rounded border border-slate-200 dark:border-[#1F1F1F] text-xs font-semibold text-slate-500 hover:text-white disabled:opacity-40"
                                >
                                    <Download size={12} /> Export CSV
                                </button>
                            </div>

                            <div className="flex-1 overflow-auto custom-scrollbar">
                                {loadingTrades ? (
                                    <div className="h-full flex items-center justify-center text-xs text-slate-500">Loading trade ledger...</div>
                                ) : filteredTrades.length === 0 ? (
                                    <div className="h-full flex items-center justify-center text-xs text-slate-500">No trades found matching filter.</div>
                                ) : (
                                    <table className="w-full text-xs text-left">
                                        <thead className="bg-slate-50 dark:bg-[#111] text-slate-500 uppercase text-[10px] sticky top-0 z-10">
                                            <tr>
                                                <th className="px-4 py-2.5">Side</th>
                                                <th className="px-4 py-2.5">Status</th>
                                                <th className="px-4 py-2.5 text-right">Entry</th>
                                                <th className="px-4 py-2.5 text-right">Exit</th>
                                                <th className="px-4 py-2.5 text-right">Qty</th>
                                                <th className="px-4 py-2.5">Opened</th>
                                                <th className="px-4 py-2.5 text-right">Net PnL</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200 dark:divide-[#1F1F1F] font-mono">
                                            {filteredTrades.map((t) => (
                                                <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-[#111]">
                                                    <td className={`px-4 py-2 font-bold ${t.side?.toUpperCase() === 'BUY' || t.side?.toUpperCase() === 'LONG' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                        {t.side}
                                                    </td>
                                                    <td className="px-4 py-2 text-slate-400">{t.status}</td>
                                                    <td className="px-4 py-2 text-right text-slate-900 dark:text-slate-200">{t.entry_price?.toFixed(4)}</td>
                                                    <td className="px-4 py-2 text-right text-slate-900 dark:text-slate-200">{t.exit_price ? t.exit_price.toFixed(4) : '-'}</td>
                                                    <td className="px-4 py-2 text-right text-slate-500">{t.quantity?.toFixed(4)}</td>
                                                    <td className="px-4 py-2 text-slate-500">{new Date(t.opened_at).toLocaleString()}</td>
                                                    <td className={`px-4 py-2 text-right font-bold ${t.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                        {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)} ({t.pnl_percent.toFixed(2)}%)
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'config' && (
                        <div className="p-5 overflow-y-auto h-full space-y-3 custom-scrollbar">
                            <div className="flex justify-end">
                                <button
                                    onClick={() => {
                                        navigator.clipboard?.writeText(JSON.stringify(bot.config || bot, null, 2));
                                        showToast('Bot config copied to clipboard', 'success');
                                    }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#1F1F1F] text-xs font-semibold text-slate-500 hover:text-white"
                                >
                                    <Copy size={12} /> Copy JSON
                                </button>
                            </div>
                            <div className="bg-slate-50 dark:bg-[#111] p-5 rounded-xl border border-slate-200 dark:border-[#1F1F1F] font-mono text-xs overflow-x-auto custom-scrollbar">
                                <pre className="text-emerald-600 dark:text-emerald-400">
                                    {JSON.stringify(bot, null, 2)}
                                </pre>
                            </div>
                        </div>
                    )}

                    {activeTab === 'logs' && (
                        <div className="flex-1 h-full overflow-hidden">
                            <BotLogViewer botId={bot.id} botName={bot.name} className="h-full border-0 rounded-none shadow-none" />
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default BotDetailsModal;
