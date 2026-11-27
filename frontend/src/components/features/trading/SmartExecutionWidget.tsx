import React, { useEffect, useState } from 'react';
import { Settings, BarChart2, Clock, Zap, ArrowRight, TrendingUp, TrendingDown, CheckCircle2 } from 'lucide-react';
import apiClient from '@/services/client';
import Button from '@/components/common/Button';
import { useToast } from '@/context/ToastContext';
import OrderTimeline from './OrderTimeline';

interface SmartExecutionWidgetProps {
    symbol?: string;
    referencePrice?: number;
    defaultSide?: 'buy' | 'sell';
}

const SmartExecutionWidget: React.FC<SmartExecutionWidgetProps> = React.memo(({
    symbol = 'BTC/USDT',
    referencePrice = 0,
    defaultSide = 'buy',
}) => {
    const { showToast } = useToast();
    const [strategy, setStrategy] = useState<'TWAP' | 'VWAP'>('TWAP');
    const [side, setSide] = useState<'buy' | 'sell'>(defaultSide);
    const [amount, setAmount] = useState<string>('1.0');
    const [duration, setDuration] = useState<number>(60); // minutes
    const [slippage, setSlippage] = useState<number>(0.5);
    const [previewSlices, setPreviewSlices] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isExecuting, setIsExecuting] = useState(false);

    useEffect(() => {
        setSide(defaultSide);
    }, [defaultSide]);

    useEffect(() => {
        setPreviewSlices([]);
    }, [symbol, strategy, side, duration]);

    const baseAsset = symbol.includes('/') ? symbol.split('/')[0] : symbol;

    const durations = [
        { label: '30M', value: 30 },
        { label: '1H', value: 60 },
        { label: '4H', value: 240 },
        { label: '12H', value: 720 },
        { label: '24H', value: 1440 },
    ];

    const handlePreview = async () => {
        const parsedAmt = parseFloat(amount);
        if (!Number.isFinite(parsedAmt) || parsedAmt <= 0) {
            showToast('Enter a valid total order amount greater than 0.', 'error');
            return;
        }
        setIsLoading(true);
        try {
            const { data } = await apiClient.post('/trading/sor/preview', {
                symbol,
                amount: parsedAmt,
                side,
                strategy,
                duration_minutes: duration,
                params: {
                    min_order_size: 0.001,
                    slippage_tolerance: slippage,
                },
            });

            const schedule = Array.isArray(data?.schedule) ? data.schedule : [];
            const slices = schedule.map((order: any) => ({
                order_index: order.order_index,
                scheduled_time: order.scheduled_time,
                quantity: order.quantity,
                status: 'scheduled',
            }));

            setPreviewSlices(slices);
            showToast(`${strategy} Execution Schedule generated (${slices.length} slices).`, 'success');
        } catch (error) {
            console.error('Preview failed', error);
            showToast('Failed to preview Smart Order schedule.', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleExecute = async () => {
        const parsedAmt = parseFloat(amount);
        if (!Number.isFinite(parsedAmt) || parsedAmt <= 0) {
            showToast('Enter a valid amount before execution.', 'error');
            return;
        }
        setIsExecuting(true);
        try {
            await apiClient.post('/trading/sor/execute', {
                symbol,
                amount: parsedAmt,
                side,
                strategy,
                duration_minutes: duration,
            });
            showToast(
                `⚡ ${strategy} ${side.toUpperCase()} Algo launched for ${parsedAmt} ${baseAsset}!`,
                'success'
            );
            setPreviewSlices([]);
        } catch (error) {
            showToast('Smart Order execution failed. Check exchange API connection.', 'error');
        } finally {
            setIsExecuting(false);
        }
    };

    const formattedRefPrice =
        referencePrice > 0
            ? referencePrice >= 100
                ? `$${referencePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : referencePrice >= 1
                  ? `$${referencePrice.toFixed(4)}`
                  : `$${referencePrice.toFixed(6)}`
            : 'Market BBO';

    const estimatedNotionalUsd =
        referencePrice > 0 && Number.isFinite(parseFloat(amount))
            ? (parseFloat(amount) * referencePrice).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
              })
            : null;

    return (
        <div className="bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden shadow-sm">
            <div className="h-[2px] w-full bg-gradient-to-r from-cyan-400 via-indigo-500 to-emerald-400" />

            {/* Header */}
            <div className="p-4 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] flex justify-between items-center">
                <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-cyan-500/15 border border-cyan-500/30 rounded-xl text-cyan-600 dark:text-cyan-300">
                        <Zap size={16} />
                    </div>
                    <div>
                        <h3 className="font-black text-sm text-slate-900 dark:text-white">
                            Smart Order Router ({symbol})
                        </h3>
                        <p className="text-[10px] text-slate-500 dark:text-gray-400 font-mono uppercase">
                            TWAP / VWAP Algorithmic Slicing
                        </p>
                    </div>
                </div>
                <span className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-300 px-2 py-0.5 rounded-md text-[10px] font-mono font-black uppercase">
                    SOR Ready
                </span>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
                {/* Side Selector (BUY / SELL) */}
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 dark:bg-[#050811] rounded-xl border border-slate-200 dark:border-white/10">
                    <button
                        type="button"
                        onClick={() => setSide('buy')}
                        className={`py-2 rounded-lg text-xs font-mono font-black uppercase flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                            side === 'buy'
                                ? 'bg-emerald-500 text-slate-950 shadow-sm'
                                : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <TrendingUp className="w-3.5 h-3.5" />
                        <span>Buy / Long</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setSide('sell')}
                        className={`py-2 rounded-lg text-xs font-mono font-black uppercase flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                            side === 'sell'
                                ? 'bg-rose-500 text-white shadow-sm'
                                : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <TrendingDown className="w-3.5 h-3.5" />
                        <span>Sell / Short</span>
                    </button>
                </div>

                {/* Strategy Selector */}
                <div>
                    <label className="text-[10.5px] font-mono font-bold text-slate-500 dark:text-gray-400 mb-1.5 block uppercase tracking-wider">
                        Execution Algorithm
                    </label>
                    <div className="grid grid-cols-2 gap-2.5">
                        <button
                            type="button"
                            onClick={() => setStrategy('TWAP')}
                            className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer ${
                                strategy === 'TWAP'
                                    ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-700 dark:text-cyan-300'
                                    : 'bg-slate-50 dark:bg-[#050811] border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-400 hover:border-cyan-500/30'
                            }`}
                        >
                            <Clock size={18} />
                            <div className="text-center">
                                <span className="text-xs font-mono font-black block">TWAP</span>
                                <span className="text-[9.5px] opacity-75">Time-Weighted Slicing</span>
                            </div>
                        </button>
                        <button
                            type="button"
                            onClick={() => setStrategy('VWAP')}
                            className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer ${
                                strategy === 'VWAP'
                                    ? 'bg-purple-500/15 border-purple-500/50 text-purple-700 dark:text-purple-300'
                                    : 'bg-slate-50 dark:bg-[#050811] border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-400 hover:border-purple-500/30'
                            }`}
                        >
                            <BarChart2 size={18} />
                            <div className="text-center">
                                <span className="text-xs font-mono font-black block">VWAP</span>
                                <span className="text-[9.5px] opacity-75">Volume-Weighted Slicing</span>
                            </div>
                        </button>
                    </div>
                </div>

                {/* Parameters */}
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10.5px] font-mono font-bold text-slate-500 dark:text-gray-400 mb-1 block uppercase">
                            Total Size ({baseAsset})
                        </label>
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-[#050811] border border-slate-200 dark:border-white/10 focus:border-cyan-400 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 dark:text-white outline-none"
                        />
                        {estimatedNotionalUsd && (
                            <span className="block text-[10px] font-mono text-slate-500 dark:text-gray-400 mt-1">
                                ≈ ${estimatedNotionalUsd} USD
                            </span>
                        )}
                    </div>
                    <div>
                        <label className="text-[10.5px] font-mono font-bold text-slate-500 dark:text-gray-400 mb-1 block uppercase">
                            Max Slippage ({slippage}%)
                        </label>
                        <div className="flex items-center gap-2 h-[38px] px-3 bg-slate-50 dark:bg-[#050811] border border-slate-200 dark:border-white/10 rounded-xl">
                            <input
                                type="range"
                                min="0.1"
                                max="5"
                                step="0.1"
                                value={slippage}
                                onChange={(e) => setSlippage(parseFloat(e.target.value))}
                                className="flex-1 h-1.5 bg-slate-200 dark:bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                            />
                            <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">
                                {slippage}%
                            </span>
                        </div>
                    </div>
                </div>

                {/* Duration Pills */}
                <div>
                    <label className="text-[10.5px] font-mono font-bold text-slate-500 dark:text-gray-400 mb-1.5 block uppercase">
                        Execution Horizon
                    </label>
                    <div className="grid grid-cols-5 gap-1.5">
                        {durations.map((d) => (
                            <button
                                key={d.label}
                                type="button"
                                onClick={() => setDuration(d.value)}
                                className={`py-1.5 rounded-lg text-xs font-mono font-bold transition-colors border cursor-pointer ${
                                    duration === d.value
                                        ? 'bg-cyan-500 text-slate-950 border-cyan-500'
                                        : 'bg-slate-50 dark:bg-[#050811] text-slate-600 dark:text-gray-400 border-slate-200 dark:border-white/10 hover:border-cyan-500/40'
                                }`}
                            >
                                {d.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Preview Action Button */}
                <Button
                    variant="secondary"
                    className="w-full flex items-center justify-center gap-2 py-2.5 text-xs font-mono font-black uppercase"
                    onClick={handlePreview}
                    disabled={isLoading}
                >
                    {isLoading ? (
                        'Simulating Order Schedule...'
                    ) : (
                        <>
                            <Settings size={15} /> Preview {strategy} Slice Map
                        </>
                    )}
                </Button>

                {/* Timeline Preview */}
                {previewSlices.length > 0 ? (
                    <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-white/10">
                        <div className="flex items-center justify-between">
                            <h4 className="text-[10.5px] font-mono font-black text-slate-500 dark:text-gray-400 uppercase">
                                Execution Slice Schedule
                            </h4>
                            <span className="text-[10px] font-mono font-black text-cyan-600 dark:text-cyan-300 bg-cyan-500/15 px-2 py-0.5 rounded-md">
                                {previewSlices.length} Child Orders
                            </span>
                        </div>
                        <div className="bg-slate-50 dark:bg-[#050811] rounded-xl p-3 max-h-[220px] overflow-y-auto custom-scrollbar border border-slate-200 dark:border-white/10">
                            <OrderTimeline slices={previewSlices} />
                        </div>

                        <div className="pt-2 space-y-3">
                            <div className="flex justify-between items-center text-xs font-mono">
                                <span className="text-slate-500 dark:text-gray-400">
                                    Ref Execution Price
                                </span>
                                <span className="font-black text-slate-900 dark:text-white">
                                    {formattedRefPrice}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={handleExecute}
                                disabled={isExecuting}
                                className={`w-full py-3 rounded-xl text-xs font-mono font-black uppercase tracking-wider text-white shadow-lg cursor-pointer transition-all active:scale-98 disabled:opacity-50 flex items-center justify-center gap-2 ${
                                    side === 'buy'
                                        ? 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:brightness-110'
                                        : 'bg-gradient-to-r from-rose-500 to-red-600 hover:brightness-110'
                                }`}
                            >
                                <CheckCircle2 className="w-4 h-4" />
                                <span>
                                    {isExecuting
                                        ? 'Deploying Algo...'
                                        : `Launch ${strategy} ${side.toUpperCase()} (${amount} ${baseAsset})`}
                                </span>
                            </button>
                        </div>
                    </div>
                ) : (
                    !isLoading && (
                        <div className="text-center p-4 border border-dashed border-slate-200 dark:border-white/10 rounded-xl bg-slate-50/50 dark:bg-[#050811]/50">
                            <div className="w-8 h-8 bg-slate-100 dark:bg-white/5 rounded-full flex items-center justify-center mx-auto mb-2 text-slate-400">
                                <ArrowRight size={15} />
                            </div>
                            <p className="text-[11px] font-mono text-slate-500 dark:text-gray-400">
                                Click &ldquo;Preview {strategy} Slice Map&rdquo; to inspect child order intervals
                            </p>
                        </div>
                    )
                )}
            </div>
        </div>
    );
});

export default SmartExecutionWidget;
