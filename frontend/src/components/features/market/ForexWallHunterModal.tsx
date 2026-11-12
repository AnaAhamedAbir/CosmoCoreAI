import { useState, FC } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, X } from 'lucide-react';
import { botService } from '../../../services/botService';
import { useFloatingModalDrag } from '../../../hooks/useFloatingModalDrag';
import { useDeviceProfile } from '../../../hooks/useDeviceProfile';

export const ForexWallHunterModal: FC<{
    isOpen: boolean;
    onClose: () => void;
    onDeploySuccess?: (botId: number) => void;
}> = ({ isOpen, onClose, onDeploySuccess }) => {
    const { isThermalGuardActive } = useDeviceProfile();
    const [isLoading, setIsLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [activeTab, setActiveTab] = useState('basic');

    const { modalContainerRef, handleStartDrag, containerStyle } = useFloatingModalDrag({
        isOpen,
        storageKey: 'cosmo_forex_wallhunter_modal_pos_v1',
        defaultWidth: 355,
        defaultHeight: 430,
        maxCapHeight: 460,
    });

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

    if (!isOpen || typeof document === 'undefined') return null;

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

    return createPortal(
        <div
            ref={modalContainerRef}
            style={containerStyle}
            className={`cosmo-theme-modal fixed w-[355px] max-w-[calc(100vw-12px)] rounded-xl border z-[99999] overflow-hidden transition-colors duration-200 select-none flex flex-col ${
                isThermalGuardActive
                    ? 'bg-[#080c16] border-emerald-500/45 shadow-[0_14px_36px_rgba(0,0,0,0.92)]'
                    : 'bg-[#070b14] bg-gradient-to-b from-[#0c1220]/95 via-[#080d1a]/[0.98] to-[#050811]/[0.98] border-emerald-500/35 shadow-[0_14px_40px_rgba(0,0,0,0.85),0_0_20px_rgba(16,185,129,0.18),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl'
            }`}
        >
            {/* Top Neon Horizon Accent Line */}
            <div className="h-[1.5px] w-full bg-gradient-to-r from-transparent via-emerald-400 to-teal-500 opacity-85 shrink-0" />

            {/* Draggable Header */}
            <div
                onMouseDown={handleStartDrag}
                onTouchStart={handleStartDrag}
                style={{ touchAction: 'none' }}
                className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/[0.03] cursor-grab active:cursor-grabbing select-none shrink-0"
                title="Drag to move modal"
            >
                <div className="flex items-center gap-1.5 pointer-events-none min-w-0">
                    <GripVertical className="w-3.5 h-3.5 text-emerald-400/80 shrink-0" />
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <div className="flex flex-col min-w-0">
                        <h2 className="text-xs font-black italic text-white tracking-tight flex items-center gap-1 leading-tight">
                            <span className="text-emerald-400">EXNESS</span> FOREX HUNTER
                        </h2>
                        <span className="text-[8.5px] text-gray-400 font-mono truncate">
                            {form.symbol} • {form.timeframe} • {form.lotSize} Lot
                        </span>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="p-1 rounded-md bg-white/[0.04] hover:bg-rose-500/20 border border-white/[0.08] hover:border-rose-500/40 text-gray-400 hover:text-rose-300 transition-all cursor-pointer shrink-0"
                    title="Close"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* --- TABS NAVIGATION --- */}
            <div className="flex gap-1 border-b border-white/10 px-3 py-1.5 overflow-x-auto flex-shrink-0 hide-scrollbar">
                <button
                    type="button"
                    onClick={() => setActiveTab('basic')}
                    className={`px-2.5 py-1 text-[9.5px] font-black tracking-wider uppercase rounded-lg transition-all cursor-pointer ${activeTab === 'basic' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-gray-500 hover:bg-white/5 border border-transparent'}`}
                >
                    Basic Setup
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('risk')}
                    className={`px-2.5 py-1 text-[9.5px] font-black tracking-wider uppercase rounded-lg transition-all cursor-pointer ${activeTab === 'risk' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'text-gray-500 hover:bg-white/5 border border-transparent'}`}
                >
                    Risk (Pips)
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('strategy')}
                    className={`px-2.5 py-1 text-[9.5px] font-black tracking-wider uppercase rounded-lg transition-all cursor-pointer ${activeTab === 'strategy' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'text-gray-500 hover:bg-white/5 border border-transparent'}`}
                >
                    Strategy
                </button>
            </div>

            {/* --- COMPACT SCROLLABLE CONTENT --- */}
            <div
                style={{ touchAction: 'pan-y' }}
                className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 custom-scrollbar space-y-2.5"
            >
                {activeTab === 'basic' && (
                    <div className="animate-fadeIn space-y-2.5">
                        <div className="space-y-0.5">
                            <label className="text-[9px] text-gray-500 font-bold uppercase block">Bot Name (Optional)</label>
                            <input
                                className="w-full bg-white/5 px-2.5 py-1.5 rounded-lg text-emerald-400 outline-none border border-white/10 focus:border-emerald-500 text-xs transition-all font-mono"
                                placeholder="e.g. Gold Scalper"
                                value={form.botName}
                                onChange={(e) => handleFormChange('botName', e.target.value)}
                                maxLength={50}
                            />
                        </div>

                        <div className="flex gap-2">
                            <div className="space-y-0.5 w-1/2">
                                <label className="text-[9px] text-gray-500 font-bold uppercase block">Forex Pair</label>
                                <select
                                    className="w-full bg-white/5 px-2 py-1.5 rounded-lg text-white outline-none text-xs font-bold border border-white/10 focus:border-emerald-500"
                                    value={form.symbol}
                                    onChange={(e) => handleFormChange('symbol', e.target.value)}
                                >
                                    {forexPairs.map(pair => (
                                        <option key={pair} className="bg-[#000000] text-white" value={pair}>{pair}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-0.5 w-1/2">
                                <label className="text-[9px] text-gray-500 font-bold uppercase block">Timeframe</label>
                                <select
                                    className="w-full bg-white/5 px-2 py-1.5 rounded-lg text-white outline-none text-xs font-bold border border-white/10 focus:border-emerald-500"
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

                        <div className="space-y-1 p-2.5 bg-white/5 border border-white/10 rounded-xl">
                            <label className="text-[9px] text-emerald-400 font-bold uppercase block">MetaAPI Profile ID</label>
                            <input
                                className="w-full bg-black/40 border border-white/10 px-2.5 py-1.5 rounded-lg text-white outline-none focus:border-emerald-500 text-xs font-mono"
                                placeholder="Enter MetaAPI profile/account ID"
                                value={form.metaApiProfileId}
                                onChange={(e) => handleFormChange('metaApiProfileId', e.target.value)}
                            />
                            <p className="text-[9px] text-gray-500 leading-tight">Connects bot to your Exness MT5 account via MetaAPI cloud.</p>
                        </div>
                    </div>
                )}

                {activeTab === 'risk' && (
                    <div className="animate-fadeIn space-y-2.5">
                        <div className="p-2.5 bg-emerald-500/5 border border-emerald-500/20 rounded-xl space-y-1">
                            <label className="text-[9px] text-emerald-400 font-bold uppercase tracking-wider text-center block">Position Size (Lots)</label>
                            <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                className="w-full bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2 text-emerald-400 outline-none text-center font-mono font-black text-lg"
                                value={form.lotSize}
                                onChange={(e) => handleFormChange('lotSize', parseFloat(e.target.value) || 0)}
                            />
                            <p className="text-[9px] text-center text-gray-500">Min: 0.01 Lot</p>
                        </div>

                        <div className="flex gap-2">
                            <div className="space-y-1 w-1/2 p-2.5 bg-red-500/5 border border-red-500/20 rounded-xl">
                                <label className="text-[9px] text-red-400 font-bold uppercase block">Stop Loss (Pips)</label>
                                <input
                                    type="number"
                                    step="1"
                                    className="w-full bg-black/40 border border-red-500/30 rounded-lg p-1.5 text-red-400 outline-none text-center font-mono font-bold text-xs"
                                    value={form.stopLossPips}
                                    onChange={(e) => handleFormChange('stopLossPips', parseInt(e.target.value) || 0)}
                                />
                            </div>
                            <div className="space-y-1 w-1/2 p-2.5 bg-green-500/5 border border-green-500/20 rounded-xl">
                                <label className="text-[9px] text-green-400 font-bold uppercase block">Take Profit (Pips)</label>
                                <input
                                    type="number"
                                    step="1"
                                    className="w-full bg-black/40 border border-green-500/30 rounded-lg p-1.5 text-green-400 outline-none text-center font-mono font-bold text-xs"
                                    value={form.takeProfitPips}
                                    onChange={(e) => handleFormChange('takeProfitPips', parseInt(e.target.value) || 0)}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'strategy' && (
                    <div className="animate-fadeIn space-y-2">
                        <div
                            className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2 ${form.enableOrderBlock ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/5 border-white/10'}`}
                            onClick={() => handleFormChange('enableOrderBlock', !form.enableOrderBlock)}
                        >
                            <div>
                                <h4 className={`text-xs font-bold ${form.enableOrderBlock ? 'text-emerald-400' : 'text-gray-300'}`}>Smart Order Block Scanner</h4>
                                <p className="text-[9px] text-gray-500">Detect institutional buying/selling zones.</p>
                            </div>
                            <div className={`w-8 h-4 rounded-full transition-colors relative shrink-0 ${form.enableOrderBlock ? 'bg-emerald-500' : 'bg-gray-600'}`}>
                                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${form.enableOrderBlock ? 'right-0.5' : 'left-0.5'}`}></div>
                            </div>
                        </div>

                        <div
                            className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2 ${form.enableIctKillzones ? 'bg-purple-500/10 border-purple-500/30' : 'bg-white/5 border-white/10'}`}
                            onClick={() => handleFormChange('enableIctKillzones', !form.enableIctKillzones)}
                        >
                            <div>
                                <h4 className={`text-xs font-bold ${form.enableIctKillzones ? 'text-purple-400' : 'text-gray-300'}`}>ICT Killzone Filter</h4>
                                <p className="text-[9px] text-gray-500">Only trade during London/NY high volume sessions.</p>
                            </div>
                            <div className={`w-8 h-4 rounded-full transition-colors relative shrink-0 ${form.enableIctKillzones ? 'bg-purple-500' : 'bg-gray-600'}`}>
                                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${form.enableIctKillzones ? 'right-0.5' : 'left-0.5'}`}></div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* --- COMPACT FOOTER --- */}
            <div className="px-3 py-2 border-t border-white/10 bg-black/20 flex-shrink-0 space-y-1.5">
                {errorMsg && (
                    <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-1.5">
                        <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span className="text-red-400 text-[10px] font-bold">{errorMsg}</span>
                    </div>
                )}
                <div className="flex items-center justify-between gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-1.5 rounded-lg font-bold text-gray-400 hover:text-white hover:bg-white/10 transition-colors text-xs cursor-pointer"
                    >
                        CANCEL
                    </button>
                    <button
                        type="button"
                        onClick={handleDeploy}
                        disabled={isLoading}
                        className="flex-1 relative overflow-hidden group px-4 py-1.5 rounded-lg font-black text-white bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-[0_0_16px_rgba(16,185,129,0.28)] transition-all disabled:opacity-50 disabled:cursor-not-allowed text-xs cursor-pointer"
                    >
                        <div className="relative flex items-center justify-center gap-1.5">
                            {isLoading ? (
                                <>
                                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    DEPLOYING...
                                </>
                            ) : (
                                <>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                    DEPLOY FOREX BOT
                                </>
                            )}
                        </div>
                    </button>
                </div>
                <div className="flex items-center justify-between text-[8px] text-gray-500 font-mono">
                    <span>Exness MT5 Cloud Engine</span>
                    <span>Drag header to position anywhere</span>
                </div>
            </div>
        </div>,
        document.body
    );
};
