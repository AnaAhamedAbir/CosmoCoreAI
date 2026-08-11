import React, { useMemo } from 'react';
import Card from '@/components/common/Card';
import Button from '@/components/common/Button';
import { FileText, List, LayoutGrid, BarChart2, Eye, Download } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import ParameterHeatmap from '@/components/features/backtest/ParameterHeatmap';

// Helper: Safely extract values
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

// Helper: Convert Data to CSV and Download
const downloadCSV = (data: any[], filename = 'backtest_results.csv') => {
    if (!data || !data.length) return;
    const flattenRow = (row: any) => {
        const { params, ...rest } = row;
        return { ...rest, ...params };
    };
    const flatData = data.map(flattenRow);
    const headers = Object.keys(flatData[0]);
    const csvRows = [
        headers.join(','),
        ...flatData.map(row => headers.map(header => {
            const val = row[header];
            const escaped = ('' + (val ?? '')).replace(/"/g, '""');
            return `"${escaped}"`;
        }).join(','))
    ];
    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv' });
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
    batchResults?: any[]; // Made optional
    multiObjectiveResults?: any[];
    results?: any; // ✅ Add 'results' prop support directly
    viewMode?: 'table' | 'heatmap' | 'chart';
    setViewMode?: (mode: 'table' | 'heatmap' | 'chart') => void;
    setSelectedBatchResult?: (res: any) => void;
}

export const BatchResults: React.FC<BatchResultsProps> = ({
    batchResults,
    multiObjectiveResults,
    results: rawResultProp, // Accept generic results prop
    viewMode = 'table', // Default value
    setViewMode,
    setSelectedBatchResult
}) => {
    // ✅ Handle different data sources flexibly
    const rawData = batchResults || multiObjectiveResults || (rawResultProp?.results ? rawResultProp.results : rawResultProp);

    // Sort by Profit & Add ID for Chart
    const processedResults = useMemo(() => {
        if (!rawData || !Array.isArray(rawData)) return [];
        return rawData
            .map((item, idx) => ({
                ...item,
                id: item.strategy || `Strategy ${idx + 1}` // ✅ Ensure ID exists for Chart
            }))
            .sort((a, b) => {
                const profitA = getSafeValue(a, ['profitPercent', 'profit_percent']);
                const profitB = getSafeValue(b, ['profitPercent', 'profit_percent']);
                return profitB - profitA;
            })
            .slice(0, 100);
    }, [rawData]);

    // Local state for view mode if not provided
    const [localViewMode, setLocalViewMode] = React.useState<'table' | 'heatmap' | 'chart'>('table');
    const currentViewMode = viewMode || localViewMode;
    const changeView = setViewMode || setLocalViewMode;

    if (!processedResults || processedResults.length === 0) return null;

    return (
        <div className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden shadow-sm animate-fade-in mt-6">
            <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span className="text-brand-primary">🏆</span> Strategy Leaderboard
                        </h2>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => downloadCSV(processedResults, `batch_results_${new Date().toISOString().slice(0, 10)}.csv`)}
                        className="flex items-center gap-2"
                    >
                        <Download size={14} /> Export CSV
                    </Button>
                </div>

                    {/* View Toggles */}
                    <div className="flex bg-slate-50 dark:bg-white/5 p-1 rounded-lg border border-slate-200 dark:border-white/10">
                        <button onClick={() => changeView('table')} className={`p-2 rounded-md transition-all ${currentViewMode === 'table' ? 'bg-white dark:bg-[#222] text-brand-primary shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}><List size={18} /></button>
                        <button onClick={() => changeView('heatmap')} className={`p-2 rounded-md transition-all ${currentViewMode === 'heatmap' ? 'bg-white dark:bg-[#222] text-brand-primary shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}><LayoutGrid size={18} /></button>
                        <button onClick={() => changeView('chart')} className={`p-2 rounded-md transition-all ${currentViewMode === 'chart' ? 'bg-white dark:bg-[#222] text-brand-primary shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}><BarChart2 size={18} /></button>
                    </div>
                </div>

                {/* CHART VIEW */}
                {currentViewMode === 'chart' && (
                    <div className="mb-8 bg-slate-50 dark:bg-white/5 p-4 rounded-2xl border border-slate-200 dark:border-white/10 h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={processedResults}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2A2E39" vertical={false} />
                            <XAxis dataKey="id" stroke="#9CA3AF" fontSize={10} tickFormatter={(val) => val.length > 10 ? val.substring(0, 10) + '..' : val} />
                            <YAxis stroke="#9CA3AF" fontSize={12} />
                            <Tooltip contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: '#fff' }} />
                            <Bar dataKey="profitPercent" name="Profit %" radius={[4, 4, 0, 0]}>
                                {processedResults.map((entry: any, index: number) => (
                                    <Cell key={`cell-${index}`} fill={getSafeValue(entry, ['profitPercent', 'profit_percent']) >= 0 ? '#10B981' : '#EF4444'} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* HEATMAP VIEW */}
            {currentViewMode === 'heatmap' && <ParameterHeatmap results={processedResults} />}

                {/* TABLE VIEW */}
                {currentViewMode === 'table' && (
                    <div className="overflow-x-auto custom-scrollbar border border-slate-200 dark:border-white/10 rounded-xl">
                        <table className="w-full text-left text-sm text-slate-900 dark:text-white">
                            <thead className="bg-slate-50 dark:bg-white/5 uppercase text-xs font-bold text-slate-500 tracking-wider">
                                <tr>
                                <th className="px-4 py-3">Rank</th>
                                <th className="px-4 py-3">Strategy</th>
                                <th className="px-4 py-3 text-right">Profit %</th>
                                <th className="px-4 py-3 text-right">Win Rate</th>
                                <th className="px-4 py-3 text-right">Drawdown</th>
                                <th className="px-4 py-3 text-right">Trades</th>
                                <th className="px-4 py-3 text-center">Action</th>
                            </tr>
                        </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                                {processedResults.map((res: any, idx: number) => {
                                const profit = getSafeValue(res, ['profitPercent', 'profit_percent']);
                                const winRate = getSafeValue(res, ['winRate', 'win_rate']);
                                const drawdown = getSafeValue(res, ['maxDrawdown', 'max_drawdown']);
                                const trades = getSafeValue(res, ['total_trades', 'totalTrades']);

                                return (
                                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
                                        <td className="px-4 py-3 font-bold text-slate-400">#{idx + 1}</td>
                                        <td className="px-4 py-3">
                                            <div className="font-bold text-slate-800 dark:text-slate-200">{res.strategy || "Unknown"}</div>
                                        </td>
                                        <td className={`px-4 py-3 text-right font-bold ${profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                            {profit.toFixed(2)}%
                                        </td>
                                        <td className="px-4 py-3 text-right text-blue-400">{winRate.toFixed(1)}%</td>
                                        <td className="px-4 py-3 text-right text-red-400">{Math.abs(drawdown).toFixed(2)}%</td>
                                        <td className="px-4 py-3 text-right text-gray-500 font-mono">{trades}</td>
                                        <td className="px-4 py-3 text-center">
                                            {setSelectedBatchResult && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSelectedBatchResult(res);
                                                    }}
                                                    className="flex items-center justify-center gap-1 bg-brand-primary/10 hover:bg-brand-primary text-brand-primary hover:text-white px-3 py-1.5 rounded transition-all mx-auto"
                                                >
                                                    <Eye size={14} /> View
                                                </button>
                                            )}
                                        </td>
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
}
