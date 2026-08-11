import React from 'react';
import { Activity } from 'lucide-react';

interface SMCFeatureTabProps {
    smcFeatures: boolean;
    setSmcFeatures: (v: boolean) => void;
    disabled?: boolean;
}

export const SMCFeatureTab: React.FC<SMCFeatureTabProps> = ({ smcFeatures, setSmcFeatures, disabled }) => {
    return (
        <div className="space-y-4">
            <h4 className="text-xs font-bold text-teal-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Activity className="w-4 h-4" /> Smart Money Concepts & Order Flow
            </h4>
            
            <button
                disabled={disabled}
                onClick={() => setSmcFeatures(!smcFeatures)}
                className={`w-full flex items-start p-3 rounded-xl border text-left transition-all duration-300 relative overflow-hidden ${smcFeatures ? 'border-teal-400 bg-teal-500/20 shadow-[0_0_15px_rgba(20,184,166,0.15)]' : 'border-white/10 bg-white/5 hover:bg-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <div className={`mt-1 w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${smcFeatures ? 'border-teal-400 bg-teal-500' : 'border-white/30'}`}>
                    {smcFeatures && <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                </div>
                <div className="ml-3 flex-1">
                    <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold tracking-wide ${smcFeatures ? 'text-teal-300' : 'text-slate-200'}`}>Enable SMC Master Module</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                        Activates FVG Liquidity Draws, Order Block Mitigation, BMS/CHoCH detection, and Retail Trap Order Book Imbalance features.
                    </p>
                </div>
            </button>
            
            {smcFeatures && (
                <div className="pl-8 space-y-2 mt-2">
                    <div className="flex items-center gap-2 text-[11px] text-slate-400"><div className="w-1.5 h-1.5 rounded-full bg-teal-400/50"></div> FVG Liquidity Draw Probability</div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400"><div className="w-1.5 h-1.5 rounded-full bg-teal-400/50"></div> Order Block Mitigation Speed</div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400"><div className="w-1.5 h-1.5 rounded-full bg-teal-400/50"></div> BMS & CHoCH Volatility Multiplier</div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400"><div className="w-1.5 h-1.5 rounded-full bg-teal-400/50"></div> Retail Sentiment & OBI Proxy</div>
                </div>
            )}
        </div>
    );
};
