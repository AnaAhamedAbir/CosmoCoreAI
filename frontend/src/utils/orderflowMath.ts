import type { FootprintCandleData, FootprintDataTick } from '../components/features/market/FootprintRenderer';

export function parseOrderflowIntervalSec(interval: string): number {
    const tf = (interval || '1m').trim();
    const val = parseInt(tf, 10) || 1;
    const unit = tf.replace(/[0-9]/g, '') || 'm';
    switch (unit) {
        case 's': return Math.max(1, val);
        case 'm': return val * 60;
        case 'h': return val * 3600;
        case 'd': return val * 86400;
        case 'w': return val * 604800;
        case 'M': return val * 2592000;
        default: return val * 60;
    }
}

/**
 * Computes a clean price-adaptive bucket/cluster step (~pct of price snapped to 1/2/2.5/5 * 10^n).
 * Works across BTC ($95k), ETH ($3k), SOL ($150), DOGE ($0.15), PEPE ($0.00001), and Forex EUR/USD.
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
    const decimals = Math.max(0, Math.min(10, -exp + 2));
    return Number(step.toFixed(decimals));
}

export function snapPriceToStep(price: number, step: number, mode: 'floor' | 'ceil' = 'floor'): number {
    if (!Number.isFinite(price) || !Number.isFinite(step) || step <= 0) return price;
    const exp = Math.floor(Math.log10(step));
    const decimals = Math.max(2, Math.min(10, -exp + 2));
    const raw =
        mode === 'ceil'
            ? Math.ceil(price / step - 1e-9) * step
            : Math.floor(price / step + 1e-9) * step;
    return Number(raw.toFixed(decimals));
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
        t.isStackedImbalance = false;
        t.isUnfinishedAuction = false;
        t.isAbsorption = false;
    }

    const avgRowVol = totalVol / n;
    const minMeaningfulVol = Math.max(avgRowVol * 0.25, 1e-9);

    for (let i = 0; i < n; i++) {
        const t = ticks[i];
        const rv = t.bidVolume + t.askVolume;

        // Ask (buy) diagonal imbalance vs 1 tick lower bid
        if (i + 1 < n) {
            const lowerBid = ticks[i + 1].bidVolume;
            if (
                t.askVolume >= minMeaningfulVol &&
                ((lowerBid > 0 && t.askVolume >= lowerBid * 3.0) ||
                    (lowerBid === 0 && t.askVolume >= avgRowVol * 1.25))
            ) {
                t.isImbalance = true;
                t.imbalanceType = 'ask';
            }
        }

        // Bid (sell) diagonal imbalance vs 1 tick higher ask
        if (i - 1 >= 0 && !t.isImbalance) {
            const higherAsk = ticks[i - 1].askVolume;
            if (
                t.bidVolume >= minMeaningfulVol &&
                ((higherAsk > 0 && t.bidVolume >= higherAsk * 3.0) ||
                    (higherAsk === 0 && t.bidVolume >= avgRowVol * 1.25))
            ) {
                t.isImbalance = true;
                t.imbalanceType = 'bid';
            }
        }

        if ((i === 0 || i === n - 1) && t.bidVolume > 0 && t.askVolume > 0) {
            t.isUnfinishedAuction = true;
        }

        if (avgRowVol > 0 && rv > avgRowVol * 3.0) {
            t.isAbsorption = true;
        }
    }

    // Stacked Imbalance (3+ consecutive same-side diagonal imbalances)
    for (let i = 0; i < n - 2; i++) {
        const t0 = ticks[i];
        const t1 = ticks[i + 1];
        const t2 = ticks[i + 2];
        if (
            t0.isImbalance &&
            t1.isImbalance &&
            t2.isImbalance &&
            t0.imbalanceType &&
            t0.imbalanceType === t1.imbalanceType &&
            t1.imbalanceType === t2.imbalanceType
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
