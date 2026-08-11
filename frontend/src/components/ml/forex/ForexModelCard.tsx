import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { Bot, Activity, Target, Zap, Clock } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { mlModelsService } from '@/services/mlModelsService';
import { SignalModal, SignalResult } from '@/pages/app/CustomMLModels';

interface ModelVersion {
    id: string;
    version: number;
    status: string;
    accuracy?: number;
    f1_score?: number;
    latency?: number;
    explainability?: any;
}

interface MLModel {
    id: string;
    name: string;
    modelType: string;
    activeVersionId: string | null;
    versions: ModelVersion[];
    datasetPath?: string;
}

interface ForexModelCardProps {
    model: any;
    onDelete: (id: string) => void;
    onUploadVersion?: (model: any) => void;
    onSetActiveVersion?: (modelId: string, versionId: string) => void;
    onRetrain: (id: string) => void;
    onViewDetails: (id: string, name: string) => void;
    onDownloadDataset: (id: string, name: string) => void;
    animationDelay?: number;
}

export const ForexModelCard: React.FC<ForexModelCardProps> = ({
    model,
    onDelete,
    onRetrain,
    onViewDetails,
    onDownloadDataset,
    onSetActiveVersion,
    onUploadVersion,
    animationDelay = 0
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [sequenceLength, setSequenceLength] = useState<number>(100);
    const [signalProgress, setSignalProgress] = useState(0);
    const [signalResult, setSignalResult] = useState<SignalResult | null>(null);

    const handleOpenSettings = (e: React.MouseEvent) => {
        e.stopPropagation();
        setSequenceLength(['LSTM', 'GRU', '1D-CNN', 'DeepLOB', 'TCN', 'Transformer'].includes(model.modelType) ? 100 : 1);
        setShowSettingsModal(true);
        setSignalProgress(0);
        setIsAnalyzing(false);
    };

    const handleExecuteAnalysis = async () => {
        setIsAnalyzing(true);
        setSignalProgress(0);

        // Simulate progress bar for better UX
        const interval = setInterval(() => {
            setSignalProgress(prev => {
                if (prev >= 90) return prev;
                return prev + Math.random() * 15;
            });
        }, 300);

        try {
            const result = await mlModelsService.predictSignal(model.id, undefined, sequenceLength);
            setSignalProgress(100);
            setTimeout(() => {
                clearInterval(interval);
                setShowSettingsModal(false);
                setSignalResult(result);
                setIsAnalyzing(false);
            }, 500);
        } catch (err: any) {
            clearInterval(interval);
            setIsAnalyzing(false);
            const msg = err?.response?.data?.detail || 'Prediction failed. Check if model file exists.';
            toast.error(msg);
        }
    };
    
    const activeVersion = model.versions.find((v: any) => v.id === model.activeVersionId) || model.versions[0];
    const explainability = activeVersion?.explainability || {};
    
    const winRate = explainability.win_rate ? explainability.win_rate.toFixed(1) : '--';
    const sharpe = explainability.sharpe_ratio ? explainability.sharpe_ratio.toFixed(2) : '--';
    const netProfit = explainability.total_return_pct ? explainability.total_return_pct.toFixed(1) : '--';
    const profitColor = explainability.total_return_pct > 0 ? 'text-emerald-400' : explainability.total_return_pct < 0 ? 'text-rose-400' : 'text-gray-400';
    
    return (
        <div className="relative group rounded-2xl p-[1px] bg-gradient-to-b from-white/10 to-transparent hover:from-amber-500/50 hover:to-orange-500/10 transition-all duration-500 min-h-[280px] flex flex-col cursor-pointer" onClick={(e) => { e.stopPropagation(); onViewDetails(model.id, model.name); }}>
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-amber-500/5 to-orange-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl pointer-events-none"></div>
            
            <div className="relative flex-1 bg-[#0B1120]/90 backdrop-blur-xl rounded-2xl p-6 flex flex-col border border-white/5 shadow-2xl overflow-hidden z-10">
                {/* Background Decor */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-orange-600/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3 pointer-events-none"></div>
                
                {/* Header */}
                <div className="flex justify-between items-start mb-6 relative z-10">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-600/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-[inset_0_0_20px_rgba(245,158,11,0.1)] group-hover:border-amber-400/50 group-hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all duration-500">
                            <Activity className="w-7 h-7 drop-shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-white group-hover:text-amber-300 transition-colors tracking-tight flex items-center gap-2">
                                {model.name}
                                <span className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[9px] uppercase tracking-widest rounded shadow-[0_0_10px_rgba(245,158,11,0.2)]">Forex Engine</span>
                            </h3>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                <span className="px-2.5 py-1 bg-white/5 rounded-md text-[10px] font-bold uppercase tracking-wider text-gray-400 border border-white/5">{model.modelType}</span>
                                <span className="px-2.5 py-1 bg-orange-500/10 rounded-md text-[10px] font-mono font-bold text-orange-400 border border-orange-500/20 shadow-sm">v{activeVersion?.version.toFixed(1)}</span>
                                <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border shadow-sm ${activeVersion?.status === 'Ready' || activeVersion?.status === 'READY' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
                                    {activeVersion?.status || 'Unknown'}
                                </span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(model.id); }}
                        className="w-10 h-10 rounded-full bg-white/5 hover:bg-rose-500/20 flex items-center justify-center text-gray-500 hover:text-rose-400 transition-all border border-transparent hover:border-rose-500/30 group/btn z-20"
                        title="Delete Model"
                    >
                        <svg className="w-5 h-5 group-hover/btn:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-3 gap-3 mb-6 relative z-10 flex-1">
                    <div className="bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/[0.05] rounded-xl p-3 flex flex-col items-center justify-center relative overflow-hidden group/metric hover:border-emerald-500/30 transition-colors">
                        <div className="absolute inset-0 bg-emerald-500/5 opacity-0 group-hover/metric:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1 z-10 flex items-center gap-1">
                            <Target className="w-3 h-3 text-emerald-500" /> Win Rate
                        </span>
                        <span className="text-xl font-mono font-bold text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)] z-10">{winRate !== '--' ? `${winRate}%` : '--'}</span>
                    </div>
                    <div className="bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/[0.05] rounded-xl p-3 flex flex-col items-center justify-center relative overflow-hidden group/metric hover:border-blue-500/30 transition-colors">
                        <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover/metric:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1 z-10 flex items-center gap-1">
                            <Activity className="w-3 h-3 text-blue-500" /> Sharpe
                        </span>
                        <span className="text-xl font-mono font-bold text-blue-400 drop-shadow-[0_0_8px_rgba(59,130,246,0.5)] z-10">{sharpe}</span>
                    </div>
                    <div className="bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/[0.05] rounded-xl p-3 flex flex-col items-center justify-center relative overflow-hidden group/metric hover:border-amber-500/30 transition-colors">
                        <div className="absolute inset-0 bg-amber-500/5 opacity-0 group-hover/metric:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1 z-10 flex items-center gap-1">
                            <Bot className="w-3 h-3 text-amber-500" /> Net Profit
                        </span>
                        <span className={`text-xl font-mono font-bold ${profitColor} drop-shadow-[0_0_8px_rgba(245,158,11,0.5)] z-10`}>{netProfit !== '--' ? `${netProfit}%` : '--'}</span>
                    </div>
                </div>

                {/* Actions Row */}
                <div className="flex justify-center relative z-20">
                    <div className="flex flex-wrap gap-2 justify-center w-full">
                        <button
                            onClick={(e) => { e.stopPropagation(); onViewDetails(model.id, model.name); }}
                            className="relative px-4 py-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:border-indigo-400/60 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all shadow-[0_0_15px_rgba(99,102,241,0.15)] hover:shadow-[0_0_25px_rgba(99,102,241,0.35)] flex items-center gap-2 group/details overflow-hidden backdrop-blur-md"
                        >
                            <span className="drop-shadow-sm">Details</span>
                        </button>

                        <button
                            onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                            className={`relative px-4 py-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:border-purple-400/60 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all shadow-[0_0_15px_rgba(168,85,247,0.15)] hover:shadow-[0_0_25px_rgba(168,85,247,0.35)] flex items-center gap-2 group/history overflow-hidden backdrop-blur-md ${isExpanded ? 'border-purple-500/50 text-purple-300 shadow-[0_0_20px_rgba(168,85,247,0.3)] bg-purple-500/20' : ''}`}
                        >
                            <span className="drop-shadow-sm">{isExpanded ? 'Hide History' : 'History'}</span>
                        </button>

                        <button
                            onClick={handleOpenSettings}
                            disabled={isAnalyzing || (activeVersion?.status !== 'Ready' && activeVersion?.status !== 'READY')}
                            className="relative px-5 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white border border-amber-500/50 hover:border-amber-400 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(245,158,11,0.4)] hover:shadow-[0_0_30px_rgba(245,158,11,0.6)] flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed group/signal overflow-hidden"
                        >
                            {isAnalyzing ? (
                                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            ) : (
                                <Zap className="w-4 h-4 fill-white drop-shadow-[0_0_5px_rgba(255,255,255,0.8)]" />
                            )}
                            <span className="drop-shadow-sm">{isAnalyzing ? 'Analyzing...' : 'Get Signal'}</span>
                        </button>

                        <button
                            onClick={(e) => { e.stopPropagation(); onRetrain(model.id); }}
                            className="relative px-4 py-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:border-cyan-400/60 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all shadow-[0_0_15px_rgba(6,182,212,0.15)] hover:shadow-[0_0_25px_rgba(6,182,212,0.35)] flex items-center gap-2 group/retrain overflow-hidden backdrop-blur-md"
                        >
                            <span className="drop-shadow-sm">Retrain</span>
                        </button>

                        <button
                            onClick={(e) => { e.stopPropagation(); onDownloadDataset(model.id, model.name); }}
                            className="relative px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:border-emerald-400/60 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all shadow-[0_0_15px_rgba(16,185,129,0.15)] hover:shadow-[0_0_25px_rgba(16,185,129,0.35)] flex items-center gap-2 group/dataset overflow-hidden backdrop-blur-md"
                        >
                            <span className="drop-shadow-sm">Dataset</span>
                        </button>
                    </div>
                </div>
            </div>
            
            {/* Expandable History Panel */}
            <div className={`transition-all duration-500 ease-in-out overflow-hidden relative z-0 ${isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
                {/* Divider Line */}
                <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-amber-500/20 to-transparent"></div>

                <div className="p-6 pt-4 space-y-3 bg-black/40 overflow-y-auto max-h-80 custom-scrollbar inset-shadow-sm rounded-b-2xl">
                    {model.versions.map((version: any) => (
                        <div key={version.id} className="group/row relative flex items-center justify-between p-4 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.05] hover:border-amber-500/30 transition-all overflow-hidden">
                            <div className="flex items-center gap-4 relative z-10">
                                <div className={`w-2 h-10 rounded-full ${version.id === model.activeVersionId ? 'bg-gradient-to-b from-amber-400 to-orange-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]' : 'bg-gray-700'}`}></div>
                                <div>
                                    <div className="flex items-center gap-3 mb-1">
                                        <span className={`font-mono font-bold text-sm ${version.id === model.activeVersionId ? 'text-white' : 'text-gray-400'}`}>v{version.version?.toFixed(1) || '1.0'}</span>
                                        {version.id === model.activeVersionId && (
                                            <span className="text-[9px] font-black tracking-widest bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-md border border-amber-500/30">ACTIVE</span>
                                        )}
                                    </div>
                                    <p className="text-xs text-gray-500 truncate w-48 font-medium">{version.description || 'No description'}</p>
                                </div>
                            </div>

                            <div className="relative z-10">
                                {(version.status === 'Ready' || version.status === 'READY') && version.id !== model.activeVersionId && onSetActiveVersion ? (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onSetActiveVersion(model.id, version.id); }}
                                        className="px-4 py-1.5 bg-white/5 hover:bg-amber-500/20 text-gray-400 hover:text-amber-300 border border-white/10 hover:border-amber-500/50 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all"
                                    >
                                        Activate
                                    </button>
                                ) : (
                                    <span className="text-[10px] text-gray-500 font-mono">{new Date(version.uploadDate || Date.now()).toLocaleString()}</span>
                                )}
                            </div>
                        </div>
                    ))}

                    {onUploadVersion && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onUploadVersion(model); }}
                            className="w-full py-4 mt-2 border border-dashed border-white/10 rounded-2xl text-xs font-bold text-gray-400 hover:text-amber-300 hover:border-amber-500/50 hover:bg-amber-500/5 transition-all flex items-center justify-center gap-2 group/upload"
                        >
                            <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center group-hover/upload:bg-amber-500/20 transition-colors">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                            </div>
                            Upload New Version
                        </button>
                    )}
                </div>
            </div>

            {/* Signal Result Modal */}
            {signalResult && ReactDOM.createPortal(
                <SignalModal
                    result={signalResult}
                    modelName={model.name}
                    onClose={() => setSignalResult(null)}
                />,
                document.body
            )}

            {/* Signal Settings & Progress Modal */}
            {showSettingsModal && ReactDOM.createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md" onClick={(e) => e.stopPropagation()}>
                    <div className="bg-slate-900 border border-slate-700/50 rounded-2xl w-full max-w-md p-6 shadow-2xl relative overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 to-orange-500"></div>

                        <h3 className="text-xl font-bold text-white mb-2 tracking-tight flex items-center gap-2">
                            <Zap className="w-5 h-5 text-amber-500" />
                            Generate Forex Signal
                        </h3>
                        <p className="text-sm text-slate-400 mb-6">
                            Configure the analysis window for {model.name}.
                        </p>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Number of Rows (Sequence Length)</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="500"
                                    value={sequenceLength}
                                    onChange={(e) => setSequenceLength(parseInt(e.target.value) || 1)}
                                    disabled={isAnalyzing}
                                    className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors"
                                />
                                <p className="text-xs text-slate-500 mt-2">
                                    For Deep Learning (LSTM/CNN), 60-100 is recommended. For Tree-based, 1 is usually enough unless rolling features were used.
                                </p>
                            </div>

                            {isAnalyzing && (
                                <div className="mt-6">
                                    <div className="flex justify-between text-xs text-slate-400 mb-1.5 font-mono">
                                        <span>Analyzing Forex Data...</span>
                                        <span>{Math.round(signalProgress)}%</span>
                                    </div>
                                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-300 ease-out"
                                            style={{ width: `${signalProgress}%` }}
                                        ></div>
                                    </div>
                                    <p className="text-xs text-center text-slate-500 mt-3 animate-pulse">
                                        Fetching live OANDA prices & calculating features...
                                    </p>
                                </div>
                            )}

                            {!isAnalyzing && (
                                <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-800">
                                    <button
                                        onClick={() => setShowSettingsModal(false)}
                                        className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-slate-800/50 hover:bg-slate-700/50 rounded-xl transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleExecuteAnalysis}
                                        className="px-6 py-2 text-sm font-bold text-white bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 rounded-xl shadow-[0_0_15px_rgba(245,158,11,0.4)] hover:shadow-[0_0_25px_rgba(245,158,11,0.6)] transition-all flex items-center gap-2"
                                    >
                                        <Zap className="w-4 h-4" />
                                        Analyze Now
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default ForexModelCard;
