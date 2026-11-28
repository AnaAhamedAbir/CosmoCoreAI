import React, { useMemo, useState } from 'react';
import { Crosshair, Flame, Layers, Magnet } from 'lucide-react';
import type { GodModeState } from '@/hooks/useGodModeData';
import { formatCompactUsd, formatPairPrice } from './LiquidationCommandBar';

export interface PoolLadderPanelProps {
    godModeState: GodModeState | null;
    currentPrice: number;
    highlightedLevels: number[];
    onToggleLevel: (price: number) => void;
}

export const PoolLadderPanel: React.FC<PoolLadderPanelProps> = ({
    godModeState,
    currentPrice,
    highlightedLevels,
    onToggleLevel,
}) => {
    const [sideFilter, setSideFilter] = useState<'all' | 'SHORT_LIQ' | 'LONG_LIQ'>('all');

    const pools = useMemo(() => {
        const raw = godModeState?.liquidation_pools || [];
        return raw
            .filter((p) => sideFilter === 'all' || p.side === sideFilter)
            .slice()
            .sort((a, b) => b.price - a.price);
    }, [godModeState?.liquidation_pools, sideFilter]);

    const magnets = useMemo(() => {
        return (godModeState?.magnet_zones || []).slice().sort((a, b) => b.price - a.price);
    }, [godModeState?.magnet_zones]);

    const summary = godModeState?.liquidation_pool_summary;
    const isLevelTracked = (price: number) =>
        highlightedLevels.some((lvl) => Math.abs(lvl - price) / Math.max(1e-9, price) < 0.0005);

    return (
        <div className="flex flex-col h-full p-4 gap-3 overflow-y-auto custom-scrollbar">
            {/* Imbalance Header */}
            <div className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 p-3">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 mb-2">
                    <span className="flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-cyan-500" />
                        OI Pools ({summary?.horizon?.toUpperCase() || '24H'})
                    </span>
                    <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${
                            summary?.dominant_side === 'ABOVE'
                                ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                                : summary?.dominant_side === 'BELOW'
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-gray-300'
                        }`}
                    >
                        {summary?.dominant_side === 'ABOVE'
                            ? 'Squeeze Bias ↑'
                            : summary?.dominant_side === 'BELOW'
                            ? 'Sweep Bias ↓'
                            : 'Balanced'}
                    </span>
                </div>

                <div className="flex justify-between text-xs font-mono font-bold mb-1.5">
                    <span className="text-rose-600 dark:text-rose-400">
                        Short Above: {formatCompactUsd(summary?.total_short_liq_usd)}
                    </span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                        Long Below: {formatCompactUsd(summary?.total_long_liq_usd)}
                    </span>
                </div>

                <div className="flex items-center gap-1.5 mt-2">
                    {(['all', 'SHORT_LIQ', 'LONG_LIQ'] as const).map((tab) => (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => setSideFilter(tab)}
                            className={`flex-1 py-1 rounded-lg text-[10px] font-bold uppercase transition-colors border ${
                                sideFilter === tab
                                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-700 dark:text-cyan-300'
                                    : 'bg-white dark:bg-black/30 border-slate-200 dark:border-white/10 text-slate-500 dark:text-gray-400'
                            }`}
                        >
                            {tab === 'all' ? 'All' : tab === 'SHORT_LIQ' ? 'Shorts (↑)' : 'Longs (↓)'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Active Liquidation Pools List */}
            <div className="space-y-1.5">
                {pools.length === 0 ? (
                    <div className="text-center py-8 text-xs font-mono text-slate-500 dark:text-gray-400 border border-dashed border-slate-200 dark:border-white/10 rounded-xl">
                        {godModeState ? 'No active untapped pools in range' : 'Hydrating OI liquidation pools...'}
                    </div>
                ) : (
                    pools.map((pool, idx) => {
                        const isShort = pool.side === 'SHORT_LIQ';
                        const dist =
                            pool.dist_pct !== undefined
                                ? pool.dist_pct
                                : currentPrice > 0
                                ? ((pool.price - currentPrice) / currentPrice) * 100
                                : 0;
                        const tracked = isLevelTracked(pool.price);

                        return (
                            <button
                                key={`${pool.side}-${pool.price}-${idx}`}
                                type="button"
                                onClick={() => onToggleLevel(Number(pool.price.toFixed(pool.price < 1 ? 4 : 2)))}
                                className={`w-full text-left relative overflow-hidden rounded-xl border p-2.5 transition-all group ${
                                    tracked
                                        ? 'border-amber-400 bg-amber-500/10'
                                        : isShort
                                        ? 'border-rose-500/20 bg-rose-500/[0.04] hover:border-rose-500/45'
                                        : 'border-emerald-500/20 bg-emerald-500/[0.04] hover:border-emerald-500/45'
                                }`}
                            >
                                <div
                                    className={`absolute inset-y-0 left-0 opacity-15 pointer-events-none ${isShort ? 'bg-rose-500' : 'bg-emerald-500'}`}
                                    style={{ width: `${Math.min(100, Math.max(8, pool.intensity))}%` }}
                                />

                                <div className="relative z-10 flex items-center justify-between gap-2">
                                    <div>
                                        <div className="flex items-center gap-1.5">
                                            <span className={`text-xs font-mono font-black ${isShort ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                                {formatPairPrice(pool.price)}
                                            </span>
                                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/80 dark:bg-black/40 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 font-bold">
                                                {pool.leverage}
                                            </span>
                                            {pool.is_sweeping && (
                                                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400 animate-pulse">
                                                    <Flame className="w-2.5 h-2.5" /> Sweep
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[10px] font-mono text-slate-500 dark:text-gray-400 mt-0.5">
                                            {dist >= 0 ? '+' : ''}{dist.toFixed(2)}% from Oracle
                                        </div>
                                    </div>

                                    <div className="text-right flex items-center gap-2">
                                        <div>
                                            <span className="block text-xs font-mono font-bold text-slate-900 dark:text-white">
                                                {formatCompactUsd(pool.estimated_usd)}
                                            </span>
                                            <span className="text-[9px] font-mono text-slate-500 dark:text-gray-400">
                                                {pool.oi_weighted ? 'OI-Wtd' : 'Est'}
                                            </span>
                                        </div>
                                        <Crosshair
                                            className={`w-3.5 h-3.5 shrink-0 ${
                                                tracked ? 'text-amber-500' : 'text-slate-400 group-hover:text-brand-primary'
                                            }`}
                                        />
                                    </div>
                                </div>
                            </button>
                        );
                    })
                )}
            </div>

            {/* Magnet Zones Compact Chips */}
            {magnets.length > 0 && (
                <div className="pt-2 border-t border-slate-200 dark:border-white/10">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
                        <Magnet className="w-3.5 h-3.5 text-amber-500" />
                        Click Magnet Zone to Pin on Chart
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {magnets.slice(0, 8).map((m, i) => {
                            const tracked = isLevelTracked(m.price);
                            return (
                                <button
                                    key={`${m.price}-${i}`}
                                    type="button"
                                    onClick={() => onToggleLevel(Number(m.price.toFixed(m.price < 1 ? 4 : 2)))}
                                    className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold border transition-colors ${
                                        tracked
                                            ? 'bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-300'
                                            : m.price > currentPrice
                                            ? 'bg-rose-500/10 border-rose-500/25 text-rose-700 dark:text-rose-300 hover:border-rose-500/50'
                                            : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-300 hover:border-emerald-500/50'
                                    }`}
                                >
                                    {formatPairPrice(m.price)} ({Math.round(m.intensity)}%)
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default PoolLadderPanel;
