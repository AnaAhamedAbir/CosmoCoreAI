import React from 'react';
import { X, Download, AlertCircle, ChevronLeft, ChevronRight, Calendar, Clock, FileJson, RefreshCw, BarChart3, ArrowRightLeft, Zap } from 'lucide-react';
import { getYear, getMonth } from 'date-fns';
import Button from '@/components/common/Button';
import SearchableSelect from '@/components/common/SearchableSelect';
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

interface DownloadDataModalProps {
    isOpen: boolean;
    onClose: () => void;
    downloadType: 'candles' | 'trades' | 'convert'; // ✅ Updated Type
    setDownloadType: (t: 'candles' | 'trades' | 'convert') => void; // ✅ Updated Type
    exchanges: string[];
    dlExchange: string;
    setDlExchange: (e: string) => void;
    dlMarkets: string[];
    dlSymbol: string;
    setDlSymbol: (s: string) => void;
    dlTimeframe: string;
    setDlTimeframe: (t: string) => void;
    dlStartDate: string;
    setDlStartDate: (d: string) => void;
    dlEndDate: string;
    setDlEndDate: (d: string) => void;
    isDownloading: boolean;
    downloadProgress: number;
    isLoadingDlMarkets: boolean;
    handleStartDownload: () => void;
    handleStopDownload: () => void;
    // ✅ New Props
    tradeFiles: string[];
    selectedTradeFile: string;
    setSelectedTradeFile: (f: string) => void;
    handleConvertData: () => void;
    isConverting: boolean;
}

const TIMEFRAME_OPTIONS = [
    "1m", "3m", "5m", "15m", "30m", "45m",
    "1h", "2h", "3h", "4h", "6h", "8h", "12h",
    "1d", "3d", "1w", "1M"
];

