import React, { useState } from 'react';
import { Database, Trash2, Clock, Activity, CheckCircle2, AlertCircle } from 'lucide-react';

interface HybridOhlcvTickPanelProps {
    symbol: string;
    isTraining: boolean;
    forexSnapshotFiles: string[];
    selectedForexFile: string;
    setSelectedForexFile: (val: string) => void;
    handleDeleteSnapshot: (e: React.MouseEvent) => void;
    
    tickDataFiles: string[];
    selectedTickFile: string;
    setSelectedTickFile: (val: string) => void;
    handleUploadTickCsv: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleDeleteTickSnapshot: (e: React.MouseEvent) => void;
    isUploadingTick: boolean;
    tickBinningStrategy: string;
    setTickBinningStrategy: (val: string) => void;
    
    onStartMerge?: () => void;
    hybridMergedFiles?: string[];
    selectedHybridFile?: string;
    setSelectedHybridFile?: (val: string) => void;
    isMerging?: boolean;
}

export const HybridOhlcvTickPanel: React.FC<HybridOhlcvTickPanelProps> = (props) => {
    // Real Time-Sync Validator logic by parsing filenames
    const isReady = props.selectedForexFile && props.selectedTickFile;
    
    const checkAlignment = () => {
        if (!isReady) return false;
        
        try {
            // Basic extraction logic: Assume filenames contain the symbol (e.g. EUR_USD or EURUSD)
            // Remove extensions and common separators to find a match
            const forexBase = props.selectedForexFile.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const tickBase = props.selectedTickFile.toUpperCase().replace(/[^A-Z0-9]/g, '');
            
            // Extract the symbol being traded from props and check if both files contain it
            const cleanSymbol = props.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
            
            const forexHasSymbol = forexBase.includes(cleanSymbol);
            const tickHasSymbol = tickBase.includes(cleanSymbol);
            
            // We can also extract years if available
            const yearMatch = tickBase.match(/20\d{2}/);
            const forexHasYear = yearMatch ? forexBase.includes(yearMatch[0]) : true; // If no year found, ignore year check
            
            return forexHasSymbol && tickHasSymbol && forexHasYear;
        } catch (e) {
            return false;
        }
    };

    const isAligned = checkAlignment();

    return (
        <div className="mb-4 space-y-4">
            <div className="p-5 border border-indigo-500/30 rounded-xl bg-indigo-500/5 shadow-[inset_0_0_20px_rgba(99,102,241,0.05)]">
                <div className="mb-5 text-center">
                    <h4 className="text-sm font-bold text-indigo-400 mb-1">Hybrid Standard OHLCV + Historical Ticks</h4>
                    <p className="text-[10px] text-slate-400">Merge Oanda Parquet Data with Tickstory CSV Ticks</p>
                </div>
                
                <div className="flex flex-col gap-4 mb-5">
                    {/* OHLCV Panel */}
                    <div className="bg-black/30 p-4 rounded-xl border border-white/5">
                        <label className="block text-[11px] font-bold text-slate-300 mb-2 uppercase tracking-wider flex items-center gap-1">
                            <Clock className="w-3 h-3 text-cyan-400" /> Standard OHLCV (Parquet)
                        </label>
                        <div className="flex items-center gap-2">
                            <select 
                                value={props.selectedForexFile} 
                                onChange={e => props.setSelectedForexFile(e.target.value)}
                                disabled={props.isTraining}
                                className="w-full bg-black/40 border border-indigo-500/20 rounded-xl px-3 py-2 text-sm text-white focus:ring-2 focus:ring-indigo-500/50 outline-none"
                            >
                                {props.forexSnapshotFiles.length === 0 && <option value="" className="text-slate-500">No snapshots available.</option>}
                                {props.forexSnapshotFiles.map(f => (
                                    <option key={f} value={f} className="bg-gray-900 text-white">{f}</option>
                                ))}
                            </select>
                            {props.selectedForexFile && (
                                <button
                                    onClick={props.handleDeleteSnapshot}
                                    disabled={props.isTraining}
                                    className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl border border-red-500/20 transition-all flex items-center justify-center"
                                    title="Delete selected snapshot"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Tick Data Panel */}
                    <div className="bg-black/30 p-4 rounded-xl border border-white/5">
                        <label className="block text-[11px] font-bold text-slate-300 mb-2 uppercase tracking-wider flex items-center gap-1">
                            <Activity className="w-3 h-3 text-rose-400" /> Historical Ticks (CSV)
                        </label>
                        <div className="flex items-center gap-2 mb-3">
                            <select 
                                value={props.selectedTickFile} 
                                onChange={e => props.setSelectedTickFile(e.target.value)}
                                disabled={props.isTraining || props.isUploadingTick}
                                className="w-full bg-black/40 border border-indigo-500/20 rounded-xl px-3 py-2 text-sm text-white focus:ring-2 focus:ring-indigo-500/50 outline-none"
                            >
                                {props.tickDataFiles.length === 0 && <option value="" className="text-slate-500">No tick data available.</option>}
                                {props.tickDataFiles.map(f => (
                                    <option key={f} value={f} className="bg-gray-900 text-white">{f}</option>
                                ))}
                            </select>
                            {props.selectedTickFile && (
                                <button
                                    onClick={props.handleDeleteTickSnapshot}
                                    disabled={props.isTraining || props.isUploadingTick}
                                    className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl border border-red-500/20 transition-all flex items-center justify-center"
                                    title="Delete selected tick dataset"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                        
                        <div className="relative border border-dashed border-indigo-500/30 hover:border-indigo-400/60 rounded-xl p-3 text-center transition-all bg-black/20 group">
                            <input 
                                type="file" 
                                accept=".csv"
                                onChange={props.handleUploadTickCsv}
                                disabled={props.isTraining || props.isUploadingTick}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            />
                            <div className="flex flex-col items-center justify-center pointer-events-none">
                                <span className="text-xs font-bold text-slate-300 group-hover:text-indigo-300 transition-colors">
                                    {props.isUploadingTick ? 'Uploading...' : 'Upload Tickstory CSV'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Configuration & Validator */}
                <div className="bg-black/20 rounded-xl p-4 border border-white/5 flex flex-col md:flex-row gap-4 items-center justify-between">
                    <div className="w-full md:w-1/2">
                        <label className="block text-[11px] font-bold text-slate-300 mb-1 uppercase">Tick Binning Strategy</label>
                        <select 
                            value={props.tickBinningStrategy}
                            onChange={(e) => props.setTickBinningStrategy(e.target.value)}
                            disabled={props.isTraining}
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:ring-2 focus:ring-indigo-500/50 outline-none"
                        >
                            <option value="time_based_5s">Time-based (Align to 5s OHLCV)</option>
                            <option value="volume_based">Volume-based (True Cumulative Volume)</option>
                            <option value="event_based">Event-based (Order Flow Imbalance)</option>
                            <option value="microstructure">Microstructure (Spread & Path Variation)</option>
                        </select>
                    </div>
                    
                    <div className="w-full md:w-1/2 flex flex-col items-end gap-1">
                        {isReady ? (
                            isAligned ? (
                                <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-lg w-full justify-center">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                    <span className="text-xs font-bold text-emerald-400">Timeframes Aligned</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-lg w-full justify-center">
                                    <AlertCircle className="w-4 h-4 text-rose-400" />
                                    <span className="text-xs font-bold text-rose-400">Symbol/Timeframe Mismatch Warning</span>
                                </div>
                            )
                        ) : (
                            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-lg w-full justify-center">
                                <AlertCircle className="w-4 h-4 text-amber-400" />
                                <span className="text-xs font-bold text-amber-400">Select both sources</span>
                            </div>
                        )}
                        <span className="text-[9px] text-slate-500">* Alignment checked via filename parsing</span>
                    </div>
                </div>
                
                {/* NEW: Merge Button */}
                <div className="mt-4 flex justify-center">
                    <button
                        onClick={props.onStartMerge}
                        disabled={!isAligned || props.isMerging || props.isTraining}
                        className={`px-6 py-2 rounded-xl text-xs font-bold transition-all duration-300 flex items-center gap-2 ${
                            isAligned && !props.isMerging && !props.isTraining 
                                ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-[0_0_15px_rgba(99,102,241,0.5)] hover:shadow-[0_0_25px_rgba(99,102,241,0.7)]' 
                                : 'bg-white/5 text-slate-500 cursor-not-allowed border border-white/5'
                        }`}
                    >
                        {props.isMerging ? (
                            <><div className="w-3 h-3 rounded-full border-2 border-white/20 border-t-white animate-spin"></div> Merging in Background...</>
                        ) : (
                            <><Database className="w-4 h-4" /> Merge & Prepare Hybrid Dataset</>
                        )}
                    </button>
                </div>
            </div>
            
            {/* NEW: Merged Hybrid Files Dropdown */}
            {props.hybridMergedFiles && props.hybridMergedFiles.length > 0 && (
                <div className="p-4 border border-teal-500/30 rounded-xl bg-teal-500/5 mt-4">
                    <label className="block text-xs font-bold text-teal-400 mb-2 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4" /> READY-TO-TRAIN HYBRID DATASETS
                    </label>
                    <select 
                        value={props.selectedHybridFile || ''} 
                        onChange={e => props.setSelectedHybridFile && props.setSelectedHybridFile(e.target.value)}
                        disabled={props.isTraining || props.isMerging}
                        className="w-full bg-black/40 border border-teal-500/20 rounded-xl px-4 py-3 text-sm text-white focus:ring-2 focus:ring-teal-500/50 outline-none"
                    >
                        {props.hybridMergedFiles.map(f => (
                            <option key={f} value={f}>{f}</option>
                        ))}
                    </select>
                </div>
            )}
        </div>
    );
};
