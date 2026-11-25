import React, { useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
    Activity,
    Cpu,
    Database,
    Download,
    Layers,
    Pin,
    Play,
    Rocket,
    RotateCcw,
    Sparkles,
    Trash2,
    Trophy,
    Zap,
} from 'lucide-react';
import Button from '@/components/common/Button';
import ForexModelCard from '@/components/ml/forex/ForexModelCard';
import ModelComparisonModal from '@/components/ml/ModelComparisonModal';
import ModelInspectorModal, { InspectorTab } from '@/components/ml/ModelInspectorModal';
import RegistryHeader, { RegistryFilter, RegistrySort } from '@/components/ml/RegistryHeader';
import RegistryTableView from '@/components/ml/RegistryTableView';
import RLTrainingVisualizer from '@/components/ml/RLTrainingVisualizer';
import { AIModelDeploymentModal } from '@/components/features/market/AIModelDeploymentModal';
import {
    ArimaIcon,
    CheckCircleIcon,
    ClockIcon,
    ExclamationCircleIcon,
    LstmIcon,
    OtherModelIcon,
    RandomForestIcon,
} from '@/constants';
import { useTheme } from '@/context/ThemeContext';
import { mlModelsService } from '@/services/mlModelsService';
import { mlTrainingService } from '@/services/mlTrainingService';
import {
    ModelCompareItem,
    trainingStudioToolsService,
} from '@/services/trainingStudioToolsService';
import { AppView, CustomMLModel, ModelVersion } from '@/types';

// --- Visual Components ---

const NeuralMeshBackground = () => (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div
            className="absolute top-0 left-0 w-full h-full opacity-10 dark:opacity-20"
            style={{
                backgroundImage: 'radial-gradient(#6366F1 1px, transparent 1px)',
                backgroundSize: '30px 30px',
            }}
        />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/15 dark:bg-purple-500/20 rounded-full blur-[100px] animate-pulse" />
        <div
            className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/15 dark:bg-blue-500/20 rounded-full blur-[100px] animate-pulse"
            style={{ animationDelay: '1s' }}
        />
    </div>
);