export const DownloadDataModal: React.FC<DownloadDataModalProps> = ({
    isOpen,
    onClose,
    downloadType,
    setDownloadType,
    exchanges,
    dlExchange,
    setDlExchange,
    dlMarkets,
    dlSymbol,
    setDlSymbol,
    dlTimeframe,
    setDlTimeframe,
    dlStartDate,
    setDlStartDate,
    dlEndDate,
    setDlEndDate,
    isDownloading,
    downloadProgress,
    isLoadingDlMarkets,
    handleStartDownload,
    handleStopDownload,
    // ✅ Destructure New Props
    tradeFiles,
    selectedTradeFile,
    setSelectedTradeFile,
    handleConvertData,
    isConverting
}) => {

    const range = (start: number, end: number, step = 1) => {
        const result = [];
        for (let i = start; i <= end; i += step) {
            result.push(i);
        }
        return result;
    };

    const inputBaseClasses = "w-full bg-white dark:bg-[#050505] border border-gray-300 dark:border-gray-700 rounded-md p-2 text-slate-900 dark:text-white focus:ring-brand-primary focus:border-brand-primary";

    const CustomInputHeader = ({
        date,
        changeYear,
        changeMonth,
        decreaseMonth,
        increaseMonth,
        prevMonthButtonDisabled,
        nextMonthButtonDisabled,
    }: any) => {
        const years = range(2010, getYear(new Date()) + 1, 1);
        const months = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ];

        return (
            <div className="m-2 flex items-center justify-between px-2 py-2 bg-white dark:bg-[#0A0A0A] rounded-lg border-b border-gray-200 dark:border-gray-700">
                <button
                    onClick={decreaseMonth}
                    disabled={prevMonthButtonDisabled}
                    className="p-1 hover:bg-gray-100 dark:hover:bg-[#0A0A0A] rounded-full text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-50"
                    type="button"
                >
                    <ChevronLeft size={18} />
                </button>

                <div className="flex gap-2">
                    <select
                        value={months[getMonth(date)]}
                        onChange={({ target: { value } }) => changeMonth(months.indexOf(value))}
                        className="bg-transparent text-sm font-bold text-slate-800 dark:text-white cursor-pointer focus:outline-none hover:text-brand-primary transition-colors appearance-none text-center"
                    >
                        {months.map((option) => (
                            <option key={option} value={option} className="bg-white dark:bg-[#0A0A0A] text-slate-900 dark:text-white">
                                {option}
                            </option>
                        ))}
                    </select>

                    <select
                        value={getYear(date)}
                        onChange={({ target: { value } }) => changeYear(Number(value))}
                        className="bg-transparent text-sm font-bold text-slate-800 dark:text-white cursor-pointer focus:outline-none hover:text-brand-primary transition-colors appearance-none text-center"
                    >
                        {years.map((option) => (
                            <option key={option} value={option} className="bg-white dark:bg-[#0A0A0A] text-slate-900 dark:text-white">
                                {option}
                            </option>
                        ))}
                    </select>
                </div>

                <button
                    onClick={increaseMonth}
                    disabled={nextMonthButtonDisabled}
                    className="p-1 hover:bg-gray-100 dark:hover:bg-[#0A0A0A] rounded-full text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-50"
                    type="button"
                >
                    <ChevronRight size={18} />
                </button>
            </div>
        );
    };

    // Tab configuration
    const tabs = [
        { key: 'candles' as const, label: 'Candles', icon: <BarChart3 size={14} /> },
        { key: 'trades' as const, label: 'Trades', icon: <Zap size={14} /> },
        { key: 'convert' as const, label: 'Convert', icon: <ArrowRightLeft size={14} /> },
    ];

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-md p-4 pt-16 animate-backdrop-fade-in">
            <div className="animate-modal-content-slide-down w-full max-w-lg">
                {/* Main Card */}
                <div className="relative bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 overflow-hidden"
                     style={{ boxShadow: '0 25px 60px -12px rgba(0, 0, 0, 0.5), 0 0 40px -15px rgba(99, 102, 241, 0.3)' }}>

                    {/* ───────── Header with animated gradient ───────── */}
                    <div className="relative overflow-hidden">
                        {/* Animated gradient background */}
                        <div className="absolute inset-0 bg-gradient-to-br from-brand-primary via-indigo-600 to-violet-700" />

                        {/* Subtle animated grid overlay */}
                        <div className="absolute inset-0 opacity-10"
                             style={{
                                 backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
                                 backgroundSize: '24px 24px',
                             }} />

                        {/* Floating orbs */}
                        <div className="absolute -top-4 -right-4 w-24 h-24 bg-white/10 rounded-full blur-xl" />
                        <div className="absolute -bottom-6 -left-6 w-32 h-32 bg-violet-400/15 rounded-full blur-2xl" />

                        {/* Header Content */}
                        <div className="relative px-6 py-5 flex items-start justify-between">
                            <div className="flex items-center gap-3">
                                {/* Icon Badge */}
                                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20 shadow-lg">
                                    {downloadType === 'convert'
                                        ? <RefreshCw size={20} className="text-white" />
                                        : <Download size={20} className="text-white" />}
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white tracking-tight">
                                        {downloadType === 'convert' ? 'Convert Market Data' : 'Download Market Data'}
                                    </h3>
                                    <p className="text-indigo-200 text-xs mt-0.5">
                                        {downloadType === 'convert'
                                            ? "Convert trade ticks → OHLCV candle bars"
                                            : "Fetch historical data from exchanges"}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-white/80 hover:text-white transition-all duration-200 hover:scale-105 mt-0.5"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    {/* ───────── Segmented Tabs ───────── */}
                    <div className="px-6 pt-5 pb-1">
                        <div className="flex bg-gray-100 dark:bg-[#0d1117] p-1 rounded-xl border border-gray-200 dark:border-gray-700/50">
                            {tabs.map((tab) => (
                                <button
                                    key={tab.key}
                                    onClick={() => setDownloadType(tab.key)}
                                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all duration-300 ${
                                        downloadType === tab.key
                                            ? 'bg-white dark:bg-brand-primary text-brand-primary dark:text-white shadow-md dark:shadow-brand-primary/30'
                                            : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                                    }`}
                                >
                                    {tab.icon}
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* ───────── Body ───────── */}
                    <div className="px-6 py-5 space-y-5">

                        {/* ✅ Condition based Rendering */}
                        {downloadType === 'convert' ? (
                            <div className="space-y-4">
                                {/* Trade File Select */}
                                <div>
                                    <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Select Trade File</label>
                                    <div className="relative">
                                        <select
                                            className="w-full appearance-none bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-gray-700/60 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary/60 transition-all duration-200"
                                            value={selectedTradeFile}
                                            onChange={(e) => setSelectedTradeFile(e.target.value)}
                                        >
                                            <option value="" disabled>Select a file...</option>
                                            <option value="all">All Files (Batch Convert)</option>
                                            {tradeFiles.map(file => (
                                                <option key={file} value={file}>{file}</option>
                                            ))}
                                        </select>
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                            <ChevronRight size={14} className="text-gray-400 rotate-90" />
                                        </div>
                                    </div>
                                </div>

                                {/* Timeframe */}
                                <div>
                                    <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Target Timeframe</label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {['1m', '5m', '15m', '1h', '4h', '1d'].map(tf => (
                                            <button
                                                key={tf}
                                                onClick={() => setDlTimeframe(tf)}
                                                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold border transition-all duration-200 ${
                                                    dlTimeframe === tf
                                                        ? 'bg-brand-primary/10 dark:bg-brand-primary/20 border-brand-primary/40 text-brand-primary dark:text-indigo-300 shadow-sm shadow-brand-primary/10'
                                                        : 'border-gray-200 dark:border-gray-700/50 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                                                }`}
                                            >
                                                {tf}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Info Card */}
                                <div className="flex items-start gap-3 p-3.5 bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-900/15 dark:to-violet-900/10 text-indigo-700 dark:text-indigo-300 rounded-xl text-xs border border-indigo-100 dark:border-indigo-800/30">
                                    <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 shrink-0">
                                        <FileJson size={14} />
                                    </div>
                                    <p className="leading-relaxed pt-1">This will convert raw trade data (.csv) into OHLCV candles for the selected timeframe.</p>
                                </div>
                            </div>
                        ) : (
                            // Standard Download Form
                            <div className="space-y-4">
                                {/* Exchange & Market Pair Row */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Exchange</label>
                                        <div className="relative">
                                            <select
                                                className="w-full appearance-none bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-gray-700/60 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary/60 transition-all duration-200"
                                                value={dlExchange}
                                                onChange={(e) => setDlExchange(e.target.value)}
                                            >
                                                {exchanges.map(ex => <option key={ex} value={ex}>{ex.toUpperCase()}</option>)}
                                            </select>
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                                <ChevronRight size={14} className="text-gray-400 rotate-90" />
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                                            {isLoadingDlMarkets ? "Loading Markets..." : "Market Pair"}
                                        </label>
                                        <SearchableSelect options={dlMarkets} value={dlSymbol} onChange={setDlSymbol} />
                                    </div>
                                </div>

                                {/* Timeframe Chips */}
                                {downloadType === 'candles' && (
                                    <div>
                                        <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Timeframe</label>
                                        <div className="flex flex-wrap gap-1.5">
                                            {['1m', '5m', '15m', '1h', '4h', '1d'].map(tf => (
                                                <button
                                                    key={tf}
                                                    onClick={() => setDlTimeframe(tf)}
                                                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold border transition-all duration-200 ${
                                                        dlTimeframe === tf
                                                            ? 'bg-brand-primary/10 dark:bg-brand-primary/20 border-brand-primary/40 text-brand-primary dark:text-indigo-300 shadow-sm shadow-brand-primary/10'
                                                            : 'border-gray-200 dark:border-gray-700/50 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                                                    }`}
                                                >
                                                    {tf}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Date Selection */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="relative group">
                                        <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Start Date</label>
                                        <div className="relative">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none z-10">
                                                <Calendar size={14} className="text-gray-400 group-focus-within:text-brand-primary transition-colors" />
                                            </div>
                                            <DatePicker
                                                selected={dlStartDate ? new Date(dlStartDate) : null}
                                                onChange={(date: Date) => setDlStartDate(date?.toISOString().split('T')[0] || '')}
                                                className={`${inputBaseClasses} !rounded-xl pl-9 font-medium transition-all hover:border-brand-primary/50 cursor-pointer`}
                                                dateFormat="yyyy-MM-dd"
                                                placeholderText="Select start"
                                                renderCustomHeader={CustomInputHeader}
                                                calendarClassName="!bg-white dark:!bg-[#050505] !border-gray-200 dark:!border-gray-700 !font-sans !text-slate-900 dark:!text-slate-100 shadow-xl rounded-xl overflow-hidden"
                                                dayClassName={() => "dark:text-slate-200 hover:!bg-brand-primary hover:!text-white rounded-full"}
                                                popperClassName="!z-50"
                                            />
                                        </div>
                                    </div>

                                    <div className="relative group">
                                        <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">End Date</label>
                                        <div className="relative">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none z-10">
                                                <Clock size={14} className="text-gray-400 group-focus-within:text-brand-primary transition-colors" />
                                            </div>
                                            <DatePicker
                                                selected={dlEndDate ? new Date(dlEndDate) : null}
                                                onChange={(date: Date) => setDlEndDate(date?.toISOString().split('T')[0] || '')}
                                                className={`${inputBaseClasses} !rounded-xl pl-9 font-medium transition-all hover:border-brand-primary/50 cursor-pointer`}
                                                dateFormat="yyyy-MM-dd"
                                                placeholderText="Select end"
                                                renderCustomHeader={CustomInputHeader}
                                                calendarClassName="!bg-white dark:!bg-[#050505] !border-gray-200 dark:!border-gray-700 !font-sans !text-slate-900 dark:!text-slate-100 shadow-xl rounded-xl overflow-hidden"
                                                dayClassName={() => "dark:text-slate-200 hover:!bg-brand-primary hover:!text-white rounded-full"}
                                                popperClassName="!z-50"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ───────── Progress Bar (Download) ───────── */}
                        {isDownloading && (
                            <div className="bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/15 dark:to-blue-900/10 rounded-xl p-4 border border-indigo-100 dark:border-indigo-800/30">
                                <div className="flex justify-between text-xs font-bold mb-2.5">
                                    <span className="text-indigo-600 dark:text-indigo-300 flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
                                        Downloading...
                                    </span>
                                    <span className="text-indigo-500 dark:text-indigo-400 font-mono">{downloadProgress}%</span>
                                </div>
                                <div className="h-2 bg-indigo-100 dark:bg-indigo-900/40 rounded-full overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-gradient-to-r from-brand-primary to-violet-500 transition-all duration-500 ease-out"
                                        style={{ width: `${downloadProgress}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* ───────── Processing State (Convert) ───────── */}
                        {isConverting && (
                            <div className="bg-gradient-to-r from-purple-50 to-fuchsia-50 dark:from-purple-900/15 dark:to-fuchsia-900/10 rounded-xl p-4 border border-purple-100 dark:border-purple-800/30">
                                <div className="flex justify-center items-center gap-2 text-xs font-bold text-purple-600 dark:text-purple-300">
                                    <RefreshCw size={14} className="animate-spin" />
                                    Converting Data... Please Wait
                                </div>
                            </div>
                        )}

                        {/* ───────── Trade Warning ───────── */}
                        {downloadType === 'trades' && !isConverting && (
                            <div className="flex items-start gap-3 p-3.5 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/15 dark:to-orange-900/10 text-amber-700 dark:text-amber-300 rounded-xl text-xs border border-amber-100 dark:border-amber-800/30">
                                <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/40 shrink-0">
                                    <AlertCircle size={14} />
                                </div>
                                <p className="leading-relaxed pt-1">Trade data is massive. Downloading large ranges may take a while and consume significant validation time.</p>
                            </div>
                        )}
                    </div>

                    {/* ───────── Footer ───────── */}
                    <div className="px-6 py-4 bg-gray-50/80 dark:bg-[#0a0f1a] border-t border-gray-200 dark:border-gray-700/40 flex justify-end gap-2.5">
                        <button
                            onClick={onClose}
                            disabled={isDownloading || isConverting}
                            className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700/50 transition-all duration-200 disabled:opacity-40"
                        >
                            Cancel
                        </button>

                        {/* ✅ Dynamic Buttons based on Type */}
                        {downloadType === 'convert' ? (
                            <button
                                onClick={handleConvertData}
                                disabled={isConverting}
                                className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 flex items-center gap-2"
                            >
                                {isConverting ? (
                                    <>
                                        <RefreshCw size={14} className="animate-spin" />
                                        Converting...
                                    </>
                                ) : (
                                    <>
                                        <ArrowRightLeft size={14} />
                                        Start Conversion
                                    </>
                                )}
                            </button>
                        ) : (
                            isDownloading ? (
                                <button
                                    onClick={handleStopDownload}
                                    className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 shadow-lg shadow-red-500/25 hover:shadow-red-500/40 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2"
                                >
                                    <X size={14} />
                                    Stop Download
                                </button>
                            ) : (
                                <button
                                    onClick={handleStartDownload}
                                    className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-brand-primary to-violet-600 hover:from-indigo-400 hover:to-violet-500 shadow-lg shadow-brand-primary/25 hover:shadow-brand-primary/40 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2"
                                >
                                    <Download size={14} />
                                    Start Download
                                </button>
                            )
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
