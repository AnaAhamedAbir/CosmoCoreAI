import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useBacktest } from '@/context/BacktestContext';
import { useToast } from '@/context/ToastContext';
import { MOCK_STRATEGY_PARAMS } from '@/constants';
import {
    fetchCustomStrategyList,
    fetchStrategyCode,
    generateStrategy,
    uploadStrategyFile,
    revokeBacktestTask,
    uploadBacktestDataFile,
    fetchBacktestHistory,
    getBacktestStatus,
} from '@/services/backtester';
import { indicatorService } from '@/services/indicatorService';
import { SavedIndicator, BacktestResult, BacktestHistoryItem } from '@/types';
import { useMarketData } from './hooks/useMarketData';
import { useBacktestExecution } from './hooks/useBacktestExecution';

import { BacktestForm } from './components/BacktestForm';
import { ResultsPanel } from './components/ResultsPanel';
import { BatchResults } from './components/BatchResults';
import { AIStrategyLab } from './components/AIStrategyLab';
import { DownloadDataModal } from './components/DownloadDataModal';
import { useDownloadData } from './hooks/useDownloadData';
import { WalkForwardResults } from './components/WalkForwardResults';
import EquityChart from '@/components/features/backtest/EquityChart';

import {
    PlayIcon, CodeIcon, Download, GitMerge, Square, LayoutGrid,
    Layers, History, PanelLeftClose, PanelLeftOpen, GitCompare, X, Trash2, Sparkles, CheckSquare, AlertTriangle
} from 'lucide-react';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';

interface SavedRunSnapshot {
    runId: string;
    savedAt: string;
    label: string;
    result: BacktestResult;
    params: Record<string, any>;
    timeframe: string;
}

const LOCAL_HISTORY_KEY = 'cosmoquant_backtest_runs_v1';
const COMPARE_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EC4899'];

