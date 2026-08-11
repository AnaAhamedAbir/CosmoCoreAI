import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Database, Activity, HardDrive, Cpu, AlertTriangle, Loader2, Calendar, Hash, CheckCircle2, Clock, ShieldCheck, UploadCloud } from 'lucide-react';
import { ForexTrainingJob, forexMlTrainingService } from '@/services/forexMlTrainingService';

interface ForexScraperPanelProps {
    symbol: string;
    isTraining: boolean;
    forexScrapeJob: ForexTrainingJob | null;
    onStartCollector: (config: any) => void;
    onCancelCollector: () => void;
    timeframe: string;
    setForexScrapeJob?: (job: ForexTrainingJob) => void;
}

export const ForexScraperPanel: React.FC<ForexScraperPanelProps> = ({
    symbol,
    isTraining,
    forexScrapeJob,
    onStartCollector,
    onCancelCollector,
    timeframe,
    setForexScrapeJob
}) => {
    const [dataSource, setDataSource] = useState<'oanda' | 'tickstory'>('oanda');
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [dateRangeMode, setDateRangeMode] = useState<'ticks' | 'date'>('date');
    const [targetRows, setTargetRows] = useState<number>(10000);
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setFullYear(d.getFullYear() - 1);
        return d.toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

    const PRESET_TICKS = [10000, 50000, 100000, 500000];

    const setPresetDate = (yearsBack: number, specificStart?: string, specificEnd?: string) => {
        if (specificStart && specificEnd) {
            setStartDate(specificStart);
            setEndDate(specificEnd);
            return;
        }
        
        const end = new Date();
        const start = new Date();
        start.setFullYear(end.getFullYear() - yearsBack);
        
        setEndDate(end.toISOString().split('T')[0]);
        setStartDate(start.toISOString().split('T')[0]);
    };

    const calculateEstimates = () => {
        let estimatedRows = targetRows;
        
        if (dateRangeMode === 'date') {
            const s = new Date(startDate).getTime();
            const e = new Date(endDate).getTime();
            const days = Math.max(0, (e - s) / (1000 * 3600 * 24));
            
            if (dataSource === 'tickstory') {
                let rowsPerDay = 100000;
                estimatedRows = Math.floor(days * rowsPerDay * 0.71);
            } else {
                let rowsPerDay = 24; 
                if (timeframe === '5s') rowsPerDay = 17280;
                if (timeframe === '10s') rowsPerDay = 8640;
                if (timeframe === '30s') rowsPerDay = 2880;
                if (timeframe === '1m') rowsPerDay = 1440;
                if (timeframe === '5m') rowsPerDay = 288;
                if (timeframe === '15m') rowsPerDay = 96;
                if (timeframe === '30m') rowsPerDay = 48;
                if (timeframe === '1h') rowsPerDay = 24;
                if (timeframe === '4h') rowsPerDay = 6;
                if (timeframe === '1d') rowsPerDay = 1;
                
                estimatedRows = Math.floor(days * rowsPerDay * 0.71); // ~5 trading days a week
            }
        }
        
        const sizeMb = uploadFile ? (uploadFile.size / (1024 * 1024)) : ((estimatedRows * (dataSource === 'tickstory' ? 40 : 100)) / (1024 * 1024));
        let timeSecs = uploadFile ? Math.max(5, Math.floor(sizeMb * 0.5)) : Math.max(5, Math.floor(estimatedRows / 5000));
        
        if (dataSource === 'tickstory' && uploadFile) {
            timeSecs = Math.max(10, Math.floor(sizeMb * 0.2)); // ~0.2 secs per MB parsing speed
        }
        
        return {
            rows: uploadFile ? "N/A" : estimatedRows,
            size: sizeMb < 1 ? sizeMb.toFixed(2) : Math.round(sizeMb),
            time: timeSecs > 60 ? `${(timeSecs/60).toFixed(1)} mins` : `${timeSecs} secs`,
            isDangerous: sizeMb > (dataSource === 'tickstory' ? 1000 : 500)
        };
    };

    const est = calculateEstimates();

    const handleStart = async () => {
        if (dataSource === 'tickstory') {
            if (!uploadFile) {
                alert("Please select a CSV file first.");
                return;
            }
            setIsUploading(true);
            setUploadProgress(0);
            try {
                const job = await forexMlTrainingService.uploadTickstoryCsv(symbol, uploadFile, (progressEvent) => {
                    const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                    setUploadProgress(percentCompleted);
                });
                if (setForexScrapeJob) {
                    setForexScrapeJob(job);
                } else {
                    // Fallback if prop not provided
                    alert("Upload started: " + job.id);
                }
            } catch (err: any) {
                alert("Upload failed: " + (err.response?.data?.detail || err.message));
            } finally {
                setIsUploading(false);
            }
            return;
        }

        onStartCollector({
            data_source: dataSource,
            timeframe: dataSource === 'oanda' ? timeframe : undefined,
            mode: dateRangeMode,
            target_rows: targetRows,
            start_date: dateRangeMode === 'date' ? startDate : undefined,
            end_date: dateRangeMode === 'date' ? endDate : undefined
        });
    };

    const isRunning = forexScrapeJob && ['PENDING', 'RUNNING'].includes(forexScrapeJob.status);
    const isDisabled = isTraining || isRunning || isUploading;

    return (
        <div className="p-5 bg-gradient-to-br from-teal-900/10 to-blue-900/10 rounded-2xl border border-teal-500/30 shadow-[0_0_25px_rgba(20,184,166,0.05)] space-y-6">
            
            {/* Header */}
            <div className="flex items-center justify-between border-b border-teal-500/20 pb-3">
                <div>
                    <h4 className="text-sm font-black text-teal-400 flex items-center gap-2 tracking-wide uppercase">
                        <Activity className="w-4 h-4" /> Live Forex Data Scraper
                    </h4>
                    <p className="text-xs text-slate-400 mt-1 font-medium">Download high-quality historical tick/candle data directly from OANDA or Dukascopy.</p>
                </div>
            </div>

            {/* Data Source Toggles */}
            <div className="flex bg-black/40 rounded-xl p-1 border border-white/5">
                <button
                    onClick={() => { setDataSource('oanda'); }}
                    disabled={isDisabled}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${dataSource === 'oanda' ? 'bg-teal-500/20 text-teal-400 shadow-[0_0_10px_rgba(20,184,166,0.2)]' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    <Database className="w-4 h-4" /> OANDA (Candles / S5)
                </button>
                <button
                    onClick={() => { setDataSource('tickstory'); setDateRangeMode('date'); }}
                    disabled={isDisabled}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${dataSource === 'tickstory' ? 'bg-indigo-500/20 text-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.2)]' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    <UploadCloud className="w-4 h-4" /> Tickstory (CSV Upload)
                </button>
            </div>

            {/* Mode Toggles */}
            <div className={`flex bg-black/40 rounded-xl p-1 border border-white/5 ${dataSource === 'tickstory' ? 'opacity-50 pointer-events-none hidden' : ''}`}>
                <button
                    onClick={() => setDateRangeMode('ticks')}
                    disabled={isDisabled || dataSource === 'tickstory'}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${dateRangeMode === 'ticks' ? 'bg-teal-500/20 text-teal-400 shadow-[0_0_10px_rgba(20,184,166,0.2)]' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    <Hash className="w-4 h-4" /> Fixed Rows
                </button>
                <button
                    onClick={() => setDateRangeMode('date')}
                    disabled={isDisabled}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${dateRangeMode === 'date' ? 'bg-indigo-500/20 text-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.2)]' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    <Calendar className="w-4 h-4" /> Date Range
                </button>
            </div>

            {/* Main Configuration Area */}
            <div className="bg-black/30 p-4 rounded-xl border border-white/5 space-y-4">
                {dataSource === 'tickstory' ? (
                    <div className="space-y-4 animate-in fade-in zoom-in duration-300">
                        <div className="flex justify-between items-center mb-1">
                            <label className="text-xs font-bold text-slate-300">Upload Tickstory CSV Data</label>
                        </div>
                        <div className="border-2 border-dashed border-indigo-500/30 rounded-xl p-8 flex flex-col items-center justify-center bg-indigo-900/10 hover:bg-indigo-900/20 transition-colors relative">
                            <input 
                                type="file" 
                                accept=".csv"
                                onChange={(e) => setUploadFile(e.target.files ? e.target.files[0] : null)}
                                disabled={isDisabled}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                            <UploadCloud className="w-8 h-8 text-indigo-400 mb-3" />
                            <p className="text-sm font-bold text-indigo-300 text-center">
                                {uploadFile ? uploadFile.name : "Drag & drop CSV file or click to browse"}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-2 text-center max-w-[250px]">
                                {uploadFile ? `${(uploadFile.size / (1024 * 1024)).toFixed(2)} MB - Ready to process` : "Supports large Tickstory tick exports (GBs). Processed in background."}
                            </p>
                        </div>
                    </div>
                ) : dateRangeMode === 'ticks' ? (
                    <div className="space-y-3 animate-in fade-in zoom-in duration-300">
                        <div className="flex justify-between items-center">
                            <label className="text-xs font-bold text-slate-300">Target Rows</label>
                            <span className="text-sm font-black text-teal-400 bg-teal-500/10 px-2.5 py-1 rounded-lg border border-teal-500/20 font-mono">
                                {targetRows.toLocaleString()} Rows
                            </span>
                        </div>
                        <input 
                            type="number" 
                            value={targetRows} 
                            onChange={e => setTargetRows(parseInt(e.target.value) || 0)}
                            disabled={isDisabled}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:ring-2 focus:ring-teal-500/50 outline-none"
                        />
                        <div className="flex flex-wrap gap-2">
                            {PRESET_TICKS.map(ticks => (
                                <button
                                    key={ticks}
                                    disabled={isDisabled}
                                    onClick={() => setTargetRows(ticks)}
                                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${targetRows === ticks ? 'bg-teal-600/30 border-teal-400/60 text-teal-200' : 'bg-black/30 border-white/10 text-slate-400 hover:border-teal-500/40 hover:text-teal-300'}`}
                                >
                                    {ticks >= 1000 ? `${ticks/1000}k` : ticks}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3 animate-in fade-in zoom-in duration-300">
                        <div className="flex justify-between items-center mb-1">
                            <label className="text-xs font-bold text-slate-300">Date Range</label>
                            <div className={`px-3 py-1.5 rounded-lg border text-xs font-bold font-mono shadow-inner flex items-center gap-1.5 ${est.isDangerous ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'}`}>
                                ~{est.rows.toLocaleString()} Rows Est.
                                {est.isDangerous && <AlertTriangle className="w-3 h-3 text-red-400" />}
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <div className="flex-1">
                                <label className="block text-[10px] uppercase text-slate-400 mb-1 font-bold">Start Date</label>
                                <input 
                                    type="date"
                                    value={startDate}
                                    onChange={e => setStartDate(e.target.value)}
                                    disabled={isDisabled}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                />
                            </div>
                            <div className="flex-1">
                                <label className="block text-[10px] uppercase text-slate-400 mb-1 font-bold">End Date</label>
                                <input 
                                    type="date"
                                    value={endDate}
                                    onChange={e => setEndDate(e.target.value)}
                                    disabled={isDisabled}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                />
                            </div>
                        </div>
                        <div className="flex gap-2 flex-wrap pt-2">
                            <button onClick={() => setPresetDate(1)} disabled={isDisabled} className="px-2.5 py-1.5 bg-black/40 border border-white/10 hover:border-indigo-500/50 rounded-lg text-xs font-bold text-slate-400 hover:text-indigo-300 transition-colors">Last 1 Year</button>
                            <button onClick={() => setPresetDate(5)} disabled={isDisabled} className="px-2.5 py-1.5 bg-black/40 border border-white/10 hover:border-indigo-500/50 rounded-lg text-xs font-bold text-slate-400 hover:text-indigo-300 transition-colors">Last 5 Years</button>
                            <button onClick={() => setPresetDate(0, '2020-02-01', '2020-05-31')} disabled={isDisabled} className="px-2.5 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 rounded-lg text-xs font-bold transition-colors">COVID Volatility</button>
                            <button onClick={() => setPresetDate(0, '2008-01-01', '2009-12-31')} disabled={isDisabled} className="px-2.5 py-1.5 bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20 rounded-lg text-xs font-bold transition-colors">2008 Crisis</button>
                        </div>
                    </div>
                )}

                {/* Storage & ETA Estimates */}
                <div className={`mt-5 flex items-center justify-between p-3 rounded-lg border ${est.isDangerous ? 'bg-orange-500/10 border-orange-500/30' : 'bg-green-500/10 border-green-500/20'}`}>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                            <HardDrive className={`w-3.5 h-3.5 ${est.isDangerous ? 'text-orange-400' : 'text-green-400'}`} />
                            <div>
                                <p className="text-[9px] uppercase font-bold text-slate-500">Est. Size</p>
                                <p className={`text-xs font-black font-mono ${est.isDangerous ? 'text-orange-300' : 'text-green-300'}`}>
                                    {est.size} MB
                                </p>
                            </div>
                        </div>
                        <div className="w-px h-6 bg-white/10"></div>
                        <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-blue-400" />
                            <div>
                                <p className="text-[9px] uppercase font-bold text-slate-500">Est. Time</p>
                                <p className="text-xs font-black text-blue-300 font-mono">
                                    {est.time}
                                </p>
                            </div>
                        </div>
                    </div>
                    {est.isDangerous && (
                        <div className="flex items-center gap-1.5 text-orange-400 bg-orange-500/20 px-2 py-1 rounded text-[10px] font-bold animate-pulse">
                            <AlertTriangle className="w-3 h-3" /> High Volume
                        </div>
                    )}
                </div>
            </div>

            {/* Action Buttons & Status */}
            <div>
                {(!forexScrapeJob || ['COMPLETED', 'FAILED'].includes(forexScrapeJob.status)) && !isUploading && (
                    <button
                        onClick={handleStart}
                        disabled={isDisabled || (dataSource !== 'tickstory' && dateRangeMode === 'ticks' && targetRows <= 0)}
                        className={`w-full py-3.5 rounded-xl font-black text-sm text-white transition-all shadow-[0_0_20px_rgba(20,184,166,0.3)] disabled:opacity-50 disabled:shadow-none hover:scale-[1.01] ${dateRangeMode === 'date' || dataSource === 'tickstory' ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500' : 'bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-500 hover:to-blue-500'}`}
                    >
                        {dataSource === 'tickstory' ? 'Upload & Process Data' : 'Start Data Collector'}
                    </button>
                )}

                {(forexScrapeJob || isUploading) && (
                    <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`mt-4 p-4 bg-[#0A0A0A] rounded-xl border relative overflow-hidden ${dateRangeMode === 'date' ? 'border-indigo-500/30' : 'border-teal-500/30'}`}
                    >
                        {(isUploading || (forexScrapeJob && ['PENDING', 'RUNNING'].includes(forexScrapeJob.status))) && (
                            <div className={`absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r animate-[moveBg_2s_linear_infinite] bg-[length:200%_100%] ${dateRangeMode === 'date' ? 'from-indigo-500 via-purple-500 to-indigo-500' : 'from-teal-500 via-blue-500 to-teal-500'}`}></div>
                        )}
                        
                        <div className="flex justify-between items-end mb-2">
                            <span className="text-xs font-bold text-slate-400 flex items-center gap-2">
                                {(isUploading || (forexScrapeJob && ['PENDING', 'RUNNING'].includes(forexScrapeJob.status))) && <Loader2 className={`w-3.5 h-3.5 animate-spin ${dateRangeMode === 'date' ? 'text-indigo-500' : 'text-teal-500'}`} />}
                                {isUploading ? 'Uploading Data to Server...' : 'Data Processing Status'}
                            </span>
                            <span className={`text-sm font-black ${dateRangeMode === 'date' ? 'text-indigo-400' : 'text-teal-400'}`}>
                                {isUploading ? `${uploadProgress}%` : (forexScrapeJob ? `${Number(forexScrapeJob.progress).toFixed(1)}%` : '0%')}
                            </span>
                        </div>
                        
                        <div className="w-full bg-slate-800 rounded-full h-2 mb-3 overflow-hidden shadow-inner">
                            <div 
                                className={`h-2 rounded-full transition-all duration-300 relative bg-gradient-to-r ${dateRangeMode === 'date' ? 'from-indigo-500 to-purple-500' : 'from-teal-500 to-blue-500'}`}
                                style={{ width: `${isUploading ? uploadProgress : (forexScrapeJob?.progress || 0)}%` }}
                            >
                                <div className="absolute inset-0 bg-white/20 w-full animate-[shimmer_1.5s_infinite]"></div>
                            </div>
                        </div>
                        
                        {!isUploading && forexScrapeJob && (
                            <div className="text-[10px] text-slate-300 font-mono mb-4 p-2 bg-black/40 rounded border border-white/5 break-words">
                                {forexScrapeJob.logs && forexScrapeJob.logs.length > 0 ? forexScrapeJob.logs[forexScrapeJob.logs.length - 1] : 'Initializing engine...'}
                            </div>
                        )}
                        
                        {!isUploading && forexScrapeJob && (
                            ['PENDING', 'RUNNING'].includes(forexScrapeJob.status) ? (
                                <button 
                                    onClick={onCancelCollector}
                                    className="w-full py-2 rounded-lg border border-red-500/30 text-red-400 text-xs font-bold hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2"
                                >
                                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div> Stop Collection
                                </button>
                            ) : (
                                <div className={`text-center text-xs font-bold py-2 rounded-lg ${forexScrapeJob.status === 'COMPLETED' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                                    {forexScrapeJob.status === 'COMPLETED' ? '✅ Data Processing Completed' : '❌ ' + (forexScrapeJob.error_message || 'Stopped')}
                                </div>
                            )
                        )}
                    </motion.div>
                )}
            </div>
            
        </div>
    );
};
