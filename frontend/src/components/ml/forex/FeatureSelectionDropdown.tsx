import React from 'react';

interface FeatureSelectionDropdownProps {
    featureSelectionMethod: string;
    setFeatureSelectionMethod: (v: string) => void;
    isTraining: boolean;
}

export const FeatureSelectionDropdown: React.FC<FeatureSelectionDropdownProps> = ({
    featureSelectionMethod,
    setFeatureSelectionMethod,
    isTraining
}) => {
    return (
        <div>
            <label className="block text-[11px] font-bold text-slate-400 mb-1.5 uppercase">Feature Selection</label>
            <div className="grid grid-cols-3 gap-2">
                {[
                    { id: 'none', label: 'None' },
                    { id: 'shap', label: 'SHAP Values' },
                    { id: 'boruta', label: 'Boruta' }
                ].map(opt => (
                    <button
                        key={opt.id}
                        disabled={isTraining}
                        onClick={() => setFeatureSelectionMethod(opt.id)}
                        className={`py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                            featureSelectionMethod === opt.id 
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50 shadow-[0_0_10px_rgba(244,63,94,0.2)]' 
                            : 'bg-white/5 text-slate-400 border border-white/5 hover:bg-white/10'
                        }`}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>
            <p className="text-[9px] text-slate-500 mt-1 ml-1">Auto-remove noisy features to prevent curse of dimensionality.</p>
        </div>
    );
};
