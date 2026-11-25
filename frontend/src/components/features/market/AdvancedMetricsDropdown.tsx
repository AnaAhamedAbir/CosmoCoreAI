import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Layers } from 'lucide-react';
import { AdvancedMetricsSettings } from '../../../hooks/useAdvancedMetricsSettings';

interface AdvancedMetricsDropdownProps {
    settings: AdvancedMetricsSettings;
    onSettingsChange: (settings: Partial<AdvancedMetricsSettings>) => void;
}

export const AdvancedMetricsDropdown: React.FC<AdvancedMetricsDropdownProps> = ({
    settings,
    onSettingsChange,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleFeature = (key: keyof AdvancedMetricsSettings) => {
        onSettingsChange({ [key]: !settings[key] });
    };

    const features: { key: keyof AdvancedMetricsSettings; label: string; icon: string }[] = [
        { key: 'showDeltaProfile', label: 'Delta Profile (Bid/Ask)', icon: '📊' },
        { key: 'showFootprintImbalance', label: 'Footprint Imbalance', icon: '👣' },
        { key: 'showTradeBubbles', label: 'Trade Bubbles (Blocks)', icon: '🫧' },
        { key: 'showSpoofingDetection', label: 'Spoofing Detection', icon: '🚨' },
        { key: 'showAnchoredVWAP', label: 'Anchored VWAP', icon: '⚓' },
        { key: 'showOIBOscillator', label: 'OIB Oscillator', icon: '🌊' },
        { key: 'showTPOProfile', label: 'TPO Market Profile', icon: '⏳' },
        { key: 'showDeltaDivergence', label: 'Delta Divergence', icon: '⚠️' },
    ];

    const activeCount = features.reduce((cnt, f) => cnt + (settings[f.key] ? 1 : 0), 0);

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-mono font-bold transition-colors cursor-pointer ${
                    activeCount > 0 || isOpen
                        ? 'bg-purple-500/15 border-purple-500/45 text-purple-700 dark:text-purple-300'
                        : 'bg-slate-100 dark:bg-[#0b101d] text-slate-700 dark:text-gray-300 border-slate-200 dark:border-white/10 hover:border-purple-400/40'
                }`}
            >
                <Layers className="w-3.5 h-3.5 text-purple-500" />
                <span>OrderFlow Suite</span>
                {activeCount > 0 && (
                    <span className="px-1.5 py-0.2 rounded bg-purple-500 text-white text-[9.5px] font-black leading-none">
                        {activeCount}
                    </span>
                )}
                <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
            </button>

            {isOpen && (
                <div className="absolute left-0 mt-2 w-64 bg-white dark:bg-[#070b14] border border-slate-200 dark:border-purple-500/35 rounded-xl shadow-2xl z-50 overflow-hidden">
                    <div className="h-[2px] w-full bg-gradient-to-r from-purple-500 via-indigo-500 to-cyan-400" />
                    <div className="px-3 py-2.5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
                        <h3 className="text-[10.5px] font-mono font-black text-purple-600 dark:text-purple-300 uppercase tracking-wider">
                            Institutional Microstructure
                        </h3>
                        {activeCount > 0 && (
                            <button
                                type="button"
                                onClick={() =>
                                    onSettingsChange({
                                        showDeltaProfile: false,
                                        showFootprintImbalance: false,
                                        showTradeBubbles: false,
                                        showSpoofingDetection: false,
                                        showAnchoredVWAP: false,
                                        showOIBOscillator: false,
                                        showTPOProfile: false,
                                        showDeltaDivergence: false,
                                    })
                                }
                                className="text-[10px] font-mono text-rose-500 hover:underline cursor-pointer"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                    <div className="p-2 flex flex-col gap-0.5 max-h-[65vh] overflow-y-auto">
                        {features.map(({ key, label, icon }) => (
                            <label
                                key={key}
                                className="flex items-center justify-between px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
                            >
                                <span className="text-xs font-medium text-slate-800 dark:text-gray-200 flex items-center gap-2">
                                    <span>{icon}</span>
                                    <span>{label}</span>
                                </span>
                                <input
                                    type="checkbox"
                                    checked={Boolean(settings[key])}
                                    onChange={() => toggleFeature(key)}
                                    className="w-3.5 h-3.5 accent-purple-500 rounded cursor-pointer"
                                />
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
