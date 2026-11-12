import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  Award,
  Check,
  Loader2,
  Sliders,
  Sparkles,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import {
  OptunaTrialItem,
  OptunaTrialsOut,
  trainingStudioToolsService,
} from '@/services/trainingStudioToolsService';

export interface OptunaTrialsChartProps {
  modelId: string;
  onApplyBestParams?: (params: Record<string, any>) => void;
}

interface PlottedTrial {
  trial: OptunaTrialItem;
  x: number;
  y: number;
  bestSoFarY: number;
  bestSoFarVal: number;
}

function formatParamValue(val: unknown): string {
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return String(val);
    return Math.abs(val) < 0.001 ? val.toExponential(2) : val.toFixed(4);
  }
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (val === null || val === undefined) return 'null';
  return String(val);
}

function getStateBadge(state: string): string {
  const s = state.toUpperCase();
  if (s === 'COMPLETE') return 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300';
  if (s === 'PRUNED') return 'border-amber-500/35 bg-amber-500/15 text-amber-300';
  return 'border-rose-500/35 bg-rose-500/15 text-rose-300';
}

export const OptunaTrialsChart: React.FC<OptunaTrialsChartProps> = ({
  modelId,
  onApplyBestParams,
}) => {
  const uid = useId().replace(/:/g, '');
  const [data, setData] = useState<OptunaTrialsOut | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [applied, setApplied] = useState<boolean>(false);

  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHoveredIdx(null);
    setApplied(false);

    trainingStudioToolsService
      .getOptunaTrials(modelId)
      .then((res) => {
        if (!cancelled) {
          setData(res);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          const msg =
            err?.response?.data?.detail || err?.message || 'Failed to load Optuna trial history.';
          setError(typeof msg === 'string' ? msg : 'Failed to load Optuna trial history.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [modelId]);

  const svgWidth = 680;
  const svgHeight = 230;
  const padLeft = 52;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 32;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const chartModel = useMemo(() => {
    if (!data || !data.trials || data.trials.length === 0) return null;

    const sorted = [...data.trials].sort((a, b) => a.number - b.number);
    const valid = sorted.filter(
      (t): t is OptunaTrialItem & { value: number } =>
        typeof t.value === 'number' && Number.isFinite(t.value),
    );
    if (valid.length === 0) return null;

    const values = valid.map((t) => t.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);

    // Infer optimization direction from best_value when available (default maximize)
    const isMinimize =
      typeof data.best_value === 'number' &&
      rawMax !== rawMin &&
      Math.abs(data.best_value - rawMin) < Math.abs(data.best_value - rawMax);

    const span = rawMax - rawMin || Math.abs(rawMax) * 0.1 || 1;
    const yMin = rawMin - span * 0.12;
    const yMax = rawMax + span * 0.12;
    const ySpan = yMax - yMin || 1;

    let runningBest = valid[0].value;
    const points: PlottedTrial[] = valid.map((trial, i) => {
      runningBest = isMinimize
        ? Math.min(runningBest, trial.value)
        : Math.max(runningBest, trial.value);

      const x =
        valid.length === 1
          ? padLeft + plotW / 2
          : padLeft + (i / (valid.length - 1)) * plotW;
      const y = padTop + (1 - (trial.value - yMin) / ySpan) * plotH;
      const bestSoFarY = padTop + (1 - (runningBest - yMin) / ySpan) * plotH;

      return {
        trial,
        x,
        y,
        bestSoFarY,
        bestSoFarVal: runningBest,
      };
    });

    const scorePath = points
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(' ');
    const envelopePath = points
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.bestSoFarY.toFixed(2)}`)
      .join(' ');

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      y: padTop + (1 - t) * plotH,
      label: (yMin + t * ySpan).toFixed(4),
    }));

    const bestPoint =
      points.find((p) => p.trial.number === data.best_trial_number) ??
      points.reduce((acc, cur) =>
        isMinimize
          ? cur.trial.value! < acc.trial.value!
            ? cur
            : acc
          : cur.trial.value! > acc.trial.value!
            ? cur
            : acc,
      );

    return {
      sorted,
      points,
      scorePath,
      envelopePath,
      yTicks,
      bestPoint,
    };
  }, [data, plotH, plotW]);

  const handleApplyBest = () => {
    if (!data?.best_params || !onApplyBestParams) return;
    onApplyBestParams(data.best_params);
    setApplied(true);
    setTimeout(() => setApplied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-slate-700/70 bg-slate-900/65 p-6 backdrop-blur-xl">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
        <p className="mt-2 text-xs text-slate-400">Loading Optuna AutoML trial history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2.5 rounded-2xl border border-rose-500/35 bg-rose-500/10 p-4 text-xs text-rose-300">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
        <span>{error}</span>
      </div>
    );
  }

  if (!data || !data.trials || data.trials.length === 0) {
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/50 p-6 text-center backdrop-blur-xl">
        <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl border border-purple-500/30 bg-purple-500/10 text-purple-300">
          <Sliders className="h-5 w-5" />
        </div>
        <p className="max-w-md text-xs font-medium text-slate-300">
          No Optuna AutoML trials recorded for this model — enable AutoML before training
        </p>
      </div>
    );
  }

  const bestParamsEntries = Object.entries(data.best_params ?? {});
  const activeHover = hoveredIdx !== null && chartModel ? chartModel.points[hoveredIdx] : null;

  return (
    <div className="space-y-4 rounded-2xl border border-slate-700/70 bg-slate-900/65 p-4 backdrop-blur-xl shadow-[0_0_30px_rgba(168,85,247,0.07)]">
      {/* Header + Best Trial Callout */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-bold text-white">
            <TrendingUp className="h-4 w-4 text-cyan-400" />
            Optuna Hyperparameter Optimization
            <span className="rounded-full border border-purple-500/35 bg-purple-500/15 px-2 py-0.5 text-[10px] font-semibold text-purple-300">
              {data.trials.length} Trials
            </span>
          </h4>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {data.model_name} • <span className="text-slate-300">{data.algorithm}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {data.best_trial_number !== null && data.best_trial_number !== undefined && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-1.5">
              <Award className="h-4 w-4 text-emerald-400" />
              <div className="text-[11px]">
                <span className="text-slate-400">Best Trial </span>
                <span className="font-mono font-bold text-white">#{data.best_trial_number}</span>
                {typeof data.best_value === 'number' && (
                  <span className="ml-1.5 font-mono font-bold text-emerald-300">
                    ({data.best_value.toFixed(4)})
                  </span>
                )}
              </div>
            </div>
          )}

          {onApplyBestParams && data.best_params && bestParamsEntries.length > 0 && (
            <button
              type="button"
              onClick={handleApplyBest}
              className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/40 bg-gradient-to-r from-cyan-600/80 to-purple-600/80 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_15px_rgba(6,182,212,0.2)] transition-all hover:brightness-110"
            >
              {applied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-300" />
                  Applied
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Apply Best Params
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Best Params Pills */}
      {bestParamsEntries.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {bestParamsEntries.map(([key, value]) => (
            <span
              key={key}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-950/70 px-2.5 py-1 text-[11px]"
            >
              <span className="text-slate-400">{key}:</span>
              <span className="font-mono font-semibold text-cyan-300">
                {formatParamValue(value)}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Responsive SVG Trial Chart */}
      {chartModel ? (
        <div className="relative rounded-xl border border-slate-800 bg-slate-950/70 p-2.5">
          <div className="mb-1.5 flex items-center justify-between px-2 text-[10px] text-slate-400">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-cyan-400" />
                Trial Score
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-emerald-400" />
                Best-So-Far Envelope
              </span>
            </div>
            {activeHover && (
              <div className="font-mono text-[11px] text-slate-200">
                Trial #{activeHover.trial.number} • Score:{' '}
                <span className="font-bold text-cyan-300">
                  {activeHover.trial.value?.toFixed(4)}
                </span>{' '}
                • Best:{' '}
                <span className="font-bold text-emerald-300">
                  {activeHover.bestSoFarVal.toFixed(4)}
                </span>
              </div>
            )}
          </div>

          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="h-auto w-full select-none overflow-visible"
            onMouseLeave={() => setHoveredIdx(null)}
          >
            <defs>
              <filter id={`glow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <linearGradient id={`line-${uid}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#06b6d4" />
                <stop offset="50%" stopColor="#a855f7" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
            </defs>

            {/* Horizontal grid lines */}
            {chartModel.yTicks.map((tick, i) => (
              <g key={i}>
                <line
                  x1={padLeft}
                  y1={tick.y}
                  x2={svgWidth - padRight}
                  y2={tick.y}
                  stroke="rgba(148,163,184,0.12)"
                  strokeDasharray="3 3"
                />
                <text
                  x={padLeft - 8}
                  y={tick.y + 3}
                  textAnchor="end"
                  className="fill-slate-500 font-mono text-[9px]"
                >
                  {tick.label}
                </text>
              </g>
            ))}

            {/* Trial objective score line */}
            <path
              d={chartModel.scorePath}
              fill="none"
              stroke={`url(#line-${uid})`}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.85}
            />

            {/* Glowing dashed best-so-far envelope */}
            <path
              d={chartModel.envelopePath}
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
              strokeDasharray="6 4"
              filter={`url(#glow-${uid})`}
            />

            {/* Trial points */}
            {chartModel.points.map((pt, idx) => {
              const isBest = pt.trial.number === chartModel.bestPoint.trial.number;
              const isHovered = hoveredIdx === idx;
              return (
                <g key={pt.trial.number}>
                  {isBest && (
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={7}
                      fill="rgba(16,185,129,0.22)"
                      stroke="#10b981"
                      strokeWidth="1.5"
                    />
                  )}
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={isHovered ? 5.5 : isBest ? 4 : 3}
                    fill={isBest ? '#10b981' : isHovered ? '#22d3ee' : '#38bdf8'}
                    stroke="#0f172a"
                    strokeWidth="1.2"
                  />
                  {/* Larger invisible hover target */}
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={12}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredIdx(idx)}
                  />
                </g>
              );
            })}

            {/* X-axis labels */}
            {chartModel.points.map((pt, idx) => {
              const step = Math.max(1, Math.ceil(chartModel.points.length / 8));
              if (idx % step !== 0 && idx !== chartModel.points.length - 1) return null;
              return (
                <text
                  key={`x-${pt.trial.number}`}
                  x={pt.x}
                  y={svgHeight - 8}
                  textAnchor="middle"
                  className="fill-slate-500 font-mono text-[9px]"
                >
                  #{pt.trial.number}
                </text>
              );
            })}
          </svg>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-center text-xs text-slate-400">
          All recorded trials lack finite objective scores (pruned or failed).
        </div>
      )}

      {/* Scrollable Trial Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">
        <div className="max-h-56 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900/95 text-[10px] uppercase tracking-wider text-slate-400 backdrop-blur">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2">Params</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {data.trials.map((trial) => {
                const isBest = trial.number === data.best_trial_number;
                const paramText = Object.entries(trial.params ?? {})
                  .map(([k, v]) => `${k}=${formatParamValue(v)}`)
                  .join(', ');
                return (
                  <tr
                    key={trial.number}
                    className={
                      isBest
                        ? 'bg-emerald-500/10 text-emerald-100'
                        : 'text-slate-300 hover:bg-white/[0.03]'
                    }
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-mono font-semibold">
                      #{trial.number}
                      {isBest && (
                        <span className="ml-1.5 rounded bg-emerald-500/20 px-1 py-0.5 text-[9px] font-bold text-emerald-300">
                          BEST
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span
                        className={`inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${getStateBadge(
                          trial.state,
                        )}`}
                      >
                        {trial.state}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono font-semibold text-cyan-300">
                      {typeof trial.value === 'number' && Number.isFinite(trial.value)
                        ? trial.value.toFixed(4)
                        : '--'}
                    </td>
                    <td className="max-w-md truncate px-3 py-2 font-mono text-[11px] text-slate-400" title={paramText}>
                      {paramText || '--'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default OptunaTrialsChart;
