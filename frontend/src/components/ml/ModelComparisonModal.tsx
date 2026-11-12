import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart2,
  Cpu,
  GitCompare,
  Loader2,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';
import {
  ModelCompareItem,
  trainingStudioToolsService,
} from '@/services/trainingStudioToolsService';
import { OptunaTrialsChart } from '@/components/ml/OptunaTrialsChart';
import { PaperReplayPreview } from '@/components/ml/PaperReplayPreview';

export interface ModelComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDeploy?: (modelId: string) => void;
  onRetrainSuccess?: (jobId: string) => void;
}

type SortKey =
  | 'accuracy'
  | 'f1_score'
  | 'profit_pct'
  | 'win_rate'
  | 'max_drawdown'
  | 'kelly_pct'
  | 'latency';

type SortDir = 'asc' | 'desc';

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'accuracy', label: 'Accuracy' },
  { key: 'f1_score', label: 'F1' },
  { key: 'profit_pct', label: 'Profit %' },
  { key: 'win_rate', label: 'Win Rate' },
  { key: 'max_drawdown', label: 'Max DD' },
  { key: 'kelly_pct', label: 'Kelly %' },
  { key: 'latency', label: 'Latency' },
];

function formatPercentAuto(val?: number | null, digits = 1): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '--';
  const normalized = val >= 0 && val <= 1 ? val * 100 : val;
  return `${normalized.toFixed(digits)}%`;
}

function formatPctDirect(val?: number | null, signed = false): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '--';
  const prefix = signed && val > 0 ? '+' : '';
  return `${prefix}${val.toFixed(2)}%`;
}

