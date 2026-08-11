import React from 'react';

interface AdvancedRiskManagerProps {
    form: any;
    setForm: React.Dispatch<React.SetStateAction<any>>;
    quoteAsset?: string;
}

export const AdvancedRiskManager: React.FC<AdvancedRiskManagerProps> = ({ form, setForm, quoteAsset = 'USDT' }) => {
    const handleFormChange = (field: string, value: any) => {
        setForm((prev: any) => ({ ...prev, [field]: value }));
    };

    return (
        <div className="space-y-6">
            {/* Break-even Protection Section */}
            <div className="bg-[#000000] border border-white/10 rounded-2xl p-4 transition-all hover:border-yellow-500/30">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-sm font-bold text-white tracking-wide">Enable Break-even Protection</h3>
                        <p className="text-[10px] text-gray-400 mt-1">Stops the bot if PNL drops to zero after being in profit.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={form.enableBreakevenStop || false}
                            onChange={(e) => handleFormChange('enableBreakevenStop', e.target.checked)}
                            className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-yellow-500"></div>
                    </label>
                </div>

                {form.enableBreakevenStop && (
                    <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-white/5 animate-fade-in">
                        <div className="col-span-2">
                            <label className="block text-[10px] font-bold text-gray-400 mb-1">Input Mode</label>
                            <select
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-yellow-500/50"
                                value={form.breakevenType || 'pct'}
                                onChange={(e) => handleFormChange('breakevenType', e.target.value)}
                            >
                                <option value="pct" className="bg-[#1a1a1a] text-white">Percentage (%)</option>
                                <option value="usd" className="bg-[#1a1a1a] text-white">Amount ({quoteAsset})</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 mb-1">
                                Activation Threshold {form.breakevenType === 'usd' ? `(${quoteAsset})` : '(PNL %)'}
                            </label>
                            <input
                                type="number"
                                step={form.breakevenType === 'usd' ? "1" : "0.1"}
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-yellow-500/50"
                                value={form.breakevenActivationPct || 1.0}
                                onChange={(e) => handleFormChange('breakevenActivationPct', parseFloat(e.target.value))}
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 mb-1">
                                Safety Stop Level {form.breakevenType === 'usd' ? `(${quoteAsset})` : '(PNL %)'}
                            </label>
                            <input
                                type="number"
                                step={form.breakevenType === 'usd' ? "0.5" : "0.05"}
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-yellow-500/50"
                                value={form.breakevenFeeBufferPct || 0.2}
                                onChange={(e) => handleFormChange('breakevenFeeBufferPct', parseFloat(e.target.value))}
                            />
                        </div>
                        <div className="flex items-center justify-between col-span-2 bg-black/40 p-2 rounded-xl">
                            <span className="text-[10px] font-bold text-gray-400">Trailing Break-even</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={form.enableTrailingBreakeven || false}
                                    onChange={(e) => handleFormChange('enableTrailingBreakeven', e.target.checked)}
                                    className="sr-only peer"
                                />
                                <div className="w-7 h-4 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-yellow-500"></div>
                            </label>
                        </div>
                        
                        {form.enableTrailingBreakeven && (
                            <div className="col-span-2 grid grid-cols-2 gap-4 bg-black/20 p-3 rounded-xl border border-white/5 animate-fade-in">
                                <div className="col-span-2">
                                    <label className="block text-[10px] font-bold text-gray-400 mb-1">Trailing Mode</label>
                                    <select
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-yellow-500/50"
                                        value={form.trailingBreakevenMode || 'auto'}
                                        onChange={(e) => handleFormChange('trailingBreakevenMode', e.target.value)}
                                    >
                                        <option value="auto" className="bg-[#1a1a1a] text-white">Auto (Smart 50% Lock)</option>
                                        <option value="manual" className="bg-[#1a1a1a] text-white">Custom (Manual)</option>
                                    </select>
                                </div>
                                {form.trailingBreakevenMode === 'manual' && (
                                    <>
                                        <div>
                                            <label className="block text-[10px] font-bold text-gray-400 mb-1">Distance Type</label>
                                            <select
                                                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-yellow-500/50"
                                                value={form.trailingBreakevenType || 'pct'}
                                                onChange={(e) => handleFormChange('trailingBreakevenType', e.target.value)}
                                            >
                                                <option value="pct" className="bg-[#1a1a1a] text-white">Percentage (%)</option>
                                                <option value="usd" className="bg-[#1a1a1a] text-white">Amount ({quoteAsset})</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-gray-400 mb-1">Trailing Distance {form.trailingBreakevenType === 'usd' ? `(${quoteAsset})` : '(%)'}</label>
                                            <input
                                                type="number"
                                                step={form.trailingBreakevenType === 'usd' ? "1" : "0.1"}
                                                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-yellow-500/50"
                                                value={form.trailingBreakevenDistance || 0}
                                                onChange={(e) => handleFormChange('trailingBreakevenDistance', parseFloat(e.target.value))}
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                        <div className="flex items-center justify-between col-span-2 bg-black/40 p-2 rounded-xl mt-2">
                            <span className="text-[10px] font-bold text-gray-400">Cooldown Timer</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={form.enableBreakevenCooldown || false}
                                    onChange={(e) => handleFormChange('enableBreakevenCooldown', e.target.checked)}
                                    className="sr-only peer"
                                />
                                <div className="w-7 h-4 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-yellow-500"></div>
                            </label>
                        </div>
                        
                        {form.enableBreakevenCooldown && (
                            <div className="col-span-2 animate-fade-in">
                                <label className="block text-[10px] font-bold text-gray-400 mb-1">Cooldown (Minutes)</label>
                                <input
                                    type="number"
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-yellow-500/50"
                                    value={form.breakevenCooldownMins || 0}
                                    onChange={(e) => handleFormChange('breakevenCooldownMins', parseFloat(e.target.value))}
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Global Take Profit Section */}
            <div className="bg-[#000000] border border-white/10 rounded-2xl p-4 transition-all hover:border-emerald-500/30">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-sm font-bold text-white tracking-wide">Enable Global Take Profit Target</h3>
                        <p className="text-[10px] text-gray-400 mt-1">Stops bot or notifies when total profit is reached.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={form.enableGlobalTp || false}
                            onChange={(e) => handleFormChange('enableGlobalTp', e.target.checked)}
                            className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                    </label>
                </div>

                {form.enableGlobalTp && (
                    <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-white/5 animate-fade-in">
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 mb-1">Target Amount ({quoteAsset})</label>
                            <input
                                type="number"
                                step="1"
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-emerald-400 focus:outline-none focus:border-emerald-500/50"
                                value={form.globalTpTarget || 0}
                                onChange={(e) => handleFormChange('globalTpTarget', parseFloat(e.target.value))}
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 mb-1">Target Type</label>
                            <select
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/50"
                                value={form.globalTpType || 'daily'}
                                onChange={(e) => handleFormChange('globalTpType', e.target.value)}
                            >
                                <option value="daily" className="bg-[#1a1a1a] text-white">Daily Goal</option>
                                <option value="total" className="bg-[#1a1a1a] text-white">All-Time Goal</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 mb-1">Close Mode</label>
                            <select
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/50"
                                value={form.globalTpCloseMode || 'hard'}
                                onChange={(e) => handleFormChange('globalTpCloseMode', e.target.value)}
                            >
                                <option value="hard" className="bg-[#1a1a1a] text-white">Hard Close (Market)</option>
                                <option value="soft" className="bg-[#1a1a1a] text-white">Soft Close (Wait for TP)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 mb-1">Action on Hit</label>
                            <select
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/50"
                                value={form.globalTpAction || 'stop_bot'}
                                onChange={(e) => handleFormChange('globalTpAction', e.target.value)}
                            >
                                <option value="stop_bot" className="bg-[#1a1a1a] text-white">Stop Bot</option>
                                <option value="notify_only" className="bg-[#1a1a1a] text-white">Notification Only</option>
                            </select>
                        </div>
                        <div className="flex items-center justify-between col-span-2 bg-black/40 p-2 rounded-xl">
                            <span className="text-[10px] font-bold text-gray-400">Trailing Take Profit</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={form.enableTrailingGlobalTp || false}
                                    onChange={(e) => handleFormChange('enableTrailingGlobalTp', e.target.checked)}
                                    className="sr-only peer"
                                />
                                <div className="w-7 h-4 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500"></div>
                            </label>
                        </div>

                        {form.enableTrailingGlobalTp && (
                            <div className="col-span-2 grid grid-cols-2 gap-4 bg-black/20 p-3 rounded-xl border border-white/5 animate-fade-in">
                                <div className="col-span-2">
                                    <label className="block text-[10px] font-bold text-gray-400 mb-1">Trailing Mode</label>
                                    <select
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/50"
                                        value={form.trailingGlobalTpMode || 'auto'}
                                        onChange={(e) => handleFormChange('trailingGlobalTpMode', e.target.value)}
                                    >
                                        <option value="auto" className="bg-[#1a1a1a] text-white">Auto (20% Drop from Peak)</option>
                                        <option value="manual" className="bg-[#1a1a1a] text-white">Custom (Manual)</option>
                                    </select>
                                </div>
                                {form.trailingGlobalTpMode === 'manual' && (
                                    <>
                                        <div>
                                            <label className="block text-[10px] font-bold text-gray-400 mb-1">Distance Type</label>
                                            <select
                                                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/50"
                                                value={form.trailingGlobalTpType || 'pct'}
                                                onChange={(e) => handleFormChange('trailingGlobalTpType', e.target.value)}
                                            >
                                                <option value="pct" className="bg-[#1a1a1a] text-white">Percentage Drop (%)</option>
                                                <option value="usd" className="bg-[#1a1a1a] text-white">Amount Drop ({quoteAsset})</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-gray-400 mb-1">Trailing Drop Distance</label>
                                            <input
                                                type="number"
                                                step={form.trailingGlobalTpType === 'usd' ? "1" : "0.1"}
                                                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/50"
                                                value={form.trailingGlobalTpDistance || 0}
                                                onChange={(e) => handleFormChange('trailingGlobalTpDistance', parseFloat(e.target.value))}
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
