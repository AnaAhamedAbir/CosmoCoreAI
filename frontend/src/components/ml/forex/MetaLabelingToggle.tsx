import React from 'react';
import { Layers } from 'lucide-react';

interface MetaLabelingToggleProps {
    enableMetaLabeling: boolean;
    setEnableMetaLabeling: (v: boolean) => void;
    isTraining: boolean;
}

export const MetaLabelingToggle: React.FC<MetaLabelingToggleProps> = ({
    enableMetaLabeling,
    setEnableMetaLabeling,
    isTraining
}) => {
    return (
        <div className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl transition-all hover:bg-white/10">
            <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${enableMetaLabeling ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-slate-400'}`}>
                    <Layers className="w-4 h-4" />
                </div>
                <div>
                    <h4 className="text-[11px] font-bold text-slate-300 uppercase">Meta-Labeling</h4>
                    <p className="text-[9px] text-slate-500">Secondary Trade Confidence Model</p>
                </div>
            </div>
            <button
                disabled={isTraining}
                onClick={() => setEnableMetaLabeling(!enableMetaLabeling)}
                className={`relative w-8 h-4 rounded-full transition-colors ${enableMetaLabeling ? 'bg-amber-500' : 'bg-slate-600'}`}
            >
                <span className={`absolute top-[2px] left-[2px] bg-white w-3 h-3 rounded-full transition-transform ${enableMetaLabeling ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
        </div>
    );
};
