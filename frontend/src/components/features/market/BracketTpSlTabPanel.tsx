import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  Clock,
  Lock,
  Scale,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';
import {
  resolveTargetPriceFromConfig,
  TradePnlPreview,
} from '../../../utils/riskAndPnlCalculator';
import { OrderbookWall, WallTargetsSummary } from '../../../utils/liquidityWallMagnet';
import {
  formatFeeRatePct,
  formatFeeUsd,
  TradeFeeBreakdown,
  TradingFeeProfile,
} from '../../../utils/tradeFeeCalculator';
import { TakeProfitWallSnapButton } from './LiquidityWallMagnetControls';
import { AntiWickSlControls } from './RiskSizeAndPnlControls';
import { TradeFeeEstimatorPanel } from './TradeFeeEstimatorPanel';

export interface TpBracketConfig {
  enabled: boolean;
  mode: 'percentage' | 'price' | 'absolute' | 'atr';
  value: string;
  orderType: 'Limit' | 'Market';
  timeoutMins: number;
}

export interface SlBracketConfig {
  enabled: boolean;
  type: 'fixed' | 'trailing' | 'smart_chase' | 'trailing_chase';
  mode: 'percentage' | 'price' | 'absolute' | 'atr';
  value: string;
  atrPeriod: number;
  atrMultiplier: number;
  atrTimeframe: string;
  timeoutMins: number;
  smartChaseDeviationPct: number;
  smartChaseDelayMs: number;
  smartChaseMaxAttempts: number;
  smartChaseMode: 'dynamic_bbo' | 'interval';
  smartChaseTriggerSource: 'last' | 'bid_ask';
  smartChasePegStrategy: 'bbo' | 'inside_spread' | 'wall_aware';
  smartChaseWallMultiplier: number;
  autoBreakevenEnabled: boolean;
  autoBreakevenTriggerPct: number;
  autoBreakevenBufferPct: number;
  antiWickMode: 'instant' | 'dwell' | 'candle_close';
  antiWickDwellSeconds: number;
  antiWickTimeframe: '1m' | '3m' | '5m' | '15m';
  antiWickDisasterPct: number;
}

interface BracketTpSlTabPanelProps {
  tradeSide: 'Buy' | 'Sell';
  orderType: 'Limit' | 'Market' | 'SmartPeg';
  isFutures: boolean;
  isAutoLimit: boolean;
  isIceberg: boolean;
  leverage: number;
  marginMode: 'cross' | 'isolated';
  effectiveOrderPrice: number;
  effectiveCurrentPrice: number;
  limitPrice: string;
  tpConfig: TpBracketConfig;
  setTpConfig: React.Dispatch<React.SetStateAction<TpBracketConfig>>;
  slConfig: SlBracketConfig;
  setSlConfig: React.Dispatch<React.SetStateAction<SlBracketConfig>>;
  useNativeTpSl: boolean;
  canConfigureNativeTpSl: boolean;
  isNativeTpSlSupported: boolean;
  isNativeExchangeSlLockedToFixed: boolean;
  onToggleNativeTpSl: () => void;
  onSwitchToManualLimit?: () => void;
  getSmartGapValue: (
    targetMode: 'percentage' | 'price' | 'absolute',
    isTp: boolean,
    side?: 'Buy' | 'Sell'
  ) => string;
  wallTargets: WallTargetsSummary;
  frontRunTicks: number;
  formatDisplayPrice: (val: number | undefined | null) => string;
  onSnapTpToWall: (frontRunPrice: number, wall: OrderbookWall) => void;
  tradePnlPreview: TradePnlPreview;
  feeBreakdown?: TradeFeeBreakdown;
  feeProfile?: TradingFeeProfile;
  bnbDiscountEnabled?: boolean;
  onToggleBnbDiscount?: () => void;
  onRefreshFees?: () => void;
  isLoadingFees?: boolean;
  onChangeLeverage?: (lev: number) => void;
  scalesNotionalWithLeverage?: boolean;
  isThermalGuardActive: boolean;
}

interface BracketPreset {
  id: string;
  label: string;
  tpPct: string;
  slPct: string;
  rrLabel: string;
}

const QUICK_BRACKET_PRESETS: BracketPreset[] = [
  { id: 'tight', label: 'Tight', tpPct: '0.8', slPct: '0.5', rrLabel: '1:1.6' },
  { id: 'scalp', label: 'Scalp', tpPct: '1.5', slPct: '1.0', rrLabel: '1:1.5' },
  { id: 'swing', label: 'Swing', tpPct: '3.0', slPct: '1.2', rrLabel: '1:2.5' },
  { id: 'runner', label: 'Runner', tpPct: '5.0', slPct: '1.5', rrLabel: '1:3.3' },
];

const TP_PCT_CHIPS = ['0.5', '1.0', '1.5', '2.5', '5.0'];
const SL_PCT_CHIPS = ['0.4', '0.8', '1.0', '1.5', '2.5'];

