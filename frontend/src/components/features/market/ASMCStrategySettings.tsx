import React from 'react';
import { Clock, Layers, ShieldCheck } from 'lucide-react';

interface ASMCStrategySettingsProps {
    htf: string;
    setHtf: (value: string) => void;
    ltf: string;
    setLtf: (value: string) => void;
    disabled?: boolean;
}

export const ASMCStrategySettings: React.FC<ASMCStrategySettingsProps> = ({
    htf, setHtf, ltf, setLtf, disabled
}) => {
    return (
        <div className="mt-3 p-4 bg-gradient-to-br from-indigo-900/20 to-purple-900/20 border border-indigo-500/30 rounded-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none group-hover:bg-indigo-500/10 transition-colors"></div>
            
            <div className="flex items-center gap-2 mb-3">
                <ShieldCheck className="w-4 h-4 text-indigo-400" />
                <h4 className="text-sm font-bold text-indigo-300">ASMC Dynamic MTF Engine</h4>
            </div>
            
            <p className="text-[10px] text-slate-400 mb-4">
                Select your structural Higher Timeframe (HTF) for Liquidity Sweeps and your Execution Lower Timeframe (LTF) for CISD triggers.
            </p>

            <div className="grid grid-cols-2 gap-4">
                {/* HTF Select */}
                <div>
                    <label className="block text-[10px] font-bold text-indigo-400/80 mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
                        <Layers className="w-3 h-3" /> HTF (Narrative)
                    </label>
                    <select
                        value={htf}
                        onChange={(e) => setHtf(e.target.value)}
                        disabled={disabled}
                        className="w-full bg-black/40 border border-indigo-500/20 rounded-lg px-3 py-2 text-sm text-indigo-100 outline-none focus:border-indigo-400 transition-colors disabled:opacity-50"
                    >
                        <option value="1h">1 Hour</option>
                        <option value="4h">4 Hour</option>
                        <option value="1d">1 Day</option>
                        <option value="1w">1 Week</option>
                    </select>
                </div>

                {/* LTF Select */}
                <div>
                    <label className="block text-[10px] font-bold text-purple-400/80 mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
                        <Clock className="w-3 h-3" /> LTF (Execution)
                    </label>
                    <select
                        value={ltf}
                        onChange={(e) => setLtf(e.target.value)}
                        disabled={disabled}
                        className="w-full bg-black/40 border border-purple-500/20 rounded-lg px-3 py-2 text-sm text-purple-100 outline-none focus:border-purple-400 transition-colors disabled:opacity-50"
                    >
                        <option value="1m">1 Minute</option>
                        <option value="5m">5 Minute</option>
                        <option value="15m">15 Minute</option>
                        <option value="1h">1 Hour</option>
                    </select>
                </div>
            </div>
        </div>
    );
};
