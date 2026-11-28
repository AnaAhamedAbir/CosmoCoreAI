import type { FootprintCandleData, FootprintDataTick } from '../components/features/market/FootprintRenderer';
import { intervalToSec } from './candleTime';

export function parseOrderflowIntervalSec(interval: string): number {
    return intervalToSec(interval);
}

/**
 * Computes a clean price-adaptive bucket/cluster step (~pct of price snapped to 1/2/2.5/5 * 10^n).
 * Works across BTC ($95k), ETH ($3k), SOL ($150), DOGE ($0.15), PEPE ($0.000008), and Forex EUR/USD.
 */
export function computeAdaptivePriceStep(price: number, pct: number = 0.0004): number {
    if (!Number.isFinite(price) || price <= 0) return 0.5;
    const target = price * pct;
    const exp = Math.floor(Math.log10(target));
    const base = Math.pow(10, exp);
    const ratio = target / base;
    let step: number;
    if (ratio < 1.4) step = 1.0 * base;
    else if (ratio < 2.2) step = 2.0 * base;
    else if (ratio < 3.5) step = 2.5 * base;
    else if (ratio < 7.0) step = 5.0 * base;
    else step = 10.0 * base;
    const decimals = Math.max(0, Math.min(12, -exp + 2));
    return Number(step.toFixed(decimals));
}

export function snapPriceToStep(price: number, step: number, mode: 'floor' | 'ceil' = 'floor'): number {
    if (!Number.isFinite(price) || !Number.isFinite(step) || step <= 0) return price;
    const exp = Math.floor(Math.log10(step));
    const decimals = Math.max(2, Math.min(12, -exp + 2));
    const raw =
        mode === 'ceil'
            ? Math.ceil(price / step - 1e-9) * step
            : Math.floor(price / step + 1e-9) * step;
    return Number(raw.toFixed(decimals));
}

/**
 * Computes institutional Market Profile Value Area (POC, 70% VAH, 70% VAL) from sorted or unsorted volume rows.
 */
export function computeVpvrValueArea(
    rows: Array<{ price: number; volume: number }>,
    valueAreaPct: number = 0.7
): { pocPrice: number; vahPrice: number; valPrice: number; totalVolume: number } {
    if (!rows || rows.length === 0) {
        return { pocPrice: 0, vahPrice: 0, valPrice: 0, totalVolume: 0 };
    }
    const sorted = [...rows]
        .filter((r) => Number.isFinite(r.price) && Number.isFinite(r.volume) && r.volume > 0)
        .sort((a, b) => a.price - b.price);
    if (sorted.length === 0) {
        return { pocPrice: 0, vahPrice: 0, valPrice: 0, totalVolume: 0 };
    }

    let pocIdx = 0;
    let maxVol = -1;
    let totalVolume = 0;
    for (let i = 0; i < sorted.length; i++) {
        totalVolume += sorted[i].volume;
        if (sorted[i].volume > maxVol) {
            maxVol = sorted[i].volume;
            pocIdx = i;
        }
    }

    const targetVol = totalVolume * Math.max(0.1, Math.min(0.95, valueAreaPct));
    let accVol = sorted[pocIdx].volume;
    let lowIdx = pocIdx;
    let highIdx = pocIdx;

    while (accVol < targetVol && (lowIdx > 0 || highIdx < sorted.length - 1)) {
        const upVol = highIdx + 1 < sorted.length ? sorted[highIdx + 1].volume : -1;
        const downVol = lowIdx - 1 >= 0 ? sorted[lowIdx - 1].volume : -1;
        if (upVol >= downVol && highIdx + 1 < sorted.length) {
            highIdx++;
            accVol += sorted[highIdx].volume;
        } else if (lowIdx - 1 >= 0) {
            lowIdx--;
            accVol += sorted[lowIdx].volume;
        } else {
            break;
        }
    }

    return {
        pocPrice: sorted[pocIdx].price,
        vahPrice: sorted[highIdx].price,
        valPrice: sorted[lowIdx].price,
        totalVolume,
    };
}

export function formatCompactOrderflowNumber(val: number, signed: boolean = false): string {
    if (!Number.isFinite(val)) return '0';
    const sign = val < 0 ? '-' : (signed && val > 0 ? '+' : '');
    const abs = Math.abs(val);
    if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
    if (abs >= 10) return `${sign}${abs.toFixed(1)}`;
    if (abs >= 1) return `${sign}${abs.toFixed(2)}`;
    return `${sign}${abs.toFixed(3)}`;
}

/**
 * Enriches a live footprint candle with institutional Exocharts/ATAS microstructure metrics:
 * - Exact POC (highest total volume row)
 * - 300% Diagonal Bid/Ask Imbalances (ask[i] vs bid[i+1], bid[i] vs ask[i-1])
 * - Stacked Imbalances (3+ consecutive same-side diagonal imbalances)
 * - Unfinished Auction at candle High/Low extremes
 * - Absorption Nodes (> 3x average row volume)
 * - Total Delta, Total Volume, and Bullish/Bearish Divergence
 */
