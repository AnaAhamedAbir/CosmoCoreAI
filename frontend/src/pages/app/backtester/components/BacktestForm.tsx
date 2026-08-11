import React, { useState, useEffect } from 'react';
import { useBacktest } from '@/context/BacktestContext';
import SearchableSelect from '@/components/common/SearchableSelect';
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import {
    UploadCloud, RefreshCw, ShieldCheck, ShieldAlert, Wallet, Calendar, Clock, History,
    ChevronLeft, ChevronRight, PlusCircle, CheckSquare, Square
} from 'lucide-react';
import { StrategyBuilderModal } from './StrategyBuilderModal';
import { StrategyParams } from './StrategyParams';
import { getYear, getMonth } from 'date-fns';
import Button from '@/components/common/Button';
import { marketDataService } from '@/services/marketData';
import { SavedIndicator } from '@/types';

// Constants
const range = (start: number, end: number, step = 1) => {
    const result = [];
    for (let i = start; i <= end; i += step) {
        result.push(i);
    }
    return result;
};

const DEFAULT_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"];

interface BacktestFormProps {
    strategies: string[];
    customStrategies: string[];
    strategy: string;
    setStrategy: (s: string) => void;
    exchanges: string[];
    selectedExchange: string;
    setSelectedExchange: (e: string) => void;
    markets: string[];
    symbol: string;
    setSymbol: (s: string) => void;
    timeframe: string;
    setTimeframe: (t: string) => void;
    startDate: string;
    setStartDate: (d: string) => void;
    endDate: string;
    setEndDate: (d: string) => void;
    dataSource: 'database' | 'csv';
    setDataSource: (source: 'database' | 'csv') => void;
    handleDataFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    isUploadingData: boolean;
    dataFileInputRef: React.RefObject<HTMLInputElement>;
    // ❌ REMOVED: tradeFiles, selectedTradeFile, handleConvertTradesToCandles, isConverting
    csvFileName: string;
    handleSyncData: () => void;
    isSyncing: boolean;
    syncProgress: number;
    syncStatusText: string;
    enableRiskManagement: boolean;
    setEnableRiskManagement: (v: boolean) => void;
    initialCash: number;
    setInitialCash: (v: number) => void;
    mode: 'backtest' | 'optimization' | 'walk_forward' | 'batch';
    setMode: (m: 'backtest' | 'optimization' | 'walk_forward' | 'batch') => void;

    // WFA Specific State Props
    wfaTrainWindow: number;
    setWfaTrainWindow: (n: number) => void;
    wfaTestWindow: number;
    setWfaTestWindow: (n: number) => void;
    wfaMethod: string;
    setWfaMethod: (s: string) => void;
    wfaPopSize: number;
    setWfaPopSize: (n: number) => void;
    wfaGenerations: number;
    setWfaGenerations: (n: number) => void;
    wfaOptTarget: string;
    setWfaOptTarget: (s: string) => void;
    wfaMinTrades: number;
    setWfaMinTrades: (n: number) => void;

    // Batch Props
    batchStrategies: string[];
    setBatchStrategies: (list: string[]) => void;

    // Params Props
    activeTab: string;
    params: any; setParams: any;
    optimizationParams: any; setOptimizationParams: any;
    optimizableParams: any;
    optimizationMethod: any; setOptimizationMethod: any;
    gaParams: any; setGaParams: any;
    // New Props for Indicators
    savedIndicators: SavedIndicator[];
    selectedIndicatorId: number | null;
    setSelectedIndicatorId: (id: number | null) => void;
}

