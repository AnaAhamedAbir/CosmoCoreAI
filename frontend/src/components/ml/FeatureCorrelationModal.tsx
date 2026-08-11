import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Network, AlertTriangle, Loader2 } from 'lucide-react';
import apiClient from '@/services/client';

interface FeatureCorrelationModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedFeatures: string[];
}

export const FeatureCorrelationModal: React.FC<FeatureCorrelationModalProps> = ({
    isOpen,
    onClose,
    selectedFeatures
}) => {
    const [isLoading, setIsLoading] = useState(true);
    const [mockMatrix, setMockMatrix] = useState<number[][]>([]);

    useEffect(() => {
        if (isOpen && selectedFeatures.length >= 2) {
            setIsLoading(true);
            apiClient.post('/model-training/correlation-matrix', { features: selectedFeatures })
                .then(res => {
                    if (res.data && res.data.matrix) {
                        setMockMatrix(res.data.matrix);
                    }
                })
                .catch(err => {
                    console.error("Failed to fetch correlation matrix", err);
                    // Fallback to empty if error
                    setMockMatrix(selectedFeatures.map(() => selectedFeatures.map(() => 0)));
                })
                .finally(() => {
                    setIsLoading(false);
                });
        }
    }, [isOpen, selectedFeatures]);

    if (!isOpen) return null;

    const getColorForCorrelation = (val: number) => {
        // -1 to 1 mapping to color. Red = high positive, Blue = high negative
        if (val === 1) return 'bg-rose-500 text-white font-bold';
        if (val > 0.8) return 'bg-rose-500/80 text-white';
        if (val > 0.5) return 'bg-rose-500/40 text-white/80';
        if (val > 0) return 'bg-rose-500/20 text-slate-400';
        if (val > -0.5) return 'bg-blue-500/20 text-slate-400';
        if (val > -0.8) return 'bg-blue-500/40 text-white/80';
        return 'bg-blue-500/80 text-white';
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
                    className="relative w-full max-w-5xl max-h-[90vh] bg-[#0A0A0A] border border-purple-500/30 rounded-2xl shadow-[0_0_50px_rgba(168,85,247,0.2)] flex flex-col overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-5 border-b border-white/10 bg-gradient-to-r from-purple-900/20 to-transparent">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-purple-500/20 rounded-lg border border-purple-500/30">
                                <Network className="w-5 h-5 text-purple-400" />
                            </div>
                            <div>
                                <h2 className="text-lg font-black text-white uppercase tracking-widest">Real-Time Feature Correlation</h2>
                                <p className="text-xs text-slate-400 mt-0.5">Identify heavily correlated features to prevent model overfitting</p>
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
                    <div className="p-6 overflow-auto flex-1 custom-scrollbar">
                        {selectedFeatures.length < 2 ? (
                            <div className="h-full flex flex-col items-center justify-center text-center p-12">
                                <AlertTriangle className="w-12 h-12 text-amber-500 mb-4 opacity-50" />
                                <h3 className="text-lg font-bold text-white mb-2">Not Enough Features</h3>
                                <p className="text-slate-400 text-sm max-w-md">Please select at least 2 features from the Data Engine to view their correlation matrix.</p>
                            </div>
                        ) : isLoading ? (
                            <div className="h-full flex flex-col items-center justify-center text-center p-12">
                                <Loader2 className="w-12 h-12 text-purple-500 animate-spin mb-4" />
                                <h3 className="text-lg font-bold text-white mb-2">Calculating Matrix</h3>
                                <p className="text-slate-400 text-sm">Computing Pearson correlation coefficients for {selectedFeatures.length} features...</p>
                            </div>
                        ) : (
                            <div className="w-full overflow-x-auto overflow-y-auto">
                                <table className="w-max border-collapse border-spacing-0">
                                    <thead>
                                        <tr>
                                            <th className="sticky left-0 top-0 z-20 bg-[#0A0A0A] p-2 border-b border-r border-white/10"></th>
                                            {selectedFeatures.map((f, i) => (
                                                <th key={i} className="sticky top-0 z-10 bg-[#0A0A0A] p-2 border-b border-r border-white/10 text-[10px] font-bold text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis max-w-[100px] hover:max-w-none hover:bg-white/5" title={f}>
                                                    <div className="-rotate-45 transform origin-bottom-left ml-4 w-24 overflow-hidden text-ellipsis">{f.split('_').join(' ')}</div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {mockMatrix.map((row, i) => (
                                            <tr key={i}>
                                                <th className="sticky left-0 z-10 bg-[#0A0A0A] p-2 border-b border-r border-white/10 text-[10px] font-bold text-slate-400 whitespace-nowrap text-right pr-4" title={selectedFeatures[i]}>
                                                    {selectedFeatures[i].split('_').join(' ')}
                                                </th>
                                                {row.map((val, j) => (
                                                    <td key={j} className={`p-2 border-b border-r border-[#0A0A0A] text-[10px] text-center w-12 h-12 transition-colors ${getColorForCorrelation(val)}`} title={`${selectedFeatures[i]} vs ${selectedFeatures[j]}: ${val.toFixed(2)}`}>
                                                        {val.toFixed(2)}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-white/10 bg-black/50 flex items-center justify-between">
                        <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            <div className="flex items-center gap-2"><div className="w-3 h-3 bg-rose-500 rounded-sm"></div> Strong Positive</div>
                            <div className="flex items-center gap-2"><div className="w-3 h-3 bg-[#0A0A0A] border border-white/20 rounded-sm"></div> Neutral (0)</div>
                            <div className="flex items-center gap-2"><div className="w-3 h-3 bg-blue-500 rounded-sm"></div> Strong Negative</div>
                        </div>
                        <button 
                            onClick={onClose}
                            className="px-6 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-sm transition-all"
                        >
                            Close
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
