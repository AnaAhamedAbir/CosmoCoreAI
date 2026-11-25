import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { TrendingUp, TrendingDown, Activity, DollarSign, PlayCircle } from 'lucide-react';

interface WFAStep {
    step: number;
    train_period?: string;
    test_period: string;
    start_equity: number;
    end_equity: number;
    profit: number;
    profit_percent: number;
    drawdown: number;
    best_params: Record<string, any>;
}

interface WFAResult {
    strategy: string;
    total_steps: number;
    initial_cash: number;
    final_equity: number;
    total_profit: number;
    total_profit_percent: number;
    average_drawdown: number;
    steps_detail: WFAStep[];
}

const MetricCard = ({ label, value, icon: Icon, color }: any) => (
    <div className="bg-white dark:bg-[#0A0A0A] p-4 rounded-xl border border-slate-200 dark:border-[#1F1F1F]">
        <div className="flex justify-between items-start mb-1.5">
            <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">{label}</span>
            <Icon size={15} className={color} />
        </div>
        <div className={`text-xl font-mono font-bold tabular-nums ${color}`}>{value}</div>
    </div>
);

interface WalkForwardResultsProps {
    results: WFAResult;
    onApplyParams?: (params: Record<string, any>) => void;
}

export const WalkForwardResults: React.FC<WalkForwardResultsProps> = ({ results, onApplyParams }) => {
    if (!results || !results.steps_detail) {
        return <div className="text-slate-400 text-sm p-6">No Walk-Forward Analysis data available.</div>;
    }

    const equityData = results.steps_detail.map((step) => ({
        step: `W${step.step}`,
        equity: step.end_equity,
        profit: step.profit_percent,
        drawdown: step.drawdown,
    }));

    const profitableSteps = results.steps_detail.filter((s) => s.profit >= 0).length;
    const consistencyPct = results.total_steps > 0 ? Math.round((profitableSteps / results.total_steps) * 100) : 0;

    return (
        <div className="space-y-5 animate-fade-in">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Activity className="text-brand-primary" size={18} /> Walk-Forward Analysis — {results.strategy}
                    </h2>
                    <p className="text-xs text-slate-500">Out-of-sample rolling validation across {results.total_steps} windows</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                    consistencyPct >= 60
                        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                }`}>
                    Window Consistency: {profitableSteps}/{results.total_steps} ({consistencyPct}%)
                </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard
                    label="Final Equity"
                    value={`$${results.final_equity.toLocaleString()}`}
                    icon={DollarSign}
                    color="text-emerald-500"
                />
                <MetricCard
                    label="Out-of-Sample Return"
                    value={`${results.total_profit_percent >= 0 ? '+' : ''}${results.total_profit_percent}%`}
                    icon={TrendingUp}
                    color={results.total_profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}
                />
                <MetricCard
                    label="OOS Windows"
                    value={results.total_steps}
                    icon={Activity}
                    color="text-blue-400"
                />
                <MetricCard
                    label="Avg Window DD"
                    value={`${results.average_drawdown}%`}
                    icon={TrendingDown}
                    color="text-rose-400"
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-7 bg-white dark:bg-[#0A0A0A] p-4 rounded-xl border border-slate-200 dark:border-[#1F1F1F] h-[300px]">
                    <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">Cumulative OOS Equity Curve</h3>
                    <ResponsiveContainer width="100%" height="90%">
                        <AreaChart data={equityData}>
                            <defs>
                                <linearGradient id="wfaEquity" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1F1F1F" />
                            <XAxis dataKey="step" stroke="#64748b" fontSize={11} />
                            <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `$${Number(v).toLocaleString()}`} />
                            <Tooltip contentStyle={{ backgroundColor: '#0A0A0A', borderColor: '#1F1F1F', color: '#fff', fontSize: '12px' }} />
                            <Area type="monotone" dataKey="equity" stroke="#3B82F6" strokeWidth={2} fillOpacity={1} fill="url(#wfaEquity)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>

                <div className="lg:col-span-5 bg-white dark:bg-[#0A0A0A] p-4 rounded-xl border border-slate-200 dark:border-[#1F1F1F] h-[300px]">
                    <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">Per-Window OOS Return (%)</h3>
                    <ResponsiveContainer width="100%" height="90%">
                        <BarChart data={equityData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1F1F1F" vertical={false} />
                            <XAxis dataKey="step" stroke="#64748b" fontSize={11} />
                            <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `${v}%`} />
                            <Tooltip contentStyle={{ backgroundColor: '#0A0A0A', borderColor: '#1F1F1F', color: '#fff', fontSize: '12px' }} />
                            <Bar dataKey="profit" name="Return %" radius={[4, 4, 0, 0]}>
                                {equityData.map((entry, idx) => (
                                    <Cell key={idx} fill={entry.profit >= 0 ? '#10B981' : '#EF4444'} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200 dark:border-[#1F1F1F] overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-[#1F1F1F] flex justify-between items-center">
                    <h3 className="text-slate-900 dark:text-white text-xs font-bold uppercase tracking-wider">Out-of-Sample Step Breakdown</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50 dark:bg-[#111] text-slate-500 uppercase">
                            <tr>
                                <th className="px-4 py-2.5">Step</th>
                                <th className="px-4 py-2.5">Test Period</th>
                                <th className="px-4 py-2.5 text-right">Start Equity</th>
                                <th className="px-4 py-2.5 text-right">End Equity</th>
                                <th className="px-4 py-2.5 text-right">Return %</th>
                                <th className="px-4 py-2.5 text-right">Max DD %</th>
                                <th className="px-4 py-2.5">Selected Params</th>
                                {onApplyParams && <th className="px-4 py-2.5 text-center">Action</th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-[#1F1F1F] font-mono">
                            {results.steps_detail.map((row, idx) => (
                                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-[#111] transition-colors">
                                    <td className="px-4 py-2.5 font-bold text-slate-400">#{row.step}</td>
                                    <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300 font-sans">{row.test_period}</td>
                                    <td className="px-4 py-2.5 text-right text-slate-600 dark:text-slate-400">${row.start_equity.toLocaleString()}</td>
                                    <td className="px-4 py-2.5 text-right text-slate-900 dark:text-white font-bold">${row.end_equity.toLocaleString()}</td>
                                    <td className={`px-4 py-2.5 text-right font-bold ${row.profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                        {row.profit >= 0 ? '+' : ''}{row.profit_percent}%
                                    </td>
                                    <td className="px-4 py-2.5 text-right text-rose-400">{row.drawdown}%</td>
                                    <td className="px-4 py-2.5 text-[11px] text-slate-400 max-w-xs truncate">
                                        {row.best_params ? Object.entries(row.best_params).map(([k, v]) => `${k}=${v}`).join(', ') : '-'}
                                    </td>
                                    {onApplyParams && (
                                        <td className="px-4 py-2.5 text-center">
                                            <button
                                                onClick={() => row.best_params && onApplyParams(row.best_params)}
                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-brand-primary/10 hover:bg-brand-primary text-brand-primary hover:text-white text-[11px] font-sans font-semibold transition-colors"
                                            >
                                                <PlayCircle size={12} /> Apply
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
