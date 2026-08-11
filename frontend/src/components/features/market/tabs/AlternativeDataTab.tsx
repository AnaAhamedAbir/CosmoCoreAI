import React from 'react';
import { Globe } from 'lucide-react';

interface AlternativeDataTabProps {
    centralBankNlp: boolean;
    setCentralBankNlp: (v: boolean) => void;
    stopHuntModels: boolean;
    setStopHuntModels: (v: boolean) => void;
    macroCalendar: boolean;
    setMacroCalendar: (v: boolean) => void;
    cotData: boolean;
    setCotData: (v: boolean) => void;
    currencyCorrelation: boolean;
    setCurrencyCorrelation: (v: boolean) => void;
    yieldDifferentials: boolean;
    setYieldDifferentials: (v: boolean) => void;
    disabled?: boolean;
}

export const AlternativeDataTab: React.FC<AlternativeDataTabProps> = ({ 
    centralBankNlp, setCentralBankNlp, 
    stopHuntModels, setStopHuntModels, 
    macroCalendar, setMacroCalendar,
    cotData, setCotData,
    currencyCorrelation, setCurrencyCorrelation,
    yieldDifferentials, setYieldDifferentials,
    disabled 
}) => {
    return (
        <div className="space-y-4">
            <h4 className="text-xs font-bold text-teal-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Globe className="w-4 h-4" /> Alternative Data & Sentiment
            </h4>
            
            <button
                disabled={disabled}
                onClick={() => setCentralBankNlp(!centralBankNlp)}
                className={`w-full flex items-start p-3 rounded-xl border text-left transition-all duration-300 relative overflow-hidden ${centralBankNlp ? 'border-teal-400 bg-teal-500/20 shadow-[0_0_15px_rgba(20,184,166,0.15)]' : 'border-white/10 bg-white/5 hover:bg-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <div className={`mt-1 w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${centralBankNlp ? 'border-teal-400 bg-teal-500' : 'border-white/30'}`}>
                    {centralBankNlp && <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                </div>
                <div className="ml-3 flex-1">
                    <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold tracking-wide ${centralBankNlp ? 'text-teal-300' : 'text-slate-200'}`}>Central Bank NLP Sentiment</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                        Real-time parsing of Federal Reserve and ECB speeches for Hawkish/Dovish scores.
                    </p>
                </div>
            </button>

            <button
                disabled={disabled}
                onClick={() => setStopHuntModels(!stopHuntModels)}
                className={`w-full flex items-start p-3 rounded-xl border text-left transition-all duration-300 relative overflow-hidden ${stopHuntModels ? 'border-teal-400 bg-teal-500/20 shadow-[0_0_15px_rgba(20,184,166,0.15)]' : 'border-white/10 bg-white/5 hover:bg-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <div className={`mt-1 w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${stopHuntModels ? 'border-teal-400 bg-teal-500' : 'border-white/30'}`}>
                    {stopHuntModels && <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                </div>
                <div className="ml-3 flex-1">
                    <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold tracking-wide ${stopHuntModels ? 'text-teal-300' : 'text-slate-200'}`}>Stop-Hunt & Liquidity Sweeps</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                        Fakeout Probability Models, Fakeout Vectors, and Liquidity Sweep Velocity trackers.
                    </p>
                </div>
            </button>
            
            <button
                disabled={disabled}
                onClick={() => setMacroCalendar(!macroCalendar)}
                className={`w-full flex items-start p-3 rounded-xl border text-left transition-all duration-300 relative overflow-hidden ${macroCalendar ? 'border-teal-400 bg-teal-500/20 shadow-[0_0_15px_rgba(20,184,166,0.15)]' : 'border-white/10 bg-white/5 hover:bg-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <div className={`mt-1 w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${macroCalendar ? 'border-teal-400 bg-teal-500' : 'border-white/30'}`}>
                    {macroCalendar && <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                </div>
                <div className="ml-3 flex-1">
                    <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold tracking-wide ${macroCalendar ? 'text-teal-300' : 'text-slate-200'}`}>Macroeconomic Calendar</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                        Inject NFP, CPI, and Interest Rate decisions as temporal features.
                    </p>
                </div>
            </button>

            <button
                disabled={disabled}
                onClick={() => setCotData(!cotData)}
                className={`w-full flex items-start p-3 rounded-xl border text-left transition-all duration-300 relative overflow-hidden ${cotData ? 'border-teal-400 bg-teal-500/20 shadow-[0_0_15px_rgba(20,184,166,0.15)]' : 'border-white/10 bg-white/5 hover:bg-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <div className={`mt-1 w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${cotData ? 'border-teal-400 bg-teal-500' : 'border-white/30'}`}>
                    {cotData && <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                </div>
                <div className="ml-3 flex-1">
                    <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold tracking-wide ${cotData ? 'text-teal-300' : 'text-slate-200'}`}>COT Sentiment (Smart Money)</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                        Use weekly Commitment of Traders futures data for spot positioning.
                    </p>
                </div>
            </button>

            <button
                disabled={disabled}
                onClick={() => setCurrencyCorrelation(!currencyCorrelation)}
                className={`w-full flex items-start p-3 rounded-xl border text-left transition-all duration-300 relative overflow-hidden ${currencyCorrelation ? 'border-teal-400 bg-teal-500/20 shadow-[0_0_15px_rgba(20,184,166,0.15)]' : 'border-white/10 bg-white/5 hover:bg-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <div className={`mt-1 w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${currencyCorrelation ? 'border-teal-400 bg-teal-500' : 'border-white/30'}`}>
                    {currencyCorrelation && <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                </div>
                <div className="ml-3 flex-1">
                    <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold tracking-wide ${currencyCorrelation ? 'text-teal-300' : 'text-slate-200'}`}>Currency Correlation Matrix</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                        Train with cross-currency pairs (e.g. EUR/CHF vs USD/CHF).
                    </p>
                </div>
            </button>

            <button
                disabled={disabled}
                onClick={() => setYieldDifferentials(!yieldDifferentials)}
                className={`w-full flex items-start p-3 rounded-xl border text-left transition-all duration-300 relative overflow-hidden ${yieldDifferentials ? 'border-teal-400 bg-teal-500/20 shadow-[0_0_15px_rgba(20,184,166,0.15)]' : 'border-white/10 bg-white/5 hover:bg-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <div className={`mt-1 w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${yieldDifferentials ? 'border-teal-400 bg-teal-500' : 'border-white/30'}`}>
                    {yieldDifferentials && <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                </div>
                <div className="ml-3 flex-1">
                    <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold tracking-wide ${yieldDifferentials ? 'text-teal-300' : 'text-slate-200'}`}>Yield Differentials</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                        Use Central Bank interest rate spreads to predict long-term bias.
                    </p>
                </div>
            </button>
            
        </div>
    );
};
