import React, { useState, useEffect } from 'react';
import { useBacktest } from '@/context/BacktestContext';
import SearchableSelect from '@/components/common/SearchableSelect';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import {
    UploadCloud, RefreshCw, ShieldCheck, ShieldAlert, History,
    ChevronLeft, ChevronRight, ChevronDown, PlusCircle, CheckSquare, Square,
    Globe, Cpu, Sliders, Crosshair
} from 'lucide-react';
import { StrategyBuilderModal } from './StrategyBuilderModal';
import { StrategyParams } from './StrategyParams';
import { getYear, getMonth, format } from 'date-fns';
import Button from '@/components/common/Button';
import { marketDataService } from '@/services/marketData';
import { SavedIndicator } from '@/types';

const range = (start: number, end: number, step = 1) => {
    const result = [];
    for (let i = start; i <= end; i += step) result.push(i);
    return result;
};

const DEFAULT_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

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

    batchStrategies: string[];
    setBatchStrategies: (list: string[]) => void;

    activeTab: string;
    params: any;
    setParams: any;
    optimizationParams: any;
    setOptimizationParams: any;
    optimizableParams: any;
    optimizationMethod: any;
    setOptimizationMethod: any;
    gaParams: any;
    setGaParams: any;
    savedIndicators: SavedIndicator[];
    selectedIndicatorId: number | null;
    setSelectedIndicatorId: (id: number | null) => void;
    onStrategyCreated?: () => void;
}

