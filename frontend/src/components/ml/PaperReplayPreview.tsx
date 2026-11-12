import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Loader2,
  Play,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import {
  EquityCurvePoint,
  PaperReplayResponse,
  trainingStudioToolsService,
} from '@/services/trainingStudioToolsService';

export interface PaperReplayPreviewProps {
  modelId: string;
  defaultStopLoss?: number;
  defaultTakeProfit?: number;
}

function formatSignalLabel(signal: number): { label: string; cls: string } {
  if (signal > 0) return { label: 'LONG', cls: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/35' };
  if (signal < 0) return { label: 'SHORT', cls: 'text-rose-300 bg-rose-500/15 border-rose-500/35' };
  return { label: 'FLAT', cls: 'text-slate-300 bg-slate-700/40 border-slate-600/40' };
}

export const PaperReplayPreview: React.FC<PaperReplayPreviewProps> = ({
  modelId,
  defaultStopLoss = 2,
  defaultTakeProfit = 4,
}) => {
  const uid = useId().replace(/:/g, '');
  const [initialBalance, setInitialBalance] = useState<number>(10000);
  const [stopLoss, setStopLoss] = useState<number>(defaultStopLoss);
  const [takeProfit, setTakeProfit] = useState<number>(defaultTakeProfit);
  const [bars, setBars] = useState<number>(250);

  const [data, setData] = useState<PaperReplayResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const requestSeqRef = useRef<number>(0);

  const executeReplay = useCallback(
    async (
      targetModelId: string,
      params: { initial_balance: number; stop_loss: number; take_profit: number; max_bars: number },
    ) => {
      if (!targetModelId) return;
      const reqId = ++requestSeqRef.current;
      setLoading(true);
      setError(null);
      setHoverIndex(null);

      try {
        const res = await trainingStudioToolsService.runPaperReplay(targetModelId, {
          initial_balance: Math.max(100, Number(params.initial_balance) || 10000),
          stop_loss: Math.max(0.1, Math.min(100, Number(params.stop_loss) || 2)),
          take_profit: Math.max(0.1, Math.min(1000, Number(params.take_profit) || 4)),
          max_bars: Math.max(10, Math.min(5000, Math.round(Number(params.max_bars) || 250))),
        });
        if (requestSeqRef.current === reqId) {
          setData(res);
        }
      } catch (err: any) {
        if (requestSeqRef.current === reqId) {
          const msg =
            err?.response?.data?.detail || err?.message || 'Failed to run OOS paper replay.';
          setError(typeof msg === 'string' ? msg : 'Failed to run OOS paper replay.');
        }
      } finally {
        if (requestSeqRef.current === reqId) {
          setLoading(false);
        }
      }
    },
    [],
  );

  // Sync defaults if parent updates them
  useEffect(() => {
    setStopLoss(defaultStopLoss);
  }, [defaultStopLoss]);

  useEffect(() => {
    setTakeProfit(defaultTakeProfit);
  }, [defaultTakeProfit]);

  // Auto-run cleanly on initial mount or modelId change
  useEffect(() => {
    if (!modelId) return;
    void executeReplay(modelId, {
      initial_balance: initialBalance,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      max_bars: bars,
    });
    return () => {
      requestSeqRef.current += 1;
    };
    // Intentionally trigger auto-run on modelId change using current parameter state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, executeReplay]);

  const handleRunClick = (e: React.FormEvent) => {
    e.preventDefault();
    void executeReplay(modelId, {
      initial_balance: initialBalance,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      max_bars: bars,
    });
  };

  const svgWidth = 680;
  const svgHeight = 230;
  const padLeft = 56;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 28;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const chartGeom = useMemo(() => {
    const curve: EquityCurvePoint[] = data?.equity_curve ?? [];
    if (curve.length === 0) return null;

    const equities = curve.map((pt) => pt.equity);
    const minEq = Math.min(...equities);
    const maxEq = Math.max(...equities);
    const span = maxEq - minEq || Math.abs(maxEq) * 0.05 || 100;
    const yMin = minEq - span * 0.08;
    const yMax = maxEq + span * 0.08;
    const ySpan = yMax - yMin || 1;

    const coords = curve.map((pt, i) => {
      const x =
        curve.length === 1
          ? padLeft + plotW / 2
          : padLeft + (i / (curve.length - 1)) * plotW;
      const y = padTop + (1 - (pt.equity - yMin) / ySpan) * plotH;
      return { pt, x, y };
    });

    const linePath = coords
      .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
      .join(' ');

    const baselineY = padTop + plotH;
    const areaPath =
      coords.length > 0
        ? `${linePath} L ${coords[coords.length - 1].x.toFixed(2)} ${baselineY.toFixed(2)} L ${coords[0].x.toFixed(2)} ${baselineY.toFixed(2)} Z`
        : '';

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      y: padTop + (1 - t) * plotH,
      val: yMin + t * ySpan,
    }));

    return { coords, linePath, areaPath, yTicks };
  }, [data, plotH, plotW]);

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!chartGeom || chartGeom.coords.length === 0 || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;

    const relX = ((e.clientX - rect.left) / rect.width) * svgWidth;
    const clampedX = Math.max(padLeft, Math.min(svgWidth - padRight, relX));
    const ratio = (clampedX - padLeft) / plotW;
    const idx = Math.round(ratio * (chartGeom.coords.length - 1));
    setHoverIndex(Math.max(0, Math.min(chartGeom.coords.length - 1, idx)));
  };

  const hoveredCoord =
    hoverIndex !== null && chartGeom ? chartGeom.coords[hoverIndex] ?? null : null;
  const isProfitable = (data?.profit_pct ?? 0) >= 0;
  const isLiveOos = data?.source === 'live_oos_replay';

  return (
    <div className="space-y-4 rounded-2xl border border-slate-700/70 bg-slate-900/65 p-4 backdrop-blur-xl shadow-[0_0_30px_rgba(16,185,129,0.06)]">
      {/* Header + Source Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-bold text-white">
            <BarChart3 className="h-4 w-4 text-emerald-400" />
            Out-of-Sample Paper Replay
          </h4>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {data ? `${data.model_name} • ${data.algorithm} • ${data.bars_replayed} bars` : 'Simulate OOS equity curve & risk profile'}
          </p>
        </div>

        {data && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
              isLiveOos
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300'
            }`}
          >
            <Activity className="h-3 w-3" />
            {isLiveOos ? 'Live OOS Replay' : 'Cached Post-Backtest'}
          </span>
        )}
      </div>

      {/* Parameter Form */}
      <form
        onSubmit={handleRunClick}
        className="grid grid-cols-2 gap-2.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:grid-cols-5"
      >
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Initial Balance
          </span>
          <input
            type="number"
            min={100}
            step={100}
            value={initialBalance}
            onChange={(e) => setInitialBalance(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/90 px-2.5 py-1.5 font-mono text-xs text-white outline-none transition-colors focus:border-cyan-500"
          />
        </label>

        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Stop Loss %
          </span>
          <input
            type="number"
            min={0.1}
            max={100}
            step={0.1}
            value={stopLoss}
            onChange={(e) => setStopLoss(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/90 px-2.5 py-1.5 font-mono text-xs text-white outline-none transition-colors focus:border-cyan-500"
          />
        </label>

        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Take Profit %
          </span>
          <input
            type="number"
            min={0.1}
            max={1000}
            step={0.1}
            value={takeProfit}
            onChange={(e) => setTakeProfit(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/90 px-2.5 py-1.5 font-mono text-xs text-white outline-none transition-colors focus:border-cyan-500"
          />
        </label>

        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Bars
          </span>
          <input
            type="number"
            min={10}
            max={5000}
            step={10}
            value={bars}
            onChange={(e) => setBars(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/90 px-2.5 py-1.5 font-mono text-xs text-white outline-none transition-colors focus:border-cyan-500"
          />
        </label>

        <div className="col-span-2 flex items-end sm:col-span-1">
          <button
            type="submit"
            disabled={loading || !modelId}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-500/40 bg-gradient-to-r from-emerald-600/85 to-cyan-600/85 px-3 py-2 text-xs font-semibold text-white shadow-[0_0_16px_rgba(16,185,129,0.2)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                Run OOS Replay
              </>
            )}
          </button>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-300">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-950/60 p-6">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
          <p className="mt-2 text-xs text-slate-400">Simulating OOS paper replay equity curve...</p>
        </div>
      )}

      {/* Equity Curve + KPI Grid */}
      {data && (
        <>
          <div className="relative rounded-xl border border-slate-800 bg-slate-950/75 p-3">
            {/* Top live summary / hover tooltip readout */}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                {isProfitable ? (
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-rose-400" />
                )}
                <span className="font-mono text-sm font-black text-white">
                  ${data.final_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span
                  className={`font-mono text-xs font-bold ${
                    isProfitable ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  ({isProfitable ? '+' : ''}
                  {data.profit_pct.toFixed(2)}%)
                </span>
              </div>

              {hoveredCoord ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-cyan-500/30 bg-slate-900/95 px-2.5 py-1 font-mono text-[11px] text-slate-200 shadow-lg">
                  <span className="text-slate-400">Bar #{hoveredCoord.pt.bar}</span>
                  <span>
                    Price:{' '}
                    <strong className="text-white">
                      ${hoveredCoord.pt.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </strong>
                  </span>
                  <span>
                    Eq:{' '}
                    <strong className="text-emerald-300">
                      ${hoveredCoord.pt.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </strong>
                  </span>
                  <span>
                    DD:{' '}
                    <strong className="text-rose-300">
                      {hoveredCoord.pt.drawdown_pct.toFixed(2)}%
                    </strong>
                  </span>
                  <span
                    className={`rounded border px-1.5 py-0.2 text-[10px] font-bold ${
                      formatSignalLabel(hoveredCoord.pt.signal).cls
                    }`}
                  >
                    {formatSignalLabel(hoveredCoord.pt.signal).label}
                  </span>
                </div>
              ) : (
                <span className="text-[11px] text-slate-500">
                  Hover equity curve to inspect bar price, drawdown & signal
                </span>
              )}
            </div>

            {chartGeom ? (
              <svg
                ref={svgRef}
                viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                className="h-auto w-full cursor-crosshair select-none overflow-visible"
                onMouseMove={handleSvgMouseMove}
                onMouseLeave={() => setHoverIndex(null)}
              >
                <defs>
                  <linearGradient id={`eq-area-${uid}`} x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={isProfitable ? '#10b981' : '#f43f5e'}
                      stopOpacity="0.38"
                    />
                    <stop
                      offset="55%"
                      stopColor={isProfitable ? '#06b6d4' : '#a855f7'}
                      stopOpacity="0.14"
                    />
                    <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id={`eq-stroke-${uid}`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#06b6d4" />
                    <stop offset="100%" stopColor={isProfitable ? '#10b981' : '#f43f5e'} />
                  </linearGradient>
                </defs>

                {/* Gridlines */}
                {chartGeom.yTicks.map((t, idx) => (
                  <g key={idx}>
                    <line
                      x1={padLeft}
                      y1={t.y}
                      x2={svgWidth - padRight}
                      y2={t.y}
                      stroke="rgba(148,163,184,0.12)"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={padLeft - 8}
                      y={t.y + 3}
                      textAnchor="end"
                      className="fill-slate-500 font-mono text-[9px]"
                    >
                      ${t.val >= 1000 ? `${(t.val / 1000).toFixed(1)}k` : t.val.toFixed(0)}
                    </text>
                  </g>
                ))}

                {/* Area & Line */}
                <path d={chartGeom.areaPath} fill={`url(#eq-area-${uid})`} />
                <path
                  d={chartGeom.linePath}
                  fill="none"
                  stroke={`url(#eq-stroke-${uid})`}
                  strokeWidth="2.2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />

                {/* Crosshair & Active Point */}
                {hoveredCoord && (
                  <g>
                    <line
                      x1={hoveredCoord.x}
                      y1={padTop}
                      x2={hoveredCoord.x}
                      y2={padTop + plotH}
                      stroke="rgba(34,211,238,0.45)"
                      strokeDasharray="4 3"
                    />
                    <circle
                      cx={hoveredCoord.x}
                      cy={hoveredCoord.y}
                      r={5}
                      fill="#22d3ee"
                      stroke="#0f172a"
                      strokeWidth="2"
                    />
                  </g>
                )}

                {/* X-axis bar ticks */}
                {chartGeom.coords.map((c, idx) => {
                  const step = Math.max(1, Math.ceil(chartGeom.coords.length / 7));
                  if (idx % step !== 0 && idx !== chartGeom.coords.length - 1) return null;
                  return (
                    <text
                      key={`bar-${c.pt.bar}`}
                      x={c.x}
                      y={svgHeight - 8}
                      textAnchor="middle"
                      className="fill-slate-500 font-mono text-[9px]"
                    >
                      B{c.pt.bar}
                    </text>
                  );
                })}
              </svg>
            ) : (
              <div className="py-8 text-center text-xs text-slate-400">
                No equity curve points returned for this replay configuration.
              </div>
            )}
          </div>

          {/* KPI Grid */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
            <KpiTile
              label="Profit %"
              value={`${data.profit_pct >= 0 ? '+' : ''}${data.profit_pct.toFixed(2)}%`}
              accent={data.profit_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}
            />
            <KpiTile
              label="Win Rate %"
              value={`${data.win_rate.toFixed(1)}%`}
              accent="text-cyan-300"
            />
            <KpiTile
              label="Max Drawdown %"
              value={`${data.max_drawdown.toFixed(2)}%`}
              accent="text-rose-300"
            />
            <KpiTile
              label="Profit Factor"
              value={data.profit_factor.toFixed(2)}
              accent={data.profit_factor >= 1.2 ? 'text-emerald-300' : 'text-amber-300'}
            />
            <KpiTile
              label="Sharpe"
              value={data.sharpe_ratio.toFixed(2)}
              accent={data.sharpe_ratio >= 1 ? 'text-emerald-300' : 'text-slate-200'}
            />
            <KpiTile
              label="Kelly %"
              value={`${data.kelly_pct.toFixed(1)}%`}
              accent="text-purple-300"
            />
            <KpiTile
              label="VaR 95%"
              value={`${data.monte_carlo_var.toFixed(2)}%`}
              accent="text-amber-300"
            />
            <KpiTile
              label="Risk of Ruin %"
              value={`${data.risk_of_ruin.toFixed(2)}%`}
              accent={data.risk_of_ruin > 10 ? 'text-rose-400' : 'text-emerald-300'}
              icon={data.risk_of_ruin > 10 ? <ShieldAlert className="h-3 w-3 text-rose-400" /> : undefined}
            />
            <KpiTile
              label="Total Trades"
              value={String(data.total_trades)}
              accent="text-white"
            />
          </div>
        </>
      )}
    </div>
  );
};

interface KpiTileProps {
  label: string;
  value: string;
  accent?: string;
  icon?: React.ReactNode;
}

const KpiTile: React.FC<KpiTileProps> = ({ label, value, accent = 'text-white', icon }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-950/65 p-2.5">
    <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
      <span className="truncate">{label}</span>
      {icon}
    </div>
    <div className={`mt-1 font-mono text-xs font-bold sm:text-sm ${accent}`}>{value}</div>
  </div>
);

export default PaperReplayPreview;
