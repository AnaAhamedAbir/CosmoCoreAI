import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, TerminalSquare, Plus, AlertCircle, CheckCircle2 } from 'lucide-react';
import apiClient from '@/services/client';

interface CustomFeatureBuilderProps {
    isOpen: boolean;
    onClose: () => void;
    onAddCustomFeature: (name: string, formula: string) => void;
}

export const CustomFeatureBuilder: React.FC<CustomFeatureBuilderProps> = ({
    isOpen,
    onClose,
    onAddCustomFeature
}) => {
    const [featureName, setFeatureName] = useState('');
    const [formula, setFormula] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    if (!isOpen) return null;

    const handleValidateAndSave = async () => {
        setError(null);
        setSuccess(false);

        if (!featureName.trim()) {
            setError('Feature name cannot be empty.');
            return;
        }

        if (!/^[a-zA-Z0-9_]+$/.test(featureName)) {
            setError('Feature name can only contain letters, numbers, and underscores.');
            return;
        }

        if (!formula.trim()) {
            setError('Formula cannot be empty.');
            return;
        }

        try {
            const res = await apiClient.post('/model-training/validate-custom-formula', { formula });
            if (res.data && res.data.valid) {
                setSuccess(true);
                setTimeout(() => {
                    onAddCustomFeature(featureName, formula);
                    setFeatureName('');
                    setFormula('');
                    setSuccess(false);
                    onClose();
                }, 1000);
            } else {
                setError(res.data?.error || 'Invalid formula');
            }
        } catch (err: any) {
            console.error("Formula validation failed", err);
            setError(err.response?.data?.detail || "Validation failed on the server.");
        }
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                    onClick={onClose}
                />
                
                <motion.div 
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-2xl bg-[#0A0A0A] border border-pink-500/30 rounded-2xl shadow-[0_0_50px_rgba(236,72,153,0.2)] flex flex-col overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-5 border-b border-white/10 bg-gradient-to-r from-pink-900/20 to-transparent">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-pink-500/20 rounded-lg border border-pink-500/30">
                                <TerminalSquare className="w-5 h-5 text-pink-400" />
                            </div>
                            <div>
                                <h2 className="text-lg font-black text-white uppercase tracking-widest">Custom Feature Builder</h2>
                                <p className="text-xs text-slate-400 mt-0.5">Define custom mathematical formulas using existing features</p>
                            </div>
                        </div>
                        <button 
                            onClick={onClose}
                            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-slate-400 hover:text-white"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 space-y-6">
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Feature Name</label>
                            <input 
                                type="text"
                                value={featureName}
                                onChange={(e) => setFeatureName(e.target.value)}
                                placeholder="e.g. customized_volume_ratio"
                                className="w-full bg-white/5 border border-white/10 focus:border-pink-500/50 rounded-xl px-4 py-3 text-sm text-white outline-none transition-all placeholder-white/20 font-mono"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 flex justify-between">
                                Formula Expression
                                <span className="text-pink-400 text-[10px]">Pandas/Polars syntax supported on backend</span>
                            </label>
                            <div className="relative">
                                <textarea 
                                    value={formula}
                                    onChange={(e) => setFormula(e.target.value)}
                                    placeholder="e.g. (buy_volume - sell_volume) / (trade_count + 1)"
                                    rows={4}
                                    className="w-full bg-black border border-white/10 focus:border-pink-500/50 rounded-xl px-4 py-3 text-sm text-pink-300 outline-none transition-all placeholder-white/20 font-mono resize-none"
                                />
                                <div className="absolute bottom-3 right-3 flex gap-2">
                                    <span className="text-[10px] font-bold bg-white/5 px-2 py-1 rounded border border-white/10 text-slate-400">math.log()</span>
                                    <span className="text-[10px] font-bold bg-white/5 px-2 py-1 rounded border border-white/10 text-slate-400">rolling_mean(20)</span>
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="flex items-center gap-2 text-rose-400 bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl text-sm font-bold">
                                <AlertCircle className="w-4 h-4" />
                                {error}
                            </div>
                        )}
                        
                        {success && (
                            <div className="flex items-center gap-2 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-xl text-sm font-bold">
                                <CheckCircle2 className="w-4 h-4" />
                                Feature validated and added successfully!
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-white/10 bg-black/50 flex justify-end gap-3">
                        <button 
                            onClick={onClose}
                            className="px-6 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white font-bold text-sm transition-all border border-white/10"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleValidateAndSave}
                            disabled={success}
                            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-bold text-sm transition-all shadow-[0_0_15px_rgba(236,72,153,0.4)] flex items-center gap-2"
                        >
                            <Plus className="w-4 h-4" />
                            Add to Dataset
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
