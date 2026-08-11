import React, { useState } from 'react';
import { Activity, Clock, Globe, Terminal } from 'lucide-react';
import { SMCFeatureTab } from './tabs/SMCFeatureTab';
import { ICTKillzoneTab } from './tabs/ICTKillzoneTab';
import { AlternativeDataTab } from './tabs/AlternativeDataTab';
import { TickMicrostructureTab } from './tabs/TickMicrostructureTab';

export interface ForexDataEngineTabsProps {
    // Advanced features states
    smcFeatures: boolean;
    setSmcFeatures: (v: boolean) => void;
    ictKillzones: boolean;
    setIctKillzones: (v: boolean) => void;
    stopHuntModels: boolean;
    setStopHuntModels: (v: boolean) => void;
    tickMicrostructure: boolean;
    setTickMicrostructure: (v: boolean) => void;
    centralBankNlp: boolean;
    setCentralBankNlp: (v: boolean) => void;
    
    // Original features
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

export const ForexDataEngineTabs: React.FC<ForexDataEngineTabsProps> = (props) => {
    const [activeTab, setActiveTab] = useState<'smc' | 'ict' | 'alt' | 'tick'>('smc');

    const tabs = [
        { id: 'smc', label: 'SMC', icon: Activity },
        { id: 'ict', label: 'ICT & Time', icon: Clock },
        { id: 'alt', label: 'Alt Data', icon: Globe },
        { id: 'tick', label: 'Tick Data', icon: Terminal }
    ];

    return (
        <div className="flex flex-col h-full bg-white/5 border border-teal-500/30 rounded-2xl shadow-[0_0_12px_rgba(20,184,166,0.1)] overflow-hidden">
            <div className="p-4 bg-black/40 border-b border-white/10 flex-shrink-0 relative z-20">
                <h3 className="text-sm font-bold text-teal-400 flex items-center gap-2 uppercase tracking-widest mb-4">
                    <Activity className="w-4 h-4" /> TradFi Data Pipeline
                </h3>
                
                {/* Tab Navigation */}
                <div className="flex bg-black/50 p-1 rounded-xl">
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`flex-1 flex items-center justify-center gap-2 py-2 px-1 text-xs font-semibold rounded-lg transition-all duration-300 ${isActive ? 'bg-teal-500/20 text-teal-300 shadow-[0_0_10px_rgba(20,184,166,0.2)]' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}
                            >
                                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-teal-400' : ''}`} />
                                <span className="hidden sm:inline">{tab.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scrollbar h-full relative">
                {activeTab === 'smc' && (
                    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                        <SMCFeatureTab 
                            smcFeatures={props.smcFeatures} 
                            setSmcFeatures={props.setSmcFeatures} 
                            disabled={props.disabled} 
                        />
                    </div>
                )}
                {activeTab === 'ict' && (
                    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                        <ICTKillzoneTab 
                            ictKillzones={props.ictKillzones} 
                            setIctKillzones={props.setIctKillzones} 
                            sessionFeatures={props.sessionFeatures}
                            setSessionFeatures={props.setSessionFeatures}
                            disabled={props.disabled} 
                        />
                    </div>
                )}
                {activeTab === 'alt' && (
                    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                        <AlternativeDataTab 
                            centralBankNlp={props.centralBankNlp} 
                            setCentralBankNlp={props.setCentralBankNlp} 
                            stopHuntModels={props.stopHuntModels}
                            setStopHuntModels={props.setStopHuntModels}
                            macroCalendar={props.macroCalendar}
                            setMacroCalendar={props.setMacroCalendar}
                            cotData={props.cotData}
                            setCotData={props.setCotData}
                            currencyCorrelation={props.currencyCorrelation}
                            setCurrencyCorrelation={props.setCurrencyCorrelation}
                            yieldDifferentials={props.yieldDifferentials}
                            setYieldDifferentials={props.setYieldDifferentials}
                            disabled={props.disabled} 
                        />
                    </div>
                )}
                {activeTab === 'tick' && (
                    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                        <TickMicrostructureTab 
                            tickMicrostructure={props.tickMicrostructure} 
                            setTickMicrostructure={props.setTickMicrostructure}
                            tickVolume={props.tickVolume}
                            setTickVolume={props.setTickVolume}
                            ignoreWeekend={props.ignoreWeekend}
                            setIgnoreWeekend={props.setIgnoreWeekend}
                            disabled={props.disabled} 
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
