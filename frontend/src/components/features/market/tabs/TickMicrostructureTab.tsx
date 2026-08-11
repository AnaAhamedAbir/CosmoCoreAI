import React from 'react';
import { Terminal } from 'lucide-react';

interface TickMicrostructureTabProps {
    tickMicrostructure: boolean;
    setTickMicrostructure: (v: boolean) => void;
    tickVolume: boolean;
    setTickVolume: (v: boolean) => void;
    ignoreWeekend: boolean;
    setIgnoreWeekend: (v: boolean) => void;
    disabled?: boolean;
}

export const TickMicrostructureTab: React.FC<TickMicrostructureTabProps> = ({ 
    tickMicrostructure, setTickMicrostructure, 
    tickVolume, setTickVolume,
    ignoreWeekend, setIgnoreWeekend,
    disabled 
}) => {
    return (
        <div className="space-y-4">
            <h4 className="text-xs font-bold text-teal-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Terminal className="w-4 h-4" /> Microstructure & High Frequency
            </h4>
            
            <button
                disabled={disabled}
                onClick={() => setTickMicrostructure(!tickMicrostructure)}
                className={`w-full flex items-start p-3 rounded-xl border text-left transition-all duration-300 relative overflow-hidden ${tickMicrostructure ? 'border-teal-400 bg-teal-500/20 shadow-[0_0_15px_rgba(20,184,166,0.15)]' : 'border-white/10 bg-white/5 hover:bg-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <div className={`mt-1 w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${tickMicrostructure ? 'border-teal-400 bg-teal-500' : 'border-white/30'}`}>
                    {tickMicrostructure && <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                </div>
                <div className="ml-3 flex-1">
                    <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold tracking-wide ${tickMicrostructure ? 'text-teal-300' : 'text-slate-200'}`}>Enable Tick Proxies</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                        Calculate VPIN, Synthetic CVD, and Micro-Volatility using sub-second tick data.
                    </p>
                </div>
            </button>
            
            {tickMicrostructure && (
                <div className="pl-8 space-y-2 mt-2">
                    <div className="flex items-center gap-2 text-[11px] text-slate-400"><div className="w-1.5 h-1.5 rounded-full bg-teal-400/50"></div> VPIN Proxy (Probability of Informed Trading)</div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400"><div className="w-1.5 h-1.5 rounded-full bg-teal-400/50"></div> Synthetic CVD (Cumulative Volume Delta)</div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400"><div className="w-1.5 h-1.5 rounded-full bg-teal-400/50"></div> Tick Acceleration & Velocity</div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400"><div className="w-1.5 h-1.5 rounded-full bg-teal-400/50"></div> Micro-Volatility Standard Deviation</div>
                </div>
            )}
            
            <button
                disabled={disabled}
                onClick={() => setTickVolume(!tickVolume)}
                className={`w-full flex items-start p-3 rounded-xl border text-left transition-all duration-300 relative overflow-hidden ${tickVolume ? 'border-teal-400 bg-teal-500/20 shadow-[0_0_15px_rgba(20,184,166,0.15)]' : 'border-white/10 bg-white/5 hover:bg-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <div className={`mt-1 w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${tickVolume ? 'border-teal-400 bg-teal-500' : 'border-white/30'}`}>
                    {tickVolume && <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                </div>
                <div className="ml-3 flex-1">
                    <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold tracking-wide ${tickVolume ? 'text-teal-300' : 'text-slate-200'}`}>Tick Volume Profiler</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                        Extract liquidity signatures from broker-specific tick volume changes.
                    </p>
                </div>
            </button>

            <button
                disabled={disabled}
                onClick={() => setIgnoreWeekend(!ignoreWeekend)}
                className={`w-full flex items-start p-3 rounded-xl border text-left transition-all duration-300 relative overflow-hidden ${ignoreWeekend ? 'border-teal-400 bg-teal-500/20 shadow-[0_0_15px_rgba(20,184,166,0.15)]' : 'border-white/10 bg-white/5 hover:bg-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <div className={`mt-1 w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${ignoreWeekend ? 'border-teal-400 bg-teal-500' : 'border-white/30'}`}>
                    {ignoreWeekend && <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                </div>
                <div className="ml-3 flex-1">
                    <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold tracking-wide ${ignoreWeekend ? 'text-teal-300' : 'text-slate-200'}`}>Weekend Gap Handler</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                        Ignore Friday-to-Sunday gaps to prevent model hallucination.
                    </p>
                </div>
            </button>
            
        </div>
    );
};