export const BacktestForm: React.FC<BacktestFormProps> = ({
    strategies,
    customStrategies,
    strategy,
    setStrategy,
    exchanges,
    selectedExchange,
    setSelectedExchange,
    markets,
    symbol,
    setSymbol,
    timeframe,
    setTimeframe,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    dataSource,
    setDataSource,
    handleDataFileUpload,
    isUploadingData,
    dataFileInputRef,
    // ❌ REMOVED: Convert props from destructuring
    csvFileName,
    handleSyncData,
    isSyncing,
    syncProgress,
    syncStatusText,
    enableRiskManagement,
    setEnableRiskManagement,
    initialCash,
    setInitialCash,
    mode, setMode,
    wfaTrainWindow, setWfaTrainWindow,
    wfaTestWindow, setWfaTestWindow,
    wfaMethod, setWfaMethod,
    wfaPopSize, setWfaPopSize,
    wfaGenerations, setWfaGenerations,
    wfaOptTarget, setWfaOptTarget,
    wfaMinTrades, setWfaMinTrades,
    batchStrategies, setBatchStrategies,
    activeTab,
    params, setParams,
    optimizationParams, setOptimizationParams,

    optimizableParams,
    optimizationMethod, setOptimizationMethod,
    gaParams, setGaParams,
    savedIndicators, selectedIndicatorId, setSelectedIndicatorId
}) => {
    const {
        commission, setCommission,
        slippage, setSlippage,
        leverage, setLeverage,
        secondaryTimeframe, setSecondaryTimeframe,
        stopLoss, setStopLoss,
        takeProfit, setTakeProfit,
        trailingStop, setTrailingStop
    } = useBacktest();

    const [availableTimeframes, setAvailableTimeframes] = useState<string[]>(DEFAULT_TIMEFRAMES);
    const [isLoadingTimeframes, setIsLoadingTimeframes] = useState(false);
    const [isBuilderOpen, setIsBuilderOpen] = useState(false);
    const [activeConfigTab, setActiveConfigTab] = useState<'general' | 'strategy' | 'risk'>('general');

    useEffect(() => {
        const fetchTimeframes = async () => {
            if (!selectedExchange) return;
            setIsLoadingTimeframes(true);
            try {
                const tfs = await marketDataService.getExchangeTimeframes(selectedExchange);
                setAvailableTimeframes(tfs);
            } catch (error) {
                console.error("Failed to fetch timeframes:", error);
                setAvailableTimeframes(DEFAULT_TIMEFRAMES);
            } finally {
                setIsLoadingTimeframes(false);
            }
        };
        fetchTimeframes();
    }, [selectedExchange]);

    const toggleBatchStrategy = (strat: string) => {
        if (batchStrategies.includes(strat)) {
            setBatchStrategies(batchStrategies.filter(s => s !== strat));
        } else {
            setBatchStrategies([...batchStrategies, strat]);
        }
    };

    const safeStrategies = strategies || [];
    const safeCustomStrategies = customStrategies || [];
    const uniqueCustomStrategies = safeCustomStrategies.filter(s => !safeStrategies.includes(s));
    const allBatchStrategies = Array.from(new Set([...safeStrategies, ...safeCustomStrategies]));

    const inputBaseClasses = "w-full bg-white dark:bg-[#0A0A0A]/50 border border-brand-border-light dark:border-[#1A1A1A] rounded-md p-2 text-slate-900 dark:text-white focus:ring-brand-primary focus:border-brand-primary";

    const handlePresetChange = (days: number) => {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - days);
        setEndDate(end.toISOString().split('T')[0]);
        setStartDate(start.toISOString().split('T')[0]);
    };

    const presetOptions = [
        { label: '1W', days: 7 },
        { label: '1M', days: 30 },
        { label: '3M', days: 90 },
        { label: '6M', days: 180 },
        { label: '1Y', days: 365 },
        { label: 'YTD', days: Math.floor((new Date().getTime() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (1000 * 60 * 60 * 24)) },
    ];

    const CustomInputHeader = ({
        date, changeYear, changeMonth, decreaseMonth, increaseMonth, prevMonthButtonDisabled, nextMonthButtonDisabled,
    }: any) => {
        const years = range(1990, getYear(new Date()) + 1, 1);
        const months = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ];
        return (
            <div className="m-2 flex items-center justify-between px-2 py-2 bg-white dark:bg-[#0A0A0A] rounded-lg border-b border-gray-200 dark:border-gray-700">
                <button onClick={decreaseMonth} disabled={prevMonthButtonDisabled} className="p-1 hover:bg-gray-100 dark:hover:bg-[#0A0A0A] rounded-full text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-50" type="button"><ChevronLeft size={18} /></button>
                <div className="flex gap-2">
                    <select value={months[getMonth(date)]} onChange={({ target: { value } }) => changeMonth(months.indexOf(value))} className="bg-transparent text-sm font-bold text-slate-800 dark:text-white cursor-pointer focus:outline-none hover:text-brand-primary dark:hover:text-brand-primary transition-colors appearance-none text-center">
                        {months.map((option) => (<option key={option} value={option} className="bg-white dark:bg-[#0A0A0A] text-slate-900 dark:text-white">{option}</option>))}
                    </select>
                    <select value={getYear(date)} onChange={({ target: { value } }) => changeYear(Number(value))} className="bg-transparent text-sm font-bold text-slate-800 dark:text-white cursor-pointer focus:outline-none hover:text-brand-primary dark:hover:text-brand-primary transition-colors appearance-none text-center">
                        {years.map((option) => (<option key={option} value={option} className="bg-white dark:bg-[#0A0A0A] text-slate-900 dark:text-white">{option}</option>))}
                    </select>
                </div>
                <button onClick={increaseMonth} disabled={nextMonthButtonDisabled} className="p-1 hover:bg-gray-100 dark:hover:bg-[#0A0A0A] rounded-full text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-50" type="button"><ChevronRight size={18} /></button>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full space-y-4">
            {/* Header Tabs */}
            <div className="flex bg-slate-100 dark:bg-[#111] p-1 rounded-lg shrink-0">
                <button onClick={() => setActiveConfigTab('general')} className={`flex-1 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-md transition-all ${activeConfigTab === 'general' ? 'bg-white dark:bg-[#222] shadow-sm text-brand-primary' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>General</button>
                <button onClick={() => setActiveConfigTab('strategy')} className={`flex-1 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-md transition-all ${activeConfigTab === 'strategy' ? 'bg-white dark:bg-[#222] shadow-sm text-brand-primary' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Strategy</button>
                <button onClick={() => setActiveConfigTab('risk')} className={`flex-1 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-md transition-all ${activeConfigTab === 'risk' ? 'bg-white dark:bg-[#222] shadow-sm text-brand-primary' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Risk</button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 pb-4">
                {activeConfigTab === 'general' && (
                    <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
                        {/* Sync Data Header */}
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Environment</label>
                            <Button variant="secondary" onClick={handleSyncData} disabled={isSyncing} className={`py-1 px-2 text-[10px] h-auto ${isSyncing ? 'bg-blue-50 text-blue-600' : ''}`}>
                                {isSyncing ? (<RefreshCw className="animate-spin" size={12} />) : (<UploadCloud size={12} />)} Sync
                            </Button>
                        </div>
                        
                        {/* Sync Progress */}
                        {isSyncing && (
                            <div className="p-2 rounded-lg border border-blue-100 dark:border-blue-900/30 bg-blue-50/50 dark:bg-blue-900/10">
                                <div className="flex justify-between items-center mb-1 text-[10px]">
                                    <span className="font-semibold text-blue-600">{syncStatusText}</span>
                                    <span className="font-bold text-blue-600">{syncProgress}%</span>
                                </div>
                                <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded-full"><div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${syncProgress}%` }} /></div>
                            </div>
                        )}

                        <div className="space-y-3">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Data Source</label>
                            <div className="flex gap-2">
                                <button onClick={() => setDataSource('database')} className={`flex-1 p-2 rounded-lg border text-xs font-medium transition-all flex flex-col items-center gap-1 ${dataSource === 'database' ? 'border-brand-primary bg-brand-primary/10 text-brand-primary' : 'border-slate-200 dark:border-[#1F1F1F] text-slate-600 dark:text-slate-400'}`}>
                                    <span className="text-lg">🗄️</span> Exchange
                                </button>
                                <button onClick={() => setDataSource('csv')} className={`flex-1 p-2 rounded-lg border text-xs font-medium transition-all flex flex-col items-center gap-1 ${dataSource === 'csv' ? 'border-brand-primary bg-brand-primary/10 text-brand-primary' : 'border-slate-200 dark:border-[#1F1F1F] text-slate-600 dark:text-slate-400'}`}>
                                    <span className="text-lg">📂</span> CSV
                                </button>
                            </div>
                        </div>

                        {dataSource === 'database' ? (
                            <div className="space-y-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Exchange</label>
                                    <select className={`${inputBaseClasses} text-sm`} value={selectedExchange} onChange={(e) => setSelectedExchange(e.target.value)}>
                                        {exchanges.map(ex => <option key={ex} value={ex}>{ex.toUpperCase()}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <SearchableSelect label="Market Pair" options={markets} value={symbol} onChange={setSymbol} />
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Upload Data (CSV)</label>
                                <input type="file" ref={dataFileInputRef} onChange={handleDataFileUpload} className="hidden" accept=".csv" />
                                <Button variant="outline" onClick={() => dataFileInputRef.current?.click()} className="w-full text-xs border-dashed">
                                    <UploadCloud size={14} className="mr-2"/> {isUploadingData ? 'Uploading...' : 'Choose CSV'}
                                </Button>
                                {csvFileName && <p className="text-[10px] text-green-500 truncate">✅ {csvFileName}</p>}
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Timeframe {isLoadingTimeframes && '*'}</label>
                                <select className={`${inputBaseClasses} text-sm`} value={timeframe} onChange={(e) => setTimeframe(e.target.value)} disabled={isLoadingTimeframes}>
                                    {availableTimeframes.map(t => (<option key={t} value={t}>{t}</option>))}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Sec TF</label>
                                <select className={`${inputBaseClasses} text-sm`} value={secondaryTimeframe} onChange={(e) => setSecondaryTimeframe(e.target.value)}>
                                    <option value="">None</option>
                                    {availableTimeframes.map(t => (<option key={t} value={t}>{t}</option>))}
                                </select>
                            </div>
                        </div>

                        <div className="space-y-2 bg-slate-50 dark:bg-[#111] p-3 rounded-lg border border-slate-200 dark:border-[#1F1F1F]">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5"><History size={12}/> Time Horizon</label>
                            
                            <div className="grid grid-cols-3 gap-1 bg-white dark:bg-[#050505] rounded border border-slate-200 dark:border-[#1F1F1F] p-0.5 mb-2">
                                {presetOptions.map((option) => (<button key={option.label} onClick={() => handlePresetChange(option.days)} className="py-1 text-[10px] font-medium rounded hover:bg-slate-100 dark:hover:bg-[#1F1F1F] transition-colors">{option.label}</button>))}
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-[10px] text-slate-500 block mb-0.5">Start</label>
                                    <DatePicker selected={startDate ? new Date(startDate) : null} onChange={(date: Date) => setStartDate(date?.toISOString().split('T')[0] || '')} className={`${inputBaseClasses} text-xs py-1.5 w-full`} dateFormat="yyyy-MM-dd" renderCustomHeader={CustomInputHeader} />
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 block mb-0.5">End</label>
                                    <DatePicker selected={endDate ? new Date(endDate) : null} onChange={(date: Date) => setEndDate(date?.toISOString().split('T')[0] || '')} className={`${inputBaseClasses} text-xs py-1.5 w-full`} dateFormat="yyyy-MM-dd" renderCustomHeader={CustomInputHeader} />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeConfigTab === 'strategy' && (
                    <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
                        {mode !== 'batch' ? (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider block">Saved Indicator (Opt)</label>
                                    <select className={`${inputBaseClasses} text-sm border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/30 dark:bg-indigo-900/10`} value={selectedIndicatorId || ''} onChange={(e) => setSelectedIndicatorId(e.target.value ? Number(e.target.value) : null)}>
                                        <option value="">-- Use Strategy --</option>
                                        {savedIndicators.map(ind => <option key={ind.id} value={ind.id}>{ind.name}</option>)}
                                    </select>
                                </div>

                                <div className={`space-y-2 transition-opacity ${selectedIndicatorId ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                                    <div className="flex justify-between items-center">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Strategy</label>
                                        <button onClick={() => setIsBuilderOpen(true)} className="text-[10px] text-brand-primary flex items-center gap-1 font-bold"><PlusCircle size={10}/> New</button>
                                    </div>
                                    <select className={`${inputBaseClasses} text-sm`} value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                                        <optgroup label="Library">{safeStrategies.map(s => <option key={`lib-${s}`} value={s}>{s}</option>)}</optgroup>
                                        {uniqueCustomStrategies.length > 0 && <optgroup label="Custom">{uniqueCustomStrategies.map(s => <option key={`cust-${s}`} value={s}>{s}</option>)}</optgroup>}
                                    </select>
                                </div>

                                <div className="pt-2 border-t border-slate-100 dark:border-[#1F1F1F]">
                                    <StrategyParams mode={(mode === 'optimization' || mode === 'walk_forward') ? 'optimization' : 'single'} activeParamsConfig={optimizableParams} params={params} setParams={setParams} optimizationParams={optimizationParams} setOptimizationParams={setOptimizationParams} optimizationMethod={optimizationMethod} setOptimizationMethod={setOptimizationMethod} hideOptimizationMethod={mode === 'walk_forward'} gaParams={gaParams} setGaParams={setGaParams} />
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Batch Strategies</label>
                                <div className="h-48 overflow-y-auto border border-slate-200 dark:border-[#1F1F1F] rounded p-2 bg-slate-50 dark:bg-[#111] space-y-1 custom-scrollbar">
                                    {allBatchStrategies.map(s => (
                                        <div key={s} onClick={() => toggleBatchStrategy(s)} className={`flex items-center gap-2 p-1.5 rounded cursor-pointer text-xs ${batchStrategies.includes(s) ? 'bg-brand-primary/10 text-brand-primary' : 'hover:bg-slate-200 dark:hover:bg-[#1F1F1F]'}`}>
                                            {batchStrategies.includes(s) ? <CheckSquare size={12}/> : <Square size={12}/>} <span className="truncate">{s}</span>
                                        </div>
                                    ))}
                                    {allBatchStrategies.length === 0 && <div className="text-xs text-gray-500 text-center py-4">No strategies found</div>}
                                </div>
                                <div className="flex justify-between items-center mt-1 px-1">
                                    <span className="text-[10px] font-medium text-slate-500">Selected: {batchStrategies.length}</span>
                                    <div className="flex gap-2">
                                        <button onClick={() => setBatchStrategies(allBatchStrategies)} className="text-[10px] text-brand-primary hover:underline font-bold">Select All</button>
                                        <button onClick={() => setBatchStrategies([])} className="text-[10px] text-slate-500 hover:underline">Clear</button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {mode === 'walk_forward' && (
                            <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-[#1F1F1F]">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">WFA Config</label>
                                <div className="grid grid-cols-2 gap-3">
                                    <div><label className="text-[10px] text-slate-500 block mb-1">Train Window</label><input type="number" value={wfaTrainWindow} onChange={(e) => setWfaTrainWindow(Number(e.target.value))} className={`${inputBaseClasses} py-1.5 text-xs`} /></div>
                                    <div><label className="text-[10px] text-slate-500 block mb-1">Test Window</label><input type="number" value={wfaTestWindow} onChange={(e) => setWfaTestWindow(Number(e.target.value))} className={`${inputBaseClasses} py-1.5 text-xs`} /></div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeConfigTab === 'risk' && (
                    <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-[#111] rounded-lg border border-slate-200 dark:border-[#1F1F1F]">
                            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                {enableRiskManagement ? <ShieldCheck size={14} className="text-green-500" /> : <ShieldAlert size={14} className="text-gray-400" />}
                                Enable Risk Mgt
                            </label>
                            <input type="checkbox" checked={enableRiskManagement} onChange={(e) => setEnableRiskManagement(e.target.checked)} className="w-4 h-4 accent-brand-primary" />
                        </div>
                        
                        <div className={`space-y-4 transition-opacity ${enableRiskManagement ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Initial Cash ($)</label>
                                <input type="number" value={initialCash} onChange={(e) => setInitialCash(Number(e.target.value))} className={`${inputBaseClasses} text-lg font-mono font-bold text-green-600 dark:text-green-400`} />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Commission %</label><input type="number" step="0.01" value={commission} onChange={(e) => setCommission(parseFloat(e.target.value))} className={`${inputBaseClasses} text-sm`} /></div>
                                <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Slippage %</label><input type="number" step="0.01" value={slippage} onChange={(e) => setSlippage(parseFloat(e.target.value))} className={`${inputBaseClasses} text-sm`} /></div>
                            </div>

                            <div className="p-3 bg-slate-50 dark:bg-[#111] rounded-lg border border-slate-200 dark:border-[#1F1F1F] space-y-2">
                                <div className="flex justify-between items-center">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Leverage</label>
                                    <span className="text-xs font-bold text-brand-primary">{leverage}x</span>
                                </div>
                                <input type="range" min="1" max="125" step="1" value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} className="w-full accent-brand-primary" />
                                <div className="text-[9px] text-slate-400 flex justify-between"><span>Spot (1x)</span><span>Futures (125x)</span></div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <StrategyBuilderModal isOpen={isBuilderOpen} onClose={() => setIsBuilderOpen(false)} onSuccess={() => { window.location.reload(); }} />
        </div>
    );
}
