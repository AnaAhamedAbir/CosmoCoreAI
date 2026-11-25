
import React, { useState, useRef, useEffect } from 'react';
import { AlertOctagon, LayoutGrid, TrendingDown, ChevronDown, ShieldAlert, X } from 'lucide-react';
import api from '@/services/api';
import toast from 'react-hot-toast';

const PanicButton = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [liquidatePositions, setLiquidatePositions] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handlePanicAction = async (target: string, value?: string, confirmMsg?: string) => {
        if (confirmMsg && !window.confirm(confirmMsg)) {
            return;
        }

        setLoading(true);
        setIsOpen(false);
        const toastId = toast.loading("Executing Kill Protocol...");

        try {
            const payload = { target, value, liquidate_positions: liquidatePositions };
            const response = await api.post('/bots/panic', payload);

            const { message, stopped_count } = response.data;

            if (stopped_count > 0) {
                toast.success(
                    <div>
                        <span className="font-bold block">Protocol Executed</span>
                        <span className="text-sm">{message} ({stopped_count} Stopped)</span>
                    </div>,
                    { id: toastId, duration: 5000, icon: '🛑' }
                );
            } else {
                toast(message || "No bots matched criteria.", { id: toastId, icon: 'ℹ️' });
            }

        } catch (error: any) {
            console.error('Panic Action Failed', error);
            toast.error(error.response?.data?.detail || "Failed to execute panic command", { id: toastId });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative z-50" ref={menuRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                disabled={loading}
                className={`group flex items-center justify-center gap-1.5 px-2.5 sm:px-3 h-9 rounded-xl font-bold transition-colors border cursor-pointer whitespace-nowrap
                    ${isOpen
                        ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-200 border-rose-400 dark:border-rose-500/50 ring-1 ring-rose-500/35'
                        : 'bg-rose-50/70 dark:bg-rose-950/25 text-rose-600 dark:text-rose-300 border-rose-200 dark:border-rose-500/30 hover:bg-rose-100 dark:hover:bg-rose-950/45 hover:border-rose-300 dark:hover:border-rose-500/50'
                    } ${loading ? 'opacity-70 cursor-wait' : ''}`}
                title="Emergency Kill Switch & Panic Controls"
            >
                <span className={`relative flex items-center justify-center ${loading ? 'animate-spin' : ''}`}>
                    {loading ? <AlertOctagon size={15} /> : <ShieldAlert size={15} className="text-rose-500 dark:text-rose-400" />}
                </span>

                <span className="hidden lg:block text-[11px] uppercase tracking-wider font-bold">
                    {loading ? 'Halting...' : 'Kill Switch'}
                </span>

                <ChevronDown size={13} className={`transition-transform duration-200 opacity-75 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-[#0B1120] border border-slate-200 dark:border-rose-500/30 rounded-2xl shadow-2xl z-[100] overflow-hidden p-2">
                    <div className="px-2.5 py-2 text-[11px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800/80 mb-2 flex items-center justify-between">
                        <span>Emergency Kill Switch</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                    </div>
                    
                    <div className="px-3 py-2.5 border border-slate-200 dark:border-slate-800 rounded-xl mb-2 bg-slate-50 dark:bg-[#070B14]">
                        <label className="flex items-center justify-between cursor-pointer group">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                                Market Sell Positions
                            </span>
                            <div className="relative">
                                <input 
                                    type="checkbox" 
                                    className="sr-only" 
                                    checked={liquidatePositions}
                                    onChange={() => setLiquidatePositions(!liquidatePositions)}
                                />
                                <div className={`block w-8 h-5 rounded-full transition-colors ${liquidatePositions ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-700'}`}></div>
                                <div className={`absolute left-1 top-1 bg-white w-3 h-3 rounded-full transition-transform ${liquidatePositions ? 'transform translate-x-3' : ''}`}></div>
                            </div>
                        </label>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-tight">
                            If enabled, bots flatten active holdings to USDT/USDC before shutting down.
                        </p>
                    </div>

                    <div className="flex flex-col gap-1">
                        {/* Option 1: Losing Bots */}
                        <button
                            type="button"
                            onClick={() => handlePanicAction('losing')}
                            className="flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-orange-50 dark:hover:bg-orange-500/10 rounded-xl group transition-colors cursor-pointer"
                        >
                            <div className="p-2 bg-orange-100 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400 rounded-lg border border-orange-500/20">
                                <TrendingDown size={16} />
                            </div>
                            <div>
                                <div className="font-bold text-slate-800 dark:text-slate-100 text-xs">Stop Losing Bots</div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">Halt bots with negative PnL</div>
                            </div>
                        </button>

                        {/* Option 2: Grid Bots */}
                        <button
                            type="button"
                            onClick={() => handlePanicAction('strategy_type', 'grid_trading')}
                            className="flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-xl group transition-colors cursor-pointer"
                        >
                            <div className="p-2 bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded-lg border border-amber-500/20">
                                <LayoutGrid size={16} />
                            </div>
                            <div>
                                <div className="font-bold text-slate-800 dark:text-slate-100 text-xs">Stop Grid Bots</div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">Halt grid execution engines</div>
                            </div>
                        </button>

                        <div className="my-1 border-b border-slate-100 dark:border-slate-800/80"></div>

                        {/* Option 3: STOP ALL */}
                        <button
                            type="button"
                            onClick={() => handlePanicAction('all', undefined, "⚠️ FINAL WARNING: This will stop ALL running bots immediately. Are you sure?")}
                            className="flex items-center gap-3 w-full px-3 py-2 text-left bg-rose-500/5 hover:bg-rose-500/15 rounded-xl group transition-colors border border-rose-500/25 cursor-pointer"
                        >
                            <div className="p-2 bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-lg">
                                <AlertOctagon size={16} />
                            </div>
                            <div>
                                <div className="font-bold text-rose-600 dark:text-rose-400 text-xs uppercase tracking-wider">Emergency Stop All</div>
                                <div className="text-[11px] text-rose-500/80 dark:text-rose-400/80">Halt all bots & cancel orders</div>
                            </div>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PanicButton;
