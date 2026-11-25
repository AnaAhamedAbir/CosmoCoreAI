import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Network, TerminalSquare, Loader2, Cpu } from 'lucide-react';

interface AdvancedAIToolsPanelProps {
    isTraining: boolean;
    onOpenCorrelation: () => void;
    onOpenBuilder: () => void;
    onAutoMLSelect: () => void;
}

export const AdvancedAIToolsPanel: React.FC<AdvancedAIToolsPanelProps> = ({
    isTraining,
    onOpenCorrelation,
    onOpenBuilder,
    onAutoMLSelect
}) => {
    const [isAutoSelecting, setIsAutoSelecting] = useState(false);

    const handleAutoSelect = async () => {
        setIsAutoSelecting(true);
        try {
            await Promise.resolve(onAutoMLSelect());
        } finally {
            setIsAutoSelecting(false);
        }
    };

    return (
        <div className="mb-4 rounded-2xl bg-white dark:bg-[#070B14] border border-slate-200 dark:border-slate-800/90 p-3.5 relative z-10 shadow-sm">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-cyan-600 dark:text-cyan-400 uppercase tracking-wider flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-500" />
                    AI Feature Engineering Suite
                </h3>
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/25">
                    <span className="inline-flex rounded-full h-1.5 w-1.5 bg-cyan-400" />
                    <span className="text-[9px] text-cyan-600 dark:text-cyan-300 font-mono font-bold tracking-wider uppercase">SHAP + PCA</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {/* AutoML Button */}
                <button
                    type="button"
                    onClick={handleAutoSelect}
                    disabled={isTraining || isAutoSelecting}
                    className={`relative flex flex-col items-center justify-center p-2.5 rounded-xl border transition-colors cursor-pointer ${
                        isAutoSelecting
                            ? 'border-cyan-500/50 bg-cyan-500/10'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] hover:border-cyan-500/40 hover:bg-cyan-500/10'
                    } disabled:opacity-50`}
                >
                    {isAutoSelecting ? (
                        <Loader2 className="w-4 h-4 text-cyan-500 animate-spin mb-1" />
                    ) : (
                        <Cpu className="w-4 h-4 text-cyan-500 mb-1" />
                    )}
                    <span className="text-[11px] font-bold text-slate-900 dark:text-white uppercase tracking-wider">AutoML Select</span>
                    <span className="text-[9px] text-slate-500 dark:text-slate-400 text-center mt-0.5">Top 20 via SHAP</span>
                </button>

                {/* Feature Correlation Button */}
                <button
                    type="button"
                    onClick={onOpenCorrelation}
                    disabled={isTraining}
                    className="relative flex flex-col items-center justify-center p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] hover:border-indigo-500/40 hover:bg-indigo-500/10 transition-colors disabled:opacity-50 cursor-pointer"
                >
                    <Network className="w-4 h-4 text-indigo-500 dark:text-indigo-400 mb-1" />
                    <span className="text-[11px] font-bold text-slate-900 dark:text-white uppercase tracking-wider">Correlation</span>
                    <span className="text-[9px] text-slate-500 dark:text-slate-400 text-center mt-0.5">Collinearity Matrix</span>
                </button>

                {/* Custom Feature Builder Button */}
                <button
                    type="button"
                    onClick={onOpenBuilder}
                    disabled={isTraining}
                    className="relative flex flex-col items-center justify-center p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] hover:border-emerald-500/40 hover:bg-emerald-500/10 transition-colors disabled:opacity-50 cursor-pointer"
                >
                    <TerminalSquare className="w-4 h-4 text-emerald-500 dark:text-emerald-400 mb-1" />
                    <span className="text-[11px] font-bold text-slate-900 dark:text-white uppercase tracking-wider">Feature Builder</span>
                    <span className="text-[9px] text-slate-500 dark:text-slate-400 text-center mt-0.5">Custom Formulas</span>
                </button>
            </div>
        </div>
    );
};
