import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, BrainCircuit, Target, ShieldAlert, TrendingUp, Crosshair } from 'lucide-react';
import { toast } from 'react-hot-toast';
import apiClient from '../../../services/client';

export interface PredictionResult {
    model_id: string;
    model_name: string;
    price_point: number;
    signal: 'BUY' | 'SELL' | 'HOLD';
    entry_price: number;
    sl?: number;
    tp?: number;
    metrics: {
        confidence_score: number;
        features_used: number;
        dataset_type: string;
        algorithm: string;
    };
    timestamp: number;
}

interface ModelPredictorModalProps {
    onPrediction: (result: PredictionResult) => void;
    currentPrice: number;
    externalPrice?: number | null;
    externalOpenTrigger?: number;
}

export const ModelPredictorModal: React.FC<ModelPredictorModalProps> = ({ onPrediction, currentPrice, externalPrice, externalOpenTrigger }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [models, setModels] = useState<any[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [pricePoint, setPricePoint] = useState<string>(currentPrice.toString());
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<PredictionResult | null>(null);

    // Fetch models and set initial price when opened
    useEffect(() => {
        if (isOpen) {
            fetchModels();
            // Only update to currentPrice if we haven't set an external price
            if (!externalPrice) {
                setPricePoint(currentPrice.toString());
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]); // Intentionally omitting currentPrice to avoid overwriting user input and API spam on every tick

    // Handle external triggers
    useEffect(() => {
        if (externalOpenTrigger && externalOpenTrigger > 0) {
            setIsOpen(true);
            if (externalPrice) {
                setPricePoint(externalPrice.toString());
            }
        }
    }, [externalOpenTrigger, externalPrice]);

    const fetchModels = async () => {
        try {
            const res = await apiClient.get('/ml-models?mode=advanced_sl_tp');
            if (res.status === 200) {
                setModels(res.data);
                if (res.data.length > 0) setSelectedModel(res.data[0].id);
            }
        } catch (error) {
            console.error("Failed to fetch models", error);
        }
    };

    const handlePredict = async () => {
        if (!selectedModel || !pricePoint) return;
        setIsLoading(true);
        try {
            const res = await apiClient.post(`/ml-models/${selectedModel}/predict`, { 
                price_point: parseFloat(pricePoint) 
            });

            if (res.status === 200) {
                const data = res.data;
                // Ensure entry_price is set, since backend returns price
                if (data.price_point && !data.entry_price) {
                    data.entry_price = data.price_point;
                }
                setResult(data);
                onPrediction(data);
                toast.success(`AI Analysis Complete: ${data.signal}`);
            } else {
                toast.error("Prediction failed.");
            }
        } catch (error) {
            toast.error("Network error during prediction.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            {/* Floating Button */}
            <button
                onClick={() => setIsOpen(true)}
                className="relative shrink-0 w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-br from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 border border-indigo-400/30 text-white shadow-[0_0_24px_rgba(99,102,241,0.5)] z-[999] transition-all opacity-100 hover:scale-110 focus:outline-none group"
                title="AI Predictor"
            >
                <BrainCircuit className="w-8 h-8 group-hover:scale-110 transition-transform bg-transparent" />
            </button>

            {/* Modal Overlay */}
            <AnimatePresence>
                {isOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                            onClick={() => setIsOpen(false)}
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="relative w-full max-w-md bg-white/10 dark:bg-black/40 backdrop-blur-2xl border border-white/20 dark:border-white/10 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden"
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between p-5 border-b border-white/10 bg-black/20 backdrop-blur-md">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400">
                                        <BrainCircuit className="w-5 h-5" />
                                    </div>
                                    <h2 className="text-lg font-semibold text-white">ML Model Inference</h2>
                                </div>
                                <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Body */}
                            <div className="p-5 space-y-5">
                                {/* Model Selection */}
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Select Model</label>
                                    <select 
                                        value={selectedModel} 
                                        onChange={(e) => setSelectedModel(e.target.value)}
                                        className="w-full bg-black/30 backdrop-blur-sm border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all hover:bg-black/40"
                                    >
                                        <option value="">-- Choose a Model --</option>
                                        {models.map(m => (
                                            <option key={m.id} value={m.id}>{m.name || m.id} ({m.model_type})</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Price Point Input */}
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Analysis Price Point</label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                                        <input 
                                            type="number" 
                                            value={pricePoint} 
                                            onChange={(e) => setPricePoint(e.target.value)}
                                            className="w-full bg-black/30 backdrop-blur-sm border border-white/10 text-white rounded-xl pl-8 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all hover:bg-black/40"
                                            placeholder="e.g. 65000"
                                        />
                                    </div>
                                </div>

                                {/* Action Button */}
                                <button 
                                    onClick={handlePredict}
                                    disabled={isLoading || !selectedModel || !pricePoint}
                                    className="w-full relative overflow-hidden group bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white font-semibold rounded-xl px-4 py-3 transition-all"
                                >
                                    <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-in-out"></div>
                                    <span className="relative flex items-center justify-center gap-2">
                                        {isLoading ? 'Analyzing...' : 'Generate Signal'}
                                        {!isLoading && <TrendingUp className="w-4 h-4" />}
                                    </span>
                                </button>

                                {/* Results View */}
                                <AnimatePresence mode="wait">
                                    {result && (
                                        <motion.div 
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            exit={{ opacity: 0, height: 0 }}
                                            className="pt-4 border-t border-white/10"
                                        >
                                            <div className="bg-black/30 backdrop-blur-md rounded-xl p-4 border border-white/10 space-y-4 shadow-inner">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-slate-400 text-sm">Signal Generated</span>
                                                    <span className={`px-3 py-1 rounded-md text-sm font-bold tracking-widest uppercase
                                                        ${result.signal === 'BUY' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 
                                                          result.signal === 'SELL' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 
                                                          'bg-gray-500/20 text-gray-400 border border-gray-500/30'}
                                                    `}>
                                                        {result.signal}
                                                    </span>
                                                </div>

                                                {(result.entry_price !== undefined || result.tp !== undefined || result.sl !== undefined) && (
                                                    <div className="grid grid-cols-3 gap-2">
                                                        {result.entry_price !== undefined && (
                                                            <div className="bg-black/40 rounded-lg p-2 border border-white/5 flex flex-col items-center justify-center gap-1 text-center">
                                                                <Crosshair className="w-4 h-4 text-indigo-400" />
                                                                <div className="text-[9px] text-slate-500 uppercase tracking-wider">Entry</div>
                                                                <div className="text-indigo-400 font-medium text-xs">{result.entry_price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 6})}</div>
                                                            </div>
                                                        )}
                                                        {result.tp !== undefined && (
                                                            <div className="bg-black/40 rounded-lg p-2 border border-white/5 flex flex-col items-center justify-center gap-1 text-center">
                                                                <Target className="w-4 h-4 text-emerald-400" />
                                                                <div className="text-[9px] text-slate-500 uppercase tracking-wider">Take Profit</div>
                                                                <div className="text-emerald-400 font-medium text-xs">{result.tp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 6})}</div>
                                                            </div>
                                                        )}
                                                        {result.sl !== undefined && (
                                                            <div className="bg-black/40 rounded-lg p-2 border border-white/5 flex flex-col items-center justify-center gap-1 text-center">
                                                                <ShieldAlert className="w-4 h-4 text-rose-400" />
                                                                <div className="text-[9px] text-slate-500 uppercase tracking-wider">Stop Loss</div>
                                                                <div className="text-rose-400 font-medium text-xs">{result.sl.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 6})}</div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Reasoning Metrics */}
                                                <div className="space-y-2 mt-4">
                                                    <div className="text-xs font-semibold text-slate-300 mb-2">Analysis Metrics</div>
                                                    
                                                    <div className="space-y-1">
                                                        <div className="flex justify-between text-xs">
                                                            <span className="text-slate-500">Confidence Score</span>
                                                            <span className="text-indigo-400 font-medium">{result.metrics.confidence_score}%</span>
                                                        </div>
                                                        <div className="w-full bg-slate-900 rounded-full h-1.5">
                                                            <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${result.metrics.confidence_score}%` }}></div>
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="flex justify-between items-center text-xs py-1">
                                                        <span className="text-slate-500">Algorithm</span>
                                                        <span className="text-slate-300">{result.metrics.algorithm}</span>
                                                    </div>
                                                    
                                                    <div className="flex justify-between items-center text-xs py-1 border-t border-white/5">
                                                        <span className="text-slate-500">Dataset Type</span>
                                                        <span className="text-slate-300">{result.metrics.dataset_type}</span>
                                                    </div>

                                                    <div className="flex justify-between items-center text-xs py-1 border-t border-white/5">
                                                        <span className="text-slate-500">Features Evaluated</span>
                                                        <span className="text-amber-400">{result.metrics.features_used}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </>
    );
};
