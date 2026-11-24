import { calculateEMA, calculateRSI, calculateUTBotAlerts, UTBotDataPoint } from './indicators';

export type UTBotSignalGrade = 'A+' | 'B' | 'WEAK';
export type UTBotSignalKind = 'BUY' | 'SELL' | 'SNIPE_BUY' | 'SNIPE_SELL' | 'PRE_BUY' | 'PRE_SELL';

export interface UTBotProSignal {
    time: string | number;
    barIndex: number;
    side: 'buy' | 'sell';
    kind: UTBotSignalKind;
    isConfirmed: boolean;
    isSnipe: boolean;
    price: number;
    trailingStop: number;
    grade: UTBotSignalGrade;
    score: number;
    reasons: string[];
}

export interface UTBotActiveSetup {
    time: string | number;
    barIndex: number;
    side: 'buy' | 'sell';
    kind: UTBotSignalKind;
    entry: number;
    sl: number;
    tp1: number;
    tp2: number;
    grade: UTBotSignalGrade;
    score: number;
    reasons: string[];
    isInvalidated: boolean;
}

export interface UTBotBacktestStats {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    netR: number;
}

export interface UTBotProResult {
    fastPoints: UTBotDataPoint[];
    slowPoints: UTBotDataPoint[];
    signals: UTBotProSignal[];
    activeSetup: UTBotActiveSetup | null;
    backtest: UTBotBacktestStats;
    marketBias: 'BULLISH' | 'BEARISH' | 'CHOP';
    latestAdx: number | null;
    latestRsi: number | null;
    latestEma: number | null;
}

export interface UTBotProInput {
    candles: { time: any; open: number; high: number; low: number; close: number; volume?: number }[];
    sensitivity: number;
    atrPeriod: number;
    useHeikinAshi: boolean;
    trendFilter: boolean;
    emaPeriod: number;
    chopFilter: boolean;
    adxThreshold: number;
    candleClose: boolean;
    cooldownBars: number;
    orderFlowConfirm: boolean;
    hideWeakSignals: boolean;
    tp1RR: number;
    tp2RR: number;
    retestSniper: boolean;
    dualMode: boolean;
    slowSensitivity: number;
    slowAtrPeriod: number;
    walls?: { price: number; type: 'buy' | 'sell'; size?: number }[];
    footprintData?: { time: any; totalDelta?: number; hasDeltaDivergence?: boolean }[];
}

/**
 * Wilder's ADX(period) mapped by candle index. Returns null before `2 * period`.
 */
export const calculateADXSeries = (
    candles: { high: number; low: number; close: number }[],
    period: number = 14
): (number | null)[] => {
    const n = candles.length;
    const result = new Array<number | null>(n).fill(null);
    const p = Math.max(2, Math.floor(period));
    if (n < p * 2) return result;

    const tr = new Array<number>(n).fill(0);
    const plusDM = new Array<number>(n).fill(0);
    const minusDM = new Array<number>(n).fill(0);

    for (let i = 1; i < n; i++) {
        const cur = candles[i];
        const prev = candles[i - 1];
        if (!cur || !prev) continue;
        const h = Number(cur.high);
        const l = Number(cur.low);
        const ph = Number(prev.high);
        const pl = Number(prev.low);
        const pc = Number(prev.close);
        if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(ph) || !Number.isFinite(pl) || !Number.isFinite(pc)) continue;

        tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
        const upMove = h - ph;
        const downMove = pl - l;
        plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
        minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    }

    let trSmooth = 0;
    let plusSmooth = 0;
    let minusSmooth = 0;
    for (let i = 1; i <= p; i++) {
        trSmooth += tr[i];
        plusSmooth += plusDM[i];
        minusSmooth += minusDM[i];
    }

    const dx = new Array<number>(n).fill(0);
    for (let i = p; i < n; i++) {
        if (i > p) {
            trSmooth = trSmooth - trSmooth / p + tr[i];
            plusSmooth = plusSmooth - plusSmooth / p + plusDM[i];
            minusSmooth = minusSmooth - minusSmooth / p + minusDM[i];
        }
        const plusDI = trSmooth > 0 ? (100 * plusSmooth) / trSmooth : 0;
        const minusDI = trSmooth > 0 ? (100 * minusSmooth) / trSmooth : 0;
        const diSum = plusDI + minusDI;
        dx[i] = diSum > 0 ? (100 * Math.abs(plusDI - minusDI)) / diSum : 0;
    }

    let dxSum = 0;
    for (let i = p; i < p * 2; i++) {
        dxSum += dx[i];
    }
    let adx = dxSum / p;
    result[p * 2 - 1] = adx;

    for (let i = p * 2; i < n; i++) {
        adx = (adx * (p - 1) + dx[i]) / p;
        result[i] = adx;
    }

    return result;
};

