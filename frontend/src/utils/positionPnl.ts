import { OpenLimitOrder } from '@/hooks/useOpenOrders';
import { FastPositionResponse } from '@/services/manualTradeService';

export interface EntryContext {
  entryPrice: number;
  side: 'long' | 'short';
  amount: number;
  isInverse: boolean;
  contracts?: number;
  contractSize?: number;
  leverage?: number | null;
  source: 'futures_position' | 'spot_bracket';
}

export interface ComputedTradePnl {
  pnlUsd: number;
  pnlPct: number;
  notionalUsd: number;
}

/**
 * Compute gross unrealized or projected P/L for linear Spot/Futures and COIN-M Inverse contracts.
 */
export function computeTradePnl(params: {
  entryPrice: number;
  targetPrice: number;
  amount: number;
  side: 'long' | 'short';
  isInverse?: boolean;
  contracts?: number;
  contractSize?: number;
}): ComputedTradePnl | null {
  const { entryPrice, targetPrice, amount, side, isInverse = false, contracts = 0, contractSize = 1 } = params;
  if (
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0 ||
    !Number.isFinite(targetPrice) ||
    targetPrice <= 0 ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return null;
  }

  const isLong = side === 'long';
  const pnlPct = isLong
    ? ((targetPrice - entryPrice) / entryPrice) * 100.0
    : ((entryPrice - targetPrice) / entryPrice) * 100.0;

  let pnlUsd = 0;
  let notionalUsd = amount * entryPrice;

  if (isInverse && contracts > 0 && contractSize > 0) {
    const baseDelta = isLong
      ? contracts * contractSize * (1 / entryPrice - 1 / targetPrice)
      : contracts * contractSize * (1 / targetPrice - 1 / entryPrice);
    pnlUsd = baseDelta * targetPrice;
    notionalUsd = contracts * contractSize;
  } else {
    pnlUsd = isLong
      ? (targetPrice - entryPrice) * amount
      : (entryPrice - targetPrice) * amount;
  }

  if (!Number.isFinite(pnlUsd) || !Number.isFinite(pnlPct)) return null;
  return { pnlUsd, pnlPct, notionalUsd };
}

/**
 * Format USD + percentage P/L cleanly (e.g. "+$24.50 (+2.45%)" or "-$0.4210 (-1.20%)").
 */
export function formatCompactPnl(pnlUsd: number, pnlPct: number): string {
  const sign = pnlUsd >= 0 ? '+' : '-';
  const absUsd = Math.abs(pnlUsd);
  let usdStr: string;
  if (absUsd >= 1000) {
    usdStr = absUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else if (absUsd >= 1) {
    usdStr = absUsd.toFixed(2);
  } else if (absUsd >= 0.01) {
    usdStr = absUsd.toFixed(3);
  } else {
    usdStr = absUsd.toFixed(4);
  }
  const pctSign = pnlPct >= 0 ? '+' : '-';
  const pctStr = Math.abs(pnlPct).toFixed(2);
  return `${sign}$${usdStr} (${pctSign}${pctStr}%)`;
}

/**
 * Resolve the active entry context for a chart:
 * - On Futures: uses the authoritative live exchange position (`activePosition`).
 * - On Spot (or when position hasn't hydrated yet): computes weighted-average entry from active TP/SL brackets carrying `entryPrice`.
 */
export function resolveEffectiveEntryContext(
  activePosition: FastPositionResponse | null | undefined,
  openOrders: OpenLimitOrder[],
  symbol: string
): EntryContext | null {
  const isFutures = Boolean(symbol && symbol.includes(':'));
  const posAmt = Number(activePosition?.amount || 0);
  const posEntry = Number(activePosition?.entry_price || 0);
  const posSide = String(activePosition?.side || 'none').toLowerCase();

  if (isFutures && posAmt > 0 && posEntry > 0 && (posSide === 'long' || posSide === 'short')) {
    return {
      entryPrice: posEntry,
      side: posSide,
      amount: posAmt,
      isInverse: Boolean(activePosition?.is_inverse),
      contracts: Number(activePosition?.contracts || 0),
      contractSize: Number(activePosition?.contract_size || 1),
      leverage: activePosition?.leverage ?? null,
      source: 'futures_position',
    };
  }

  // Fallback / Spot mode: derive entry from active bracket orders (SL / TP) that carry `entryPrice`
  const bracketOrders = (openOrders || []).filter(
    (o) =>
      Number(o.entryPrice || 0) > 0 &&
      (Boolean(o.isSoftwareSL) || o.mode === 'TP') &&
      Number(o.remaining > 0 ? o.remaining : o.amount) > 0
  );

  if (bracketOrders.length === 0) return null;

  // Prefer Software SL entries if present (avoids double-counting TP+SL of the same trade); else use TP entries
  const slEntries = bracketOrders.filter((o) => Boolean(o.isSoftwareSL));
  const sourceSet = slEntries.length > 0 ? slEntries : bracketOrders;

  let totalWeight = 0;
  let weightedPx = 0;
  for (const o of sourceSet) {
    const amt = Number(o.remaining > 0 ? o.remaining : o.amount);
    const ePx = Number(o.entryPrice || 0);
    if (amt > 0 && ePx > 0) {
      totalWeight += amt;
      weightedPx += amt * ePx;
    }
  }
  if (totalWeight <= 0 || weightedPx <= 0) return null;

  // Exit side is opposite to entry side: sell exit -> LONG entry, buy exit -> SHORT entry
  const primarySide = sourceSet[0].side === 'buy' ? 'short' : 'long';
  return {
    entryPrice: weightedPx / totalWeight,
    side: primarySide,
    amount: totalWeight,
    isInverse: false,
    leverage: null,
    source: 'spot_bracket',
  };
}

/**
 * Resolve the entry context for a specific SL or TP order (prefers order's own `entryPrice` for multi-trade accuracy).
 */
export function resolveOrderEntryContext(
  order: Pick<OpenLimitOrder, 'side' | 'amount' | 'remaining' | 'entryPrice' | 'isSoftwareSL' | 'mode'>,
  fallbackEntry: EntryContext | null
): EntryContext | null {
  const orderEntryPx = Number(order.entryPrice || 0);
  const orderAmt = Number(order.remaining > 0 ? order.remaining : order.amount);
  const exitSide = String(order.side || '').toLowerCase();
  const inferredSide: 'long' | 'short' = exitSide === 'buy' ? 'short' : 'long';

  if (orderEntryPx > 0 && orderAmt > 0) {
    const usePosInverse =
      Boolean(fallbackEntry?.isInverse) &&
      fallbackEntry?.contracts &&
      fallbackEntry.contracts > 0;
    return {
      entryPrice: orderEntryPx,
      side: inferredSide,
      amount: orderAmt,
      isInverse: usePosInverse,
      contracts: usePosInverse ? fallbackEntry?.contracts : undefined,
      contractSize: usePosInverse ? fallbackEntry?.contractSize : undefined,
      leverage: fallbackEntry?.leverage ?? null,
      source: fallbackEntry?.source || 'spot_bracket',
    };
  }

  if (!fallbackEntry) return null;
  const effAmt = orderAmt > 0 ? orderAmt : fallbackEntry.amount;
  const ratio = fallbackEntry.amount > 0 ? effAmt / fallbackEntry.amount : 1;
  return {
    ...fallbackEntry,
    amount: effAmt,
    contracts: fallbackEntry.contracts ? fallbackEntry.contracts * ratio : undefined,
  };
}
