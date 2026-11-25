import React, { useState, useEffect, useMemo } from 'react';
import {
    Activity, Layers, Trophy, BarChart2, Download, TrendingUp,
    Flame, LineChart as LineChartIcon, SplitSquareVertical, Search,
    Copy, GitCompare, PlayCircle, Calendar, Clock
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import BacktestChart from '@/components/features/backtest/BacktestChart';
import UnderwaterChart from '@/components/features/backtest/UnderwaterChart';
import EquityChart from '@/components/features/backtest/EquityChart';
import MonthlyReturnsHeatmap from '@/components/features/backtest/MonthlyReturnsHeatmap';
import ParameterHeatmap from '@/components/features/backtest/ParameterHeatmap';
import MonteCarloCard from './MonteCarloCard';
import { BacktestResult, ClosedTrade } from '@/types';
import { downloadBacktestReportApi } from '@/services/backtester';
import apiClient from '@/services/client';
import { useToast } from '@/context/ToastContext';

const AnimatedNumber: React.FC<{ value: number; decimals?: number; prefix?: string; suffix?: string }> = ({
    value, decimals = 2, prefix = '', suffix = '',
}) => {
    const [displayValue, setDisplayValue] = useState(0);

    useEffect(() => {
        const start = 0;
        const end = Number.isFinite(value) ? value : 0;
        if (start === end) {
            setDisplayValue(end);
            return;
        }
        const duration = 650;
        const startTime = performance.now();
        let rafId = 0;
        const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easeOut = 1 - Math.pow(1 - progress, 3);
            setDisplayValue(start + (end - start) * easeOut);
            if (progress < 1) rafId = requestAnimationFrame(animate);
            else setDisplayValue(end);
        };
        rafId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(rafId);
    }, [value]);

    return (
        <span className="font-mono tabular-nums">
            {prefix}{displayValue.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}
        </span>
    );
};

const MetricCard: React.FC<{
    label: string;
    value: string | number;
    decimals?: number;
    prefix?: string;
    suffix?: string;
    positive?: boolean;
    subtext?: string;
}> = ({ label, value, decimals = 2, prefix = '', suffix = '', positive, subtext }) => {
    const numericValue = typeof value === 'number' ? value : parseFloat(value as string);
    const isPositive = positive !== undefined ? positive : numericValue >= 0;
    const colorClass = positive !== undefined
        ? (isPositive ? 'text-emerald-500' : 'text-rose-500')
        : 'text-slate-900 dark:text-white';

    return (
        <div className="bg-white dark:bg-[#0A0A0A] p-3.5 rounded-xl border border-slate-200 dark:border-[#1F1F1F]">
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">{label}</p>
            <p className={`text-lg font-bold font-mono tabular-nums ${colorClass}`}>
                {typeof value === 'number'
                    ? <AnimatedNumber value={value} decimals={decimals} prefix={prefix} suffix={suffix} />
                    : value}
            </p>
            {subtext && <p className="text-[10px] text-slate-400 mt-0.5 font-mono">{subtext}</p>}
        </div>
    );
};

const calculateDrawdownFromCandles = (candles: any[]) => {
    if (!candles || !Array.isArray(candles) || candles.length === 0) return [];
    let peak = -Infinity;
    return candles.map((c) => {
        const close = Array.isArray(c) ? c[4] : c.close;
        const time = Array.isArray(c) ? c[0] : c.time;
        if (close > peak) peak = close;
        const drawdown = peak > 0 ? ((close - peak) / peak) * 100 : 0;
        return { time, value: drawdown };
    });
};

const formatDuration = (sec: number) => {
    if (!sec || sec <= 0) return '-';
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
    return `${(sec / 86400).toFixed(1)}d`;
};

