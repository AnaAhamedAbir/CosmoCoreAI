import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { GripVertical, X, BrainCircuit, Target, ShieldAlert, TrendingUp, Crosshair } from 'lucide-react';
import { toast } from 'react-hot-toast';
import apiClient from '../../../services/client';
import { useFloatingModalDrag } from '../../../hooks/useFloatingModalDrag';
import { useDeviceProfile } from '../../../hooks/useDeviceProfile';
import { FloatingModalCyberFX } from '../../common/FloatingModalCyberFX';

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
    size?: 'sm' | 'md';
    showCrosshairAIPredict?: boolean;
    onToggleCrosshairAIPredict?: (enabled: boolean) => void;
}

export const ModelPredictorModal: React.FC<ModelPredictorModalProps> = ({ 
    onPrediction, 
    currentPrice, 
    externalPrice, 
    externalOpenTrigger, 
    size = 'md',
    showCrosshairAIPredict = false,
    onToggleCrosshairAIPredict
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [models, setModels] = useState<any[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [pricePoint, setPricePoint] = useState<string>(currentPrice.toString());
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<PredictionResult | null>(null);
    const { isThermalGuardActive } = useDeviceProfile();
    const { modalContainerRef, handleStartDrag, containerStyle } = useFloatingModalDrag({
        isOpen,
        storageKey: 'cosmo_algo_predictor_modal_pos_v1',
        defaultWidth: 460,
        defaultHeight: 620,
        maxCapHeight: 760,
        compactMaxCapHeight: 700,
    });

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

    const prevTriggerRef = useRef<number>(externalOpenTrigger || 0);

    // Handle external triggers
    useEffect(() => {
        if (externalOpenTrigger && externalOpenTrigger > 0 && externalOpenTrigger !== prevTriggerRef.current) {
            prevTriggerRef.current = externalOpenTrigger;
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
                className={`relative shrink-0 ${size === 'sm' ? 'w-[42px] h-[42px] shadow-md dark:shadow-[0_0_12px_rgba(99,102,241,0.5)]' : 'w-16 h-16 shadow-lg dark:shadow-[0_0_24px_rgba(99,102,241,0.5)]'} rounded-full flex items-center justify-center bg-gradient-to-br from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 border border-slate-900/15 dark:border-indigo-400/30 text-white z-[999] transition-all opacity-100 hover:scale-110 focus:outline-none group`}
                title="Algo Predictor"
            >
                <BrainCircuit className={`${size === 'sm' ? 'w-5 h-5' : 'w-8 h-8'} group-hover:scale-110 transition-transform bg-transparent`} />
            </button>

            {/* Floating Draggable Modal */}
            {isOpen && typeof document !== 'undefined' && createPortal(
                <div
                    ref={modalContainerRef}
                    style={containerStyle}
                    className={`cosmo-theme-modal fixed w-[460px] max-w-[calc(100vw-12px)] rounded-2xl border z-[99999] overflow-hidden transition-colors duration-200 select-none flex flex-col ${
                        isThermalGuardActive ? 'animate-cosmo-modal-fast' : 'animate-cosmo-modal-indigo'
                    } ${
                        isThermalGuardActive
                            ? 'bg-[#080c16] border-indigo-500/45 shadow-[0_14px_36px_rgba(0,0,0,0.92)]'
                            : 'bg-white dark:bg-[#070b14]/95 backdrop-blur-2xl border-slate-200 dark:border-white/10 shadow-[0_14px_40px_rgba(0,0,0,0.85),0_0_20px_rgba(99,102,241,0.18)]'
                    }`}
                >
                    <FloatingModalCyberFX color="indigo" isThermalGuard={isThermalGuardActive} />

                    {/* Header */}
                    <div
                        onMouseDown={handleStartDrag}
                        onTouchStart={handleStartDrag}
                        style={{ touchAction: 'none' }}
                        className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black/20 backdrop-blur-md cursor-grab active:cursor-grabbing select-none shrink-0"
                        title="Drag to move Algo Predictor"
                    >
                        <div className="flex items-center gap-2.5 pointer-events-none min-w-0">
                            <GripVertical className="w-4 h-4 text-indigo-400/80 shrink-0" />
                            <div className="p-1.5 bg-indigo-500/20 rounded-lg text-indigo-400 shrink-0">
                                <BrainCircuit className="w-4 h-4" />
                            </div>
                            <h2 className="text-base font-semibold text-white truncate">ML Model Inference</h2>
                        </div>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsOpen(false);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Body */}
                    <div
                        style={{ touchAction: 'pan-y' }}
                        className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4 custom-scrollbar"
                    >
                                {/* Crosshair AI Predict Button Toggle */}
                                <div className="flex items-center justify-between p-3.5 bg-black/30 backdrop-blur-sm border border-white/10 rounded-xl hover:bg-black/40 transition-colors">
                                    <div className="flex flex-col gap-0.5">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-white">Chart Hover AI Predict</span>
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold uppercase ${showCrosshairAIPredict ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}>
                                                {showCrosshairAIPredict ? 'ENABLED' : 'DISABLED'}
                                            </span>
                                        </div>
                                        <span className="text-[11px] text-slate-400">
                                            Show "+ AI Predict" button tracking crosshair on candle hover
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => onToggleCrosshairAIPredict?.(!showCrosshairAIPredict)}
                                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                            showCrosshairAIPredict ? 'bg-indigo-600' : 'bg-gray-700'
                                        }`}
                                    >
                                        <span
                                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                                                showCrosshairAIPredict ? 'translate-x-5' : 'translate-x-0'
                                            }`}
                                        />
                                    </button>
                                </div>

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
                </div>,
                document.body
            )}
        </>
    );
};
