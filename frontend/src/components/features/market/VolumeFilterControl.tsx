import React, { useState, useEffect } from 'react';
import { Filter } from 'lucide-react';

interface VolumeFilterControlProps {
    threshold: number;
    onThresholdChange: (value: number) => void;
    mode: 'base' | 'quote';
    onModeChange: (mode: 'base' | 'quote') => void;
}

const WHALE_PRESETS = [
    { label: 'All', val: 0 },
    { label: '100K', val: 100_000 },
    { label: '500K', val: 500_000 },
    { label: '1M', val: 1_000_000 },
    { label: '5M', val: 5_000_000 },
];

const formatSize = (s: number) => {
    if (isNaN(s) || s <= 0) return '0';
    if (s >= 1_000_000_000) return parseFloat((s / 1_000_000_000).toFixed(2)) + 'B';
    if (s >= 1_000_000) return parseFloat((s / 1_000_000).toFixed(2)) + 'M';
    if (s >= 1_000) return parseFloat((s / 1_000).toFixed(2)) + 'K';
    return parseFloat(s.toFixed(2)).toString();
};

const parseSize = (val: string): number => {
    if (!val) return 0;
    const str = val.toString().trim().toLowerCase();
    const numMatch = str.match(/[\d.]+/);
    if (!numMatch) return 0;
    let num = parseFloat(numMatch[0]);

    if (str.endsWith('b')) num *= 1_000_000_000;
    else if (str.endsWith('m')) num *= 1_000_000;
    else if (str.endsWith('k')) num *= 1_000;

    return isNaN(num) ? 0 : num;
};

export const VolumeFilterControl: React.FC<VolumeFilterControlProps> = ({
    threshold,
    onThresholdChange,
    mode,
    onModeChange,
}) => {
    const min = 1000;
    const max = 100_000_000;
    const [inputValue, setInputValue] = useState<string>(formatSize(threshold));

    useEffect(() => {
        setInputValue(formatSize(threshold));
    }, [threshold]);

    const valueToSlider = (val: number) => {
        if (val <= 0) return 0;
        if (val <= min) return 1;
        if (val >= max) return 100;
        return (100 * Math.log(val / min)) / Math.log(max / min);
    };

    const sliderToValue = (slider: number) => {
        if (slider <= 0) return 0;
        if (slider >= 100) return max;
        const raw = min * Math.pow(max / min, slider / 100);
        if (raw >= 1_000_000) return Math.round(raw / 100_000) * 100_000;
        if (raw >= 1_000) return Math.round(raw / 1_000) * 1_000;
        return Math.round(raw);
    };

    const handleInputBlur = () => {
        const parsed = parseSize(inputValue);
        if (parsed >= 0) {
            onThresholdChange(parsed);
            setInputValue(formatSize(parsed));
        } else {
            setInputValue(formatSize(threshold));
        }
    };

    return (
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-[#0b101d] px-2.5 py-1 rounded-xl border border-slate-200 dark:border-white/10">
            <span className="cosmo-whale-filter-label inline-flex items-center gap-1 text-[10.5px] font-mono font-black uppercase tracking-wider text-slate-600 dark:text-gray-300 whitespace-nowrap">
                <Filter className="w-3 h-3 text-amber-500" />
                <span className="hidden sm:inline">Whale Filter</span>
            </span>

            <div className="flex items-center bg-white dark:bg-[#050811] rounded-lg p-0.5 border border-slate-200 dark:border-white/10">
                <button
                    type="button"
                    className={`px-1.5 py-0.5 text-[9.5px] font-mono font-bold rounded transition-colors cursor-pointer ${
                        mode === 'base'
                            ? 'bg-cyan-500 text-slate-950'
                            : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                    onClick={() => onModeChange('base')}
                    title="Filter walls by Base Coin size"
                >
                    COIN
                </button>
                <button
                    type="button"
                    className={`px-1.5 py-0.5 text-[9.5px] font-mono font-bold rounded transition-colors cursor-pointer ${
                        mode === 'quote'
                            ? 'bg-cyan-500 text-slate-950'
                            : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                    onClick={() => onModeChange('quote')}
                    title="Filter walls by USD Notional size"
                >
                    USD
                </button>
            </div>

            {/* 1-Click Whale Threshold Chips */}
            <div className="hidden md:flex items-center gap-1">
                {WHALE_PRESETS.map((p) => {
                    const isActive = threshold === p.val;
                    return (
                        <button
                            key={p.label}
                            type="button"
                            onClick={() => onThresholdChange(p.val)}
                            className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold border transition-colors cursor-pointer ${
                                isActive
                                    ? 'bg-amber-500/20 border-amber-400 text-amber-700 dark:text-amber-300'
                                    : 'bg-white/60 dark:bg-white/[0.03] border-slate-200 dark:border-white/10 text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                            title={`Filter orderbook walls ≥ ${p.label}`}
                        >
                            {p.label}
                        </button>
                    );
                })}
            </div>

            <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={valueToSlider(threshold)}
                onChange={(e) => onThresholdChange(sliderToValue(parseFloat(e.target.value)))}
                className="cosmo-whale-slider w-16 sm:w-20 h-1 bg-slate-300 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
            <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onBlur={handleInputBlur}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') handleInputBlur();
                }}
                className="w-14 bg-white dark:bg-[#050811] border border-slate-200 dark:border-white/10 focus:border-amber-400 rounded-md px-1.5 py-0.5 text-[11px] font-mono font-black text-amber-600 dark:text-amber-300 outline-none text-right"
                placeholder="5M"
                title="Custom minimum wall size (e.g. 250K, 2.5M)"
            />
        </div>
    );
};
