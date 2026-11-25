import React from 'react';
import {
    BarChart2,
    Database,
    Pin,
    Play,
    Rocket,
    RotateCcw,
    Sparkles,
    Trash2,
    Trophy,
    Zap,
} from 'lucide-react';
import type { CustomMLModel } from '@/types';
import type { ModelCompareItem } from '@/services/trainingStudioToolsService';

export interface RegistryTableViewProps {
    models: CustomMLModel[];
    compareMap: Record<string, ModelCompareItem>;
    championId?: string | null;
    pinnedModelId?: string | null;
    retrainingId?: string | null;
    onInspect: (modelId: string, modelName: string, tab?: 'config' | 'explain' | 'replay' | 'optuna') => void;
    onGenerateSignal: (model: CustomMLModel) => void;
    onPinToggle: (model: CustomMLModel, symbol?: string | null) => void;
    onDeploy: (model: CustomMLModel, cmp?: ModelCompareItem) => void;
    onQuickRetrain: (modelId: string) => void;
    onDownloadDataset: (modelId: string, modelName: string) => void;
    onDelete: (model: CustomMLModel) => void;
}

export const RegistryTableView: React.FC<RegistryTableViewProps> = ({
    models,
    compareMap,
    championId,
    pinnedModelId,
    retrainingId,
    onInspect,
    onGenerateSignal,
    onPinToggle,
    onDeploy,
    onQuickRetrain,
    onDownloadDataset,
    onDelete,
}) => {
    return (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-white/10 bg-white/90 dark:bg-[#0A0A0A]/80 backdrop-blur-lg shadow-lg">
            <table className="w-full min-w-[1120px] text-left text-xs">
                <thead className="border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    <tr>
                        <th className="px-4 py-3.5">Model / Version</th>
                        <th className="px-3 py-3.5">Market / Arch</th>
                        <th className="px-3 py-3.5">Status</th>
                        <th className="px-3 py-3.5">Accuracy / WR</th>
                        <th className="px-3 py-3.5">OOS Return</th>
                        <th className="px-3 py-3.5">Max DD</th>
                        <th className="px-3 py-3.5">Kelly %</th>
                        <th className="px-3 py-3.5">Latency</th>
                        <th className="px-4 py-3.5 text-right">Quant Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-white/[0.06]">
                    {models.map((model) => {
                        const activeVersion = model.versions.find((v) => v.id === model.activeVersionId) || model.versions[0];
                        const cmp = compareMap[model.id];
                        const isChampion = championId === model.id;
                        const isPinned = pinnedModelId === model.id;
                        const isReady = activeVersion?.status === 'Ready';
                        const isRetraining = retrainingId === model.id;

                        const rawAcc = activeVersion?.accuracy ?? cmp?.accuracy;
                        const accStr =
                            rawAcc !== undefined && rawAcc !== null
                                ? rawAcc <= 1 && rawAcc >= 0
                                    ? `${(rawAcc * 100).toFixed(1)}%`
                                    : `${rawAcc.toFixed(2)}`
                                : '--';

                        const lat = activeVersion?.latency ?? cmp?.latency;
                        const latStr = typeof lat === 'number' ? `${Math.round(lat)} ms` : '--';

                        return (
                            <tr
                                key={model.id}
                                className="hover:bg-slate-50/90 dark:hover:bg-white/[0.03] transition-colors cursor-pointer"
                                onClick={() => onInspect(model.id, model.name, 'config')}
                            >
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-bold text-slate-900 dark:text-white">{model.name}</span>
                                        <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 font-mono text-[10px] border border-cyan-500/20">
                                            v{activeVersion?.version?.toFixed(1) || '1.0'}
                                        </span>
                                        {isChampion && (
                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[10px] font-bold">
                                                <Trophy className="w-2.5 h-2.5" /> Champion
                                            </span>
                                        )}
                                        {isPinned && (
                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                                                <Pin className="w-2.5 h-2.5" /> Pinned
                                            </span>
                                        )}
                                        {cmp && cmp.optuna_trials_count > 0 && (
                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/25 text-[10px]">
                                                <Sparkles className="w-2.5 h-2.5" /> {cmp.optuna_trials_count} Optuna
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[260px] mt-0.5">
                                        {activeVersion?.description || model.id}
                                    </p>
                                </td>

                                <td className="px-3 py-3">
                                    <div className="flex flex-col gap-0.5">
                                        <span className="font-semibold text-slate-800 dark:text-slate-200">{model.modelType}</span>
                                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                            {cmp?.symbol ? `${cmp.symbol} • ${cmp.timeframe || '1h'}` : model.marketType || 'crypto'}
                                        </span>
                                    </div>
                                </td>

                                <td className="px-3 py-3">
                                    <span
                                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                                            isReady
                                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                                                : activeVersion?.status === 'Processing'
                                                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
                                                : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30'
                                        }`}
                                    >
                                        {activeVersion?.status || 'Unknown'}
                                    </span>
                                </td>

                                <td className="px-3 py-3 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                                    {accStr}
                                    {cmp?.win_rate != null && (
                                        <span className="block text-[10px] font-normal text-slate-500 dark:text-slate-400">
                                            WR {cmp.win_rate.toFixed(1)}%
                                        </span>
                                    )}
                                </td>

                                <td
                                    className={`px-3 py-3 font-mono font-bold ${
                                        cmp?.profit_pct != null
                                            ? cmp.profit_pct >= 0
                                                ? 'text-emerald-600 dark:text-emerald-400'
                                                : 'text-rose-600 dark:text-rose-400'
                                            : 'text-slate-400'
                                    }`}
                                >
                                    {cmp?.profit_pct != null ? `${cmp.profit_pct >= 0 ? '+' : ''}${cmp.profit_pct.toFixed(2)}%` : '--'}
                                </td>

                                <td className="px-3 py-3 font-mono text-rose-600 dark:text-rose-400">
                                    {cmp?.max_drawdown != null ? `-${cmp.max_drawdown.toFixed(2)}%` : '--'}
                                </td>

                                <td className="px-3 py-3 font-mono text-purple-600 dark:text-purple-400">
                                    {cmp?.kelly_pct != null ? `${cmp.kelly_pct.toFixed(1)}%` : '--'}
                                </td>

                                <td className="px-3 py-3 font-mono text-slate-700 dark:text-slate-300">{latStr}</td>

                                <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                    <div className="inline-flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => onInspect(model.id, model.name, 'replay')}
                                            className="p-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/20"
                                            title="OOS Paper Replay"
                                        >
                                            <Play className="w-3.5 h-3.5" />
                                        </button>

                                        <button
                                            type="button"
                                            disabled={!isReady}
                                            onClick={() => onGenerateSignal(model)}
                                            className="p-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 disabled:opacity-40"
                                            title="Generate Live Signal"
                                        >
                                            <Zap className="w-3.5 h-3.5" />
                                        </button>

                                        <button
                                            type="button"
                                            disabled={!isReady}
                                            onClick={() => onPinToggle(model, cmp?.symbol)}
                                            className={`p-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
                                                isPinned
                                                    ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                                                    : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-emerald-500/40'
                                            }`}
                                            title={isPinned ? 'Unpin Manual Trade Filter' : 'Pin to Manual Trade Filter'}
                                        >
                                            <Pin className="w-3.5 h-3.5" />
                                        </button>

                                        <button
                                            type="button"
                                            disabled={!isReady}
                                            onClick={() => onDeploy(model, cmp)}
                                            className="p-1.5 rounded-lg border border-blue-500/35 bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20 disabled:opacity-40"
                                            title="Deploy to Trading Bot"
                                        >
                                            <Rocket className="w-3.5 h-3.5" />
                                        </button>

                                        <button
                                            type="button"
                                            disabled={isRetraining}
                                            onClick={() => onQuickRetrain(model.id)}
                                            className="p-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-500/20 disabled:opacity-40"
                                            title="1-Click Retrain"
                                        >
                                            <RotateCcw className={`w-3.5 h-3.5 ${isRetraining ? 'animate-spin' : ''}`} />
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => onInspect(model.id, model.name, 'optuna')}
                                            className="p-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-purple-500/40"
                                            title="Optuna Trials & Explainability"
                                        >
                                            <BarChart2 className="w-3.5 h-3.5" />
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => onDownloadDataset(model.id, model.name)}
                                            className="p-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-emerald-500/40"
                                            title="Download Dataset Snapshot"
                                        >
                                            <Database className="w-3.5 h-3.5" />
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => onDelete(model)}
                                            className="p-1.5 rounded-lg border border-transparent text-slate-400 hover:text-rose-500 hover:bg-rose-500/10"
                                            title="Delete Model"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

export default RegistryTableView;
