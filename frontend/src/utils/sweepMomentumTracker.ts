export interface SweepPulseState {
    active: boolean;
    side: 'buy' | 'sell';
    notionalUsd: number;
    streak: number;
    label: string;
    expiresAt: number;
}

interface SweepSample {
    ts: number;
    side: 'buy' | 'sell';
    notionalUsd: number;
}

function formatCompactNotional(usd: number): string {
    const abs = Math.abs(usd);
    if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `$${Math.round(abs / 1_000)}K`;
    return `$${Math.round(abs)}`;
}

/**
 * Lightweight rolling micro-momentum tracker for detecting aggressive market sweeps
 * on live trade ticks without React allocations or heavy math.
 */
export class SweepMomentumTracker {
    private readonly windowMs: number;
    private readonly holdMs: number;
    private readonly minNotionalUsd: number;
    private readonly minStreakNotionalUsd: number;
    private readonly minStreakCount: number;
    private samples: SweepSample[] = [];
    private streakSide: 'buy' | 'sell' | null = null;
    private streakCount = 0;
    private activePulse: SweepPulseState | null = null;

    constructor(options?: {
        windowMs?: number;
        holdMs?: number;
        minNotionalUsd?: number;
        minStreakNotionalUsd?: number;
        minStreakCount?: number;
    }) {
        this.windowMs = options?.windowMs ?? 550;
        this.holdMs = options?.holdMs ?? 800;
        this.minNotionalUsd = options?.minNotionalUsd ?? 50_000;
        this.minStreakNotionalUsd = options?.minStreakNotionalUsd ?? 15_000;
        this.minStreakCount = options?.minStreakCount ?? 6;
    }

    reset(): void {
        this.samples = [];
        this.streakSide = null;
        this.streakCount = 0;
        this.activePulse = null;
    }

    record(price: number, volume: number, side: 'buy' | 'sell', now: number = Date.now()): SweepPulseState | null {
        if (!Number.isFinite(price) || price <= 0) {
            return this.getActive(now);
        }

        const notionalUsd = Number.isFinite(volume) && volume > 0 ? price * volume : 0;

        if (this.streakSide === side) {
            this.streakCount += 1;
        } else {
            this.streakSide = side;
            this.streakCount = 1;
        }

        this.samples.push({ ts: now, side, notionalUsd });

        // Prune expired samples outside sliding window
        const cutoff = now - this.windowMs;
        let pruneIdx = 0;
        while (pruneIdx < this.samples.length && this.samples[pruneIdx].ts < cutoff) {
            pruneIdx += 1;
        }
        if (pruneIdx > 0) {
            this.samples.splice(0, pruneIdx);
        }

        // Cap sample buffer during extreme bursts
        if (this.samples.length > 200) {
            this.samples.splice(0, this.samples.length - 200);
        }

        let buyNotional = 0;
        let sellNotional = 0;
        for (let i = 0; i < this.samples.length; i++) {
            const s = this.samples[i];
            if (s.side === 'buy') buyNotional += s.notionalUsd;
            else sellNotional += s.notionalUsd;
        }

        const totalNotional = buyNotional + sellNotional;
        const dominantSide: 'buy' | 'sell' = buyNotional >= sellNotional ? 'buy' : 'sell';
        const dominantNotional = dominantSide === 'buy' ? buyNotional : sellNotional;
        const dominance = totalNotional > 0 ? dominantNotional / totalNotional : 0;

        const isNotionalSweep = dominantNotional >= this.minNotionalUsd && dominance >= 0.72;
        const isStreakSweep =
            this.streakSide === dominantSide &&
            this.streakCount >= this.minStreakCount &&
            dominantNotional >= this.minStreakNotionalUsd &&
            dominance >= 0.68;

        if (isNotionalSweep || isStreakSweep) {
            const arrow = dominantSide === 'buy' ? '▲' : '▼';
            this.activePulse = {
                active: true,
                side: dominantSide,
                notionalUsd: dominantNotional,
                streak: this.streakCount,
                label: `${arrow} ${formatCompactNotional(dominantNotional)}`,
                expiresAt: now + this.holdMs,
            };
            return this.activePulse;
        }

        return this.getActive(now);
    }

    getActive(now: number = Date.now()): SweepPulseState | null {
        if (!this.activePulse) return null;
        if (now >= this.activePulse.expiresAt) {
            this.activePulse = null;
            return null;
        }
        return this.activePulse;
    }
}
