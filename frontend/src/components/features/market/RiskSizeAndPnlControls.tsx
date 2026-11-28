import React from 'react';
import { Scale, ShieldAlert, TrendingUp, Flame, Clock } from 'lucide-react';
import { RiskSizingResult, TradePnlPreview } from '../../../utils/riskAndPnlCalculator';
import {
  formatFeeRatePct,
  formatFeeUsd,
  TradeFeeBreakdown,
} from '../../../utils/tradeFeeCalculator';

interface RiskSizingSubBarProps {
  sizeMode: 'risk_usd' | 'risk_pct';
  riskInput: string;
  onSelectRiskPreset: (val: string) => void;
  riskCalc: RiskSizingResult;
  baseCurrency: string;
  quoteCurrency: string;
  formatDisplayPrice: (p?: number) => string;
  compact?: boolean;
}

export const RiskSizingSubBar: React.FC<RiskSizingSubBarProps> = ({
  sizeMode,
  riskInput,
  onSelectRiskPreset,
  riskCalc,
  baseCurrency,
  quoteCurrency,
  formatDisplayPrice,
  compact = false,
}) => {
  const presets = sizeMode === 'risk_usd' ? ['5', '10', '25', '50', '100'] : ['0.5', '1', '2', '3', '5'];
  const unit = sizeMode === 'risk_usd' ? '$' : '%';

  return (
    <div className={`${compact ? 'space-y-1 pt-0.5' : 'space-y-1.5 pt-1 border-t border-cyan-500/15'}`}>
      <div className="flex items-center justify-between gap-1 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {presets.map((val) => {
            const active = riskInput === val;
            return (
              <button
                key={val}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectRiskPreset(val);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className={`px-1.5 py-0.5 rounded font-mono text-[9.5px] font-extrabold border transition-all cursor-pointer active:scale-95 ${
                  active
                    ? 'bg-emerald-500/30 border-emerald-400 text-emerald-200 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                    : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/10 text-gray-400 hover:text-white'
                }`}
              >
                {sizeMode === 'risk_usd' ? `$${val}` : `${val}${unit}`}
              </button>
            );
          })}
        </div>
        {riskCalc.targetSlPrice && riskCalc.slDistancePct > 0 && (
          <span className="text-[9.5px] font-mono text-gray-400">
            SL @ <strong className="text-rose-300">${formatDisplayPrice(riskCalc.targetSlPrice)}</strong> ({riskCalc.slDistancePct.toFixed(2)}%)
          </span>
        )}
      </div>

      {riskCalc.baseAmount > 0 && (
        <div className="flex items-center justify-between gap-2 px-1.5 py-1 rounded bg-emerald-950/25 border border-emerald-500/25 text-[10px] font-mono">
          <span className="text-emerald-300">
            Risk <strong>${riskCalc.riskUsd.toFixed(2)}</strong> ➔ Qty:{' '}
            <strong className="text-white">
              {riskCalc.baseAmount < 1 ? riskCalc.baseAmount.toFixed(5) : riskCalc.baseAmount.toFixed(2)} {baseCurrency}
            </strong>
          </span>
          <span className="text-cyan-300 font-bold">
            ≈ ${riskCalc.quoteNotional.toFixed(2)} {quoteCurrency}
          </span>
        </div>
      )}

      {riskCalc.warning && (
        <div className="px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-500/40 text-amber-200 text-[9.5px] font-mono flex items-center gap-1">
          <span>⚠️</span>
          <span>{riskCalc.warning}</span>
        </div>
      )}
    </div>
  );
};

interface LivePnlAndRRBarProps {
  preview: TradePnlPreview;
  orderType: 'Limit' | 'Market' | 'SmartPeg';
  isFutures: boolean;
  feeBreakdown?: TradeFeeBreakdown;
  showFeeSummary?: boolean;
}

