import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Settings, Clock, Activity, HardDrive, Cpu, AlertTriangle, Loader2 } from 'lucide-react';

interface AdvancedHybridCollectorPanelProps {
    symbol: string;
    isTraining: boolean;
    hybridScrapeJob: any;
    onStartCollector: (config: any) => void;
    onCancelCollector: () => void;
}

export const AdvancedHybridCollectorPanel: React.FC<AdvancedHybridCollectorPanelProps> = ({
    symbol,
    isTraining,
    hybridScrapeJob,
    onStartCollector,
    onCancelCollector
}) => {
    // Mode toggles
    const [inputMode, setInputMode] = useState<'rows' | 'time'>('time');
    const [resolution, setResolution] = useState<string>('100ms');

    // Values
    const [targetRows, setTargetRows] = useState<number>(36000); // Default 1 hour @ 100ms
    const [timeDurationMins, setTimeDurationMins] = useState<number>(60); // Default 60 mins

    // Scheduling
    const [isScheduled, setIsScheduled] = useState<boolean>(false);
    const [scheduleTime, setScheduleTime] = useState<string>('');

    // Smart Triggers
    const [triggerType, setTriggerType] = useState<'none' | 'price_volatility' | 'volume'>('none');
    const [triggerValue, setTriggerValue] = useState<number>(0);

    // Helpers for calculations
    const getRowsPerSecond = (res: string) => {
        switch (res) {
            case '10ms': return 100;
            case '50ms': return 20;
            case '100ms': return 10;
            case '500ms': return 2;
            case '1s': return 1;
            default: return 10;
        }
    };

    const handleTimePreset = (mins: number) => {
        setTimeDurationMins(mins);
        const rps = getRowsPerSecond(resolution);
        setTargetRows(mins * 60 * rps);
    };

    // Keep rows and time synced when resolution changes
    useEffect(() => {
        const rps = getRowsPerSecond(resolution);
        if (inputMode === 'time') {
            setTargetRows(timeDurationMins * 60 * rps);
        } else {
            setTimeDurationMins(targetRows / (60 * rps));
        }
    }, [resolution]);

    const handleRowSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseInt(e.target.value);
        // Logarithmic scale calculation for smooth slider feel
        // range 0 to 100 -> maps to 100 to 10,000,000
        const minP = 0;
        const maxP = 100;
        const minV = Math.log(100);
        const maxV = Math.log(10000000);
        const scale = (maxV - minV) / (maxP - minP);
        
        const mappedValue = Math.round(Math.exp(minV + scale * (value - minP)));
        setTargetRows(mappedValue);
        
        const rps = getRowsPerSecond(resolution);
        setTimeDurationMins(mappedValue / (60 * rps));
    };

    const getSliderPercentFromRows = (rows: number) => {
        const minP = 0;
        const maxP = 100;
        const minV = Math.log(100);
        const maxV = Math.log(10000000);
        const scale = (maxV - minV) / (maxP - minP);
        return Math.max(0, Math.min(100, (Math.log(rows) - minV) / scale + minP));
    };

    // Estimates
    const estimatedMB = (targetRows * 2.5) / 1024;
    const isDangerousSize = estimatedMB > 1000; // Warning if over 1 GB

    const handleStart = () => {
        let finalScheduleTime = null;
        if (isScheduled && scheduleTime) {
            // Local to UTC ISO conversion
            const localDate = new Date(scheduleTime);
            finalScheduleTime = localDate.toISOString();
        }

        onStartCollector({
            target_rows: targetRows,
            resolution: resolution,
            schedule_time: finalScheduleTime,
            trigger_type: triggerType !== 'none' ? triggerType : null,
            trigger_value: triggerType !== 'none' ? triggerValue : null
        });
    };

    const isRunning = hybridScrapeJob && ['PENDING', 'RUNNING'].includes(hybridScrapeJob.status);
    const isDisabled = isTraining || isRunning;

    return (
        <div className="p-5 bg-gradient-to-br from-rose-900/10 to-orange-900/10 rounded-2xl border border-rose-500/30 shadow-[0_0_25px_rgba(244,63,94,0.05)] space-y-6">
            
            {/* Header */}
            <div className="flex items-center justify-between border-b border-rose-500/20 pb-3">
                <div>
                    <h4 className="text-sm font-black text-rose-400 flex items-center gap-2 tracking-wide uppercase">
                        <Activity className="w-4 h-4" /> Live Hybrid Data Collector
                    </h4>
                    <p className="text-xs text-slate-400 mt-1 font-medium">Capture perfectly synchronized L2 + Live Trades directly from WebSocket.</p>
                </div>
            </div>

            {/* Mode & Resolution Toggles */}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wider">Input Mode</label>
                    <div className="flex p-1 bg-black/40 rounded-xl border border-white/5">
                        <button 
                            disabled={isDisabled}
                            onClick={() => setInputMode('time')}
                            className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${inputMode === 'time' ? 'bg-rose-500/20 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.2)]' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            Time (Duration)
                        </button>
                        <button 
                            disabled={isDisabled}
                            onClick={() => setInputMode('rows')}
                            className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${inputMode === 'rows' ? 'bg-rose-500/20 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.2)]' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            Raw Rows
                        </button>
                    </div>
                </div>

                <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wider">Frame Resolution</label>
                    <select
                        disabled={isDisabled}
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-xs font-bold text-rose-200 outline-none focus:border-rose-500/50 transition-colors"
                    >
                        <option value="10ms">10ms (100 rows/sec)</option>
                        <option value="50ms">50ms (20 rows/sec)</option>
                        <option value="100ms">100ms (10 rows/sec)</option>
                        <option value="500ms">500ms (2 rows/sec)</option>
                        <option value="1s">1 Second (1 row/sec)</option>
                    </select>
                </div>
            </div>

            {/* Main Configuration Area */}
            <div className="bg-black/30 p-4 rounded-xl border border-white/5">
                {inputMode === 'time' ? (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <label className="text-xs font-bold text-slate-300">Target Duration</label>
                            <span className="text-sm font-black text-rose-400 bg-rose-500/10 px-2.5 py-1 rounded-lg border border-rose-500/20 font-mono">
                                {timeDurationMins < 60 ? `${timeDurationMins.toFixed(1)} Mins` : `${(timeDurationMins/60).toFixed(1)} Hours`}
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {[
                                {label: '5 Min', m: 5},
                                {label: '15 Min', m: 15},
                                {label: '1 Hour', m: 60},
                                {label: '4 Hours', m: 240},
                                {label: '12 Hours', m: 720},
                                {label: '1 Day', m: 1440}
                            ].map(preset => (
                                <button
                                    key={preset.label}
                                    disabled={isDisabled}
                                    onClick={() => handleTimePreset(preset.m)}
                                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${timeDurationMins === preset.m ? 'bg-rose-600/30 border-rose-400/60 text-rose-200' : 'bg-black/30 border-white/10 text-slate-400 hover:border-rose-500/40 hover:text-rose-300'}`}
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <label className="text-xs font-bold text-slate-300">Target Rows</label>
                            <span className="text-sm font-black text-rose-400 bg-rose-500/10 px-2.5 py-1 rounded-lg border border-rose-500/20 font-mono">
                                {targetRows.toLocaleString()} Rows
                            </span>
                        </div>
                        
                        <div className="relative pt-2 pb-1">
                            <div className="absolute left-0 w-full h-1.5 bg-white/5 rounded-full overflow-hidden pointer-events-none">
                                <div 
                                    className={`h-full transition-all ${isDangerousSize ? 'bg-red-500 shadow-[0_0_10px_#ef4444]' : 'bg-rose-500 shadow-[0_0_10px_#f43f5e]'}`}
                                    style={{ width: `${getSliderPercentFromRows(targetRows)}%` }}
                                ></div>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                step="1"
                                value={getSliderPercentFromRows(targetRows)}
                                onChange={handleRowSliderChange}
                                disabled={isDisabled}
                                className="w-full h-1.5 appearance-none cursor-pointer bg-transparent relative z-10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg"
                            />
                        </div>
                        <div className="flex justify-between text-[9px] font-bold text-slate-500 tracking-wider">
                            <span>100</span>
                            <span>1M</span>
                            <span>10M</span>
                        </div>
                    </div>
                )}

                {/* Storage & ETA Estimates */}
                <div className={`mt-5 flex items-center justify-between p-3 rounded-lg border ${isDangerousSize ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/20'}`}>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                            <HardDrive className={`w-3.5 h-3.5 ${isDangerousSize ? 'text-red-400' : 'text-green-400'}`} />
                            <div>
                                <p className="text-[9px] uppercase font-bold text-slate-500">Est. Size</p>
                                <p className={`text-xs font-black font-mono ${isDangerousSize ? 'text-red-300' : 'text-green-300'}`}>
                                    {estimatedMB < 1024 ? `${estimatedMB.toFixed(1)} MB` : `${(estimatedMB/1024).toFixed(2)} GB`}
                                </p>
                            </div>
                        </div>
                        <div className="w-px h-6 bg-white/10"></div>
                        <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-blue-400" />
                            <div>
                                <p className="text-[9px] uppercase font-bold text-slate-500">Time to Collect</p>
                                <p className="text-xs font-black text-blue-300 font-mono">
                                    {timeDurationMins < 60 ? `${timeDurationMins.toFixed(1)}m` : `${(timeDurationMins/60).toFixed(1)}h`} @ {resolution}
                                </p>
                            </div>
                        </div>
                    </div>
                    {isDangerousSize && (
                        <div className="flex items-center gap-1.5 text-red-400 bg-red-500/20 px-2 py-1 rounded text-[10px] font-bold animate-pulse">
                            <AlertTriangle className="w-3 h-3" /> High RAM Risk
                        </div>
                    )}
                </div>
            </div>

            {/* Advanced Constraints (Grid) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Smart Triggers */}
                <div className="bg-black/30 p-4 rounded-xl border border-white/5 space-y-3">
                    <h5 className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1.5">
                        <Cpu className="w-3 h-3" /> Smart Stopping Trigger
                    </h5>
                    
                    <select
                        disabled={isDisabled}
                        value={triggerType}
                        onChange={(e: any) => { setTriggerType(e.target.value); setTriggerValue(0); }}
                        className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none"
                    >
                        <option value="none">Disabled (Run full duration)</option>
                        <option value="price_volatility">Stop if Price moves by X%</option>
                    </select>

                    {triggerType === 'price_volatility' && (
                        <div className="flex items-center gap-2 animate-in fade-in zoom-in duration-200">
                            <input
                                type="number"
                                step="0.1"
                                min="0.1"
                                disabled={isDisabled}
                                value={triggerValue || ''}
                                onChange={(e) => setTriggerValue(parseFloat(e.target.value) || 0)}
                                placeholder="e.g. 1.5"
                                className="w-full bg-black/50 border border-rose-500/30 rounded-lg px-3 py-2 text-xs text-white outline-none font-mono focus:border-rose-500"
                            />
                            <span className="text-xs font-bold text-slate-400">%</span>
                        </div>
                    )}
                </div>

                {/* Scheduled Collection */}
                <div className="bg-black/30 p-4 rounded-xl border border-white/5 space-y-3">
                    <div className="flex items-center justify-between">
                        <h5 className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1.5">
                            <Clock className="w-3 h-3" /> Schedule Run (Local Time)
                        </h5>
                        <input 
                            type="checkbox"
                            checked={isScheduled}
                            onChange={(e) => setIsScheduled(e.target.checked)}
                            disabled={isDisabled}
                            className="accent-rose-500 cursor-pointer"
                        />
                    </div>

                    <input
                        type="datetime-local"
                        disabled={!isScheduled || isDisabled}
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        className={`w-full bg-black/50 border rounded-lg px-3 py-2 text-xs text-white outline-none transition-colors ${isScheduled ? 'border-rose-500/40 focus:border-rose-500' : 'border-white/5 opacity-50'}`}
                    />
                </div>
            </div>

            {/* Action Buttons & Status */}
            <div>
                {(!hybridScrapeJob || ['COMPLETED', 'FAILED'].includes(hybridScrapeJob.status)) && (
                    <button
                        onClick={handleStart}
                        disabled={isDisabled || (isScheduled && !scheduleTime) || (triggerType !== 'none' && triggerValue <= 0)}
                        className="w-full py-3.5 rounded-xl font-black text-sm bg-gradient-to-r from-rose-600 to-orange-600 text-white hover:from-rose-500 hover:to-orange-500 transition-all shadow-[0_0_20px_rgba(244,63,94,0.3)] disabled:opacity-50 disabled:shadow-none hover:scale-[1.01]"
                    >
                        Start Advanced Collector
                    </button>
                )}

                {hybridScrapeJob && (
                    <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-4 p-4 bg-[#0A0A0A] rounded-xl border border-rose-500/30 relative overflow-hidden"
                    >
                        {['PENDING', 'RUNNING'].includes(hybridScrapeJob.status) && (
                            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-rose-500 via-orange-500 to-rose-500 animate-[moveBg_2s_linear_infinite] bg-[length:200%_100%]"></div>
                        )}
                        
                        <div className="flex justify-between items-end mb-2">
                            <span className="text-xs font-bold text-slate-400 flex items-center gap-2">
                                {['PENDING', 'RUNNING'].includes(hybridScrapeJob.status) && <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-500" />}
                                Engine Status
                            </span>
                            <span className="text-sm font-black text-rose-400">{hybridScrapeJob.progress}%</span>
                        </div>
                        
                        <div className="w-full bg-slate-800 rounded-full h-2 mb-3 overflow-hidden shadow-inner">
                            <div 
                                className="bg-gradient-to-r from-rose-500 to-orange-500 h-2 rounded-full transition-all duration-300 relative" 
                                style={{ width: `${hybridScrapeJob.progress}%` }}
                            >
                                <div className="absolute inset-0 bg-white/20 w-full animate-[shimmer_1.5s_infinite]"></div>
                            </div>
                        </div>
                        
                        <div className="text-[10px] text-slate-300 font-mono mb-4 p-2 bg-black/40 rounded border border-white/5 break-words">
                            {hybridScrapeJob.logs && hybridScrapeJob.logs.length > 0 ? hybridScrapeJob.logs[hybridScrapeJob.logs.length - 1] : 'Initializing engine...'}
                        </div>
                        
                        {['PENDING', 'RUNNING'].includes(hybridScrapeJob.status) ? (
                            <button 
                                onClick={onCancelCollector}
                                className="w-full py-2 rounded-lg border border-red-500/30 text-red-400 text-xs font-bold hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2"
                            >
                                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div> Stop Collection
                            </button>
                        ) : (
                            <div className={`text-center text-xs font-bold py-2 rounded-lg ${hybridScrapeJob.status === 'COMPLETED' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                                {hybridScrapeJob.status === 'COMPLETED' ? '✅ Dataset Compiled Successfully' : '❌ ' + (hybridScrapeJob.error_message || 'Stopped')}
                            </div>
                        )}
                    </motion.div>
                )}
            </div>
            
        </div>
    );
};
