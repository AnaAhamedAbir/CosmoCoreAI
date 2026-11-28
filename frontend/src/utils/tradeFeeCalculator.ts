/**
 * Modular Trade Fee & Leverage Impact Calculation Engine.
 *
 * Computes accurate Spot, USD-M Futures, and COIN-M Inverse Futures fees for:
 *  - Entry Leg (Limit / SmartPeg Maker vs Market Taker)
 *  - Stop-Loss Leg (Exchange Native Taker vs Smart Chase Maker)
 *  - Take-Profit Leg (Limit Maker vs Market Taker)
 *  - Round-Trip Cost (USD + % of Margin), Leverage Risk Grading,
 *    Net PnL / Net R:R, Breakeven Price Move %, and Native vs Smart Chase Savings.
 */

import { SlConfigLite, TpConfigLite } from './riskAndPnlCalculator';

export type FeeMarketType = 'spot' | 'usdm_futures' | 'coinm_futures';
export type FeeRateSource = 'live_api' | 'market_meta' | 'estimated_default';
export type LeverageFeeRiskLevel = 'low' | 'moderate' | 'high' | 'extreme';

export interface TradingFeeProfile {
  symbol: string;
  exchange: string;
  market_type: FeeMarketType;
  is_futures: boolean;
  is_inverse: boolean;
  base: string;
  quote: string;
  settle: string;
  maker_rate: number; // decimal ratio, e.g. 0.0002 = 0.02%
  taker_rate: number; // decimal ratio, e.g. 0.0005 = 0.05%
  bnb_discount_supported: boolean;
  bnb_discount_rate: number; // e.g. 0.25 for Binance Spot, 0.10 for Binance Futures
  bnb_burn_active: boolean | null;
  source: FeeRateSource;
  tier_label: string;
  cached?: boolean;
  updated_at?: number;
}

export interface FeeLegSummary {
  isMaker: boolean;
  rate: number; // effective decimal rate after discount
  ratePct: number; // percentage, e.g. 0.05
  feeUsd: number;
  feeBaseAsset: number | null; // populated for COIN-M inverse pairs
  label: string;
  executionNote: string;
}

export interface LeveragePreviewPoint {
  leverage: number;
  notionalUsd: number;
  marginUsd: number;
  slExitFeeUsd: number;
  roundTripSlFeeUsd: number;
  slFeePctOfMargin: number;
  riskLevel: LeverageFeeRiskLevel;
}

export interface TradeFeeBreakdown {
  hasPositionSize: boolean;
  symbol: string;
  baseCurrency: string;
  quoteCurrency: string;
  settleCurrency: string;
  marketType: FeeMarketType;
  isFutures: boolean;
  isInverse: boolean;
  leverage: number;
  source: FeeRateSource;
  tierLabel: string;

  // Effective rates (after optional BNB discount)
  rawMakerRate: number;
  rawTakerRate: number;
  effectiveMakerRate: number;
  effectiveTakerRate: number;
  bnbDiscountApplied: boolean;
  bnbDiscountPct: number;

  // Position economics
  baseAmount: number;
  entryPrice: number;
  notionalEntryUsd: number;
  notionalSlUsd: number;
  notionalTpUsd: number;
  requiredMarginUsd: number;

  // Leg-by-leg fees
  entryLeg: FeeLegSummary;
  slLeg: FeeLegSummary & {
    enabled: boolean;
    isExchangeNative: boolean;
    isChaseEngine: boolean;
  };
  tpLeg: FeeLegSummary & {
    enabled: boolean;
  };

  // Round-trip scenarios
  roundTripSlFeeUsd: number;
  roundTripTpFeeUsd: number;
  slSingleLegPctOfMargin: number;
  slRoundTripPctOfMargin: number;
  tpRoundTripPctOfMargin: number;

  // Breakeven move required solely to cover round-trip fees (%)
  breakevenSlMovePct: number;
  breakevenTpMovePct: number;

  // Exchange Native SL vs Smart Chase SL comparison
  nativeSlExitFeeUsd: number;
  smartChaseSlExitFeeUsd: number;
  nativeSlRoundTripUsd: number;
  smartChaseSlRoundTripUsd: number;
  smartChaseSlSavingsUsd: number;
  smartChaseSlSavingsPctOfMargin: number;

