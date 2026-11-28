import React from 'react';
import { Flame, Layers, Radio, ShieldAlert, TrendingUp } from 'lucide-react';
import ComboBox from '@/components/common/ComboBox';
import type { MarketPair } from '@/hooks/useCCXTMarkets';
import type { LiquidationPoolHorizon } from '@/hooks/useGodModeData';

export interface LiquidationCommandBarProps {
    exchanges: string[];
    selectedExchange: string;
    onExchangeChange: (ex: string) => void;
    availablePairs: MarketPair[];
    activePair: string;
    onPairChange: (pair: string) => void;
    isPairsLoading: boolean;
    timeframe: string;
    onTimeframeChange: (tf: string) => void;
    horizon: LiquidationPoolHorizon;
    onHorizonChange: (h: LiquidationPoolHorizon) => void;
    isGodMode: boolean;
    onModeChange: (godMode: boolean) => void;
    oraclePrice: number;
    priceUpdateStatus?: 'up' | 'down' | 'none';
    fundingRate?: number;
    openInterestUsd?: number;
    isConnected: boolean;
}

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h'];
const HORIZONS: LiquidationPoolHorizon[] = ['24h', '3d', '7d'];

export const formatCompactUsd = (val?: number | null): string => {
    if (val === undefined || val === null || !Number.isFinite(val) || val === 0) return '$0';
    const abs = Math.abs(val);
    if (abs >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
    return `$${val.toFixed(0)}`;
};

export const formatPairPrice = (price: number): string => {
    if (!Number.isFinite(price) || price <= 0) return '---';
    const digits = price < 0.01 ? 6 : price < 1 ? 4 : 2;
    return `$${price.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};

export const LiquidationCommandBar: React.FC<LiquidationCommandBarProps> = ({
    exchanges,
    selectedExchange,
    onExchangeChange,
    availablePairs,
    activePair,
    onPairChange,
    isPairsLoading,
    timeframe,
    onTimeframeChange,
    horizon,
    onHorizonChange,
    isGodMode,
    onModeChange,
    oraclePrice,
    priceUpdateStatus = 'none',
    fundingRate,
    openInterestUsd,
    isConnected,
}) => {
    const fundingPct = typeof fundingRate === 'number' && Number.isFinite(fundingRate) ? fundingRate * 100 : null;

    return (
        <div className="flex-shrink-0 relative z-[80] bg-white/95 dark:bg-[#080B12]/95 backdrop-blur-xl border border-slate-200 dark:border-white/10 rounded-2xl px-3.5 py-2.5 shadow-md dark:shadow-[0_10px_30px_rgba(0,0,0,0.45)] flex flex-wrap items-center justify-between gap-3">
            {/* Left Cluster: Title + Exchange + Pair */}
            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                <div className="flex items-center gap-2 pr-2 border-r border-slate-200 dark:border-white/10">
                    <div className={`p-1.5 rounded-lg border ${isGodMode ? 'bg-rose-500/15 border-rose-500/35 text-rose-500' : 'bg-brand-primary/15 border-brand-primary/35 text-brand-primary'}`}>
                        {isGodMode ? <ShieldAlert className="w-4 h-4" /> : <Flame className="w-4 h-4" />}
                    </div>
                    <div className="hidden sm:block leading-tight">
                        <span className="text-xs font-black tracking-tight text-slate-900 dark:text-white block">
                            Liquidation Terminal
                        </span>
                        <span className="text-[9px] font-mono uppercase tracking-widest text-slate-500 dark:text-gray-400">
                            {isGodMode ? 'God Mode Orderflow' : 'OI Liquidity Matrix'}
                        </span>
                    </div>
                </div>

                {/* Exchange Selector */}
                <select
                    value={selectedExchange}
                    onChange={(e) => onExchangeChange(e.target.value)}
                    className="bg-slate-100 dark:bg-black/50 border border-slate-200 dark:border-white/10 rounded-xl px-2.5 py-1.5 text-xs font-bold font-mono text-slate-900 dark:text-white cursor-pointer focus:outline-none focus:border-brand-primary"
                    title="Select Perpetual Exchange"
                >
                    {exchanges.map((ex) => (
                        <option key={ex} value={ex} className="bg-white dark:bg-[#0A0A0A] text-slate-900 dark:text-white">
                            {ex.toUpperCase()}
                        </option>
                    ))}
                </select>

                {/* Pair Search ComboBox */}
                <div className="w-40 sm:w-44">
                    <ComboBox
                        value={activePair}
                        onChange={onPairChange}
                        options={availablePairs.map((m) => m.symbol)}
                        disabled={isPairsLoading}
                        placeholder={isPairsLoading ? 'Loading pairs...' : 'Search pair...'}
                        inputClassName="!bg-slate-100 dark:!bg-black/50 !border-slate-200 dark:!border-white/10 !text-slate-900 dark:!text-white !rounded-xl !py-1.5 !text-xs !font-bold !font-mono focus:!border-brand-primary"
                        icon={<TrendingUp className="w-3.5 h-3.5 text-slate-400" />}
                    />
                </div>

                {/* Timeframe Switcher */}
                <div className="flex items-center bg-slate-100 dark:bg-black/40 p-0.5 rounded-xl border border-slate-200 dark:border-white/10">
                    {TIMEFRAMES.map((tf) => (
                        <button
                            key={tf}
                            type="button"
                            onClick={() => onTimeframeChange(tf)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition-all ${
                                timeframe === tf
                                    ? 'bg-white dark:bg-white/15 text-brand-primary dark:text-white shadow-sm'
                                    : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            {tf}
                        </button>
                    ))}
                </div>

                {/* Pool Lookback Horizon Switcher */}
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-black/40 p-0.5 rounded-xl border border-slate-200 dark:border-white/10" title="OI-Weighted Liquidation Pool Horizon">
                    <span className="text-[9px] font-bold uppercase text-slate-400 dark:text-gray-500 pl-2 pr-1 hidden md:inline">
                        <Layers className="w-3 h-3 inline mr-0.5" />Pool
                    </span>
                    {HORIZONS.map((h) => (
                        <button
                            key={h}
                            type="button"
                            onClick={() => onHorizonChange(h)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold uppercase transition-all ${
                                horizon === h
                                    ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/35'
                                    : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            {h}
                        </button>
                    ))}
                </div>
            </div>

            {/* Right Cluster: Live Market Metrics + Mode Toggle */}
            <div className="flex flex-wrap items-center gap-2.5 ml-auto">
                {/* Oracle Price */}
                <div className="flex items-center gap-2 bg-slate-100 dark:bg-black/50 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">Oracle</span>
                    <span
                        className={`text-sm font-mono font-black transition-colors duration-300 ${
                            priceUpdateStatus === 'up'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : priceUpdateStatus === 'down'
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-slate-900 dark:text-white'
                        }`}
                    >
                        {formatPairPrice(oraclePrice)}
                    </span>
                </div>

                {/* Funding Rate & Open Interest */}
                {fundingPct !== null && (
                    <div className="hidden lg:flex items-center gap-1.5 bg-slate-100 dark:bg-black/50 border border-slate-200 dark:border-white/10 rounded-xl px-2.5 py-1 text-[11px] font-mono">
                        <span className="text-[9px] font-bold uppercase text-slate-500 dark:text-gray-400">Fund</span>
                        <span className={`font-bold ${fundingPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {fundingPct >= 0 ? '+' : ''}{fundingPct.toFixed(4)}%
                        </span>
                    </div>
                )}

                {typeof openInterestUsd === 'number' && openInterestUsd > 0 && (
                    <div className="hidden xl:flex items-center gap-1.5 bg-slate-100 dark:bg-black/50 border border-slate-200 dark:border-white/10 rounded-xl px-2.5 py-1 text-[11px] font-mono">
                        <span className="text-[9px] font-bold uppercase text-slate-500 dark:text-gray-400">OI</span>
                        <span className="font-bold text-slate-900 dark:text-white">{formatCompactUsd(openInterestUsd)}</span>
                    </div>
                )}

                {/* WS Live Indicator */}
                <div
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[10px] font-mono font-bold uppercase ${
                        isConnected
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                            : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400 animate-pulse'
                    }`}
                >
                    <Radio className="w-3 h-3" />
                    {isConnected ? 'Live' : 'Sync'}
                </div>

                {/* Clean Standard / God Mode Switcher (No overlap!) */}
                <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onModeChange(!isGodMode)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onModeChange(!isGodMode);
                        }
                    }}
                    className="flex items-center gap-2.5 bg-slate-100 dark:bg-black/60 p-1 px-3 rounded-xl border border-slate-200 dark:border-white/10 cursor-pointer select-none hover:border-slate-300 dark:hover:border-white/20 transition-all"
                    title="Switch between Standard Liquidity Map and God Mode Orderflow Terminal"
                >
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${!isGodMode ? 'text-brand-primary' : 'text-slate-500 dark:text-gray-400'}`}>
                        Standard
                    </span>
                    <div className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-300 ${isGodMode ? 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.5)]' : 'bg-slate-300 dark:bg-gray-700'}`}>
                        <span
                            className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-300"
                            style={{ transform: isGodMode ? 'translateX(18px)' : 'translateX(4px)' }}
                        />
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isGodMode ? 'text-rose-500' : 'text-slate-500 dark:text-gray-400'}`}>
                        God Mode
                    </span>
                </div>
            </div>
        </div>
    );
};

export default LiquidationCommandBar;
