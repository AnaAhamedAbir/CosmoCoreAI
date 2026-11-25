import React from 'react';
import {
    ResponsiveContainer,
    ComposedChart,
    Area,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    BarChart,
    Bar,
} from 'recharts';
import { ShieldAlert, ShieldCheck, Shuffle } from 'lucide-react';
import { MonteCarloMetrics } from '../../../../types';

interface MonteCarloCardProps {
    metrics?: MonteCarloMetrics;
}

const MonteCarloCard: React.FC<MonteCarloCardProps> = ({ metrics }) => {
    if (!metrics) return null;

    const isHighRisk = metrics.risk_of_ruin_percent > 1;
    const hasBands = Array.isArray(metrics.percentile_bands) && metrics.percentile_bands.length > 0;
    const hasDistribution = Array.isArray(metrics.distribution) && metrics.distribution.length > 0;

    return (
        <div className="bg-white dark:bg-[#0A0A0A] p-5 rounded-xl border border-slate-200 dark:border-[#1F1F1F] space-y-5">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-brand-primary/10 text-brand-primary">
                        <Shuffle size={16} />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                            Monte Carlo Sequence Risk Analysis
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            {metrics.simulations.toLocaleString()} randomized trade-order permutations
                        </p>
                    </div>
                </div>

                <div
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                        isHighRisk
                            ? 'bg-rose-500/10 text-rose-500 border-rose-500/30'
                            : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                    }`}
                >
                    {isHighRisk ? <ShieldAlert size={13} /> : <ShieldCheck size={13} />}
                    {isHighRisk ? 'ELEVATED RUIN RISK' : 'ROBUST SEQUENCE PROFILE'}
                </div>
            </div>

            {/* Key Summary Strip */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F]">
                    <p className="text-[10px] font-bold uppercase text-slate-500">Risk of Ruin</p>
                    <p className={`text-lg font-mono font-bold mt-0.5 ${isHighRisk ? 'text-rose-500' : 'text-emerald-500'}`}>
                        {metrics.risk_of_ruin_percent}%
                    </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F]">
                    <p className="text-[10px] font-bold uppercase text-slate-500">Avg Max DD</p>
                    <p className="text-lg font-mono font-bold text-rose-400 mt-0.5">{metrics.expected_max_drawdown}%</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F]">
                    <p className="text-[10px] font-bold uppercase text-slate-500">95% Worst DD</p>
                    <p className="text-lg font-mono font-bold text-rose-500 mt-0.5">{metrics.worst_case_drawdown_95}%</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F]">
                    <p className="text-[10px] font-bold uppercase text-slate-500">Worst 5% Equity</p>
                    <p className="text-lg font-mono font-bold text-amber-400 mt-0.5">${metrics.worst_case_equity_95.toLocaleString()}</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F]">
                    <p className="text-[10px] font-bold uppercase text-slate-500">Median Equity</p>
                    <p className="text-lg font-mono font-bold text-blue-400 mt-0.5">${metrics.median_equity.toLocaleString()}</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F]">
                    <p className="text-[10px] font-bold uppercase text-slate-500">Top 95% Equity</p>
                    <p className="text-lg font-mono font-bold text-emerald-400 mt-0.5">${metrics.best_case_equity_95.toLocaleString()}</p>
                </div>
            </div>

            {/* Fan Chart + Final Equity Distribution */}
            {hasBands ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    <div className="lg:col-span-8 bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F] rounded-xl p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                                Equity Confidence Fan (5th / 25th / Median / 75th / 95th Percentile)
                            </h4>
                        </div>
                        <div className="h-[240px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={metrics.percentile_bands}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1F1F1F" />
                                    <XAxis dataKey="trade" stroke="#64748b" fontSize={10} tickFormatter={(v) => `#${v}`} />
                                    <YAxis stroke="#64748b" fontSize={10} tickFormatter={(v) => `$${Number(v).toLocaleString()}`} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#0A0A0A', borderColor: '#1F1F1F', borderRadius: '8px', fontSize: '11px' }}
                                        formatter={(val: any) => `$${Number(val).toLocaleString()}`}
                                    />
                                    <Area type="monotone" dataKey="p95" name="95th Pct" stroke="none" fill="#10B981" fillOpacity={0.12} />
                                    <Area type="monotone" dataKey="p75" name="75th Pct" stroke="none" fill="#3B82F6" fillOpacity={0.18} />
                                    <Line type="monotone" dataKey="p95" name="Best 95%" stroke="#10B981" strokeWidth={1.5} dot={false} strokeDasharray="3 3" />
                                    <Line type="monotone" dataKey="p50" name="Median" stroke="#3B82F6" strokeWidth={2.5} dot={false} />
                                    <Line type="monotone" dataKey="p5" name="Worst 5%" stroke="#EF4444" strokeWidth={1.5} dot={false} strokeDasharray="3 3" />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {hasDistribution && (
                        <div className="lg:col-span-4 bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F] rounded-xl p-4">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                                Final Equity Distribution
                            </h4>
                            <div className="h-[240px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={metrics.distribution}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1F1F1F" vertical={false} />
                                        <XAxis dataKey="range" stroke="#64748b" fontSize={9} angle={-35} textAnchor="end" height={45} />
                                        <YAxis stroke="#64748b" fontSize={10} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#0A0A0A', borderColor: '#1F1F1F', borderRadius: '8px', fontSize: '11px' }}
                                        />
                                        <Bar dataKey="count" name="Simulations" fill="#6366F1" radius={[3, 3, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                /* Fallback for legacy MonteCarlo payloads without percentile_bands */
                <div className="space-y-3 pt-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase">Projected Equity Outcomes</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
                        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex justify-between">
                            <span className="text-emerald-400">Best Case (95%)</span>
                            <span className="font-bold text-white">${metrics.best_case_equity_95.toLocaleString()}</span>
                        </div>
                        <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 flex justify-between">
                            <span className="text-blue-400">Median Expected</span>
                            <span className="font-bold text-white">${metrics.median_equity.toLocaleString()}</span>
                        </div>
                        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 flex justify-between">
                            <span className="text-rose-400">Worst Case (5%)</span>
                            <span className="font-bold text-white">${metrics.worst_case_equity_95.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MonteCarloCard;