  // Net PnL & Net R:R (Fee-Adjusted)
  grossTpProfitUsd: number | null;
  grossSlLossUsd: number | null;
  netTpProfitUsd: number | null;
  netSlMaxLossUsd: number | null;
  netRiskRewardRatio: number | null;
  isNetTpNegative: boolean;

  // Leverage Risk Grading
  leverageRiskLevel: LeverageFeeRiskLevel;
  leverageRiskMessage: string | null;
}

const EXCHANGE_DEFAULTS: Record<string, Record<FeeMarketType, [number, number]>> = {
  binance: {
    spot: [0.001, 0.001],
    usdm_futures: [0.0002, 0.0005],
    coinm_futures: [0.0002, 0.0005],
  },
  bybit: {
    spot: [0.001, 0.001],
    usdm_futures: [0.0002, 0.00055],
    coinm_futures: [0.0002, 0.00055],
  },
  okx: {
    spot: [0.0008, 0.001],
    usdm_futures: [0.0002, 0.0005],
    coinm_futures: [0.0002, 0.0005],
  },
  bitget: {
    spot: [0.001, 0.001],
    usdm_futures: [0.0002, 0.0006],
    coinm_futures: [0.0002, 0.0006],
  },
  mexc: {
    spot: [0.0, 0.0005],
    usdm_futures: [0.0, 0.0002],
    coinm_futures: [0.0, 0.0002],
  },
  kucoin: {
    spot: [0.001, 0.001],
    usdm_futures: [0.0002, 0.0006],
    coinm_futures: [0.0002, 0.0006],
  },
};

const BINANCE_ZERO_MAKER_SPOT_QUOTES = new Set(['FDUSD', 'TUSD']);

export function normalizeExchangeFamily(exchangeId?: string | null): string {
  const raw = (exchangeId || 'binance').trim().toLowerCase();
  for (const fam of ['binance', 'bybit', 'okx', 'bitget', 'mexc', 'kucoin']) {
    if (raw.startsWith(fam)) return fam;
  }
  return raw || 'binance';
}

export function parseSymbolFeeParts(symbol: string): {
  base: string;
  quote: string;
  settle: string;
  isFutures: boolean;
  isInverse: boolean;
  marketType: FeeMarketType;
} {
  const sym = (symbol || '').trim().toUpperCase();
  const isFutures = sym.includes(':');
  let base = sym;
  let quote = 'USDT';
  let settle = 'USDT';

  if (sym.includes('/')) {
    const [left, right] = sym.split('/', 2);
    base = left || sym;
    if (right.includes(':')) {
      const [q, s] = right.split(':', 2);
      quote = q || 'USDT';
      settle = s || quote;
    } else {
      quote = right || 'USDT';
      settle = quote;
    }
  }

  const isInverse = Boolean(isFutures && settle && base && settle === base);
  const marketType: FeeMarketType = isInverse
    ? 'coinm_futures'
    : isFutures
      ? 'usdm_futures'
      : 'spot';

  return { base, quote, settle, isFutures, isInverse, marketType };
}

