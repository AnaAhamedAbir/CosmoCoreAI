import type { CandlestickData } from 'lightweight-charts';

const WEEK_SEC = 7 * 86400;
// Unix epoch 0 (1970-01-01) was Thursday 00:00 UTC.
// Monday 00:00 UTC is offset by +4 days (345600s) from epoch 0 (or -3 days).
const MONDAY_OFFSET_SEC = 4 * 86400;

/**
 * Case-sensitive interval parser returning exact seconds for fixed intervals
 * and nominal 30d for '1M' (calendar bucketing uses UTC month start).
 * Fixes the classic bug where lowercasing '1M' returned 60s (1 minute).
 */
export function intervalToSec(interval: string): number {
    const raw = String(interval || '1m').trim();
    const match = raw.match(/^(\d+)([a-zA-Z]+)$/);
    if (!match) return 60;
    const value = Math.max(1, parseInt(match[1], 10) || 1);
    const unit = match[2];
    switch (unit) {
        case 's':
            return value;
        case 'm':
            return value * 60;
        case 'h':
        case 'H':
            return value * 3600;
        case 'd':
        case 'D':
            return value * 86400;
        case 'w':
        case 'W':
            return value * WEEK_SEC;
        case 'M':
            return value * 30 * 86400;
        default:
            return value * 60;
    }
}

export function intervalToMs(interval: string): number {
    return intervalToSec(interval) * 1000;
}

/**
 * Normalize a Unix timestamp (seconds or milliseconds) to Unix seconds.
 */
export function toUnixSec(ts: number): number {
    if (!Number.isFinite(ts) || ts <= 0) return 0;
    return ts > 10_000_000_000 ? Math.floor(ts / 1000) : Math.floor(ts);
}

/**
 * Calendar-aware candle bucket alignment (returns Unix seconds).
 * - '1w': aligns to Monday 00:00 UTC (matching Binance/Bybit/OKX native weekly bars)
 * - '1M': aligns to 1st of month 00:00 UTC
 * - sub-minute..daily: exact epoch-modulo alignment
 */
export function alignCandleBucketSec(tsInput: number, interval: string): number {
    const tsSec = toUnixSec(tsInput);
    if (tsSec <= 0) return 0;

    const raw = String(interval || '1m').trim();
    const match = raw.match(/^(\d+)([a-zA-Z]+)$/);
    const value = match ? Math.max(1, parseInt(match[1], 10) || 1) : 1;
    const unit = match ? match[2] : 'm';

    if (unit === 'w' || unit === 'W') {
        const span = value * WEEK_SEC;
        return Math.floor((tsSec - MONDAY_OFFSET_SEC) / span) * span + MONDAY_OFFSET_SEC;
    }

    if (unit === 'M') {
        const d = new Date(tsSec * 1000);
        const alignedMonth = Math.floor(d.getUTCMonth() / value) * value;
        return Math.floor(Date.UTC(d.getUTCFullYear(), alignedMonth, 1, 0, 0, 0) / 1000);
    }

    const sec = intervalToSec(raw);
    return Math.floor(tsSec / sec) * sec;
}

export function alignCandleBucketMs(tsMsInput: number, interval: string): number {
    const tsSec = tsMsInput > 10_000_000_000 ? tsMsInput / 1000 : tsMsInput;
    return alignCandleBucketSec(tsSec, interval) * 1000;
}

/**
 * Compute the exact close timestamp (in Unix ms) of the candle that started at `candleStartMs`.
 * Handles variable month lengths on '1M' and rolls forward cleanly past `nowMs`
 * so the countdown timer never freezes at 00:00 during quiet periods.
 */
export function getNextCandleCloseMs(candleStartMs: number, interval: string, nowMs: number = Date.now()): number {
    const startMs = candleStartMs > 10_000_000_000 ? candleStartMs : candleStartMs * 1000;
    const raw = String(interval || '1m').trim();
    const match = raw.match(/^(\d+)([a-zA-Z]+)$/);
    const value = match ? Math.max(1, parseInt(match[1], 10) || 1) : 1;
    const unit = match ? match[2] : 'm';

    if (unit === 'M') {
        const base = new Date(Math.max(startMs, alignCandleBucketMs(nowMs, raw)));
        const nextMonth = base.getUTCMonth() + value;
        return Date.UTC(base.getUTCFullYear(), nextMonth, 1, 0, 0, 0);
    }

    const stepMs = intervalToMs(raw);
    if (stepMs <= 0) return nowMs;
    if (startMs + stepMs > nowMs) return startMs + stepMs;
    const elapsed = nowMs - startMs;
    const stepsAhead = Math.floor(elapsed / stepMs) + 1;
    return startMs + stepsAhead * stepMs;
}

export interface SanitizedCandle extends CandlestickData {
    volume: number;
    patterns?: any[];
}

/**
 * Sort ascending, deduplicate timestamps (keeping latest record for a given bar),
 * validate OHLC numbers (no NaN / <= 0), and preserve genuine 0-volume bars
 * without fabricating fake volume=100.
 */
export function sanitizeAndSortCandles(rawList: any[]): SanitizedCandle[] {
    if (!Array.isArray(rawList) || rawList.length === 0) return [];
    const byTime = new Map<number, SanitizedCandle>();

    for (let i = 0; i < rawList.length; i++) {
        const k = rawList[i];
        if (!k) continue;
        const rawTime = Number(k.time);
        const timeSec = toUnixSec(rawTime);
        if (!Number.isFinite(timeSec) || timeSec <= 0) continue;

        const open = parseFloat(k.open);
        const high = parseFloat(k.high);
        const low = parseFloat(k.low);
        const close = parseFloat(k.close);
        if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
            continue;
        }
        if (open <= 0 || high <= 0 || low <= 0 || close <= 0) continue;

        const parsedVol = k.volume !== undefined && k.volume !== null ? Number(k.volume) : 0;
        const volume = Number.isFinite(parsedVol) && parsedVol >= 0 ? parsedVol : 0;

        byTime.set(timeSec, {
            time: timeSec as any,
            open,
            high: Math.max(high, open, close),
            low: Math.min(low, open, close),
            close,
            volume,
            ...(k.patterns ? { patterns: k.patterns } : {}),
        });
    }

    return Array.from(byTime.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, c]) => c);
}
