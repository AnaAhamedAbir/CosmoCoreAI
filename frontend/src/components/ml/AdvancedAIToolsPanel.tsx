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
        // Simulate an API call for AutoML feature selection
        await new Promise(resolve => setTimeout(resolve, 2000));
        onAutoMLSelect();
        setIsAutoSelecting(false);
    };

    return (
        <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-1 rounded-2xl bg-gradient-to-r from-cyan-500/30 via-purple-500/30 to-pink-500/30 shadow-[0_0_30px_rgba(168,85,247,0.15)] relative overflow-hidden group"
        >
            {/* Animated background glow */}
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-purple-500/10 to-pink-500/10 blur-xl group-hover:blur-2xl transition-all duration-500"></div>

            <div className="bg-[#0A0A0A]/90 backdrop-blur-xl rounded-[14px] border border-white/10 p-4 relative z-10">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 uppercase tracking-widest flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-cyan-400" />
                        Advanced AI Features
                    </h3>
                    <div className="flex items-center gap-2">
                        <span className="flex h-2 w-2 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                        </span>
                        <span className="text-[10px] text-cyan-400 font-bold tracking-widest uppercase">Live Engine</span>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* AutoML Button */}
                    <button
                        onClick={handleAutoSelect}
                        disabled={isTraining || isAutoSelecting}
                        className={`relative flex flex-col items-center justify-center p-3 rounded-xl border transition-all duration-300 overflow-hidden ${
                            isAutoSelecting 
                                ? 'border-cyan-500/50 bg-cyan-500/10 shadow-[0_0_20px_rgba(34,211,238,0.2)]' 
                                : 'border-white/5 bg-white/5 hover:border-cyan-500/30 hover:bg-cyan-500/10'
                        } disabled:opacity-50`}
                    >
                        {isAutoSelecting ? (
                            <Loader2 className="w-5 h-5 text-cyan-400 animate-spin mb-1.5" />
                        ) : (
                            <Cpu className="w-5 h-5 text-cyan-400 mb-1.5" />
                        )}
                        <span className="text-[11px] font-bold text-white uppercase tracking-wider">AutoML Select</span>
                        <span className="text-[9px] text-slate-400 text-center mt-0.5">Top 20 Features via SHAP</span>
                    </button>

                    {/* Feature Correlation Button */}
                    <button
                        onClick={onOpenCorrelation}
                        disabled={isTraining}
                        className="relative flex flex-col items-center justify-center p-3 rounded-xl border border-white/5 bg-white/5 hover:border-purple-500/30 hover:bg-purple-500/10 transition-all duration-300 disabled:opacity-50"
                    >
                        <Network className="w-5 h-5 text-purple-400 mb-1.5" />
                        <span className="text-[11px] font-bold text-white uppercase tracking-wider">Correlation Matrix</span>
                        <span className="text-[9px] text-slate-400 text-center mt-0.5">Detect & Prevent Overfitting</span>
                    </button>

                    {/* Custom Feature Builder Button */}
                    <button
                        onClick={onOpenBuilder}
                        disabled={isTraining}
                        className="relative flex flex-col items-center justify-center p-3 rounded-xl border border-white/5 bg-white/5 hover:border-pink-500/30 hover:bg-pink-500/10 transition-all duration-300 disabled:opacity-50"
                    >
                        <TerminalSquare className="w-5 h-5 text-pink-400 mb-1.5" />
                        <span className="text-[11px] font-bold text-white uppercase tracking-wider">Feature Builder</span>
                        <span className="text-[9px] text-slate-400 text-center mt-0.5">Custom Math Formulas</span>
                    </button>
                </div>
            </div>
        </motion.div>
    );
};
