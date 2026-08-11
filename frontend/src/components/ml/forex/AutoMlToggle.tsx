import React from 'react';
import { Cpu } from 'lucide-react';

interface AutoMlToggleProps {
    useAutoMl: boolean;
    setUseAutoMl: (v: boolean) => void;
    autoMlTrials: number;
    setAutoMlTrials: (v: number) => void;
    epochs: number;
    setEpochs: (v: number) => void;
    isTraining: boolean;
}

export const AutoMlToggle: React.FC<AutoMlToggleProps> = ({
    useAutoMl,
    setUseAutoMl,
    autoMlTrials,
    setAutoMlTrials,
    epochs,
    setEpochs,
    isTraining
}) => {
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl transition-all hover:bg-white/10">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${useAutoMl ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-400'}`}>
                        <Cpu className="w-4 h-4" />
                    </div>
                    <div>
                        <h4 className="text-[12px] font-bold text-white">AutoML (Optuna)</h4>
                        <p className="text-[10px] text-slate-400">Hyperparameter Optimization</p>
                    </div>
                </div>
                <button
                    disabled={isTraining}
                    onClick={() => setUseAutoMl(!useAutoMl)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${useAutoMl ? 'bg-indigo-500' : 'bg-slate-600'}`}
                >
                    <span className={`absolute top-0.5 left-0.5 bg-white w-4 h-4 rounded-full transition-transform ${useAutoMl ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
            </div>

            {useAutoMl ? (
                <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">AutoML Trials (Search Space)</label>
                    <input 
                        type="number" 
                        value={autoMlTrials} 
                        onChange={e => setAutoMlTrials(parseInt(e.target.value))}
                        disabled={isTraining}
                        className="w-full bg-indigo-900/20 border border-indigo-500/30 rounded-xl px-4 py-3 text-sm text-indigo-100 focus:ring-2 focus:ring-indigo-500/50 outline-none placeholder-indigo-300/50"
                        placeholder="e.g. 50"
                    />
                    <p className="text-[10px] text-slate-500 mt-1.5 ml-1">More trials = Better accuracy, but longer training time.</p>
                </div>
            ) : (
                <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Epochs / Trees</label>
                    <input 
                        type="number" 
                        value={epochs} 
                        onChange={e => setEpochs(parseInt(e.target.value))}
                        disabled={isTraining}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:ring-2 focus:ring-blue-500/50 outline-none"
                    />
                </div>
            )}
        </div>
    );
};
