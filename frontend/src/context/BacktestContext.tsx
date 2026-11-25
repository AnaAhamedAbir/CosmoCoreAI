import React, { createContext, useState, useContext, ReactNode } from 'react';
import { BacktestResult } from '@/types';
import { MOCK_STRATEGIES } from '../constants';
// নতুন ইম্পোর্ট getBacktestStatus যোগ করা হয়েছে
import { runBacktestApi, fetchCustomStrategyList, getBacktestStatus } from '@/services/backtester';
import { useToast } from './ToastContext';

interface BacktestContextType {
    // States
    strategy: string;
    setStrategy: (s: string) => void;
    symbol: string;
    setSymbol: (s: string) => void;
    timeframe: string;
    setTimeframe: (t: string) => void;
    startDate: string;
    setStartDate: (d: string) => void;
    endDate: string;
    setEndDate: (d: string) => void;
    params: Record<string, any>;
    setParams: (p: Record<string, any>) => void;
    optimizableParams: Record<string, any>;
    setOptimizableParams: (p: Record<string, any>) => void;
    optimizationParams: Record<string, any>;
    setOptimizationParams: (p: Record<string, any>) => void;

    // ✅ ১. ইনিশিয়াল ক্যাশ কন্টেক্সটে যোগ করা হলো
    initialCash: number;
    setInitialCash: (v: number) => void;

    // ✅ নতুন স্টেট টাইপ
    commission: number;
    setCommission: (c: number) => void;
    slippage: number;
    setSlippage: (s: number) => void;
    leverage: number; // ✅ NEW
    setLeverage: (l: number) => void; // ✅ NEW
    secondaryTimeframe: string;
    setSecondaryTimeframe: (t: string) => void;

    stopLoss: number;
    setStopLoss: (v: number) => void;
    takeProfit: number;
    setTakeProfit: (v: number) => void;
    trailingStop: number;
    setTrailingStop: (v: number) => void;

    positionSizing: 'percent' | 'risk_percent' | 'fixed_usd';
    setPositionSizing: (m: 'percent' | 'risk_percent' | 'fixed_usd') => void;
    positionSizeValue: number;
    setPositionSizeValue: (v: number) => void;
    direction: 'both' | 'long' | 'short';
    setDirection: (d: 'both' | 'long' | 'short') => void;

    strategies: string[];
    setStrategies: React.Dispatch<React.SetStateAction<string[]>>;
    customStrategies: string[];
    setCustomStrategies: React.Dispatch<React.SetStateAction<string[]>>;

    // Results & Status
    singleResult: BacktestResult | null;
    setSingleResult: (r: BacktestResult | null) => void;
    isLoading: boolean;
    setIsLoading: (l: boolean) => void;
    statusMessage: string; // ইউজারের জন্য স্ট্যাটাস মেসেজ

    // Actions
    runBacktest: (options?: any) => Promise<void>;
    refreshStrategyList: () => Promise<void>;

    // Aliases for compatibility with new Backtester
    results: BacktestResult | null;
    isRunning: boolean;
    error: string | null;
}

const BacktestContext = createContext<BacktestContextType | undefined>(undefined);