export const ModelComparisonModal: React.FC<ModelComparisonModalProps> = ({
  isOpen,
  onClose,
  onOpenDeploy,
  onRetrainSuccess,
}) => {
  const [models, setModels] = useState<ModelCompareItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('profit_pct');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedModel, setSelectedModel] = useState<ModelCompareItem | null>(null);
  const [retrainingIds, setRetrainingIds] = useState<Record<string, boolean>>({});

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await trainingStudioToolsService.compareModels();
      setModels(items);
      setSelectedModel((prev) =>
        prev ? items.find((m) => m.model_id === prev.model_id) ?? null : null,
      );
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail || err?.message || 'Failed to load model comparison matrix.';
      setError(typeof msg === 'string' ? msg : 'Failed to load model comparison matrix.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadModels();
  }, [isOpen, loadModels]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      // Lower latency & lower max_drawdown default to asc; others desc
      setSortDir(key === 'latency' ? 'asc' : 'desc');
    }
  };

  const handleRetrain = async (model: ModelCompareItem) => {
    if (retrainingIds[model.model_id]) return;
    setRetrainingIds((prev) => ({ ...prev, [model.model_id]: true }));
    try {
      const res = await trainingStudioToolsService.triggerOneClickRetrain(model.model_id);
      toast.success(
        `Retrain queued for ${model.name} (${res.symbol} ${res.timeframe}) • Job ${res.job_id.slice(0, 8)}`,
      );
      onRetrainSuccess?.(res.job_id);
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail || err?.message || `Failed to retrain ${model.name}`;
      toast.error(typeof msg === 'string' ? msg : '1-Click Retrain failed.');
    } finally {
      setRetrainingIds((prev) => ({ ...prev, [model.model_id]: false }));
    }
  };

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? models.filter((m) => {
          const featureMatch = (m.top_features ?? []).some((f) =>
            f.name.toLowerCase().includes(q),
          );
          return (
            m.name.toLowerCase().includes(q) ||
            m.algorithm.toLowerCase().includes(q) ||
            (m.symbol ?? '').toLowerCase().includes(q) ||
            (m.timeframe ?? '').toLowerCase().includes(q) ||
            (m.data_source ?? '').toLowerCase().includes(q) ||
            featureMatch
          );
        })
      : models;

    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const aValid = typeof av === 'number' && Number.isFinite(av);
      const bValid = typeof bv === 'number' && Number.isFinite(bv);

      if (!aValid && !bValid) return 0;
      if (!aValid) return 1;
      if (!bValid) return -1;

      const diff = (av as number) - (bv as number);
      return sortDir === 'asc' ? diff : -diff;
    });
  }, [models, searchQuery, sortDir, sortKey]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-3 sm:p-6 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-cyan-500/30 bg-[#0B1121]/95 shadow-[0_0_60px_rgba(6,182,212,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-white/[0.02] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/20 via-purple-500/20 to-emerald-500/20 text-cyan-300">
              <GitCompare className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white sm:text-lg">
                Crypto ML Model Comparison Matrix
              </h2>
              <p className="text-xs text-slate-400">
                Compare accuracy, risk-adjusted returns, Optuna trials, and run live OOS replay
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter symbol, algo, feature..."
                className="w-56 rounded-xl border border-slate-700/80 bg-slate-900/90 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-500"
              />
            </div>

            <button
              type="button"
              onClick={() => void loadModels()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-cyan-500/40 hover:text-white disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>

            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close model comparison modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error && (
            <div className="flex items-start gap-2 rounded-2xl border border-rose-500/35 bg-rose-500/10 p-3.5 text-xs text-rose-300">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {loading && models.length === 0 ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/50">
              <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
              <p className="mt-2.5 text-xs text-slate-400">
                Loading trained Crypto ML models & backtest telemetry...
              </p>
            </div>
          ) : filteredAndSorted.length === 0 ? (
            <div className="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center">
              <Cpu className="mb-2 h-7 w-7 text-slate-500" />
              <p className="text-sm font-semibold text-slate-300">No matching models found</p>
              <p className="mt-1 text-xs text-slate-500">
                {searchQuery
                  ? 'Try clearing your search filter.'
                  : 'Train a Crypto ML model in the studio to compare performance here.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
              <table className="w-full min-w-[1040px] text-left text-xs">
                <thead className="border-b border-slate-800 bg-slate-900/90 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Model / Features</th>
                    {SORT_COLUMNS.map((col) => {
                      const active = sortKey === col.key;
                      return (
                        <th key={col.key} className="px-3 py-3">
                          <button
                            type="button"
                            onClick={() => handleSort(col.key)}
                            className={`inline-flex items-center gap-1 transition-colors hover:text-cyan-300 ${
                              active ? 'text-cyan-400' : 'text-slate-400'
                            }`}
                          >
                            <span>{col.label}</span>
                            {active ? (
                              sortDir === 'desc' ? (
                                <ArrowDown className="h-3 w-3" />
                              ) : (
                                <ArrowUp className="h-3 w-3" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 opacity-50" />
                            )}
                          </button>
                        </th>
                      );
                    })}
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800/80">
                  {filteredAndSorted.map((m) => {
                    const isSelected = selectedModel?.model_id === m.model_id;
                    const isRetraining = Boolean(retrainingIds[m.model_id]);
                    const topThree = (m.top_features ?? []).slice(0, 3);

                    return (
                      <tr
                        key={m.model_id}
                        className={`transition-colors ${
                          isSelected
                            ? 'bg-cyan-500/10'
                            : 'hover:bg-white/[0.025]'
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-white">{m.name}</span>
                            <span className="rounded-md border border-purple-500/35 bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-purple-300">
                              {m.algorithm}
                            </span>
                            {m.optuna_trials_count > 0 && (
                              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                                <Sparkles className="h-2.5 w-2.5" />
                                {m.optuna_trials_count} Optuna
                              </span>
                            )}
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                            {m.symbol && <span className="font-mono text-cyan-300">{m.symbol}</span>}
                            {m.timeframe && <span>• {m.timeframe}</span>}
                            {m.data_source && <span>• {m.data_source}</span>}
                            {m.version !== null && m.version !== undefined && (
                              <span>• v{m.version}</span>
                            )}
                          </div>

                          {topThree.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {topThree.map((feat) => (
                                <span
                                  key={feat.name}
                                  className="rounded border border-slate-700/80 bg-slate-900/90 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
                                  title={`Importance: ${feat.importance.toFixed(4)}`}
                                >
                                  {feat.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>

                        <td className="whitespace-nowrap px-3 py-3 font-mono font-semibold text-cyan-300">
                          {formatPercentAuto(m.accuracy, 1)}
                        </td>

                        <td className="whitespace-nowrap px-3 py-3 font-mono font-semibold text-slate-200">
                          {typeof m.f1_score === 'number' && Number.isFinite(m.f1_score)
                            ? m.f1_score <= 1
                              ? m.f1_score.toFixed(3)
                              : m.f1_score.toFixed(2)
                            : '--'}
                        </td>

                        <td
                          className={`whitespace-nowrap px-3 py-3 font-mono font-bold ${
                            typeof m.profit_pct === 'number'
                              ? m.profit_pct >= 0
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                              : 'text-slate-400'
                          }`}
                        >
                          {formatPctDirect(m.profit_pct, true)}
                        </td>

                        <td className="whitespace-nowrap px-3 py-3 font-mono text-slate-200">
                          {formatPctDirect(m.win_rate)}
                        </td>

                        <td className="whitespace-nowrap px-3 py-3 font-mono text-rose-300">
                          {formatPctDirect(m.max_drawdown)}
                        </td>

                        <td className="whitespace-nowrap px-3 py-3 font-mono text-purple-300">
                          {formatPctDirect(m.kelly_pct)}
                        </td>

                        <td className="whitespace-nowrap px-3 py-3 font-mono text-slate-300">
                          {typeof m.latency === 'number' && Number.isFinite(m.latency)
                            ? `${m.latency.toFixed(1)} ms`
                            : '--'}
                        </td>

                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedModel((prev) =>
                                  prev?.model_id === m.model_id ? null : m,
                                )
                              }
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all ${
                                isSelected
                                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                                  : 'border-slate-700 bg-slate-900/80 text-slate-200 hover:border-cyan-500/50 hover:text-cyan-300'
                              }`}
                            >
                              <BarChart2 className="h-3.5 w-3.5" />
                              Optuna & Paper Replay
                            </button>

                            {onOpenDeploy && (
                              <button
                                type="button"
                                onClick={() => onOpenDeploy(m.model_id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25"
                              >
                                <Rocket className="h-3.5 w-3.5" />
                                Deploy
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => void handleRetrain(m)}
                              disabled={isRetraining}
                              className="inline-flex items-center gap-1 rounded-lg border border-purple-500/40 bg-purple-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-purple-200 transition-colors hover:bg-purple-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isRetraining ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )}
                              1-Click Retrain
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Inline Split Detail Drawer: Optuna & Paper Replay */}
          {selectedModel && (
            <div className="rounded-2xl border border-cyan-500/35 bg-slate-950/80 p-4 shadow-[0_0_30px_rgba(6,182,212,0.1)]">
              <div className="mb-3 flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-cyan-400" />
                  <h3 className="text-sm font-bold text-white">
                    Deep Inspection: {selectedModel.name}
                  </h3>
                  <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-purple-300">
                    {selectedModel.algorithm}
                  </span>
                  {selectedModel.symbol && (
                    <span className="font-mono text-xs text-cyan-300">
                      {selectedModel.symbol}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedModel(null)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                  Close Drawer
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <OptunaTrialsChart modelId={selectedModel.model_id} />
                <PaperReplayPreview modelId={selectedModel.model_id} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ModelComparisonModal;