export function getFallbackFeeProfile(
  symbol: string,
  exchangeId: string = 'binance',
  isFuturesOverride?: boolean,
  isInverseOverride?: boolean
): TradingFeeProfile {
  const parts = parseSymbolFeeParts(symbol);
  const isFutures = isFuturesOverride ?? parts.isFutures;
  const isInverse = isInverseOverride ?? parts.isInverse;
  const marketType: FeeMarketType = isInverse
    ? 'coinm_futures'
    : isFutures
      ? 'usdm_futures'
      : 'spot';
  const family = normalizeExchangeFamily(exchangeId);
  const table = EXCHANGE_DEFAULTS[family] || EXCHANGE_DEFAULTS.binance;
  let [makerRate, takerRate] = table[marketType] || [0.001, 0.001];

  let tierLabel = `${family.charAt(0).toUpperCase() + family.slice(1)} Standard`;
  if (
    family === 'binance' &&
    marketType === 'spot' &&
    BINANCE_ZERO_MAKER_SPOT_QUOTES.has(parts.quote)
  ) {
    makerRate = 0.0;
    tierLabel = `Binance ${parts.quote} 0% Maker`;
  } else if (family === 'binance' && marketType === 'usdm_futures' && parts.quote === 'USDC') {
    makerRate = 0.0;
    takerRate = 0.0004;
    tierLabel = 'Binance USDC Futures (0% Maker)';
  } else if (family === 'binance' && marketType === 'usdm_futures') {
    tierLabel = 'Binance USD-M Standard';
  } else if (family === 'binance' && marketType === 'coinm_futures') {
    tierLabel = 'Binance COIN-M Standard';
  }

  const bnbDiscountRate =
    family === 'binance' && marketType === 'spot'
      ? 0.25
      : family === 'binance' && marketType === 'usdm_futures'
        ? 0.10
        : 0.0;

  return {
    symbol: (symbol || '').trim().toUpperCase(),
    exchange: family,
    market_type: marketType,
    is_futures: isFutures,
    is_inverse: isInverse,
    base: parts.base,
    quote: parts.quote,
    settle: parts.settle,
    maker_rate: makerRate,
    taker_rate: takerRate,
    bnb_discount_supported: bnbDiscountRate > 0,
    bnb_discount_rate: bnbDiscountRate,
    bnb_burn_active: null,
    source: 'estimated_default',
    tier_label: tierLabel,
  };
}

export function classifyLeverageFeeRisk(
  slRoundTripPctOfMargin: number,
  isFutures: boolean,
  leverage: number,
  isExchangeNativeSl: boolean
): { level: LeverageFeeRiskLevel; message: string | null } {
  if (!isFutures) {
    if (slRoundTripPctOfMargin >= 0.25 && isExchangeNativeSl) {
      return {
        level: 'moderate',
        message: 'Spot Taker SL charges standard taker fee. Switch SL to Smart Chase for Maker rate.',
      };
    }
    return { level: 'low', message: null };
  }

  if (slRoundTripPctOfMargin >= 5.0) {
    return {
      level: 'extreme',
      message: `${leverage}x leverage amplifies round-trip SL fees to ${slRoundTripPctOfMargin.toFixed(2)}% of your margin! Lower leverage or use Smart Chase Maker SL.`,
    };
  }
  if (slRoundTripPctOfMargin >= 2.5) {
    return {
      level: 'high',
      message: `At ${leverage}x leverage, entry + SL fees consume ${slRoundTripPctOfMargin.toFixed(2)}% of margin before slippage.`,
    };
  }
  if (slRoundTripPctOfMargin >= 1.0) {
    return {
      level: 'moderate',
      message: `${leverage}x leverage fee drag is ${slRoundTripPctOfMargin.toFixed(2)}% of margin on SL hit.`,
    };
  }
  return { level: 'low', message: null };
}