export const BracketTpSlTabPanel: React.FC<BracketTpSlTabPanelProps> = ({
  tradeSide,
  orderType,
  isFutures,
  isAutoLimit,
  isIceberg,
  leverage,
  marginMode,
  effectiveOrderPrice,
  effectiveCurrentPrice,
  limitPrice,
  tpConfig,
  setTpConfig,
  slConfig,
  setSlConfig,
  useNativeTpSl,
  canConfigureNativeTpSl,
  isNativeTpSlSupported,
  isNativeExchangeSlLockedToFixed,
  onToggleNativeTpSl,
  onSwitchToManualLimit,
  getSmartGapValue,
  wallTargets,
  frontRunTicks,
  formatDisplayPrice,
  onSnapTpToWall,
  tradePnlPreview,
  feeBreakdown,
  feeProfile,
  bnbDiscountEnabled = false,
  onToggleBnbDiscount,
  onRefreshFees,
  isLoadingFees = false,
  onChangeLeverage,
  scalesNotionalWithLeverage = true,
  isThermalGuardActive,
}) => {
  const [showChaseAdvanced, setShowChaseAdvanced] = useState(false);

  const isChaseEngine = slConfig.type === 'smart_chase' || slConfig.type === 'trailing_chase';
  const refEntryPrice = effectiveOrderPrice || effectiveCurrentPrice || Number(limitPrice) || 0;

  const computedTpPrice = React.useMemo(
    () => resolveTargetPriceFromConfig(refEntryPrice, tradeSide, true, tpConfig),
    [refEntryPrice, tradeSide, tpConfig]
  );

  const computedSlPrice = React.useMemo(
    () => resolveTargetPriceFromConfig(refEntryPrice, tradeSide, false, slConfig),
    [refEntryPrice, tradeSide, slConfig]
  );

  const tpDiffPct = React.useMemo(() => {
    if (!computedTpPrice || refEntryPrice <= 0) return null;
    const raw = tradeSide === 'Buy'
      ? ((computedTpPrice - refEntryPrice) / refEntryPrice) * 100
      : ((refEntryPrice - computedTpPrice) / refEntryPrice) * 100;
    return raw;
  }, [computedTpPrice, refEntryPrice, tradeSide]);

  const slDiffPct = React.useMemo(() => {
    if (!computedSlPrice || refEntryPrice <= 0) return null;
    const raw = tradeSide === 'Buy'
      ? ((refEntryPrice - computedSlPrice) / refEntryPrice) * 100
      : ((computedSlPrice - refEntryPrice) / refEntryPrice) * 100;
    return raw;
  }, [computedSlPrice, refEntryPrice, tradeSide]);

  const liveRR = React.useMemo(() => {
    if (tradePnlPreview.riskRewardRatio !== null) return tradePnlPreview.riskRewardRatio;
    if (tpDiffPct !== null && slDiffPct !== null && tpDiffPct > 0 && slDiffPct > 0) {
      return tpDiffPct / slDiffPct;
    }
    return null;
  }, [tradePnlPreview.riskRewardRatio, tpDiffPct, slDiffPct]);

  const tpDirectionInvalid = tpDiffPct !== null && tpDiffPct <= 0;
  const slDirectionInvalid = slDiffPct !== null && slDiffPct <= 0;

  const applyPreset = (preset: BracketPreset) => {
    setTpConfig((prev) => ({
      ...prev,
      enabled: true,
      mode: 'percentage',
      value: preset.tpPct,
    }));
    setSlConfig((prev) => ({
      ...prev,
      enabled: true,
      mode: 'percentage',
      value: preset.slPct,
    }));
  };

  const isPresetActive = (preset: BracketPreset) =>
    tpConfig.enabled &&
    slConfig.enabled &&
    tpConfig.mode === 'percentage' &&
    slConfig.mode === 'percentage' &&
    tpConfig.value === preset.tpPct &&
    slConfig.value === preset.slPct;

  const isSoftwareSlActive =
    isChaseEngine ||
    slConfig.type === 'trailing' ||
    slConfig.mode === 'atr' ||
    slConfig.autoBreakevenEnabled ||
    slConfig.antiWickMode !== 'instant';

  const activeNativeOtoLabel = React.useMemo(() => {
    if (!useNativeTpSl || !isNativeTpSlSupported) return null;
    if (tpConfig.enabled && slConfig.enabled && isSoftwareSlActive) {
      return `HYBRID 2-LEG OTO${isIceberg ? ' + ICEBERG' : ''} + ${isChaseEngine ? 'CHASE SL' : 'WATCHDOG SL'}`;
    }
    if (tpConfig.enabled && slConfig.enabled) {
      return `3-LEG OTOCO${isIceberg ? ' + ICEBERG' : ''}`;
    }
    return `2-LEG OTO${isIceberg ? ' + ICEBERG' : ''}`;
  }, [useNativeTpSl, isNativeTpSlSupported, tpConfig.enabled, slConfig.enabled, isSoftwareSlActive, isChaseEngine, isIceberg]);

  const pegLabel =
    slConfig.smartChasePegStrategy === 'wall_aware'
      ? '🧱 Wall-Aware'
      : slConfig.smartChasePegStrategy === 'inside_spread'
        ? '🎯 Inside-Spread'
        : '⚡ Top BBO';

  const pulseDot = (colorClass: string) =>
    `w-1.5 h-1.5 rounded-full shrink-0 ${colorClass} ${isThermalGuardActive ? '' : 'animate-pulse'}`;

  return (
    <div className="space-y-2.5">
      {/* 1. LIVE BRACKET PAYOFF PREVIEW + 1-TAP PRESETS */}
      <div className="rounded-xl bg-[#050914] border border-cyan-500/25 p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Scale className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="text-[10.5px] font-black uppercase tracking-wider text-cyan-200">
              Bracket Payoff Matrix
            </span>
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-black uppercase border ${
                tradeSide === 'Buy'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                  : 'bg-rose-500/15 text-rose-300 border-rose-500/35'
              }`}
            >
              {tradeSide === 'Buy' ? 'LONG' : 'SHORT'} @ {refEntryPrice > 0 ? `$${formatDisplayPrice(refEntryPrice)}` : '--'}
            </span>
          </div>

          {liveRR !== null ? (
            <span
              className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-black border ${
                liveRR < 1
                  ? 'bg-amber-500/20 text-amber-200 border-amber-400/50'
                  : liveRR >= 1.8
                    ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50'
                    : 'bg-cyan-500/15 text-cyan-200 border-cyan-400/40'
              }`}
            >
              R:R 1 : {liveRR.toFixed(2)}
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-md font-mono text-[9.5px] font-bold bg-white/5 text-gray-400 border border-white/10">
              {slConfig.enabled && slConfig.mode === 'atr' ? 'ATR Dynamic R:R' : 'Arm TP + SL for R:R'}
            </span>
          )}
        </div>

        {/* 2-Column Live Target Readout */}
        <div className="grid grid-cols-2 gap-1.5">
          {/* SL Readout Pill */}
          <div
            className={`rounded-lg px-2 py-1.5 border font-mono ${
              !slConfig.enabled
                ? 'bg-black/35 border-white/10 opacity-70'
                : slDirectionInvalid
                  ? 'bg-amber-950/35 border-amber-500/50'
                  : 'bg-rose-950/20 border-rose-500/30'
            }`}
          >
            <div className="flex items-center justify-between text-[9px] text-gray-400">
              <span className="flex items-center gap-1 font-bold text-rose-300">
                <ArrowDownRight className="w-2.5 h-2.5" />
                STOP LOSS
              </span>
              <span className="text-rose-300 font-bold">
                {!slConfig.enabled
                  ? 'OFF'
                  : slConfig.mode === 'atr'
                    ? `ATR ${slConfig.atrMultiplier}x`
                    : slDiffPct !== null
                      ? `${slDiffPct >= 0 ? '-' : '+'}${Math.abs(slDiffPct).toFixed(2)}%`
                      : '--'}
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-0.5 gap-1">
              <span className="text-[11.5px] font-black text-white truncate">
                {!slConfig.enabled
                  ? 'Unprotected'
                  : slConfig.mode === 'atr'
                    ? `${slConfig.atrTimeframe} Volatility`
                    : computedSlPrice
                      ? `$${formatDisplayPrice(computedSlPrice)}`
                      : 'Set Gap'}
              </span>
              {tradePnlPreview.maxLossUsd !== null && (
                <span className="text-[9.5px] text-rose-300 font-bold shrink-0">
                  -${tradePnlPreview.maxLossUsd.toFixed(2)}
                </span>
              )}
            </div>
            {feeBreakdown && feeBreakdown.netSlMaxLossUsd !== null && feeBreakdown.roundTripSlFeeUsd > 0 && (
              <div className="flex items-center justify-between text-[8.5px] text-gray-400 mt-0.5 pt-0.5 border-t border-white/5">
                <span>Net incl. fee</span>
                <span className="text-rose-200 font-bold">
                  -{formatFeeUsd(feeBreakdown.netSlMaxLossUsd)}
                </span>
              </div>
            )}
          </div>

          {/* TP Readout Pill */}
          <div
            className={`rounded-lg px-2 py-1.5 border font-mono ${
              !tpConfig.enabled
                ? 'bg-black/35 border-white/10 opacity-70'
                : tpDirectionInvalid
                  ? 'bg-amber-950/35 border-amber-500/50'
                  : 'bg-emerald-950/20 border-emerald-500/30'
            }`}
          >
            <div className="flex items-center justify-between text-[9px] text-gray-400">
              <span className="flex items-center gap-1 font-bold text-emerald-300">
                <ArrowUpRight className="w-2.5 h-2.5" />
                TAKE PROFIT
              </span>
              <span className="text-emerald-300 font-bold">
                {!tpConfig.enabled
                  ? 'OFF'
                  : tpDiffPct !== null
                    ? `${tpDiffPct >= 0 ? '+' : '-'}${Math.abs(tpDiffPct).toFixed(2)}%`
                    : '--'}
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-0.5 gap-1">
              <span className="text-[11.5px] font-black text-white truncate">
                {!tpConfig.enabled
                  ? 'Manual Exit'
                  : computedTpPrice
                    ? `$${formatDisplayPrice(computedTpPrice)}`
                    : 'Set Target'}
              </span>
              {tradePnlPreview.estProfitUsd !== null && (
                <span className="text-[9.5px] text-emerald-300 font-bold shrink-0">
                  +${tradePnlPreview.estProfitUsd.toFixed(2)}
                </span>
              )}
            </div>
            {feeBreakdown && feeBreakdown.netTpProfitUsd !== null && feeBreakdown.roundTripTpFeeUsd > 0 && (
              <div className="flex items-center justify-between text-[8.5px] text-gray-400 mt-0.5 pt-0.5 border-t border-white/5">
                <span>Net after fee</span>
                <span
                  className={`font-bold ${
                    feeBreakdown.isNetTpNegative ? 'text-rose-300' : 'text-emerald-200'
                  }`}
                >
                  {feeBreakdown.netTpProfitUsd >= 0 ? '+' : '-'}
                  {formatFeeUsd(Math.abs(feeBreakdown.netTpProfitUsd))}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Direction Sanity Warning */}
        {(tpDirectionInvalid || slDirectionInvalid) && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/15 border border-amber-400/45 text-[10px] font-mono text-amber-200">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              {tpDirectionInvalid &&
                `TP ($${formatDisplayPrice(computedTpPrice)}) should be ${tradeSide === 'Buy' ? 'above' : 'below'} entry. `}
              {slDirectionInvalid &&
                `SL ($${formatDisplayPrice(computedSlPrice)}) should be ${tradeSide === 'Buy' ? 'below' : 'above'} entry.`}
            </span>
          </div>
        )}

        {/* Quick 1-Tap R:R Bracket Presets */}
        <div className="flex items-center gap-1 pt-0.5">
          <span className="text-[9px] font-mono font-bold uppercase text-gray-400 shrink-0 mr-0.5 flex items-center gap-1">
            <Sparkles className="w-2.5 h-2.5 text-cyan-400" />
            Presets:
          </span>
          <div className="grid grid-cols-4 gap-1 flex-1">
            {QUICK_BRACKET_PRESETS.map((preset) => {
              const active = isPresetActive(preset);
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={`py-1 px-1 rounded-md border text-[9.5px] font-mono font-bold transition-colors cursor-pointer leading-tight ${
                    active
                      ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200'
                      : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/10 text-gray-300 hover:text-white'
                  }`}
                  title={`Set TP +${preset.tpPct}% and SL -${preset.slPct}% (${preset.rrLabel})`}
                >
                  <span className="block">{preset.label}</span>
                  <span className="block text-[8px] opacity-80">
                    +{preset.tpPct}/-{preset.slPct}%
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 2. EXECUTION ROUTING ARCHITECTURE CARD (SPOT OTO/OTOCO vs FUTURES HYBRID) */}
      {(tpConfig.enabled || slConfig.enabled) && !isFutures && (
        <div
          className={`rounded-xl border p-2.5 transition-colors space-y-1.5 ${
            useNativeTpSl && isNativeTpSlSupported
              ? 'bg-cyan-950/25 border-cyan-400/45'
              : 'bg-[#050914] border-white/10'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`p-1.5 rounded-lg border shrink-0 ${
                  useNativeTpSl && isNativeTpSlSupported
                    ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-300'
                    : 'bg-white/5 border-white/10 text-gray-400'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[12px] font-extrabold text-white">
                    Binance Native OTO / OTOCO
                  </span>
                  {activeNativeOtoLabel && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-black uppercase bg-cyan-500/20 text-cyan-200 border border-cyan-400/40">
                      {activeNativeOtoLabel}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-gray-400 leading-snug mt-0.5">
                  {orderType === 'SmartPeg'
                    ? 'SmartPeg entry: Native OCO auto-spawns on exchange immediately after fill.'
                    : orderType === 'Market'
                      ? 'Market entry: Post-fill Native OCO/Bracket activates automatically on fill.'
                      : tpConfig.enabled && tpConfig.orderType === 'Market'
                        ? 'Market TP runs via Software Bracket. Switch TP to Limit to enable Native OTOCO.'
                        : !canConfigureNativeTpSl
                          ? 'Enable Limit TP or Fixed SL to route through Binance OTO/OTOCO.'
                          : isAutoLimit
                            ? 'BBO Auto-Limit is ON. Toggle ON to switch to Standard Limit + OTOCO.'
                            : tpConfig.enabled && slConfig.enabled && isSoftwareSlActive
                              ? `Entry + TP${isIceberg ? ' + Iceberg' : ''} on Binance OTO • SL guarded by ${isChaseEngine ? 'Smart Chase (250ms)' : 'Software Watchdog'}.`
                              : tpConfig.enabled && slConfig.enabled
                                ? `Entry + TP + Fixed SL${isIceberg ? ' + Iceberg' : ''} sent atomically as 3-Leg OTOCO.`
                                : `Entry + ${tpConfig.enabled ? 'TP' : 'Fixed SL'}${isIceberg ? ' + Iceberg' : ''} sent as 2-Leg Binance OTO.`}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={!canConfigureNativeTpSl}
              onClick={onToggleNativeTpSl}
              className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
                !canConfigureNativeTpSl
                  ? 'bg-gray-800 opacity-40 cursor-not-allowed'
                  : useNativeTpSl && isNativeTpSlSupported
                    ? 'bg-cyan-500 cursor-pointer'
                    : 'bg-gray-700 hover:bg-gray-600 cursor-pointer'
              }`}
              title={
                canConfigureNativeTpSl
                  ? 'Toggle Native Binance Spot OTO/OTOCO Routing'
                  : 'Requires Standard Limit entry + Limit TP or Fixed SL'
              }
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                  useNativeTpSl && isNativeTpSlSupported ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Actionable Quick-Fix Chips when Native OTOCO is blocked by user settings */}
          {!isNativeTpSlSupported && (orderType === 'Limit') && (
            <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-white/5">
              {tpConfig.enabled && tpConfig.orderType === 'Market' && (
                <button
                  type="button"
                  onClick={() => setTpConfig((prev) => ({ ...prev, orderType: 'Limit' }))}
                  className="px-2 py-0.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/40 text-cyan-200 text-[9.5px] font-mono font-bold cursor-pointer transition-colors"
                >
                  ⚡ Switch TP to Limit
                </button>
              )}
              {isAutoLimit && canConfigureNativeTpSl && onSwitchToManualLimit && (
                <button
                  type="button"
                  onClick={onSwitchToManualLimit}
                  className="px-2 py-0.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/40 text-cyan-200 text-[9.5px] font-mono font-bold cursor-pointer transition-colors"
                >
                  ⚡ Enable Standard Limit + OTOCO
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {(tpConfig.enabled || slConfig.enabled) && isFutures && (
        <div className="rounded-xl bg-cyan-950/20 border border-cyan-500/30 p-2.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[12px] font-extrabold text-cyan-200">
                Futures Hybrid Bracket Engine
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/35">
                {leverage}x {marginMode.toUpperCase()}
              </span>
            </div>
            <p className="text-[10px] text-cyan-200/80 leading-snug mt-0.5">
              {tpConfig.enabled && slConfig.enabled
                ? `🎯 Native Futures ${tpConfig.orderType} TP + ${isChaseEngine ? '⚡ Smart Chase Maker SL (250ms) + Native Disaster Stop' : `🛡️ Native ${slConfig.type === 'trailing' ? 'Trailing' : 'Stop-Market'} SL`}`
                : tpConfig.enabled
                  ? `🎯 Native Futures ${tpConfig.orderType} Take-Profit (reduceOnly)`
                  : `🛡️ ${isChaseEngine ? '⚡ Smart Chase Maker SL (250ms) + Native Disaster Stop' : 'Native Futures Stop-Loss (reduceOnly)'}`}
            </p>
          </div>
        </div>
      )}

      {/* 3. TAKE-PROFIT STUDIO CARD */}
      <div
        className={`rounded-xl border transition-colors ${
          tpConfig.enabled
            ? 'bg-[#050c0b] border-emerald-500/35'
            : 'bg-[#050914] border-white/10'
        }`}
      >
        <div
          className="flex items-center justify-between gap-2 p-2.5 cursor-pointer select-none"
          onClick={() => setTpConfig((prev) => ({ ...prev, enabled: !prev.enabled }))}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`p-1.5 rounded-lg border shrink-0 ${
                tpConfig.enabled
                  ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-400'
                  : 'bg-white/5 border-white/10 text-gray-500'
              }`}
            >
              <Target className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[12.5px] font-extrabold text-white">Take-Profit</span>
                {tpConfig.enabled ? (
                  <span className="text-[9px] px-1.5 py-0.2 rounded font-mono font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/35">
                    {tpConfig.orderType}
                  </span>
                ) : (
                  <span className="text-[9px] px-1.5 py-0.2 rounded font-mono font-bold uppercase bg-white/5 text-gray-400 border border-white/10">
                    OFF
                  </span>
                )}
              </div>
              <span className="text-[10px] text-gray-400 block truncate">
                {tpConfig.enabled && computedTpPrice
                  ? `Target $${formatDisplayPrice(computedTpPrice)} (${tpDiffPct !== null ? `${tpDiffPct >= 0 ? '+' : '-'}${Math.abs(tpDiffPct).toFixed(2)}%` : ''})`
                  : 'Auto-exit at target profit level'}
              </span>
            </div>
          </div>

          <div
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
              tpConfig.enabled ? 'bg-emerald-500' : 'bg-gray-700'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                tpConfig.enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </div>
        </div>

        {tpConfig.enabled && (
          <div className="px-2.5 pb-2.5 pt-2 border-t border-emerald-500/15 space-y-2.5">
            {/* Input + Unit Switcher */}
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-7 space-y-1">
                <div className="flex items-center justify-between text-[10px]">
                  <label className="text-gray-400 font-semibold">
                    {tpConfig.mode === 'absolute' ? 'Exact TP Price' : 'Profit Target Gap'}
                  </label>
                  {computedTpPrice && (
                    <span className="text-emerald-300 font-mono font-bold">
                      ≈ ${formatDisplayPrice(computedTpPrice)}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    value={tpConfig.value}
                    onChange={(e) => setTpConfig({ ...tpConfig, value: e.target.value })}
                    placeholder={
                      tpConfig.mode === 'absolute'
                        ? tradeSide === 'Buy'
                          ? 'e.g. 1.050'
                          : 'e.g. 0.950'
                        : tpConfig.mode === 'percentage'
                          ? 'e.g. 1.5'
                          : 'e.g. 0.005'
                    }
                    className="w-full bg-[#04070e] border border-white/15 focus:border-emerald-400/70 rounded-lg py-1.5 pl-2.5 pr-7 text-white font-mono text-[12.5px] font-bold focus:outline-none"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-emerald-400 font-mono font-black pointer-events-none">
                    {tpConfig.mode === 'percentage' ? '%' : tpConfig.mode === 'absolute' ? '🎯' : '$'}
                  </span>
                </div>
              </div>

              <div className="col-span-5 space-y-1">
                <label className="text-[10px] text-gray-400 font-semibold block">Unit</label>
                <div className="grid grid-cols-3 bg-[#04070e] rounded-lg border border-white/10 p-0.5">
                  {(
                    [
                      { key: 'percentage', label: '%', title: 'Percentage Gain' },
                      { key: 'price', label: '$', title: 'Dollar Distance' },
                      { key: 'absolute', label: '🎯', title: 'Exact Target Price' },
                    ] as const
                  ).map((u) => (
                    <button
                      key={u.key}
                      type="button"
                      onClick={() =>
                        setTpConfig({
                          ...tpConfig,
                          mode: u.key,
                          value:
                            tpConfig.mode === u.key
                              ? tpConfig.value
                              : getSmartGapValue(u.key, true),
                        })
                      }
                      className={`py-1.5 rounded-md text-[10.5px] font-mono font-bold transition-colors cursor-pointer ${
                        tpConfig.mode === u.key
                          ? 'bg-emerald-500 text-slate-950'
                          : 'text-gray-400 hover:text-white'
                      }`}
                      title={u.title}
                    >
                      {u.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 1-Tap TP % Chips */}
            <div className="flex items-center gap-1">
              {TP_PCT_CHIPS.map((pct) => {
                const active = tpConfig.mode === 'percentage' && tpConfig.value === pct;
                return (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setTpConfig({ ...tpConfig, mode: 'percentage', value: pct })}
                    className={`flex-1 py-1 rounded-md text-[10px] font-mono font-bold border transition-colors cursor-pointer ${
                      active
                        ? 'bg-emerald-500/25 border-emerald-400 text-emerald-200'
                        : 'bg-black/40 hover:bg-white/5 border-white/10 text-gray-400 hover:text-white'
                    }`}
                  >
                    +{pct}%
                  </button>
                );
              })}
            </div>

            {/* Execution Type + Monitor Window */}
            <div className="grid grid-cols-2 gap-2 pt-0.5">
              <div className="space-y-1">
                <label className="text-[10px] text-gray-400 font-semibold block">
                  TP Order Execution
                </label>
                <div className="grid grid-cols-2 bg-[#04070e] rounded-lg border border-white/10 p-0.5">
                  {(['Limit', 'Market'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setTpConfig({ ...tpConfig, orderType: type })}
                      className={`py-1 rounded-md text-[10.5px] font-mono font-bold transition-colors cursor-pointer ${
                        tpConfig.orderType === type
                          ? 'bg-emerald-500/90 text-slate-950'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      {type === 'Limit' ? 'Limit Maker' : 'Market'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] text-gray-400 font-semibold flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5 text-emerald-400" />
                    Watch Window
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setTpConfig({
                        ...tpConfig,
                        timeoutMins: tpConfig.timeoutMins === 0 ? 60 : 0,
                      })
                    }
                    className={`text-[9.5px] px-1.5 py-0.5 rounded font-mono font-bold border cursor-pointer transition-colors ${
                      tpConfig.timeoutMins === 0
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/35'
                        : 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                    }`}
                    title={
                      tpConfig.timeoutMins === 0
                        ? 'Infinite monitor active. Click to cap in minutes.'
                        : 'Click to monitor infinitely until filled'
                    }
                  >
                    {tpConfig.timeoutMins === 0 ? '∞ Infinite' : `${tpConfig.timeoutMins}m Cap`}
                  </button>
                </div>

                {tpConfig.timeoutMins === 0 ? (
                  <div className="px-2 py-1 rounded-lg bg-[#04070e] border border-emerald-500/20 text-[10px] font-mono text-emerald-300/90 flex items-center justify-between">
                    <span>Monitors until filled</span>
                    <button
                      type="button"
                      onClick={() => setTpConfig({ ...tpConfig, timeoutMins: 60 })}
                      className="text-gray-400 hover:text-white underline cursor-pointer"
                    >
                      Set cap
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-[#04070e] border border-white/10">
                    <input
                      type="range"
                      min="1"
                      max="120"
                      step="1"
                      value={tpConfig.timeoutMins}
                      onChange={(e) =>
                        setTpConfig({ ...tpConfig, timeoutMins: Number(e.target.value) })
                      }
                      className="w-full accent-emerald-500 h-1 bg-black/50 rounded appearance-none cursor-pointer"
                    />
                    <span className="text-[10.5px] font-mono font-bold text-amber-300 shrink-0">
                      {tpConfig.timeoutMins}m
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* 1-Click Wall Snap for TP */}
            <TakeProfitWallSnapButton
              tradeSide={tradeSide}
              wallTargets={wallTargets}
              frontRunTicks={frontRunTicks}
              formatDisplayPrice={formatDisplayPrice}
              onSnapTpToWall={onSnapTpToWall}
            />
          </div>
        )}
      </div>

      {/* 4. STOP-LOSS PROTECTION STUDIO CARD */}
      <div
        className={`rounded-xl border transition-colors ${
          slConfig.enabled
            ? isChaseEngine
              ? 'bg-[#0e0807] border-amber-500/35'
              : 'bg-[#0d070a] border-rose-500/35'
            : 'bg-[#050914] border-white/10'
        }`}
      >
        {/* Header Row */}
        <div
          className="flex items-center justify-between gap-2 p-2.5 cursor-pointer select-none"
          onClick={() => setSlConfig((prev) => ({ ...prev, enabled: !prev.enabled }))}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`p-1.5 rounded-lg border shrink-0 ${
                !slConfig.enabled
                  ? 'bg-white/5 border-white/10 text-gray-500'
                  : isChaseEngine
                    ? 'bg-amber-500/15 border-amber-400/40 text-amber-400'
                    : 'bg-rose-500/15 border-rose-400/40 text-rose-400'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[12.5px] font-extrabold text-white">
                  Stop-Loss Protection
                </span>
                {!slConfig.enabled ? (
                  <span className="text-[9px] px-1.5 py-0.2 rounded font-mono font-bold uppercase bg-white/5 text-gray-400 border border-white/10">
                    OFF
                  </span>
                ) : (
                  <span
                    className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-black uppercase border ${
                      isChaseEngine
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/35'
                        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/35'
                    }`}
                  >
                    {slConfig.type === 'trailing_chase'
                      ? '⚡ Trail Chase'
                      : slConfig.type === 'smart_chase'
                        ? '⚡ Smart Chase'
                        : slConfig.type === 'trailing'
                          ? '🛡️ Trailing'
                          : '🛡️ Native Fixed'}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-gray-400 block truncate">
                {!slConfig.enabled
                  ? 'No automatic downside stop armed'
                  : slConfig.mode === 'atr'
                    ? `ATR(${slConfig.atrPeriod}) × ${slConfig.atrMultiplier} on ${slConfig.atrTimeframe}`
                    : computedSlPrice
                      ? `Stop $${formatDisplayPrice(computedSlPrice)} (${slDiffPct !== null ? `${slDiffPct >= 0 ? '-' : '+'}${Math.abs(slDiffPct).toFixed(2)}%` : ''})`
                      : 'Configure stop trigger distance'}
              </span>
            </div>
          </div>

          <div
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
              !slConfig.enabled
                ? 'bg-gray-700'
                : isChaseEngine
                  ? 'bg-amber-500'
                  : 'bg-rose-500'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                slConfig.enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </div>
        </div>

        {slConfig.enabled && (
          <div className="px-2.5 pb-2.5 pt-2 border-t border-white/10 space-y-2.5">
            {/* A. Engine Mode Cards (Exchange Native vs Smart Chase) */}
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setSlConfig({
                      ...slConfig,
                      type: 'fixed',
                      mode: slConfig.mode === 'atr' ? 'percentage' : slConfig.mode,
                      value:
                        slConfig.mode === 'atr'
                          ? getSmartGapValue('percentage', false)
                          : slConfig.value,
                    })
                  }
                  className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                    !isChaseEngine
                      ? 'bg-emerald-500/15 border-emerald-400/60 text-white'
                      : 'bg-[#04070e] border-white/10 text-gray-400 hover:text-white hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-extrabold flex items-center gap-1 text-emerald-300">
                      🛡️ Exchange Native
                    </span>
                    {!isChaseEngine && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    )}
                  </div>
                  <span className="block text-[9px] text-gray-400 mt-0.5 leading-tight">
                    On Exchange Book •{' '}
                    {feeBreakdown ? (
                      <span className="text-amber-300 font-mono font-bold">
                        Taker {formatFeeRatePct(feeBreakdown.effectiveTakerRate)}
                        {feeBreakdown.hasPositionSize
                          ? ` (${formatFeeUsd(feeBreakdown.nativeSlExitFeeUsd)})`
                          : ''}
                      </span>
                    ) : (
                      '24/7 Safe'
                    )}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setSlConfig({
                      ...slConfig,
                      type: 'smart_chase',
                      mode: slConfig.mode === 'atr' ? 'percentage' : slConfig.mode,
                      value:
                        slConfig.mode === 'atr'
                          ? getSmartGapValue('percentage', false)
                          : slConfig.value,
                    })
                  }
                  className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                    isChaseEngine
                      ? 'bg-amber-500/15 border-amber-400/60 text-white'
                      : 'bg-[#04070e] border-white/10 text-gray-400 hover:text-white hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-extrabold flex items-center gap-1 text-amber-300">
                      ⚡ Smart Chase
                    </span>
                    {isChaseEngine && (
                      <span className="w-2 h-2 rounded-full bg-amber-400" />
                    )}
                  </div>
                  <span className="block text-[9px] text-gray-400 mt-0.5 leading-tight">
                    Bot Maker Loop •{' '}
                    {feeBreakdown ? (
                      <span className="text-emerald-300 font-mono font-bold">
                        Maker {formatFeeRatePct(feeBreakdown.effectiveMakerRate)}
                        {feeBreakdown.hasPositionSize
                          ? ` (${formatFeeUsd(feeBreakdown.smartChaseSlExitFeeUsd)})`
                          : ''}
                      </span>
                    ) : (
                      'Maker Fee'
                    )}
                  </span>
                </button>
              </div>

              {/* Variant + Unit Bar */}
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-6 space-y-1">
                  <label className="text-[10px] text-gray-400 font-semibold block">
                    {!isChaseEngine ? 'Stop Variant' : 'Chase Mode'}
                  </label>
                  <div className="grid grid-cols-2 bg-[#04070e] rounded-lg border border-white/10 p-0.5">
                    {!isChaseEngine ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setSlConfig({ ...slConfig, type: 'fixed' })}
                          className={`py-1 rounded-md text-[10px] font-bold transition-colors cursor-pointer ${
                            slConfig.type === 'fixed'
                              ? 'bg-emerald-600 text-white'
                              : 'text-gray-400 hover:text-white'
                          }`}
                        >
                          Fixed
                        </button>
                        <button
                          type="button"
                          disabled={isNativeExchangeSlLockedToFixed}
                          onClick={() => {
                            if (isNativeExchangeSlLockedToFixed) return;
                            setSlConfig({
                              ...slConfig,
                              type: 'trailing',
                              mode: slConfig.mode === 'absolute' ? 'percentage' : slConfig.mode,
                            });
                          }}
                          title={
                            isNativeExchangeSlLockedToFixed
                              ? 'Binance Spot OTOCO only supports Fixed STOP_LOSS_LIMIT. Use Smart Chase -> Trail Chase for trailing.'
                              : 'Trailing Stop'
                          }
                          className={`py-1 rounded-md text-[10px] font-bold transition-colors flex items-center justify-center gap-0.5 ${
                            isNativeExchangeSlLockedToFixed
                              ? 'text-gray-600 opacity-45 cursor-not-allowed'
                              : slConfig.type === 'trailing'
                                ? 'bg-emerald-600 text-white cursor-pointer'
                                : 'text-gray-400 hover:text-white cursor-pointer'
                          }`}
                        >
                          <span>Trailing</span>
                          {isNativeExchangeSlLockedToFixed && <Lock className="w-2.5 h-2.5" />}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setSlConfig({ ...slConfig, type: 'smart_chase' })}
                          className={`py-1 rounded-md text-[10px] font-bold transition-colors cursor-pointer ${
                            slConfig.type === 'smart_chase'
                              ? 'bg-amber-500 text-slate-950'
                              : 'text-gray-400 hover:text-white'
                          }`}
                        >
                          BBO Chase
                        </button>
                        <button
                          type="button"
                          onClick={() => setSlConfig({ ...slConfig, type: 'trailing_chase' })}
                          className={`py-1 rounded-md text-[10px] font-bold transition-colors cursor-pointer ${
                            slConfig.type === 'trailing_chase'
                              ? 'bg-gradient-to-r from-amber-500 to-rose-500 text-white'
                              : 'text-gray-400 hover:text-white'
                          }`}
                        >
                          Trail Chase
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="col-span-6 space-y-1">
                  <label className="text-[10px] text-gray-400 font-semibold block">
                    Gap Unit
                  </label>
                  <div className="flex bg-[#04070e] rounded-lg border border-white/10 p-0.5">
                    {(
                      [
                        { key: 'percentage', label: '%' },
                        { key: 'price', label: '$' },
                        { key: 'absolute', label: '🎯' },
                      ] as const
                    ).map((u) => (
                      <button
                        key={u.key}
                        type="button"
                        onClick={() =>
                          setSlConfig({
                            ...slConfig,
                            mode: u.key,
                            type:
                              u.key === 'absolute' &&
                              (slConfig.type === 'trailing' || slConfig.type === 'trailing_chase')
                                ? slConfig.type === 'trailing_chase'
                                  ? 'smart_chase'
                                  : 'fixed'
                                : slConfig.type,
                            value:
                              slConfig.mode === u.key
                                ? slConfig.value
                                : getSmartGapValue(u.key, false),
                          })
                        }
                        className={`flex-1 py-1 rounded-md text-[10.5px] font-mono font-bold transition-colors cursor-pointer ${
                          slConfig.mode === u.key
                            ? 'bg-rose-600 text-white'
                            : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        {u.label}
                      </button>
                    ))}
                    {!isChaseEngine && (
                      <button
                        type="button"
                        disabled={isNativeExchangeSlLockedToFixed}
                        onClick={() => {
                          if (isNativeExchangeSlLockedToFixed) return;
                          setSlConfig({ ...slConfig, mode: 'atr', type: 'trailing' });
                        }}
                        title={
                          isNativeExchangeSlLockedToFixed
                            ? 'Disabled when Native Binance OTO/OTOCO is ON'
                            : 'ATR Volatility Trailing Stop'
                        }
                        className={`flex-1 py-1 rounded-md text-[10px] font-mono font-bold transition-colors flex items-center justify-center gap-0.5 ${
                          isNativeExchangeSlLockedToFixed
                            ? 'text-gray-600 opacity-45 cursor-not-allowed'
                            : slConfig.mode === 'atr'
                              ? 'bg-rose-600 text-white cursor-pointer'
                              : 'text-gray-400 hover:text-white cursor-pointer'
                        }`}
                      >
                        <span>ATR</span>
                        {isNativeExchangeSlLockedToFixed && <Lock className="w-2.5 h-2.5" />}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Execution Assurance Status Strip */}
              <div
                className={`text-[10px] font-mono px-2.5 py-1.5 rounded-lg border flex items-start gap-1.5 leading-snug ${
                  isChaseEngine || (!isFutures && (!(useNativeTpSl && !isAutoLimit && slConfig.type === 'fixed' && !isSoftwareSlActive)) && (tpConfig.enabled || isSoftwareSlActive))
                    ? 'bg-amber-500/10 border-amber-500/25 text-amber-200'
                    : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200'
                }`}
              >
                <span className="shrink-0">{isChaseEngine ? '⚡' : '🛡️'}</span>
                <span>
                  {isChaseEngine ? (
                    <>
                      <strong>Bot Smart Chase (~250ms):</strong> Maker Post-Only exit loop
                      {!isFutures && useNativeTpSl && !isAutoLimit && tpConfig.enabled
                        ? ' (Hybrid: TP on Binance OTO).'
                        : ' (tracks off-book until trigger).'}
                    </>
                  ) : isFutures ? (
                    <>
                      <strong>Binance Futures Native:</strong>{' '}
                      {slConfig.type === 'trailing'
                        ? slConfig.mode === 'percentage' && !slConfig.autoBreakevenEnabled && slConfig.antiWickMode === 'instant'
                          ? 'TRAILING_STOP_MARKET (callback 0.1%–10%) placed directly on Futures.'
                          : 'Trailing/ATR/Breakeven or Anti-Wick guard tracked by backend Watchdog (with Futures disaster cushion).'
                        : slConfig.antiWickMode !== 'instant'
                          ? `STOP_MARKET disaster cushion placed on Futures • ${slConfig.antiWickMode === 'dwell' ? 'Dwell Hold' : 'Candle Close'} monitored by Watchdog.`
                          : 'STOP_MARKET order placed directly on Binance Futures.'}
                    </>
                  ) : useNativeTpSl && !isAutoLimit && slConfig.type === 'fixed' && !isSoftwareSlActive ? (
                    <>
                      <strong>Binance Native {tpConfig.enabled ? 'OTOCO' : 'OTO'}:</strong> Fixed
                      STOP_LOSS_LIMIT lives directly on Binance.
                    </>
                  ) : tpConfig.enabled || isSoftwareSlActive ? (
                    <>
                      <strong>Spot Software Watchdog:</strong>{' '}
                      {slConfig.antiWickMode !== 'instant' || slConfig.autoBreakevenEnabled
                        ? 'Anti-Wick / Auto-Breakeven runs SL on backend Watchdog (TP Limit stays on Native OTO if enabled).'
                        : tpConfig.enabled
                          ? 'TP locks Spot base balance, so SL runs on backend Watchdog (enable Native OTO/OTOCO above for exchange SL).'
                          : 'Spot Trailing/ATR stops are tracked continuously by backend Watchdog.'}
                    </>
                  ) : (
                    <>
                      <strong>Binance Native Stop:</strong> Order lives directly on Binance orderbook.
                    </>
                  )}
                </span>
              </div>

              {/* Live Auto Fee & Leverage Impact Estimator */}
              {feeBreakdown && feeProfile && (
                <TradeFeeEstimatorPanel
                  breakdown={feeBreakdown}
                  feeProfile={feeProfile}
                  bnbDiscountEnabled={bnbDiscountEnabled}
                  onToggleBnbDiscount={() => onToggleBnbDiscount?.()}
                  onRefreshFees={onRefreshFees}
                  isLoadingFees={isLoadingFees}
                  leverage={leverage}
                  onChangeLeverage={onChangeLeverage}
                  scalesNotionalWithLeverage={scalesNotionalWithLeverage}
                  onSwitchSlToSmartChase={() =>
                    setSlConfig((prev) => ({
                      ...prev,
                      type: prev.type === 'trailing' ? 'trailing_chase' : 'smart_chase',
                      mode: prev.mode === 'atr' ? 'percentage' : prev.mode,
                      value:
                        prev.mode === 'atr'
                          ? getSmartGapValue('percentage', false)
                          : prev.value,
                    }))
                  }
                  showBreakevenSyncButton={slConfig.autoBreakevenEnabled}
                  onSyncBreakevenFeeBuffer={(bufferPct) =>
                    setSlConfig((prev) => ({
                      ...prev,
                      autoBreakevenBufferPct: bufferPct,
                    }))
                  }
                />
              )}
            </div>

            {/* B. Stop Distance / ATR + Monitor Window */}
            {slConfig.mode === 'atr' ? (
              <div className="p-2 rounded-lg bg-[#04070e] border border-white/10 space-y-2">
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-rose-300 font-bold">ATR Volatility Configuration</span>
                  <span className="text-gray-400">
                    {slConfig.atrTimeframe} • {slConfig.atrPeriod}p × {slConfig.atrMultiplier}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-gray-400 font-medium block">Timeframe</label>
                    <select
                      value={slConfig.atrTimeframe}
                      onChange={(e) => setSlConfig({ ...slConfig, atrTimeframe: e.target.value })}
                      className="w-full bg-black/50 border border-white/15 rounded-md py-1 px-1.5 text-white text-[11px] font-mono focus:outline-none focus:border-rose-400"
                    >
                      {['1m', '5m', '15m', '1h', '4h', '1d'].map((tf) => (
                        <option key={tf} value={tf}>
                          {tf}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-gray-400 font-medium block">Period</label>
                    <input
                      type="number"
                      min="2"
                      max="100"
                      value={slConfig.atrPeriod}
                      onChange={(e) =>
                        setSlConfig({ ...slConfig, atrPeriod: Number(e.target.value) || 10 })
                      }
                      className="w-full bg-black/50 border border-white/15 rounded-md py-1 px-2 text-white text-[11px] font-mono focus:outline-none focus:border-rose-400"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-gray-400 font-medium block">Multiplier</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.5"
                      max="10"
                      value={slConfig.atrMultiplier}
                      onChange={(e) =>
                        setSlConfig({ ...slConfig, atrMultiplier: Number(e.target.value) || 2.0 })
                      }
                      className="w-full bg-black/50 border border-white/15 rounded-md py-1 px-2 text-white text-[11px] font-mono focus:outline-none focus:border-rose-400"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-7 space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <label className="text-gray-400 font-semibold">
                        {slConfig.mode === 'absolute'
                          ? 'Exact Stop Price'
                          : slConfig.type === 'smart_chase'
                            ? 'Chase Trigger Gap'
                            : slConfig.type === 'trailing_chase'
                              ? 'Trailing Callback Gap'
                              : slConfig.type === 'trailing'
                                ? 'Callback Distance'
                                : 'Stop Distance'}
                      </label>
                      {computedSlPrice && (
                        <span className="text-rose-300 font-mono font-bold">
                          ≈ ${formatDisplayPrice(computedSlPrice)}
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        step="any"
                        value={slConfig.value}
                        onChange={(e) => setSlConfig({ ...slConfig, value: e.target.value })}
                        placeholder={
                          slConfig.mode === 'absolute'
                            ? tradeSide === 'Buy'
                              ? 'e.g. 0.950'
                              : 'e.g. 1.050'
                            : slConfig.mode === 'percentage'
                              ? 'e.g. 1.0'
                              : 'e.g. 0.003'
                        }
                        className="w-full bg-[#04070e] border border-white/15 focus:border-rose-400/70 rounded-lg py-1.5 pl-2.5 pr-7 text-white font-mono text-[12.5px] font-bold focus:outline-none"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-rose-400 font-mono font-black pointer-events-none">
                        {slConfig.mode === 'percentage'
                          ? '%'
                          : slConfig.mode === 'absolute'
                            ? '🎯'
                            : '$'}
                      </span>
                    </div>
                  </div>

                  <div className="col-span-5 space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] text-gray-400 font-semibold">Watch</label>
                      <button
                        type="button"
                        onClick={() =>
                          setSlConfig({
                            ...slConfig,
                            timeoutMins: slConfig.timeoutMins === 0 ? 60 : 0,
                          })
                        }
                        className={`text-[9.5px] px-1.5 py-0.5 rounded font-mono font-bold border cursor-pointer transition-colors ${
                          slConfig.timeoutMins === 0
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/35'
                            : 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                        }`}
                      >
                        {slConfig.timeoutMins === 0 ? '∞ Infinite' : `${slConfig.timeoutMins}m`}
                      </button>
                    </div>
                    {slConfig.timeoutMins === 0 ? (
                      <div className="px-2 py-1.5 rounded-lg bg-[#04070e] border border-white/10 text-[10px] font-mono text-gray-300 text-center">
                        Always Armed
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#04070e] border border-white/10">
                        <input
                          type="range"
                          min="1"
                          max="120"
                          step="1"
                          value={slConfig.timeoutMins}
                          onChange={(e) =>
                            setSlConfig({ ...slConfig, timeoutMins: Number(e.target.value) })
                          }
                          className="w-full accent-rose-500 h-1 bg-black/50 rounded appearance-none cursor-pointer"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* 1-Tap SL % Chips */}
                <div className="flex items-center gap-1">
                  {SL_PCT_CHIPS.map((pct) => {
                    const active = slConfig.mode === 'percentage' && slConfig.value === pct;
                    return (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setSlConfig({ ...slConfig, mode: 'percentage', value: pct })}
                        className={`flex-1 py-1 rounded-md text-[10px] font-mono font-bold border transition-colors cursor-pointer ${
                          active
                            ? 'bg-rose-500/25 border-rose-400 text-rose-200'
                            : 'bg-black/40 hover:bg-white/5 border-white/10 text-gray-400 hover:text-white'
                        }`}
                      >
                        -{pct}%
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* C. Smart Chase Pegging Strategy & Collapsible Tuning Drawer */}
            {isChaseEngine && (
              <div className="rounded-xl bg-amber-950/15 border border-amber-500/25 p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className={pulseDot('bg-amber-400')} />
                    <span className="text-[11px] font-extrabold text-amber-200">
                      {slConfig.type === 'trailing_chase'
                        ? 'Trailing Chase Maker Engine'
                        : 'Smart Chase Maker Engine'}
                    </span>
                  </div>
                  <span className="text-[9.5px] font-mono font-bold text-amber-300">
                    {pegLabel} • Circuit {slConfig.smartChaseDeviationPct}%
                  </span>
                </div>

                {/* Pegging Strategy Switcher (Directly Accessible) */}
                <div className="space-y-1">
                  <div className="grid grid-cols-3 bg-[#04070e] rounded-lg border border-white/10 p-0.5 text-[10px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setSlConfig({ ...slConfig, smartChasePegStrategy: 'bbo' })}
                      className={`py-1 rounded-md transition-colors cursor-pointer ${
                        slConfig.smartChasePegStrategy === 'bbo'
                          ? 'bg-amber-500 text-slate-950 font-bold'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      ⚡ Top BBO
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSlConfig({ ...slConfig, smartChasePegStrategy: 'inside_spread' })
                      }
                      className={`py-1 rounded-md transition-colors cursor-pointer ${
                        slConfig.smartChasePegStrategy === 'inside_spread'
                          ? 'bg-cyan-600 text-white font-bold'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      🎯 Spread+1
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSlConfig({ ...slConfig, smartChasePegStrategy: 'wall_aware' })
                      }
                      className={`py-1 rounded-md transition-colors cursor-pointer ${
                        slConfig.smartChasePegStrategy === 'wall_aware'
                          ? 'bg-orange-600 text-white font-bold'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      🧱 Wall-Aware
                    </button>
                  </div>

                  {slConfig.smartChasePegStrategy === 'inside_spread' && (
                    <p className="text-[9.5px] text-cyan-300/90 leading-tight px-0.5">
                      💡 Jumps 1 tick inside the spread for #1 queue priority maker fill without
                      taker fees.
                    </p>
                  )}

                  {slConfig.smartChasePegStrategy === 'wall_aware' && (
                    <div className="p-2 rounded-lg bg-[#04070e] border border-amber-500/20 space-y-1">
                      <div className="flex justify-between items-center text-[9.5px] font-mono">
                        <span className="text-gray-300">Wall Multiplier Threshold</span>
                        <span className="text-amber-300 font-bold">
                          {slConfig.smartChaseWallMultiplier}x Depth
                        </span>
                      </div>
                      <input
                        type="range"
                        min="1.5"
                        max="5.0"
                        step="0.5"
                        value={slConfig.smartChaseWallMultiplier}
                        onChange={(e) =>
                          setSlConfig({
                            ...slConfig,
                            smartChaseWallMultiplier: parseFloat(e.target.value) || 2.5,
                          })
                        }
                        className="w-full accent-amber-500 h-1 bg-black/50 rounded appearance-none cursor-pointer"
                      />
                    </div>
                  )}
                </div>

                {/* Collapsible Advanced Chase Tuning */}
                <button
                  type="button"
                  onClick={() => setShowChaseAdvanced((v) => !v)}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg bg-[#04070e]/90 hover:bg-white/[0.04] border border-white/10 text-[10px] font-mono cursor-pointer transition-colors"
                >
                  <span className="flex items-center gap-1.5 text-gray-300 font-bold">
                    <SlidersHorizontal className="w-3 h-3 text-amber-400" />
                    <span>Trigger, Mode & Circuit Breaker</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-amber-300">
                    <span className="hidden sm:inline text-[9.5px]">
                      {slConfig.smartChaseTriggerSource === 'bid_ask' ? 'Bid/Ask' : 'Last'} •{' '}
                      {slConfig.smartChaseMode === 'dynamic_bbo' ? 'Live Peg' : 'Timer'} •{' '}
                      {slConfig.smartChaseMaxAttempts === 0 ? '∞' : slConfig.smartChaseMaxAttempts}x
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${
                        showChaseAdvanced ? 'rotate-180' : ''
                      }`}
                    />
                  </span>
                </button>

                {showChaseAdvanced && (
                  <div className="space-y-2.5 pt-1.5 border-t border-amber-500/15">
                    {/* Trigger Basis */}
                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-[10px] text-gray-400">
                        <span className="font-semibold text-gray-300">Trigger Basis</span>
                        <span className="font-mono text-cyan-300 font-bold">
                          {slConfig.smartChaseTriggerSource === 'bid_ask'
                            ? '⚡ Bid / Ask (Fast)'
                            : '📊 Last Trade'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 bg-[#04070e] rounded-lg p-0.5 border border-white/10 text-[10px] font-semibold">
                        <button
                          type="button"
                          onClick={() =>
                            setSlConfig({ ...slConfig, smartChaseTriggerSource: 'last' })
                          }
                          className={`py-1 rounded-md transition-colors cursor-pointer ${
                            slConfig.smartChaseTriggerSource === 'last'
                              ? 'bg-blue-600 text-white font-bold'
                              : 'text-gray-400 hover:text-white'
                          }`}
                        >
                          📊 Last Price
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSlConfig({ ...slConfig, smartChaseTriggerSource: 'bid_ask' })
                          }
                          className={`py-1 rounded-md transition-colors cursor-pointer ${
                            slConfig.smartChaseTriggerSource === 'bid_ask'
                              ? 'bg-cyan-600 text-white font-bold'
                              : 'text-gray-400 hover:text-white'
                          }`}
                        >
                          ⚡ Bid / Ask
                        </button>
                      </div>
                    </div>

                    {/* Chase Timing Mode */}
                    <div className="grid grid-cols-2 bg-[#04070e] rounded-lg p-0.5 border border-white/10 text-[10px] font-semibold">
                      <button
                        type="button"
                        onClick={() =>
                          setSlConfig({ ...slConfig, smartChaseMode: 'dynamic_bbo' })
                        }
                        className={`py-1 rounded-md transition-colors flex items-center justify-center gap-1 cursor-pointer ${
                          slConfig.smartChaseMode === 'dynamic_bbo'
                            ? 'bg-amber-500 text-slate-950 font-bold'
                            : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        <Zap className="w-2.5 h-2.5" />
                        Dynamic BBO Peg
                      </button>
                      <button
                        type="button"
                        onClick={() => setSlConfig({ ...slConfig, smartChaseMode: 'interval' })}
                        className={`py-1 rounded-md transition-colors cursor-pointer ${
                          slConfig.smartChaseMode === 'interval'
                            ? 'bg-amber-500 text-slate-950 font-bold'
                            : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        ⏱️ Interval Timer
                      </button>
                    </div>

                    {/* Circuit Breaker */}
                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-[10px] text-gray-300">
                        <span>Max Slippage Circuit Breaker</span>
                        <span className="text-amber-300 font-bold font-mono">
                          {slConfig.smartChaseDeviationPct}% (Market Sweep)
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="5.0"
                        step="0.1"
                        value={slConfig.smartChaseDeviationPct}
                        onChange={(e) =>
                          setSlConfig({
                            ...slConfig,
                            smartChaseDeviationPct: parseFloat(e.target.value) || 0.5,
                          })
                        }
                        className="w-full accent-amber-500 h-1 bg-black/50 rounded appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Retries & Optional Interval */}
                    <div
                      className={`grid ${
                        slConfig.smartChaseMode === 'dynamic_bbo' ? 'grid-cols-1' : 'grid-cols-2'
                      } gap-2`}
                    >
                      <div className="space-y-1">
                        <label className="text-[10px] text-gray-400 flex justify-between">
                          <span>Max Re-pegs</span>
                          <span className="text-amber-400 font-mono">0 = ∞</span>
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="100000"
                          step="1"
                          value={slConfig.smartChaseMaxAttempts}
                          onChange={(e) =>
                            setSlConfig({
                              ...slConfig,
                              smartChaseMaxAttempts: parseInt(e.target.value, 10) || 0,
                            })
                          }
                          className="w-full bg-[#04070e] border border-white/15 rounded-md py-1 px-2 text-white text-[11px] text-center font-mono focus:outline-none focus:border-amber-400"
                        />
                      </div>
                      {slConfig.smartChaseMode === 'interval' && (
                        <div className="space-y-1">
                          <label className="text-[10px] text-gray-400 flex justify-between">
                            <span>Retry Delay (ms)</span>
                            <span className="text-gray-500">min 200</span>
                          </label>
                          <input
                            type="number"
                            min="200"
                            max="5000"
                            step="100"
                            value={slConfig.smartChaseDelayMs}
                            onChange={(e) =>
                              setSlConfig({
                                ...slConfig,
                                smartChaseDelayMs: parseInt(e.target.value, 10) || 1500,
                              })
                            }
                            className="w-full bg-[#04070e] border border-white/15 rounded-md py-1 px-2 text-white text-[11px] text-center font-mono focus:outline-none focus:border-amber-400"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* D. Protection Guard 1: Auto-Breakeven (Capital Protection) */}
            <div className="rounded-xl bg-emerald-950/15 border border-emerald-500/25 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div
                  className={`flex items-center gap-2 min-w-0 ${
                    isNativeExchangeSlLockedToFixed && !isChaseEngine
                      ? 'opacity-55'
                      : 'cursor-pointer'
                  }`}
                  onClick={() => {
                    if (isNativeExchangeSlLockedToFixed && !isChaseEngine) return;
                    setSlConfig({
                      ...slConfig,
                      autoBreakevenEnabled: !slConfig.autoBreakevenEnabled,
                    });
                  }}
                >
                  <span
                    className={pulseDot(
                      slConfig.autoBreakevenEnabled ? 'bg-emerald-400' : 'bg-gray-600'
                    )}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] font-extrabold text-emerald-200">
                        🛡️ Auto-Breakeven
                      </span>
                      {slConfig.autoBreakevenEnabled ? (
                        <span className="text-[9px] px-1.5 py-0.2 rounded font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/35">
                          +{slConfig.autoBreakevenTriggerPct}% ➔ +{slConfig.autoBreakevenBufferPct}%
                        </span>
                      ) : (
                        <span className="text-[9px] px-1.5 py-0.2 rounded font-mono text-gray-400 bg-white/5 border border-white/10">
                          Risk-Free Ratchet
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {isNativeExchangeSlLockedToFixed && !isChaseEngine ? (
                  <button
                    type="button"
                    onClick={() =>
                      setSlConfig({
                        ...slConfig,
                        type: 'smart_chase',
                        autoBreakevenEnabled: true,
                      })
                    }
                    className="px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 text-[9.5px] font-mono font-bold cursor-pointer shrink-0 transition-colors"
                    title="Auto-Breakeven requires Smart Chase when Native OTO/OTOCO is ON"
                  >
                    ⚡ Use Chase
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setSlConfig({
                        ...slConfig,
                        autoBreakevenEnabled: !slConfig.autoBreakevenEnabled,
                      })
                    }
                    className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer shrink-0 ${
                      slConfig.autoBreakevenEnabled ? 'bg-emerald-500' : 'bg-gray-700'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                        slConfig.autoBreakevenEnabled ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                )}
              </div>

              {slConfig.autoBreakevenEnabled && !(isNativeExchangeSlLockedToFixed && !isChaseEngine) && (
                <div className="space-y-2 pt-1.5 border-t border-emerald-500/15">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-400 flex justify-between">
                        <span>Trigger Profit</span>
                        <span className="text-emerald-300 font-mono font-bold">
                          +{slConfig.autoBreakevenTriggerPct}%
                        </span>
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        max="50"
                        value={slConfig.autoBreakevenTriggerPct}
                        onChange={(e) =>
                          setSlConfig({
                            ...slConfig,
                            autoBreakevenTriggerPct: parseFloat(e.target.value) || 0.5,
                          })
                        }
                        className="w-full bg-[#04070e] border border-emerald-500/25 rounded-md py-1 px-2 text-white text-[11px] text-center font-mono focus:outline-none focus:border-emerald-400"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-400 flex justify-between">
                        <span>Fee Cushion</span>
                        <span className="text-emerald-300 font-mono font-bold">
                          +{slConfig.autoBreakevenBufferPct}%
                        </span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="1.0"
                        value={slConfig.autoBreakevenBufferPct}
                        onChange={(e) =>
                          setSlConfig({
                            ...slConfig,
                            autoBreakevenBufferPct: parseFloat(e.target.value) || 0.05,
                          })
                        }
                        className="w-full bg-[#04070e] border border-emerald-500/25 rounded-md py-1 px-2 text-white text-[11px] text-center font-mono focus:outline-none focus:border-emerald-400"
                        title="Extra buffer past entry to cover exchange commissions"
                      />
                    </div>
                  </div>
                  <p className="text-[9.5px] text-emerald-300/85 leading-tight">
                    At +{slConfig.autoBreakevenTriggerPct}% profit, SL ratchets automatically to
                    Entry + {slConfig.autoBreakevenBufferPct}% fee cushion.
                  </p>
                </div>
              )}
            </div>

            {/* E. Protection Guard 2: Anti-Wick Stop Guard */}
            <AntiWickSlControls
              mode={slConfig.antiWickMode}
              setMode={(m) => setSlConfig({ ...slConfig, antiWickMode: m })}
              dwellSeconds={slConfig.antiWickDwellSeconds}
              setDwellSeconds={(s) => setSlConfig({ ...slConfig, antiWickDwellSeconds: s })}
              timeframe={slConfig.antiWickTimeframe}
              setTimeframe={(tf) => setSlConfig({ ...slConfig, antiWickTimeframe: tf })}
              disasterPct={slConfig.antiWickDisasterPct}
              setDisasterPct={(pct) => setSlConfig({ ...slConfig, antiWickDisasterPct: pct })}
              isLockedByNativeSl={false}
            />
          </div>
        )}
      </div>

      {/* Always-available Auto Fee Estimator when Stop-Loss is OFF */}
      {!slConfig.enabled && feeBreakdown && feeProfile && (
        <TradeFeeEstimatorPanel
          breakdown={feeBreakdown}
          feeProfile={feeProfile}
          bnbDiscountEnabled={bnbDiscountEnabled}
          onToggleBnbDiscount={() => onToggleBnbDiscount?.()}
          onRefreshFees={onRefreshFees}
          isLoadingFees={isLoadingFees}
          leverage={leverage}
          onChangeLeverage={onChangeLeverage}
          scalesNotionalWithLeverage={scalesNotionalWithLeverage}
        />
      )}

      {/* Empty Tip Banner when both legs are OFF */}
      {!tpConfig.enabled && !slConfig.enabled && (
        <div className="px-2.5 py-2 rounded-xl bg-cyan-950/20 border border-cyan-500/25 text-[10.5px] font-mono text-cyan-200/85">
          💡 Pick a 1-tap preset above or turn on Take-Profit / Stop-Loss to arm Binance OTOCO or
          Hybrid Smart Chase protection.
        </div>
      )}
    </div>
  );
};
