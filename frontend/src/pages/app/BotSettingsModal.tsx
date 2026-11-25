import React, { useState, useEffect } from 'react';
import { ActiveBot as Bot } from '../../types';
import { botService } from '../../services/botService';
import { toast } from 'react-hot-toast';
import { useMarketStore } from '@/store/marketStore';
import { X, Sliders, ShieldAlert, Cpu } from 'lucide-react';

interface BotSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    bot: Bot | null;
    onUpdate: (updatedBot: Bot) => void;
}

const DEFAULT_STRATEGY_PARAMS: Record<string, Record<string, any>> = {
    'RSI Strategy': { period: 14, lower: 30, upper: 70 },
    'MACD Trend': { fast_period: 12, slow_period: 26, signal_period: 9 },
    'MACD Strategy': { fast_period: 12, slow_period: 26, signal_period: 9 },
    'Bollinger Bands': { period: 20, devfactor: 2.0 },
    'SMA Cross': { fast_period: 10, slow_period: 30 },
};

const IGNORED_KEYS = new Set([
    'riskParams', 'leverage', 'deploymentTarget', 'exchange', 'market',
    'stop_loss', 'take_profit', 'amount_per_trade', 'advanced', 'notifications',
    'orderType', 'limitPrice', 'strategyParams', 'mode', 'scalp_settings',
]);