const AccordionSection: React.FC<{
    title: string;
    badge?: string;
    icon: React.ReactNode;
    isOpen: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}> = ({ title, badge, icon, isOpen, onToggle, children }) => (
    <div className="border border-slate-200 dark:border-[#1F1F1F] rounded-xl bg-white dark:bg-[#0A0A0A] overflow-hidden">
        <button
            type="button"
            onClick={onToggle}
            className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-[#111] transition-colors"
        >
            <div className="flex items-center gap-2 min-w-0">
                <span className="text-brand-primary shrink-0">{icon}</span>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 truncate">
                    {title}
                </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                {badge && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#161616] text-slate-500 dark:text-slate-400">
                        {badge}
                    </span>
                )}
                <ChevronDown
                    size={14}
                    className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                />
            </div>
        </button>
        {isOpen && <div className="px-3 pb-3 pt-1 border-t border-slate-100 dark:border-[#1A1A1A] space-y-3">{children}</div>}
    </div>
);

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
    csvFileName,
    handleSyncData,
    isSyncing,
    syncProgress,
    syncStatusText,
    enableRiskManagement,
    setEnableRiskManagement,
    initialCash,
    setInitialCash,
    mode,
    wfaTrainWindow,
    setWfaTrainWindow,
    wfaTestWindow,
    setWfaTestWindow,
    wfaMethod,
    setWfaMethod,
    wfaPopSize,
    setWfaPopSize,
    wfaGenerations,
    setWfaGenerations,
    wfaOptTarget,
    setWfaOptTarget,
    wfaMinTrades,
    setWfaMinTrades,
    batchStrategies,
    setBatchStrategies,
    params,
    setParams,
    optimizationParams,
    setOptimizationParams,
    optimizableParams,
    optimizationMethod,
    setOptimizationMethod,
    gaParams,
    setGaParams,
    savedIndicators,
    selectedIndicatorId,
    setSelectedIndicatorId,
    onStrategyCreated,
}) => {
    const {
        commission, setCommission,
        slippage, setSlippage,
        leverage, setLeverage,
        secondaryTimeframe, setSecondaryTimeframe,
        stopLoss, setStopLoss,
        takeProfit, setTakeProfit,
        trailingStop, setTrailingStop,
        positionSizing, setPositionSizing,
        positionSizeValue, setPositionSizeValue,
        direction, setDirection,
    } = useBacktest();

    const [availableTimeframes, setAvailableTimeframes] = useState<string[]>(DEFAULT_TIMEFRAMES);
    const [isLoadingTimeframes, setIsLoadingTimeframes] = useState(false);
    const [isBuilderOpen, setIsBuilderOpen] = useState(false);
    const [openSections, setOpenSections] = useState({
        market: true,
        strategy: true,
        execution: false,
        risk: true,
    });

    const toggleSection = (key: keyof typeof openSections) => {
        setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    useEffect(() => {
        const fetchTimeframes = async () => {
            if (!selectedExchange) return;
            setIsLoadingTimeframes(true);
            try {
                const tfs = await marketDataService.getExchangeTimeframes(selectedExchange);
                setAvailableTimeframes(tfs);
            } catch {
                setAvailableTimeframes(DEFAULT_TIMEFRAMES);
            } finally {
                setIsLoadingTimeframes(false);
            }
        };
        fetchTimeframes();
    }, [selectedExchange]);

    const toggleBatchStrategy = (strat: string) => {
        if (batchStrategies.includes(strat)) {
            setBatchStrategies(batchStrategies.filter((s) => s !== strat));
        } else {
            setBatchStrategies([...batchStrategies, strat]);
        }
    };

    const safeStrategies = strategies || [];
    const safeCustomStrategies = customStrategies || [];
    const uniqueCustomStrategies = safeCustomStrategies.filter((s) => !safeStrategies.includes(s));
    const allBatchStrategies = Array.from(new Set([...safeStrategies, ...safeCustomStrategies]));

    const inputBaseClasses = 'w-full bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F] rounded-md px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:ring-1 focus:ring-brand-primary focus:border-brand-primary outline-none';

    const handlePresetChange = (days: number) => {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - days);
        setEndDate(format(end, 'yyyy-MM-dd'));
        setStartDate(format(start, 'yyyy-MM-dd'));
    };

    const presetOptions = [
        { label: '1W', days: 7 },
        { label: '1M', days: 30 },
        { label: '3M', days: 90 },
        { label: '6M', days: 180 },
        { label: '1Y', days: 365 },
        { label: 'YTD', days: Math.max(1, Math.floor((new Date().getTime() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000)) },
    ];

    const CustomInputHeader = ({
        date, changeYear, changeMonth, decreaseMonth, increaseMonth, prevMonthButtonDisabled, nextMonthButtonDisabled,
    }: any) => {
        const years = range(1990, getYear(new Date()) + 1, 1);
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        return (
            <div className="m-2 flex items-center justify-between px-2 py-2 bg-white dark:bg-[#0A0A0A] rounded-lg border-b border-gray-200 dark:border-gray-700">
                <button onClick={decreaseMonth} disabled={prevMonthButtonDisabled} className="p-1 rounded-full text-slate-600 dark:text-slate-300 disabled:opacity-50" type="button"><ChevronLeft size={16} /></button>
                <div className="flex gap-2">
                    <select value={months[getMonth(date)]} onChange={({ target: { value } }) => changeMonth(months.indexOf(value))} className="bg-transparent text-xs font-bold text-slate-800 dark:text-white cursor-pointer outline-none">
                        {months.map((option) => <option key={option} value={option} className="bg-white dark:bg-[#0A0A0A]">{option}</option>)}
                    </select>
                    <select value={getYear(date)} onChange={({ target: { value } }) => changeYear(Number(value))} className="bg-transparent text-xs font-bold text-slate-800 dark:text-white cursor-pointer outline-none">
                        {years.map((option) => <option key={option} value={option} className="bg-white dark:bg-[#0A0A0A]">{option}</option>)}
                    </select>
                </div>
                <button onClick={increaseMonth} disabled={nextMonthButtonDisabled} className="p-1 rounded-full text-slate-600 dark:text-slate-300 disabled:opacity-50" type="button"><ChevronRight size={16} /></button>
            </div>
        );
    };

    const riskRewardRatio = stopLoss > 0 && takeProfit > 0 ? (takeProfit / stopLoss).toFixed(2) : null;

    return (
        <div className="flex flex-col space-y-2.5 pb-4">
            {/* 1. Market & Horizon */}
            <AccordionSection
                title="1. Market & Horizon"
                badge={`${dataSource === 'csv' ? 'CSV' : symbol} • ${timeframe}`}
                icon={<Globe size={14} />}
                isOpen={openSections.market}
                onToggle={() => toggleSection('market')}
            >
                <div className="flex items-center justify-between">
                    <div className="flex gap-1 bg-slate-100 dark:bg-[#111] p-0.5 rounded-md border border-slate-200 dark:border-[#1F1F1F]">
                        <button
                            type="button"
                            onClick={() => setDataSource('database')}
                            className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all ${dataSource === 'database' ? 'bg-white dark:bg-[#222] text-brand-primary shadow-sm' : 'text-slate-500'}`}
                        >
                            Exchange
                        </button>
                        <button
                            type="button"
                            onClick={() => setDataSource('csv')}
                            className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all ${dataSource === 'csv' ? 'bg-white dark:bg-[#222] text-brand-primary shadow-sm' : 'text-slate-500'}`}
                        >
                            CSV Feed
                        </button>
                    </div>
                    <Button variant="secondary" onClick={handleSyncData} disabled={isSyncing} className="py-1 px-2 text-[10px] h-auto">
                        {isSyncing ? <RefreshCw className="animate-spin mr-1" size={11} /> : <UploadCloud className="mr-1" size={11} />}
                        Sync
                    </Button>
                </div>

                {isSyncing && (
                    <div className="p-2 rounded-lg border border-blue-500/20 bg-blue-500/5">
                        <div className="flex justify-between items-center mb-1 text-[10px]">
                            <span className="font-semibold text-blue-400 truncate">{syncStatusText}</span>
                            <span className="font-mono font-bold text-blue-400">{syncProgress}%</span>
                        </div>
                        <div className="h-1 bg-slate-200 dark:bg-[#1F1F1F] rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 transition-all" style={{ width: `${syncProgress}%` }} />
                        </div>
                    </div>
                )}

                {dataSource === 'database' ? (
                    <div className="grid grid-cols-1 gap-2">
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Exchange</label>
                            <select className={inputBaseClasses} value={selectedExchange} onChange={(e) => setSelectedExchange(e.target.value)}>
                                {exchanges.map((ex) => <option key={ex} value={ex}>{ex.toUpperCase()}</option>)}
                            </select>
                        </div>
                        <div>
                            <SearchableSelect label="Market Pair" options={markets} value={symbol} onChange={setSymbol} />
                        </div>
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        <input type="file" ref={dataFileInputRef} onChange={handleDataFileUpload} className="hidden" accept=".csv" />
                        <Button variant="outline" onClick={() => dataFileInputRef.current?.click()} className="w-full text-xs border-dashed py-2">
                            <UploadCloud size={13} className="mr-1.5" /> {isUploadingData ? 'Uploading...' : 'Upload OHLCV CSV'}
                        </Button>
                        {csvFileName && <p className="text-[10px] text-emerald-500 font-mono truncate">Loaded: {csvFileName}</p>}
                    </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Primary TF {isLoadingTimeframes && '*'}</label>
                        <select className={inputBaseClasses} value={timeframe} onChange={(e) => setTimeframe(e.target.value)} disabled={isLoadingTimeframes}>
                            {availableTimeframes.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">MTF Confirm</label>
                        <select className={inputBaseClasses} value={secondaryTimeframe} onChange={(e) => setSecondaryTimeframe(e.target.value)}>
                            <option value="">None</option>
                            {availableTimeframes.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                </div>

                <div className="space-y-2 bg-slate-50 dark:bg-[#111] p-2.5 rounded-lg border border-slate-200 dark:border-[#1F1F1F]">
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1"><History size={11} /> Date Range</label>
                    </div>
                    <div className="grid grid-cols-6 gap-1">
                        {presetOptions.map((option) => (
                            <button
                                key={option.label}
                                type="button"
                                onClick={() => handlePresetChange(option.days)}
                                className="py-1 text-[10px] font-mono font-semibold rounded bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] hover:border-brand-primary transition-colors"
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-0.5">Start</label>
                            <DatePicker selected={startDate ? new Date(`${startDate}T00:00:00`) : null} onChange={(date: Date | null) => setStartDate(date ? format(date, 'yyyy-MM-dd') : '')} className={`${inputBaseClasses} font-mono`} dateFormat="yyyy-MM-dd" renderCustomHeader={CustomInputHeader} />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-0.5">End</label>
                            <DatePicker selected={endDate ? new Date(`${endDate}T00:00:00`) : null} onChange={(date: Date | null) => setEndDate(date ? format(date, 'yyyy-MM-dd') : '')} className={`${inputBaseClasses} font-mono`} dateFormat="yyyy-MM-dd" renderCustomHeader={CustomInputHeader} />
                        </div>
                    </div>
                </div>
            </AccordionSection>

            {/* 2. Strategy & Parameters */}
            <AccordionSection
                title="2. Strategy & Params"
                badge={mode === 'batch' ? `${batchStrategies.length} selected` : strategy || 'Select'}
                icon={<Cpu size={14} />}
                isOpen={openSections.strategy}
                onToggle={() => toggleSection('strategy')}
            >
                {mode !== 'batch' ? (
                    <div className="space-y-3">
                        <div>
                            <label className="text-[10px] font-bold text-indigo-400 uppercase block mb-1">Custom Indicator Override</label>
                            <select
                                className={`${inputBaseClasses} border-indigo-500/30`}
                                value={selectedIndicatorId || ''}
                                onChange={(e) => setSelectedIndicatorId(e.target.value ? Number(e.target.value) : null)}
                            >
                                <option value="">-- Use Standard/Custom Strategy --</option>
                                {savedIndicators.map((ind) => <option key={ind.id} value={ind.id}>{ind.name}</option>)}
                            </select>
                        </div>

                        <div className={`space-y-1.5 transition-opacity ${selectedIndicatorId ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                            <div className="flex justify-between items-center">
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Strategy</label>
                                <button type="button" onClick={() => setIsBuilderOpen(true)} className="text-[10px] text-brand-primary flex items-center gap-1 font-bold hover:underline">
                                    <PlusCircle size={11} /> Builder
                                </button>
                            </div>
                            <select className={inputBaseClasses} value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                                <optgroup label="Library">{safeStrategies.map((s) => <option key={`lib-${s}`} value={s}>{s}</option>)}</optgroup>
                                {uniqueCustomStrategies.length > 0 && (
                                    <optgroup label="Custom">{uniqueCustomStrategies.map((s) => <option key={`cust-${s}`} value={s}>{s}</option>)}</optgroup>
                                )}
                            </select>
                        </div>

                        <StrategyParams
                            mode={mode === 'optimization' || mode === 'walk_forward' ? 'optimization' : 'single'}
                            activeParamsConfig={optimizableParams}
                            params={params}
                            setParams={setParams}
                            optimizationParams={optimizationParams}
                            setOptimizationParams={setOptimizationParams}
                            optimizationMethod={optimizationMethod}
                            setOptimizationMethod={setOptimizationMethod}
                            hideOptimizationMethod={mode === 'walk_forward'}
                            gaParams={gaParams}
                            setGaParams={setGaParams}
                        />

                        {(mode === 'optimization' || mode === 'walk_forward') && (
                            <div className="pt-2 border-t border-slate-200 dark:border-[#1F1F1F] space-y-2.5">
                                <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                    {mode === 'walk_forward' ? 'Walk-Forward Settings' : 'Optimization Objective'}
                                </h4>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-[10px] text-slate-500 block mb-1">Optimize For</label>
                                        <select className={inputBaseClasses} value={wfaOptTarget} onChange={(e) => setWfaOptTarget(e.target.value)}>
                                            <option value="profit">Net Profit %</option>
                                            <option value="sharpe">Sharpe Ratio</option>
                                            <option value="drawdown">Min Drawdown</option>
                                            <option value="win_rate">Win Rate %</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-slate-500 block mb-1">Min Trades Filter</label>
                                        <input type="number" min={0} value={wfaMinTrades} onChange={(e) => setWfaMinTrades(Number(e.target.value))} className={`${inputBaseClasses} font-mono`} />
                                    </div>
                                </div>

                                {mode === 'walk_forward' && (
                                    <>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="text-[10px] text-slate-500 block mb-1">Train Days</label>
                                                <input type="number" min={10} value={wfaTrainWindow} onChange={(e) => setWfaTrainWindow(Number(e.target.value))} className={`${inputBaseClasses} font-mono`} />
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-slate-500 block mb-1">Test Days</label>
                                                <input type="number" min={5} value={wfaTestWindow} onChange={(e) => setWfaTestWindow(Number(e.target.value))} className={`${inputBaseClasses} font-mono`} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2">
                                            <div>
                                                <label className="text-[10px] text-slate-500 block mb-1">Method</label>
                                                <select className={inputBaseClasses} value={wfaMethod} onChange={(e) => setWfaMethod(e.target.value)}>
                                                    <option value="grid">Grid</option>
                                                    <option value="genetic">Genetic</option>
                                                </select>
                                            </div>
                                            {wfaMethod === 'genetic' && (
                                                <>
                                                    <div>
                                                        <label className="text-[10px] text-slate-500 block mb-1">Pop</label>
                                                        <input type="number" value={wfaPopSize} onChange={(e) => setWfaPopSize(Number(e.target.value))} className={`${inputBaseClasses} font-mono`} />
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] text-slate-500 block mb-1">Gens</label>
                                                        <input type="number" value={wfaGenerations} onChange={(e) => setWfaGenerations(Number(e.target.value))} className={`${inputBaseClasses} font-mono`} />
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="h-44 overflow-y-auto border border-slate-200 dark:border-[#1F1F1F] rounded-lg p-1.5 bg-slate-50 dark:bg-[#111] space-y-1 custom-scrollbar">
                            {allBatchStrategies.map((s) => (
                                <div
                                    key={s}
                                    onClick={() => toggleBatchStrategy(s)}
                                    className={`flex items-center gap-2 p-1.5 rounded cursor-pointer text-xs ${
                                        batchStrategies.includes(s) ? 'bg-brand-primary/15 text-brand-primary font-semibold' : 'hover:bg-slate-200 dark:hover:bg-[#1A1A1A]'
                                    }`}
                                >
                                    {batchStrategies.includes(s) ? <CheckSquare size={12} /> : <Square size={12} />}
                                    <span className="truncate">{s}</span>
                                </div>
                            ))}
                            {allBatchStrategies.length === 0 && <div className="text-xs text-slate-500 text-center py-4">No strategies found</div>}
                        </div>
                        <div className="flex justify-between items-center px-1">
                            <span className="text-[10px] font-mono text-slate-500">Selected: {batchStrategies.length}</span>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setBatchStrategies(allBatchStrategies)} className="text-[10px] text-brand-primary hover:underline font-bold">Select All</button>
                                <button type="button" onClick={() => setBatchStrategies([])} className="text-[10px] text-slate-500 hover:underline">Clear</button>
                            </div>
                        </div>
                    </div>
                )}
            </AccordionSection>

            {/* 3. Execution & Position Sizing */}
            <AccordionSection
                title="3. Execution & Sizing"
                badge={`$${initialCash.toLocaleString()} • ${leverage}x`}
                icon={<Sliders size={14} />}
                isOpen={openSections.execution}
                onToggle={() => toggleSection('execution')}
            >
                <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Initial Capital ($)</label>
                    <input
                        type="number"
                        value={initialCash}
                        onChange={(e) => setInitialCash(Number(e.target.value))}
                        className={`${inputBaseClasses} text-sm font-mono font-bold text-emerald-500`}
                    />
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Sizing Mode</label>
                        <select
                            className={inputBaseClasses}
                            value={positionSizing}
                            onChange={(e) => {
                                const m = e.target.value as 'percent' | 'risk_percent' | 'fixed_usd';
                                setPositionSizing(m);
                                if (m === 'percent') setPositionSizeValue(90);
                                else if (m === 'risk_percent') setPositionSizeValue(1);
                                else setPositionSizeValue(1000);
                            }}
                        >
                            <option value="percent">% of Equity</option>
                            <option value="risk_percent">% Risk / Trade</option>
                            <option value="fixed_usd">Fixed USD ($)</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                            {positionSizing === 'fixed_usd' ? 'Order Size ($)' : positionSizing === 'risk_percent' ? 'Risk %' : 'Equity %'}
                        </label>
                        <input
                            type="number"
                            step={positionSizing === 'fixed_usd' ? 50 : 0.5}
                            min={0.1}
                            value={positionSizeValue}
                            onChange={(e) => setPositionSizeValue(Number(e.target.value))}
                            className={`${inputBaseClasses} font-mono`}
                        />
                    </div>
                </div>
                {positionSizing === 'risk_percent' && stopLoss <= 0 && (
                    <p className="text-[10px] text-amber-400">Set Stop Loss % below for exact risk-per-trade sizing.</p>
                )}

                <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Trade Direction</label>
                    <div className="grid grid-cols-3 gap-1 bg-slate-100 dark:bg-[#111] p-1 rounded-lg border border-slate-200 dark:border-[#1F1F1F]">
                        {(['both', 'long', 'short'] as const).map((dir) => (
                            <button
                                key={dir}
                                type="button"
                                onClick={() => setDirection(dir)}
                                className={`py-1 rounded text-[10px] font-bold uppercase transition-all ${
                                    direction === dir ? 'bg-white dark:bg-[#222] text-brand-primary shadow-sm' : 'text-slate-500'
                                }`}
                            >
                                {dir}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Commission (dec)</label>
                        <input type="number" step="0.0005" value={commission} onChange={(e) => setCommission(parseFloat(e.target.value) || 0)} className={`${inputBaseClasses} font-mono`} />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Slippage (dec)</label>
                        <input type="number" step="0.0005" value={slippage} onChange={(e) => setSlippage(parseFloat(e.target.value) || 0)} className={`${inputBaseClasses} font-mono`} />
                    </div>
                </div>

                <div className="p-2.5 bg-slate-50 dark:bg-[#111] rounded-lg border border-slate-200 dark:border-[#1F1F1F] space-y-2">
                    <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Leverage</label>
                        <span className="text-xs font-mono font-bold text-brand-primary">{leverage}x</span>
                    </div>
                    <input type="range" min="1" max="125" step="1" value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} className="w-full accent-brand-primary" />
                    <div className="grid grid-cols-5 gap-1">
                        {[1, 5, 10, 25, 50].map((lv) => (
                            <button
                                key={lv}
                                type="button"
                                onClick={() => setLeverage(lv)}
                                className={`py-0.5 rounded text-[10px] font-mono border ${
                                    leverage === lv ? 'border-brand-primary bg-brand-primary/15 text-brand-primary font-bold' : 'border-slate-200 dark:border-[#1F1F1F] text-slate-500'
                                }`}
                            >
                                {lv}x
                            </button>
                        ))}
                    </div>
                </div>
            </AccordionSection>

            {/* 4. Risk & Protective Stops */}
            <AccordionSection
                title="4. Risk & Stops"
                badge={enableRiskManagement ? (stopLoss || takeProfit ? `SL ${stopLoss}% / TP ${takeProfit}%` : 'Active') : 'Off'}
                icon={<Crosshair size={14} />}
                isOpen={openSections.risk}
                onToggle={() => toggleSection('risk')}
            >
                <div className="flex items-center justify-between p-2 bg-slate-50 dark:bg-[#111] rounded-lg border border-slate-200 dark:border-[#1F1F1F]">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        {enableRiskManagement ? <ShieldCheck size={14} className="text-emerald-500" /> : <ShieldAlert size={14} className="text-slate-400" />}
                        Protective Stops
                    </label>
                    <input
                        type="checkbox"
                        checked={enableRiskManagement}
                        onChange={(e) => setEnableRiskManagement(e.target.checked)}
                        className="w-4 h-4 accent-brand-primary cursor-pointer"
                    />
                </div>

                <div className={`space-y-2.5 transition-opacity ${enableRiskManagement ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label className="text-[10px] font-bold text-rose-400 uppercase block mb-1">Stop Loss %</label>
                            <input
                                type="number"
                                step="0.25"
                                min="0"
                                value={stopLoss}
                                onChange={(e) => setStopLoss(parseFloat(e.target.value) || 0)}
                                className={`${inputBaseClasses} font-mono`}
                                placeholder="0"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-emerald-400 uppercase block mb-1">Take Profit %</label>
                            <input
                                type="number"
                                step="0.5"
                                min="0"
                                value={takeProfit}
                                onChange={(e) => setTakeProfit(parseFloat(e.target.value) || 0)}
                                className={`${inputBaseClasses} font-mono`}
                                placeholder="0"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-amber-400 uppercase block mb-1">Trailing %</label>
                            <input
                                type="number"
                                step="0.25"
                                min="0"
                                value={trailingStop}
                                onChange={(e) => setTrailingStop(parseFloat(e.target.value) || 0)}
                                className={`${inputBaseClasses} font-mono`}
                                placeholder="0"
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-500 px-1">
                        <span>0 = Strategy default exit</span>
                        {riskRewardRatio && (
                            <span className="font-mono font-bold text-brand-primary">Planned R:R = 1 : {riskRewardRatio}</span>
                        )}
                    </div>
                </div>
            </AccordionSection>

            <StrategyBuilderModal isOpen={isBuilderOpen} onClose={() => setIsBuilderOpen(false)} onSuccess={() => { onStrategyCreated ? onStrategyCreated() : window.location.reload(); }} />
        </div>
    );
};