const StatusPill: React.FC<{ status: ModelVersion['status'] }> = ({ status }) => {
    let colorClass =
        'bg-slate-500/10 border-slate-500/20 text-slate-600 dark:text-gray-400 shadow-sm';
    let icon = <ClockIcon className="w-3.5 h-3.5" />;
    let animate = '';

    if (status === 'Ready') {
        colorClass =
            'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 shadow-sm dark:shadow-[0_0_15px_rgba(16,185,129,0.2)]';
        icon = <CheckCircleIcon className="w-3.5 h-3.5" />;
    } else if (status === 'Processing') {
        colorClass =
            'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400 shadow-sm';
        icon = (
            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
        animate = 'animate-pulse';
    } else if (status === 'Error') {
        colorClass = 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400 shadow-sm';
        icon = <ExclamationCircleIcon className="w-3.5 h-3.5" />;
    }

    return (
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border backdrop-blur-md cursor-default ${colorClass}`}>
            <span>{icon}</span>
            <span className={`text-[10px] font-bold uppercase tracking-widest ${animate}`}>{status}</span>
        </div>
    );
};

// --- Modals ---

const UploadModelModal: React.FC<{
    onClose: () => void;
    onUpload: (
        data: {
            modelName?: string;
            modelType?: CustomMLModel['modelType'];
            file: File;
            metadataFile?: File;
            description: string;
            version: number;
        },
        existingModelId?: string,
    ) => void;
    existingModel?: CustomMLModel;
}> = ({ onClose, onUpload, existingModel }) => {
    const isNewVersionMode = !!existingModel;
    const [modelName, setModelName] = useState(existingModel?.name || '');
    const [modelType, setModelType] = useState<CustomMLModel['modelType']>(existingModel?.modelType || 'LSTM');
    const [file, setFile] = useState<File | null>(null);
    const [metadataFile, setMetadataFile] = useState<File | null>(null);
    const [description, setDescription] = useState('');

    const existingMaxVer =
        existingModel && existingModel.versions.length > 0
            ? Math.max(...existingModel.versions.map((v) => v.version))
            : 0.9;
    const nextVersion = isNewVersionMode ? (existingMaxVer + 0.1).toFixed(1) : '1.0';

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!file) {
            toast.error('Please select a model binary/weights file.');
            return;
        }
        if (!description.trim() || (!modelName.trim() && !isNewVersionMode)) {
            toast.error('Model name and version notes are required.');
            return;
        }
        onUpload(
            {
                modelName: isNewVersionMode ? undefined : modelName.trim(),
                modelType: isNewVersionMode ? undefined : modelType,
                file,
                metadataFile: metadataFile || undefined,
                description: description.trim(),
                version: parseFloat(nextVersion),
            },
            existingModel?.id,
        );
        onClose();
    };

    const inputBaseClasses =
        'w-full bg-slate-50 dark:bg-[#050505]/60 border border-slate-300 dark:border-gray-700 rounded-xl p-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-primary focus:border-transparent outline-none transition-all placeholder-slate-400 dark:placeholder-gray-500';

    return (
        <div
            className="fixed inset-0 bg-black/70 dark:bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-backdrop-fade-in"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-[#050505] w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 dark:border-gray-800 flex flex-col overflow-hidden animate-modal-content-slide-down relative"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand-primary via-purple-500 to-brand-primary" />

                <div className="p-6 border-b border-slate-200 dark:border-gray-800 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-brand-primary animate-pulse" />
                        {isNewVersionMode ? `New Version: ${existingModel.name}` : 'Initialize New Model'}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors text-xl leading-none"
                    >
                        &times;
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-5">
                    {!isNewVersionMode && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                                    Model Identifier
                                </label>
                                <input
                                    type="text"
                                    value={modelName}
                                    onChange={(e) => setModelName(e.target.value)}
                                    placeholder="e.g. AlphaSeeker"
                                    className={inputBaseClasses}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                                    Architecture
                                </label>
                                <select
                                    value={modelType}
                                    onChange={(e) => setModelType(e.target.value as CustomMLModel['modelType'])}
                                    className={inputBaseClasses}
                                >
                                    <optgroup label="Indicator & Tabular Engines">
                                        <option>Random Forest</option>
                                        <option>XGBoost</option>
                                        <option>LightGBM</option>
                                        <option>CatBoost</option>
                                        <option>TabNet</option>
                                    </optgroup>
                                    <optgroup label="Trend & Sequence Memory">
                                        <option>LSTM</option>
                                        <option>GRU</option>
                                        <option>TCN</option>
                                    </optgroup>
                                    <optgroup label="Micro-Pattern & Scalping">
                                        <option>1D-CNN</option>
                                        <option>DeepLOB</option>
                                        <option>Transformer</option>
                                    </optgroup>
                                    <optgroup label="RL: Active Trading Agents">
                                        <option>PPO-RL</option>
                                        <option>SAC-RL</option>
                                        <option>A2C-RL</option>
                                        <option>DDPG-RL</option>
                                        <option>TD3-RL</option>
                                        <option>DQN-RL</option>
                                    </optgroup>
                                    <optgroup label="RL: Risk-Aware (Distributional)">
                                        <option>QR-DQN</option>
                                    </optgroup>
                                    <optgroup label="RL: Offline & Imitation">
                                        <option>CQL</option>
                                        <option>GAIL</option>
                                    </optgroup>
                                    <optgroup label="Next-Gen Architectures">
                                        <option>Decision-Transformer</option>
                                        <option>Liquid-NN</option>
                                    </optgroup>
                                    <optgroup label="Anomaly Detection">
                                        <option>Auto-Encoder</option>
                                    </optgroup>
                                    <optgroup label="Other">
                                        <option>ARIMA</option>
                                        <option>Ensemble</option>
                                        <option>Other</option>
                                    </optgroup>
                                </select>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-brand-primary/5 p-4 rounded-xl border border-brand-primary/20 border-dashed">
                            <label className="block text-xs font-bold text-brand-primary uppercase tracking-wider mb-2 text-center">
                                Upload Binary / Weights
                            </label>
                            <div className="flex flex-col items-center justify-center gap-3">
                                <label
                                    htmlFor="file-upload"
                                    className="cursor-pointer px-5 py-2.5 bg-brand-primary text-white rounded-full text-xs font-bold hover:bg-brand-primary-hover transition-all shadow-lg shadow-brand-primary/20"
                                >
                                    Choose File
                                    <input
                                        id="file-upload"
                                        name="file-upload"
                                        type="file"
                                        className="sr-only"
                                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                                    />
                                </label>
                                <span className="text-xs font-mono text-slate-500 dark:text-gray-400 text-center break-all">
                                    {file?.name || 'Supports .pkl, .h5, .onnx, .pt'}
                                </span>
                            </div>
                        </div>

                        <div className="bg-purple-500/5 p-4 rounded-xl border border-purple-500/20 border-dashed">
                            <label className="block text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider mb-2 text-center">
                                Upload Metadata (Optional)
                            </label>
                            <div className="flex flex-col items-center justify-center gap-3">
                                <label
                                    htmlFor="metadata-upload"
                                    className="cursor-pointer px-5 py-2.5 bg-purple-600 text-white rounded-full text-xs font-bold hover:bg-purple-700 transition-all shadow-lg shadow-purple-500/20"
                                >
                                    Choose JSON
                                    <input
                                        id="metadata-upload"
                                        name="metadata-upload"
                                        type="file"
                                        accept=".json"
                                        className="sr-only"
                                        onChange={(e) => setMetadataFile(e.target.files?.[0] || null)}
                                    />
                                </label>
                                <span className="text-xs font-mono text-slate-500 dark:text-gray-400 text-center break-all">
                                    {metadataFile?.name || 'metadata.json'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                            Version Notes (v{nextVersion})
                        </label>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Describe changes, e.g. 'Increased epoch count'"
                            className={inputBaseClasses}
                            required
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-gray-800">
                        <Button type="button" variant="secondary" onClick={onClose}>
                            Abort
                        </Button>
                        <Button type="submit" variant="primary" className="shadow-lg shadow-brand-primary/20">
                            Deploy to Registry
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- Signal Modal (Kept exported for ForexModelCard) ---

const formatPrice = (price: number) => {
    if (price === 0) return '0.00';
    if (price < 0.00001) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 10 });
    if (price < 0.001) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    if (price < 1) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
};

export type SignalResult = {
    signal: 'BUY' | 'SELL' | 'HOLD';
    confidence: number;
    price: number;
    symbol: string;
    algorithm: string;
    timestamp: string;
    features_used?: number;
    dataset_type?: string;
    predicted_return?: number;
    sl?: number;
    tp?: number;
};

export const SignalModal: React.FC<{
    result: SignalResult;
    modelName: string;
    onClose: () => void;
}> = ({ result, modelName, onClose }) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const cfgMap = {
        BUY: {
            outerGlow: 'shadow-emerald-500/30',
            border: 'border-emerald-500/30',
            text: 'text-emerald-600 dark:text-emerald-400',
            badge: 'bg-emerald-500/15 dark:bg-emerald-500/20 border-emerald-500/40',
            accent: 'from-emerald-500 via-teal-400 to-emerald-600',
            label: 'BUY',
            icon: '▲',
            glow: 'rgba(16,185,129,0.15)',
        },
        SELL: {
            outerGlow: 'shadow-rose-500/30',
            border: 'border-rose-500/30',
            text: 'text-rose-600 dark:text-rose-400',
            badge: 'bg-rose-500/15 dark:bg-rose-500/20 border-rose-500/40',
            accent: 'from-rose-500 via-pink-400 to-rose-600',
            label: 'SELL',
            icon: '▼',
            glow: 'rgba(244,63,94,0.15)',
        },
        HOLD: {
            outerGlow: 'shadow-amber-500/30',
            border: 'border-amber-500/30',
            text: 'text-amber-600 dark:text-amber-400',
            badge: 'bg-amber-500/15 dark:bg-amber-500/20 border-amber-500/40',
            accent: 'from-amber-500 via-yellow-400 to-amber-600',
            label: 'HOLD',
            icon: '■',
            glow: 'rgba(245,158,11,0.15)',
        },
    };

    const signalUpper = result.signal.toUpperCase();
    const isCrash = signalUpper.includes('CRASH');
    const isPump = signalUpper.includes('PUMP');
    const cfg = cfgMap[result.signal as keyof typeof cfgMap] || {
        outerGlow: isCrash ? 'shadow-rose-500/30' : isPump ? 'shadow-emerald-500/30' : 'shadow-cyan-500/30',
        border: isCrash ? 'border-rose-500/30' : isPump ? 'border-emerald-500/30' : 'border-cyan-500/30',
        text: isCrash ? 'text-rose-600 dark:text-rose-400' : isPump ? 'text-emerald-600 dark:text-emerald-400' : 'text-cyan-600 dark:text-cyan-400',
        badge: isCrash ? 'bg-rose-500/15 border-rose-500/40' : isPump ? 'bg-emerald-500/15 border-emerald-500/40' : 'bg-cyan-500/15 border-cyan-500/40',
        accent: isCrash ? 'from-rose-500 via-pink-400 to-rose-600' : isPump ? 'from-emerald-500 via-teal-400 to-emerald-600' : 'from-cyan-500 via-blue-400 to-cyan-600',
        label: result.signal.toUpperCase(),
        icon: isCrash ? '▼' : isPump ? '▲' : '⚡',
        glow: isCrash ? 'rgba(244,63,94,0.15)' : isPump ? 'rgba(16,185,129,0.15)' : 'rgba(6,182,212,0.15)',
    };

    const pct = Math.round((result.confidence || 0) * 100);
    const radius = 40;
    const circ = 2 * Math.PI * radius;
    const dash = (pct / 100) * circ;

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.75)' : 'rgba(15,23,42,0.55)', backdropFilter: 'blur(12px)' }}
            onClick={onClose}
        >
            <div
                className={`relative w-full max-w-xs rounded-3xl border ${cfg.border} shadow-2xl ${cfg.outerGlow} overflow-hidden`}
                style={{
                    background: isDark ? 'linear-gradient(135deg, #0a0a0a 60%, #111)' : 'linear-gradient(135deg, #ffffff 60%, #f8fafc)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className={`h-1 w-full bg-gradient-to-r ${cfg.accent}`} />

                <div className="relative z-10 p-7 flex flex-col items-center text-center gap-4">
                    <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-slate-500 dark:text-gray-400">{modelName}</p>

                    <div className="relative flex items-center justify-center">
                        <svg width="110" height="110" className="-rotate-90">
                            <circle cx="55" cy="55" r={radius} stroke={isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)'} strokeWidth="8" fill="none" />
                            <circle
                                cx="55"
                                cy="55"
                                r={radius}
                                stroke="url(#ringGrad)"
                                strokeWidth="8"
                                fill="none"
                                strokeLinecap="round"
                                strokeDasharray={`${dash} ${circ}`}
                                style={{ transition: 'stroke-dasharray 1s ease' }}
                            />
                            <defs>
                                <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stopColor={result.signal === 'BUY' ? '#10b981' : result.signal === 'SELL' ? '#f43f5e' : '#f59e0b'} />
                                    <stop offset="100%" stopColor={result.signal === 'BUY' ? '#2dd4bf' : result.signal === 'SELL' ? '#fb7185' : '#fbbf24'} />
                                </linearGradient>
                            </defs>
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className={`text-2xl font-black ${cfg.text}`}>{cfg.icon}</span>
                            <span className="text-xs font-bold text-slate-500 dark:text-gray-400 mt-0.5">{pct}%</span>
                        </div>
                    </div>

                    <div className={`flex items-center gap-2 px-6 py-2 rounded-full border ${cfg.badge}`}>
                        <span className={`text-2xl font-black tracking-widest ${cfg.text}`}>{cfg.label}</span>
                    </div>

                    <div className="w-full bg-slate-50 dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 p-4 space-y-2.5 text-left">
                        {[
                            { label: 'Entry Price', value: `$${formatPrice(result.price)}`, color: 'text-slate-900 dark:text-white' },
                            ...(result.tp !== undefined ? [{ label: 'Take Profit', value: `$${formatPrice(result.tp)}`, color: 'text-emerald-600 dark:text-emerald-400' }] : []),
                            ...(result.sl !== undefined ? [{ label: 'Stop Loss', value: `$${formatPrice(result.sl)}`, color: 'text-rose-600 dark:text-rose-400' }] : []),
                            ...(result.predicted_return !== undefined
                                ? [
                                      {
                                          label: 'Pred. Movement',
                                          value: `${result.predicted_return > 0 ? '+' : ''}${(result.predicted_return * 100).toFixed(2)}%`,
                                          color: result.predicted_return > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                                      },
                                  ]
                                : []),
                            { label: 'Symbol', value: result.symbol, color: 'text-slate-700 dark:text-gray-300' },
                            { label: 'Algorithm', value: result.algorithm, color: 'text-purple-600 dark:text-purple-400' },
                            ...(result.features_used ? [{ label: 'Features', value: `${result.features_used} features`, color: 'text-slate-500 dark:text-gray-400' }] : []),
                        ].map(({ label, value, color }) => (
                            <div key={label} className="flex justify-between items-center">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">{label}</span>
                                <span className={`text-xs font-mono font-bold ${color}`}>{value}</span>
                            </div>
                        ))}
                        <div className="flex justify-between items-center pt-2 border-t border-slate-200 dark:border-white/10">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">Generated</span>
                            <span className="text-[10px] font-mono text-slate-500 dark:text-gray-400">{new Date(result.timestamp).toLocaleTimeString()}</span>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="w-full py-2.5 mt-1 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-sm font-bold text-slate-700 dark:text-gray-300 transition-all"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- Shared Signal Analyzer Modal ---

const SignalSettingsModal: React.FC<{
    model: CustomMLModel;
    defaultSymbol?: string | null;
    onClose: () => void;
    onResult: (res: SignalResult, modelName: string) => void;
}> = ({ model, defaultSymbol, onClose, onResult }) => {
    const isSequenceModel = ['LSTM', 'GRU', '1D-CNN', 'DeepLOB', 'TCN', 'Transformer', 'Decision-Transformer', 'Liquid-NN'].includes(
        String(model.modelType),
    );
    const [sequenceLength, setSequenceLength] = useState<number>(isSequenceModel ? 100 : 1);
    const [symbolOverride, setSymbolOverride] = useState<string>(defaultSymbol || '');
    const [signalProgress, setSignalProgress] = useState(0);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const activeVersion = model.versions.find((v) => v.id === model.activeVersionId);

    const handleExecuteAnalysis = async () => {
        setIsAnalyzing(true);
        setSignalProgress(10);

        const interval = setInterval(() => {
            setSignalProgress((prev) => (prev >= 90 ? prev : prev + Math.random() * 14));
        }, 300);

        try {
            const result = await mlModelsService.predictSignal(
                model.id,
                symbolOverride.trim() || undefined,
                sequenceLength,
            );
            setSignalProgress(100);
            setTimeout(() => {
                clearInterval(interval);
                onResult(result, model.name);
            }, 350);
        } catch (err: any) {
            clearInterval(interval);
            setIsAnalyzing(false);
            toast.error(err?.response?.data?.detail || 'Prediction failed. Check model weights or market symbol.');
        }
    };

    return ReactDOM.createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-2xl w-full max-w-md p-6 shadow-2xl relative overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 to-orange-500" />

                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
                    <Zap className="w-5 h-5 text-amber-500" />
                    Generate Live Signal
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
                    Configure inference window &amp; target pair for <span className="font-bold text-slate-800 dark:text-white">{model.name}</span>.
                </p>

                <div className="space-y-4">
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                            Symbol Override (Optional)
                        </label>
                        <input
                            type="text"
                            value={symbolOverride}
                            onChange={(e) => setSymbolOverride(e.target.value)}
                            placeholder={defaultSymbol || 'Default trained asset (e.g. BTC/USDT)'}
                            disabled={isAnalyzing}
                            className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-amber-500"
                        />
                    </div>

                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                            Lookback Sequence Rows
                        </label>
                        <input
                            type="number"
                            min="1"
                            max="500"
                            value={sequenceLength}
                            onChange={(e) => setSequenceLength(parseInt(e.target.value, 10) || 1)}
                            disabled={isAnalyzing}
                            className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-amber-500"
                        />
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                            Sequence networks (LSTM/CNN/Transformer): 60-100 recommended. Tree models: 1 or rolling window size.
                        </p>
                    </div>

                    {isAnalyzing && (
                        <div className="pt-2">
                            <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300 mb-1.5 font-mono">
                                <span>Running Live Inference...</span>
                                <span>{Math.round(signalProgress)}%</span>
                            </div>
                            <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-300"
                                    style={{ width: `${signalProgress}%` }}
                                />
                            </div>
                            <p className="text-[11px] text-center text-slate-500 mt-2 animate-pulse">
                                Computing {activeVersion?.features?.length || 0} tracked features...
                            </p>
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-200 dark:border-slate-800">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isAnalyzing}
                        className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleExecuteAnalysis}
                        disabled={isAnalyzing}
                        className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 shadow-lg shadow-amber-500/25 disabled:opacity-50"
                    >
                        {isAnalyzing ? 'Processing...' : 'Analyze & Predict'}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
};

// --- Model Card ---

function getModelIcon(modelType: string, isRL: boolean) {
    if (modelType === 'LSTM') return <LstmIcon className="w-7 h-7" />;
    if (modelType === 'Random Forest') return <RandomForestIcon className="w-7 h-7" />;
    if (modelType === 'ARIMA') return <ArimaIcon className="w-7 h-7" />;
    if (modelType === 'Ensemble') return <Layers className="w-7 h-7 text-rose-500" />;
    if (isRL) return <OtherModelIcon className="w-7 h-7 text-amber-500" />;
    if (['XGBoost', 'LightGBM', 'CatBoost', 'TabNet'].includes(modelType)) return <Cpu className="w-7 h-7 text-purple-500" />;
    if (['Transformer', 'Decision-Transformer', 'Liquid-NN'].includes(modelType)) return <Sparkles className="w-7 h-7 text-pink-500" />;
    if (['GRU', 'TCN', '1D-CNN', 'DeepLOB'].includes(modelType)) return <Activity className="w-7 h-7 text-cyan-500" />;
    return <OtherModelIcon className="w-7 h-7 text-slate-400" />;
}

const ModelCard: React.FC<{
    model: CustomMLModel;
    compareStats?: ModelCompareItem;
    isChampion: boolean;
    isPinned: boolean;
    isRetraining: boolean;
    onDelete: (model: CustomMLModel) => void;
    onUploadVersion: (model: CustomMLModel) => void;
    onSetActiveVersion: (modelId: string, versionId: string) => void;
    onQuickRetrain: (modelId: string) => void;
    onRetrainStudio: (modelId: string) => void;
    onInspect: (modelId: string, modelName: string, tab?: InspectorTab) => void;
    onDownloadModel: (modelId: string, modelName: string) => void;
    onDownloadDataset: (modelId: string, modelName: string) => void;
    onOpenSignal: (model: CustomMLModel) => void;
    onPinToggle: (model: CustomMLModel, symbol?: string | null) => void;
    onDeploy: (model: CustomMLModel, cmp?: ModelCompareItem) => void;
    animationDelay: number;
}> = ({
    model,
    compareStats,
    isChampion,
    isPinned,
    isRetraining,
    onDelete,
    onUploadVersion,
    onSetActiveVersion,
    onQuickRetrain,
    onRetrainStudio,
    onInspect,
    onDownloadModel,
    onDownloadDataset,
    onOpenSignal,
    onPinToggle,
    onDeploy,
    animationDelay,
}) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const [isExpanded, setIsExpanded] = useState(false);

    const activeVersion = model.versions.find((v) => v.id === model.activeVersionId) || model.versions[0];
    const isReady = activeVersion?.status === 'Ready';

    const modelUpper = String(model.modelType || '').toUpperCase();
    const isRL =
        modelUpper.includes('-RL') ||
        modelUpper.includes('RL-BASED MOE') ||
        ['QR-DQN', 'CQL', 'GAIL', 'DECISION-TRANSFORMER', 'LIQUID-NN'].includes(modelUpper);
    const predTarget = String(activeVersion?.explainability?.prediction_target || '').toLowerCase();
    const isClassification =
        !!activeVersion?.explainability?.confusionMatrix ||
        ['classification', 'multi_task', 'advanced_setup', 'smc_dynamic_mtf'].includes(predTarget);
    const isRegression = !isRL && !isClassification && !!activeVersion?.explainability;

    let accLabel = 'Accuracy';
    let f1Label = 'F1 Score';
    if (isRL) {
        accLabel = 'Win Rate';
        f1Label = 'Sharpe Ratio';
    } else if (isRegression) {
        accLabel = 'R2 Score';
        f1Label = 'MSE / RMSE';
    }

    const rawAccuracy = activeVersion?.accuracy;
    let accuracyDisplay = '--';
    if (rawAccuracy !== undefined && rawAccuracy !== null) {
        accuracyDisplay = isRegression ? rawAccuracy.toFixed(3) : `${(rawAccuracy * 100).toFixed(1)}%`;
    }

    const rawF1 = activeVersion?.f1_score;
    let f1Display = '--';
    if (rawF1 !== undefined && rawF1 !== null) {
        f1Display = isRegression && rawF1 < 0.001 && rawF1 > 0 ? rawF1.toExponential(2) : rawF1.toFixed(4);
    }

    const rawLatency = activeVersion?.latency;
    const latencyDisplay = rawLatency !== undefined && rawLatency !== null ? `${Math.round(rawLatency)}ms` : '--';

    return (
        <div
            className="group relative rounded-3xl overflow-hidden transition-all duration-300 animate-fade-in-slide-up flex flex-col"
            style={{
                animationDelay: `${animationDelay}ms`,
                background: isDark
                    ? 'linear-gradient(145deg, rgba(15,20,30,0.7) 0%, rgba(5,10,15,0.88) 100%)'
                    : 'linear-gradient(145deg, rgba(255,255,255,0.97) 0%, rgba(248,250,252,0.97) 100%)',
                boxShadow: isDark
                    ? '0 0 0 1px rgba(255,255,255,0.06), 0 16px 35px -10px rgba(0,0,0,0.5)'
                    : '0 0 0 1px rgba(15,23,42,0.08), 0 12px 30px -10px rgba(15,23,42,0.08)',
                backdropFilter: 'blur(16px)',
            }}
        >
            <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-cyan-500/60 to-transparent opacity-60 group-hover:opacity-100 transition-opacity" />

            <div className="p-5 flex-1 flex flex-col">
                {/* Header */}
                <div className="flex justify-between items-start gap-3 mb-4">
                    <div className="flex items-start gap-3.5 min-w-0">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500/10 to-purple-600/10 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                            {getModelIcon(String(model.modelType), isRL)}
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h3
                                    onClick={() => onInspect(model.id, model.name, 'config')}
                                    className="text-lg font-extrabold text-slate-900 dark:text-white group-hover:text-cyan-600 dark:group-hover:text-cyan-300 transition-colors tracking-tight truncate cursor-pointer"
                                >
                                    {model.name}
                                </h3>
                                {isChampion && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/35">
                                        <Trophy className="w-2.5 h-2.5" /> Champion
                                    </span>
                                )}
                                {isPinned && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/35">
                                        <Pin className="w-2.5 h-2.5" /> Pinned
                                    </span>
                                )}
                            </div>

                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                <span className="px-2 py-0.5 bg-slate-100 dark:bg-white/5 rounded-md text-[10px] font-bold uppercase text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-white/10">
                                    {model.modelType}
                                </span>
                                <span className="px-2 py-0.5 bg-cyan-500/10 rounded-md text-[10px] font-mono font-bold text-cyan-700 dark:text-cyan-400 border border-cyan-500/20">
                                    v{activeVersion?.version?.toFixed(1) || '1.0'}
                                </span>
                                <StatusPill status={activeVersion?.status || 'Error'} />
                            </div>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(model);
                        }}
                        className="w-9 h-9 rounded-full bg-slate-100 dark:bg-white/5 hover:bg-rose-500/15 flex items-center justify-center text-slate-400 hover:text-rose-500 transition-all shrink-0"
                        title="Delete Model"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>

                {/* Market & Optuna Context Row */}
                {(compareStats?.symbol || (compareStats?.optuna_trials_count ?? 0) > 0 || activeVersion?.explainability?.prediction_target) && (
                    <div className="flex flex-wrap items-center gap-1.5 mb-4 text-[10px] font-mono">
                        {compareStats?.symbol && (
                            <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20 font-bold">
                                {compareStats.symbol} • {compareStats.timeframe || '1h'}
                            </span>
                        )}
                        {compareStats?.data_source && (
                            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-white/10">
                                {compareStats.data_source}
                            </span>
                        )}
                        {(compareStats?.optuna_trials_count ?? 0) > 0 && (
                            <button
                                type="button"
                                onClick={() => onInspect(model.id, model.name, 'optuna')}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/25 hover:bg-purple-500/20 font-bold"
                            >
                                <Sparkles className="w-2.5 h-2.5" /> {compareStats!.optuna_trials_count} Optuna
                            </button>
                        )}
                        {activeVersion?.explainability?.prediction_target && (
                            <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 font-bold uppercase">
                                {activeVersion.explainability.prediction_target}
                            </span>
                        )}
                    </div>
                )}

                {/* Primary Metrics Grid */}
                <div className="grid grid-cols-3 gap-2.5 mb-3">
                    <div className="bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.06] rounded-xl p-2.5 text-center">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 mb-0.5">
                            {accLabel}
                        </span>
                        <span className="text-sm font-mono font-bold text-emerald-600 dark:text-emerald-400">{accuracyDisplay}</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.06] rounded-xl p-2.5 text-center">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 mb-0.5">
                            {f1Label}
                        </span>
                        <span className="text-sm font-mono font-bold text-blue-600 dark:text-blue-400">{f1Display}</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.06] rounded-xl p-2.5 text-center">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 mb-0.5">
                            Latency
                        </span>
                        <span className="text-sm font-mono font-bold text-purple-600 dark:text-purple-400">{latencyDisplay}</span>
                    </div>
                </div>

                {/* OOS Backtest Strip (when available) */}
                {compareStats && (compareStats.profit_pct != null || compareStats.win_rate != null || compareStats.max_drawdown != null) && (
                    <div className="grid grid-cols-4 gap-2 px-3 py-2 mb-4 rounded-xl bg-emerald-500/5 dark:bg-white/[0.02] border border-emerald-500/20 dark:border-white/10 text-center">
                        <div>
                            <span className="block text-[9px] uppercase text-slate-500 dark:text-gray-400 font-bold">OOS Ret</span>
                            <span
                                className={`text-xs font-mono font-bold ${
                                    (compareStats.profit_pct ?? 0) >= 0
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-rose-600 dark:text-rose-400'
                                }`}
                            >
                                {compareStats.profit_pct != null
                                    ? `${compareStats.profit_pct >= 0 ? '+' : ''}${compareStats.profit_pct.toFixed(1)}%`
                                    : '--'}
                            </span>
                        </div>
                        <div>
                            <span className="block text-[9px] uppercase text-slate-500 dark:text-gray-400 font-bold">BT WR</span>
                            <span className="text-xs font-mono font-bold text-cyan-700 dark:text-cyan-300">
                                {compareStats.win_rate != null ? `${compareStats.win_rate.toFixed(1)}%` : '--'}
                            </span>
                        </div>
                        <div>
                            <span className="block text-[9px] uppercase text-slate-500 dark:text-gray-400 font-bold">Max DD</span>
                            <span className="text-xs font-mono font-bold text-rose-600 dark:text-rose-400">
                                {compareStats.max_drawdown != null ? `-${compareStats.max_drawdown.toFixed(1)}%` : '--'}
                            </span>
                        </div>
                        <div>
                            <span className="block text-[9px] uppercase text-slate-500 dark:text-gray-400 font-bold">Kelly</span>
                            <span className="text-xs font-mono font-bold text-purple-600 dark:text-purple-300">
                                {compareStats.kelly_pct != null ? `${compareStats.kelly_pct.toFixed(1)}%` : '--'}
                            </span>
                        </div>
                    </div>
                )}

                {/* Primary Actions */}
                <div className="mt-auto space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                        <button
                            type="button"
                            onClick={() => onInspect(model.id, model.name, 'config')}
                            className="px-2.5 py-2 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/25 text-[10px] font-bold uppercase tracking-wider transition-all"
                        >
                            Inspector
                        </button>
                        <button
                            type="button"
                            onClick={() => onInspect(model.id, model.name, 'replay')}
                            className="inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/25 text-[10px] font-bold uppercase tracking-wider transition-all"
                        >
                            <Play className="w-3 h-3" />
                            Replay
                        </button>
                        <button
                            type="button"
                            disabled={!isReady}
                            onClick={() => onOpenSignal(model)}
                            className="inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-40"
                        >
                            <Zap className="w-3 h-3" />
                            Signal
                        </button>
                    </div>

                    {/* Execution & MLOps Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2 border-t border-slate-200/80 dark:border-white/[0.06]">
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                disabled={!isReady}
                                onClick={() => onDeploy(model, compareStats)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600/10 hover:bg-blue-600/20 text-blue-700 dark:text-blue-300 border border-blue-500/30 text-[10px] font-bold disabled:opacity-40"
                                title="Deploy this AI model to Bot Lab"
                            >
                                <Rocket className="w-3 h-3" /> Deploy
                            </button>

                            <button
                                type="button"
                                disabled={!isReady}
                                onClick={() => onPinToggle(model, compareStats?.symbol)}
                                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold disabled:opacity-40 transition-colors ${
                                    isPinned
                                        ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40'
                                        : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-gray-300 border-slate-200 dark:border-white/10 hover:border-emerald-500/35'
                                }`}
                                title={isPinned ? 'Unpin Manual Trade AI Filter' : 'Pin as Manual Trade AI Filter'}
                            >
                                <Pin className="w-3 h-3" /> {isPinned ? 'Pinned' : 'Pin'}
                            </button>
                        </div>

                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                disabled={isRetraining}
                                onClick={() => onQuickRetrain(model.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-500/25 text-[10px] font-bold disabled:opacity-40"
                                title="1-Click Incremental Retrain"
                            >
                                <RotateCcw className={`w-3 h-3 ${isRetraining ? 'animate-spin' : ''}`} />
                                Retrain
                            </button>

                            <button
                                type="button"
                                onClick={() => onRetrainStudio(model.id)}
                                className="px-2 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-600 dark:text-gray-300 border border-slate-200 dark:border-white/10 text-[10px] font-bold"
                                title="Open in Training Studio"
                            >
                                Studio
                            </button>

                            <button
                                type="button"
                                disabled={!isReady}
                                onClick={() => onDownloadModel(model.id, model.name)}
                                className="p-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/25 disabled:opacity-40"
                                title="Download Model Bundle (.zip)"
                            >
                                <Download className="w-3.5 h-3.5" />
                            </button>

                            <button
                                type="button"
                                onClick={() => onDownloadDataset(model.id, model.name)}
                                className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25"
                                title="Download Dataset Snapshot (.csv)"
                            >
                                <Database className="w-3.5 h-3.5" />
                            </button>

                            <button
                                type="button"
                                onClick={() => setIsExpanded((v) => !v)}
                                className={`px-2 py-1.5 rounded-lg border text-[10px] font-bold transition-colors ${
                                    isExpanded
                                        ? 'bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-500/40'
                                        : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-gray-300 border-slate-200 dark:border-white/10'
                                }`}
                                title="Version History"
                            >
                                v{model.versions.length} {isExpanded ? '▲' : '▼'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Expandable Version History */}
            <div className={`transition-all duration-300 overflow-hidden ${isExpanded ? 'max-h-80 opacity-100 border-t border-slate-200 dark:border-white/10' : 'max-h-0 opacity-0'}`}>
                <div className="p-4 space-y-2.5 bg-slate-50 dark:bg-black/40 overflow-y-auto max-h-72 custom-scrollbar">
                    {model.versions.map((version) => (
                        <div
                            key={version.id}
                            className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/10"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <div
                                    className={`w-1.5 h-8 rounded-full shrink-0 ${
                                        version.id === model.activeVersionId ? 'bg-cyan-500' : 'bg-slate-300 dark:bg-gray-700'
                                    }`}
                                />
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono font-bold text-xs text-slate-900 dark:text-white">
                                            v{version.version.toFixed(1)}
                                        </span>
                                        {version.id === model.activeVersionId && (
                                            <span className="text-[9px] font-black bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 px-1.5 py-0.5 rounded border border-cyan-500/30">
                                                ACTIVE
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-slate-500 dark:text-gray-400 truncate max-w-[180px]">
                                        {version.description}
                                    </p>
                                </div>
                            </div>

                            {version.status === 'Ready' && version.id !== model.activeVersionId ? (
                                <button
                                    type="button"
                                    onClick={() => onSetActiveVersion(model.id, version.id)}
                                    className="px-3 py-1 bg-slate-100 dark:bg-white/5 hover:bg-cyan-500/20 text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-bold uppercase"
                                >
                                    Activate
                                </button>
                            ) : (
                                <span className="text-[10px] text-slate-500 dark:text-gray-400 font-mono">
                                    {new Date(version.uploadDate).toLocaleDateString()}
                                </span>
                            )}
                        </div>
                    ))}

                    <button
                        type="button"
                        onClick={() => onUploadVersion(model)}
                        className="w-full py-2.5 border border-dashed border-slate-300 dark:border-white/15 rounded-xl text-xs font-bold text-slate-600 dark:text-gray-300 hover:text-cyan-600 dark:hover:text-cyan-300 hover:border-cyan-500/40 transition-all"
                    >
                        + Upload New Version
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- Active Training Jobs Section ---

const ActiveTrainingJobsSection: React.FC<{
    jobs: any[];
    onCancel: (id: string) => void;
    onPause: (id: string) => void;
    onResume: (id: string) => void;
    onVisualize?: (job: any) => void;
}> = ({ jobs, onCancel, onPause, onResume, onVisualize }) => {
    if (!jobs || jobs.length === 0) return null;

    return (
        <div className="bg-white/90 dark:bg-[#0A0A0A]/70 backdrop-blur-lg border border-cyan-500/30 p-5 rounded-2xl shadow-lg">
            <h3 className="text-sm font-black text-cyan-700 dark:text-cyan-400 uppercase tracking-widest flex items-center gap-2 mb-4">
                <Cpu className="w-4 h-4 animate-spin" />
                Active Celery Training Jobs ({jobs.length})
            </h3>
            <div className="space-y-3">
                {jobs.map((job) => {
                    const pct = Math.min(100, Math.max(0, job.progress || 0));
                    return (
                        <div
                            key={job.id}
                            className="relative bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl p-4 overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-cyan-500/10 transition-all duration-500" style={{ width: `${pct}%` }} />
                            <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                <div className="flex-1 w-full">
                                    <div className="flex items-center gap-2.5 mb-1 flex-wrap">
                                        <span className="text-sm font-bold text-slate-900 dark:text-white">{job.symbol}</span>
                                        <span className="text-[10px] font-black text-cyan-700 dark:text-cyan-300 bg-cyan-500/15 px-2 py-0.5 rounded border border-cyan-500/30 uppercase">
                                            {job.algorithm}
                                        </span>
                                        <span className="text-[10px] font-mono text-slate-500">{job.id}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 h-1.5 bg-slate-200 dark:bg-gray-800 rounded-full overflow-hidden">
                                            <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${pct}%` }} />
                                        </div>
                                        <span className="text-xs font-mono font-bold text-cyan-700 dark:text-cyan-400 w-10 text-right">
                                            {pct.toFixed(0)}%
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1.5 font-mono truncate max-w-2xl">
                                        {job.logs && job.logs.length > 0 ? job.logs[job.logs.length - 1] : 'Initializing...'}
                                    </p>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    {String(job.algorithm || '').includes('-RL') && onVisualize && (
                                        <button
                                            type="button"
                                            onClick={() => onVisualize(job)}
                                            className="px-3 py-1.5 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 rounded-lg text-xs font-bold hover:bg-cyan-500/20"
                                        >
                                            Live Visualizer
                                        </button>
                                    )}
                                    {job.status === 'PAUSED' || job.status === 'FAILED' ? (
                                        <button
                                            type="button"
                                            onClick={() => onResume(job.id)}
                                            className="px-3 py-1.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-bold hover:bg-emerald-500/20"
                                        >
                                            {job.status === 'FAILED' ? 'Retry' : 'Resume'}
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => onPause(job.id)}
                                            className="px-3 py-1.5 bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 rounded-lg text-xs font-bold hover:bg-amber-500/20"
                                        >
                                            Pause
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => onCancel(job.id)}
                                        className="px-3 py-1.5 bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/30 rounded-lg text-xs font-bold hover:bg-rose-500/20"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// --- Main Page ---

const CustomMLModels: React.FC<{ onNavigate?: (view: AppView, section?: string) => void }> = ({ onNavigate }) => {
    const queryClient = useQueryClient();
    const folderInputRef = useRef<HTMLInputElement>(null);

    const [modalState, setModalState] = useState<{ isOpen: boolean; modelToUpdate?: CustomMLModel }>({ isOpen: false });
    const [inspectorState, setInspectorState] = useState<{
        isOpen: boolean;
        modelId: string;
        modelName: string;
        tab: InspectorTab;
    }>({ isOpen: false, modelId: '', modelName: '', tab: 'config' });

    const [compareOpen, setCompareOpen] = useState(false);
    const [visualizingJob, setVisualizingJob] = useState<any | null>(null);
    const [signalTargetModel, setSignalTargetModel] = useState<CustomMLModel | null>(null);
    const [signalModalResult, setSignalModalResult] = useState<{ result: SignalResult; modelName: string } | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<CustomMLModel | null>(null);
    const [deployTarget, setDeployTarget] = useState<{
        modelId: string;
        symbol: string;
        timeframe: string;
    } | null>(null);
    const [retrainingModelId, setRetrainingModelId] = useState<string | null>(null);

    // Toolbar State
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState<RegistryFilter>('all');
    const [sortBy, setSortBy] = useState<RegistrySort>('newest');
    const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

    // Fetch Registered Models
    const {
        data: models = [],
        isLoading,
        isFetching: isFetchingModels,
        refetch: refetchModels,
    } = useQuery({
        queryKey: ['mlModels'],
        queryFn: mlModelsService.getModels,
        refetchInterval: (query) => {
            const currentModels = query.state.data || [];
            const isProcessing = currentModels.some((m: CustomMLModel) =>
                m.versions.some((v: ModelVersion) => v.status === 'Processing'),
            );
            return isProcessing ? 5000 : false;
        },
        refetchOnWindowFocus: false,
    });

    // Fetch Quant Telemetry / Compare Matrix
    const { data: compareList = [], refetch: refetchCompare } = useQuery({
        queryKey: ['mlCompareTelemetry'],
        queryFn: () => trainingStudioToolsService.compareModels().catch(() => [] as ModelCompareItem[]),
        refetchOnWindowFocus: false,
    });

    // Fetch Pinned Manual Trade Filter
    const { data: pinnedModel = null } = useQuery({
        queryKey: ['pinnedManualTradeModel'],
        queryFn: () => trainingStudioToolsService.getPinnedManualTradeModel().catch(() => null),
        refetchOnWindowFocus: false,
    });

    // Fetch Active Training Jobs
    const { data: activeJobs = [] } = useQuery({
        queryKey: ['activeTrainingJobs'],
        queryFn: mlTrainingService.getJobs,
        refetchInterval: (query) => {
            const jobs = query.state.data || [];
            const hasActive = jobs.some((j: any) => j.status === 'PENDING' || j.status === 'RUNNING');
            return hasActive ? 2000 : false;
        },
        refetchOnWindowFocus: false,
        select: (jobs) =>
            jobs.filter(
                (j: any) =>
                    j.status === 'PENDING' ||
                    j.status === 'RUNNING' ||
                    j.status === 'PAUSED' ||
                    (j.status === 'FAILED' && j.error_message?.includes('Server restarted')),
            ),
    });

    const compareMap = useMemo(() => {
        const map: Record<string, ModelCompareItem> = {};
        for (const item of compareList) {
            map[item.model_id] = item;
        }
        return map;
    }, [compareList]);

    // Fleet KPIs
    const telemetry = useMemo(() => {
        let ready = 0;
        let processing = 0;
        let error = 0;
        const accValues: number[] = [];
        const latencyValues: number[] = [];

        for (const m of models) {
            const av = m.versions.find((v) => v.id === m.activeVersionId) || m.versions[0];
            if (av?.status === 'Ready') ready += 1;
            else if (av?.status === 'Processing') processing += 1;
            else if (av?.status === 'Error') error += 1;

            if (typeof av?.accuracy === 'number' && Number.isFinite(av.accuracy)) {
                accValues.push(av.accuracy <= 1 ? av.accuracy * 100 : av.accuracy);
            }
            if (typeof av?.latency === 'number' && Number.isFinite(av.latency)) {
                latencyValues.push(av.latency);
            }
        }

        const avgAccuracyPct =
            accValues.length > 0 ? accValues.reduce((s, v) => s + v, 0) / accValues.length : null;
        const avgLatencyMs =
            latencyValues.length > 0 ? latencyValues.reduce((s, v) => s + v, 0) / latencyValues.length : null;

        const backtested = compareList.filter((c) => typeof c.profit_pct === 'number' && Number.isFinite(c.profit_pct));
        const championModel =
            backtested.length > 0
                ? backtested.reduce((best, cur) => ((cur.profit_pct ?? -Infinity) > (best.profit_pct ?? -Infinity) ? cur : best))
                : null;

        return { ready, processing, error, avgAccuracyPct, avgLatencyMs, championModel };
    }, [models, compareList]);

    // Filter + Sort models
    const filteredModels = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        const filtered = models.filter((m) => {
            const av = m.versions.find((v) => v.id === m.activeVersionId) || m.versions[0];
            const cmp = compareMap[m.id];
            const isForex =
                m.marketType === 'forex' ||
                m.name.toLowerCase().includes('forex') ||
                (m.datasetPath && m.datasetPath.toLowerCase().includes('forex'));

            if (activeFilter === 'ready' && av?.status !== 'Ready') return false;
            if (activeFilter === 'processing' && av?.status !== 'Processing') return false;
            if (activeFilter === 'error' && av?.status !== 'Error') return false;
            if (activeFilter === 'forex' && !isForex) return false;
            if (activeFilter === 'crypto' && isForex) return false;
            if (activeFilter === 'pinned' && pinnedModel?.model_id !== m.id) return false;
            if (activeFilter === 'backtested' && typeof cmp?.profit_pct !== 'number') return false;

            if (!q) return true;
            const featureHit = (cmp?.top_features ?? []).some((f) => f.name.toLowerCase().includes(q));
            return (
                m.name.toLowerCase().includes(q) ||
                String(m.modelType).toLowerCase().includes(q) ||
                (cmp?.symbol || '').toLowerCase().includes(q) ||
                (cmp?.timeframe || '').toLowerCase().includes(q) ||
                (av?.description || '').toLowerCase().includes(q) ||
                featureHit
            );
        });

        const getNum = (val: number | null | undefined, fallback: number) =>
            typeof val === 'number' && Number.isFinite(val) ? val : fallback;

        return [...filtered].sort((a, b) => {
            const avA = a.versions.find((v) => v.id === a.activeVersionId) || a.versions[0];
            const avB = b.versions.find((v) => v.id === b.activeVersionId) || b.versions[0];
            const cmpA = compareMap[a.id];
            const cmpB = compareMap[b.id];

            switch (sortBy) {
                case 'profit_desc':
                    return getNum(cmpB?.profit_pct, -Infinity) - getNum(cmpA?.profit_pct, -Infinity);
                case 'accuracy_desc': {
                    const accA = getNum(avA?.accuracy ?? cmpA?.accuracy, -Infinity);
                    const accB = getNum(avB?.accuracy ?? cmpB?.accuracy, -Infinity);
                    return accB - accA;
                }
                case 'sharpe_desc':
                    return getNum(avB?.f1_score ?? cmpB?.f1_score, -Infinity) - getNum(avA?.f1_score ?? cmpA?.f1_score, -Infinity);
                case 'dd_asc':
                    return getNum(cmpA?.max_drawdown, Infinity) - getNum(cmpB?.max_drawdown, Infinity);
                case 'latency_asc':
                    return getNum(avA?.latency ?? cmpA?.latency, Infinity) - getNum(avB?.latency ?? cmpB?.latency, Infinity);
                case 'name_asc':
                    return a.name.localeCompare(b.name);
                case 'newest':
                default: {
                    const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
                    const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
                    return tB - tA;
                }
            }
        });
    }, [models, searchQuery, activeFilter, sortBy, compareMap, pinnedModel]);

    // Mutations
    const createMutation = useMutation({
        mutationFn: (data: any) =>
            mlModelsService.createModel(data.modelName!, data.modelType!, data.version, data.description, data.file, data.metadataFile),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['mlModels'] });
            queryClient.invalidateQueries({ queryKey: ['mlCompareTelemetry'] });
            toast.success('Model created and processing started!');
        },
        onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to create model'),
    });

    const uploadVersionMutation = useMutation({
        mutationFn: ({ modelId, data }: { modelId: string; data: any }) =>
            mlModelsService.uploadVersion(modelId, data.version, data.description, data.file, data.metadataFile),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['mlModels'] });
            toast.success('New version uploaded!');
        },
        onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to upload version'),
    });

    const uploadFolderMutation = useMutation({
        mutationFn: (files: File[]) => mlModelsService.uploadFolder(files),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['mlModels'] });
            queryClient.invalidateQueries({ queryKey: ['mlCompareTelemetry'] });
            toast.success('Folder uploaded and synced successfully!');
        },
        onError: (error: any) => toast.error(error?.response?.data?.detail || 'Failed to upload folder'),
    });

    const setVersionMutation = useMutation({
        mutationFn: ({ modelId, versionId }: { modelId: string; versionId: string }) =>
            mlModelsService.setActiveVersion(modelId, versionId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['mlModels'] });
            queryClient.invalidateQueries({ queryKey: ['mlCompareTelemetry'] });
            toast.success('Active version updated');
        },
        onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to set active version'),
    });

    const deleteMutation = useMutation({
        mutationFn: mlModelsService.deleteModel,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['mlModels'] });
            queryClient.invalidateQueries({ queryKey: ['mlCompareTelemetry'] });
            queryClient.invalidateQueries({ queryKey: ['pinnedManualTradeModel'] });
            toast.success('Model deleted');
            setDeleteTarget(null);
        },
        onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to delete model'),
    });

    const cancelJobMutation = useMutation({
        mutationFn: mlTrainingService.cancelTraining,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['activeTrainingJobs'] });
            toast.success('Training job cancelled');
        },
        onError: () => toast.error('Failed to cancel job'),
    });

    const pauseJobMutation = useMutation({
        mutationFn: mlTrainingService.pauseTraining,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['activeTrainingJobs'] });
            toast.success('Training job paused');
        },
        onError: () => toast.error('Failed to pause job'),
    });

    const resumeJobMutation = useMutation({
        mutationFn: mlTrainingService.resumeTraining,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['activeTrainingJobs'] });
            toast.success('Training job resumed');
        },
        onError: () => toast.error('Failed to resume job'),
    });

    const handleUpload = (
        data: {
            modelName?: string;
            modelType?: CustomMLModel['modelType'];
            file: File;
            metadataFile?: File;
            description: string;
            version: number;
        },
        existingModelId?: string,
    ) => {
        if (existingModelId) {
            uploadVersionMutation.mutate({ modelId: existingModelId, data });
        } else {
            createMutation.mutate(data);
        }
    };

    const handleFolderUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files.length > 0) {
            const filesArray = Array.from(event.target.files).filter((f) => !f.name.startsWith('.'));
            uploadFolderMutation.mutate(filesArray);
        }
        if (folderInputRef.current) {
            folderInputRef.current.value = '';
        }
    };

    const handleQuickRetrain = async (modelId: string) => {
        if (retrainingModelId) return;
        setRetrainingModelId(modelId);
        try {
            const res = await trainingStudioToolsService.triggerOneClickRetrain(modelId);
            toast.success(`1-Click Retrain queued (${res.symbol} ${res.timeframe})`);
            queryClient.invalidateQueries({ queryKey: ['activeTrainingJobs'] });
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || '1-Click Retrain unavailable; opening Training Studio.');
            if (onNavigate) onNavigate(AppView.MODEL_TRAINING_STUDIO, modelId);
        } finally {
            setRetrainingModelId(null);
        }
    };

    const handleRetrainStudio = (modelId: string) => {
        if (onNavigate) {
            onNavigate(AppView.MODEL_TRAINING_STUDIO, modelId);
        } else {
            toast.error('Navigation not available');
        }
    };

    const handlePinToggle = async (model: CustomMLModel) => {
        try {
            if (pinnedModel?.model_id === model.id) {
                await trainingStudioToolsService.unpinManualTradeModel();
                toast.success(`Unpinned ${model.name} from Manual Trade Filter`);
            } else {
                await trainingStudioToolsService.pinManualTradeModel({
                    model_id: model.id,
                    min_confidence: 0.65,
                    enabled: true,
                });
                toast.success(`Pinned ${model.name} as Manual Trade AI Filter (65% min conf)`);
            }
            queryClient.invalidateQueries({ queryKey: ['pinnedManualTradeModel'] });
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Failed to update Manual Trade pin');
        }
    };

    const handleUnpin = async () => {
        try {
            await trainingStudioToolsService.unpinManualTradeModel();
            queryClient.invalidateQueries({ queryKey: ['pinnedManualTradeModel'] });
            toast.success('Manual Trade AI Filter unpinned');
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Failed to unpin model');
        }
    };

    const handleOpenDeploy = (model: CustomMLModel, cmp?: ModelCompareItem) => {
        setDeployTarget({
            modelId: model.id,
            symbol: cmp?.symbol || 'BTC/USDT',
            timeframe: cmp?.timeframe || '15m',
        });
    };

    const handleOpenDeployById = (modelId: string, symbol?: string, timeframe?: string) => {
        const cmp = compareMap[modelId];
        setDeployTarget({
            modelId,
            symbol: symbol || cmp?.symbol || 'BTC/USDT',
            timeframe: timeframe || cmp?.timeframe || '15m',
        });
    };

    const handleDownloadModel = async (modelId: string, modelName: string) => {
        try {
            await mlModelsService.downloadModel(modelId, modelName);
            toast.success('Model bundle download started');
        } catch (error: any) {
            toast.error(error?.response?.data?.detail || 'Model bundle not available for download.');
        }
    };

    const handleDownloadDataset = async (modelId: string, modelName: string) => {
        try {
            await mlModelsService.downloadDataset(modelId, modelName);
            toast.success('Dataset download started');
        } catch (error: any) {
            toast.error(error?.response?.data?.detail || 'Dataset snapshot not available for this version.');
        }
    };

    return (
        <div className="relative min-h-full">
            <NeuralMeshBackground />

            {/* Hidden Folder Input */}
            <input
                type="file"
                ref={folderInputRef}
                style={{ display: 'none' }}
                // @ts-ignore
                webkitdirectory=""
                directory=""
                multiple
                onChange={handleFolderUpload}
            />

            {modalState.isOpen && (
                <UploadModelModal
                    onClose={() => setModalState({ isOpen: false })}
                    onUpload={handleUpload}
                    existingModel={modalState.modelToUpdate}
                />
            )}

            {inspectorState.isOpen && (
                <ModelInspectorModal
                    modelId={inspectorState.modelId}
                    modelName={inspectorState.modelName}
                    initialTab={inspectorState.tab}
                    onClose={() => setInspectorState((prev) => ({ ...prev, isOpen: false }))}
                    onDeployModel={(id, sym, tf) => {
                        setInspectorState((prev) => ({ ...prev, isOpen: false }));
                        handleOpenDeployById(id, sym, tf);
                    }}
                    onRetrainStudio={handleRetrainStudio}
                    onRetrainSuccess={() => queryClient.invalidateQueries({ queryKey: ['activeTrainingJobs'] })}
                />
            )}

            <ModelComparisonModal
                isOpen={compareOpen}
                onClose={() => setCompareOpen(false)}
                onOpenDeploy={(id) => {
                    setCompareOpen(false);
                    handleOpenDeployById(id);
                }}
                onRetrainSuccess={() => queryClient.invalidateQueries({ queryKey: ['activeTrainingJobs'] })}
            />

            {signalTargetModel && (
                <SignalSettingsModal
                    model={signalTargetModel}
                    defaultSymbol={compareMap[signalTargetModel.id]?.symbol}
                    onClose={() => setSignalTargetModel(null)}
                    onResult={(res, name) => {
                        setSignalTargetModel(null);
                        setSignalModalResult({ result: res, modelName: name });
                    }}
                />
            )}

            {signalModalResult &&
                ReactDOM.createPortal(
                    <SignalModal
                        result={signalModalResult.result}
                        modelName={signalModalResult.modelName}
                        onClose={() => setSignalModalResult(null)}
                    />,
                    document.body,
                )}

            {deployTarget && (
                <AIModelDeploymentModal
                    isOpen={true}
                    onClose={() => setDeployTarget(null)}
                    symbol={deployTarget.symbol}
                    exchange="binance"
                    initialModelId={deployTarget.modelId}
                    initialTimeframe={deployTarget.timeframe}
                    onDeploySuccess={() => {
                        if (onNavigate) onNavigate(AppView.BOT_LAB);
                    }}
                />
            )}

            {visualizingJob && (
                <RLTrainingVisualizer
                    isOpen={true}
                    onClose={() => setVisualizingJob(null)}
                    jobId={visualizingJob.id}
                    algorithm={visualizingJob.algorithm}
                    symbol={visualizingJob.symbol}
                />
            )}

            {/* Safe Delete Confirmation Modal */}
            {deleteTarget &&
                ReactDOM.createPortal(
                    <div
                        className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm"
                        onClick={() => setDeleteTarget(null)}
                    >
                        <div
                            className="bg-white dark:bg-[#0B1121] border border-slate-200 dark:border-rose-500/30 rounded-2xl max-w-md w-full p-6 shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Delete Registered Model?</h3>
                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-5">
                                This permanently removes <span className="font-bold text-rose-500">{deleteTarget.name}</span> and all saved version weights/metadata from storage. This cannot be undone.
                            </p>
                            <div className="flex justify-end gap-2.5">
                                <button
                                    type="button"
                                    onClick={() => setDeleteTarget(null)}
                                    className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    disabled={deleteMutation.isPending}
                                    onClick={() => deleteMutation.mutate(deleteTarget.id)}
                                    className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50"
                                >
                                    {deleteMutation.isPending ? 'Deleting...' : 'Delete Permanently'}
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}

            <div className="relative z-10 flex flex-col gap-6 pb-8">
                <RegistryHeader
                    totalModels={models.length}
                    readyCount={telemetry.ready}
                    processingCount={telemetry.processing}
                    errorCount={telemetry.error}
                    avgAccuracyPct={telemetry.avgAccuracyPct}
                    avgLatencyMs={telemetry.avgLatencyMs}
                    championModel={telemetry.championModel}
                    pinnedModel={pinnedModel}
                    activeJobsCount={activeJobs.length}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    activeFilter={activeFilter}
                    onFilterChange={setActiveFilter}
                    sortBy={sortBy}
                    onSortChange={setSortBy}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    isUploadingFolder={uploadFolderMutation.isPending}
                    onTriggerFolderUpload={() => folderInputRef.current?.click()}
                    onOpenNewModel={() => setModalState({ isOpen: true })}
                    onOpenCompare={() => setCompareOpen(true)}
                    onUnpinModel={handleUnpin}
                    onRefresh={() => {
                        void refetchModels();
                        void refetchCompare();
                    }}
                    isRefreshing={isFetchingModels}
                />

                <ActiveTrainingJobsSection
                    jobs={activeJobs}
                    onCancel={(id) => cancelJobMutation.mutate(id)}
                    onPause={(id) => pauseJobMutation.mutate(id)}
                    onResume={(id) => resumeJobMutation.mutate(id)}
                    onVisualize={setVisualizingJob}
                />

                {isLoading ? (
                    <div className="flex justify-center py-20">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary" />
                    </div>
                ) : filteredModels.length === 0 && models.length > 0 ? (
                    <div className="bg-white/80 dark:bg-[#0A0A0A]/60 border border-dashed border-slate-300 dark:border-white/15 rounded-2xl p-12 text-center">
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-300">No models match your current filter.</p>
                        <button
                            type="button"
                            onClick={() => {
                                setSearchQuery('');
                                setActiveFilter('all');
                            }}
                            className="mt-3 px-4 py-2 rounded-xl text-xs font-bold bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30"
                        >
                            Reset Filters
                        </button>
                    </div>
                ) : viewMode === 'table' ? (
                    <RegistryTableView
                        models={filteredModels}
                        compareMap={compareMap}
                        championId={telemetry.championModel?.model_id}
                        pinnedModelId={pinnedModel?.model_id}
                        retrainingId={retrainingModelId}
                        onInspect={(id, name, tab = 'config') =>
                            setInspectorState({ isOpen: true, modelId: id, modelName: name, tab })
                        }
                        onGenerateSignal={(m) => setSignalTargetModel(m)}
                        onPinToggle={(m) => handlePinToggle(m)}
                        onDeploy={handleOpenDeploy}
                        onQuickRetrain={handleQuickRetrain}
                        onDownloadDataset={handleDownloadDataset}
                        onDelete={(m) => setDeleteTarget(m)}
                    />
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                        {filteredModels.map((model, index) => {
                            const isForex =
                                model.marketType === 'forex' ||
                                model.name.toLowerCase().includes('forex') ||
                                (model.datasetPath && model.datasetPath.toLowerCase().includes('forex'));

                            if (isForex) {
                                return (
                                    <ForexModelCard
                                        key={model.id}
                                        model={model}
                                        onDelete={() => setDeleteTarget(model)}
                                        onUploadVersion={(m) => setModalState({ isOpen: true, modelToUpdate: m })}
                                        onSetActiveVersion={(mId, vId) =>
                                            setVersionMutation.mutate({ modelId: mId, versionId: vId })
                                        }
                                        onRetrain={handleRetrainStudio}
                                        onViewDetails={(id, name) =>
                                            setInspectorState({ isOpen: true, modelId: id, modelName: name, tab: 'config' })
                                        }
                                        onDownloadDataset={handleDownloadDataset}
                                        animationDelay={index * 60}
                                    />
                                );
                            }

                            return (
                                <ModelCard
                                    key={model.id}
                                    model={model}
                                    compareStats={compareMap[model.id]}
                                    isChampion={telemetry.championModel?.model_id === model.id}
                                    isPinned={pinnedModel?.model_id === model.id}
                                    isRetraining={retrainingModelId === model.id}
                                    onDelete={(m) => setDeleteTarget(m)}
                                    onUploadVersion={(m) => setModalState({ isOpen: true, modelToUpdate: m })}
                                    onSetActiveVersion={(mId, vId) =>
                                        setVersionMutation.mutate({ modelId: mId, versionId: vId })
                                    }
                                    onQuickRetrain={handleQuickRetrain}
                                    onRetrainStudio={handleRetrainStudio}
                                    onInspect={(id, name, tab = 'config') =>
                                        setInspectorState({ isOpen: true, modelId: id, modelName: name, tab })
                                    }
                                    onDownloadModel={handleDownloadModel}
                                    onDownloadDataset={handleDownloadDataset}
                                    onOpenSignal={(m) => setSignalTargetModel(m)}
                                    onPinToggle={(m) => handlePinToggle(m)}
                                    onDeploy={handleOpenDeploy}
                                    animationDelay={index * 60}
                                />
                            );
                        })}

                        <button
                            type="button"
                            onClick={() => setModalState({ isOpen: true })}
                            className="group relative border-2 border-dashed border-slate-300 dark:border-gray-700 rounded-3xl flex flex-col items-center justify-center p-10 text-center hover:border-brand-primary hover:bg-brand-primary/5 transition-all duration-300 min-h-[280px]"
                        >
                            <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-gray-800 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-inner">
                                <svg className="w-7 h-7 text-gray-400 group-hover:text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                            </div>
                            <h3 className="text-base font-bold text-slate-600 dark:text-gray-300 group-hover:text-brand-primary transition-colors">
                                Deploy Custom Model
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-gray-400 mt-1.5 max-w-[220px]">
                                Upload .pkl, .h5, .onnx or .pt weights with optional metadata.json.
                            </p>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CustomMLModels;
