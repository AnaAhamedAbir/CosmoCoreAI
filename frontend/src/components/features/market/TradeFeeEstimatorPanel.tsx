import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Coins,
  Flame,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  buildLeverageFeeLadder,
  classifyLeverageFeeRisk,
  formatFeeRatePct,
  formatFeeUsd,
  LeverageFeeRiskLevel,
  TradeFeeBreakdown,
  TradingFeeProfile,
} from '../../../utils/tradeFeeCalculator';

interface TradeFeeEstimatorPanelProps {
  enabled?: boolean;
  onToggleEnabled?: () => void;
  breakdown: TradeFeeBreakdown;
  feeProfile: TradingFeeProfile;
  bnbDiscountEnabled: boolean;
  onToggleBnbDiscount: () => void;
  onRefreshFees?: () => void;
  isLoadingFees?: boolean;
  leverage: number;
  onChangeLeverage?: (lev: number) => void;
  scalesNotionalWithLeverage?: boolean;
  onSwitchSlToSmartChase?: () => void;
  onSyncBreakevenFeeBuffer?: (bufferPct: number) => void;
  showBreakevenSyncButton?: boolean;
}

const LEVERAGE_QUICK_PRESETS = [1, 5, 10, 20, 50, 100];
const SIM_MARGIN_PRESETS = [100, 500, 1000, 5000];

function getRiskPalette(level: LeverageFeeRiskLevel): {
  badge: string;
  bar: string;
  text: string;
  border: string;
} {
  switch (level) {
    case 'extreme':
      return {
        badge: 'bg-rose-500/20 text-rose-200 border-rose-400/50',
        bar: 'bg-gradient-to-r from-amber-500 via-rose-500 to-rose-400',
        text: 'text-rose-300',
        border: 'border-rose-500/40',
      };
    case 'high':
      return {
        badge: 'bg-amber-500/20 text-amber-200 border-amber-400/50',
        bar: 'bg-gradient-to-r from-cyan-500 via-amber-400 to-orange-500',
        text: 'text-amber-300',
        border: 'border-amber-500/35',
      };
    case 'moderate':
      return {
        badge: 'bg-cyan-500/15 text-cyan-200 border-cyan-400/40',
        bar: 'bg-gradient-to-r from-emerald-500 to-cyan-400',
        text: 'text-cyan-300',
        border: 'border-cyan-500/30',
      };
    default:
      return {
        badge: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/40',
        bar: 'bg-gradient-to-r from-emerald-500 to-teal-400',
        text: 'text-emerald-300',
        border: 'border-emerald-500/30',
      };
  }
}

function formatCompactNotional(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return '$0';
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 10_000) return `$${(val / 1_000).toFixed(1)}K`;
  if (val >= 100) return `$${val.toFixed(0)}`;
  return `$${val.toFixed(2)}`;
}