/**
 * Full UT Bot Pro scalping engine: filters, Order Flow & L2 Wall scoring,
 * Retest Sniper, Dual-UT alignment, rolling backtest, and active SL/TP setup.
 */
export const calculateUTBotPro = (input: UTBotProInput): UTBotProResult => {
    const {
        candles,
        sensitivity,
        atrPeriod,
        useHeikinAshi,
        trendFilter,
        emaPeriod,
        chopFilter,
        adxThreshold,
        candleClose,
        cooldownBars,
        orderFlowConfirm,
        hideWeakSignals,
        tp1RR,
        tp2RR,
        retestSniper,
        dualMode,
        slowSensitivity,
        slowAtrPeriod,
        walls = [],
        footprintData = [],
    } = input;

    const emptyResult: UTBotProResult = {
        fastPoints: [],
        slowPoints: [],
        signals: [],
        activeSetup: null,
        backtest: { totalTrades: 0, wins: 0, losses: 0, winRate: 0, netR: 0 },
        marketBias: 'CHOP',
        latestAdx: null,
        latestRsi: null,
        latestEma: null,
    };

    if (!Array.isArray(candles) || candles.length === 0) return emptyResult;

    const fastPoints = calculateUTBotAlerts(candles, sensitivity, atrPeriod, useHeikinAshi);
    if (fastPoints.length === 0) return emptyResult;

    const slowPoints = dualMode
        ? calculateUTBotAlerts(candles, slowSensitivity, slowAtrPeriod, useHeikinAshi)
        : [];

    // Map candle index by timestamp for O(1) joins
    const candleIndexByTime = new Map<any, number>();
    for (let i = 0; i < candles.length; i++) {
        candleIndexByTime.set(candles[i].time, i);
    }

    const slowByTime = new Map<any, UTBotDataPoint>();
    for (let i = 0; i < slowPoints.length; i++) {
        slowByTime.set(slowPoints[i].time, slowPoints[i]);
    }

    const emaByTime = new Map<any, number>();
    let latestEma: number | null = null;
    if (trendFilter || orderFlowConfirm) {
        const emaPts = calculateEMA(candles, Math.max(5, Math.floor(emaPeriod || 50)));
        for (let i = 0; i < emaPts.length; i++) {
            emaByTime.set(emaPts[i].time, emaPts[i].value);
        }
        if (emaPts.length > 0) latestEma = emaPts[emaPts.length - 1].value;
    }

    const rsiByTime = new Map<any, number>();
    let latestRsi: number | null = null;
    const rsiPts = calculateRSI(candles, 14);
    for (let i = 0; i < rsiPts.length; i++) {
        rsiByTime.set(rsiPts[i].time, rsiPts[i].value);
    }
    if (rsiPts.length > 0) latestRsi = rsiPts[rsiPts.length - 1].value;

    const adxSeries = calculateADXSeries(candles, 14);
    const latestAdx = adxSeries.length > 0 ? adxSeries[adxSeries.length - 1] : null;

    const footprintByTime = new Map<any, { totalDelta?: number; hasDeltaDivergence?: boolean }>();
    for (let i = 0; i < footprintData.length; i++) {
        footprintByTime.set(footprintData[i].time, footprintData[i]);
    }

    // Precompute 20-bar rolling average volume
    const avgVol = new Array<number>(candles.length).fill(0);
    let volWinSum = 0;
    for (let i = 0; i < candles.length; i++) {
        const v = Number(candles[i]?.volume || 0);
        volWinSum += Number.isFinite(v) ? v : 0;
        if (i >= 20) {
            const oldV = Number(candles[i - 20]?.volume || 0);
            volWinSum -= Number.isFinite(oldV) ? oldV : 0;
        }
        const denom = Math.min(i + 1, 20);
        avgVol[i] = denom > 0 ? volWinSum / denom : 0;
    }

    const signals: UTBotProSignal[] = [];
    let lastConfirmedSignalIdx = -999;
    let lastConfirmedSide: 'buy' | 'sell' | null = null;
    let lastSnipeIdx = -999;
    let lastSnipeSide: 'buy' | 'sell' | null = null;

    const lastBarIndex = candles.length - 1;

    for (let fIdx = 0; fIdx < fastPoints.length; fIdx++) {
        const pt = fastPoints[fIdx];
        const barIdx = candleIndexByTime.get(pt.time);
        if (barIdx === undefined || barIdx < 1) continue;

        const bar = candles[barIdx];
        const prevBar = candles[barIdx - 1];
        const prevPt = fIdx > 0 ? fastPoints[fIdx - 1] : null;
        const isLiveBar = barIdx === lastBarIndex;

        let candidateSide: 'buy' | 'sell' | null = pt.isBuy ? 'buy' : pt.isSell ? 'sell' : null;
        let isSnipe = false;

        // Retest Sniper: pullback bounce off trailing stop in an established trend
        if (!candidateSide && retestSniper && prevPt && pt.direction !== 0) {
            const canSnipe = barIdx - lastSnipeIdx >= 3 || lastSnipeSide !== (pt.direction === 1 ? 'buy' : 'sell');
            if (canSnipe) {
                if (
                    pt.direction === 1 &&
                    prevBar.close > prevPt.trailingStop &&
                    bar.low <= pt.trailingStop * 1.0012 &&
                    bar.close > pt.trailingStop &&
                    bar.close > bar.open
                ) {
                    candidateSide = 'buy';
                    isSnipe = true;
                } else if (
                    pt.direction === -1 &&
                    prevBar.close < prevPt.trailingStop &&
                    bar.high >= pt.trailingStop * 0.9988 &&
                    bar.close < pt.trailingStop &&
                    bar.close < bar.open
                ) {
                    candidateSide = 'sell';
                    isSnipe = true;
                }
            }
        }

        if (!candidateSide) continue;

        // 1. Dual UT Bot Trend Alignment Filter
        const slowPt = dualMode ? slowByTime.get(pt.time) : undefined;
        if (dualMode && slowPt && slowPt.direction !== 0) {
            if (candidateSide === 'buy' && slowPt.direction !== 1) continue;
            if (candidateSide === 'sell' && slowPt.direction !== -1) continue;
        }

        // 2. EMA Trend Bias Filter
        const emaVal = emaByTime.get(pt.time);
        if (trendFilter && emaVal !== undefined) {
            if (candidateSide === 'buy' && bar.close <= emaVal) continue;
            if (candidateSide === 'sell' && bar.close >= emaVal) continue;
        }

        // 3. Chop / ADX Volatility Filter
        const adxVal = adxSeries[barIdx];
        if (chopFilter && adxVal !== null && adxVal < adxThreshold) {
            continue;
        }

        // 4. Cooldown Filter (blocks rapid opposite whipsaw flips)
        if (
            !isSnipe &&
            cooldownBars > 0 &&
            lastConfirmedSide !== null &&
            lastConfirmedSide !== candidateSide &&
            barIdx - lastConfirmedSignalIdx <= cooldownBars
        ) {
            continue;
        }

        // 5. Score & Order Flow / L2 Confluence Grading
        let score = 40; // Base score for passing technical UT Bot trigger + active filters
        const reasons: string[] = [];

        const vol = Number(bar.volume || 0);
        const baselineVol = avgVol[barIdx];
        if (baselineVol > 0 && vol >= baselineVol * 1.3) {
            score += 20;
            reasons.push('Vol Spike');
        }

        const fp = footprintByTime.get(pt.time);
        if (fp && typeof fp.totalDelta === 'number') {
            if ((candidateSide === 'buy' && fp.totalDelta > 0) || (candidateSide === 'sell' && fp.totalDelta < 0)) {
                score += 20;
                reasons.push('Delta Aligned');
            } else {
                score -= 10;
            }
        } else {
            // Candle body conviction proxy when footprint WS isn't streamed
            const range = Math.max(1e-12, bar.high - bar.low);
            const bodyRatio = (bar.close - bar.open) / range;
            if ((candidateSide === 'buy' && bodyRatio > 0.35) || (candidateSide === 'sell' && bodyRatio < -0.35)) {
                score += 15;
                reasons.push('Strong Body');
            }
        }

        const rsiVal = rsiByTime.get(pt.time);
        if (rsiVal !== undefined) {
            if (candidateSide === 'buy') {
                if (rsiVal >= 42 && rsiVal <= 70) {
                    score += 15;
                    reasons.push('RSI Optimal');
                } else if (rsiVal > 78) {
                    score -= 20;
                    reasons.push('Overbought');
                }
            } else {
                if (rsiVal >= 30 && rsiVal <= 58) {
                    score += 15;
                    reasons.push('RSI Optimal');
                } else if (rsiVal < 22) {
                    score -= 20;
                    reasons.push('Oversold');
                }
            }
        }

        if (emaVal !== undefined && ((candidateSide === 'buy' && bar.close > emaVal) || (candidateSide === 'sell' && bar.close < emaVal))) {
            score += 10;
            reasons.push('EMA Trend');
        }

        // L2 Orderbook Wall Confluence (evaluated on live/recent bars where walls reflect current book)
        if (walls.length > 0 && barIdx >= lastBarIndex - 2) {
            const nearbyDist = bar.close * 0.008;
            const supportBid = walls.some(w => w.type === 'buy' && w.price <= bar.close && bar.close - w.price <= nearbyDist);
            const resistAsk = walls.some(w => w.type === 'sell' && w.price >= bar.close && w.price - bar.close <= nearbyDist);
            if (candidateSide === 'buy') {
                if (supportBid) { score += 15; reasons.push('Bid Wall'); }
                if (resistAsk) { score -= 15; reasons.push('Ask Wall Ahead'); }
            } else {
                if (resistAsk) { score += 15; reasons.push('Ask Wall'); }
                if (supportBid) { score -= 15; reasons.push('Bid Wall Ahead'); }
            }
        }

        score = Math.max(0, Math.min(100, score));
        const grade: UTBotSignalGrade = score >= 75 ? 'A+' : score >= 45 ? 'B' : 'WEAK';

        if (orderFlowConfirm && hideWeakSignals && grade === 'WEAK') {
            continue;
        }

        const isConfirmed = !(candleClose && isLiveBar);
        let kind: UTBotSignalKind;
        if (!isConfirmed) {
            kind = candidateSide === 'buy' ? 'PRE_BUY' : 'PRE_SELL';
        } else if (isSnipe) {
            kind = candidateSide === 'buy' ? 'SNIPE_BUY' : 'SNIPE_SELL';
        } else {
            kind = candidateSide === 'buy' ? 'BUY' : 'SELL';
        }

        if (isConfirmed) {
            if (isSnipe) {
                lastSnipeIdx = barIdx;
                lastSnipeSide = candidateSide;
            } else {
                lastConfirmedSignalIdx = barIdx;
                lastConfirmedSide = candidateSide;
            }
        }

        signals.push({
            time: pt.time,
            barIndex: barIdx,
            side: candidateSide,
            kind,
            isConfirmed,
            isSnipe,
            price: bar.close,
            trailingStop: pt.trailingStop,
            grade,
            score,
            reasons,
        });
    }

    // 6. Rolling Mini Backtest over confirmed primary BUY/SELL signals
    const confirmedPrimary = signals.filter(s => s.isConfirmed && !s.isSnipe);
    let wins = 0;
    let losses = 0;
    let netR = 0;
    const safeTp1RR = Math.max(0.5, tp1RR || 1.5);
    const safeTp2RR = Math.max(safeTp1RR, tp2RR || 2.5);

    for (let sIdx = 0; sIdx < confirmedPrimary.length; sIdx++) {
        const sig = confirmedPrimary[sIdx];
        const entry = sig.price;
        const sl = sig.trailingStop;
        const risk = Math.abs(entry - sl);
        if (!Number.isFinite(risk) || risk <= 0) continue;

        const tp1 = sig.side === 'buy' ? entry + risk * safeTp1RR : entry - risk * safeTp1RR;
        const nextSigBar = sIdx + 1 < confirmedPrimary.length ? confirmedPrimary[sIdx + 1].barIndex : candles.length;

        let resolved = false;
        for (let k = sig.barIndex + 1; k < nextSigBar; k++) {
            const c = candles[k];
            if (!c) continue;
            if (sig.side === 'buy') {
                // Conservative ordering: SL checked first if same bar hits both
                if (c.low <= sl) {
                    losses++;
                    netR -= 1;
                    resolved = true;
                    break;
                }
                if (c.high >= tp1) {
                    wins++;
                    netR += safeTp1RR;
                    resolved = true;
                    break;
                }
            } else {
                if (c.high >= sl) {
                    losses++;
                    netR -= 1;
                    resolved = true;
                    break;
                }
                if (c.low <= tp1) {
                    wins++;
                    netR += safeTp1RR;
                    resolved = true;
                    break;
                }
            }
        }

        // If opposite signal reversed before TP1 or SL, realize R at flip price
        if (!resolved && sIdx + 1 < confirmedPrimary.length) {
            const flipBar = candles[nextSigBar];
            if (flipBar) {
                const pnlR = sig.side === 'buy'
                    ? (flipBar.close - entry) / risk
                    : (entry - flipBar.close) / risk;
                netR += pnlR;
                if (pnlR > 0) wins++;
                else losses++;
            }
        }
    }

    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;

    // 7. Build Active SL / TP1 / TP2 Setup from the most recent confirmed signal
    let activeSetup: UTBotActiveSetup | null = null;
    const confirmedAll = signals.filter(s => s.isConfirmed);
    if (confirmedAll.length > 0) {
        const latestSig = confirmedAll[confirmedAll.length - 1];
        const entry = latestSig.price;
        // Fallback risk = 0.25% of entry if trailing stop sits right on entry
        const rawRisk = Math.abs(entry - latestSig.trailingStop);
        const risk = rawRisk > 0 ? rawRisk : entry * 0.0025;
        const sl = latestSig.side === 'buy' ? entry - risk : entry + risk;
        const tp1 = latestSig.side === 'buy' ? entry + risk * safeTp1RR : entry - risk * safeTp1RR;
        const tp2 = latestSig.side === 'buy' ? entry + risk * safeTp2RR : entry - risk * safeTp2RR;

        const latestClose = candles[lastBarIndex].close;
        const isInvalidated = latestSig.side === 'buy' ? latestClose <= sl : latestClose >= sl;

        activeSetup = {
            time: latestSig.time,
            barIndex: latestSig.barIndex,
            side: latestSig.side,
            kind: latestSig.kind,
            entry,
            sl,
            tp1,
            tp2,
            grade: latestSig.grade,
            score: latestSig.score,
            reasons: latestSig.reasons,
            isInvalidated,
        };
    }

    // Determine overall market bias
    const lastFast = fastPoints[fastPoints.length - 1];
    let marketBias: 'BULLISH' | 'BEARISH' | 'CHOP' = 'CHOP';
    if (chopFilter && latestAdx !== null && latestAdx < adxThreshold) {
        marketBias = 'CHOP';
    } else if (lastFast.direction === 1) {
        marketBias = 'BULLISH';
    } else if (lastFast.direction === -1) {
        marketBias = 'BEARISH';
    }

    return {
        fastPoints,
        slowPoints,
        signals,
        activeSetup,
        backtest: {
            totalTrades,
            wins,
            losses,
            winRate,
            netR: Math.round(netR * 10) / 10,
        },
        marketBias,
        latestAdx: latestAdx !== null ? Math.round(latestAdx * 10) / 10 : null,
        latestRsi: latestRsi !== null ? Math.round(latestRsi * 10) / 10 : null,
        latestEma,
    };
};
