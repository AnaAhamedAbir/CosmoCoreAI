import React, { useState } from 'react';
import { Sliders, ChevronDown, ChevronUp } from 'lucide-react';

interface AdvancedHyperparametersProps {
    learningRate: number;
    setLearningRate: (val: number) => void;
    maxDepth: number;
    setMaxDepth: (val: number) => void;
    isTraining: boolean;
}

const AdvancedHyperparameters: React.FC<AdvancedHyperparametersProps> = ({ 
    learningRate, setLearningRate, maxDepth, setMaxDepth, isTraining 
}) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="mt-4 bg-white dark:bg-[#070B14] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden transition-colors shadow-sm">
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-3.5 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors cursor-pointer"
                type="button"
            >
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                    <Sliders className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                    Advanced Hyperparameters
                </div>
                {isOpen ? <ChevronUp className="w-4 h-4 text-slate-500 dark:text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-500 dark:text-slate-400" />}
            </button>
            
            {isOpen && (
                <div className="p-3.5 pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Learning Rate</label>
                        <input 
                            type="number" 
                            step="0.01"
                            min="0.001"
                            max="1.0"
                            value={learningRate} 
                            onChange={e => setLearningRate(parseFloat(e.target.value))}
                            disabled={isTraining}
                            className="w-full bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-cyan-500/40 outline-none transition-colors disabled:opacity-50"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Max Depth</label>
                        <input 
                            type="number" 
                            min="1"
                            max="50"
                            value={maxDepth} 
                            onChange={e => setMaxDepth(parseInt(e.target.value))}
                            disabled={isTraining}
                            className="w-full bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-cyan-500/40 outline-none transition-colors disabled:opacity-50"
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdvancedHyperparameters;
