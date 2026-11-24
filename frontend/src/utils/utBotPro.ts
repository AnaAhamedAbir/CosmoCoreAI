import { calculateEMA, calculateRSI, calculateUTBotAlerts, UTBotDataPoint } from './indicators';

export type UTBotSignalGrade = 'A+' | 'B' | 'WEAK';
export type UTBotSignalKind =
    | 'BUY'
    | 'SELL'
    | 'DIP_BUY'
    | 'DIP_SELL'
    | 'SWEEP_BUY'
    | 'SWEEP_SELL'
    | 'SNIPE_BUY'
    | 'SNIPE_SELL'
    | 'PRE_BUY'
    | 'PRE_SELL';

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
    climaxGuard?: boolean;
    maxExtensionAtr?: number;
    pullbackEntry?: boolean;
    fakeoutReversal?: boolean;
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
 * Full UT Bot Pro scalping engine: filters, Climax Spike Guard, Delayed Pullback (Dip Sniper),
 * Liquidity Sweep Fakeout Reversal, Order Flow & L2 Wall scoring, Retest Sniper, Dual-UT alignment,
 * rolling backtest, and active SL/TP setup.
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
        climaxGuard = true,
        maxExtensionAtr = 1.6,
        pullbackEntry = true,
        fakeoutReversal = true,
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

    // Precompute 20-bar rolling average volume and 14-bar rolling ATR
    const avgVol = new Array<number>(candles.length).fill(0);
    const rollingAtr = new Array<number>(candles.length).fill(0);
    let volWinSum = 0;
    let trWinSum = 0;
    const trArr = new Array<number>(candles.length).fill(0);

    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const v = Number(c?.volume || 0);
        volWinSum += Number.isFinite(v) ? v : 0;
        if (i >= 20) {
            const oldV = Number(candles[i - 20]?.volume || 0);
            volWinSum -= Number.isFinite(oldV) ? oldV : 0;
        }
        avgVol[i] = volWinSum / Math.min(i + 1, 20);

        const h = Number(c?.high || 0);
        const l = Number(c?.low || 0);
        const pc = i > 0 ? Number(candles[i - 1]?.close || c?.close || 0) : Number(c?.close || 0);
        const trVal = Math.max(0, h - l, Math.abs(h - pc), Math.abs(l - pc));
        trArr[i] = Number.isFinite(trVal) ? trVal : 0;
        trWinSum += trArr[i];
        if (i >= 14) {
            trWinSum -= trArr[i - 14];
        }
        rollingAtr[i] = trWinSum / Math.min(i + 1, 14);
    }

    const signals: UTBotProSignal[] = [];
    let lastConfirmedSignalIdx = -999;
    let lastConfirmedSide: 'buy' | 'sell' | null = null;
    let lastSnipeIdx = -999;
    let lastSnipeSide: 'buy' | 'sell' | null = null;

    // Pending Delayed Pullback state (armed when a breakout candle is held by Climax Guard or Pullback Entry)
    let pendingPullback: {
        side: 'buy' | 'sell';
        armedBarIdx: number;
        breakoutClose: number;
        breakoutHigh: number;
        breakoutLow: number;
    } | null = null;

    // Recent Raw Flip tracker for Liquidity Sweep / Stop-Hunt Fakeout Reversal detection
    let recentRawFlip: {
        side: 'buy' | 'sell';
        barIdx: number;
        high: number;
        low: number;
        close: number;
        open: number;
        isVulnerableTrap: boolean;
        consumed: boolean;
    } | null = null;

    const lastBarIndex = candles.length - 1;
    const safeMaxExt = Math.max(0.8, Number(maxExtensionAtr) || 1.6);

    for (let fIdx = 0; fIdx < fastPoints.length; fIdx++) {
        const pt = fastPoints[fIdx];
        const barIdx = candleIndexByTime.get(pt.time);
        if (barIdx === undefined || barIdx < 1) continue;

        const bar = candles[barIdx];
        const prevBar = candles[barIdx - 1];
        const prevPt = fIdx > 0 ? fastPoints[fIdx - 1] : null;
        const isLiveBar = barIdx === lastBarIndex;
        const atrVal = Math.max(1e-12, rollingAtr[barIdx] || Math.abs(bar.high - bar.low));
        const barRange = Math.max(0, bar.high - bar.low);
        const rsiVal = rsiByTime.get(pt.time);
        const adxVal = adxSeries[barIdx];
        const slowPt = dualMode ? slowByTime.get(pt.time) : undefined;
        const emaVal = emaByTime.get(pt.time);

        const rawFlipSide: 'buy' | 'sell' | null = pt.isBuy ? 'buy' : pt.isSell ? 'sell' : null;

        // Track raw flips for Fakeout / Stop-Hunt Sweep analysis
        if (rawFlipSide) {
            const isChopRegime = adxVal !== null && adxVal < adxThreshold;
            const isCounterMacro = Boolean(
                (dualMode && slowPt && slowPt.direction !== 0 && ((rawFlipSide === 'buy' && slowPt.direction === -1) || (rawFlipSide === 'sell' && slowPt.direction === 1))) ||
                (trendFilter && emaVal !== undefined && ((rawFlipSide === 'buy' && bar.close <= emaVal) || (rawFlipSide === 'sell' && bar.close >= emaVal)))
            );
            const isRsiExhausted = Boolean(
                rsiVal !== undefined && ((rawFlipSide === 'buy' && rsiVal >= 70) || (rawFlipSide === 'sell' && rsiVal <= 30))
            );
            const isClimaxBar = barRange >= safeMaxExt * atrVal;
            const hasOpposingWall =
                walls.length > 0 &&
                barIdx >= lastBarIndex - 3 &&
                (rawFlipSide === 'buy'
                    ? walls.some(w => w.type === 'sell' && w.price >= bar.close && w.price - bar.close <= bar.close * 0.008)
                    : walls.some(w => w.type === 'buy' && w.price <= bar.close && bar.close - w.price <= bar.close * 0.008));

            recentRawFlip = {
                side: rawFlipSide,
                barIdx,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                open: bar.open,
                isVulnerableTrap: isChopRegime || isCounterMacro || isRsiExhausted || isClimaxBar || hasOpposingWall,
                consumed: false,
            };

            // If a new raw flip occurs in the opposite direction, cancel any stale pending pullback
            if (pendingPullback && pendingPullback.side !== rawFlipSide) {
                pendingPullback = null;
            }
        }

        let candidateSide: 'buy' | 'sell' | null = null;
        let isSnipe = false;
        let isDipEntry = false;
        let isSweepReversal = false;
        let customTrailingStop = pt.trailingStop;
        const extraReasons: string[] = [];

        // ── A. Check Liquidity Sweep / Stop-Hunt Fakeout Reversal (1..3 bars after a vulnerable raw flip) ──
        if (
            fakeoutReversal &&
            recentRawFlip &&
            !recentRawFlip.consumed &&
            barIdx >= recentRawFlip.barIdx &&
            barIdx - recentRawFlip.barIdx <= 3
        ) {
            const upperWick = bar.high - Math.max(bar.open, bar.close);
            const lowerWick = Math.min(bar.open, bar.close) - bar.low;
            const wickRatioUp = barRange > 0 ? upperWick / barRange : 0;
            const wickRatioDown = barRange > 0 ? lowerWick / barRange : 0;

            if (recentRawFlip.side === 'buy' && recentRawFlip.isVulnerableTrap) {
                // Bull breakout trap: fails back below breakout open/midpoint or prints heavy upper rejection wick
                const failedNextBar =
                    barIdx > recentRawFlip.barIdx &&
                    bar.close < bar.open &&
                    bar.close < (recentRawFlip.open + recentRawFlip.close) / 2;
                const rejectedSameBar =
                    barIdx === recentRawFlip.barIdx &&
                    wickRatioUp >= 0.48 &&
                    bar.close < recentRawFlip.high - 0.55 * barRange;

                if (failedNextBar || rejectedSameBar) {
                    candidateSide = 'sell';
                    isSweepReversal = true;
                    customTrailingStop = Math.max(bar.high, recentRawFlip.high) + 0.35 * atrVal;
                    extraReasons.push('Sweep Trap Fade');
                }
            } else if (recentRawFlip.side === 'sell' && recentRawFlip.isVulnerableTrap) {
                // Bear breakdown trap: snaps back above breakdown open/midpoint or prints heavy lower rejection wick
                const failedNextBar =
                    barIdx > recentRawFlip.barIdx &&
                    bar.close > bar.open &&
                    bar.close > (recentRawFlip.open + recentRawFlip.close) / 2;
                const rejectedSameBar =
                    barIdx === recentRawFlip.barIdx &&
                    wickRatioDown >= 0.48 &&
                    bar.close > recentRawFlip.low + 0.55 * barRange;

                if (failedNextBar || rejectedSameBar) {
                    candidateSide = 'buy';
                    isSweepReversal = true;
                    customTrailingStop = Math.min(bar.low, recentRawFlip.low) - 0.35 * atrVal;
                    extraReasons.push('Sweep Trap Fade');
                }
            }
        }

        // ── B. Check Armed Delayed Pullback Entry (Dip Sniper after a held breakout) ──
        if (!candidateSide && pendingPullback) {
            const age = barIdx - pendingPullback.armedBarIdx;
            const dirAligned =
                (pendingPullback.side === 'buy' && pt.direction === 1) ||
                (pendingPullback.side === 'sell' && pt.direction === -1);

            if (age > 6 || !dirAligned) {
                pendingPullback = null;
            } else if (age >= 1) {
                const lowerWick = Math.min(bar.open, bar.close) - bar.low;
                const upperWick = bar.high - Math.max(bar.open, bar.close);

                if (pendingPullback.side === 'buy') {
                    const stopDist = Math.max(atrVal * 0.3, pendingPullback.breakoutClose - pt.trailingStop);
                    const pulledBack =
                        bar.low <= pendingPullback.breakoutClose ||
                        bar.low <= pt.trailingStop + 0.85 * stopDist;
                    const heldSupport = bar.close > pt.trailingStop;
                    const bounced = bar.close > bar.open || (barRange > 0 && lowerWick / barRange >= 0.35);
                    const continuationConfirmed =
                        age >= 2 &&
                        heldSupport &&
                        bar.close > bar.open &&
                        (rsiVal === undefined || rsiVal <= 74);

                    if ((pulledBack && heldSupport && bounced) || continuationConfirmed) {
                        candidateSide = 'buy';
                        isDipEntry = true;
                        extraReasons.push(pulledBack ? 'Pullback Dip' : 'Confirmed Hold');
                    }
                } else {
                    const stopDist = Math.max(atrVal * 0.3, pt.trailingStop - pendingPullback.breakoutClose);
                    const pulledBack =
                        bar.high >= pendingPullback.breakoutClose ||
                        bar.high >= pt.trailingStop - 0.85 * stopDist;
                    const heldResistance = bar.close < pt.trailingStop;
                    const rejected = bar.close < bar.open || (barRange > 0 && upperWick / barRange >= 0.35);
                    const continuationConfirmed =
                        age >= 2 &&
                        heldResistance &&
                        bar.close < bar.open &&
                        (rsiVal === undefined || rsiVal >= 26);

                    if ((pulledBack && heldResistance && rejected) || continuationConfirmed) {
                        candidateSide = 'sell';
                        isDipEntry = true;
                        extraReasons.push(pulledBack ? 'Pullback Rally' : 'Confirmed Hold');
                    }
                }
            }
        }

        // ── C. Standard Raw UT Bot Flip (evaluated through Climax Guard & Delayed Pullback) ──
        if (!candidateSide && rawFlipSide) {
            const stopGap = Math.abs(bar.close - pt.trailingStop);
            const isOverExtended =
                barRange > safeMaxExt * atrVal ||
                stopGap > (sensitivity + 0.6 * safeMaxExt) * atrVal ||
                Boolean(rsiVal !== undefined && ((rawFlipSide === 'buy' && rsiVal > 73) || (rawFlipSide === 'sell' && rsiVal < 27)));

            const shouldDeferForPullback =
                (climaxGuard && isOverExtended) ||
                (pullbackEntry && barRange > 0.9 * atrVal);

            if (shouldDeferForPullback) {
                // Hold entry at the breakout peak/bottom and wait for the opposite pullback move
                pendingPullback = {
                    side: rawFlipSide,
                    armedBarIdx: barIdx,
                    breakoutClose: bar.close,
                    breakoutHigh: bar.high,
                    breakoutLow: bar.low,
                };
            } else {
                candidateSide = rawFlipSide;
            }
        }

        // ── D. Retest Sniper: pullback bounce off trailing stop in an established trend ──
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
                    extraReasons.push('Stop Retest');
                } else if (
                    pt.direction === -1 &&
                    prevBar.close < prevPt.trailingStop &&
                    bar.high >= pt.trailingStop * 0.9988 &&
                    bar.close < pt.trailingStop &&
                    bar.close < bar.open
                ) {
                    candidateSide = 'sell';
                    isSnipe = true;
                    extraReasons.push('Stop Retest');
                }
            }
        }

        if (!candidateSide) continue;

        // Trend & Chop filters apply to trend-following signals (Sweep Reversals purposefully fade trapped breakouts)
        if (!isSweepReversal) {
            // 1. Dual UT Bot Trend Alignment Filter
            if (dualMode && slowPt && slowPt.direction !== 0) {
                if (candidateSide === 'buy' && slowPt.direction !== 1) continue;
                if (candidateSide === 'sell' && slowPt.direction !== -1) continue;
            }

            // 2. EMA Trend Bias Filter
            if (trendFilter && emaVal !== undefined) {
                if (candidateSide === 'buy' && bar.close <= emaVal) continue;
                if (candidateSide === 'sell' && bar.close >= emaVal) continue;
            }

            // 3. Chop / ADX Volatility Filter
            if (chopFilter && adxVal !== null && adxVal < adxThreshold) {
                continue;
            }
        }

        // 4. Cooldown Filter (blocks rapid opposite whipsaw flips)
        if (
            !isSnipe &&
            !isSweepReversal &&
            cooldownBars > 0 &&
            lastConfirmedSide !== null &&
            lastConfirmedSide !== candidateSide &&
            barIdx - lastConfirmedSignalIdx <= cooldownBars
        ) {
            continue;
        }

        // 5. Score & Order Flow / L2 Confluence Grading
        let score = isDipEntry || isSweepReversal ? 50 : 40;
        const reasons: string[] = [...extraReasons];

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
            const range = Math.max(1e-12, bar.high - bar.low);
            const bodyRatio = (bar.close - bar.open) / range;
            if ((candidateSide === 'buy' && bodyRatio > 0.35) || (candidateSide === 'sell' && bodyRatio < -0.35)) {
                score += 15;
                reasons.push('Strong Body');
            }
        }

        if (rsiVal !== undefined) {
            if (candidateSide === 'buy') {
                if (rsiVal >= 35 && rsiVal <= 68) {
                    score += 15;
                    reasons.push('RSI Optimal');
                } else if (rsiVal > 76) {
                    score -= 20;
                    reasons.push('Overbought');
                }
            } else {
                if (rsiVal >= 32 && rsiVal <= 65) {
                    score += 15;
                    reasons.push('RSI Optimal');
                } else if (rsiVal < 24) {
                    score -= 20;
                    reasons.push('Oversold');
                }
            }
        }

        if (emaVal !== undefined && ((candidateSide === 'buy' && bar.close > emaVal) || (candidateSide === 'sell' && bar.close < emaVal))) {
            score += 10;
            reasons.push('EMA Trend');
        }

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

        // Signal passed all filters: consume any pending pullback or raw flip state
        if (isSweepReversal && recentRawFlip) {
            recentRawFlip.consumed = true;
            pendingPullback = null;
        } else if (isDipEntry) {
            pendingPullback = null;
        }

        const isConfirmed = !(candleClose && isLiveBar);
        let kind: UTBotSignalKind;
        if (!isConfirmed) {
            kind = candidateSide === 'buy' ? 'PRE_BUY' : 'PRE_SELL';
        } else if (isSweepReversal) {
            kind = candidateSide === 'buy' ? 'SWEEP_BUY' : 'SWEEP_SELL';
        } else if (isDipEntry) {
            kind = candidateSide === 'buy' ? 'DIP_BUY' : 'DIP_SELL';
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
            trailingStop: customTrailingStop,
            grade,
            score,
            reasons,
        });
    }

    // 6. Rolling Mini Backtest over confirmed primary signals (BUY, SELL, DIP_*, SWEEP_*)
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
