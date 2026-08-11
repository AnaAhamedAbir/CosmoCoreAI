import React from 'react';
import { Globe, Clock, Activity, CalendarDays, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';

interface ForexDataEngineProps {
    macroCalendar: boolean;
    setMacroCalendar: (v: boolean) => void;
    sessionFeatures: boolean;
    setSessionFeatures: (v: boolean) => void;
    ignoreWeekend: boolean;
    setIgnoreWeekend: (v: boolean) => void;
    tickVolume: boolean;
    setTickVolume: (v: boolean) => void;
    cotData: boolean;
    setCotData: (v: boolean) => void;
    currencyCorrelation: boolean;
    setCurrencyCorrelation: (v: boolean) => void;
    yieldDifferentials: boolean;
    setYieldDifferentials: (v: boolean) => void;
    disabled?: boolean;
}

export const ForexDataEngine: React.FC<ForexDataEngineProps> = ({
    macroCalendar, setMacroCalendar,
    sessionFeatures, setSessionFeatures,
    ignoreWeekend, setIgnoreWeekend,
    tickVolume, setTickVolume,
    cotData, setCotData,
    currencyCorrelation, setCurrencyCorrelation,
    yieldDifferentials, setYieldDifferentials,
    disabled = false
}) => {
    
    const ToggleButton = ({ label, active, onClick, icon: Icon, desc }: any) => (
        <button
            disabled={disabled}
            onClick={onClick}
            className={`w-full flex items-start p-3 rounded-xl border text-left transition-all duration-300 relative overflow-hidden ${active ? 'border-teal-400 bg-teal-500/20 shadow-[0_0_15px_rgba(20,184,166,0.15)]' : 'border-white/10 bg-white/5 hover:bg-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
            <div className={`mt-1 w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${active ? 'border-teal-400 bg-teal-500' : 'border-white/30'}`}>
                {active && <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
            </div>
            <div className="ml-3 flex-1">
                <div className="flex items-center gap-2">
                    <Icon className={`w-3.5 h-3.5 ${active ? 'text-teal-400' : 'text-slate-400'}`} />
                    <span className={`text-sm font-semibold tracking-wide ${active ? 'text-teal-300' : 'text-slate-200'}`}>{label}</span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1 leading-tight">{desc}</p>
            </div>
        </button>
    );

    return (
        <div className="space-y-4">
            <h4 className="text-xs font-bold text-teal-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Globe className="w-4 h-4" /> Forex Data Engine Features
            </h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ToggleButton 
                    label="Macroeconomic Calendar" 
                    desc="Inject NFP, CPI, and Interest Rate decisions as temporal features."
                    icon={CalendarDays}
                    active={macroCalendar} 
                    onClick={() => setMacroCalendar(!macroCalendar)} 
                />
                <ToggleButton 
                    label="Market Session Pipeline" 
                    desc="Encode Asian, London, and NY overlapping session volatilities."
                    icon={Clock}
                    active={sessionFeatures} 
                    onClick={() => setSessionFeatures(!sessionFeatures)} 
                />
                <ToggleButton 
                    label="Weekend Gap Handler" 
                    desc="Ignore Friday-to-Sunday gaps to prevent model hallucination."
                    icon={Activity}
                    active={ignoreWeekend} 
                    onClick={() => setIgnoreWeekend(!ignoreWeekend)} 
                />
                <ToggleButton 
                    label="Tick Volume Profiler" 
                    desc="Extract liquidity signatures from broker-specific tick volume changes."
                    icon={TrendingUp}
                    active={tickVolume} 
                    onClick={() => setTickVolume(!tickVolume)} 
                />
                <ToggleButton 
                    label="COT Sentiment (Smart Money)" 
                    desc="Use weekly Commitment of Traders futures data for spot positioning."
                    icon={Globe}
                    active={cotData} 
                    onClick={() => setCotData(!cotData)} 
                />
                <ToggleButton 
                    label="Currency Correlation Matrix" 
                    desc="Train with cross-currency pairs (e.g. EUR/CHF vs USD/CHF)."
                    icon={Activity}
                    active={currencyCorrelation} 
                    onClick={() => setCurrencyCorrelation(!currencyCorrelation)} 
                />
                <ToggleButton 
                    label="Yield Differentials" 
                    desc="Use Central Bank interest rate spreads to predict long-term bias."
                    icon={TrendingUp}
                    active={yieldDifferentials} 
                    onClick={() => setYieldDifferentials(!yieldDifferentials)} 
                />
            </div>
        </div>
    );
};
