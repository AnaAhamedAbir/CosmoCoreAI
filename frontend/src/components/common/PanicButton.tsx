
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
                onClick={() => setIsOpen(!isOpen)}
                disabled={loading}
                className={`group flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-bold transition-all duration-300 shadow-sm border
                    ${isOpen
                        ? 'bg-red-50 dark:bg-red-950/50 text-slate-900 dark:text-white border-red-300 dark:border-red-500/40 ring-2 ring-red-100 dark:ring-red-900/30'
                        : 'bg-white dark:bg-[#0A0A0A] text-slate-700 dark:text-white border-slate-200 dark:border-white/10 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-slate-900 dark:hover:text-white hover:border-red-200 dark:hover:border-red-500/30'
                    } ${loading ? 'opacity-70 cursor-wait' : ''}`}
                title="Emergency Controls"
            >
                <span className={`relative flex items-center justify-center ${loading ? 'animate-spin' : ''}`}>
                    {loading ? <AlertOctagon size={18} /> : <ShieldAlert size={18} className="text-red-500" />}
                </span>

                <span className="hidden md:block text-xs uppercase tracking-wider text-slate-900 dark:text-white font-extrabold">
                    {loading ? 'Executing...' : 'PANIC PROTOCOL'}
                </span>

                <ChevronDown size={14} className={`transition-transform duration-300 text-slate-500 dark:text-white/80 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-white/15 rounded-xl shadow-2xl z-[100] overflow-hidden animate-in fade-in slide-in-from-top-2 p-1.5 backdrop-blur-xl">
                    <div className="px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-white/10 mb-1 flex items-center justify-between">
                        <span>Select Action</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                    </div>
                    
                    <div className="px-3 py-2 border border-slate-100 dark:border-white/5 rounded-lg mb-1.5 bg-slate-50 dark:bg-white/5">
                        <label className="flex items-center justify-between cursor-pointer group">
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                                Market Sell Positions
                            </span>
                            <div className="relative">
                                <input 
                                    type="checkbox" 
                                    className="sr-only" 
                                    checked={liquidatePositions}
                                    onChange={() => setLiquidatePositions(!liquidatePositions)}
                                />
                                <div className={`block w-8 h-5 rounded-full transition-colors ${liquidatePositions ? 'bg-red-500' : 'bg-slate-300 dark:bg-slate-700'}`}></div>
                                <div className={`absolute left-1 top-1 bg-white w-3 h-3 rounded-full transition-transform ${liquidatePositions ? 'transform translate-x-3' : ''}`}></div>
                            </div>
                        </label>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-tight">
                            If enabled, bots will market sell active holdings to USDT before shutting down.
                        </p>
                    </div>

                    <div className="flex flex-col gap-1">
                        {/* Option 1: Losing Bots */}
                        <button
                            onClick={() => handlePanicAction('losing')}
                            className="flex items-center gap-3 w-full px-3 py-2.5 text-left hover:bg-orange-50 dark:hover:bg-orange-500/10 rounded-lg group transition-colors"
                        >
                            <div className="p-2 bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded-lg group-hover:bg-orange-200 dark:group-hover:bg-orange-500/30 transition-colors">
                                <TrendingDown size={18} />
                            </div>
                            <div>
                                <div className="font-bold text-slate-800 dark:text-slate-100 text-sm">Stop Losing Bots</div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">Halt all bots with negative PnL</div>
                            </div>
                        </button>

                        {/* Option 2: Grid Bots */}
                        <button
                            onClick={() => handlePanicAction('strategy_type', 'grid_trading')}
                            className="flex items-center gap-3 w-full px-3 py-2.5 text-left hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-lg group transition-colors"
                        >
                            <div className="p-2 bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-lg group-hover:bg-amber-200 dark:group-hover:bg-amber-500/30 transition-colors">
                                <LayoutGrid size={18} />
                            </div>
                            <div>
                                <div className="font-bold text-slate-800 dark:text-slate-100 text-sm">Stop Grid Bots</div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">Halt only grid strategy bots</div>
                            </div>
                        </button>

                        <div className="my-1 border-b border-slate-100 dark:border-white/10"></div>

                        {/* Option 3: STOP ALL */}
                        <button
                            onClick={() => handlePanicAction('all', undefined, "⚠️ FINAL WARNING: This will stop ALL running bots immediately. Are you sure?")}
                            className="flex items-center gap-3 w-full px-3 py-2.5 text-left hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg group transition-colors border border-transparent hover:border-red-200 dark:hover:border-red-500/30"
                        >
                            <div className="p-2 bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 rounded-lg group-hover:bg-red-200 dark:group-hover:bg-red-500/30 transition-colors">
                                <AlertOctagon size={18} />
                            </div>
                            <div>
                                <div className="font-bold text-red-600 dark:text-red-400 text-sm">EMERGENCY STOP ALL</div>
                                <div className="text-xs text-red-500/80 dark:text-red-400/80">Immediately halt all trading</div>
                            </div>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PanicButton;