const BotSettingsModal: React.FC<BotSettingsModalProps> = ({ isOpen, onClose, bot, onUpdate }) => {
    const { activeMarket } = useMarketStore();
    const [saving, setSaving] = useState(false);

    const [generalConfig, setGeneralConfig] = useState({
        trade_value: 100,
        stop_loss: 0,
        take_profit: 0,
        trailing_stop: 0,
        leverage: 1,
        strategy_name: 'RSI Strategy',
        timeframe: '1h',
    });

    const [strategyParams, setStrategyParams] = useState<Record<string, any>>({});

    useEffect(() => {
        if (bot) {
            const currentStrategy = bot.strategy || 'RSI Strategy';
            const rp = bot.config?.riskParams || {};
            const resolvedTp =
                bot.config?.take_profit ??
                (typeof rp.takeProfit === 'number' ? rp.takeProfit : undefined) ??
                rp.takeProfits?.[0]?.target ??
                0;
            const resolvedSl = bot.config?.stop_loss ?? rp.stopLoss ?? 0;

            setGeneralConfig({
                trade_value: bot.trade_value ?? bot.tradeValue ?? bot.config?.amount_per_trade ?? 100,
                stop_loss: Number(resolvedSl) || 0,
                take_profit: Number(resolvedTp) || 0,
                trailing_stop: Number(bot.config?.trailing_stop ?? 0) || 0,
                leverage: Number(bot.config?.leverage ?? rp.leverage ?? 1) || 1,
                strategy_name: currentStrategy,
                timeframe: bot.timeframe || bot.config?.timeframe || '1h',
            });

            const savedParams = bot.config?.strategyParams || bot.config || {};
            const defaults = DEFAULT_STRATEGY_PARAMS[currentStrategy] || {};
            setStrategyParams({ ...defaults, ...savedParams });
        }
    }, [bot, isOpen]);

    const handleStrategyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newStrategy = e.target.value;
        setGeneralConfig((prev) => ({ ...prev, strategy_name: newStrategy }));
        if (DEFAULT_STRATEGY_PARAMS[newStrategy]) {
            setStrategyParams(DEFAULT_STRATEGY_PARAMS[newStrategy]);
        }
    };

    const handleParamChange = (key: string, value: string, isNumeric: boolean) => {
        setStrategyParams((prev) => ({
            ...prev,
            [key]: isNumeric ? (value === '' ? '' : Number(value)) : value,
        }));
    };

    const handleSave = async () => {
        if (!bot) return;
        setSaving(true);
        try {
            const cleanStrategyParams: Record<string, any> = {};
            Object.entries(strategyParams).forEach(([k, v]) => {
                if (!IGNORED_KEYS.has(k) && typeof v !== 'object') {
                    cleanStrategyParams[k] = v;
                }
            });

            const updatePayload = {
                trade_value: Number(generalConfig.trade_value),
                strategy: generalConfig.strategy_name,
                timeframe: generalConfig.timeframe,
                config: {
                    ...(bot.config || {}),
                    ...cleanStrategyParams,
                    strategyParams: cleanStrategyParams,
                    timeframe: generalConfig.timeframe,
                    leverage: Number(generalConfig.leverage),
                    stop_loss: Number(generalConfig.stop_loss),
                    take_profit: Number(generalConfig.take_profit) > 0 ? Number(generalConfig.take_profit) : null,
                    trailing_stop: Number(generalConfig.trailing_stop),
                    amount_per_trade: Number(generalConfig.trade_value),
                    riskParams: {
                        ...(bot.config?.riskParams || {}),
                        stopLoss: Number(generalConfig.stop_loss),
                        takeProfit: Number(generalConfig.take_profit),
                        takeProfits: [{ target: Number(generalConfig.take_profit), amount: 100 }],
                        leverage: Number(generalConfig.leverage),
                    },
                },
            };

            const updatedBot = await botService.updateBot(bot.id, updatePayload);
            toast.success('Configuration updated successfully!');
            onUpdate(updatedBot);
            onClose();
        } catch (error) {
            console.error(error);
            toast.error('Failed to update settings');
        } finally {
            setSaving(false);
        }
    };

    const renderStrategyInputs = () => {
        return Object.keys(strategyParams).map((key) => {
            const value = strategyParams[key];
            if (value === null || value === undefined || typeof value === 'object' || typeof value === 'boolean') return null;
            if (IGNORED_KEYS.has(key)) return null;

            const isNumeric = typeof value === 'number' || (typeof value === 'string' && value !== '' && !isNaN(Number(value)));

            return (
                <div key={key}>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1 truncate" title={key}>
                        {key.replace(/_/g, ' ')}
                    </label>
                    <input
                        type={isNumeric ? 'number' : 'text'}
                        value={value}
                        onChange={(e) => handleParamChange(key, e.target.value, isNumeric)}
                        className="w-full bg-white dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F] rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-white focus:border-brand-primary outline-none"
                    />
                </div>
            );
        });
    };

    if (!isOpen || !bot) return null;

    const inputClass = 'w-full bg-white dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F] rounded-lg px-2.5 py-2 text-xs font-mono text-slate-900 dark:text-white focus:border-brand-primary outline-none';
    const strategyOptions = Array.from(new Set([...Object.keys(DEFAULT_STRATEGY_PARAMS), generalConfig.strategy_name]));

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-5 py-4 border-b border-slate-200 dark:border-[#1F1F1F] flex justify-between items-center bg-slate-50 dark:bg-[#111]">
                    <div>
                        <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <Sliders size={16} className="text-brand-primary" /> Configure {bot.name}
                        </h2>
                        <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                            {bot.exchange?.toUpperCase()} • {bot.market} • {bot.is_paper_trading === false ? 'LIVE' : 'PAPER'}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar">
                    {/* Execution & Allocation */}
                    <div className="bg-slate-50 dark:bg-[#111] p-4 rounded-xl border border-slate-200 dark:border-[#1F1F1F] space-y-3">
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-blue-400">Allocation & Execution</h3>
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                                    {activeMarket === 'forex' ? 'Lot Size' : 'Order Size ($)'}
                                </label>
                                <input
                                    type="number"
                                    value={generalConfig.trade_value}
                                    onChange={(e) => setGeneralConfig({ ...generalConfig, trade_value: Number(e.target.value) })}
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Timeframe</label>
                                <select
                                    value={generalConfig.timeframe}
                                    onChange={(e) => setGeneralConfig({ ...generalConfig, timeframe: e.target.value })}
                                    className={inputClass}
                                >
                                    {['1m', '5m', '15m', '30m', '1h', '4h', '1d'].map((tf) => (
                                        <option key={tf} value={tf}>{tf}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <div className="flex justify-between items-center mb-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase">Leverage</label>
                                    <span className="text-xs font-mono font-bold text-brand-primary">{generalConfig.leverage}x</span>
                                </div>
                                <input
                                    type="range"
                                    min="1"
                                    max="125"
                                    step="1"
                                    value={generalConfig.leverage}
                                    onChange={(e) => setGeneralConfig({ ...generalConfig, leverage: Number(e.target.value) })}
                                    className="w-full mt-2 accent-brand-primary cursor-pointer"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Risk Management */}
                    <div className="bg-slate-50 dark:bg-[#111] p-4 rounded-xl border border-slate-200 dark:border-[#1F1F1F] space-y-3">
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
                            <ShieldAlert size={13} /> Protective Stops
                        </h3>
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className="text-[10px] font-bold text-rose-400 uppercase block mb-1">Stop Loss %</label>
                                <input
                                    type="number"
                                    step="0.25"
                                    value={generalConfig.stop_loss}
                                    onChange={(e) => setGeneralConfig({ ...generalConfig, stop_loss: Number(e.target.value) })}
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-emerald-400 uppercase block mb-1">Take Profit %</label>
                                <input
                                    type="number"
                                    step="0.5"
                                    value={generalConfig.take_profit}
                                    onChange={(e) => setGeneralConfig({ ...generalConfig, take_profit: Number(e.target.value) })}
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-amber-400 uppercase block mb-1">Trailing SL %</label>
                                <input
                                    type="number"
                                    step="0.25"
                                    value={generalConfig.trailing_stop}
                                    onChange={(e) => setGeneralConfig({ ...generalConfig, trailing_stop: Number(e.target.value) })}
                                    className={inputClass}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Strategy Parameters */}
                    <div className="bg-slate-50 dark:bg-[#111] p-4 rounded-xl border border-slate-200 dark:border-[#1F1F1F] space-y-3">
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
                            <Cpu size={13} /> Strategy Logic & Params
                        </h3>
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Active Strategy</label>
                            <select
                                value={generalConfig.strategy_name}
                                onChange={handleStrategyChange}
                                className={inputClass}
                            >
                                {strategyOptions.map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">{renderStrategyInputs()}</div>
                    </div>
                </div>

                <div className="px-5 py-3.5 border-t border-slate-200 dark:border-[#1F1F1F] bg-slate-50 dark:bg-[#111] flex justify-end gap-2.5">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg border border-slate-200 dark:border-[#1F1F1F] text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#1A1A1A] transition"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-2 rounded-lg bg-brand-primary text-white text-xs font-bold hover:opacity-90 disabled:opacity-50 transition"
                    >
                        {saving ? 'Applying...' : 'Save & Hot-Reload'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BotSettingsModal;
