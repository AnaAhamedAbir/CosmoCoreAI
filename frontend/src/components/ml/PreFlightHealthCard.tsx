import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Lightbulb,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import {
  PreFlightResponse,
  trainingStudioToolsService,
} from '@/services/trainingStudioToolsService';

export interface PreFlightHealthCardProps {
  symbol: string;
  timeframe: string;
  dataSource: string;
  exchange?: string;
  datasetFile?: string | null;
  features?: string[];
  predictionTarget?: string;
  disabled?: boolean;
}

const STATUS_STYLES: Record<
  PreFlightResponse['status'],
  {
    badge: string;
    ring: string;
    bar: string;
    text: string;
    icon: React.ReactNode;
  }
> = {
  PASS: {
    badge: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
    ring: '#10b981',
    bar: 'from-emerald-400 to-cyan-400',
    text: 'text-emerald-400',
    icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
  },
  WARN: {
    badge: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
    ring: '#f59e0b',
    bar: 'from-amber-400 to-yellow-400',
    text: 'text-amber-400',
    icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />,
  },
  FAIL: {
    badge: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
    ring: '#f43f5e',
    bar: 'from-rose-500 to-orange-400',
    text: 'text-rose-400',
    icon: <XCircle className="h-3.5 w-3.5 text-rose-400" />,
  },
};

function resolveClassBalance(classBalance?: Record<string, number> | null): {
  upPct: number;
  downPct: number;
} | null {
  if (!classBalance) return null;
  const rawUp = classBalance.up_pct ?? classBalance.up ?? classBalance['1'];
  const rawDown = classBalance.down_pct ?? classBalance.down ?? classBalance['0'];

  if (typeof rawUp !== 'number' && typeof rawDown !== 'number') {
    return null;
  }

  let up = typeof rawUp === 'number' ? rawUp : 100 - (rawDown ?? 0);
  let down = typeof rawDown === 'number' ? rawDown : 100 - up;

  // Normalize ratio-style (0..1) balances to percentages
  if (up <= 1 && down <= 1 && up + down <= 1.05) {
    up *= 100;
    down *= 100;
  }

  return {
    upPct: Math.max(0, Math.min(100, up)),
    downPct: Math.max(0, Math.min(100, down)),
  };
}

