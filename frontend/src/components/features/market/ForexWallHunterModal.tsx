import { useState, FC } from 'react';
import { botService } from '../../../services/botService';

export const ForexWallHunterModal: FC<{ 
    isOpen: boolean; 
    onClose: () => void; 
    onDeploySuccess?: (botId: number) => void;
}> = ({ isOpen, onClose, onDeploySuccess }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [activeTab, setActiveTab] = useState('basic');

    // Forex specific pairs
    const forexPairs = ['EURUSD', 'GBPUSD', 'XAUUSD', 'USDJPY', 'AUDUSD', 'USDCAD'];

    const [form, setForm] = useState({
        botName: '',
        symbol: 'EURUSD',
        metaApiProfileId: '',
        lotSize: 0.01,
        stopLossPips: 20,
        takeProfitPips: 40,
        
        // Strategy triggers
        enableOrderBlock: true,
        enableIctKillzones: false,
        enableSupertrend: false,
        
        // Advanced Risk
        enableTrailingStop: false,
        trailingStopPips: 10,
        enableBreakeven: false,
        breakevenTriggerPips: 15,
        
        // Timeframe
        timeframe: '15m',
        tradingSessions: ['London', 'New York']
    });

    if (!isOpen) return null;

    const handleDeploy = async () => {
        if (!form.metaApiProfileId.trim()) {
            setErrorMsg("Please enter your MetaAPI Profile ID.");
            return;
        }

        setErrorMsg('');
        setIsLoading(true);

        try {
            const payload = {
                name: form.botName && form.botName.trim() !== '' ? form.botName.trim() : `Forex Hunter: ${form.symbol}`,
                description: `Exness MT5 Forex Bot (${form.symbol})`,
                exchange: 'exness',
                market: form.symbol,
                strategy: 'forex_wall_hunter',
                timeframe: form.timeframe,
                trade_value: form.lotSize,
                trade_unit: "LOT",
                api_key_id: form.metaApiProfileId, // Using API Key field for MetaAPI Profile
                is_paper_trading: false,
                config: {
                    trading_mode: 'forex',
                    lot_size: form.lotSize,
                    stop_loss_pips: form.stopLossPips,
                    take_profit_pips: form.takeProfitPips,
                    
                    enable_order_block: form.enableOrderBlock,
                    enable_ict_killzones: form.enableIctKillzones,
                    enable_supertrend: form.enableSupertrend,
                    
                    enable_trailing_stop: form.enableTrailingStop,
                    trailing_stop_pips: form.trailingStopPips,
                    enable_breakeven: form.enableBreakeven,
                    breakeven_trigger_pips: form.breakevenTriggerPips,
                    
                    trading_sessions: form.tradingSessions,
                }
            };

            const createdBot = await botService.createBot(payload);
            await botService.controlBot(createdBot.id, 'start');

            setTimeout(() => {
                setIsLoading(false);
                if (onDeploySuccess) onDeploySuccess(Number(createdBot.id));
                else onClose();
            }, 1000);
            
        } catch (err: any) {
            console.error(err);
            setErrorMsg(err.response?.data?.detail || err.message || "Failed to deploy Forex bot.");
            setIsLoading(false);
        }
    };

    const handleFormChange = (field: string, value: any) => {
        setForm(prev => ({ ...prev, [field]: value }));
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
            <div className="w-[500px] bg-[#000000] border-2 border-emerald-500/30 rounded-[2rem] p-6 shadow-[0_0_50px_rgba(16,185,129,0.2)] max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center mb-6 flex-shrink-0">
                    <h2 className="text-2xl font-black italic text-white tracking-tighter flex items-center gap-2">
                        <span className="text-emerald-500">EXNESS</span> DEPLOYMENT
                    </h2>
                </div>

                {/* --- TABS NAVIGATION --- */}
                <div className="flex gap-2 border-b border-white/10 mb-4 pb-2 overflow-x-auto flex-shrink-0 hide-scrollbar">
                    <button onClick={() => setActiveTab('basic')} className={`px-4 py-2 text-xs font-black tracking-wider uppercase rounded-xl transition-all ${activeTab === 'basic' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.2)]' : 'text-gray-500 hover:bg-white/5'}`}>Basic Setup</button>
                    <button onClick={() => setActiveTab('risk')} className={`px-4 py-2 text-xs font-black tracking-wider uppercase rounded-xl transition-all ${activeTab === 'risk' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]' : 'text-gray-500 hover:bg-white/5'}`}>Risk (Pips)</button>
                    <button onClick={() => setActiveTab('strategy')} className={`px-4 py-2 text-xs font-black tracking-wider uppercase rounded-xl transition-all ${activeTab === 'strategy' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.2)]' : 'text-gray-500 hover:bg-white/5'}`}>Strategy</button>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-4">
                    {activeTab === 'basic' && (
                        <div className="animate-fadeIn space-y-4">
                            <div className="space-y-1">
                                <label className="text-[10px] text-gray-500 font-bold uppercase">Bot Name (Optional)</label>
                                <input
                                    className="w-full bg-white/5 p-2 rounded-xl text-emerald-400 outline-none border border-transparent focus:border-emerald-500 focus:bg-black/40 text-sm transition-all font-mono"
                                    placeholder="e.g. Gold Scalper"
                                    value={form.botName}
                                    onChange={(e) => handleFormChange('botName', e.target.value)}
                                    maxLength={50}
                                />
                            </div>

                            <div className="flex gap-4">
                                <div className="space-y-1 w-1/2">
                                    <label className="text-[10px] text-gray-500 font-bold uppercase">Forex Pair</label>
                                    <select
                                        className="w-full bg-white/5 p-2.5 rounded-xl text-white outline-none text-sm font-bold border border-transparent focus:border-emerald-500"
                                        value={form.symbol}
                                        onChange={(e) => handleFormChange('symbol', e.target.value)}
                                    >
                                        {forexPairs.map(pair => (
                                            <option key={pair} className="bg-[#000000] text-white" value={pair}>{pair}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1 w-1/2">
                                    <label className="text-[10px] text-gray-500 font-bold uppercase">Timeframe</label>
                                    <select
                                        className="w-full bg-white/5 p-2.5 rounded-xl text-white outline-none text-sm font-bold border border-transparent focus:border-emerald-500"
                                        value={form.timeframe}
                                        onChange={(e) => handleFormChange('timeframe', e.target.value)}
                                    >
                                        <option className="bg-[#000000] text-white" value="1m">1 Minute</option>
                                        <option className="bg-[#000000] text-white" value="5m">5 Minutes</option>
                                        <option className="bg-[#000000] text-white" value="15m">15 Minutes</option>
                                        <option className="bg-[#000000] text-white" value="1h">1 Hour</option>
                                    </select>
                                </div>
                            </div>

                            <div className="space-y-1 p-3 bg-white/5 border border-white/10 rounded-2xl">
                                <label className="text-[10px] text-emerald-400 font-bold uppercase">MetaAPI Profile ID</label>
                                <input
                                    className="w-full bg-black/40 border border-white/10 p-2.5 rounded-xl text-white outline-none focus:border-emerald-500 text-sm font-mono"
                                    placeholder="Enter your MetaAPI profile/account ID"
                                    value={form.metaApiProfileId}
                                    onChange={(e) => handleFormChange('metaApiProfileId', e.target.value)}
                                />
                                <p className="text-[10px] text-gray-500 mt-1">This connects the bot to your Exness MT5 account via MetaAPI cloud.</p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'risk' && (
                        <div className="animate-fadeIn space-y-4">
                            <div className="flex gap-4 p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl">
                                <div className="space-y-1 w-full">
                                    <label className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider text-center block">Position Size (Lots)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0.01"
                                        className="w-full bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 text-emerald-400 outline-none text-center font-mono font-black text-2xl"
                                        value={form.lotSize}
                                        onChange={(e) => handleFormChange('lotSize', parseFloat(e.target.value) || 0)}
                                    />
                                    <p className="text-[10px] text-center text-gray-500 mt-1">Min: 0.01 Lot</p>
                                </div>
                            </div>

                            <div className="flex gap-4">
                                <div className="space-y-1 w-1/2 p-3 bg-red-500/5 border border-red-500/20 rounded-xl">
                                    <label className="text-[10px] text-red-400 font-bold uppercase">Stop Loss (Pips)</label>
                                    <input
                                        type="number"
                                        step="1"
                                        className="w-full bg-black/40 border border-red-500/30 rounded-lg p-2 text-red-400 outline-none text-center font-mono font-bold"
                                        value={form.stopLossPips}
                                        onChange={(e) => handleFormChange('stopLossPips', parseInt(e.target.value) || 0)}
                                    />
                                </div>
                                <div className="space-y-1 w-1/2 p-3 bg-green-500/5 border border-green-500/20 rounded-xl">
                                    <label className="text-[10px] text-green-400 font-bold uppercase">Take Profit (Pips)</label>
                                    <input
                                        type="number"
                                        step="1"
                                        className="w-full bg-black/40 border border-green-500/30 rounded-lg p-2 text-green-400 outline-none text-center font-mono font-bold"
                                        value={form.takeProfitPips}
                                        onChange={(e) => handleFormChange('takeProfitPips', parseInt(e.target.value) || 0)}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'strategy' && (
                        <div className="animate-fadeIn space-y-3">
                             <div className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${form.enableOrderBlock ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/5 border-white/10'}`} onClick={() => handleFormChange('enableOrderBlock', !form.enableOrderBlock)}>
                                <div>
                                    <h4 className={`text-sm font-bold ${form.enableOrderBlock ? 'text-emerald-400' : 'text-gray-300'}`}>Smart Order Block Scanner</h4>
                                    <p className="text-[10px] text-gray-500">Detect institutional buying/selling zones.</p>
                                </div>
                                <div className={`w-8 h-4 rounded-full transition-colors relative ${form.enableOrderBlock ? 'bg-emerald-500' : 'bg-gray-600'}`}>
                                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${form.enableOrderBlock ? 'left-4.5 right-0.5' : 'left-0.5'}`}></div>
                                </div>
                            </div>

                            <div className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${form.enableIctKillzones ? 'bg-purple-500/10 border-purple-500/30' : 'bg-white/5 border-white/10'}`} onClick={() => handleFormChange('enableIctKillzones', !form.enableIctKillzones)}>
                                <div>
                                    <h4 className={`text-sm font-bold ${form.enableIctKillzones ? 'text-purple-400' : 'text-gray-300'}`}>ICT Killzone Filter</h4>
                                    <p className="text-[10px] text-gray-500">Only trade during high volume London/NY sessions.</p>
                                </div>
                                <div className={`w-8 h-4 rounded-full transition-colors relative ${form.enableIctKillzones ? 'bg-purple-500' : 'bg-gray-600'}`}>
                                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${form.enableIctKillzones ? 'left-4.5 right-0.5' : 'left-0.5'}`}></div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* --- FOOTER --- */}
                <div className="mt-6 pt-4 border-t border-white/10 flex-shrink-0">
                    {errorMsg && (
                        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2">
                            <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <span className="text-red-400 text-xs font-bold">{errorMsg}</span>
                        </div>
                    )}
                    <div className="flex justify-end gap-3">
                        <button
                            onClick={onClose}
                            className="px-6 py-2.5 rounded-xl font-bold text-gray-400 hover:text-white hover:bg-white/10 transition-colors text-sm"
                        >
                            CANCEL
                        </button>
                        <button
                            onClick={handleDeploy}
                            disabled={isLoading}
                            className="relative overflow-hidden group px-8 py-2.5 rounded-xl font-black text-white bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <div className="absolute inset-0 w-full h-full bg-white/20 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></div>
                            <div className="relative flex items-center gap-2">
                                {isLoading ? (
                                    <>
                                        <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        DEPLOYING...
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                        DEPLOY FOREX BOT
                                    </>
                                )}
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
