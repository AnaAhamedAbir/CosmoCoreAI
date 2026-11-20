import { FastBalanceResponse, FastPositionResponse } from '../services/manualTradeService';

export type OrderSizeMode = 'base' | 'quote' | 'risk_usd' | 'risk_pct';

export interface TpConfigLite {
  enabled: boolean;
  mode: 'percentage' | 'price' | 'absolute' | 'atr';
  value: string | number;
  orderType?: 'Limit' | 'Market';
}

export interface SlConfigLite {
  enabled: boolean;
  type: 'fixed' | 'trailing' | 'smart_chase' | 'trailing_chase';
  mode: 'percentage' | 'price' | 'absolute' | 'atr';
  value: string | number;
  atrPeriod?: number;
  atrMultiplier?: number;
  atrTimeframe?: string;
}

export interface RiskSizingResult {
  riskUsd: number;
  baseAmount: number;
  idealBaseAmount: number;
  quoteNotional: number;
  contractsCount?: number;
  targetSlPrice: number | null;
  slDistanceAbs: number;
  slDistancePct: number;
  isMarginCapped: boolean;
  warning: string | null;
}

export interface TradePnlPreview {
  entryRefPrice: number;
  tpPrice: number | null;
  slPrice: number | null;
  estProfitUsd: number | null;
  estProfitPct: number | null;
  maxLossUsd: number | null;
  maxLossPct: number | null;
  riskRewardRatio: number | null;
  isLowRR: boolean;
  notionalUsd: number;
  takerFeeUsd: number;
  makerFeeSavingsUsd: number;
}

export function resolveTargetPriceFromConfig(
  refPrice: number,
  side: 'Buy' | 'Sell',
  isTp: boolean,
  cfg: { enabled: boolean; mode: string; value: string | number }
): number | null {
  if (!cfg.enabled || refPrice <= 0) return null;
  if (cfg.mode === 'atr') return null;
  const val = Number(cfg.value);
  if (!Number.isFinite(val) || val <= 0) return null;

  const isBuy = side === 'Buy';
  let target = 0;
  if (cfg.mode === 'percentage') {
    const frac = val / 100;
    target = isTp
      ? (isBuy ? refPrice * (1 + frac) : refPrice * (1 - frac))
      : (isBuy ? refPrice * (1 - frac) : refPrice * (1 + frac));
  } else if (cfg.mode === 'price') {
    target = isTp
      ? (isBuy ? refPrice + val : refPrice - val)
      : (isBuy ? refPrice - val : refPrice + val);
  } else if (cfg.mode === 'absolute') {
    target = val;
  }
  return target > 0 ? target : null;
}

export function getAvailableRiskEquityUsd(
  balance: FastBalanceResponse | null,
  entryPrice: number,
  side: 'Buy' | 'Sell',
  isFutures: boolean,
  isInverseFutures: boolean
): number {
  if (!balance) return 0;
  if (isInverseFutures) {
    return (balance.base_free || 0) * Math.max(0, entryPrice);
  }
  if (isFutures) {
    return balance.quote_free || 0;
  }
  if (side === 'Buy') {
    return balance.quote_free || 0;
  }
  return (balance.base_free || 0) * Math.max(0, entryPrice);
}

