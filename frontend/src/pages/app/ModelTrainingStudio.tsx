import React, { useState, useEffect } from 'react';
import { mlModelsService } from '@/services/mlModelsService';
import { Cpu, Globe } from 'lucide-react';
import CryptoModelTrainingStudio from './CryptoModelTrainingStudio';
import ForexModelTrainingStudio from './ForexModelTrainingStudio';

const ModelTrainingStudio: React.FC<{ retrainModelId?: string | null }> = ({ retrainModelId }) => {
    const [mode, setMode] = useState<'crypto' | 'forex'>('crypto');

    useEffect(() => {
        if (retrainModelId) {
            mlModelsService.getModelConfig(retrainModelId).then((config) => {
                if (config) {
                    const isForex =
                        config.dataset_type === 'forex' ||
                        (config.symbol && config.symbol.includes('_'));
                    if (isForex) {
                        setMode('forex');
                    }
                }
            }).catch(err => console.error("Failed to fetch retrain model config", err));
        }
    }, [retrainModelId]);

    return (
        <div className="h-full flex flex-col relative w-full min-h-0">
            {/* Pro SaaS Top Desk Mode Switcher Bar */}
            <div className="cosmo-studio-topbar flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2 border-b border-slate-200 dark:border-slate-800/80 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/25">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                        ML TRAINING WORKBENCH
                    </span>
                    <span className="cosmo-studio-topbar-sub text-[11px] text-slate-500 dark:text-slate-400 hidden sm:inline">
                        Institutional Feature Engineering, Hyperparameter Optimization &amp; 1-Click Deployment
                    </span>
                </div>

                <div className="inline-flex items-center p-0.5 h-9 rounded-xl bg-slate-100 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800/90 shadow-inner">
                    <button
                        type="button"
                        onClick={() => setMode('crypto')}
                        className={`flex items-center gap-1.5 px-3.5 h-full rounded-[10px] text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                            mode === 'crypto'
                                ? 'bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40 shadow-sm'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-transparent'
                        }`}
                    >
                        <Cpu className="w-3.5 h-3.5" />
                        <span>Crypto Desk</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setMode('forex')}
                        className={`flex items-center gap-1.5 px-3.5 h-full rounded-[10px] text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                            mode === 'forex'
                                ? 'bg-gradient-to-r from-teal-500/20 to-emerald-500/20 text-teal-700 dark:text-teal-300 border border-teal-500/40 shadow-sm'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-transparent'
                        }`}
                    >
                        <Globe className="w-3.5 h-3.5" />
                        <span>Forex TradFi</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0 w-full">
                {mode === 'crypto' ? (
                    <CryptoModelTrainingStudio retrainModelId={retrainModelId} />
                ) : (
                    <ForexModelTrainingStudio retrainModelId={retrainModelId} />
                )}
            </div>
        </div>
    );
};

export default ModelTrainingStudio;
