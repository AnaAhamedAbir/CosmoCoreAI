import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, BrainCircuit, X, Play, Loader2, Database, Key, DollarSign } from 'lucide-react';
import { mlModelsService } from '@/services/mlModelsService';
import { botService } from '@/services/botService';
import { useSettings } from '@/context/SettingsContext';
import { useFloatingModalDrag } from '@/hooks/useFloatingModalDrag';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';
import { FloatingModalCyberFX } from '@/components/common/FloatingModalCyberFX';
import { CustomMLModel } from '@/types';
import { toast } from 'react-hot-toast';

interface AIModelDeploymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    symbol: string;
    exchange: string;
    onDeploySuccess: (botId: string) => void;
    initialModelId?: string;
    initialTimeframe?: string;
}

export const AIModelDeploymentModal: React.FC<AIModelDeploymentModalProps> = ({ isOpen, onClose, symbol, exchange, onDeploySuccess, initialModelId, initialTimeframe }) => {
    const [models, setModels] = useState<CustomMLModel[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isDeploying, setIsDeploying] = useState(false);
    
    // Form state
    const [selectedModelId, setSelectedModelId] = useState<string>('');
    const [selectedApiKey, setSelectedApiKey] = useState<string>('');
    const [tradeAmount, setTradeAmount] = useState<number>(100);
    const [timeframe, setTimeframe] = useState<string>(initialTimeframe || '15m');
    
    const { apiKeys } = useSettings();
    const { isThermalGuardActive } = useDeviceProfile();
    const { modalContainerRef, handleStartDrag, containerStyle } = useFloatingModalDrag({
        isOpen,
        storageKey: 'cosmo_ai_deploy_modal_pos_v1',
        defaultWidth: 500,
        defaultHeight: 540,
        maxCapHeight: 720,
        compactMaxCapHeight: 660,
    });

    useEffect(() => {
        if (isOpen) {
            if (initialTimeframe) {
                setTimeframe(initialTimeframe);
            }
            loadModels();
        }
    }, [isOpen, initialModelId, initialTimeframe]);

    const loadModels = async () => {
        try {
            setIsLoading(true);
            const data = await mlModelsService.getModels();
            // Only show models that have an active version ready
            const readyModels = data.filter(m => m.activeVersionId);
            setModels(readyModels);
            if (initialModelId && readyModels.some(m => m.id === initialModelId)) {
                setSelectedModelId(initialModelId);
            } else if (readyModels.length > 0) {
                setSelectedModelId(readyModels[0].id);
            }
            if (apiKeys && apiKeys.length > 0) {
                setSelectedApiKey(apiKeys[0].id?.toString() || '');
            }
        } catch (error) {
            console.error("Failed to load models", error);
            toast.error("Failed to load AI Models");
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeploy = async () => {
        if (!selectedModelId) {
            toast.error("Please select an AI Model");
            return;
        }
        
        try {
            setIsDeploying(true);
            
            const selectedModel = models.find(m => m.id === selectedModelId);
            
            const botData = {
                name: `AI Bot: ${selectedModel?.name || selectedModelId}`,
                exchange: exchange,
                market: symbol,
                strategy: 'ai_model_bot',
                timeframe: timeframe,
                trade_value: tradeAmount,
                api_key_id: selectedApiKey || null,
                is_paper_trading: !selectedApiKey,
                config: {
                    ai_model_id: selectedModelId,
                    amount_per_trade: tradeAmount,
                    timeframe: timeframe,
                    stop_loss: 5.0, // Default safe SL
                    take_profit: 10.0 // Default safe TP
                }
            };
            
            // Create Bot
            const newBot = await botService.createBot(botData);
            
            // Start Bot
            await botService.controlBot(newBot.id, 'start');
            
            toast.success("AI Trading Bot Deployed Successfully!");
            onDeploySuccess(newBot.id.toString());
            onClose();
            
        } catch (error: any) {
            console.error("Failed to deploy AI bot", error);
            toast.error(error.response?.data?.detail || "Failed to deploy AI Bot");
        } finally {
            setIsDeploying(false);
        }
    };

    if (!isOpen || typeof document === 'undefined') return null;

    return createPortal(
        <div
            ref={modalContainerRef}
            style={containerStyle}
            className={`cosmo-theme-modal fixed w-[500px] max-w-[calc(100vw-12px)] rounded-2xl border z-[99999] overflow-hidden transition-colors duration-200 select-none flex flex-col ${
                isThermalGuardActive ? 'animate-cosmo-modal-fast' : 'animate-cosmo-modal-purple'
            } ${
                isThermalGuardActive
                    ? 'bg-[#080c16] border-purple-500/45 shadow-[0_14px_36px_rgba(0,0,0,0.92)]'
                    : 'bg-white dark:bg-[#0A0A0A] border-gray-200 dark:border-white/10 shadow-2xl backdrop-blur-2xl'
            }`}
        >
            <FloatingModalCyberFX color="purple" isThermalGuard={isThermalGuardActive} />

            {/* Header */}
            <div
                onMouseDown={handleStartDrag}
                onTouchStart={handleStartDrag}
                style={{ touchAction: 'none' }}
                className="p-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between bg-gradient-to-r from-brand-primary/10 to-transparent cursor-grab active:cursor-grabbing select-none shrink-0"
                title="Drag to move modal"
            >
                <div className="flex items-center gap-2.5 pointer-events-none min-w-0">
                    <GripVertical className="w-4 h-4 text-purple-400/80 shrink-0" />
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30 shrink-0">
                        <BrainCircuit className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-base font-bold text-slate-800 dark:text-white leading-tight truncate">Deploy AI Model</h2>
                        <p className="text-xs text-slate-500 font-medium truncate">{symbol} • {exchange}</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-colors cursor-pointer shrink-0"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Content */}
            <div
                style={{ touchAction: 'pan-y' }}
                className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5 custom-scrollbar"
            >
                        {isLoading ? (
                            <div className="flex flex-col items-center justify-center py-10">
                                <Loader2 className="w-8 h-8 text-brand-primary animate-spin mb-4" />
                                <p className="text-sm text-gray-500">Loading AI Models from Registry...</p>
                            </div>
                        ) : models.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-10 text-center">
                                <Database className="w-12 h-12 text-gray-400 mb-4 opacity-50" />
                                <h3 className="text-slate-800 dark:text-white font-bold mb-2">No Trained Models Found</h3>
                                <p className="text-sm text-gray-500 mb-6">You need to train an AI model first before deploying it.</p>
                                <button 
                                    onClick={onClose} // Typically we would redirect to Training Studio here
                                    className="px-4 py-2 bg-brand-primary/10 text-brand-primary font-bold rounded-lg hover:bg-brand-primary/20 transition-colors"
                                >
                                    Go to Training Studio
                                </button>
                            </div>
                        ) : (
                            <>
                                {/* Model Selection */}
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
                                        <Database className="w-4 h-4 text-brand-primary" /> Select Trained Model
                                    </label>
                                    <select 
                                        value={selectedModelId}
                                        onChange={(e) => setSelectedModelId(e.target.value)}
                                        className="w-full bg-gray-50 dark:bg-black/50 border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-primary/50 outline-none transition-all"
                                    >
                                        {models.map(m => (
                                            <option key={m.id} value={m.id}>
                                                {m.name} ({m.modelType}) - v{m.versions?.find(v => v.id === m.activeVersionId)?.version || '1.0'}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* API Key Selection */}
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
                                        <Key className="w-4 h-4 text-purple-500" /> Exchange API Key
                                    </label>
                                    <select 
                                        value={selectedApiKey}
                                        onChange={(e) => setSelectedApiKey(e.target.value)}
                                        className="w-full bg-gray-50 dark:bg-black/50 border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500/50 outline-none transition-all"
                                    >
                                        <option value="">Virtual / Paper Trading Mode</option>
                                        {apiKeys?.map(key => (
                                            <option key={key.id} value={key.id}>
                                                {key.name} ({key.exchange})
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* Trade Settings */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
                                            <DollarSign className="w-4 h-4 text-green-500" /> Trade Value
                                        </label>
                                        <div className="relative">
                                            <input 
                                                type="number" 
                                                value={tradeAmount}
                                                onChange={(e) => setTradeAmount(Number(e.target.value))}
                                                className="w-full bg-gray-50 dark:bg-black/50 border border-gray-200 dark:border-white/10 rounded-xl pl-8 pr-4 py-3 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-green-500/50 outline-none transition-all"
                                            />
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">$</span>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
                                            Timeframe
                                        </label>
                                        <select 
                                            value={timeframe}
                                            onChange={(e) => setTimeframe(e.target.value)}
                                            className="w-full bg-gray-50 dark:bg-black/50 border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-primary/50 outline-none transition-all"
                                        >
                                            <option value="1m">1 Minute</option>
                                            <option value="5m">5 Minutes</option>
                                            <option value="15m">15 Minutes</option>
                                            <option value="1h">1 Hour</option>
                                            <option value="4h">4 Hours</option>
                                        </select>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#050505] flex gap-3 shrink-0">
                <button 
                    type="button"
                    onClick={onClose}
                    className="flex-1 py-2.5 font-bold rounded-xl border border-gray-300 dark:border-white/10 text-slate-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition-all cursor-pointer"
                >
                    Cancel
                </button>
                <button 
                    type="button"
                    onClick={handleDeploy}
                    disabled={isDeploying || models.length === 0}
                    className="flex-1 py-2.5 font-bold rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 hover:-translate-y-0.5 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                    {isDeploying ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
                    {isDeploying ? 'Deploying...' : 'Deploy AI Bot'}
                </button>
            </div>
        </div>,
        document.body
    );
};