export const PreFlightHealthCard: React.FC<PreFlightHealthCardProps> = ({
  symbol,
  timeframe,
  dataSource,
  exchange,
  datasetFile,
  features,
  predictionTarget,
  disabled = false,
}) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PreFlightResponse | null>(null);

  // Reset cached audit when dataset source inputs change
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [symbol, dataSource, datasetFile]);

  const handleRunCheck = async () => {
    if (loading || disabled) return;
    setLoading(true);
    setError(null);
    try {
      const response = await trainingStudioToolsService.runPreFlightCheck({
        symbol,
        timeframe,
        data_source: dataSource,
        exchange,
        dataset_file: datasetFile,
        features,
        prediction_target: predictionTarget,
      });
      setResult(response);
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ||
        err?.message ||
        'Pre-flight dataset audit failed. Verify dataset availability.';
      setError(typeof msg === 'string' ? msg : 'Pre-flight dataset audit failed.');
    } finally {
      setLoading(false);
    }
  };

  const score = result ? Math.max(0, Math.min(100, result.health_score)) : 0;
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;
  const statusStyle = result ? STATUS_STYLES[result.status] ?? STATUS_STYLES.WARN : null;
  const balance = result ? resolveClassBalance(result.class_balance) : null;

  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-900/65 p-4 backdrop-blur-xl shadow-[0_0_30px_rgba(6,182,212,0.06)]">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/20 via-purple-500/15 to-emerald-500/15 text-cyan-300">
            <ShieldCheck className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold tracking-wide text-white">
                Pre-Flight Dataset Health
              </h3>
              {result && statusStyle && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusStyle.badge}`}
                >
                  {statusStyle.icon}
                  {result.status}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              Audit NaNs, leakage risks, outliers & class balance before training{' '}
              <span className="font-mono text-slate-300">{symbol || 'dataset'}</span>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleRunCheck}
          disabled={loading || disabled || !symbol}
          className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/40 bg-gradient-to-r from-cyan-600/80 via-purple-600/70 to-emerald-600/75 px-3.5 py-2 text-xs font-semibold text-white shadow-[0_0_16px_rgba(6,182,212,0.2)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Auditing...
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              Run Pre-Flight Check
            </>
          )}
        </button>
      </div>

      {/* Error State */}
      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-300">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Idle placeholder */}
      {!result && !error && !loading && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-slate-700/70 bg-slate-950/40 px-3.5 py-2.5 text-xs text-slate-400">
          <Database className="h-4 w-4 shrink-0 text-slate-500" />
          <span>
            Run a quick pre-flight check on <span className="text-slate-200">{symbol}</span> (
            {timeframe} • {dataSource}) to catch data leakage or quality issues early.
          </span>
        </div>
      )}

      {/* Results Body */}
      {result && statusStyle && (
        <div className="mt-4 space-y-3.5">
          {/* Health score ring + 4-stat grid */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:col-span-4">
              <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
                <svg className="h-14 w-14 -rotate-90" viewBox="0 0 60 60">
                  <circle
                    cx="30"
                    cy="30"
                    r={radius}
                    fill="none"
                    stroke="rgba(148,163,184,0.16)"
                    strokeWidth="5"
                  />
                  <circle
                    cx="30"
                    cy="30"
                    r={radius}
                    fill="none"
                    stroke={statusStyle.ring}
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    className="transition-all duration-700"
                  />
                </svg>
                <span className={`absolute font-mono text-sm font-black ${statusStyle.text}`}>
                  {Math.round(score)}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Health Score
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${statusStyle.bar} transition-all duration-700`}
                    style={{ width: `${score}%` }}
                  />
                </div>
                <div className="mt-1 text-[10px] text-slate-400">
                  {result.feature_count} features analyzed
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:col-span-8 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Rows</div>
                <div className="mt-1 font-mono text-sm font-bold text-white">
                  {result.total_rows.toLocaleString()}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Missing %</div>
                <div
                  className={`mt-1 font-mono text-sm font-bold ${
                    result.missing_pct > 5
                      ? 'text-rose-400'
                      : result.missing_pct > 0
                        ? 'text-amber-300'
                        : 'text-emerald-400'
                  }`}
                >
                  {result.missing_pct.toFixed(2)}%
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Outliers %</div>
                <div
                  className={`mt-1 font-mono text-sm font-bold ${
                    result.outlier_pct > 5 ? 'text-amber-300' : 'text-cyan-300'
                  }`}
                >
                  {result.outlier_pct.toFixed(2)}%
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Duplicates</div>
                <div
                  className={`mt-1 font-mono text-sm font-bold ${
                    result.duplicate_rows > 0 ? 'text-amber-300' : 'text-emerald-400'
                  }`}
                >
                  {result.duplicate_rows.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          {/* Class Balance Split Bar */}
          {balance && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="mb-1.5 flex items-center justify-between text-[11px]">
                <span className="font-semibold uppercase tracking-wider text-slate-400">
                  Target Class Balance
                </span>
                <span className="font-mono text-slate-300">
                  <span className="text-emerald-400">UP {balance.upPct.toFixed(1)}%</span>
                  <span className="mx-1.5 text-slate-600">/</span>
                  <span className="text-rose-400">DOWN {balance.downPct.toFixed(1)}%</span>
                </span>
              </div>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-500"
                  style={{ width: `${balance.upPct}%` }}
                />
                <div
                  className="bg-gradient-to-r from-purple-500 to-rose-500 transition-all duration-500"
                  style={{ width: `${balance.downPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Leakage Risks */}
          {result.leakage_risks.length > 0 && (
            <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-rose-300">
                <ShieldAlert className="h-4 w-4 text-rose-400" />
                Potential Leakage Risks ({result.leakage_risks.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {result.leakage_risks.map((risk, idx) => (
                  <span
                    key={`${risk.column}-${idx}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-950/60 px-2.5 py-1 text-[11px] text-rose-200"
                    title={risk.reason}
                  >
                    <span className="font-mono font-bold text-rose-300">{risk.column}</span>
                    <span className="text-rose-300/80">— {risk.reason}</span>
                    {typeof risk.correlation === 'number' && (
                      <span className="rounded bg-rose-500/20 px-1 py-0.5 font-mono text-[10px] text-rose-200">
                        r={risk.correlation.toFixed(2)}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* NaN & Constant Columns Summary */}
          {(result.nan_columns.length > 0 || result.constant_columns.length > 0) && (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {result.nan_columns.length > 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                    NaN Columns ({result.nan_columns.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {result.nan_columns.slice(0, 8).map((col) => (
                      <span
                        key={col.column}
                        className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-200"
                      >
                        {col.column} ({col.missing_pct.toFixed(1)}%)
                      </span>
                    ))}
                    {result.nan_columns.length > 8 && (
                      <span className="px-1 text-[10px] text-slate-400">
                        +{result.nan_columns.length - 8} more
                      </span>
                    )}
                  </div>
                </div>
              )}

              {result.constant_columns.length > 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-purple-300">
                    Constant Columns ({result.constant_columns.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {result.constant_columns.slice(0, 8).map((col) => (
                      <span
                        key={col}
                        className="rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 font-mono text-[10px] text-purple-200"
                      >
                        {col}
                      </span>
                    ))}
                    {result.constant_columns.length > 8 && (
                      <span className="px-1 text-[10px] text-slate-400">
                        +{result.constant_columns.length - 8} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Warnings & Recommendations */}
          {(result.warnings.length > 0 || result.recommendations.length > 0) && (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {result.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Warnings
                  </div>
                  <ul className="space-y-1 text-xs text-slate-300">
                    {result.warnings.map((w, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.recommendations.length > 0 && (
                <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-cyan-300">
                    <Lightbulb className="h-3.5 w-3.5" />
                    Recommendations
                  </div>
                  <ul className="space-y-1 text-xs text-slate-300">
                    {result.recommendations.map((rec, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-cyan-400" />
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PreFlightHealthCard;
