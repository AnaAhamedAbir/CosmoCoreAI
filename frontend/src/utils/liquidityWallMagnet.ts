/**
 * Liquidity Wall Magnet & Front-Run Helpers
 * =========================================
 * Modular pure utilities for ManualTradeModal & Minimized Cyber-HUD:
 * - Selects nearest/strongest Buy Support & Sell Resistance walls from live L2 data
 * - Computes safe 1-tick (or N-tick) front-run prices
 * - Snaps Drag-to-Chart Limit, SmartPeg, TP, and SL lines onto whale walls
 */

export interface OrderbookWall {
  price: number;
  type: 'buy' | 'sell';
  size?: number;
  ratio?: number;
  notional_usd?: number;
  front_run_price?: number;
  distance_pct?: number;
}

export interface WallTargetsSummary {
  nearestBuyWall: OrderbookWall | null;
  nearestSellWall: OrderbookWall | null;
  buyFrontRunPrice: number | null;
  sellFrontRunPrice: number | null;
  topBuyWalls: OrderbookWall[];
  topSellWalls: OrderbookWall[];
}

export function estimatePriceTick(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0.0001;
  if (price >= 10000) return 0.1;
  if (price >= 1000) return 0.01;
  if (price >= 100) return 0.01;
  if (price >= 1) return 0.0001;
  if (price >= 0.01) return 0.00001;
  if (price >= 0.0001) return 0.000001;
  return 0.0000001;
}

export function roundToPriceScale(price: number, refPrice: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const base = refPrice > 0 ? refPrice : price;
  const decimals = base >= 1000 ? 2 : base >= 1 ? 4 : base >= 0.01 ? 5 : base >= 0.0001 ? 6 : 7;
  return Number(price.toFixed(decimals));
}

export function computeWallFrontRunPrice(
  wall: Pick<OrderbookWall, 'price' | 'type' | 'front_run_price'>,
  frontRunTicks: number = 1,
  currentPrice: number = 0
): number {
  if (wall.front_run_price && wall.front_run_price > 0 && frontRunTicks === 1) {
    return wall.front_run_price;
  }
  const ticks = Math.max(1, Math.round(frontRunTicks || 1));
  const tick = estimatePriceTick(wall.price || currentPrice);
  const raw = wall.type === 'buy' ? wall.price + ticks * tick : wall.price - ticks * tick;
  const safe = raw > 0 ? raw : wall.price;
  return roundToPriceScale(safe, wall.price || currentPrice);
}

export function formatWallSizeCompact(size?: number): string {
  if (!size || !Number.isFinite(size) || size <= 0) return '';
  if (size >= 1_000_000) return `${(size / 1_000_000).toFixed(1)}M`;
  if (size >= 1_000) return `${(size / 1_000).toFixed(1)}K`;
  if (size >= 1) return size.toFixed(0);
  return size.toFixed(2);
}

export function findBestWallsForTrade(
  walls: OrderbookWall[] | undefined | null,
  currentPrice: number,
  frontRunTicks: number = 1
): WallTargetsSummary {
  if (!walls || walls.length === 0) {
    return {
      nearestBuyWall: null,
      nearestSellWall: null,
      buyFrontRunPrice: null,
      sellFrontRunPrice: null,
      topBuyWalls: [],
      topSellWalls: [],
    };
  }

  const valid = walls.filter((w) => w && Number.isFinite(w.price) && w.price > 0);
  const ref = currentPrice > 0 ? currentPrice : 0;

  // Buy support walls (at or below market when currentPrice is known, sorted nearest first)
  const buyCandidates = valid
    .filter((w) => w.type === 'buy' && (ref <= 0 || w.price <= ref * 1.001))
    .sort((a, b) => b.price - a.price);

  // Sell resistance walls (at or above market when currentPrice is known, sorted nearest first)
  const sellCandidates = valid
    .filter((w) => w.type === 'sell' && (ref <= 0 || w.price >= ref * 0.999))
    .sort((a, b) => a.price - b.price);

  const nearestBuyWall = buyCandidates[0] || null;
  const nearestSellWall = sellCandidates[0] || null;

  return {
    nearestBuyWall,
    nearestSellWall,
    buyFrontRunPrice: nearestBuyWall
      ? computeWallFrontRunPrice(nearestBuyWall, frontRunTicks, ref)
      : null,
    sellFrontRunPrice: nearestSellWall
      ? computeWallFrontRunPrice(nearestSellWall, frontRunTicks, ref)
      : null,
    topBuyWalls: buyCandidates.slice(0, 5),
    topSellWalls: sellCandidates.slice(0, 5),
  };
}

export function snapPriceToWallMagnet(
  rawPrice: number,
  dragType: 'tp' | 'sl' | 'buy' | 'sell' | 'peg_buy' | 'peg_sell',
  walls: OrderbookWall[] | undefined | null,
  currentPrice: number,
  frontRunTicks: number = 1,
  snapThresholdPct: number = 0.65
): {
  price: number;
  snappedWall: OrderbookWall | null;
  frontRunPrice: number | null;
} {
  if (!Number.isFinite(rawPrice) || rawPrice <= 0 || !walls || walls.length === 0) {
    return { price: rawPrice, snappedWall: null, frontRunPrice: null };
  }

  // Determine which wall side makes strategic sense for this drag action:
  // - buy / peg_buy: front-run a Buy Support wall (+1 tick above support)
  // - sell / peg_sell: front-run a Sell Resistance wall (-1 tick below resistance)
  // - tp: front-run the wall blocking profit (Sell wall above currentPrice, or Buy wall below currentPrice for Dip Buy-Back)
  // - sl: place protection just beyond/on relevant wall if dragged close to one
  let preferredType: 'buy' | 'sell' | null = null;
  if (dragType === 'buy' || dragType === 'peg_buy') {
    preferredType = 'buy';
  } else if (dragType === 'sell' || dragType === 'peg_sell') {
    preferredType = 'sell';
  } else if (dragType === 'tp' && currentPrice > 0) {
    preferredType = rawPrice >= currentPrice ? 'sell' : 'buy';
  } else if (dragType === 'sl' && currentPrice > 0) {
    preferredType = rawPrice < currentPrice ? 'buy' : 'sell';
  }

  let bestMatch: OrderbookWall | null = null;
  let bestRelDist = Infinity;

  for (const w of walls) {
    if (!w || !Number.isFinite(w.price) || w.price <= 0) continue;
    if (preferredType && w.type !== preferredType) continue;
    const relDistPct = (Math.abs(rawPrice - w.price) / w.price) * 100;
    if (relDistPct <= snapThresholdPct && relDistPct < bestRelDist) {
      bestRelDist = relDistPct;
      bestMatch = w;
    }
  }

  if (!bestMatch) {
    return { price: rawPrice, snappedWall: null, frontRunPrice: null };
  }

  const frontRunPx = computeWallFrontRunPrice(bestMatch, frontRunTicks, currentPrice);
  return {
    price: frontRunPx,
    snappedWall: bestMatch,
    frontRunPrice: frontRunPx,
  };
}
