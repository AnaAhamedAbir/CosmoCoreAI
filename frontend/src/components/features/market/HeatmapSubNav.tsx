import React from 'react';
import { Activity, Settings, AlignLeft } from 'lucide-react';
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
}

export const HeatmapSubNav: React.FC<HeatmapSubNavProps> = ({ 
    activeTab, 
    onChange,
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
    isAddChartDisabled
}) => {
    return (
        <div className="flex flex-wrap bg-white dark:bg-[#000000] border-b border-gray-200 dark:border-white/10 px-4 py-2 laptop:px-2.5 laptop:py-1.5 items-center gap-4 laptop:gap-2">
            <div className="flex items-center gap-2">
                <div className="flex space-x-1 bg-gray-100 dark:bg-black/30 p-1 rounded-lg">
                    <button
                        onClick={() => onChange('heatmap')}
                        className={`flex items-center space-x-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'heatmap'
                            ? 'bg-blue-600/10 text-brand-primary border border-blue-500/20 shadow-sm'
                            : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-black/10'
                            }`}
                    >
                        <Activity size={16} />
                        <span>Heatmap View</span>
                    </button>
                </div>

                {onAddChart && (
                    <button
                        onClick={onAddChart}
                        disabled={isAddChartDisabled}
                        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border transition-all bg-white dark:bg-black/20 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5 hover:border-brand-primary/40 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        title={isAddChartDisabled ? "Maximum 4 charts reached" : "Add another chart panel"}
                    >
                        <span className="text-brand-primary font-bold text-sm leading-none">+</span>
                        <span>Add Chart</span>
                    </button>
                )}
            </div>

            <div className="w-px h-6 bg-gray-200 dark:bg-white/10"></div>

            <AdvancedMetricsDropdown settings={advancedMetrics} onSettingsChange={onAdvancedMetricsChange} />

            <div className="w-px h-6 bg-gray-200 dark:bg-white/10"></div>

            <VolumeFilterControl 
                threshold={volumeThreshold} 
                onThresholdChange={setVolumeThreshold} 
                mode={volumeMode} 
                onModeChange={setVolumeMode} 
            />

            <div className="w-px h-6 bg-gray-200 dark:bg-white/10"></div>

            <MLIndicatorsDropdown 
                activeModelId={activeMLModelId}
                onSelectModel={setActiveMLModelId}
                symbol={symbol}
            />
        </div>
    );
};