export function formatFeeUsd(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return '$0.00';
  if (val < 0.01) return `$${val.toFixed(4)}`;
  if (val < 1) return `$${val.toFixed(3)}`;
  if (val >= 1000) {
    return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${val.toFixed(2)}`;
}

export function formatFeeRatePct(rateDecimal: number): string {
  const pct = Math.max(0, rateDecimal * 100);
  if (pct === 0) return '0%';
  if (pct < 0.01) return `${pct.toFixed(4)}%`;
  if (pct < 0.1) return `${Number(pct.toFixed(3))}%`;
  return `${Number(pct.toFixed(3))}%`;
}

export function calculateTradeFeeBreakdown(params: {
  symbol: string;
  exchangeId?: string;
  feeProfile?: TradingFeeProfile | null;
  bnbDiscountEnabled?: boolean;
  isFutures: boolean;
  isInverse?: boolean;
  leverage: number;
  baseAmount: number;
  entryPrice: number;
  tpPrice: number | null;
  slPrice: number | null;
  side: 'Buy' | 'Sell';
  orderType: 'Limit' | 'Market' | 'SmartPeg';
  tpConfig: TpConfigLite;
  slConfig: SlConfigLite;
}): TradeFeeBreakdown {
  const {
    symbol,
    exchangeId = 'binance',
    feeProfile,
    bnbDiscountEnabled = false,
    isFutures,
    isInverse = false,
    leverage,
    baseAmount,
    entryPrice,
    tpPrice,
    slPrice,
    side,
    orderType,
    tpConfig,
    slConfig,
  } = params;

  const profile =
    feeProfile || getFallbackFeeProfile(symbol, exchangeId, isFutures, isInverse);
  const safeLeverage = isFutures ? Math.max(1, Math.min(125, Number(leverage) || 1)) : 1;
  const safeEntry = entryPrice > 0 && Number.isFinite(entryPrice) ? entryPrice : 0;
  const safeBase = baseAmount > 0 && Number.isFinite(baseAmount) ? baseAmount : 0;

  const bnbDiscountApplied = Boolean(
    bnbDiscountEnabled && profile.bnb_discount_supported && profile.bnb_discount_rate > 0
  );
  const discountFactor = bnbDiscountApplied ? Math.max(0, 1 - profile.bnb_discount_rate) : 1;

  const rawMakerRate = Math.max(0, Number(profile.maker_rate) || 0);
  const rawTakerRate = Math.max(0, Number(profile.taker_rate) || 0);
  const effectiveMakerRate = rawMakerRate * discountFactor;
  const effectiveTakerRate = rawTakerRate * discountFactor;

  const notionalEntryUsd = safeBase * safeEntry;
  const effSlPrice = slPrice && slPrice > 0 ? slPrice : safeEntry;
  const effTpPrice = tpPrice && tpPrice > 0 ? tpPrice : safeEntry;
  const notionalSlUsd = safeBase * effSlPrice;
  const notionalTpUsd = safeBase * effTpPrice;
  const requiredMarginUsd =
    notionalEntryUsd > 0 ? (isFutures ? notionalEntryUsd / safeLeverage : notionalEntryUsd) : 0;

  // 1. Entry Leg
  const entryIsMaker = orderType !== 'Market';
  const entryRate = entryIsMaker ? effectiveMakerRate : effectiveTakerRate;
  const entryFeeUsd = notionalEntryUsd * entryRate;
  const entryLeg: FeeLegSummary = {
    isMaker: entryIsMaker,
    rate: entryRate,
    ratePct: entryRate * 100,
    feeUsd: entryFeeUsd,
    feeBaseAsset: isInverse && safeEntry > 0 ? entryFeeUsd / safeEntry : null,
    label:
      orderType === 'SmartPeg'
        ? 'SmartPeg Maker'
        : orderType === 'Limit'
          ? 'Limit Maker'
          : 'Market Taker',
    executionNote:
      orderType === 'Market'
        ? 'Crosses spread immediately (Taker fee).'
        : 'Rests on orderbook (Maker fee; crosses book = Taker).',
  };

  // 2. Stop-Loss Leg
  const isChaseEngine =
    slConfig.type === 'smart_chase' || slConfig.type === 'trailing_chase';
  const isExchangeNative = slConfig.enabled && !isChaseEngine;
  const slIsMaker = isChaseEngine;
  const slRate = slConfig.enabled ? (slIsMaker ? effectiveMakerRate : effectiveTakerRate) : 0;
  const slFeeUsd = slConfig.enabled ? notionalSlUsd * slRate : 0;

  const slLeg = {
    enabled: slConfig.enabled,
    isExchangeNative,
    isChaseEngine,
    isMaker: slIsMaker,
    rate: slRate,
    ratePct: slRate * 100,
    feeUsd: slFeeUsd,
    feeBaseAsset: isInverse && effSlPrice > 0 ? slFeeUsd / effSlPrice : null,
    label: !slConfig.enabled
      ? 'SL Off'
      : isChaseEngine
        ? 'Smart Chase Maker'
        : isFutures
          ? 'Native Stop-Market (Taker)'
          : 'Native Stop-Limit (Taker)',
    executionNote: !slConfig.enabled
      ? 'No automatic stop-loss armed.'
      : isChaseEngine
        ? 'Post-Only Maker chase loop (reverts to Taker only if Circuit Breaker sweeps).'
        : 'Triggers directly on exchange book and crosses liquidity (Taker commission).',
  };

  // 3. Take-Profit Leg
  const tpIsMaker = (tpConfig.orderType || 'Limit') !== 'Market';
  const tpRate = tpConfig.enabled ? (tpIsMaker ? effectiveMakerRate : effectiveTakerRate) : 0;
  const tpFeeUsd = tpConfig.enabled ? notionalTpUsd * tpRate : 0;
  const tpLeg = {
    enabled: tpConfig.enabled,
    isMaker: tpIsMaker,
    rate: tpRate,
    ratePct: tpRate * 100,
    feeUsd: tpFeeUsd,
    feeBaseAsset: isInverse && effTpPrice > 0 ? tpFeeUsd / effTpPrice : null,
    label: !tpConfig.enabled
      ? 'TP Off'
      : tpIsMaker
        ? 'TP Limit Maker'
        : 'TP Market Taker',
    executionNote: !tpConfig.enabled
      ? 'Manual exit.'
      : tpIsMaker
        ? 'Rests on orderbook at target price (Maker fee).'
        : 'Fires market order on target touch (Taker fee).',
  };

  // 4. Native SL vs Smart Chase Comparison (computed even if SL is currently Smart Chase)
  const nativeSlExitFeeUsd = notionalSlUsd * effectiveTakerRate;
  const smartChaseSlExitFeeUsd = notionalSlUsd * effectiveMakerRate;
  const nativeSlRoundTripUsd = entryFeeUsd + nativeSlExitFeeUsd;
  const smartChaseSlRoundTripUsd = entryFeeUsd + smartChaseSlExitFeeUsd;
  const smartChaseSlSavingsUsd = Math.max(0, nativeSlExitFeeUsd - smartChaseSlExitFeeUsd);
  const smartChaseSlSavingsPctOfMargin =
    requiredMarginUsd > 0 ? (smartChaseSlSavingsUsd / requiredMarginUsd) * 100 : 0;

  // 5. Round-Trip & Margin Percentages
  const roundTripSlFeeUsd = entryFeeUsd + slFeeUsd;
  const roundTripTpFeeUsd = entryFeeUsd + tpFeeUsd;
  const slSingleLegPctOfMargin =
    requiredMarginUsd > 0 ? (slFeeUsd / requiredMarginUsd) * 100 : 0;
  const slRoundTripPctOfMargin =
    requiredMarginUsd > 0 ? (roundTripSlFeeUsd / requiredMarginUsd) * 100 : 0;
  const tpRoundTripPctOfMargin =
    requiredMarginUsd > 0 ? (roundTripTpFeeUsd / requiredMarginUsd) * 100 : 0;

  // Fee-adjusted breakeven move (%)
  const breakevenSlMovePct = (entryRate + (slConfig.enabled ? slRate : effectiveTakerRate)) * 100;
  const breakevenTpMovePct = (entryRate + (tpConfig.enabled ? tpRate : effectiveMakerRate)) * 100;

  // 6. Gross & Net PnL + Net R:R
  let grossTpProfitUsd: number | null = null;
  if (tpConfig.enabled && tpPrice && tpPrice > 0 && safeEntry > 0 && safeBase > 0) {
    const diff = side === 'Buy' ? tpPrice - safeEntry : safeEntry - tpPrice;
    if (diff > 0) {
      grossTpProfitUsd = diff * safeBase;
    }
  }

  let grossSlLossUsd: number | null = null;
  if (slConfig.enabled && slPrice && slPrice > 0 && safeEntry > 0 && safeBase > 0) {
    const diff = side === 'Buy' ? safeEntry - slPrice : slPrice - safeEntry;
    if (diff > 0) {
      grossSlLossUsd = diff * safeBase;
    }
  }

  const netTpProfitUsd =
    grossTpProfitUsd !== null ? grossTpProfitUsd - roundTripTpFeeUsd : null;
  const netSlMaxLossUsd =
    grossSlLossUsd !== null ? grossSlLossUsd + roundTripSlFeeUsd : null;
  const netRiskRewardRatio =
    netTpProfitUsd !== null && netSlMaxLossUsd !== null && netSlMaxLossUsd > 0 && netTpProfitUsd > 0
      ? netTpProfitUsd / netSlMaxLossUsd
      : null;
  const isNetTpNegative = netTpProfitUsd !== null && netTpProfitUsd <= 0;

  // 7. Leverage Fee Risk Grade
  // Even when size == 0, estimate leverage risk directly from (entryRate + exitRate) * leverage * 100
  const effectivePctForRisk =
    requiredMarginUsd > 0
      ? slRoundTripPctOfMargin
      : (entryRate + (slConfig.enabled ? slRate : effectiveTakerRate)) * safeLeverage * 100;

  const { level: leverageRiskLevel, message: leverageRiskMessage } = classifyLeverageFeeRisk(
    effectivePctForRisk,
    isFutures,
    safeLeverage,
    isExchangeNative
  );

  return {
    hasPositionSize: safeBase > 0 && safeEntry > 0,
    symbol: profile.symbol || symbol,
    baseCurrency: profile.base,
    quoteCurrency: profile.quote,
    settleCurrency: profile.settle,
    marketType: profile.market_type,
    isFutures,
    isInverse,
    leverage: safeLeverage,
    source: profile.source,
    tierLabel: profile.tier_label,

    rawMakerRate,
    rawTakerRate,
    effectiveMakerRate,
    effectiveTakerRate,
    bnbDiscountApplied,
    bnbDiscountPct: bnbDiscountApplied ? profile.bnb_discount_rate * 100 : 0,

    baseAmount: safeBase,
    entryPrice: safeEntry,
    notionalEntryUsd,
    notionalSlUsd,
    notionalTpUsd,
    requiredMarginUsd,

    entryLeg,
    slLeg,
    tpLeg,

    roundTripSlFeeUsd,
    roundTripTpFeeUsd,
    slSingleLegPctOfMargin,
    slRoundTripPctOfMargin,
    tpRoundTripPctOfMargin,

    breakevenSlMovePct,
    breakevenTpMovePct,

    nativeSlExitFeeUsd,
    smartChaseSlExitFeeUsd,
    nativeSlRoundTripUsd,
    smartChaseSlRoundTripUsd,
    smartChaseSlSavingsUsd,
    smartChaseSlSavingsPctOfMargin,

    grossTpProfitUsd,
    grossSlLossUsd,
    netTpProfitUsd,
    netSlMaxLossUsd,
    netRiskRewardRatio,
    isNetTpNegative,

    leverageRiskLevel,
    leverageRiskMessage,
  };
}

/**
 * Generates a quick leverage fee sensitivity ladder (e.g. 1x, 5x, 10x, 20x, 50x, 100x)
 * for Futures mode. When `scalesNotionalWithLeverage` is true (balance-% sizing),
 * Margin stays fixed and Notional scales linearly with leverage; when false (fixed qty),
 * Notional stays fixed and Margin shrinks as leverage rises.
 */
export function buildLeverageFeeLadder(params: {
  breakdown: TradeFeeBreakdown;
  scalesNotionalWithLeverage: boolean;
  presets?: number[];
}): LeveragePreviewPoint[] {
  const {
    breakdown,
    scalesNotionalWithLeverage,
    presets = [1, 5, 10, 20, 50, 100],
  } = params;
  if (!breakdown.isFutures) return [];

  const currentMargin = breakdown.requiredMarginUsd;
  const currentNotional = breakdown.notionalEntryUsd;
  const entryRate = breakdown.entryLeg.rate;
  const slRate = breakdown.slLeg.enabled
    ? breakdown.slLeg.rate
    : breakdown.effectiveTakerRate;

  return presets.map((lev) => {
    let notionalUsd = 0;
    let marginUsd = 0;
    if (scalesNotionalWithLeverage && currentMargin > 0) {
      marginUsd = currentMargin;
      notionalUsd = currentMargin * lev;
    } else if (currentNotional > 0) {
      notionalUsd = currentNotional;
      marginUsd = currentNotional / lev;
    }

    const slExitFeeUsd = notionalUsd * slRate;
    const roundTripSlFeeUsd = notionalUsd * (entryRate + slRate);
    const slFeePctOfMargin =
      marginUsd > 0
        ? (roundTripSlFeeUsd / marginUsd) * 100
        : (entryRate + slRate) * lev * 100;

    const { level: riskLevel } = classifyLeverageFeeRisk(
      slFeePctOfMargin,
      true,
      lev,
      breakdown.slLeg.isExchangeNative
    );

    return {
      leverage: lev,
      notionalUsd,
      marginUsd,
      slExitFeeUsd,
      roundTripSlFeeUsd,
      slFeePctOfMargin,
      riskLevel,
    };
  });
}
