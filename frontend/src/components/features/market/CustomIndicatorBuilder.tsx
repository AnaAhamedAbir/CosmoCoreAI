import React, { useState } from 'react';
import { Settings, Plus, Trash2, Code2, Save, TerminalSquare, AlertCircle } from 'lucide-react';
import { ASMCStrategySettings } from './ASMCStrategySettings';

export interface CustomIndicator {
    id: string;
    name: string;
    description: string;
    code: string;
    dataSource: string;
    isActive: boolean;
    isPreset?: boolean;
}

interface CustomIndicatorBuilderProps {
    dataSource: string;
    customIndicators: CustomIndicator[];
    setCustomIndicators: React.Dispatch<React.SetStateAction<CustomIndicator[]>>;
    asmcHtf?: string;
    setAsmcHtf?: (value: string) => void;
    asmcLtf?: string;
    setAsmcLtf?: (value: string) => void;
    disabled?: boolean;
}

export const CustomIndicatorBuilder: React.FC<CustomIndicatorBuilderProps> = ({
    dataSource,
    customIndicators,
    setCustomIndicators,
    asmcHtf,
    setAsmcHtf,
    asmcLtf,
    setAsmcLtf,
    disabled
}) => {
    const [isAdding, setIsAdding] = useState(false);
    const [newIndicator, setNewIndicator] = useState<Partial<CustomIndicator>>({
        name: '',
        description: '',
        code: ''
    });

    const sourceIndicators = customIndicators.filter(ind => ind.dataSource === dataSource);

    const handleSave = () => {
        if (!newIndicator.name || !newIndicator.code) {
            alert('Name and Code are required!');
            return;
        }

        const indicator: CustomIndicator = {
            id: `custom_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            name: newIndicator.name,
            description: newIndicator.description || '',
            code: newIndicator.code,
            dataSource,
            isActive: true
        };

        setCustomIndicators(prev => [...prev, indicator]);
        setNewIndicator({ name: '', description: '', code: '' });
        setIsAdding(false);
    };

    const handleDelete = (id: string) => {
        setCustomIndicators(prev => prev.filter(ind => ind.id !== id));
    };

    const handleToggleActive = (id: string) => {
        setCustomIndicators(prev => prev.map(ind => 
            ind.id === id ? { ...ind, isActive: !ind.isActive } : ind
        ));
    };

    return (
        <div className="mt-4 mb-4 p-4 border border-teal-500/30 rounded-xl bg-teal-500/5 shadow-[inset_0_0_20px_rgba(20,184,166,0.05)]">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h4 className="text-sm font-bold text-teal-400 flex items-center gap-2">
                        <Settings className="w-4 h-4" /> Custom Indicator Builder
                    </h4>
                    <p className="text-[10px] text-slate-400 mt-1">
                        Build your own metric indicators for <strong>{dataSource.replace(/_/g, ' ').toUpperCase()}</strong>
                    </p>
                </div>
                <button
                    onClick={() => setIsAdding(!isAdding)}
                    disabled={disabled}
                    className="flex items-center gap-2 px-3 py-1.5 bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 text-[11px] font-bold rounded-lg border border-teal-500/30 transition-colors"
                >
                    {isAdding ? 'Cancel' : <><Plus className="w-3.5 h-3.5" /> Add New</>}
                </button>
            </div>

            {isAdding && (
                <div className="mb-5 p-4 bg-black/40 border border-white/10 rounded-xl space-y-3">
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase">Indicator Name</label>
                        <input 
                            type="text" 
                            value={newIndicator.name}
                            onChange={e => setNewIndicator({ ...newIndicator, name: e.target.value })}
                            placeholder="e.g., Dynamic RSI Volatility"
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-teal-400"
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase">Description (Optional)</label>
                        <input 
                            type="text" 
                            value={newIndicator.description}
                            onChange={e => setNewIndicator({ ...newIndicator, description: e.target.value })}
                            placeholder="What does this indicator measure?"
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-teal-400"
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase flex items-center gap-2">
                            <Code2 className="w-3.5 h-3.5" /> Python Logic / Pandas Formula
                        </label>
                        <textarea 
                            value={newIndicator.code}
                            onChange={e => setNewIndicator({ ...newIndicator, code: e.target.value })}
                            placeholder="df['custom_indicator'] = df['close'].rolling(14).mean() / df['volume']"
                            rows={4}
                            className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-teal-200 outline-none focus:border-teal-400 custom-scrollbar"
                        />
                        <div className="flex items-center gap-1.5 mt-2 text-[9px] text-slate-500">
                            <AlertCircle className="w-3 h-3 text-amber-500" />
                            <span>Use <code>df</code> to reference the dataset dataframe for this source.</span>
                        </div>
                    </div>
                    <div className="flex justify-end pt-2">
                        <button
                            onClick={handleSave}
                            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-xs font-bold rounded-lg shadow-[0_0_15px_rgba(20,184,166,0.4)] transition-all"
                        >
                            <Save className="w-4 h-4" /> Save Indicator
                        </button>
                    </div>
                </div>
            )}

            <div className="space-y-2">
                {sourceIndicators.length === 0 && !isAdding && (
                    <div className="text-center p-4 border border-dashed border-white/10 rounded-xl">
                        <TerminalSquare className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                        <p className="text-[11px] text-slate-500">No custom indicators built for this source yet.</p>
                    </div>
                )}
                {sourceIndicators.map(ind => (
                <React.Fragment key={ind.id}>
                    <div className="p-3 bg-white/5 border border-white/10 rounded-xl flex items-start justify-between group hover:border-teal-500/30 transition-colors">
                        <div>
                            <h5 className="text-sm font-bold text-teal-300">{ind.name}</h5>
                            {ind.description && <p className="text-[10px] text-slate-400 mt-0.5">{ind.description}</p>}
                            <div className="mt-2 bg-black/60 p-2 rounded-lg border border-white/5">
                                <code className="text-[10px] font-mono text-teal-500 break-all">{ind.code}</code>
                            </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                            <label className="relative inline-flex items-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                                <input 
                                    type="checkbox" 
                                    className="sr-only peer" 
                                    checked={ind.isActive}
                                    onChange={() => handleToggleActive(ind.id)}
                                    disabled={disabled}
                                />
                                <div className="w-8 h-4 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 peer-checked:after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all border-white/5 peer-checked:bg-gradient-to-r peer-checked:from-teal-500 peer-checked:to-emerald-500"></div>
                            </label>

                            {!ind.isPreset && (
                                <button
                                    onClick={() => handleDelete(ind.id)}
                                    disabled={disabled}
                                    className="p-1 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                    title="Delete custom indicator"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>
                    {(ind.id === 'smc_dynamic_mtf' || ind.id === 'forex_smc_dynamic_mtf') && ind.isActive && asmcHtf && setAsmcHtf && asmcLtf && setAsmcLtf && (
                        <ASMCStrategySettings 
                            htf={asmcHtf}
                            setHtf={setAsmcHtf}
                            ltf={asmcLtf}
                            setLtf={setAsmcLtf}
                            disabled={disabled}
                        />
                    )}
                </React.Fragment>
                ))}
            </div>
        </div>
    );
};
