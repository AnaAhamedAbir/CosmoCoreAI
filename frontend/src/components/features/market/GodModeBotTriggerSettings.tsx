import React from 'react';

interface GodModeBotTriggerSettingsProps {
    enableGodModeEntryTrigger: boolean;
    godModeLongThreshold: number;
    godModeShortThreshold: number;
    onChange: (key: string, value: any) => void;
}

export const GodModeBotTriggerSettings: React.FC<GodModeBotTriggerSettingsProps> = ({
    enableGodModeEntryTrigger,
    godModeLongThreshold,
    godModeShortThreshold,
    onChange
}) => {
    return (
        <div className={`mt-3 p-3 rounded-lg border transition-all ${enableGodModeEntryTrigger ? 'bg-indigo-500/10 border-indigo-500/50' : 'bg-black/20 border-white/5'}`}>
            <div className="flex items-center justify-between cursor-pointer" onClick={() => onChange('enableGodModeEntryTrigger', !enableGodModeEntryTrigger)}>
                <div className="flex items-center gap-2">
                    <div className={`w-10 h-5 rounded-full p-1 transition-colors flex items-center ${enableGodModeEntryTrigger ? 'bg-indigo-500' : 'bg-gray-700'}`}>
                        <div className={`w-3 h-3 bg-white rounded-full shadow-md transform transition-transform ${enableGodModeEntryTrigger ? 'translate-x-5' : 'translate-x-0'}`}></div>
                    </div>
                    <span className="text-[11px] font-black text-white uppercase tracking-wider flex items-center gap-1">
                        🤖 God Mode ML Trigger
                        <div className="group relative">
                            <span className="text-gray-500 hover:text-indigo-400 ml-1 text-xs">ⓘ</span>
                            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-48 p-2 bg-black/90 border border-white/10 rounded-md text-[9px] text-gray-300 font-normal hidden group-hover:block z-50 text-center">
                                Uses Deep Hybrid ML model to scan L2 Orderbook for Magnet Zones and Liquidation Cascades.
                            </div>
                        </div>
                    </span>
                </div>
                {enableGodModeEntryTrigger && (
                    <span className="text-[9px] font-bold text-indigo-400 bg-indigo-500/20 px-2 py-0.5 rounded-full">AI DRIVEN</span>
                )}
            </div>
            
            {enableGodModeEntryTrigger && (
                <div className="mt-3 space-y-3 animate-fadeIn">
                    <div>
                        <div className="flex justify-between items-end mb-1">
                            <label className="text-[9px] font-bold text-gray-400 uppercase">Long Threshold (+Score)</label>
                            <span className="text-[10px] font-mono text-indigo-400 font-bold">+{godModeLongThreshold}</span>
                        </div>
                        <input 
                            type="range" 
                            min="50" max="100" step="5"
                            value={godModeLongThreshold}
                            onChange={(e) => onChange('godModeLongThreshold', parseInt(e.target.value))}
                            className="w-full accent-indigo-500 bg-black/30 rounded-full h-1"
                        />
                        <div className="flex justify-between text-[8px] text-gray-500 mt-1">
                            <span>50 (Aggressive)</span>
                            <span>100 (Safe)</span>
                        </div>
                    </div>
                    
                    <div>
                        <div className="flex justify-between items-end mb-1">
                            <label className="text-[9px] font-bold text-gray-400 uppercase">Short Threshold (-Score)</label>
                            <span className="text-[10px] font-mono text-red-400 font-bold">{godModeShortThreshold}</span>
                        </div>
                        <input 
                            type="range" 
                            min="-100" max="-50" step="5"
                            value={godModeShortThreshold}
                            onChange={(e) => onChange('godModeShortThreshold', parseInt(e.target.value))}
                            className="w-full accent-red-500 bg-black/30 rounded-full h-1"
                        />
                        <div className="flex justify-between text-[8px] text-gray-500 mt-1">
                            <span>-100 (Safe)</span>
                            <span>-50 (Aggressive)</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
