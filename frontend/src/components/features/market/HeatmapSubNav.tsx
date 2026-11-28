import React from 'react';
import { BarChart3, Flame, Layers, Plus } from 'lucide-react';
import { VolumeFilterControl } from './VolumeFilterControl';
import { AdvancedMetricsDropdown } from './AdvancedMetricsDropdown';
import { MLIndicatorsDropdown } from './MLIndicatorsDropdown';
import { AdvancedMetricsSettings } from '../../../hooks/useAdvancedMetricsSettings';

interface HeatmapSubNavProps {
    activeTab: 'heatmap' | 'bot_settings' | 'bot_logs';
    onChange: (tab: 'heatmap' | 'bot_settings' | 'bot_logs') => void;
    volumeThreshold: number;
    setVolumeThreshold: (value: number) => void;
    volumeMode: 'base' | 'quote';
    setVolumeMode: (mode: 'base' | 'quote') => void;
    advancedMetrics: AdvancedMetricsSettings;
    onAdvancedMetricsChange: (settings: Partial<AdvancedMetricsSettings>) => void;
    activeMLModelId: string | null;
    setActiveMLModelId: (id: string | null) => void;
    symbol: string;
    onAddChart?: () => void;
    isAddChartDisabled?: boolean;
    chartsCount?: number;
    showFootprint?: boolean;
    showCVD?: boolean;
    showVPVR?: boolean;
    showLastPriceLine?: boolean;
    showBidAsk?: boolean;
    showMarkPrice?: boolean;
    onToggleFootprint?: () => void;
    onToggleCVD?: () => void;
    onToggleVPVR?: () => void;
    onToggleLastPriceLine?: () => void;
    onToggleBidAsk?: () => void;
    onToggleMarkPrice?: () => void;
}

export const HeatmapSubNav: React.FC<HeatmapSubNavProps> = ({
    volumeThreshold,
    setVolumeThreshold,
    volumeMode,
    setVolumeMode,
    advancedMetrics,
    onAdvancedMetricsChange,
    activeMLModelId,
    setActiveMLModelId,
    symbol,
    onAddChart,
    isAddChartDisabled,
    chartsCount = 1,
    showFootprint = false,
    showCVD = false,
    showVPVR = false,
    showLastPriceLine = true,
    showBidAsk = false,
    showMarkPrice = false,
    onToggleFootprint,
    onToggleCVD,
    onToggleVPVR,
    onToggleLastPriceLine,
    onToggleBidAsk,
    onToggleMarkPrice,
}) => {
    return (
        <div className="flex flex-wrap items-center justify-between bg-slate-50/90 dark:bg-[#050811] border-b border-slate-200 dark:border-white/10 px-3 py-1.5 gap-2">
            {/* Left: 1-Click Core L2 Overlay Toggles + OrderFlow Suite + ML Engine */}
            <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex items-center gap-1 bg-white dark:bg-[#0b101d] p-0.5 rounded-xl border border-slate-200 dark:border-white/10">
                    {onToggleVPVR && (
                        <button
                            type="button"
                            onClick={onToggleVPVR}
                            className={`px-2 py-1 rounded-lg text-[10.5px] font-mono font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                                showVPVR
                                    ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40'
                                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                            title="Toggle L2 Liquidity Heatmap & Volume Profile (VPVR)"
                        >
                            <Flame className="w-3 h-3 text-amber-500" />
                            <span>L2 Heatmap</span>
                        </button>
                    )}

                    {onToggleFootprint && (
                        <button
                            type="button"
                            onClick={onToggleFootprint}
                            className={`px-2 py-1 rounded-lg text-[10.5px] font-mono font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                                showFootprint
                                    ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40'
                                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                            title="Toggle Bid/Ask Footprint Clusters"
                        >
                            <Layers className="w-3 h-3 text-cyan-500" />
                            <span>Footprint</span>
                        </button>
                    )}

                    {onToggleCVD && (
                        <button
                            type="button"
                            onClick={onToggleCVD}
                            className={`px-2 py-1 rounded-lg text-[10.5px] font-mono font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                                showCVD
                                    ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40'
                                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                            title="Toggle Cumulative Volume Delta (CVD) Sub-Pane"
                        >
                            <BarChart3 className="w-3 h-3 text-emerald-500" />
                            <span>CVD</span>
                        </button>
                    )}

                    {onToggleLastPriceLine && (
                        <button
                            type="button"
                            onClick={onToggleLastPriceLine}
                            className={`px-2 py-1 rounded-lg text-[10.5px] font-mono font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                                showLastPriceLine
                                    ? 'bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-500/40'
                                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                            title="Toggle Main Last Traded Price Line"
                        >
                            <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                    showLastPriceLine ? 'bg-sky-400' : 'bg-slate-400'
                                }`}
                            />
                            <span>Last Line</span>
                        </button>
                    )}

                    {onToggleBidAsk && (
                        <button
                            type="button"
                            onClick={onToggleBidAsk}
                            className={`px-2 py-1 rounded-lg text-[10.5px] font-mono font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                                showBidAsk
                                    ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/40'
                                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                            title="Toggle Live Best Bid / Best Ask Spread Lines & Corridor"
                        >
                            <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                    showBidAsk ? 'bg-emerald-400' : 'bg-slate-400'
                                }`}
                            />
                            <span>BBO Lines</span>
                        </button>
                    )}

                    {onToggleMarkPrice && (
                        <button
                            type="button"
                            onClick={onToggleMarkPrice}
                            className={`px-2 py-1 rounded-lg text-[10.5px] font-mono font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                                showMarkPrice
                                    ? 'bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-500/40'
                                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                            title="Toggle Futures Mark Price Line & Last–Mark Basis"
                        >
                            <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                    showMarkPrice ? 'bg-purple-400' : 'bg-slate-400'
                                }`}
                            />
                            <span>Mark</span>
                        </button>
                    )}
                </div>

                <AdvancedMetricsDropdown
                    settings={advancedMetrics}
                    onSettingsChange={onAdvancedMetricsChange}
                />

                <MLIndicatorsDropdown
                    activeModelId={activeMLModelId}
                    onSelectModel={setActiveMLModelId}
                    symbol={symbol}
                />
            </div>

            {/* Right: Whale Wall Threshold Filter + Multi-Chart Grid Split */}
            <div className="flex flex-wrap items-center gap-2">
                <VolumeFilterControl
                    threshold={volumeThreshold}
                    onThresholdChange={setVolumeThreshold}
                    mode={volumeMode}
                    onModeChange={setVolumeMode}
                />

                {onAddChart && (
                    <button
                        type="button"
                        onClick={onAddChart}
                        disabled={isAddChartDisabled}
                        className="inline-flex items-center gap-1 text-xs font-mono font-bold px-2.5 py-1.5 rounded-xl border transition-colors bg-white dark:bg-[#0b101d] text-slate-700 dark:text-gray-200 border-slate-200 dark:border-white/10 hover:border-cyan-500/45 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                        title={
                            isAddChartDisabled
                                ? 'Maximum 4 charts active'
                                : 'Split workspace with an additional chart panel'
                        }
                    >
                        <Plus className="w-3.5 h-3.5 text-cyan-500" />
                        <span>Split Chart</span>
                        <span className="text-[10px] px-1 rounded bg-cyan-500/15 text-cyan-600 dark:text-cyan-300">
                            {chartsCount}/4
                        </span>
                    </button>
                )}
            </div>
        </div>
    );
};