const exportTradesCSV = (rows: any[], filename: string) => {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [
        headers.join(','),
        ...rows.map((r) => headers.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

interface ResultsPanelProps {
    singleResult: BacktestResult;
    resultsTab: string;
    setResultsTab: (tab: string) => void;
    taskId?: string;
    onApplyOptimizationParams?: (params: Record<string, any>) => void;
    onPinToCompare?: (res: BacktestResult) => void;
    isPinnedForCompare?: boolean;
    onCopyConfig?: () => void;
}

export const ResultsPanel: React.FC<ResultsPanelProps> = ({
    singleResult,
    resultsTab,
    setResultsTab,
    taskId,
    onApplyOptimizationParams,
    onPinToCompare,
    isPinnedForCompare,
    onCopyConfig,
}) => {
    const { showToast } = useToast();
    const [isDownloading, setIsDownloading] = useState(false);
    const [chartView, setChartView] = useState<'split' | 'price' | 'equity' | 'drawdown'>('split');
    const [focusedTrade, setFocusedTrade] = useState<ClosedTrade | null>(null);
    const [tradeFilter, setTradeFilter] = useState<'all' | 'wins' | 'losses' | 'long' | 'short'>('all');
    const [tradeSearch, setTradeSearch] = useState('');
    const [optSortBy, setOptSortBy] = useState<'profitPercent' | 'sharpeRatio' | 'winRate' | 'maxDrawdown'>('profitPercent');

    useEffect(() => {
        setFocusedTrade(null);
    }, [singleResult]);

    const handleDownloadReport = async () => {
        if (!taskId) {
            if (singleResult?.report_file) {
                try {
                    const response = await apiClient.get(`/v1/backtest/report/download/${singleResult.report_file}`, { responseType: 'blob' });
                    const url = window.URL.createObjectURL(new Blob([response.data]));
                    const link = document.createElement('a');
                    link.href = url;
                    link.setAttribute('download', singleResult.report_file);
                    document.body.appendChild(link);
                    link.click();
                    link.parentNode?.removeChild(link);
                    return;
                } catch (error) {
                    console.error('Download failed:', error);
                }
            }
            showToast('Task ID not found. Cannot download report.', 'error');
            return;
        }

        try {
            setIsDownloading(true);
            const blob = await downloadBacktestReportApi(taskId);
            const url = window.URL.createObjectURL(new Blob([blob]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `Report_${(singleResult.symbol || 'backtest').replace('/', '_')}_${taskId}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.parentNode?.removeChild(link);
            showToast('Report downloaded successfully!', 'success');
        } catch (error) {
            console.error('Download failed:', error);
            showToast('Failed to download report', 'error');
        } finally {
            setIsDownloading(false);
        }
    };

    const closedTrades = useMemo(() => {
        if (!singleResult || Array.isArray(singleResult)) return [];
        return singleResult.closed_trades || [];
    }, [singleResult]);

    const filteredClosedTrades = useMemo(() => {
        return closedTrades.filter((t) => {
            if (tradeFilter === 'wins' && t.pnl_net <= 0) return false;
            if (tradeFilter === 'losses' && t.pnl_net > 0) return false;
            if (tradeFilter === 'long' && t.side !== 'LONG') return false;
            if (tradeFilter === 'short' && t.side !== 'SHORT') return false;
            if (tradeSearch.trim()) {
                const q = tradeSearch.toLowerCase();
                return (
                    String(t.id).includes(q) ||
                    t.side.toLowerCase().includes(q) ||
                    String(t.entry_price).includes(q) ||
                    String(t.exit_price).includes(q)
                );
            }
            return true;
        });
    }, [closedTrades, tradeFilter, tradeSearch]);

    if (!singleResult) return null;

    // 1. Optimization Results View
    if (Array.isArray(singleResult)) {
        const sortedResults = [...singleResult].sort((a, b) => {
            if (optSortBy === 'maxDrawdown') return Math.abs(a.maxDrawdown || 0) - Math.abs(b.maxDrawdown || 0);
            return (b[optSortBy] || 0) - (a[optSortBy] || 0);
        });
        const bestResult = sortedResults[0];

        if (!bestResult) {
            return (
                <div className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-xl p-8 text-center text-slate-400">
                    No configurations matched the minimum trades filter. Try lowering Min Trades or widening parameter ranges.
                </div>
            );
        }

        return (
            <div className="animate-fade-in space-y-5">
                {/* Champion Header */}
                <div className="bg-gradient-to-r from-blue-950/50 via-[#0A0A0A] to-purple-950/40 border border-blue-500/30 p-5 rounded-xl flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <Trophy className="text-amber-400 h-5 w-5" />
                            <h2 className="text-lg font-bold text-white">Optimization Champion</h2>
                            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/10 text-slate-300">
                                {sortedResults.length} valid runs
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {bestResult.params && Object.entries(bestResult.params).map(([key, value]) => (
                                <span key={key} className="px-2.5 py-1 bg-[#111] rounded text-xs text-blue-300 font-mono border border-blue-500/30">
                                    {key}: <span className="text-white font-bold">{String(value)}</span>
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-5">
                        <div className="text-right font-mono">
                            <p className={`text-2xl font-bold ${bestResult.profitPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {bestResult.profitPercent >= 0 ? '+' : ''}{bestResult.profitPercent}%
                            </p>
                            <p className="text-xs text-slate-400">
                                Sharpe: {bestResult.sharpeRatio} | Win: {bestResult.winRate}% | DD: -{Math.abs(bestResult.maxDrawdown || 0)}%
                            </p>
                        </div>
                        {onApplyOptimizationParams && bestResult.params && (
                            <button
                                onClick={() => onApplyOptimizationParams(bestResult.params)}
                                className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-brand-primary hover:opacity-90 text-white text-xs font-bold shadow-lg shadow-brand-primary/20 transition-all"
                            >
                                <PlayCircle size={15} /> Apply & Run Single
                            </button>
                        )}
                    </div>
                </div>

                {/* 2D Parameter Robustness Heatmap */}
                <ParameterHeatmap
                    results={sortedResults}
                    onSelectConfig={onApplyOptimizationParams}
                />

                {/* Top Configurations Table */}
                <div className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 dark:border-[#1F1F1F] flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <BarChart2 className="h-4 w-4 text-brand-primary" />
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                                Parameter Leaderboard
                            </h3>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px]">
                            <span className="text-slate-500">Sort:</span>
                            {([
                                { key: 'profitPercent', label: 'Profit' },
                                { key: 'sharpeRatio', label: 'Sharpe' },
                                { key: 'winRate', label: 'Win Rate' },
                                { key: 'maxDrawdown', label: 'Min DD' },
                            ] as const).map((s) => (
                                <button
                                    key={s.key}
                                    onClick={() => setOptSortBy(s.key)}
                                    className={`px-2 py-1 rounded font-semibold transition-colors ${
                                        optSortBy === s.key ? 'bg-brand-primary text-white' : 'bg-slate-100 dark:bg-[#111] text-slate-500 hover:text-slate-300'
                                    }`}
                                >
                                    {s.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="overflow-x-auto max-h-[380px] custom-scrollbar">
                        <table className="w-full text-xs text-left">
                            <thead className="bg-slate-50 dark:bg-[#111] text-slate-500 uppercase sticky top-0 z-10">
                                <tr>
                                    <th className="px-4 py-2.5">Rank</th>
                                    <th className="px-4 py-2.5 text-right">Profit %</th>
                                    <th className="px-4 py-2.5 text-right">Sharpe</th>
                                    <th className="px-4 py-2.5 text-right">Win Rate</th>
                                    <th className="px-4 py-2.5 text-right">Max DD</th>
                                    <th className="px-4 py-2.5 text-right">Trades</th>
                                    <th className="px-4 py-2.5">Parameters</th>
                                    {onApplyOptimizationParams && <th className="px-4 py-2.5 text-center">Action</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-[#1F1F1F] font-mono">
                                {sortedResults.slice(0, 50).map((res: any, idx: number) => (
                                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-[#111] transition-colors">
                                        <td className="px-4 py-2.5 text-slate-400">#{idx + 1}</td>
                                        <td className={`px-4 py-2.5 text-right font-bold ${res.profitPercent >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                            {res.profitPercent >= 0 ? '+' : ''}{res.profitPercent}%
                                        </td>
                                        <td className="px-4 py-2.5 text-right text-blue-400">{res.sharpeRatio}</td>
                                        <td className="px-4 py-2.5 text-right text-slate-300">{res.winRate}%</td>
                                        <td className="px-4 py-2.5 text-right text-rose-400">-{Math.abs(res.maxDrawdown || 0)}%</td>
                                        <td className="px-4 py-2.5 text-right text-slate-400">{res.total_trades}</td>
                                        <td className="px-4 py-2.5 text-[11px] text-slate-400">
                                            {res.params ? Object.entries(res.params).map(([k, v]) => `${k}=${v}`).join(', ') : '-'}
                                        </td>
                                        {onApplyOptimizationParams && (
                                            <td className="px-4 py-2.5 text-center font-sans">
                                                <button
                                                    onClick={() => res.params && onApplyOptimizationParams(res.params)}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-brand-primary/10 hover:bg-brand-primary text-brand-primary hover:text-white text-[11px] font-semibold transition-colors"
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
    }

    // 2. Single Backtest Pro Terminal View
    const normalizedEquity = (singleResult.equity_curve || []).map((d: any) => ({
        time: d.time !== undefined ? d.time : (typeof d.name === 'number' ? d.name : Math.floor(new Date(d.name).getTime() / 1000)),
        value: d.value,
    }));

    const underwaterData = (singleResult.underwater_data && singleResult.underwater_data.length > 0)
        ? singleResult.underwater_data
        : calculateDrawdownFromCandles(singleResult.candle_data || []);

    const adv = singleResult.advanced_metrics;
    const ta = singleResult.trade_analysis;
    const breakdown = singleResult.analytics_breakdown;
    const netProfit = ta?.net_profit ?? ((singleResult.final_value ?? 0) - (singleResult.initial_cash ?? 0));

    const handleInspectTrade = (trade: ClosedTrade) => {
        setFocusedTrade(trade);
        if (chartView === 'equity' || chartView === 'drawdown') {
            setChartView('split');
        }
    };

    const availableAnalyticsTabs = [
        { id: 'overview', label: 'Overview' },
        { id: 'performance', label: 'Performance & Timing' },
        { id: 'trades', label: `Trade Ledger (${closedTrades.length || singleResult.trades_log?.length || 0})` },
        ...(singleResult.monte_carlo ? [{ id: 'monte_carlo', label: 'Monte Carlo' }] : []),
    ];

    const currentAnalyticsTab = availableAnalyticsTabs.some((t) => t.id === resultsTab) ? resultsTab : 'overview';

    return (
        <div className="animate-fade-in space-y-4">
            {/* Compact Result Header Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#0A0A0A] px-4 py-3 rounded-xl border border-slate-200 dark:border-[#1F1F1F]">
                <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                        {singleResult.symbol || singleResult.market}
                    </h2>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-[#161616] text-slate-600 dark:text-slate-300 font-medium">
                        {singleResult.strategy}
                    </span>
                    {singleResult.leverage && (
                        <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-brand-primary/15 text-brand-primary">
                            {singleResult.leverage}x
                        </span>
                    )}
                    <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                        (singleResult.profit_percent ?? 0) >= 0 ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500'
                    }`}>
                        {(singleResult.profit_percent ?? 0) >= 0 ? '+' : ''}{singleResult.profit_percent}%
                    </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {onPinToCompare && (
                        <button
                            onClick={() => onPinToCompare(singleResult)}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                                isPinnedForCompare
                                    ? 'bg-purple-500/15 text-purple-400 border-purple-500/40'
                                    : 'border-slate-200 dark:border-[#1F1F1F] text-slate-500 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            <GitCompare size={13} /> {isPinnedForCompare ? 'Pinned' : 'Compare'}
                        </button>
                    )}

                    {onCopyConfig && (
                        <button
                            onClick={onCopyConfig}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-[#1F1F1F] text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
                            title="Copy strategy & risk JSON for Bot deployment"
                        >
                            <Copy size={13} /> Copy Config
                        </button>
                    )}

                    {(taskId || singleResult.report_file) && (
                        <button
                            onClick={handleDownloadReport}
                            disabled={isDownloading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-brand-primary hover:opacity-90 text-white disabled:opacity-50 transition-all"
                        >
                            <Download size={13} />
                            {isDownloading ? 'Exporting...' : 'PDF Report'}
                        </button>
                    )}
                </div>
            </div>

            {/* TOP PANE: Unified Chart Deck */}
            <div className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-xl p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex bg-slate-100 dark:bg-[#111] p-1 rounded-lg border border-slate-200 dark:border-[#1F1F1F]">
                        {[
                            { id: 'split', label: 'Split Deck', icon: SplitSquareVertical },
                            { id: 'price', label: 'Price + Signals', icon: BarChart2 },
                            { id: 'equity', label: 'Equity vs B&H', icon: TrendingUp },
                            { id: 'drawdown', label: 'Drawdown', icon: LineChartIcon },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setChartView(tab.id as any)}
                                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${
                                    chartView === tab.id
                                        ? 'bg-white dark:bg-[#222] text-slate-900 dark:text-white shadow-sm'
                                        : 'text-slate-500 hover:text-slate-300'
                                }`}
                            >
                                <tab.icon size={12} /> {tab.label}
                            </button>
                        ))}
                    </div>
                    <span className="text-[11px] text-slate-500 font-mono">
                        Tip: Click any row in Trade Ledger to jump directly to that trade
                    </span>
                </div>

                {chartView === 'split' && (
                    <div className="space-y-3">
                        <BacktestChart
                            data={singleResult.candle_data || []}
                            trades={singleResult.trades_log || []}
                            focusedTrade={focusedTrade}
                            onClearFocus={() => setFocusedTrade(null)}
                            height={340}
                        />
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <EquityChart
                                data={normalizedEquity}
                                benchmarkData={singleResult.benchmark_curve || []}
                                height={190}
                            />
                            <UnderwaterChart data={underwaterData} height={190} />
                        </div>
                    </div>
                )}

                {chartView === 'price' && (
                    <BacktestChart
                        data={singleResult.candle_data || []}
                        trades={singleResult.trades_log || []}
                        focusedTrade={focusedTrade}
                        onClearFocus={() => setFocusedTrade(null)}
                        height={460}
                    />
                )}

                {chartView === 'equity' && (
                    <EquityChart
                        data={normalizedEquity}
                        benchmarkData={singleResult.benchmark_curve || []}
                        height={400}
                    />
                )}

                {chartView === 'drawdown' && <UnderwaterChart data={underwaterData} height={340} />}
            </div>

            {/* BOTTOM PANE: High-Density Analytics Drawer */}
            <div className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-xl overflow-hidden">
                <div className="flex border-b border-slate-200 dark:border-[#1F1F1F] px-3 bg-slate-50 dark:bg-[#0F0F0F] overflow-x-auto">
                    {availableAnalyticsTabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setResultsTab(tab.id)}
                            className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-colors ${
                                currentAnalyticsTab === tab.id
                                    ? 'text-brand-primary border-b-2 border-brand-primary'
                                    : 'text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* OVERVIEW TAB */}
                {currentAnalyticsTab === 'overview' && (
                    <div className="p-4 space-y-5 animate-fade-in">
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                            <MetricCard label="Net P&L" value={netProfit} prefix="$" positive={netProfit >= 0} subtext={`Final: $${(singleResult.final_value ?? 0).toLocaleString()}`} />
                            <MetricCard label="CAGR" value={adv?.cagr ?? 0} suffix="%" positive={(adv?.cagr ?? 0) >= 0} />
                            <MetricCard label="Sharpe" value={singleResult.sharpeRatio ?? adv?.sharpe ?? 0} positive={(adv?.sharpe ?? 0) >= 1} />
                            <MetricCard label="Sortino" value={adv?.sortino ?? 0} positive={(adv?.sortino ?? 0) >= 1} />
                            <MetricCard label="Max Drawdown" value={singleResult.maxDrawdown ?? adv?.max_drawdown ?? 0} suffix="%" positive={false} />
                            <MetricCard label="Profit Factor" value={adv?.profit_factor ?? 0} positive={(adv?.profit_factor ?? 0) >= 1.2} />
                            <MetricCard label="Win Rate" value={singleResult.winRate ?? ta?.win_rate ?? adv?.win_rate ?? 0} suffix="%" />
                            <MetricCard
                                label="Expectancy"
                                value={breakdown?.expectancy ?? adv?.expectancy ?? 0}
                                prefix="$"
                                positive={(breakdown?.expectancy ?? 0) >= 0}
                                subtext={breakdown ? `SQN: ${breakdown.sqn}` : undefined}
                            />
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                            <div className="lg:col-span-8 bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F] rounded-xl p-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <Flame size={14} className="text-brand-primary" />
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                                        Monthly Returns Heatmap
                                    </h3>
                                </div>
                                {singleResult.heatmap_data && singleResult.heatmap_data.length > 0 ? (
                                    <MonthlyReturnsHeatmap data={singleResult.heatmap_data} />
                                ) : (
                                    <div className="h-36 flex items-center justify-center text-xs text-slate-500">
                                        Insufficient monthly periods for heatmap.
                                    </div>
                                )}
                            </div>

                            <div className="lg:col-span-4 bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F] rounded-xl p-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <BarChart2 size={14} className="text-blue-400" />
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                                        Daily Return Distribution
                                    </h3>
                                </div>
                                {singleResult.histogram_data && singleResult.histogram_data.length > 0 ? (
                                    <div className="h-[200px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={singleResult.histogram_data}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#1F1F1F" vertical={false} />
                                                <XAxis dataKey="range" stroke="#64748b" fontSize={9} tickFormatter={(v) => String(v).split(' ')[0]} />
                                                <YAxis stroke="#64748b" fontSize={10} />
                                                <Tooltip contentStyle={{ backgroundColor: '#0A0A0A', borderColor: '#1F1F1F', fontSize: '11px' }} />
                                                <Bar dataKey="frequency" name="Days" fill="#3B82F6" radius={[3, 3, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <div className="h-36 flex items-center justify-center text-xs text-slate-500">
                                        No return distribution data available.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* PERFORMANCE & TIMING TAB */}
                {currentAnalyticsTab === 'performance' && (
                    <div className="p-4 space-y-5 animate-fade-in">
                        {ta && (
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                                <MetricCard label="Closed Trades" value={ta.total_closed} decimals={0} />
                                <MetricCard label="Longs (Won)" value={`${ta.long_trades_total} (${ta.long_trades_won})`} />
                                <MetricCard label="Shorts (Won)" value={`${ta.short_trades_total} (${ta.short_trades_won})`} />
                                <MetricCard label="Avg Win / Loss" value={ta.ratio_avg_win_loss} suffix="x" positive={ta.ratio_avg_win_loss >= 1} />
                                <MetricCard label="Win Streak" value={breakdown?.max_consecutive_wins ?? 0} decimals={0} positive={true} />
                                <MetricCard label="Loss Streak" value={breakdown?.max_consecutive_losses ?? 0} decimals={0} positive={false} />
                            </div>
                        )}

                        {breakdown && (breakdown.by_weekday?.length > 0 || breakdown.by_hour?.length > 0) && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <div className="bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F] rounded-xl p-4">
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                                        <Calendar size={13} className="text-brand-primary" /> Day-of-Week Net PnL ($)
                                    </h3>
                                    <div className="h-[200px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={breakdown.by_weekday}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#1F1F1F" vertical={false} />
                                                <XAxis dataKey="day" stroke="#64748b" fontSize={11} />
                                                <YAxis stroke="#64748b" fontSize={10} />
                                                <Tooltip contentStyle={{ backgroundColor: '#0A0A0A', borderColor: '#1F1F1F', fontSize: '11px' }} />
                                                <Bar dataKey="pnl" name="Net PnL ($)" radius={[4, 4, 0, 0]}>
                                                    {breakdown.by_weekday.map((d, i) => (
                                                        <Cell key={i} fill={d.pnl >= 0 ? '#10B981' : '#EF4444'} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                <div className="bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F] rounded-xl p-4">
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                                        <Clock size={13} className="text-blue-400" /> Hour-of-Day Net PnL (UTC)
                                    </h3>
                                    <div className="h-[200px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={breakdown.by_hour}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#1F1F1F" vertical={false} />
                                                <XAxis dataKey="hour" stroke="#64748b" fontSize={10} />
                                                <YAxis stroke="#64748b" fontSize={10} />
                                                <Tooltip contentStyle={{ backgroundColor: '#0A0A0A', borderColor: '#1F1F1F', fontSize: '11px' }} />
                                                <Bar dataKey="pnl" name="Net PnL ($)" radius={[3, 3, 0, 0]}>
                                                    {breakdown.by_hour.map((h, i) => (
                                                        <Cell key={i} fill={h.pnl >= 0 ? '#10B981' : '#EF4444'} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {adv && (
                                <div className="border border-slate-200 dark:border-[#1F1F1F] rounded-xl overflow-hidden">
                                    <div className="px-4 py-2.5 bg-slate-50 dark:bg-[#111] border-b border-slate-200 dark:border-[#1F1F1F] flex items-center gap-2">
                                        <Activity size={13} className="text-brand-primary" />
                                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">QuantStats Ratios</h3>
                                    </div>
                                    <table className="w-full text-xs">
                                        <tbody className="divide-y divide-slate-200 dark:divide-[#1F1F1F]">
                                            {Object.entries(adv).map(([key, value]) => (
                                                <tr key={key} className="hover:bg-slate-50 dark:hover:bg-[#111]">
                                                    <td className="px-4 py-2 text-slate-500 capitalize">{key.replace(/_/g, ' ')}</td>
                                                    <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900 dark:text-white">
                                                        {typeof value === 'number' ? value.toFixed(2) : String(value)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {ta && (
                                <div className="border border-slate-200 dark:border-[#1F1F1F] rounded-xl overflow-hidden">
                                    <div className="px-4 py-2.5 bg-slate-50 dark:bg-[#111] border-b border-slate-200 dark:border-[#1F1F1F] flex items-center gap-2">
                                        <Layers size={13} className="text-blue-400" />
                                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">Trade Statistics</h3>
                                    </div>
                                    <table className="w-full text-xs">
                                        <tbody className="divide-y divide-slate-200 dark:divide-[#1F1F1F]">
                                            {[
                                                ['Gross Profit', `$${ta.gross_profit}`],
                                                ['Net Profit', `$${ta.net_profit}`],
                                                ['Avg Trade PnL', `$${ta.avg_pnl}`],
                                                ['Avg Winning Trade', `$${ta.avg_win}`],
                                                ['Avg Losing Trade', `$${ta.avg_loss}`],
                                                ['Largest Win', `$${ta.largest_win_value} (${ta.largest_win_percent}%)`],
                                                ['Largest Loss', `$${ta.largest_loss_value} (${ta.largest_loss_percent}%)`],
                                                ['Avg Hold Duration', `${breakdown?.avg_duration_hours ?? 0} hrs`],
                                            ].map(([label, val]) => (
                                                <tr key={label} className="hover:bg-slate-50 dark:hover:bg-[#111]">
                                                    <td className="px-4 py-2 text-slate-500">{label}</td>
                                                    <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900 dark:text-white">{val}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* TRADE LEDGER TAB */}
                {currentAnalyticsTab === 'trades' && (
                    <div className="flex flex-col h-[460px] animate-fade-in">
                        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-[#1F1F1F] bg-slate-50 dark:bg-[#111] flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                                {(['all', 'wins', 'losses', 'long', 'short'] as const).map((f) => (
                                    <button
                                        key={f}
                                        onClick={() => setTradeFilter(f)}
                                        className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase transition-colors ${
                                            tradeFilter === f
                                                ? 'bg-brand-primary text-white'
                                                : 'bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] text-slate-500'
                                        }`}
                                    >
                                        {f}
                                    </button>
                                ))}
                            </div>

                            <div className="flex items-center gap-2">
                                <div className="relative">
                                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                                    <input
                                        type="text"
                                        value={tradeSearch}
                                        onChange={(e) => setTradeSearch(e.target.value)}
                                        placeholder="Filter #, price..."
                                        className="pl-7 pr-2.5 py-1 bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded text-xs font-mono text-slate-900 dark:text-white outline-none focus:border-brand-primary"
                                    />
                                </div>
                                <button
                                    onClick={() =>
                                        exportTradesCSV(
                                            closedTrades.length ? closedTrades : (singleResult.trades_log || []),
                                            `trades_${(singleResult.symbol || 'backtest').replace('/', '_')}.csv`
                                        )
                                    }
                                    className="flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-[#1F1F1F] text-xs font-semibold text-slate-500 hover:text-white"
                                >
                                    <Download size={12} /> CSV
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto custom-scrollbar">
                            {closedTrades.length > 0 ? (
                                <table className="w-full text-xs text-left">
                                    <thead className="bg-slate-50 dark:bg-[#111] text-slate-500 uppercase text-[10px] sticky top-0 z-10">
                                        <tr>
                                            <th className="px-3 py-2">#</th>
                                            <th className="px-3 py-2">Side</th>
                                            <th className="px-3 py-2">Entry Time</th>
                                            <th className="px-3 py-2">Exit Time</th>
                                            <th className="px-3 py-2 text-right">Entry</th>
                                            <th className="px-3 py-2 text-right">Exit</th>
                                            <th className="px-3 py-2 text-right">Size</th>
                                            <th className="px-3 py-2 text-right">Dur</th>
                                            <th className="px-3 py-2 text-right">MAE / MFE</th>
                                            <th className="px-3 py-2 text-right">R</th>
                                            <th className="px-3 py-2 text-right">Net P&L</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 dark:divide-[#1F1F1F] font-mono">
                                        {filteredClosedTrades.map((t) => {
                                            const isFocused = focusedTrade?.id === t.id;
                                            return (
                                                <tr
                                                    key={t.id}
                                                    onClick={() => handleInspectTrade(t)}
                                                    className={`cursor-pointer transition-colors ${
                                                        isFocused
                                                            ? 'bg-brand-primary/15'
                                                            : 'hover:bg-slate-50 dark:hover:bg-[#111]'
                                                    }`}
                                                >
                                                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400">#{t.id}</td>
                                                    <td className={`px-3 py-2 font-bold ${t.side === 'LONG' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                        {t.side}
                                                    </td>
                                                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{new Date(t.entry_time * 1000).toLocaleString()}</td>
                                                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{new Date(t.exit_time * 1000).toLocaleString()}</td>
                                                    <td className="px-3 py-2 text-right text-slate-900 dark:text-slate-200">{t.entry_price.toFixed(2)}</td>
                                                    <td className="px-3 py-2 text-right text-slate-900 dark:text-slate-200">{t.exit_price.toFixed(2)}</td>
                                                    <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-400">{t.size.toFixed(4)}</td>
                                                    <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-400">{formatDuration(t.duration_seconds)}</td>
                                                    <td className="px-3 py-2 text-right text-[11px]">
                                                        <span className="text-rose-500 dark:text-rose-400">{t.mae_pct}%</span> / <span className="text-emerald-500 dark:text-emerald-400">+{t.mfe_pct}%</span>
                                                    </td>
                                                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                                                        {t.r_multiple !== null ? `${t.r_multiple}R` : '-'}
                                                    </td>
                                                    <td className={`px-3 py-2 text-right font-bold ${t.pnl_net >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                        {t.pnl_net >= 0 ? '+' : ''}${t.pnl_net.toFixed(2)} ({t.return_pct}%)
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            ) : (
                                <table className="w-full text-xs text-left">
                                    <thead className="bg-slate-50 dark:bg-[#111] text-slate-500 uppercase text-[10px] sticky top-0 z-10">
                                        <tr>
                                            <th className="px-4 py-2">Type</th>
                                            <th className="px-4 py-2 text-right">Price</th>
                                            <th className="px-4 py-2 text-right">Size</th>
                                            <th className="px-4 py-2">Time</th>
                                            <th className="px-4 py-2 text-right">P/L</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 dark:divide-[#1F1F1F] font-mono">
                                        {singleResult.trades_log?.map((trade: any, idx: number) => (
                                            <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-[#111]">
                                                <td className={`px-4 py-2 font-bold ${trade.side === 'BUY' || trade.type === 'buy' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                    {trade.side || trade.type || (trade.size > 0 ? 'BUY' : 'SELL')}
                                                </td>
                                                <td className="px-4 py-2 text-right text-slate-300">{trade.price?.toFixed(2)}</td>
                                                <td className="px-4 py-2 text-right text-slate-300">{trade.size?.toFixed(4) || '-'}</td>
                                                <td className="px-4 py-2 text-slate-400">{new Date(trade.time * 1000).toLocaleString()}</td>
                                                <td className={`px-4 py-2 text-right ${trade.pnl >= 0 ? 'text-emerald-500' : trade.pnl < 0 ? 'text-rose-500' : 'text-slate-400'}`}>
                                                    {trade.pnl !== undefined ? trade.pnl.toFixed(2) : '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                )}

                {/* MONTE CARLO TAB */}
                {currentAnalyticsTab === 'monte_carlo' && singleResult.monte_carlo && (
                    <div className="p-4 animate-fade-in">
                        <MonteCarloCard metrics={singleResult.monte_carlo} />
                    </div>
                )}
            </div>
        </div>
    );
};
