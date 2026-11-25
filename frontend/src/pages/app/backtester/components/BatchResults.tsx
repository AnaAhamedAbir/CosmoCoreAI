import React, { useMemo } from 'react';
import Button from '@/components/common/Button';
import { List, BarChart2, Eye, Download, Trophy } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const getSafeValue = (item: any, keys: string[]) => {
    if (!item) return 0;
    for (const key of keys) {
        const val = item[key];
        if (val !== undefined && val !== null && !isNaN(Number(val))) {
            return Number(val);
        }
    }
    return 0;
};

const downloadCSV = (data: any[], filename = 'batch_backtest_results.csv') => {
    if (!data || !data.length) return;
    const flattenRow = (row: any) => {
        const { params, ...rest } = row;
        return { ...rest, ...params };
    };
    const flatData = data.map(flattenRow);
    const headers = Object.keys(flatData[0]);
    const csvRows = [
        headers.join(','),
        ...flatData.map((row) =>
            headers
                .map((header) => {
                    const val = row[header];
                    const escaped = ('' + (val ?? '')).replace(/"/g, '""');
                    return `"${escaped}"`;
                })
                .join(',')
        ),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

interface BatchResultsProps {
    batchResults?: any[];
    multiObjectiveResults?: any[];
    results?: any;
    viewMode?: 'table' | 'chart';
    setViewMode?: (mode: 'table' | 'chart') => void;
    setSelectedBatchResult?: (res: any) => void;
}

export const BatchResults: React.FC<BatchResultsProps> = ({
    batchResults,
    multiObjectiveResults,
    results: rawResultProp,
    viewMode,
    setViewMode,
    setSelectedBatchResult,
}) => {
    const rawData = batchResults || multiObjectiveResults || (rawResultProp?.results ? rawResultProp.results : rawResultProp);

    const processedResults = useMemo(() => {
        if (!rawData || !Array.isArray(rawData)) return [];
        return rawData
            .map((item, idx) => ({
                ...item,
                id: item.strategy || `Strategy ${idx + 1}`,
                profitVal: getSafeValue(item, ['profitPercent', 'profit_percent']),
            }))
            .sort((a, b) => b.profitVal - a.profitVal)
            .slice(0, 100);
    }, [rawData]);

    const [localViewMode, setLocalViewMode] = React.useState<'table' | 'chart'>('table');
    const currentViewMode = viewMode === 'chart' || viewMode === 'table' ? viewMode : localViewMode;
    const changeView = setViewMode || setLocalViewMode;

    if (!processedResults || processedResults.length === 0) return null;

    return (
        <div className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-xl overflow-hidden animate-fade-in">
            <div className="p-5">
                <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <Trophy size={18} className="text-amber-400" /> Strategy Batch Leaderboard
                        </h2>
                        <span className="text-xs font-mono text-slate-500">({processedResults.length} tested)</span>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => downloadCSV(processedResults, `batch_results_${new Date().toISOString().slice(0, 10)}.csv`)}
                            className="flex items-center gap-1.5 text-xs"
                        >
                            <Download size={13} /> Export CSV
                        </Button>

                        <div className="flex bg-slate-100 dark:bg-[#111] p-1 rounded-lg border border-slate-200 dark:border-[#1F1F1F]">
                            <button
                                onClick={() => changeView('table')}
                                className={`p-1.5 rounded-md transition-all ${currentViewMode === 'table' ? 'bg-white dark:bg-[#222] text-brand-primary shadow-sm' : 'text-slate-500'}`}
                                title="Leaderboard Table"
                            >
                                <List size={15} />
                            </button>
                            <button
                                onClick={() => changeView('chart')}
                                className={`p-1.5 rounded-md transition-all ${currentViewMode === 'chart' ? 'bg-white dark:bg-[#222] text-brand-primary shadow-sm' : 'text-slate-500'}`}
                                title="Comparison Chart"
                            >
                                <BarChart2 size={15} />
                            </button>
                        </div>
                    </div>
                </div>

                {currentViewMode === 'chart' && (
                    <div className="mb-6 bg-slate-50 dark:bg-[#111] p-4 rounded-xl border border-slate-200 dark:border-[#1F1F1F] h-[340px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={processedResults}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1F1F1F" vertical={false} />
                                <XAxis dataKey="id" stroke="#9CA3AF" fontSize={10} tickFormatter={(val) => (val.length > 12 ? val.substring(0, 12) + '..' : val)} />
                                <YAxis stroke="#9CA3AF" fontSize={11} tickFormatter={(v) => `${v}%`} />
                                <Tooltip contentStyle={{ backgroundColor: '#0A0A0A', borderColor: '#1F1F1F', color: '#fff', fontSize: '12px' }} />
                                <Bar dataKey="profitVal" name="Profit %" radius={[4, 4, 0, 0]}>
                                    {processedResults.map((entry: any, index: number) => (
                                        <Cell key={`cell-${index}`} fill={entry.profitVal >= 0 ? '#10B981' : '#EF4444'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {currentViewMode === 'table' && (
                    <div className="overflow-x-auto custom-scrollbar border border-slate-200 dark:border-[#1F1F1F] rounded-xl">
                        <table className="w-full text-left text-xs text-slate-900 dark:text-white">
                            <thead className="bg-slate-50 dark:bg-[#111] uppercase text-[10px] font-bold text-slate-500 tracking-wider">
                                <tr>
                                    <th className="px-4 py-3">Rank</th>
                                    <th className="px-4 py-3">Strategy</th>
                                    <th className="px-4 py-3 text-right">Profit %</th>
                                    <th className="px-4 py-3 text-right">Sharpe</th>
                                    <th className="px-4 py-3 text-right">Win Rate</th>
                                    <th className="px-4 py-3 text-right">Max DD</th>
                                    <th className="px-4 py-3 text-right">Trades</th>
                                    {setSelectedBatchResult && <th className="px-4 py-3 text-center">Action</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-[#1F1F1F] font-mono">
                                {processedResults.map((res: any, idx: number) => {
                                    const profit = res.profitVal;
                                    const sharpe = getSafeValue(res, ['sharpeRatio', 'sharpe_ratio']);
                                    const winRate = getSafeValue(res, ['winRate', 'win_rate']);
                                    const drawdown = getSafeValue(res, ['maxDrawdown', 'max_drawdown']);
                                    const trades = getSafeValue(res, ['total_trades', 'totalTrades']);

                                    return (
                                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-[#111] transition-colors">
                                            <td className="px-4 py-2.5 font-bold text-slate-400">#{idx + 1}</td>
                                            <td className="px-4 py-2.5 font-sans font-semibold text-slate-800 dark:text-slate-200">
                                                {res.strategy || 'Unknown'}
                                            </td>
                                            <td className={`px-4 py-2.5 text-right font-bold ${profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                {profit >= 0 ? '+' : ''}{profit.toFixed(2)}%
                                            </td>
                                            <td className="px-4 py-2.5 text-right text-slate-300">{sharpe.toFixed(2)}</td>
                                            <td className="px-4 py-2.5 text-right text-blue-400">{winRate.toFixed(1)}%</td>
                                            <td className="px-4 py-2.5 text-right text-rose-400">-{Math.abs(drawdown).toFixed(2)}%</td>
                                            <td className="px-4 py-2.5 text-right text-slate-400">{trades}</td>
                                            {setSelectedBatchResult && (
                                                <td className="px-4 py-2.5 text-center font-sans">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedBatchResult(res);
                                                        }}
                                                        className="inline-flex items-center gap-1 bg-brand-primary/10 hover:bg-brand-primary text-brand-primary hover:text-white px-2.5 py-1 rounded text-[11px] font-semibold transition-all"
                                                    >
                                                        <Eye size={12} /> Inspect
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};