export const BacktestProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { showToast } = useToast();

    // --- States ---
    const [strategies, setStrategies] = useState<string[]>(MOCK_STRATEGIES);
    const [customStrategies, setCustomStrategies] = useState<string[]>([]);
    const [strategy, setStrategy] = useState('RSI Crossover');
    const [symbol, setSymbol] = useState('BTC/USDT');
    const [timeframe, setTimeframe] = useState('1h');
    const [startDate, setStartDate] = useState('2023-01-01');
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

    const [params, setParams] = useState<Record<string, any>>({});
    const [optimizableParams, setOptimizableParams] = useState<Record<string, any>>({});
    const [optimizationParams, setOptimizationParams] = useState<Record<string, any>>({});

    // ✅ ২. স্টেট ইনিশিয়ালাইজেশন
    const [initialCash, setInitialCash] = useState(10000);

    // ✅ নতুন স্টেট (ডিফল্ট: 0.1% কমিশন, 0% স্লিপেজ)
    const [commission, setCommission] = useState(0.001);
    const [slippage, setSlippage] = useState(0.0);
    const [leverage, setLeverage] = useState(1.0); // ✅ NEW (Default 1x)
    const [secondaryTimeframe, setSecondaryTimeframe] = useState('');

    const [stopLoss, setStopLoss] = useState(0.0);
    const [takeProfit, setTakeProfit] = useState(0.0);
    const [trailingStop, setTrailingStop] = useState(0.0);

    const [positionSizing, setPositionSizing] = useState<'percent' | 'risk_percent' | 'fixed_usd'>('percent');
    const [positionSizeValue, setPositionSizeValue] = useState<number>(90);
    const [direction, setDirection] = useState<'both' | 'long' | 'short'>('both');

    const [singleResult, setSingleResult] = useState<BacktestResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [statusMessage, setStatusMessage] = useState(''); // নতুন স্টেট
    const [error, setError] = useState<string | null>(null);

    // --- Actions ---

    const refreshStrategyList = async () => {
        try {
            const list = await fetchCustomStrategyList();
            setCustomStrategies(list);
        } catch (error) {
            console.error("Failed to load custom strategies", error);
        }
    };

    // 🔴 নতুন পোলিং লজিক সহ Run Backtest
    const runBacktest = async (options?: any) => {
        setIsLoading(true);
        setSingleResult(null);
        setError(null);
        setStatusMessage('Initializing Backtest...');

        // Update local state if options provided
        if (options) {
            if (options.symbol) setSymbol(options.symbol);
            if (options.timeframe) setTimeframe(options.timeframe);
            if (options.strategy) setStrategy(options.strategy);
            if (options.params) setParams(options.params);
        }

        try {
            // ১. ব্যাকটেস্ট টাস্ক শুরু করা
            const initialResponse = await runBacktestApi({
                symbol: options?.symbol || symbol,
                timeframe: options?.timeframe || timeframe,
                strategy: options?.strategy || strategy,
                initial_cash: options?.initial_cash || initialCash, // 👈 ফিক্স: লোকাল স্টেট ব্যবহার
                start_date: startDate,
                end_date: endDate,
                params: options?.params || params,

                commission: commission,
                slippage: slippage,
                leverage: leverage, // ✅ Pass Leverage
                secondary_timeframe: options?.secondary_timeframe || secondaryTimeframe || undefined,
                stop_loss: stopLoss,
                take_profit: takeProfit,
                trailing_stop: trailingStop,
                position_sizing: positionSizing,
                position_size_value: positionSizeValue,
                direction: direction,
            });

            const taskId = initialResponse.task_id;
            setStatusMessage('Backtest Running in Background...');

            // ২. পোলিং শুরু (প্রতি ২ সেকেন্ডে চেক করবে)
            const pollInterval = setInterval(async () => {
                try {
                    const statusData = await getBacktestStatus(taskId);

                    if (statusData.status === 'Completed') {
                        clearInterval(pollInterval); // পোলিং বন্ধ

                        const apiResult = statusData.result;

                        // রেজাল্ট ম্যাপিং
                        const mappedResult: BacktestResult = {
                            id: Date.now().toString(),
                            market: apiResult.symbol || (options?.symbol || symbol),
                            strategy: apiResult.strategy || (options?.strategy || strategy),
                            timeframe: options?.timeframe || timeframe,
                            date: new Date().toISOString().split('T')[0],
                            profitPercent: apiResult.profit_percent,
                            maxDrawdown: apiResult.max_drawdown,
                            winRate: apiResult.win_rate,
                            sharpeRatio: apiResult.sharpe_ratio,
                            profit_percent: apiResult.profit_percent,

                            // ✅ ৪. রেজাল্টেও সঠিক ক্যাশ দেখানো
                            initial_cash: options?.initial_cash || initialCash,

                            final_value: apiResult.final_value,
                            total_trades: apiResult.total_trades,
                            // max_drawdown: apiResult.max_drawdown, // Removed: Not in type
                            // win_rate: apiResult.win_rate, // Removed: Not in type
                            // sharpe_ratio: apiResult.sharpe_ratio, // Removed: Not in type
                            leverage: apiResult.leverage, // ✅ Capture Leverage in Result
                            trades_log: apiResult.trades_log,
                            closed_trades: apiResult.closed_trades,
                            analytics_breakdown: apiResult.analytics_breakdown,
                            candle_data: apiResult.candle_data,
                            equity_curve: apiResult.equity_curve,
                            benchmark_curve: apiResult.benchmark_curve,
                            advanced_metrics: apiResult.advanced_metrics,
                            trade_analysis: apiResult.trade_analysis,
                            heatmap_data: apiResult.heatmap_data,
                            histogram_data: apiResult.histogram_data,
                            underwater_data: apiResult.underwater_data,
                            monte_carlo: apiResult.monte_carlo,
                        };

                        setSingleResult(mappedResult);
                        setIsLoading(false);
                        setStatusMessage('');
                        showToast('Backtest completed successfully!', 'success');

                    } else if (statusData.status === 'Failed') {
                        clearInterval(pollInterval);
                        setIsLoading(false);
                        setStatusMessage('');
                        setError(statusData.error || 'Backtest failed');
                        showToast(`Backtest Failed: ${statusData.error}`, 'error');
                    } else {
                        // এখনও প্রসেস হচ্ছে
                        setStatusMessage('Crunching Numbers... Please wait.');
                    }
                } catch (pollError) {
                    console.error("Polling Error:", pollError);
                    // নেটওয়ার্ক এরর হলেও আমরা চেষ্টা চালিয়ে যেতে পারি, বা বন্ধ করে দিতে পারি
                    // এখানে আপাতত কন্টিনিউ রাখা হলো
                }
            }, 2000); // ২ সেকেন্ড পর পর চেক

        } catch (error: any) {
            console.error(error);
            const msg = error.response?.data?.detail || "Failed to start backtest.";
            setError(msg);
            showToast(msg, 'error');
            setIsLoading(false);
            setStatusMessage('');
        }
    };

    return (
        <BacktestContext.Provider value={{
            strategy, setStrategy,
            symbol, setSymbol,
            timeframe, setTimeframe,
            startDate, setStartDate,
            endDate, setEndDate,

            // ✅ ৫. এক্সপোর্ট ভ্যালু
            initialCash, setInitialCash,

            params, setParams,
            optimizableParams, setOptimizableParams,
            optimizationParams, setOptimizationParams,
            strategies, setStrategies,
            customStrategies, setCustomStrategies,
            singleResult, setSingleResult,
            isLoading, setIsLoading,
            statusMessage, // এক্সপোর্ট করা হলো যাতে UI তে দেখানো যায়
            runBacktest,
            refreshStrategyList,

            // ✅ নতুন ভ্যালু এক্সপোর্ট
            commission, setCommission,
            slippage, setSlippage,
            leverage, setLeverage, // ✅ Export
            secondaryTimeframe, setSecondaryTimeframe,
            stopLoss, setStopLoss,
            takeProfit, setTakeProfit,
            trailingStop, setTrailingStop,
            positionSizing, setPositionSizing,
            positionSizeValue, setPositionSizeValue,
            direction, setDirection,
            // Aliases
            results: singleResult,
            isRunning: isLoading,
            error
        }}>
            {children}
        </BacktestContext.Provider>
    );
};

export const useBacktest = (): BacktestContextType => {
    const context = useContext(BacktestContext);
    if (context === undefined) {
        throw new Error('useBacktest must be used within a BacktestProvider');
    }
    return context;
};

