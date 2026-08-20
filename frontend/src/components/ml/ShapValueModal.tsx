import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, BrainCircuit, BarChart2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface ShapDataPoint {
    feature: string;
    score: number;
}

interface ShapValueModalProps {
    isOpen: boolean;
    onClose: () => void;
    data: ShapDataPoint[];
    method: string;
}

export const ShapValueModal: React.FC<ShapValueModalProps> = ({ isOpen, onClose, data, method }) => {
    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    onClick={onClose}
                />
                <motion.div
                    initial={{ scale: 0.95, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.95, opacity: 0, y: 20 }}
                    className="relative w-full max-w-4xl bg-[#0B1121] border border-cyan-500/30 rounded-2xl shadow-[0_0_40px_rgba(6,182,212,0.15)] overflow-hidden flex flex-col max-h-[90vh]"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-5 border-b border-white/5 bg-white/[0.02]">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400">
                                <BrainCircuit className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    God-Tier AutoML Analysis
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
                                    <BarChart2 className="w-3.5 h-3.5" />
                                    Powered by {method || 'XGBoost + SHAP'}
                                </p>
                            </div>
                        </div>
                        <button 
                            onClick={onClose}
                            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Chart Container */}
                    <div className="p-6 flex-1 overflow-hidden min-h-[500px]">
                        <div className="h-full w-full bg-black/20 rounded-xl border border-white/5 p-4 pt-6" style={{ minHeight: '500px' }}>
                            <ResponsiveContainer width="100%" height={450}>
                                <BarChart
                                    data={data}
                                    layout="vertical"
                                    margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
                                >
                                    <XAxis type="number" hide />
                                    <YAxis 
                                        type="category" 
                                        dataKey="feature" 
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 500 }}
                                        width={140}
                                    />
                                    <Tooltip
                                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                        content={({ active, payload }) => {
                                            if (active && payload && payload.length) {
                                                return (
                                                    <div className="bg-[#0f172a] border border-cyan-500/30 p-3 rounded-xl shadow-xl">
                                                        <p className="text-cyan-400 font-bold mb-1">{payload[0].payload.feature}</p>
                                                        <p className="text-slate-300 text-sm">
                                                            Impact Score: <span className="text-white font-mono">{Number(payload[0].value).toFixed(4)}</span>
                                                        </p>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                    <Bar 
                                        dataKey="score" 
                                        radius={[0, 4, 4, 0]} 
                                        animationDuration={1500}
                                    >
                                        {data.map((entry, index) => (
                                            <Cell 
                                                key={`cell-${index}`} 
                                                fill={index < 5 ? '#06b6d4' : index < 10 ? '#3b82f6' : '#6366f1'} 
                                                fillOpacity={0.8 + (index * 0.01)}
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-white/5 bg-white/[0.01] flex justify-between items-center">
                        <p className="text-xs text-slate-500">
                            * Features with higher scores have a more significant impact on predicting future price movements.
                        </p>
                        <button 
                            onClick={onClose}
                            className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-sm transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)]"
                        >
                            Apply Features
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