const parseParamsFromCode = (code: string): Record<string, any> => {
    const match = code.match(/#\s*@params\s*([\s\S]*?)#\s*@params_end/);
    if (match && match[1]) {
        try {
            const jsonString = match[1].replace(/^\s*#\s*/gm, '');
            return JSON.parse(jsonString);
        } catch (e) {
            console.error('Failed to parse param config:', e);
            return {};
        }
    }
    return {};
};

export const BacktesterContainer: React.FC = () => {
    const { showToast } = useToast();
    const deviceProfile = useDeviceProfile();
    const isPhoneMobileUI = deviceProfile.isPhoneMobileUI;

    const {
        exchanges, markets, selectedExchange, setSelectedExchange,
        symbol, setSymbol, handleSyncData, isSyncing, syncProgress, syncStatusText,
    } = useMarketData();

    const {
        isDownloadModalOpen, setIsDownloadModalOpen, downloadType, setDownloadType,
        dlExchange, setDlExchange, dlMarkets, dlSymbol, setDlSymbol,
        dlTimeframe, setDlTimeframe, dlStartDate, setDlStartDate, dlEndDate, setDlEndDate,
        isDownloading, downloadProgress, isLoadingDlMarkets,
        handleStartDownload, handleStopDownload,
        tradeFiles: dlTradeFiles,
        selectedTradeFile: dlSelectedTradeFile,
        setSelectedTradeFile: setDlSelectedTradeFile,
        handleConvertData,
        isConverting: isDlConverting,
    } = useDownloadData();

    const { execute, isLoading, progress, statusMessage, errorMessage, results: liveResults, taskId } = useBacktestExecution();
    const {
        commission, setCommission,
        slippage, setSlippage,
        leverage, setLeverage,
        secondaryTimeframe,
        stopLoss, setStopLoss,
        takeProfit, setTakeProfit,
        trailingStop,
        positionSizing,
        positionSizeValue,
        direction,
        setParams: setContextParams,
    } = useBacktest();

    const [initialCash, setInitialCash] = useState(10000);
    const [enableRiskManagement, setEnableRiskManagement] = useState(true);
    const [activeTab, setActiveTabState] = useState<'single' | 'batch' | 'optimization' | 'walk_forward' | 'editor'>('single');
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

    const [batchStrategies, setBatchStrategies] = useState<string[]>([]);
    const [strategies, setStrategies] = useState<string[]>([]);
    const [customStrategies, setCustomStrategies] = useState<string[]>([]);
    const [savedIndicators, setSavedIndicators] = useState<SavedIndicator[]>([]);
    const [selectedIndicatorId, setSelectedIndicatorId] = useState<number | null>(null);
    const [strategy, setStrategy] = useState('');
    const [timeframe, setTimeframe] = useState('1h');
    const [startDate, setStartDate] = useState('2023-01-01');
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    const [mode, setMode] = useState<'backtest' | 'optimization' | 'walk_forward' | 'batch'>('backtest');

    // WFA & Optimization States
    const [wfaTrainWindow, setWfaTrainWindow] = useState(90);
    const [wfaTestWindow, setWfaTestWindow] = useState(30);
    const [wfaMethod, setWfaMethod] = useState('grid');
    const [wfaPopSize, setWfaPopSize] = useState(10);
    const [wfaGenerations, setWfaGenerations] = useState(5);
    const [wfaOptTarget, setWfaOptTarget] = useState('profit');
    const [wfaMinTrades, setWfaMinTrades] = useState(5);

    // Params State
    const [params, setParams] = useState<Record<string, any>>({});
    const [optimizationParams, setOptimizationParams] = useState<any>({});
    const [optimizableParams, setOptimizableParams] = useState<Record<string, any>>({});
    const [standardParamsConfig] = useState<Record<string, any>>(MOCK_STRATEGY_PARAMS);
    const [optimizationMethod, setOptimizationMethod] = useState<'gridSearch' | 'geneticAlgorithm'>('gridSearch');
    const [gaParams, setGaParams] = useState({ populationSize: 50, generations: 20 });

    // AI Strategy Lab State
    const [aiPrompt, setAiPrompt] = useState('');
    const [currentStrategyCode, setCurrentStrategyCode] = useState('# Code will appear here');
    const [isGenerating, setIsGenerating] = useState(false);
    const [fileName, setFileName] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // CSV Data Upload State
    const [dataSource, setDataSource] = useState<'database' | 'csv'>('database');
    const [csvFileName, setCsvFileName] = useState('');
    const [isUploadingData, setIsUploadingData] = useState(false);
    const dataFileInputRef = useRef<HTMLInputElement>(null);
    const [resultsTab, setResultsTab] = useState('overview');
    const [batchViewMode, setBatchViewMode] = useState<'table' | 'chart'>('table');

    // History, Loaded Snapshot & Compare State
    const [loadedSnapshotResult, setLoadedSnapshotResult] = useState<BacktestResult | null>(null);
    const [savedRuns, setSavedRuns] = useState<SavedRunSnapshot[]>(() => {
        try {
            const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    });
    const [dbHistory, setDbHistory] = useState<BacktestHistoryItem[]>([]);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [compareIds, setCompareIds] = useState<string[]>([]);
    const [isCompareOpen, setIsCompareOpen] = useState(false);
    const [selectedBatchResult, setSelectedBatchResult] = useState<any>(null);

    const activeResults = liveResults ?? loadedSnapshotResult;

    const loadStrategies = useCallback(async () => {
        try {
            const [fullList, indicators] = await Promise.all([
                fetchCustomStrategyList(),
                indicatorService.getAll().catch(() => []),
            ]);
            setSavedIndicators(indicators || []);
            const combined = Array.isArray(fullList) ? fullList : [];
            if (combined.length > 0) {
                setStrategies(combined);
                setCustomStrategies(combined);
                setStrategy((prev) => (!prev || !combined.includes(prev) ? combined[0] : prev));
            }
        } catch (e) {
            console.error('Failed to load strategies:', e);
            showToast('Failed to load strategy list', 'error');
        }
    }, [showToast]);

    const loadDbHistory = useCallback(async () => {
        try {
            const rows = await fetchBacktestHistory(25);
            if (Array.isArray(rows)) setDbHistory(rows);
        } catch {
            // Non-blocking
        }
    }, []);

    useEffect(() => {
        loadStrategies();
        loadDbHistory();
    }, [loadStrategies, loadDbHistory]);

    // Persist completed single runs into local snapshot history
    useEffect(() => {
        if (!liveResults || Array.isArray(liveResults) || liveResults.steps_detail || liveResults.results) return;
        if (liveResults.status !== 'success') return;

        setLoadedSnapshotResult(null);
        const snapId = taskId || `run_${Date.now()}`;
        setSavedRuns((prev) => {
            if (prev.some((r) => r.runId === snapId)) return prev;
            const compactResult: BacktestResult = {
                ...liveResults,
                // Keep candle_data capped only if huge to respect localStorage quota safely
                candle_data: Array.isArray(liveResults.candle_data) ? liveResults.candle_data.slice(-1500) : liveResults.candle_data,
            };
            const next: SavedRunSnapshot[] = [
                {
                    runId: snapId,
                    savedAt: new Date().toISOString(),
                    label: `${liveResults.symbol || symbol} • ${liveResults.strategy || strategy} (${timeframe})`,
                    result: compactResult,
                    params: { ...params },
                    timeframe,
                },
                ...prev,
            ].slice(0, 12);
            try {
                localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(next));
            } catch {
                // If quota exceeded, keep in memory & store trimmed without candles
                try {
                    const trimmed = next.map((item, i) =>
                        i === 0 ? { ...item, result: { ...item.result, candle_data: [] } } : item
                    );
                    localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(trimmed.slice(0, 6)));
                } catch { /* ignore */ }
            }
            return next;
        });
        loadDbHistory();
    }, [liveResults, taskId, symbol, strategy, timeframe, params, loadDbHistory]);

    useEffect(() => {
        const updateParams = async () => {
            if (selectedIndicatorId) {
                const ind = savedIndicators.find((i: any) => i.id === selectedIndicatorId);
                if (ind) {
                    setCurrentStrategyCode(ind.code || '# Custom Indicator Logic');
                    const finalParams = ind.parameters || {};
                    setOptimizableParams(finalParams);
                    const newParams: any = {};
                    const newOptParams: any = {};
                    Object.entries(finalParams).forEach(([key, val]: [string, any]) => {
                        const defaultVal = typeof val === 'object' && val !== null && 'default' in val ? val.default : val;
                        newParams[key] = defaultVal;
                        const numVal = Number(defaultVal);
                        newOptParams[key] = !isNaN(numVal)
                            ? { start: numVal, end: numVal * 2, step: 1 }
                            : { start: 0, end: 10, step: 1 };
                    });
                    setParams(newParams);
                    setOptimizationParams(newOptParams);
                    return;
                }
            }

            const isCustom = customStrategies.includes(strategy);
            if (isCustom) {
                try {
                    const data = await fetchStrategyCode(strategy);
                    setCurrentStrategyCode(data.code);
                    const extracted = parseParamsFromCode(data.code);
                    const finalParams = Object.keys(extracted).length ? extracted : (data.inferred_params || {});
                    setOptimizableParams(finalParams);
                    const newParams: any = {};
                    const newOptParams: any = {};
                    Object.entries(finalParams).forEach(([key, config]: [string, any]) => {
                        newParams[key] = config.default;
                        newOptParams[key] = { start: config.default, end: config.max || config.default * 2, step: config.step || 1 };
                    });
                    setParams(newParams);
                    setOptimizationParams(newOptParams);
                } catch (e) {
                    console.error(e);
                }
            } else {
                setCurrentStrategyCode(`# Standard Source: ${strategy}`);
                const config = standardParamsConfig[strategy] || MOCK_STRATEGY_PARAMS[strategy] || {};
                setOptimizableParams(config);
                const newParams: any = {};
                const newOptParams: any = {};
                Object.keys(config).forEach((key) => {
                    const conf = config[key];
                    const def = conf.default ?? conf.defaultValue;
                    newParams[key] = def;
                    newOptParams[key] = { start: conf.min ?? def, end: conf.max ?? def, step: conf.step || 1 };
                });
                setParams(newParams);
                setOptimizationParams(newOptParams);
            }
        };
        updateParams();
    }, [strategy, customStrategies, standardParamsConfig, savedIndicators, selectedIndicatorId]);

    useEffect(() => { setContextParams(params); }, [params, setContextParams]);

    const handleTabChange = (tab: 'single' | 'batch' | 'optimization' | 'walk_forward' | 'editor') => {
        setActiveTabState(tab);
        if (tab === 'walk_forward') setMode('walk_forward');
        else if (tab === 'optimization') setMode('optimization');
        else if (tab === 'single' || tab === 'batch') setMode('backtest');
    };

    const handleDataFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploadingData(true);
        try {
            const response = await uploadBacktestDataFile(file);
            if (response && response.filename) {
                setCsvFileName(response.filename);
                showToast('CSV Uploaded Successfully!', 'success');
            } else {
                showToast('Upload failed: No filename returned', 'error');
            }
        } catch (error) {
            console.error('Upload failed', error);
            showToast('Failed to upload CSV file', 'error');
        } finally {
            setIsUploadingData(false);
            if (dataFileInputRef.current) dataFileInputRef.current.value = '';
        }
    };

    const handleStrategyUpload = async () => {
        const file = fileInputRef.current?.files?.[0];
        if (!file) {
            showToast('Please select a .py strategy file first.', 'error');
            return;
        }
        try {
            const res = await uploadStrategyFile(file);
            showToast(res?.message || 'Strategy uploaded successfully!', 'success');
            setFileName('');
            if (fileInputRef.current) fileInputRef.current.value = '';
            await loadStrategies();
        } catch (err: any) {
            const detail = err?.response?.data?.detail || 'Strategy upload failed.';
            showToast(detail, 'error');
        }
    };

    const handleAiGenerate = async () => {
        if (!aiPrompt.trim()) {
            showToast('Enter a strategy description first.', 'error');
            return;
        }
        setIsGenerating(true);
        try {
            const cfg = await generateStrategy(aiPrompt);
            if (cfg?.code) {
                setCurrentStrategyCode(cfg.code);
            } else if (cfg?.strategy_name) {
                const className = cfg.strategy_name.replace(/[^a-zA-Z0-9]/g, '') || 'AIStrategy';
                const generatedCode = `import backtrader as bt\nfrom app.strategies.base_strategy import BaseStrategy\n\nclass ${className}(BaseStrategy):\n    \"\"\"${cfg.description || ''}\"\"\"\n    params = (\n        ('fast_period', 14),\n        ('slow_period', 50),\n        ('stop_loss', ${cfg.stop_loss ?? 2.0}),\n        ('take_profit', ${cfg.take_profit ?? 6.0}),\n    )\n\n    def __init__(self):\n        super().__init__()\n        self.fast = bt.indicators.EMA(self.data.close, period=self.params.fast_period)\n        self.slow = bt.indicators.EMA(self.data.close, period=self.params.slow_period)\n        self.crossover = bt.indicators.CrossOver(self.fast, self.slow)\n\n    def next(self):\n        if not self.position:\n            if self.crossover > 0:\n                self.buy()\n        elif self.crossover < 0:\n            self.close()\n`;
                setCurrentStrategyCode(generatedCode);
                if (cfg.leverage) setLeverage(Number(cfg.leverage));
                if (cfg.stop_loss) setStopLoss(Number(cfg.stop_loss));
                if (cfg.take_profit) setTakeProfit(Number(cfg.take_profit));
                if (cfg.timeframe) setTimeframe(cfg.timeframe);
            }
            showToast('AI Strategy & risk config generated!', 'success');
        } catch (err: any) {
            const detail = err?.response?.data?.detail || 'Failed to generate AI strategy.';
            showToast(detail, 'error');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleStop = async () => {
        if (!taskId) return;
        try {
            await revokeBacktestTask(taskId);
            showToast('Task stopping...', 'info');
        } catch (e) {
            console.error(e);
        }
    };

    const onRun = useCallback(() => {
        if ((!strategy || strategy === 'Unknown') && !selectedIndicatorId && activeTab !== 'batch') {
            showToast('Please select a valid strategy or indicator.', 'error');
            return;
        }
        if (dataSource === 'csv' && !csvFileName) {
            showToast('Please upload a CSV data file first.', 'error');
            return;
        }

        let indicatorId: number | undefined = undefined;
        let selectedStrategy = strategy;
        if (selectedIndicatorId) {
            const ind = savedIndicators.find((i: any) => i.id === selectedIndicatorId);
            if (ind) {
                indicatorId = ind.id;
                selectedStrategy = (ind as any).base_type || ind.baseType || 'GenericStrategy';
            }
        }

        const commonParams = {
            symbol: dataSource === 'csv' ? (csvFileName || symbol) : symbol,
            custom_data_file: dataSource === 'csv' ? csvFileName : undefined,
            timeframe,
            secondary_timeframe: secondaryTimeframe || undefined,
            strategy: selectedStrategy,
            indicator_id: indicatorId,
            initial_cash: initialCash,
            params,
            start_date: startDate,
            end_date: endDate,
            commission,
            slippage,
            leverage,
            stop_loss: enableRiskManagement ? (stopLoss || 0) : 0,
            take_profit: enableRiskManagement ? (takeProfit || 0) : 0,
            trailing_stop: enableRiskManagement ? (trailingStop || 0) : 0,
            position_sizing: positionSizing,
            position_size_value: positionSizeValue,
            direction,
        };

        setLoadedSnapshotResult(null);

        if (activeTab === 'walk_forward') {
            execute(
                {
                    ...commonParams,
                    params: optimizationParams,
                    train_window_days: wfaTrainWindow,
                    test_window_days: wfaTestWindow,
                    method: wfaMethod,
                    population_size: wfaPopSize,
                    generations: wfaGenerations,
                    opt_target: wfaOptTarget,
                    min_trades: wfaMinTrades,
                },
                'walk_forward'
            );
        } else if (activeTab === 'optimization') {
            execute(
                {
                    ...commonParams,
                    params: optimizationParams,
                    method: optimizationMethod === 'gridSearch' ? 'grid' : 'genetic',
                    population_size: gaParams.populationSize,
                    generations: gaParams.generations,
                    opt_target: wfaOptTarget,
                    min_trades: wfaMinTrades,
                },
                'optimization'
            );
        } else if (activeTab === 'batch') {
            if (batchStrategies.length === 0) {
                showToast('Select at least one strategy.', 'error');
                return;
            }
            execute({ ...commonParams, strategies: batchStrategies }, 'batch');
        } else {
            execute(commonParams, 'backtest');
        }
    }, [
        strategy, selectedIndicatorId, activeTab, dataSource, csvFileName, symbol,
        savedIndicators, timeframe, secondaryTimeframe, initialCash, params,
        startDate, endDate, commission, slippage, leverage, enableRiskManagement,
        stopLoss, takeProfit, trailingStop, positionSizing, positionSizeValue, direction,
        optimizationParams, wfaTrainWindow, wfaTestWindow, wfaMethod, wfaPopSize,
        wfaGenerations, wfaOptTarget, wfaMinTrades, optimizationMethod, gaParams,
        batchStrategies, execute, showToast,
    ]);

    // Ctrl+Enter / Cmd+Enter to run backtest
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && activeTab !== 'editor' && !isLoading) {
                e.preventDefault();
                onRun();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onRun, activeTab, isLoading]);

    const handleApplyParamsAndRun = (nextParams: Record<string, any>) => {
        setParams((prev) => ({ ...prev, ...nextParams }));
        setActiveTabState('single');
        setMode('backtest');
        showToast('Applied parameters to Single Backtest mode. Click Run to inspect full charts!', 'success');
    };

    const toggleCompareId = (runId: string) => {
        setCompareIds((prev) => {
            if (prev.includes(runId)) return prev.filter((id) => id !== runId);
            if (prev.length >= 4) {
                showToast('Compare up to 4 runs at a time.', 'info');
                return prev;
            }
            return [...prev, runId];
        });
    };

    const handleCopyConfig = () => {
        const payload = {
            exchange: selectedExchange,
            symbol,
            timeframe,
            secondary_timeframe: secondaryTimeframe || null,
            strategy,
            params,
            leverage,
            position_sizing: positionSizing,
            position_size_value: positionSizeValue,
            direction,
            stop_loss: stopLoss,
            take_profit: takeProfit,
            trailing_stop: trailingStop,
        };
        navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
        showToast('Strategy & Risk config copied to clipboard!', 'success');
    };

    const compareRuns = savedRuns.filter((r) => compareIds.includes(r.runId));

    return (
        <div className={`flex flex-col ${isPhoneMobileUI ? 'min-h-full overflow-y-auto' : 'h-full overflow-hidden'} bg-white dark:bg-[#050505] rounded-xl border border-slate-200 dark:border-[#1F1F1F]`}>
            {/* Top Command Bar */}
            <div className="flex flex-wrap items-center justify-between px-3 py-2.5 border-b border-slate-200 dark:border-[#1F1F1F] bg-white dark:bg-[#0A0A0A] shrink-0 gap-2">
                <div className="flex items-center gap-2.5">
                    {activeTab !== 'editor' && !isPhoneMobileUI && (
                        <button
                            onClick={() => setIsSidebarCollapsed((v) => !v)}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-[#1F1F1F] text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
                            title={isSidebarCollapsed ? 'Show Inspector' : 'Hide Inspector'}
                        >
                            {isSidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
                        </button>
                    )}
                    <h1 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <span className="text-brand-primary">⚡</span> Quant Backtester
                    </h1>
                    <span className="hidden xl:inline-flex items-center px-2 py-0.5 rounded bg-slate-100 dark:bg-[#141414] border border-slate-200 dark:border-[#1F1F1F] text-[11px] font-mono text-slate-500 dark:text-slate-300">
                        {dataSource === 'csv' ? (csvFileName || 'CSV') : symbol} • {timeframe} • {leverage}x
                    </span>
                </div>

                {/* Mode Switcher */}
                <div className="flex bg-slate-100 dark:bg-[#111] p-1 rounded-lg overflow-x-auto border border-slate-200 dark:border-[#1F1F1F]">
                    {[
                        { id: 'single', icon: PlayIcon, label: 'Single' },
                        { id: 'batch', icon: LayoutGrid, label: 'Batch' },
                        { id: 'optimization', icon: Layers, label: 'Optimize' },
                        { id: 'walk_forward', icon: GitMerge, label: 'WFA' },
                        { id: 'editor', icon: CodeIcon, label: 'AI Lab' },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => handleTabChange(tab.id as any)}
                            className={`flex items-center justify-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all whitespace-nowrap ${
                                activeTab === tab.id
                                    ? 'bg-white dark:bg-[#222] text-slate-900 dark:text-white shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                            }`}
                        >
                            <tab.icon size={13} /> {tab.label}
                        </button>
                    ))}
                </div>

                {/* Right Utility Buttons */}
                <div className="flex items-center gap-2">
                    {compareIds.length >= 2 && (
                        <button
                            onClick={() => setIsCompareOpen(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition-colors"
                        >
                            <GitCompare size={13} /> Compare ({compareIds.length})
                        </button>
                    )}

                    <button
                        onClick={() => setIsHistoryOpen(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#1F1F1F] hover:border-brand-primary text-slate-700 dark:text-slate-300 text-xs font-semibold transition-colors"
                    >
                        <History size={13} /> Runs ({savedRuns.length})
                    </button>

                    <button
                        onClick={() => setIsDownloadModalOpen(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-500 rounded-lg transition-colors text-xs font-bold"
                    >
                        <Download size={13} /> Data
                    </button>
                </div>
            </div>

            {/* Main Split Workspace */}
            <div className={`flex-1 flex flex-col md:flex-row ${isPhoneMobileUI ? 'overflow-visible' : 'min-h-0 overflow-hidden'}`}>
                {activeTab === 'editor' ? (
                    <div className="flex-1 overflow-auto p-4 custom-scrollbar">
                        <AIStrategyLab
                            aiPrompt={aiPrompt}
                            setAiPrompt={setAiPrompt}
                            handleAiGenerate={handleAiGenerate}
                            isGenerating={isGenerating}
                            fileInputRef={fileInputRef}
                            handleFileChange={(e) => { if (e.target.files?.[0]) setFileName(e.target.files[0].name); }}
                            handleUpload={handleStrategyUpload}
                            fileName={fileName}
                            strategy={strategy}
                            currentStrategyCode={currentStrategyCode}
                            setCurrentStrategyCode={setCurrentStrategyCode}
                        />
                    </div>
                ) : (
                    <>
                        {/* Left Inspector Sidebar */}
                        {!isSidebarCollapsed && (
                            <div className={`w-full md:w-[340px] border-r-0 md:border-r border-b md:border-b-0 border-slate-200 dark:border-[#1F1F1F] bg-slate-50/50 dark:bg-[#080808] flex flex-col ${isPhoneMobileUI ? '' : 'min-h-0'} shrink-0`}>
                                <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                                    <BacktestForm
                                        strategies={strategies}
                                        customStrategies={customStrategies}
                                        strategy={strategy}
                                        setStrategy={setStrategy}
                                        batchStrategies={batchStrategies}
                                        setBatchStrategies={setBatchStrategies}
                                        exchanges={exchanges}
                                        selectedExchange={selectedExchange}
                                        setSelectedExchange={setSelectedExchange}
                                        markets={markets}
                                        symbol={symbol}
                                        setSymbol={setSymbol}
                                        timeframe={timeframe}
                                        setTimeframe={setTimeframe}
                                        startDate={startDate}
                                        setStartDate={setStartDate}
                                        endDate={endDate}
                                        setEndDate={setEndDate}
                                        dataSource={dataSource}
                                        setDataSource={setDataSource}
                                        handleDataFileUpload={handleDataFileUpload}
                                        isUploadingData={isUploadingData}
                                        dataFileInputRef={dataFileInputRef}
                                        csvFileName={csvFileName}
                                        handleSyncData={() => handleSyncData(timeframe, startDate, endDate)}
                                        isSyncing={isSyncing}
                                        syncProgress={syncProgress}
                                        syncStatusText={syncStatusText}
                                        enableRiskManagement={enableRiskManagement}
                                        setEnableRiskManagement={setEnableRiskManagement}
                                        initialCash={initialCash}
                                        setInitialCash={setInitialCash}
                                        mode={activeTab === 'batch' ? 'batch' : mode}
                                        setMode={setMode}
                                        wfaTrainWindow={wfaTrainWindow}
                                        setWfaTrainWindow={setWfaTrainWindow}
                                        wfaTestWindow={wfaTestWindow}
                                        setWfaTestWindow={setWfaTestWindow}
                                        wfaMethod={wfaMethod}
                                        setWfaMethod={setWfaMethod}
                                        wfaPopSize={wfaPopSize}
                                        setWfaPopSize={setWfaPopSize}
                                        wfaGenerations={wfaGenerations}
                                        setWfaGenerations={setWfaGenerations}
                                        wfaOptTarget={wfaOptTarget}
                                        setWfaOptTarget={setWfaOptTarget}
                                        wfaMinTrades={wfaMinTrades}
                                        setWfaMinTrades={setWfaMinTrades}
                                        activeTab={activeTab}
                                        params={params}
                                        setParams={setParams}
                                        optimizationParams={optimizationParams}
                                        setOptimizationParams={setOptimizationParams}
                                        optimizableParams={optimizableParams}
                                        optimizationMethod={optimizationMethod}
                                        setOptimizationMethod={setOptimizationMethod}
                                        gaParams={gaParams}
                                        setGaParams={setGaParams}
                                        savedIndicators={savedIndicators}
                                        selectedIndicatorId={selectedIndicatorId}
                                        setSelectedIndicatorId={setSelectedIndicatorId}
                                        onStrategyCreated={loadStrategies}
                                    />
                                </div>

                                {/* Pre-flight Summary & Pinned Run CTA */}
                                <div className="p-3 border-t border-slate-200 dark:border-[#1F1F1F] bg-white dark:bg-[#0A0A0A] shrink-0 space-y-2.5">
                                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 px-1">
                                        <span className="truncate">
                                            ${initialCash.toLocaleString()} • {positionSizing === 'risk_percent' ? `${positionSizeValue}% Risk` : positionSizing === 'fixed_usd' ? `$${positionSizeValue}` : `${positionSizeValue}% Eq`} • {direction.toUpperCase()}
                                        </span>
                                        <span className="text-slate-400 shrink-0">Ctrl+Enter</span>
                                    </div>

                                    {isLoading && (
                                        <div className="w-full animate-fade-in">
                                            <div className="flex justify-between text-[10px] text-blue-400 mb-1 font-mono uppercase font-bold">
                                                <span className="truncate pr-2">{statusMessage || 'Processing...'}</span>
                                                <span>{progress}%</span>
                                            </div>
                                            <div className="h-1.5 w-full bg-slate-100 dark:bg-[#111] rounded-full overflow-hidden">
                                                <div className="h-full bg-brand-primary transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={onRun}
                                            disabled={isLoading}
                                            className="flex-1 py-2.5 text-xs shadow-lg shadow-brand-primary/20 bg-brand-primary text-white rounded-lg font-bold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                                        >
                                            {isLoading ? (
                                                <span>Running Engine...</span>
                                            ) : (
                                                <>
                                                    {activeTab === 'walk_forward' ? <GitMerge size={15} /> : activeTab === 'batch' ? <LayoutGrid size={15} /> : <PlayIcon size={15} />}
                                                    Run {activeTab === 'walk_forward' ? 'Walk-Forward' : activeTab === 'optimization' ? 'Optimization' : activeTab === 'batch' ? 'Batch Test' : 'Backtest'}
                                                </>
                                            )}
                                        </button>
                                        {isLoading && (
                                            <button
                                                onClick={handleStop}
                                                className="px-3 py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded-lg transition-colors"
                                                title="Stop Task"
                                            >
                                                <Square size={15} fill="currentColor" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Right Workspace */}
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-slate-50 dark:bg-[#050505]">
                            {errorMessage && !activeResults && (
                                <div className="mb-4 p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 flex items-start gap-3 text-rose-400 text-xs">
                                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-bold text-rose-300">Backtest Execution Error</p>
                                        <p className="mt-0.5 font-mono">{errorMessage}</p>
                                    </div>
                                </div>
                            )}
                            {activeResults ? (
                                activeTab === 'walk_forward' && activeResults.steps_detail ? (
                                    <WalkForwardResults results={activeResults} onApplyParams={handleApplyParamsAndRun} />
                                ) : activeTab === 'batch' && activeResults.results ? (
                                    <BatchResults
                                        batchResults={activeResults.results || []}
                                        viewMode={batchViewMode}
                                        setViewMode={setBatchViewMode}
                                        setSelectedBatchResult={setSelectedBatchResult}
                                    />
                                ) : (
                                    <ResultsPanel
                                        singleResult={activeResults}
                                        resultsTab={resultsTab}
                                        setResultsTab={setResultsTab}
                                        taskId={taskId || undefined}
                                        onApplyOptimizationParams={handleApplyParamsAndRun}
                                        onPinToCompare={() => {
                                            const existing = savedRuns.find(
                                                (r) => (taskId && r.runId === taskId) || (r.result.final_value === activeResults.final_value && r.result.strategy === activeResults.strategy)
                                            );
                                            if (existing) {
                                                toggleCompareId(existing.runId);
                                                showToast(compareIds.includes(existing.runId) ? 'Removed from Compare' : 'Pinned to Compare', 'info');
                                            } else {
                                                showToast('Run saved in History — open Runs drawer to compare.', 'info');
                                            }
                                        }}
                                        isPinnedForCompare={savedRuns.some(
                                            (r) =>
                                                compareIds.includes(r.runId) &&
                                                ((taskId && r.runId === taskId) || (r.result.final_value === activeResults.final_value && r.result.strategy === activeResults.strategy))
                                        )}
                                        onCopyConfig={handleCopyConfig}
                                    />
                                )
                            ) : (
                                /* Pro Empty State: Quick-Start Templates + Recent Runs */
                                <div className="max-w-4xl mx-auto py-8 space-y-6">
                                    <div className="text-center space-y-2">
                                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-primary/10 text-brand-primary text-xs font-bold">
                                            <Sparkles size={13} /> Quant Backtesting Terminal
                                        </div>
                                        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                                            Configure Parameters or Pick a Quick Preset
                                        </h2>
                                        <p className="text-xs text-slate-500 max-w-lg mx-auto">
                                            Test strategies with custom position sizing, protective SL/TP stops, Buy & Hold alpha benchmarking, 1,000-run Monte Carlo fan charts, and trade-level MAE/MFE inspection.
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        {[
                                            { title: 'BTC 1H Swing', sym: 'BTC/USDT', tf: '1h', sl: 2.0, tp: 6.0, lev: 3 },
                                            { title: 'ETH 15m Momentum', sym: 'ETH/USDT', tf: '15m', sl: 1.5, tp: 4.5, lev: 5 },
                                            { title: 'SOL 4H Trend', sym: 'SOL/USDT', tf: '4h', sl: 3.0, tp: 9.0, lev: 2 },
                                        ].map((preset) => (
                                            <button
                                                key={preset.title}
                                                onClick={() => {
                                                    setSymbol(preset.sym);
                                                    setTimeframe(preset.tf);
                                                    setStopLoss(preset.sl);
                                                    setTakeProfit(preset.tp);
                                                    setLeverage(preset.lev);
                                                    showToast(`Loaded preset: ${preset.title}`, 'info');
                                                }}
                                                className="text-left p-4 rounded-xl bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] hover:border-brand-primary transition-all group"
                                            >
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-brand-primary">{preset.title}</span>
                                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#161616] text-slate-400">{preset.lev}x</span>
                                                </div>
                                                <p className="text-xs font-mono text-slate-500">
                                                    {preset.sym} • {preset.tf} • SL {preset.sl}% / TP {preset.tp}%
                                                </p>
                                            </button>
                                        ))}
                                    </div>

                                    {savedRuns.length > 0 && (
                                        <div className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-xl overflow-hidden">
                                            <div className="px-4 py-3 border-b border-slate-200 dark:border-[#1F1F1F] flex items-center justify-between">
                                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                                                    <History size={13} className="text-brand-primary" /> Recent Local Runs (Click to Inspect)
                                                </h3>
                                                {compareIds.length >= 2 && (
                                                    <button
                                                        onClick={() => setIsCompareOpen(true)}
                                                        className="text-xs font-bold text-purple-400 hover:underline"
                                                    >
                                                        Compare Selected ({compareIds.length})
                                                    </button>
                                                )}
                                            </div>
                                            <div className="divide-y divide-slate-200 dark:divide-[#1F1F1F]">
                                                {savedRuns.slice(0, 5).map((run) => (
                                                    <div key={run.runId} className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-[#111]">
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <button
                                                                onClick={() => toggleCompareId(run.runId)}
                                                                className="text-slate-400 hover:text-purple-400"
                                                                title="Select for A/B Compare"
                                                            >
                                                                {compareIds.includes(run.runId) ? <CheckSquare size={14} className="text-purple-400" /> : <Square size={14} />}
                                                            </button>
                                                            <div
                                                                className="cursor-pointer min-w-0"
                                                                onClick={() => {
                                                                    setLoadedSnapshotResult(run.result);
                                                                    setActiveTabState('single');
                                                                }}
                                                            >
                                                                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{run.label}</p>
                                                                <p className="text-[10px] font-mono text-slate-500">
                                                                    {new Date(run.savedAt).toLocaleString()} • Trades: {run.result.total_trades ?? 0}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-3 font-mono text-xs shrink-0">
                                                            <span className={(run.result.profit_percent ?? 0) >= 0 ? 'text-emerald-500 font-bold' : 'text-rose-500 font-bold'}>
                                                                {(run.result.profit_percent ?? 0) >= 0 ? '+' : ''}{run.result.profit_percent}%
                                                            </span>
                                                            <button
                                                                onClick={() => {
                                                                    setLoadedSnapshotResult(run.result);
                                                                    setActiveTabState('single');
                                                                }}
                                                                className="px-2.5 py-1 rounded bg-brand-primary/10 text-brand-primary text-[11px] font-sans font-bold hover:bg-brand-primary hover:text-white transition-colors"
                                                            >
                                                                Load
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Run History Drawer Modal */}
            {isHistoryOpen && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end" onClick={() => setIsHistoryOpen(false)}>
                    <div className="w-full max-w-lg bg-white dark:bg-[#0A0A0A] border-l border-slate-200 dark:border-[#1F1F1F] h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="p-4 border-b border-slate-200 dark:border-[#1F1F1F] flex items-center justify-between">
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                    <History size={16} className="text-brand-primary" /> Backtest Run History & A/B Compare
                                </h3>
                                <p className="text-[11px] text-slate-500">Select 2–4 local runs to compare equity curves side-by-side</p>
                            </div>
                            <button onClick={() => setIsHistoryOpen(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar">
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Local Full Snapshots ({savedRuns.length})</span>
                                    {savedRuns.length > 0 && (
                                        <button
                                            onClick={() => {
                                                setSavedRuns([]);
                                                setCompareIds([]);
                                                localStorage.removeItem(LOCAL_HISTORY_KEY);
                                            }}
                                            className="text-[10px] text-rose-400 hover:underline flex items-center gap-1"
                                        >
                                            <Trash2 size={11} /> Clear All
                                        </button>
                                    )}
                                </div>
                                {savedRuns.map((run) => (
                                    <div key={run.runId} className="p-3 rounded-xl border border-slate-200 dark:border-[#1F1F1F] bg-slate-50 dark:bg-[#111] flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <input
                                                type="checkbox"
                                                checked={compareIds.includes(run.runId)}
                                                onChange={() => toggleCompareId(run.runId)}
                                                className="accent-purple-500"
                                            />
                                            <div className="min-w-0">
                                                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{run.label}</p>
                                                <p className="text-[10px] font-mono text-slate-500">
                                                    Return: {run.result.profit_percent}% • Sharpe: {run.result.advanced_metrics?.sharpe ?? '-'} • DD: {run.result.advanced_metrics?.max_drawdown ?? '-'}%
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => {
                                                setLoadedSnapshotResult(run.result);
                                                setActiveTabState('single');
                                                setIsHistoryOpen(false);
                                            }}
                                            className="px-2.5 py-1 rounded bg-brand-primary text-white text-[11px] font-bold shrink-0"
                                        >
                                            Inspect
                                        </button>
                                    </div>
                                ))}
                                {savedRuns.length === 0 && <p className="text-xs text-slate-500 py-4 text-center">No saved local runs yet.</p>}
                            </div>

                            {dbHistory.length > 0 && (
                                <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-[#1F1F1F]">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Database Audit Log</span>
                                    {dbHistory.map((h) => (
                                        <div key={h.id} className="p-2.5 rounded-lg border border-slate-200 dark:border-[#1F1F1F] flex items-center justify-between gap-2 text-xs">
                                            <div className="min-w-0">
                                                <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">{h.symbol} • {h.strategy} ({h.timeframe})</p>
                                                <p className="text-[10px] font-mono text-slate-500">
                                                    {h.created_at ? new Date(h.created_at).toLocaleString() : ''}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className={`font-mono font-bold ${h.profit_percent >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                    {h.profit_percent >= 0 ? '+' : ''}{h.profit_percent}%
                                                </span>
                                                {h.task_id && (
                                                    <button
                                                        onClick={async () => {
                                                            const localHit = savedRuns.find((r) => r.runId === h.task_id);
                                                            if (localHit) {
                                                                setLoadedSnapshotResult(localHit.result);
                                                                setActiveTabState('single');
                                                                setIsHistoryOpen(false);
                                                                return;
                                                            }
                                                            try {
                                                                const st = await getBacktestStatus(h.task_id);
                                                                if (st?.status === 'Completed' && st?.result && st.result.status !== 'error') {
                                                                    setLoadedSnapshotResult(st.result);
                                                                    setActiveTabState('single');
                                                                    setIsHistoryOpen(false);
                                                                } else {
                                                                    showToast('Full chart payload expired from worker cache; summary only.', 'info');
                                                                }
                                                            } catch {
                                                                showToast('Could not fetch cached run payload.', 'error');
                                                            }
                                                        }}
                                                        className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#1A1A1A] text-slate-700 dark:text-slate-300 hover:text-brand-primary text-[10px] font-bold"
                                                    >
                                                        Load
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {compareIds.length >= 2 && (
                            <div className="p-4 border-t border-slate-200 dark:border-[#1F1F1F]">
                                <button
                                    onClick={() => {
                                        setIsHistoryOpen(false);
                                        setIsCompareOpen(true);
                                    }}
                                    className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold flex items-center justify-center gap-2"
                                >
                                    <GitCompare size={14} /> Open A/B Comparison ({compareIds.length} Runs)
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* A/B Compare Modal */}
            {isCompareOpen && compareRuns.length >= 2 && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setIsCompareOpen(false)}>
                    <div className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="p-4 border-b border-slate-200 dark:border-[#1F1F1F] flex items-center justify-between">
                            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <GitCompare size={17} className="text-purple-400" /> A/B Strategy Comparison
                            </h3>
                            <button onClick={() => setIsCompareOpen(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
                            <EquityChart
                                data={(compareRuns[0].result.equity_curve || []).map((d: any) => ({
                                    time: d.time ?? Math.floor(new Date(d.name).getTime() / 1000),
                                    value: d.value,
                                }))}
                                compareSeries={compareRuns.slice(1).map((r, idx) => ({
                                    label: r.label,
                                    color: COMPARE_COLORS[(idx + 1) % COMPARE_COLORS.length],
                                    data: (r.result.equity_curve || []).map((d: any) => ({
                                        time: d.time ?? Math.floor(new Date(d.name).getTime() / 1000),
                                        value: d.value,
                                    })),
                                }))}
                                height={320}
                            />

                            <div className="overflow-x-auto border border-slate-200 dark:border-[#1F1F1F] rounded-xl">
                                <table className="w-full text-xs text-left">
                                    <thead className="bg-slate-50 dark:bg-[#111] text-slate-500 uppercase">
                                        <tr>
                                            <th className="px-4 py-2.5">Run</th>
                                            <th className="px-4 py-2.5 text-right">Return %</th>
                                            <th className="px-4 py-2.5 text-right">Final Equity</th>
                                            <th className="px-4 py-2.5 text-right">Sharpe</th>
                                            <th className="px-4 py-2.5 text-right">Sortino</th>
                                            <th className="px-4 py-2.5 text-right">Max DD</th>
                                            <th className="px-4 py-2.5 text-right">Profit Factor</th>
                                            <th className="px-4 py-2.5 text-right">Trades</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 dark:divide-[#1F1F1F] font-mono">
                                        {compareRuns.map((r, idx) => (
                                            <tr key={r.runId}>
                                                <td className="px-4 py-2.5 font-sans font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COMPARE_COLORS[idx % COMPARE_COLORS.length] }} />
                                                    {r.label}
                                                </td>
                                                <td className={`px-4 py-2.5 text-right font-bold ${(r.result.profit_percent ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                    {(r.result.profit_percent ?? 0) >= 0 ? '+' : ''}{r.result.profit_percent}%
                                                </td>
                                                <td className="px-4 py-2.5 text-right">${(r.result.final_value ?? 0).toLocaleString()}</td>
                                                <td className="px-4 py-2.5 text-right text-blue-400">{r.result.advanced_metrics?.sharpe ?? '-'}</td>
                                                <td className="px-4 py-2.5 text-right">{r.result.advanced_metrics?.sortino ?? '-'}</td>
                                                <td className="px-4 py-2.5 text-right text-rose-400">{r.result.advanced_metrics?.max_drawdown ?? '-'}%</td>
                                                <td className="px-4 py-2.5 text-right">{r.result.advanced_metrics?.profit_factor ?? '-'}</td>
                                                <td className="px-4 py-2.5 text-right">{r.result.total_trades ?? 0}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Batch Inspect Modal */}
            {selectedBatchResult && (
                <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedBatchResult(null)}>
                    <div className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-2xl w-full max-w-lg p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <h3 className="text-base font-bold text-slate-900 dark:text-white">{selectedBatchResult.strategy}</h3>
                            <button onClick={() => setSelectedBatchResult(null)} className="text-slate-400 hover:text-white"><X size={18} /></button>
                        </div>
                        <div className="grid grid-cols-2 gap-3 font-mono text-xs">
                            <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#111]">
                                <span className="text-slate-500 block text-[10px]">Profit %</span>
                                <span className="text-lg font-bold text-emerald-500">{selectedBatchResult.profitPercent ?? selectedBatchResult.profit_percent ?? 0}%</span>
                            </div>
                            <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#111]">
                                <span className="text-slate-500 block text-[10px]">Win Rate</span>
                                <span className="text-lg font-bold text-blue-400">{selectedBatchResult.winRate ?? selectedBatchResult.win_rate ?? 0}%</span>
                            </div>
                            <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#111]">
                                <span className="text-slate-500 block text-[10px]">Max Drawdown</span>
                                <span className="text-lg font-bold text-rose-400">-{Math.abs(selectedBatchResult.maxDrawdown ?? selectedBatchResult.max_drawdown ?? 0)}%</span>
                            </div>
                            <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#111]">
                                <span className="text-slate-500 block text-[10px]">Total Trades</span>
                                <span className="text-lg font-bold text-white">{selectedBatchResult.total_trades ?? selectedBatchResult.totalTrades ?? 0}</span>
                            </div>
                        </div>
                        <button
                            onClick={() => {
                                setStrategy(selectedBatchResult.strategy);
                                setSelectedBatchResult(null);
                                setActiveTabState('single');
                                setMode('backtest');
                                showToast(`Switched to ${selectedBatchResult.strategy} in Single Backtest mode.`, 'success');
                            }}
                            className="w-full py-2.5 rounded-lg bg-brand-primary text-white text-xs font-bold hover:opacity-90"
                        >
                            Load Strategy into Single Backtest
                        </button>
                    </div>
                </div>
            )}

            <DownloadDataModal
                isOpen={isDownloadModalOpen}
                onClose={() => setIsDownloadModalOpen(false)}
                downloadType={downloadType}
                setDownloadType={setDownloadType}
                exchanges={exchanges}
                dlExchange={dlExchange}
                setDlExchange={setDlExchange}
                dlMarkets={dlMarkets}
                dlSymbol={dlSymbol}
                setDlSymbol={setDlSymbol}
                dlTimeframe={dlTimeframe}
                setDlTimeframe={setDlTimeframe}
                dlStartDate={dlStartDate}
                setDlStartDate={setDlStartDate}
                dlEndDate={dlEndDate}
                setDlEndDate={setDlEndDate}
                isDownloading={isDownloading}
                downloadProgress={downloadProgress}
                isLoadingDlMarkets={isLoadingDlMarkets}
                handleStartDownload={handleStartDownload}
                handleStopDownload={handleStopDownload}
                tradeFiles={dlTradeFiles}
                selectedTradeFile={dlSelectedTradeFile}
                setSelectedTradeFile={setDlSelectedTradeFile}
                handleConvertData={handleConvertData}
                isConverting={isDlConverting}
            />
        </div>
    );
};
