import React from 'react';
import { Clock } from 'lucide-react';

interface ICTKillzoneTabProps {
    ictKillzones: boolean;
    setIctKillzones: (v: boolean) => void;
    sessionFeatures: boolean;
    setSessionFeatures: (v: boolean) => void;
    disabled?: boolean;
}

export const ICTKillzoneTab: React.FC<ICTKillzoneTabProps> = ({ ictKillzones, setIctKillzones, sessionFeatures, setSessionFeatures, disabled }) => {
    return (
        <div className="space-y-4">
            <h4 className="text-xs font-bold text-teal-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Clock className="w-4 h-4" /> ICT Time & Macro Dynamics
            </h4>
            
            <button
                disabled={disabled}
                onClick={() => setIctKillzones(!ictKillzones)}
                className={`w-full flex items-start p-3 rounded-xl border text-left transition-all duration-300 relative overflow-hidden ${ictKillzones ? 'border-teal-400 bg-teal-500/20 shadow-[0_0_15px_rgba(20,184,166,0.15)]' : 'border-white/10 bg-white/5 hover:bg-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <div className={`mt-1 w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${ictKillzones ? 'border-teal-400 bg-teal-500' : 'border-white/30'}`}>
                    {ictKillzones && <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                </div>
                <div className="ml-3 flex-1">
                    <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold tracking-wide ${ictKillzones ? 'text-teal-300' : 'text-slate-200'}`}>Enable Killzone Dynamics</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                        Injects London/NY killzone momentum, Judas Swings, and PDH/PDL sweeps into the ML pipeline.
                    </p>
                </div>
            </button>
            
            {ictKillzones && (
                <div className="pl-8 space-y-2 mt-2">
                    <div className="flex items-center gap-2 text-[11px] text-slate-400"><div className="w-1.5 h-1.5 rounded-full bg-teal-400/50"></div> London & NY Killzone Momentum</div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400"><div className="w-1.5 h-1.5 rounded-full bg-teal-400/50"></div> Judas Swing & Turtle Soup Fakeouts</div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400"><div className="w-1.5 h-1.5 rounded-full bg-teal-400/50"></div> PDH/PDL Sweep Proxy</div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400"><div className="w-1.5 h-1.5 rounded-full bg-teal-400/50"></div> True Day Open Deviation</div>
                </div>
            )}
            
            <button
                disabled={disabled}
                onClick={() => setSessionFeatures(!sessionFeatures)}
                className={`w-full flex items-start p-3 rounded-xl border text-left transition-all duration-300 relative overflow-hidden ${sessionFeatures ? 'border-teal-400 bg-teal-500/20 shadow-[0_0_15px_rgba(20,184,166,0.15)]' : 'border-white/10 bg-white/5 hover:bg-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <div className={`mt-1 w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${sessionFeatures ? 'border-teal-400 bg-teal-500' : 'border-white/30'}`}>
                    {sessionFeatures && <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                </div>
                <div className="ml-3 flex-1">
                    <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold tracking-wide ${sessionFeatures ? 'text-teal-300' : 'text-slate-200'}`}>Market Session Pipeline</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                        Encode Asian, London, and NY overlapping session volatilities.
                    </p>
                </div>
            </button>
        </div>
    );
};