export const TradeFeeEstimatorPanel: React.FC<TradeFeeEstimatorPanelProps> = ({
  enabled = true,
  onToggleEnabled,
  breakdown,
  feeProfile,
  bnbDiscountEnabled,
  onToggleBnbDiscount,
  onRefreshFees,
  isLoadingFees = false,
  leverage,
  onChangeLeverage,
  scalesNotionalWithLeverage = true,
  onSwitchSlToSmartChase,
  onSyncBreakevenFeeBuffer,
  showBreakevenSyncButton = false,
}) => {
  const [showDetailedNet, setShowDetailedNet] = useState<boolean>(
    breakdown.slLeg.isExchangeNative
  );
  const [simMarginUsd, setSimMarginUsd] = useState<number>(100);
  const prevIsNativeSlRef = useRef<boolean>(breakdown.slLeg.isExchangeNative);

  const isNativeSl = breakdown.slLeg.isExchangeNative;

  // Auto-open full Net Payoff breakdown when user switches into Exchange Native SL
  useEffect(() => {
    if (isNativeSl && !prevIsNativeSlRef.current) {
      setShowDetailedNet(true);
    }
    prevIsNativeSlRef.current = isNativeSl;
  }, [isNativeSl]);

  const isSimMode = !breakdown.hasPositionSize;
  const activeExitRate = breakdown.slLeg.enabled
    ? breakdown.slLeg.rate
    : breakdown.tpLeg.enabled
      ? breakdown.tpLeg.rate
      : breakdown.effectiveTakerRate;
  const activeExitIsMaker = breakdown.slLeg.enabled
    ? breakdown.slLeg.isMaker
    : breakdown.tpLeg.enabled
      ? breakdown.tpLeg.isMaker
      : false;

  // Compute live display numbers (real position size when present, or interactive simulated margin when $0/empty)
  const displayMarginUsd = isSimMode ? simMarginUsd : breakdown.requiredMarginUsd;
  const displayNotionalUsd = isSimMode
    ? simMarginUsd * (breakdown.isFutures ? breakdown.leverage : 1)
    : breakdown.notionalEntryUsd;
  const displayEntryFeeUsd = isSimMode
    ? displayNotionalUsd * breakdown.entryLeg.rate
    : breakdown.entryLeg.feeUsd;
  const displayExitFeeUsd = isSimMode
    ? displayNotionalUsd * activeExitRate
    : breakdown.slLeg.enabled
      ? breakdown.slLeg.feeUsd
      : breakdown.tpLeg.enabled
        ? breakdown.tpLeg.feeUsd
        : breakdown.nativeSlExitFeeUsd;
  const displayRoundTripFeeUsd = displayEntryFeeUsd + displayExitFeeUsd;
  const displaySmartChaseSavingsUsd = isSimMode
    ? Math.max(0, displayNotionalUsd * (breakdown.effectiveTakerRate - breakdown.effectiveMakerRate))
    : breakdown.smartChaseSlSavingsUsd;

  const effectiveMarginDragPct =
    displayMarginUsd > 0
      ? (displayRoundTripFeeUsd / displayMarginUsd) * 100
      : (breakdown.entryLeg.rate + activeExitRate) *
        (breakdown.isFutures ? breakdown.leverage : 1) *
        100;

  const { level: effectiveRiskLevel, message: effectiveRiskMessage } = useMemo(() => {
    if (!isSimMode && breakdown.slLeg.enabled) {
      return {
        level: breakdown.leverageRiskLevel,
        message: breakdown.leverageRiskMessage,
      };
    }
    return classifyLeverageFeeRisk(
      effectiveMarginDragPct,
      breakdown.isFutures,
      breakdown.leverage,
      isNativeSl || !breakdown.slLeg.enabled
    );
  }, [
    isSimMode,
    breakdown.slLeg.enabled,
    breakdown.leverageRiskLevel,
    breakdown.leverageRiskMessage,
    effectiveMarginDragPct,
    breakdown.isFutures,
    breakdown.leverage,
    isNativeSl,
  ]);

  const riskPalette = getRiskPalette(effectiveRiskLevel);

  const leverageLadder = useMemo(
    () =>
      breakdown.isFutures
        ? buildLeverageFeeLadder({
            breakdown: isSimMode
              ? {
                  ...breakdown,
                  requiredMarginUsd: simMarginUsd,
                  notionalEntryUsd: simMarginUsd * breakdown.leverage,
                }
              : breakdown,
            scalesNotionalWithLeverage: isSimMode ? true : scalesNotionalWithLeverage,
            presets: LEVERAGE_QUICK_PRESETS,
          })
        : [],
    [breakdown, isSimMode, simMarginUsd, scalesNotionalWithLeverage]
  );

  const dragBarWidthPct = Math.min(100, Math.max(4, (effectiveMarginDragPct / 6.0) * 100));

  const sourceBadge =
    breakdown.source === 'live_api'
      ? {
          label: 'LIVE API',
          cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/35',
          dot: 'bg-emerald-400',
        }
      : breakdown.source === 'market_meta'
        ? {
            label: 'EXCHANGE TIER',
            cls: 'bg-cyan-500/15 text-cyan-200 border-cyan-400/35',
            dot: 'bg-cyan-400',
          }
        : {
            label: 'AUTO EST.',
            cls: 'bg-white/5 text-gray-300 border-white/15',
            dot: 'bg-amber-400',
          };

  const marketModeLabel =
    breakdown.marketType === 'coinm_futures'
      ? `COIN-M ${breakdown.leverage}x`
      : breakdown.isFutures
        ? `FUTURES ${breakdown.leverage}x`
        : 'SPOT';

  return (
    <div
      className={`rounded-xl border transition-colors ${
        !enabled
          ? 'bg-[#050914] border-white/10 p-2'
          : isNativeSl
            ? 'bg-gradient-to-b from-[#090f1d] via-[#070b15] to-[#050811] border-cyan-400/35 shadow-[0_0_20px_rgba(34,211,238,0.06)] p-2.5 space-y-2'
            : 'bg-[#050914] border-white/12 p-2.5 space-y-2'
      }`}
    >
      {/* 1. SaaS Header Row: Mode + Symbol + Live Rate Source + BNB Toggle + Master ON/OFF Switch */}
      <div className="flex items-center justify-between gap-1.5 flex-wrap">
        <div
          className={`flex items-center gap-1.5 min-w-0 ${onToggleEnabled ? 'cursor-pointer select-none' : ''}`}
          onClick={() => onToggleEnabled?.()}
        >
          <div
            className={`p-1 rounded-md border shrink-0 ${
              !enabled
                ? 'bg-white/5 border-white/10 text-gray-500'
                : isNativeSl
                  ? 'bg-cyan-500/15 border-cyan-400/35 text-cyan-300'
                  : 'bg-amber-500/15 border-amber-400/35 text-amber-300'
            }`}
          >
            <Coins className="w-3 h-3" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1 flex-wrap">
              <span className={`text-[10.5px] font-black uppercase tracking-wider ${enabled ? 'text-white' : 'text-gray-300'}`}>
                Auto Fee Estimator
              </span>
              {!enabled ? (
                <span className="text-[8.5px] px-1.5 py-0.2 rounded font-mono font-bold uppercase bg-white/5 text-gray-400 border border-white/10">
                  OFF
                </span>
              ) : (
                <>
                  <span
                    className={`text-[8.5px] px-1.5 py-0.2 rounded font-mono font-black uppercase border ${
                      breakdown.isFutures
                        ? 'bg-amber-500/15 text-amber-300 border-amber-400/35'
                        : 'bg-cyan-500/15 text-cyan-200 border-cyan-400/35'
                    }`}
                  >
                    {marketModeLabel}
                  </span>
                  <span
                    className={`text-[8px] px-1.5 py-0.2 rounded font-mono font-bold uppercase border inline-flex items-center gap-1 ${sourceBadge.cls}`}
                    title={`${breakdown.tierLabel} (${breakdown.symbol})`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${sourceBadge.dot}`} />
                    {sourceBadge.label}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {enabled && feeProfile.bnb_discount_supported && (
            <button
              type="button"
              onClick={onToggleBnbDiscount}
              className={`px-1.5 py-0.5 rounded-md border text-[8.5px] font-mono font-black transition-colors cursor-pointer ${
                bnbDiscountEnabled
                  ? 'bg-amber-500/25 border-amber-400/60 text-amber-200'
                  : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/10 text-gray-400 hover:text-gray-200'
              }`}
              title={`Toggle Binance BNB Fee Discount (-${Math.round(feeProfile.bnb_discount_rate * 100)}%)`}
            >
              BNB -{Math.round(feeProfile.bnb_discount_rate * 100)}%
            </button>
          )}
          {enabled && onRefreshFees && (
            <button
              type="button"
              onClick={onRefreshFees}
              disabled={isLoadingFees}
              className="p-1 rounded-md bg-white/[0.04] hover:bg-white/10 border border-white/10 text-gray-400 hover:text-cyan-300 transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh live exchange fee tier"
            >
              <RefreshCw className={`w-2.5 h-2.5 ${isLoadingFees ? 'animate-spin text-cyan-300' : ''}`} />
            </button>
          )}
          {onToggleEnabled && (
            <button
              type="button"
              onClick={onToggleEnabled}
              className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer shrink-0 ${
                enabled ? 'bg-cyan-500' : 'bg-gray-700 hover:bg-gray-600'
              }`}
              title={enabled ? 'Turn OFF Auto Fee Estimator' : 'Turn ON Auto Fee Estimator'}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                  enabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          )}
        </div>
      </div>

      {enabled && (
      <>

      {/* 2. Live Pair Rate Strip */}
      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-black/45 border border-white/[0.07] text-[9.5px] font-mono flex-wrap">
        <div className="flex items-center gap-2 text-gray-300">
          <span className="text-white font-bold">{breakdown.baseCurrency}/{breakdown.quoteCurrency}</span>
          <span className="text-gray-600">•</span>
          <span>
            Maker{' '}
            <strong className={breakdown.effectiveMakerRate === 0 ? 'text-emerald-300' : 'text-cyan-200'}>
              {formatFeeRatePct(breakdown.effectiveMakerRate)}
            </strong>
          </span>
          <span className="text-gray-600">/</span>
          <span>
            Taker{' '}
            <strong className="text-amber-300">
              {formatFeeRatePct(breakdown.effectiveTakerRate)}
            </strong>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400">
            BE Move:{' '}
            <strong className="text-cyan-200">
              +{breakdown.breakevenSlMovePct.toFixed(3)}%
            </strong>
          </span>
          {showBreakevenSyncButton && onSyncBreakevenFeeBuffer && (
            <button
              type="button"
              onClick={() =>
                onSyncBreakevenFeeBuffer(
                  Number(Math.max(0.01, breakdown.breakevenSlMovePct).toFixed(3))
                )
              }
              className="px-1.5 py-0.2 rounded bg-emerald-500/15 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-200 text-[8.5px] font-bold cursor-pointer transition-colors"
              title="Sync exact round-trip fee % into Auto-Breakeven Fee Cushion"
            >
              Sync BE
            </button>
          )}
        </div>
      </div>

      {/* 2B. Interactive Preview Margin Bar (shown only when size/balance is empty so SaaS users still get live $ estimates) */}
      {isSimMode && (
        <div className="flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg bg-cyan-950/25 border border-cyan-500/25 text-[9px] font-mono flex-wrap">
          <span className="text-cyan-200 font-bold">
            Sim {breakdown.isFutures ? 'Margin' : 'Size'}:
          </span>
          <div className="flex items-center gap-1">
            {SIM_MARGIN_PRESETS.map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => setSimMarginUsd(amt)}
                className={`px-1.5 py-0.2 rounded border text-[8.5px] font-bold cursor-pointer transition-colors ${
                  simMarginUsd === amt
                    ? 'bg-cyan-500/30 border-cyan-400 text-white'
                    : 'bg-black/40 hover:bg-white/10 border-white/10 text-gray-400 hover:text-white'
                }`}
              >
                ${amt >= 1000 ? `${amt / 1000}K` : amt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 3. Core 3-Column Fee Telemetry Grid */}
      <div className="grid grid-cols-3 gap-1.5 font-mono">
        {/* Entry Leg */}
        <div className="rounded-lg bg-black/40 border border-white/10 px-2 py-1.5">
          <div className="flex items-center justify-between text-[8.5px] text-gray-400">
            <span className="uppercase font-bold">Entry</span>
            <span className={breakdown.entryLeg.isMaker ? 'text-emerald-300' : 'text-amber-300'}>
              {formatFeeRatePct(breakdown.entryLeg.rate)}
            </span>
          </div>
          <div className="text-[11.5px] font-black text-white mt-0.5 truncate">
            {formatFeeUsd(displayEntryFeeUsd)}
          </div>
          <div className="text-[8px] text-gray-400 truncate mt-0.5">
            {breakdown.entryLeg.isMaker ? 'Maker' : 'Taker'}
            {isSimMode ? ' (Sim)' : ''}
          </div>
        </div>

        {/* Exit Leg (SL primary, or TP / Native Taker preview when SL is OFF) */}
        <div
          className={`rounded-lg px-2 py-1.5 border ${
            !activeExitIsMaker
              ? 'bg-rose-950/25 border-rose-500/40'
              : 'bg-emerald-950/20 border-emerald-500/35'
          }`}
        >
          <div className="flex items-center justify-between text-[8.5px]">
            <span className={`uppercase font-bold ${!activeExitIsMaker ? 'text-rose-300' : 'text-emerald-300'}`}>
              {breakdown.slLeg.enabled
                ? 'SL Exit'
                : breakdown.tpLeg.enabled
                  ? 'TP Exit'
                  : 'Est. Exit'}
            </span>
            <span className={!activeExitIsMaker ? 'text-amber-300 font-bold' : 'text-emerald-300 font-bold'}>
              {formatFeeRatePct(activeExitRate)}
            </span>
          </div>
          <div className="text-[11.5px] font-black text-white mt-0.5 truncate">
            {formatFeeUsd(displayExitFeeUsd)}
          </div>
          <div className={`text-[8px] truncate mt-0.5 font-semibold ${!activeExitIsMaker ? 'text-rose-200/90' : 'text-emerald-300/90'}`}>
            {breakdown.slLeg.enabled
              ? isNativeSl
                ? '🛡️ Native Taker'
                : '⚡ Chase Maker'
              : breakdown.tpLeg.enabled
                ? breakdown.tpLeg.isMaker
                  ? '🎯 TP Maker'
                  : '🎯 TP Taker'
                : '🛡️ Native Taker'}
          </div>
        </div>

        {/* Round-Trip Total + Margin % */}
        <div className={`rounded-lg bg-black/45 border px-2 py-1.5 ${riskPalette.border}`}>
          <div className="flex items-center justify-between text-[8.5px] text-gray-400">
            <span className="uppercase font-bold">
              {breakdown.slLeg.enabled ? 'Total SL' : 'Round-Trip'}
            </span>
            <span className={`font-black ${riskPalette.text}`}>
              {effectiveMarginDragPct.toFixed(2)}%
            </span>
          </div>
          <div className="text-[11.5px] font-black text-white mt-0.5 truncate">
            {formatFeeUsd(displayRoundTripFeeUsd)}
          </div>
          <div className="text-[8px] text-gray-400 truncate mt-0.5">
            {breakdown.isFutures ? 'of Margin' : 'Entry + Exit'}
          </div>
        </div>
      </div>

      {/* 4. Interactive Futures Leverage Fee Simulator */}
      {breakdown.isFutures && (
        <div className="rounded-lg bg-[#04070e]/95 border border-cyan-500/20 p-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[9.5px] font-mono">
            <span className="flex items-center gap-1 text-cyan-200 font-bold">
              <Gauge className="w-3 h-3 text-cyan-400" />
              Leverage Fee Simulator
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[8.5px] text-gray-400">
                Pos <strong className="text-white">{formatCompactNotional(displayNotionalUsd)}</strong>
                {' • '}Mgn{' '}
                <strong className="text-cyan-300">{formatCompactNotional(displayMarginUsd)}</strong>
              </span>
              <span className={`px-1.5 py-0.2 rounded font-black text-[9.5px] border ${riskPalette.badge}`}>
                {leverage}x
              </span>
            </div>
          </div>

          {/* Synced Leverage Slider */}
          {onChangeLeverage && (
            <div className="space-y-1.5">
              <input
                type="range"
                min="1"
                max="125"
                step="1"
                value={leverage}
                onChange={(e) => onChangeLeverage(Number(e.target.value))}
                className="w-full accent-cyan-400 h-1 bg-black/70 rounded-lg appearance-none cursor-pointer"
                title="Adjust Futures leverage to preview live fee impact"
              />

              {/* 1-Tap Quick Leverage Chips with Live Margin Fee Drag % */}
              <div className="grid grid-cols-6 gap-1">
                {leverageLadder.map((pt) => {
                  const active = pt.leverage === leverage;
                  const ptPalette = getRiskPalette(pt.riskLevel);
                  return (
                    <button
                      key={pt.leverage}
                      type="button"
                      onClick={() => onChangeLeverage(pt.leverage)}
                      className={`py-1 px-0.5 rounded-md border font-mono transition-all cursor-pointer leading-tight ${
                        active
                          ? 'bg-cyan-500/25 border-cyan-400 text-white shadow-[0_0_8px_rgba(34,211,238,0.2)]'
                          : 'bg-white/[0.02] hover:bg-white/[0.07] border-white/10 text-gray-300 hover:text-white'
                      }`}
                      title={`${pt.leverage}x Leverage • Est. Round-Trip Fee: ${formatFeeUsd(pt.roundTripSlFeeUsd)} (${pt.slFeePctOfMargin.toFixed(2)}% of margin)`}
                    >
                      <span className="block text-[9.5px] font-black">{pt.leverage}x</span>
                      <span className={`block text-[7.5px] font-bold ${active ? 'text-cyan-200' : ptPalette.text}`}>
                        {pt.slFeePctOfMargin.toFixed(2)}%
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Margin Fee Drag Visual Gauge */}
          <div className="space-y-0.5 pt-0.5">
            <div className="flex items-center justify-between text-[8.5px] font-mono text-gray-400">
              <span>Fee Drag vs Margin (Entry + Exit)</span>
              <span className={`font-bold ${riskPalette.text}`}>
                {effectiveMarginDragPct.toFixed(2)}% of Margin
              </span>
            </div>
            <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-200 ${riskPalette.bar}`}
                style={{ width: `${dragBarWidthPct}%` }}
              />
            </div>
          </div>

          {breakdown.isInverse && breakdown.hasPositionSize && breakdown.slLeg.feeBaseAsset !== null && (
            <div className="text-[8.5px] font-mono text-cyan-300/85">
              COIN-M Inverse settles in <strong>{breakdown.settleCurrency}</strong> (~
              {((breakdown.entryLeg.feeBaseAsset || 0) + (breakdown.slLeg.feeBaseAsset || 0)).toFixed(5)}{' '}
              {breakdown.settleCurrency} round-trip).
            </div>
          )}
        </div>
      )}

      {/* 5. High-Leverage / Taker Fee Warning Alert */}
      {effectiveRiskMessage &&
        (effectiveRiskLevel === 'high' || effectiveRiskLevel === 'extreme') && (
          <div
            className={`flex items-start gap-1.5 px-2 py-1.5 rounded-lg border text-[9.5px] font-mono leading-snug ${
              effectiveRiskLevel === 'extreme'
                ? 'bg-rose-950/40 border-rose-500/45 text-rose-200'
                : 'bg-amber-950/35 border-amber-500/40 text-amber-200'
            }`}
          >
            {effectiveRiskLevel === 'extreme' ? (
              <Flame className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            )}
            <span>{effectiveRiskMessage}</span>
          </div>
        )}

      {/* 6. Native SL vs Smart Chase Savings Comparison Banner */}
      {breakdown.slLeg.enabled && breakdown.effectiveTakerRate > breakdown.effectiveMakerRate && (
        <div
          className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border text-[9.5px] font-mono ${
            isNativeSl
              ? 'bg-amber-500/10 border-amber-400/35 text-amber-100'
              : 'bg-emerald-500/10 border-emerald-400/30 text-emerald-200'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {isNativeSl ? (
              <Zap className="w-3 h-3 text-amber-400 shrink-0" />
            ) : (
              <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
            )}
            <span className="truncate">
              {isNativeSl ? (
                <>
                  Smart Chase Maker saves{' '}
                  <strong className="text-amber-300">
                    {formatFeeUsd(displaySmartChaseSavingsUsd)}
                  </strong>{' '}
                  on SL exit{isSimMode ? ' (Sim)' : ''}
                </>
              ) : (
                <>
                  Saving{' '}
                  <strong className="text-emerald-300">
                    {formatFeeUsd(displaySmartChaseSavingsUsd)}
                  </strong>{' '}
                  vs Native Taker SL{isSimMode ? ' (Sim)' : ''}
                </>
              )}
            </span>
          </div>

          {isNativeSl && onSwitchSlToSmartChase && (
            <button
              type="button"
              onClick={onSwitchSlToSmartChase}
              className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/35 border border-amber-400/50 text-amber-200 text-[8.5px] font-black uppercase shrink-0 cursor-pointer transition-colors"
            >
              ⚡ Save Fee
            </button>
          )}
        </div>
      )}

      {/* 7. Expandable Net PnL & TP/SL Cost Matrix */}
      <button
        type="button"
        onClick={() => setShowDetailedNet((v) => !v)}
        className="w-full flex items-center justify-between px-2 py-1 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.07] text-[9.5px] font-mono text-gray-300 cursor-pointer transition-colors"
      >
        <span className="flex items-center gap-1.5 font-bold">
          <Sparkles className="w-3 h-3 text-cyan-400" />
          <span>Net Payoff Breakdown (After Fees)</span>
        </span>
        <span className="flex items-center gap-1.5 text-[9px] text-cyan-300">
          {breakdown.netRiskRewardRatio !== null && (
            <span>Net R:R 1:{breakdown.netRiskRewardRatio.toFixed(2)}</span>
          )}
          <ChevronDown
            className={`w-3 h-3 transition-transform ${showDetailedNet ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {showDetailedNet && (
        <div className="grid grid-cols-2 gap-1.5 font-mono text-[9.5px] pt-0.5">
          <div className="rounded-lg bg-emerald-950/20 border border-emerald-500/25 p-2 space-y-0.5">
            <div className="flex items-center justify-between text-[8.5px] text-emerald-300/90 font-bold">
              <span>IF TP HITS</span>
              <span>{breakdown.tpLeg.isMaker ? 'Maker' : 'Taker'}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-gray-400 text-[8.5px]">Fee (E+TP)</span>
              <span className="text-amber-300 font-bold">
                -{formatFeeUsd(
                  isSimMode
                    ? displayEntryFeeUsd + displayNotionalUsd * (breakdown.tpLeg.enabled ? breakdown.tpLeg.rate : breakdown.effectiveMakerRate)
                    : breakdown.roundTripTpFeeUsd
                )}
              </span>
            </div>
            <div className="flex items-baseline justify-between pt-0.5 border-t border-white/5">
              <span className="text-gray-300 font-bold text-[8.5px]">Net Profit</span>
              <span
                className={`font-black ${
                  breakdown.isNetTpNegative ? 'text-rose-400' : 'text-emerald-300'
                }`}
              >
                {breakdown.netTpProfitUsd !== null
                  ? `${breakdown.netTpProfitUsd >= 0 ? '+' : '-'}${formatFeeUsd(Math.abs(breakdown.netTpProfitUsd))}`
                  : '--'}
              </span>
            </div>
          </div>

          <div className="rounded-lg bg-rose-950/20 border border-rose-500/25 p-2 space-y-0.5">
            <div className="flex items-center justify-between text-[8.5px] text-rose-300/90 font-bold">
              <span>IF SL HITS</span>
              <span>{isNativeSl ? 'Native Taker' : 'Chase Maker'}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-gray-400 text-[8.5px]">Fee (E+SL)</span>
              <span className="text-amber-300 font-bold">
                -{formatFeeUsd(
                  isSimMode
                    ? displayEntryFeeUsd + displayNotionalUsd * (breakdown.slLeg.enabled ? breakdown.slLeg.rate : breakdown.effectiveTakerRate)
                    : breakdown.roundTripSlFeeUsd
                )}
              </span>
            </div>
            <div className="flex items-baseline justify-between pt-0.5 border-t border-white/5">
              <span className="text-gray-300 font-bold text-[8.5px]">Net Loss</span>
              <span className="text-rose-300 font-black">
                {breakdown.netSlMaxLossUsd !== null
                  ? `-${formatFeeUsd(breakdown.netSlMaxLossUsd)}`
                  : '--'}
              </span>
            </div>
          </div>

          {breakdown.isNetTpNegative && (
            <div className="col-span-2 px-2 py-1 rounded bg-rose-950/45 border border-rose-500/45 text-[9px] text-rose-200 flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
              <span>
                TP target is smaller than round-trip fees ({breakdown.breakevenTpMovePct.toFixed(3)}%). Widen TP to stay profitable!
              </span>
            </div>
          )}

          {isSimMode && (
            <div className="col-span-2 px-2 py-1 rounded bg-cyan-950/25 border border-cyan-500/25 text-[9px] text-cyan-200/85">
              Simulating fees on ${simMarginUsd.toLocaleString()} {breakdown.isFutures ? 'margin' : 'order size'}. Enter size in the Order tab for live Net PnL.
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
};
