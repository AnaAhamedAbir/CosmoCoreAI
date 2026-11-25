import React from 'react';
import {
    Activity,
    Cpu,
    FolderUp,
    GitCompare,
    LayoutGrid,
    List,
    Pin,
    PinOff,
    Plus,
    RefreshCw,
    Search,
    Sparkles,
    Trophy,
    Zap,
} from 'lucide-react';
import Button from '@/components/common/Button';
import type { ManualTradePinInfo, ModelCompareItem } from '@/services/trainingStudioToolsService';

export type RegistryFilter =
    | 'all'
    | 'ready'
    | 'processing'
    | 'error'
    | 'crypto'
    | 'forex'
    | 'pinned'
    | 'backtested';

export type RegistrySort =
    | 'newest'
    | 'profit_desc'
    | 'accuracy_desc'
    | 'sharpe_desc'
    | 'dd_asc'
    | 'latency_asc'
    | 'name_asc';

export interface RegistryHeaderProps {
    totalModels: number;
    readyCount: number;
    processingCount: number;
    errorCount: number;
    avgAccuracyPct: number | null;
    avgLatencyMs: number | null;
    championModel: ModelCompareItem | null;
    pinnedModel: ManualTradePinInfo | null;
    activeJobsCount: number;
    searchQuery: string;
    onSearchChange: (q: string) => void;
    activeFilter: RegistryFilter;
    onFilterChange: (f: RegistryFilter) => void;
    sortBy: RegistrySort;
    onSortChange: (s: RegistrySort) => void;
    viewMode: 'grid' | 'table';
    onViewModeChange: (v: 'grid' | 'table') => void;
    isUploadingFolder: boolean;
    onTriggerFolderUpload: () => void;
    onOpenNewModel: () => void;
    onOpenCompare: () => void;
    onUnpinModel: () => void;
    onRefresh: () => void;
    isRefreshing?: boolean;
}

const FILTER_OPTIONS: { key: RegistryFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'ready', label: 'Ready' },
    { key: 'processing', label: 'Processing' },
    { key: 'error', label: 'Error' },
    { key: 'crypto', label: 'Crypto' },
    { key: 'forex', label: 'Forex' },
    { key: 'backtested', label: 'With Backtest' },
    { key: 'pinned', label: 'Pinned' },
];