export const LivePnlAndRRBar: React.FC<LivePnlAndRRBarProps> = ({
  preview,
  orderType,
  isFutures,
  feeBreakdown,
  showFeeSummary = true,
}) => {
  const hasAnyMetric =
    preview.estProfitUsd !== null ||
    preview.maxLossUsd !== null ||
    (showFeeSummary &&
      (preview.makerFeeSavingsUsd > 0.01 ||
        Boolean(feeBreakdown && feeBreakdown.hasPositionSize && feeBreakdown.roundTripSlFeeUsd > 0)));
  if (!hasAnyMetric || preview.notionalUsd <= 0) return null;

  const entryFeeUsd = feeBreakdown ? feeBreakdown.entryLeg.feeUsd : preview.takerFeeUsd;
  const entryRateLabel = feeBreakdown
    ? formatFeeRatePct(feeBreakdown.entryLeg.rate)
    : isFutures
      ? '0.05%'
      : '0.10%';
  const takerRateLabel = feeBreakdown
    ? formatFeeRatePct(feeBreakdown.effectiveTakerRate)
    : isFutures
      ? '0.05%'
      : '0.10%';
  const makerSavingsUsd = feeBreakdown
    ? Math.max(
        0,
        feeBreakdown.notionalEntryUsd *
          (feeBreakdown.effectiveTakerRate - feeBreakdown.effectiveMakerRate)
      )
    : preview.makerFeeSavingsUsd;
  const slNativeExtraUsd =
    feeBreakdown && feeBreakdown.slLeg.isExchangeNative
      ? feeBreakdown.slLeg.feeUsd
      : 0;
  const slRoundTripUsd = feeBreakdown ? feeBreakdown.roundTripSlFeeUsd : entryFeeUsd;
  const slMarginPct = feeBreakdown ? feeBreakdown.slRoundTripPctOfMargin : 0;

  return (
    <div
      className={`px-2 py-1.5 rounded-lg border font-mono text-[10px] space-y-1 ${
        preview.isLowRR
          ? 'bg-amber-950/35 border-amber-500/45'
          : 'bg-[#060b16]/90 border-cyan-500/25'
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {preview.estProfitUsd !== null && (
            <span className="flex items-center gap-1 text-emerald-300 font-bold">
              <TrendingUp className="w-3 h-3 text-emerald-400" />
              <span>
                Est. +${preview.estProfitUsd.toFixed(2)}
                {preview.estProfitPct !== null ? ` (+${preview.estProfitPct.toFixed(2)}%)` : ''}
              </span>
            </span>
          )}
          {preview.maxLossUsd !== null && (
            <span className="flex items-center gap-1 text-rose-300 font-bold">
              <ShieldAlert className="w-3 h-3 text-rose-400" />
              <span>
                Risk -${preview.maxLossUsd.toFixed(2)}
                {preview.maxLossPct !== null ? ` (-${preview.maxLossPct.toFixed(2)}%)` : ''}
              </span>
            </span>
          )}
        </div>

        {preview.riskRewardRatio !== null && (
          <span
            className={`px-1.5 py-0.5 rounded font-black border flex items-center gap-1 ${
              preview.isLowRR
                ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                : 'bg-cyan-500/15 border-cyan-400/40 text-cyan-200'
            }`}
            title={preview.isLowRR ? 'Risk exceeds potential reward (R:R < 1:1)' : 'Reward-to-Risk Ratio'}
          >
            <Scale className="w-2.5 h-2.5" />
            <span>R:R 1:{preview.riskRewardRatio.toFixed(2)}</span>
          </span>
        )}
      </div>

      {showFeeSummary && (feeBreakdown?.hasPositionSize || makerSavingsUsd >= 0.01) && (
        <div className="flex items-center justify-between gap-1.5 flex-wrap text-[9.5px] text-gray-400 pt-0.5 border-t border-white/5">
          {feeBreakdown ? (
            <>
              <span>
                Fee:{' '}
                <strong className="text-white">{formatFeeUsd(slRoundTripUsd)}</strong>{' '}
                <span className="text-gray-500">
                  (E:{entryRateLabel}
                  {feeBreakdown.slLeg.enabled
                    ? ` + SL:${formatFeeRatePct(feeBreakdown.slLeg.rate)}`
                    : ''}
                  )
                </span>
                {isFutures && slMarginPct > 0 && (
                  <span
                    className={`ml-1 font-bold ${
                      slMarginPct >= 5
                        ? 'text-rose-300'
                        : slMarginPct >= 2.5
                          ? 'text-amber-300'
                          : 'text-cyan-300'
                    }`}
                  >
                    • {slMarginPct.toFixed(2)}% Mgn
                  </span>
                )}
              </span>
              {feeBreakdown.slLeg.isExchangeNative && feeBreakdown.smartChaseSlSavingsUsd >= 0.005 ? (
                <span className="text-amber-300 font-semibold">
                  🛡️ Native SL: {formatFeeUsd(slNativeExtraUsd)} (Chase saves{' '}
                  {formatFeeUsd(feeBreakdown.smartChaseSlSavingsUsd)})
                </span>
              ) : orderType === 'SmartPeg' && makerSavingsUsd >= 0.005 ? (
                <span className="text-emerald-300 font-semibold">
                  ⚡ SmartPeg saves {formatFeeUsd(makerSavingsUsd)} vs Taker ({takerRateLabel})
                </span>
              ) : null}
            </>
          ) : orderType === 'SmartPeg' ? (
            <span className="text-amber-300 font-semibold">
              ⚡ SmartPeg Maker saving ~${makerSavingsUsd.toFixed(2)} vs Market {isFutures ? 'Taker (0.05%)' : 'Taker (0.10%)'}
            </span>
          ) : (
            <span>
              Est. Fee: ~${entryFeeUsd.toFixed(2)} •{' '}
              <span className="text-amber-300/90">SmartPeg saves ~${makerSavingsUsd.toFixed(2)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
};

interface AntiWickSlControlsProps {
  mode: 'instant' | 'dwell' | 'candle_close';
  setMode: (m: 'instant' | 'dwell' | 'candle_close') => void;
  dwellSeconds: number;
  setDwellSeconds: (s: number) => void;
  timeframe: '1m' | '3m' | '5m' | '15m';
  setTimeframe: (tf: '1m' | '3m' | '5m' | '15m') => void;
  disasterPct: number;
  setDisasterPct: (pct: number) => void;
  isLockedByNativeSl?: boolean;
}

export const AntiWickSlControls: React.FC<AntiWickSlControlsProps> = ({
  mode,
  setMode,
  dwellSeconds,
  setDwellSeconds,
  timeframe,
  setTimeframe,
  disasterPct,
  setDisasterPct,
  isLockedByNativeSl = false,
}) => {
  return (
    <div
      className={`bg-indigo-950/20 border border-indigo-500/25 rounded-lg p-2.5 space-y-2 mt-2 ${
        isLockedByNativeSl ? 'opacity-45 pointer-events-none' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Flame className="w-3.5 h-3.5 text-indigo-300" />
          <span className="text-[11px] font-bold text-indigo-200">
            🕯️ Anti-Wick Stop Guard {isLockedByNativeSl ? '(Turn OFF Native OTOCO SL to use)' : ''}
          </span>
        </div>
        <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 border border-indigo-400/30 text-indigo-200 font-bold uppercase">
          {mode === 'dwell' ? `Dwell ${dwellSeconds}s` : mode === 'candle_close' ? `${timeframe} Close` : 'Instant'}
        </span>
      </div>

      <div className="flex bg-black/60 rounded p-0.5 border border-white/5 text-[10px] font-semibold">
        {(
          [
            { key: 'instant', label: '⚡ Instant' },
            { key: 'dwell', label: '⏱️ Dwell Hold' },
            { key: 'candle_close', label: '🕯️ Candle Close' },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setMode(item.key)}
            className={`flex-1 py-1 rounded transition-all cursor-pointer ${
              mode === item.key
                ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white font-bold shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {mode === 'dwell' && (
        <div className="space-y-1.5 pt-1 border-t border-white/5">
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-gray-300 flex items-center gap-1">
              <Clock className="w-3 h-3 text-cyan-400" /> Hold Duration (Anti Stop-Hunt)
            </span>
            <span className="text-cyan-300 font-bold">{dwellSeconds}s</span>
          </div>
          <div className="flex items-center gap-1">
            {[2, 3, 5, 10].map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => setDwellSeconds(sec)}
                className={`flex-1 py-0.5 rounded font-mono text-[10px] font-bold border transition-all cursor-pointer ${
                  dwellSeconds === sec
                    ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200'
                    : 'bg-black/40 border-white/10 text-gray-400 hover:text-white'
                }`}
              >
                {sec}s
              </button>
            ))}
            <input
              type="number"
              min="0.5"
              max="60"
              step="0.5"
              value={dwellSeconds}
              onChange={(e) => setDwellSeconds(Math.max(0.5, Math.min(60, parseFloat(e.target.value) || 3)))}
              className="w-14 bg-black/50 border border-white/15 rounded py-0.5 px-1 text-center text-white font-mono text-[10px]"
            />
          </div>
        </div>
      )}

      {mode === 'candle_close' && (
        <div className="space-y-1.5 pt-1 border-t border-white/5">
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-gray-300">Confirm on Closed Candle</span>
            <span className="text-cyan-300 font-bold uppercase">{timeframe}</span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {(['1m', '3m', '5m', '15m'] as const).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`py-0.5 rounded font-mono text-[10px] font-bold border transition-all cursor-pointer ${
                  timeframe === tf
                    ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200'
                    : 'bg-black/40 border-white/10 text-gray-400 hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      )}

      {mode !== 'instant' && (
        <div className="space-y-1 pt-1 border-t border-white/5">
          <div className="flex justify-between items-center text-[9.5px] font-mono text-gray-300">
            <span>🚨 Flash-Crash Instant Bypass</span>
            <span className="text-rose-300 font-bold">-{disasterPct.toFixed(1)}% past SL</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="5.0"
            step="0.5"
            value={disasterPct}
            onChange={(e) => setDisasterPct(parseFloat(e.target.value) || 2.0)}
            className="w-full accent-rose-500 h-1 bg-black/50 rounded appearance-none cursor-pointer"
          />
          <p className="text-[9px] text-gray-400 leading-tight">
            Ignores brief wicks inside {mode === 'dwell' ? `${dwellSeconds}s` : `${timeframe} bar`}, but exits immediately if price crashes &ge;{disasterPct.toFixed(1)}% past SL.
          </p>
        </div>
      )}
    </div>
  );
};