export function enrichFootprintCandleClient(candle: FootprintCandleData): FootprintCandleData {
    const ticks: FootprintDataTick[] = candle.ticks;
    if (!ticks || ticks.length === 0) return candle;

    ticks.sort((a, b) => b.price - a.price);
    const n = ticks.length;

    let totalVol = 0;
    let totalDelta = 0;
    let maxRowVol = -1;
    let pocPrice = ticks[0].price;

    for (let i = 0; i < n; i++) {
        const t = ticks[i];
        const rv = t.bidVolume + t.askVolume;
        totalVol += rv;
        totalDelta += t.askVolume - t.bidVolume;
        if (rv > maxRowVol) {
            maxRowVol = rv;
            pocPrice = t.price;
        }
        t.isImbalance = false;
        t.imbalanceType = undefined;
        t.isAskImbalance = false;
        t.isBidImbalance = false;
        t.isStackedImbalance = false;
        t.isUnfinishedAuction = false;
        t.isAbsorption = false;
    }

    const avgRowVol = totalVol / n;
    const minMeaningfulVol = Math.max(avgRowVol * 0.25, 1e-9);
    const tickStep = candle.tickStep && candle.tickStep > 0 ? candle.tickStep : 0;
    const stepTol = tickStep > 0 ? Math.max(tickStep * 0.15, 1e-9) : 0;
    const isAdjacent = (higherP: number, lowerP: number): boolean => {
        if (tickStep <= 0) return true;
        return Math.abs((higherP - lowerP) - tickStep) <= stepTol;
    };

    for (let i = 0; i < n; i++) {
        const t = ticks[i];
        const rv = t.bidVolume + t.askVolume;
        let askRatio = 0;
        let bidRatio = 0;

        // Ask (buy) diagonal imbalance vs 1 contiguous tick lower bid
        if (i + 1 < n && isAdjacent(t.price, ticks[i + 1].price)) {
            const lowerBid = ticks[i + 1].bidVolume;
            if (
                t.askVolume >= minMeaningfulVol &&
                ((lowerBid > 0 && t.askVolume >= lowerBid * 3.0) ||
                    (lowerBid === 0 && t.askVolume >= avgRowVol * 1.25))
            ) {
                t.isAskImbalance = true;
                askRatio = lowerBid > 0 ? t.askVolume / lowerBid : 99;
            }
        }

        // Bid (sell) diagonal imbalance vs 1 contiguous tick higher ask (independent of ask imbalance)
        if (i - 1 >= 0 && isAdjacent(ticks[i - 1].price, t.price)) {
            const higherAsk = ticks[i - 1].askVolume;
            if (
                t.bidVolume >= minMeaningfulVol &&
                ((higherAsk > 0 && t.bidVolume >= higherAsk * 3.0) ||
                    (higherAsk === 0 && t.bidVolume >= avgRowVol * 1.25))
            ) {
                t.isBidImbalance = true;
                bidRatio = higherAsk > 0 ? t.bidVolume / higherAsk : 99;
            }
        }

        if (t.isAskImbalance || t.isBidImbalance) {
            t.isImbalance = true;
            t.imbalanceType = askRatio >= bidRatio ? 'ask' : 'bid';
        }

        if (n >= 2 && (i === 0 || i === n - 1) && t.bidVolume > 0 && t.askVolume > 0) {
            t.isUnfinishedAuction = true;
        }

        if (avgRowVol > 0 && rv > avgRowVol * 3.0) {
            t.isAbsorption = true;
        }
    }

    // Stacked Imbalance (3+ contiguous same-side diagonal imbalances)
    for (let i = 0; i < n - 2; i++) {
        const t0 = ticks[i];
        const t1 = ticks[i + 1];
        const t2 = ticks[i + 2];
        if (!isAdjacent(t0.price, t1.price) || !isAdjacent(t1.price, t2.price)) continue;
        if (
            (t0.isAskImbalance && t1.isAskImbalance && t2.isAskImbalance) ||
            (t0.isBidImbalance && t1.isBidImbalance && t2.isBidImbalance)
        ) {
            t0.isStackedImbalance = true;
            t1.isStackedImbalance = true;
            t2.isStackedImbalance = true;
        }
    }

    const cOpen = candle.open ?? ticks[n - 1].price;
    const cClose = candle.close ?? ticks[0].price;
    let divType: 'bullish' | 'bearish' | undefined;
    if (cClose > cOpen && totalDelta < 0) divType = 'bearish';
    else if (cClose < cOpen && totalDelta > 0) divType = 'bullish';

    candle.pocPrice = pocPrice;
    candle.totalDelta = totalDelta;
    candle.totalVolume = totalVol;
    candle.hasDeltaDivergence = Boolean(divType);
    candle.divergenceType = divType;
    return candle;
}
