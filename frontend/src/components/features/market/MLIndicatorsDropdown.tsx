import React, { useState, useRef, useEffect } from 'react';
import { Brain, Sparkles, Check, Activity, ShieldAlert } from 'lucide-react';
import apiClient from '../../../services/client';
import { toast } from 'react-hot-toast';

interface MLIndicatorsDropdownProps {
    activeModelId: string | null;
    onSelectModel: (id: string | null) => void;
    symbol: string;
}

export const MLIndicatorsDropdown: React.FC<MLIndicatorsDropdownProps> = ({ activeModelId, onSelectModel, symbol }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [models, setModels] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (isOpen && models.length === 0) {
            fetchModels();
        }
    }, [isOpen]);

    const fetchModels = async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get(`/ml-models?mode=advanced_sl_tp&symbol=${encodeURIComponent(symbol)}`);
            if (res.status === 200) {
                setModels(res.data);
            }
        } catch (error) {
            console.error("Failed to fetch ML models", error);
            toast.error("Failed to load ML models");
        } finally {
            setIsLoading(false);
        }
    };

    const handleSelect = (modelId: string) => {
        if (activeModelId === modelId) {
            onSelectModel(null); // toggle off
            toast.success("AI Inference Engine Deactivated");
        } else {
            onSelectModel(modelId);
            toast.success("AI Inference Engine Activated");
        }
        setIsOpen(false);
    };

    const activeModelName = models.find(m => m.id === activeModelId)?.name;

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${activeModelId
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-[0_0_15px_rgba(79,70,229,0.4)]'
                    : isOpen
                        ? 'bg-indigo-500/10 border-indigo-500 text-indigo-500 dark:text-indigo-400'
                        : 'bg-white dark:bg-black/20 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5'
                    }`}
            >
                <Brain size={16} className={activeModelId ? 'animate-pulse' : ''} />
                <span className="max-w-[130px] truncate">{activeModelId && activeModelName ? activeModelName : 'ML Indicators'}</span>
                <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-[#0b0e14] border border-gray-200 dark:border-white/10 rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="p-3 border-b border-gray-200 dark:border-white/10 bg-gradient-to-r from-indigo-500/10 to-transparent">
                        <h3 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-2">
                            <Sparkles size={14} />
                            Live Predictive Models (SL/TP)
                        </h3>
                    </div>
                    <div className="p-2 flex flex-col gap-1 max-h-[70vh] overflow-y-auto custom-scrollbar">
                        {isLoading ? (
                            <div className="p-4 text-sm text-gray-500 flex justify-center items-center">
                                <Activity className="animate-spin w-4 h-4 mr-2" /> Loading models...
                            </div>
                        ) : models.length === 0 ? (
                            <div className="p-4 text-xs text-gray-500 dark:text-gray-400 text-center">
                                No SL/TP models found in registry.
                            </div>
                        ) : (
                            models.map((model) => (
                                <button
                                    key={model.id}
                                    onClick={() => handleSelect(model.id)}
                                    className={`flex flex-col text-left w-full p-2 hover:bg-gray-50 dark:hover:bg-white/5 rounded-lg transition-colors group ${activeModelId === model.id ? 'bg-indigo-500/10 dark:bg-indigo-500/20' : ''}`}
                                >
                                    <div className="flex items-center justify-between w-full">
                                        <span className={`text-sm font-medium ${activeModelId === model.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-900 dark:text-gray-200'} flex items-center gap-2`}>
                                            <ShieldAlert size={14} className={activeModelId === model.id ? 'text-indigo-500' : 'text-gray-400'} />
                                            {model.name}
                                        </span>
                                        {activeModelId === model.id && <Check size={14} className="text-indigo-500" />}
                                    </div>
                                    <span className="text-[10px] text-gray-500 mt-1 ml-5">
                                        Type: {model.model_type}
                                    </span>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
