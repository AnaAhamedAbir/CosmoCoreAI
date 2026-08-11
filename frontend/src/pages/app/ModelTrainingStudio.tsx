import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { mlModelsService } from '@/services/mlModelsService';
import CryptoModelTrainingStudio from './CryptoModelTrainingStudio';
import ForexModelTrainingStudio from './ForexModelTrainingStudio';

const ModelTrainingStudio: React.FC<{ retrainModelId?: string | null }> = ({ retrainModelId }) => {
    // Determine initial mode based on some global state or default to crypto
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
        <div className="h-full flex flex-col relative w-full overflow-visible">
            {/* Global Market Mode Toggle */}
            <div className="absolute -top-6 right-6 z-[100] flex items-center gap-2 bg-[#0a0f1a]/80 backdrop-blur-xl p-1.5 rounded-full border border-white/10 shadow-[0_0_30px_rgba(168,85,247,0.15)] ring-1 ring-white/5">
                <button
                    onClick={() => setMode('crypto')}
                    className={`relative flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-black uppercase tracking-widest transition-all duration-500 overflow-hidden group ${
                        mode === 'crypto' 
                        ? 'text-white shadow-[0_0_25px_rgba(168,85,247,0.6)]' 
                        : 'text-slate-500 hover:text-white hover:bg-white/5'
                    }`}
                >
                    {mode === 'crypto' && (
                        <span className="absolute inset-0 bg-gradient-to-r from-brand-primary via-purple-500 to-indigo-600 opacity-90 animate-gradient-x"></span>
                    )}
                    <span className="relative z-10 flex items-center gap-2">
                        <span className={mode === 'crypto' ? 'animate-pulse text-white' : ''}>₿</span> 
                        CRYPTO
                    </span>
                </button>
                <button
                    onClick={() => setMode('forex')}
                    className={`relative flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-black uppercase tracking-widest transition-all duration-500 overflow-hidden group ${
                        mode === 'forex' 
                        ? 'text-white shadow-[0_0_25px_rgba(20,184,166,0.6)]' 
                        : 'text-slate-500 hover:text-white hover:bg-white/5'
                    }`}
                >
                    {mode === 'forex' && (
                        <span className="absolute inset-0 bg-gradient-to-r from-teal-500 via-emerald-500 to-cyan-600 opacity-90 animate-gradient-x"></span>
                    )}
                    <span className="relative z-10 flex items-center gap-2">
                        <span className={mode === 'forex' ? 'animate-pulse text-white' : ''}>💱</span> 
                        FOREX
                    </span>
                </button>
            </div>

            {/* Render the appropriate isolated component */}
            <AnimatePresence mode="wait">
                {mode === 'crypto' ? (
                    <motion.div
                        key="crypto"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ duration: 0.3 }}
                        className="flex-1 h-full w-full"
                    >
                        <CryptoModelTrainingStudio retrainModelId={retrainModelId} />
                    </motion.div>
                ) : (
                    <motion.div
                        key="forex"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ duration: 0.3 }}
                        className="flex-1 h-full w-full"
                    >
                        <ForexModelTrainingStudio retrainModelId={retrainModelId} />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ModelTrainingStudio;
