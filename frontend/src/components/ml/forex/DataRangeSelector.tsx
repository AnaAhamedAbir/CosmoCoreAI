import React, { useState, useEffect } from 'react';
import { Calendar, Hash, AlertTriangle, CheckCircle2, Clock, HardDrive, ShieldCheck, Loader2 } from 'lucide-react';
import apiClient from '@/services/client';

interface DataRangeSelectorProps {
    dateRangeMode: 'ticks' | 'date';
    setDateRangeMode: (mode: 'ticks' | 'date') => void;
    targetRows: number;
    setTargetRows: (rows: number) => void;
    startDate: string;
    setStartDate: (date: string) => void;
    endDate: string;
    setEndDate: (date: string) => void;
    isTraining: boolean;
    timeframe: string;
    symbol: string;
}

export const DataRangeSelector: React.FC<DataRangeSelectorProps> = ({
    dateRangeMode,
    setDateRangeMode,
    targetRows,
    setTargetRows,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    isTraining,
    timeframe,
    symbol
}) => {
    const [isCheckingQuality, setIsCheckingQuality] = useState(false);
    const [qualityResult, setQualityResult] = useState<{status: 'ok' | 'warning' | 'error', message: string} | null>(null);

    const PRESET_TICKS = [10000, 50000, 100000, 500000];
    
    // Preset Dates functions
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

    const handleCheckDataQuality = async () => {
        setIsCheckingQuality(true);
        setQualityResult(null);
        
        try {
            const payload = {
                symbol,
                timeframe,
                mode: dateRangeMode,
                target_rows: targetRows,
                start_date: startDate,
                end_date: endDate
            };
            
            const res = await apiClient.post('/forex-model-training/check-data-quality', payload);
            setQualityResult({
                status: res.data.status,
                message: res.data.message
            });
        } catch (error: any) {
            setQualityResult({ 
                status: 'error', 
                message: error.response?.data?.detail || 'Failed to verify data quality.' 
            });
        } finally {
            setIsCheckingQuality(false);
        }
    };

    // Calculate Estimates
    const calculateEstimates = () => {
        let estimatedRows = targetRows;
        
        if (dateRangeMode === 'date') {
            const s = new Date(startDate).getTime();
            const e = new Date(endDate).getTime();
            const days = Math.max(0, (e - s) / (1000 * 3600 * 24));
            
            let rowsPerDay = 24; 
            if (timeframe === '1m') rowsPerDay = 1440;
            if (timeframe === '5m') rowsPerDay = 288;
            if (timeframe === '15m') rowsPerDay = 96;
            if (timeframe === '30m') rowsPerDay = 48;
            if (timeframe === '1d') rowsPerDay = 1;
            
            estimatedRows = Math.floor(days * rowsPerDay * 0.71);
        }
        
        const sizeMb = (estimatedRows * 100) / (1024 * 1024); // approx 100 bytes per row with basic features
        const timeSecs = Math.max(5, Math.floor(estimatedRows / 5000)); // Rough estimate
        
        return {
            rows: estimatedRows,
            size: sizeMb < 1 ? sizeMb.toFixed(2) : Math.round(sizeMb),
            time: timeSecs > 60 ? `${(timeSecs/60).toFixed(1)} mins` : `${timeSecs} secs`
        };
    };

    const est = calculateEstimates();

    return (
        <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-300">Historical Data Range</label>
            
            <div className="flex bg-black/40 rounded-xl p-1 border border-white/5">
                <button
                    onClick={() => setDateRangeMode('ticks')}
                    disabled={isTraining}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${dateRangeMode === 'ticks' ? 'bg-teal-500/20 text-teal-400' : 'text-slate-400 hover:text-white'}`}
                >
                    <Hash className="w-4 h-4" /> Fixed Ticks
                </button>
                <button
                    onClick={() => setDateRangeMode('date')}
                    disabled={isTraining}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${dateRangeMode === 'date' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-400 hover:text-white'}`}
                >
                    <Calendar className="w-4 h-4" /> Date Range
                </button>
            </div>

            <div className="bg-white/5 border border-white/5 rounded-xl p-4 space-y-4">
                {dateRangeMode === 'ticks' ? (
                    <div className="space-y-3 animate-in fade-in zoom-in duration-300">
                        <input 
                            type="number" 
                            value={targetRows} 
                            onChange={e => setTargetRows(parseInt(e.target.value) || 0)}
                            disabled={isTraining}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:ring-2 focus:ring-teal-500/50 outline-none"
                        />
                        <div className="flex gap-2 flex-wrap">
                            {PRESET_TICKS.map(ticks => (
                                <button
                                    key={ticks}
                                    onClick={() => setTargetRows(ticks)}
                                    disabled={isTraining}
                                    className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${targetRows === ticks ? 'bg-teal-500/20 border-teal-500/30 text-teal-300' : 'bg-transparent border-white/10 text-slate-400 hover:text-white'}`}
                                >
                                    {ticks >= 1000 ? `${ticks/1000}k` : ticks}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3 animate-in fade-in zoom-in duration-300">
                        <div className="flex gap-4">
                            <div className="flex-1">
                                <label className="block text-xs text-slate-400 mb-1">Start Date</label>
                                <input 
                                    type="date"
                                    value={startDate}
                                    onChange={e => setStartDate(e.target.value)}
                                    disabled={isTraining}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                />
                            </div>
                            <div className="flex-1">
                                <label className="block text-xs text-slate-400 mb-1">End Date</label>
                                <input 
                                    type="date"
                                    value={endDate}
                                    onChange={e => setEndDate(e.target.value)}
                                    disabled={isTraining}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                />
                            </div>
                        </div>
                        <div className="flex gap-2 flex-wrap pt-2">
                            <button onClick={() => setPresetDate(1)} disabled={isTraining} className="px-2 py-1 bg-white/5 hover:bg-white/10 rounded-lg text-xs text-slate-300 transition-colors">Last 1 Year</button>
                            <button onClick={() => setPresetDate(5)} disabled={isTraining} className="px-2 py-1 bg-white/5 hover:bg-white/10 rounded-lg text-xs text-slate-300 transition-colors">Last 5 Years</button>
                            <button onClick={() => setPresetDate(0, '2020-02-01', '2020-05-31')} disabled={isTraining} className="px-2 py-1 bg-red-500/10 text-red-300 hover:bg-red-500/20 rounded-lg text-xs transition-colors">COVID Volatility</button>
                            <button onClick={() => setPresetDate(0, '2008-01-01', '2009-12-31')} disabled={isTraining} className="px-2 py-1 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20 rounded-lg text-xs transition-colors">2008 Crisis</button>
                        </div>
                        {timeframe === '1m' && est.rows > 500000 && (
                            <div className="bg-orange-500/10 border border-orange-500/20 text-orange-400 p-2 rounded-lg text-xs flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                <span>Using 1m timeframe for a large date range may cause memory issues or take excessively long to train. Consider 15m or 1H.</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
            
            {/* Estimator & Actions */}
            <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-4 text-xs text-slate-400">
                    <span className="flex items-center gap-1"><HardDrive className="w-3.5 h-3.5" /> ~{est.size} MB</span>
                    <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Est. {est.time}</span>
                </div>
                
                <button
                    onClick={handleCheckDataQuality}
                    disabled={isCheckingQuality || isTraining}
                    className="text-xs font-medium text-emerald-400 hover:text-emerald-300 flex items-center gap-1 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-1.5 rounded-lg transition-colors cursor-pointer"
                >
                    {isCheckingQuality ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                    Check Quality
                </button>
            </div>
            
            {qualityResult && (
                <div className={`p-3 rounded-xl text-xs flex items-start gap-2 animate-in fade-in slide-in-from-bottom-2 ${
                    qualityResult.status === 'ok' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                    qualityResult.status === 'warning' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20' :
                    'bg-red-500/10 text-red-400 border border-red-500/20'
                }`}>
                    {qualityResult.status === 'ok' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
                    <span>{qualityResult.message}</span>
                </div>
            )}
        </div>
    );
};