export function calculateRiskBasedPositionSize(params: {
  riskValue: number;
  riskMode: 'risk_usd' | 'risk_pct';
  entryPrice: number;
  side: 'Buy' | 'Sell';
  slConfig: SlConfigLite;
  balance: FastBalanceResponse | null;
  isFutures: boolean;
  leverage: number;
  reduceOnly: boolean;
  positionData: FastPositionResponse | null;
  isInverseFutures: boolean;
  contractSize: number;
}): RiskSizingResult {
  const {
    riskValue,
    riskMode,
    entryPrice,
    side,
    slConfig,
    balance,
    isFutures,
    leverage,
    reduceOnly,
    positionData,
    isInverseFutures,
    contractSize,
  } = params;

  const zeroResult = (warning: string | null = null): RiskSizingResult => ({
    riskUsd: 0,
    baseAmount: 0,
    idealBaseAmount: 0,
    quoteNotional: 0,
    contractsCount: undefined,
    targetSlPrice: null,
    slDistanceAbs: 0,
    slDistancePct: 0,
    isMarginCapped: false,
    warning,
  });

  if (entryPrice <= 0) return zeroResult('Waiting for live entry price...');
  if (!slConfig.enabled) return zeroResult('Enable Stop-Loss in 🎯 TP/SL tab to calculate Risk Size.');
  if (slConfig.mode === 'atr') return zeroResult('ATR SL uses live volatility; switch SL to % / $ / Exact for Risk Sizing.');

  const slPrice = resolveTargetPriceFromConfig(entryPrice, side, false, slConfig);
  if (!slPrice || slPrice <= 0) {
    return zeroResult('Set a valid Stop-Loss distance in 🎯 TP/SL tab.');
  }

  // Validate SL direction
  if (side === 'Buy' && slPrice >= entryPrice) {
    return zeroResult('BUY Stop-Loss must be BELOW entry price.');
  }
  if (side === 'Sell' && slPrice <= entryPrice) {
    return zeroResult('SELL Stop-Loss must be ABOVE entry price.');
  }

  const slDistanceAbs = Math.abs(entryPrice - slPrice);
  const slDistancePct = (slDistanceAbs / entryPrice) * 100;
  if (slDistanceAbs <= 1e-12 || slDistancePct < 0.005) {
    return zeroResult('Stop-Loss distance is too narrow (< 0.005%).');
  }

  if (!Number.isFinite(riskValue) || riskValue <= 0) {
    return {
      ...zeroResult(null),
      targetSlPrice: slPrice,
      slDistanceAbs,
      slDistancePct,
    };
  }

  const availEquityUsd = getAvailableRiskEquityUsd(balance, entryPrice, side, isFutures, isInverseFutures);
  const riskUsd = riskMode === 'risk_pct'
    ? (availEquityUsd > 0 ? availEquityUsd * (riskValue / 100) : 0)
    : riskValue;

  if (riskUsd <= 0) {
    return {
      ...zeroResult(availEquityUsd <= 0 && riskMode === 'risk_pct' ? 'Waiting for wallet balance to compute % Risk...' : null),
      targetSlPrice: slPrice,
      slDistanceAbs,
      slDistancePct,
    };
  }

  const idealBaseAmount = riskUsd / slDistanceAbs;

  // Check affordability cap against wallet balance + leverage
  let maxAffordableBase = Number.POSITIVE_INFINITY;
  if (balance) {
    if (isInverseFutures) {
      if (reduceOnly && positionData && positionData.amount > 0) {
        maxAffordableBase = positionData.amount;
      } else {
        const maxNotional = (balance.base_free || 0) * 0.985 * entryPrice * Math.max(1, leverage);
        maxAffordableBase = maxNotional / entryPrice;
      }
    } else if (isFutures) {
      if (reduceOnly && positionData && positionData.amount > 0) {
        maxAffordableBase = positionData.amount;
      } else {
        maxAffordableBase = ((balance.quote_free || 0) * 0.985 * Math.max(1, leverage)) / entryPrice;
      }
    } else {
      maxAffordableBase = side === 'Buy'
        ? (balance.quote_free || 0) / entryPrice
        : (balance.base_free || 0);
    }
  }

  const isMarginCapped = Number.isFinite(maxAffordableBase) && idealBaseAmount > maxAffordableBase && maxAffordableBase >= 0;
  const clampedBase = isMarginCapped ? Math.max(0, maxAffordableBase) : idealBaseAmount;
  const quoteNotional = clampedBase * entryPrice;
  const contractsCount = isInverseFutures && contractSize > 0
    ? Math.max(1, Math.round(quoteNotional / contractSize))
    : undefined;

  let warning: string | null = null;
  if (isMarginCapped) {
    const actualRisk = clampedBase * slDistanceAbs;
    warning = `Balance/Leverage caps max position @ $${quoteNotional.toFixed(0)} (actual SL risk ~$${actualRisk.toFixed(2)}).`;
  }

  return {
    riskUsd,
    baseAmount: clampedBase,
    idealBaseAmount,
    quoteNotional,
    contractsCount,
    targetSlPrice: slPrice,
    slDistanceAbs,
    slDistancePct,
    isMarginCapped,
    warning,
  };
}

