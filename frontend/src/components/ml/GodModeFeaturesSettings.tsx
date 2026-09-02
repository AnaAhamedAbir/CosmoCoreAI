import React from 'react';
import { motion } from 'framer-motion';
import { Crosshair, Shield, Activity, TrendingUp, TrendingDown, Target, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';

export const GOD_MODE_FEATURES = [
    {
        id: 'magnet_intensity_above',
        name: 'Upper Magnet Intensity',
        desc: 'Measures the concentration of short liquidations above current price.',
        icon: TrendingUp,
        impact: 'high',
        status: 'live',
    },
    {
        id: 'magnet_distance_above',
        name: 'Upper Magnet Distance',
        desc: 'Percentage distance to the heaviest upper liquidation zone.',
        icon: Target,
        impact: 'medium',
        status: 'live',
    },
    {
        id: 'magnet_intensity_below',
        name: 'Lower Magnet Intensity',
        desc: 'Measures the concentration of long liquidations below current price.',
        icon: TrendingDown,
        impact: 'high',
        status: 'live',
    },
    {
        id: 'magnet_distance_below',
        name: 'Lower Magnet Distance',
        desc: 'Percentage distance to the heaviest lower liquidation zone.',
        icon: Target,
        impact: 'medium',
        status: 'live',
    },
    {
        id: 'cascade_prob_above',
        name: 'Upper Cascade Probability',
        desc: 'Probability of triggering a short squeeze cascade.',
        icon: Zap,
        impact: 'high',
        status: 'live',
    },
    {
        id: 'cascade_prob_below',
        name: 'Lower Cascade Probability',
        desc: 'Probability of triggering a long squeeze cascade.',
        icon: Zap,
        impact: 'high',
        status: 'live',
    },
    {
        id: 'cvd_spoof_state',
        name: 'CVD Spoof State',
        desc: 'Identifies fake order walls intended to trap retail traders.',
        icon: AlertTriangle,
        impact: 'high',
        status: 'live',
    },
];

interface GodModeFeaturesSettingsProps {
    isTraining: boolean;
    selectedFeatures: string[];
    setSelectedFeatures: React.Dispatch<React.SetStateAction<string[]>>;
}

export const GodModeFeaturesSettings: React.FC<GodModeFeaturesSettingsProps> = ({
    isTraining,
    selectedFeatures,
    setSelectedFeatures
}) => {

    const handleToggle = (id: string) => {
        if (isTraining) return;
        setSelectedFeatures(prev => 
            prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
        );
    };

    const handleSelectAll = () => {
        if (isTraining) return;
        if (selectedFeatures.length === GOD_MODE_FEATURES.length) {
            setSelectedFeatures([]);
        } else {
            setSelectedFeatures(GOD_MODE_FEATURES.map(f => f.id));
        }
    };

    return (
        <div className="bg-black/40 border border-brand-primary/20 rounded-xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl mb-4">
            <div className="p-3 border-b border-brand-primary/20 bg-brand-primary/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Crosshair className="w-4 h-4 text-brand-primary animate-pulse" />
                    <h3 className="text-[12px] font-black text-brand-primary uppercase tracking-widest">
                        God Mode Features
                    </h3>
                </div>
                <button
                    onClick={handleSelectAll}
                    disabled={isTraining}
                    className="text-[10px] font-bold bg-brand-primary/10 text-brand-primary px-3 py-1 rounded-lg border border-brand-primary/20 hover:bg-brand-primary/20 transition-all"
                >
                    {selectedFeatures.length === GOD_MODE_FEATURES.length ? 'Deselect All' : 'Select All'}
                </button>
            </div>
            
            <div className="p-4 bg-gradient-to-br from-black/60 to-brand-primary/5">
                <div className="grid grid-cols-2 gap-3">
                    {GOD_MODE_FEATURES.map((feat) => {
                        const isSelected = selectedFeatures.includes(feat.id);
                        return (
                            <motion.div
                                key={feat.id}
                                whileHover={{ scale: isTraining ? 1 : 1.02 }}
                                whileTap={{ scale: isTraining ? 1 : 0.98 }}
                                onClick={() => handleToggle(feat.id)}
                                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                                    isSelected 
                                    ? 'bg-brand-primary/20 border-brand-primary/50 shadow-[0_0_15px_rgba(168,85,247,0.2)]' 
                                    : 'bg-black/40 border-white/5 hover:bg-white/5'
                                }`}
                            >
                                <div className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center ${
                                    isSelected ? 'bg-brand-primary/30 text-brand-primary' : 'bg-white/5 text-slate-500'
                                }`}>
                                    <feat.icon className="w-3.5 h-3.5" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-1">
                                        <div className={`text-[11px] font-bold truncate ${isSelected ? 'text-brand-primary' : 'text-slate-300'}`}>
                                            {feat.name}
                                        </div>
                                        <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-colors flex-shrink-0 ${
                                            isSelected ? 'bg-brand-primary border-brand-primary' : 'border-white/20'
                                        }`}>
                                            {isSelected && <CheckCircle2 className="w-2.5 h-2.5 text-black" />}
                                        </div>
                                    </div>
                                    <p className="text-[9px] text-slate-500 leading-snug line-clamp-2">
                                        {feat.desc}
                                    </p>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
                
                <div className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex gap-3 items-start">
                    <Shield className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-[10px] font-bold text-emerald-400 mb-0.5">Real-Time Hybrid Integration</p>
                        <p className="text-[9px] text-emerald-400/70 leading-relaxed">
                            These features are dynamically calculated during the L2 WebSocket scraping phase. No historical simulation is required, ensuring 100% data integrity with live market conditions.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