export const RegistryHeader: React.FC<RegistryHeaderProps> = ({
    totalModels,
    readyCount,
    processingCount,
    errorCount,
    avgAccuracyPct,
    avgLatencyMs,
    championModel,
    pinnedModel,
    activeJobsCount,
    searchQuery,
    onSearchChange,
    activeFilter,
    onFilterChange,
    sortBy,
    onSortChange,
    viewMode,
    onViewModeChange,
    isUploadingFolder,
    onTriggerFolderUpload,
    onOpenNewModel,
    onOpenCompare,
    onUnpinModel,
    onRefresh,
    isRefreshing = false,
}) => {
    return (
        <div className="space-y-4">
            {/* Top Bar */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white/85 dark:bg-[#0A0A0A]/75 backdrop-blur-lg border border-slate-200 dark:border-white/10 p-5 rounded-2xl shadow-lg">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-gradient-to-br from-brand-primary to-purple-600 rounded-xl shadow-lg shadow-brand-primary/20 text-white shrink-0">
                        <Cpu className="w-7 h-7" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2.5 flex-wrap">
                            <h2 className="text-2xl md:text-3xl laptop:text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                                Quant Model Registry
                            </h2>
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/25">
                                Institutional ML Ops
                            </span>
                        </div>
                        <p className="text-xs md:text-sm text-slate-500 dark:text-gray-400 mt-1 font-medium">
                            Versioned alpha models, OOS paper replay, Optuna telemetry, and 1-click Bot Lab deployment.
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto justify-end">
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={isRefreshing}
                        className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:border-cyan-500/40 transition-all disabled:opacity-50"
                        title="Refresh Models & Telemetry"
                    >
                        <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                        <span className="hidden sm:inline">Sync</span>
                    </button>

                    <button
                        type="button"
                        onClick={onOpenCompare}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-cyan-500/35 bg-cyan-500/10 hover:bg-cyan-500/20 text-xs font-bold text-cyan-700 dark:text-cyan-300 transition-all shadow-sm"
                    >
                        <GitCompare className="w-4 h-4" />
                        Compare Matrix
                    </button>

                    <Button
                        variant="secondary"
                        onClick={onTriggerFolderUpload}
                        disabled={isUploadingFolder}
                        className="px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 border border-brand-primary/30 text-xs"
                    >
                        <FolderUp className="w-4 h-4" />
                        {isUploadingFolder ? 'Uploading...' : 'Upload Folder'}
                    </Button>

                    <Button
                        variant="primary"
                        onClick={onOpenNewModel}
                        className="shadow-lg shadow-brand-primary/30 hover:scale-[1.02] transition-transform px-4 py-2.5 rounded-xl font-bold flex items-center gap-1.5 text-xs"
                    >
                        <Plus className="w-4 h-4" />
                        Initialize Model
                    </Button>
                </div>
            </div>

            {/* Quant Telemetry KPI Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {/* 1. Fleet Status */}
                <div className="bg-white/85 dark:bg-[#0A0A0A]/70 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                            Model Fleet
                        </span>
                        <Sparkles className="w-3.5 h-3.5 text-cyan-500" />
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-mono font-black text-slate-900 dark:text-white">
                            {readyCount}
                        </span>
                        <span className="text-xs font-mono text-slate-500 dark:text-gray-400">
                            / {totalModels} Ready
                        </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[10px] font-semibold">
                        {processingCount > 0 && (
                            <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/25">
                                {processingCount} Processing
                            </span>
                        )}
                        {errorCount > 0 && (
                            <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/25">
                                {errorCount} Error
                            </span>
                        )}
                        {activeJobsCount > 0 && (
                            <span className="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/25">
                                {activeJobsCount} Training
                            </span>
                        )}
                        {processingCount === 0 && errorCount === 0 && activeJobsCount === 0 && (
                            <span className="text-emerald-600 dark:text-emerald-400">All workers idle & nominal</span>
                        )}
                    </div>
                </div>

                {/* 2. Champion OOS Performer */}
                <div className="bg-white/85 dark:bg-[#0A0A0A]/70 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                            Champion OOS Alpha
                        </span>
                        <Trophy className="w-3.5 h-3.5 text-amber-500" />
                    </div>
                    {championModel ? (
                        <>
                            <div className="flex items-baseline justify-between gap-2">
                                <span
                                    className={`text-2xl font-mono font-black ${
                                        (championModel.profit_pct ?? 0) >= 0
                                            ? 'text-emerald-600 dark:text-emerald-400'
                                            : 'text-rose-600 dark:text-rose-400'
                                    }`}
                                >
                                    {(championModel.profit_pct ?? 0) >= 0 ? '+' : ''}
                                    {(championModel.profit_pct ?? 0).toFixed(2)}%
                                </span>
                                {championModel.win_rate != null && (
                                    <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                                        {championModel.win_rate.toFixed(1)}% WR
                                    </span>
                                )}
                            </div>
                            <p className="mt-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate">
                                {championModel.name}{' '}
                                <span className="text-slate-400 font-mono">({championModel.algorithm})</span>
                            </p>
                        </>
                    ) : (
                        <div className="text-xs text-slate-500 dark:text-gray-400 pt-2">
                            Run post-training backtest or OOS replay to rank models.
                        </div>
                    )}
                </div>

                {/* 3. Average Efficacy & Latency */}
                <div className="bg-white/85 dark:bg-[#0A0A0A]/70 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                            Avg Accuracy / Latency
                        </span>
                        <Activity className="w-3.5 h-3.5 text-purple-500" />
                    </div>
                    <div className="flex items-baseline gap-3">
                        <span className="text-2xl font-mono font-black text-indigo-600 dark:text-indigo-400">
                            {avgAccuracyPct !== null ? `${avgAccuracyPct.toFixed(1)}%` : '--'}
                        </span>
                        <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                            {avgLatencyMs !== null ? `${Math.round(avgLatencyMs)} ms` : '-- ms'}
                        </span>
                    </div>
                    <p className="mt-2 text-[10px] text-slate-500 dark:text-gray-400">
                        Across ready active model versions
                    </p>
                </div>

                {/* 4. Manual Trade Pin Status */}
                <div className="bg-white/85 dark:bg-[#0A0A0A]/70 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                            Manual Trade AI Filter
                        </span>
                        <Zap className="w-3.5 h-3.5 text-emerald-500" />
                    </div>
                    {pinnedModel ? (
                        <>
                            <div className="flex items-center justify-between gap-2">
                                <span className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-600 dark:text-emerald-400 truncate">
                                    <Pin className="w-3.5 h-3.5 shrink-0" />
                                    {pinnedModel.model_name}
                                </span>
                                <button
                                    type="button"
                                    onClick={onUnpinModel}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/25 hover:bg-rose-500/20 shrink-0"
                                    title="Unpin Manual Trade AI Filter"
                                >
                                    <PinOff className="w-3 h-3" /> Unpin
                                </button>
                            </div>
                            <p className="mt-2 text-[10px] font-mono text-slate-500 dark:text-gray-400">
                                {pinnedModel.algorithm} • Min Conf {(pinnedModel.min_confidence * 100).toFixed(0)}%
                            </p>
                        </>
                    ) : (
                        <>
                            <span className="text-sm font-bold text-slate-500 dark:text-gray-400">Not Pinned</span>
                            <p className="mt-2 text-[10px] text-slate-500 dark:text-gray-400">
                                Click Pin on any Ready model to filter live manual entries.
                            </p>
                        </>
                    )}
                </div>
            </div>

            {/* Search, Filter Pills, Sort & View Toggle Bar */}
            <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3 bg-white/80 dark:bg-[#0A0A0A]/65 backdrop-blur-md border border-slate-200 dark:border-white/10 p-3.5 rounded-2xl">
                {/* Search & Filters */}
                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 flex-1 min-w-0">
                    <div className="relative md:w-72 shrink-0">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => onSearchChange(e.target.value)}
                            placeholder="Search model, symbol, algo, feature..."
                            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-cyan-500"
                        />
                    </div>

                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
                        {FILTER_OPTIONS.map((opt) => {
                            const active = activeFilter === opt.key;
                            return (
                                <button
                                    key={opt.key}
                                    type="button"
                                    onClick={() => onFilterChange(opt.key)}
                                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all border ${
                                        active
                                            ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/40'
                                            : 'bg-slate-50 dark:bg-white/[0.03] text-slate-600 dark:text-gray-400 border-slate-200 dark:border-white/10 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Sort & View Mode */}
                <div className="flex items-center justify-between xl:justify-end gap-2.5 shrink-0">
                    <select
                        value={sortBy}
                        onChange={(e) => onSortChange(e.target.value as RegistrySort)}
                        className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-cyan-500"
                    >
                        <option value="newest">Sort: Newest</option>
                        <option value="profit_desc">Sort: OOS Return ↓</option>
                        <option value="accuracy_desc">Sort: Accuracy / Win Rate ↓</option>
                        <option value="sharpe_desc">Sort: F1 / Sharpe ↓</option>
                        <option value="dd_asc">Sort: Lowest Max DD ↑</option>
                        <option value="latency_asc">Sort: Lowest Latency ↑</option>
                        <option value="name_asc">Sort: Name A-Z</option>
                    </select>

                    <div className="flex items-center bg-slate-100 dark:bg-black/40 p-1 rounded-xl border border-slate-200 dark:border-white/10">
                        <button
                            type="button"
                            onClick={() => onViewModeChange('grid')}
                            className={`p-1.5 rounded-lg transition-all ${
                                viewMode === 'grid'
                                    ? 'bg-white dark:bg-white/15 text-cyan-600 dark:text-cyan-300 shadow-sm'
                                    : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                            title="Card Grid View"
                        >
                            <LayoutGrid className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => onViewModeChange('table')}
                            className={`p-1.5 rounded-lg transition-all ${
                                viewMode === 'table'
                                    ? 'bg-white dark:bg-white/15 text-cyan-600 dark:text-cyan-300 shadow-sm'
                                    : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                            title="Quant Matrix Table View"
                        >
                            <List className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RegistryHeader;