export function calculateTradePnlAndRRPreview(params: {
  baseAmount: number;
  entryPrice: number;
  side: 'Buy' | 'Sell';
  tpConfig: TpConfigLite;
  slConfig: SlConfigLite;
  orderType: 'Limit' | 'Market' | 'SmartPeg';
  isFutures: boolean;
}): TradePnlPreview {
  const { baseAmount, entryPrice, side, tpConfig, slConfig, orderType, isFutures } = params;
  const empty: TradePnlPreview = {
    entryRefPrice: entryPrice,
    tpPrice: null,
    slPrice: null,
    estProfitUsd: null,
    estProfitPct: null,
    maxLossUsd: null,
    maxLossPct: null,
    riskRewardRatio: null,
    isLowRR: false,
    notionalUsd: 0,
    takerFeeUsd: 0,
    makerFeeSavingsUsd: 0,
  };
  if (entryPrice <= 0 || baseAmount <= 0) return empty;

  const notionalUsd = baseAmount * entryPrice;
  const tpPrice = resolveTargetPriceFromConfig(entryPrice, side, true, tpConfig);
  const slPrice = resolveTargetPriceFromConfig(entryPrice, side, false, slConfig);

  let estProfitUsd: number | null = null;
  let estProfitPct: number | null = null;
  if (tpPrice && tpPrice > 0) {
    const diff = side === 'Buy' ? tpPrice - entryPrice : entryPrice - tpPrice;
    if (diff > 0) {
      estProfitUsd = diff * baseAmount;
      estProfitPct = (diff / entryPrice) * 100;
    }
  }

  let maxLossUsd: number | null = null;
  let maxLossPct: number | null = null;
  if (slPrice && slPrice > 0) {
    const diff = side === 'Buy' ? entryPrice - slPrice : slPrice - entryPrice;
    if (diff > 0) {
      maxLossUsd = diff * baseAmount;
      maxLossPct = (diff / entryPrice) * 100;
    }
  }

  const riskRewardRatio =
    estProfitUsd !== null && maxLossUsd !== null && maxLossUsd > 0
      ? estProfitUsd / maxLossUsd
      : null;

  // Standard taker rate comparison (Binance Futures ~0.05%, Spot ~0.10%) vs 0% Maker SmartPeg/Chase
  const singleLegTakerRate = isFutures ? 0.0005 : 0.001;
  const singleLegMakerRate = isFutures ? 0.0002 : 0.0;
  const takerFeeUsd = notionalUsd * singleLegTakerRate;
  const makerFeeSavingsUsd = Math.max(0, notionalUsd * (singleLegTakerRate - singleLegMakerRate));

  return {
    entryRefPrice: entryPrice,
    tpPrice,
    slPrice,
    estProfitUsd,
    estProfitPct,
    maxLossUsd,
    maxLossPct,
    riskRewardRatio,
    isLowRR: riskRewardRatio !== null && riskRewardRatio < 1.0,
    notionalUsd,
    takerFeeUsd: orderType === 'SmartPeg' ? notionalUsd * singleLegMakerRate : takerFeeUsd,
    makerFeeSavingsUsd,
  };
}

export function calculateDragLineDeltaUsd(params: {
  dragType: 'tp' | 'sl' | 'buy' | 'sell' | 'peg_buy' | 'peg_sell';
  dropPrice: number;
  refEntryPrice: number;
  baseAmount: number;
  tradeSide: 'Buy' | 'Sell';
}): { usd: number; isProfit: boolean } | null {
  const { dragType, dropPrice, refEntryPrice, baseAmount, tradeSide } = params;
  if (baseAmount <= 0 || refEntryPrice <= 0 || dropPrice <= 0) return null;

  if (dragType === 'tp') {
    const gain = Math.abs(dropPrice - refEntryPrice) * baseAmount;
    const isBuyDir = dropPrice >= refEntryPrice;
    return { usd: gain, isProfit: tradeSide === 'Buy' ? isBuyDir : !isBuyDir };
  }
  if (dragType === 'sl') {
    const loss = Math.abs(dropPrice - refEntryPrice) * baseAmount;
    return { usd: loss, isProfit: false };
  }
  return null;
}
