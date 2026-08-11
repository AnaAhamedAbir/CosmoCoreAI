import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BrainCircuit, Layers, GitMerge, CheckSquare, Square, Check, Settings2, Sliders, Dna } from 'lucide-react';

interface EnsembleBuilderProps {
    isEnsemble: boolean;
    setIsEnsemble: (val: boolean) => void;
    ensembleMethod: 'voting' | 'stacking' | 'rl_moe';
    setEnsembleMethod: (val: 'voting' | 'stacking' | 'rl_moe') => void;
    baseModels: string[];
    setBaseModels: React.Dispatch<React.SetStateAction<string[]>>;
    metaModel: string;
    setMetaModel: (val: string) => void;
    votingStrategy?: 'hard' | 'soft';
    setVotingStrategy?: (val: 'hard' | 'soft') => void;
    autoOptimizeWeights?: boolean;
    setAutoOptimizeWeights?: (val: boolean) => void;
    featureSubspacing?: boolean;
    setFeatureSubspacing?: (val: boolean) => void;
    disabled: boolean;
    rlAlgorithm?: 'PPO' | 'SAC' | 'A2C' | 'DDPG' | 'TD3';
    setRlAlgorithm?: (val: 'PPO' | 'SAC' | 'A2C' | 'DDPG' | 'TD3') => void;
    moeRewardTarget?: 'PnL' | 'Sharpe' | 'Sortino';
    setMoeRewardTarget?: (val: 'PnL' | 'Sharpe' | 'Sortino') => void;
    moeMode?: 'preset' | 'custom';
    setMoeMode?: (val: 'preset' | 'custom') => void;
}

const AVAILABLE_BASE_MODELS = [
    // Econometric & Macro
    { id: 'ARIMA', type: 'Statistical', desc: 'লিনিয়ার ট্রেন্ড এক্সপার্ট' },
    { id: 'VAR', type: 'Statistical', desc: 'মাল্টি-ভ্যারিয়েবল এক্সপার্ট' },
    { id: 'GARCH', type: 'Volatility', desc: 'ভোলাটিলিটি এক্সপার্ট' },
    { id: 'EGARCH', type: 'Volatility', desc: 'অ্যাসিমেট্রিক শক্ এক্সপার্ট' },
    { id: 'NeuralProphet', type: 'Statistical', desc: 'সিজনালিটি এক্সপার্ট' },
    { id: 'HMM', type: 'Regime', desc: 'মার্কেট রেজিম এক্সপার্ট' },
    { id: 'Markov-Switching', type: 'Regime', desc: 'স্ট্রাকচারাল ব্রেক এক্সপার্ট' },
    { id: 'Bayesian NN', type: 'Probabilistic', desc: 'আনসার্টেইনটি এক্সপার্ট' },
    // Indicator & Tabular
    { id: 'Random Forest', type: 'Tree', desc: 'বেসিক রুলস এক্সপার্ট' },
    { id: 'XGBoost', type: 'Boosting', desc: 'হাই-স্পিড অপটিমাইজার' },
    { id: 'LightGBM', type: 'Boosting', desc: 'ফাস্ট ডিস্ট্রিবিউটেড এক্সপার্ট' },
    { id: 'CatBoost', type: 'Boosting', desc: 'ক্যাটাগরিকাল ডেটা এক্সপার্ট' },
    { id: 'TabNet', type: 'Deep Learning', desc: 'ডিপ লার্নিং ট্যাবুলার এক্সপার্ট' },
    // Trend & Sequence Memory
    { id: 'LSTM', type: 'Deep Learning', desc: 'লং-টার্ম মেমরি এক্সপার্ট' },
    { id: 'GRU', type: 'Deep Learning', desc: 'ফাস্ট মেমরি এক্সপার্ট' },
    { id: 'TCN', type: 'Deep Learning', desc: 'টেম্পোরাল সিকোয়েন্স এক্সপার্ট' },
    // Micro-Pattern & Scalping
    { id: '1D-CNN', type: 'Deep Learning', desc: 'লোকাল প্যাটার্ন এক্সপার্ট' },
    { id: 'DeepLOB', type: 'Deep Learning', desc: 'অর্ডারবুক ফ্লো এক্সপার্ট' },
    { id: 'Transformer', type: 'Deep Learning', desc: 'অ্যাটেনশন বেসড এক্সপার্ট' },
    // RL Active
    { id: 'PPO-RL', type: 'RL', desc: 'স্টেবল ট্রেডিং এজেন্ট' },
    { id: 'SAC-RL', type: 'RL', desc: 'অ্যাডাপ্টিভ ট্রেডিং এজেন্ট' },
    { id: 'A2C-RL', type: 'RL', desc: 'ফাস্ট বেসলাইন এজেন্ট' },
    { id: 'DDPG-RL', type: 'RL', desc: 'ডিটারমিনিস্টিক এজেন্ট' },
    { id: 'TD3-RL', type: 'RL', desc: 'টুইন ডিলেড এজেন্ট' },
    { id: 'DQN-RL', type: 'RL', desc: 'ডিসক্রিট অ্যাকশন এজেন্ট' },
    // RL Risk & Offline
    { id: 'QR-DQN', type: 'RL', desc: 'রিস্ক-অ্যাওয়ার এজেন্ট' },
    { id: 'CQL', type: 'RL', desc: 'অফলাইন হিস্টোরি এক্সপার্ট' },
    { id: 'GAIL', type: 'RL', desc: 'ইমিটেশন লার্নিং এক্সপার্ট' },
    // Next Gen
    { id: 'Decision-Transformer', type: 'Deep Learning', desc: 'টার্গেট-বেসড এক্সপার্ট' },
    { id: 'Liquid-NN', type: 'Continuous RNN', desc: 'ডায়নামিক অ্যাডাপ্টিভ এক্সপার্ট' },
    // Anomaly & Fallback
    { id: 'Auto-Encoder', type: 'Unsupervised', desc: 'অ্যানোমালি/ক্র্যাশ ডিটেক্টর' },
    { id: 'Logistic Regression', type: 'Linear', desc: 'সিম্পল লিনিয়ার এক্সপার্ট' },
    { id: 'SVM', type: 'Kernel', desc: 'মার্জিন সেপারেশন এক্সপার্ট' }
];

const AVAILABLE_META_MODELS = [
    { id: 'Logistic Regression', desc: 'Simple linear combination' },
    { id: 'Random Forest', desc: 'Tree-based meta learner' },
    { id: 'XGBoost', desc: 'Gradient boosting meta learner' },
    { id: 'Neural Network (MLP)', desc: 'Multi-layer perceptron meta learner' },
];

const EnsembleBuilder: React.FC<EnsembleBuilderProps> = ({
    isEnsemble,
    setIsEnsemble,
    ensembleMethod,
    setEnsembleMethod,
    baseModels,
    setBaseModels,
    metaModel,
    setMetaModel,
    votingStrategy = 'soft',
    setVotingStrategy = () => {},
    autoOptimizeWeights = false,
    setAutoOptimizeWeights = () => {},
    featureSubspacing = false,
    setFeatureSubspacing = () => {},
    disabled,
    rlAlgorithm = 'PPO',
    setRlAlgorithm = () => {},
    moeRewardTarget = 'Sharpe',
    setMoeRewardTarget = () => {},
    moeMode = 'preset',
    setMoeMode = () => {}
}) => {

    const isMoeCustomWarning = ensembleMethod === 'rl_moe' && moeMode === 'custom' && baseModels.length > 0 && new Set(baseModels.map(id => AVAILABLE_BASE_MODELS.find(m => m.id === id)?.type)).size === 1;

    const setPreset = (presetModels: string[]) => {
        if (disabled) return;
        setBaseModels(presetModels);
    };

    const toggleBaseModel = (modelId: string) => {
        if (disabled) return;
        setBaseModels(prev => 
            prev.includes(modelId) ? prev.filter(m => m !== modelId) : [...prev, modelId]
        );
    };

    return (
        <div className="space-y-4">
            {/* Ensemble Mode Toggle */}
            <div className="flex items-center justify-between p-4 bg-purple-500/10 border border-purple-500/30 rounded-2xl shadow-[0_0_15px_rgba(168,85,247,0.1)]">
                <div>
                    <h4 className="text-sm font-black text-purple-400 flex items-center gap-2">
                        <Layers className="w-4 h-4" /> Advanced Ensemble Mode
                    </h4>
                    <p className="text-[10px] text-slate-400 mt-1">Combine multiple weak learners into a powerful super-model.</p>
                </div>
                <button
                    onClick={() => setIsEnsemble(!isEnsemble)}
                    disabled={disabled}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isEnsemble ? 'bg-purple-500 shadow-[0_0_10px_#a855f7]' : 'bg-slate-600'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isEnsemble ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
            </div>

            <AnimatePresence>
                {isEnsemble && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-6 overflow-hidden"
                    >
                        {/* 1. Select Ensemble Method */}
                        <div className="space-y-3">
                            <h5 className="text-[10px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-purple-500/20 text-purple-400 text-[9px]">1</span>
                                Assembly Method
                            </h5>
                            <div className="grid grid-cols-3 gap-3">
                                <div 
                                    onClick={() => !disabled && setEnsembleMethod('voting')}
                                    className={`p-3 rounded-xl border cursor-pointer transition-all ${ensembleMethod === 'voting' ? 'bg-purple-500/20 border-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.2)]' : 'bg-white/5 border-white/10 hover:bg-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <CheckSquare className={`w-4 h-4 ${ensembleMethod === 'voting' ? 'text-purple-400' : 'text-slate-500'}`} />
                                        <span className={`text-xs font-bold ${ensembleMethod === 'voting' ? 'text-white' : 'text-slate-300'}`}>Voting (Soft/Hard)</span>
                                    </div>
                                    <p className="text-[9px] text-slate-400">Averages the predictions of all base models.</p>
                                </div>
                                <div 
                                    onClick={() => !disabled && setEnsembleMethod('stacking')}
                                    className={`p-3 rounded-xl border cursor-pointer transition-all ${ensembleMethod === 'stacking' ? 'bg-purple-500/20 border-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.2)]' : 'bg-white/5 border-white/10 hover:bg-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <GitMerge className={`w-4 h-4 ${ensembleMethod === 'stacking' ? 'text-purple-400' : 'text-slate-500'}`} />
                                        <span className={`text-xs font-bold ${ensembleMethod === 'stacking' ? 'text-white' : 'text-slate-300'}`}>Stacking</span>
                                    </div>
                                    <p className="text-[9px] text-slate-400">Trains a Meta-Model on the outputs of base models.</p>
                                </div>
                                <div 
                                    onClick={() => !disabled && setEnsembleMethod('rl_moe')}
                                    className={`p-3 rounded-xl border cursor-pointer transition-all ${ensembleMethod === 'rl_moe' ? 'bg-emerald-500/20 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]' : 'bg-white/5 border-white/10 hover:bg-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <BrainCircuit className={`w-4 h-4 ${ensembleMethod === 'rl_moe' ? 'text-emerald-400' : 'text-slate-500'}`} />
                                        <span className={`text-xs font-bold ${ensembleMethod === 'rl_moe' ? 'text-white' : 'text-slate-300'}`}>RL-Based MoE</span>
                                    </div>
                                    <p className="text-[9px] text-slate-400">Dynamic weighting with PPO/SAC Agent.</p>
                                </div>
                            </div>
                        </div>

                        {/* 1.5 Voting Options (Only if Voting) */}
                        <AnimatePresence>
                            {ensembleMethod === 'voting' && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="space-y-3 pt-2 border-t border-white/10"
                                >
                                    <h5 className="text-[10px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                                        <Sliders className="w-3.5 h-3.5 text-purple-400" /> Voting Configuration
                                    </h5>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div 
                                            onClick={() => !disabled && setVotingStrategy('soft')}
                                            className={`p-2 rounded-lg border cursor-pointer transition-all ${votingStrategy === 'soft' ? 'bg-indigo-500/20 border-indigo-500/50' : 'bg-white/5 border-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        >
                                            <div className="text-[10px] font-bold text-white mb-0.5">Soft Voting</div>
                                            <div className="text-[8px] text-slate-400">Averages probabilities</div>
                                        </div>
                                        <div 
                                            onClick={() => !disabled && setVotingStrategy('hard')}
                                            className={`p-2 rounded-lg border cursor-pointer transition-all ${votingStrategy === 'hard' ? 'bg-indigo-500/20 border-indigo-500/50' : 'bg-white/5 border-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        >
                                            <div className="text-[10px] font-bold text-white mb-0.5">Hard Voting</div>
                                            <div className="text-[8px] text-slate-400">Majority rule class vote</div>
                                        </div>
                                    </div>
                                    
                                    {votingStrategy === 'soft' && (
                                        <div className="flex items-center justify-between p-2.5 bg-white/5 rounded-lg border border-white/5 mt-2">
                                            <div className="flex items-center gap-2">
                                                <Settings2 className="w-3.5 h-3.5 text-indigo-400" />
                                                <span className="text-xs text-slate-300">Auto-Optimize Weights</span>
                                            </div>
                                            <button
                                                onClick={() => setAutoOptimizeWeights(!autoOptimizeWeights)}
                                                disabled={disabled}
                                                className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${autoOptimizeWeights ? 'bg-indigo-500' : 'bg-slate-600'} ${disabled ? 'opacity-50' : ''}`}
                                            >
                                                <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${autoOptimizeWeights ? 'translate-x-4' : 'translate-x-1'}`} />
                                            </button>
                                        </div>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* 1.6 RL MoE Configuration (Only if rl_moe) */}
                        <AnimatePresence>
                            {ensembleMethod === 'rl_moe' && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="space-y-3 pt-2 border-t border-white/10"
                                >
                                    <h5 className="text-[10px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                                        <Settings2 className="w-3.5 h-3.5 text-emerald-400" /> RL Master Configuration
                                    </h5>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-slate-400">Algorithm</label>
                                            <select 
                                                value={rlAlgorithm}
                                                onChange={(e) => !disabled && setRlAlgorithm(e.target.value as 'PPO' | 'SAC' | 'A2C' | 'DDPG' | 'TD3')}
                                                disabled={disabled}
                                                className="w-full bg-[#0A0A0A] border border-emerald-500/30 rounded-lg p-2 text-xs text-emerald-100"
                                            >
                                                <option value="PPO">PPO (Proximal Policy Opt.)</option>
                                                <option value="SAC">SAC (Soft Actor-Critic)</option>
                                                <option value="A2C">A2C (Advantage Actor-Critic)</option>
                                                <option value="DDPG">DDPG (Deterministic Policy)</option>
                                                <option value="TD3">TD3 (Twin Delayed DDPG)</option>
                                            </select>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-slate-400">Reward Target</label>
                                            <select 
                                                value={moeRewardTarget}
                                                onChange={(e) => !disabled && setMoeRewardTarget(e.target.value as 'PnL' | 'Sharpe' | 'Sortino')}
                                                disabled={disabled}
                                                className="w-full bg-[#0A0A0A] border border-emerald-500/30 rounded-lg p-2 text-xs text-emerald-100"
                                            >
                                                <option value="Sharpe">Max Sharpe Ratio</option>
                                                <option value="PnL">Max Profit (PnL)</option>
                                                <option value="Sortino">Max Sortino Ratio</option>
                                            </select>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* 2. Select Base Models */}
                        <div className="space-y-3">
                            <div className="flex justify-between items-center mb-2">
                                <h5 className="text-[10px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                                    <span className="flex items-center justify-center w-4 h-4 rounded-full bg-purple-500/20 text-purple-400 text-[9px]">2</span>
                                    Select Base Models (Experts)
                                </h5>
                                <span className="text-[10px] text-purple-400 font-bold bg-purple-500/20 px-2 py-0.5 rounded-full">
                                    {baseModels.length} Selected
                                </span>
                            </div>

                            {ensembleMethod === 'rl_moe' && (
                                <div className="flex gap-2 p-1 bg-black/40 rounded-lg border border-white/5 mb-3">
                                    <button
                                        onClick={() => setMoeMode('preset')}
                                        disabled={disabled}
                                        className={`flex-1 text-xs py-1.5 rounded-md transition-all ${moeMode === 'preset' ? 'bg-emerald-500/20 text-emerald-300 font-bold' : 'text-slate-400 hover:text-slate-300'}`}
                                    >
                                        Genuine MoE Presets
                                    </button>
                                    <button
                                        onClick={() => setMoeMode('custom')}
                                        disabled={disabled}
                                        className={`flex-1 text-xs py-1.5 rounded-md transition-all ${moeMode === 'custom' ? 'bg-emerald-500/20 text-emerald-300 font-bold' : 'text-slate-400 hover:text-slate-300'}`}
                                    >
                                        Custom Selection
                                    </button>
                                </div>
                            )}

                            {ensembleMethod === 'rl_moe' && moeMode === 'preset' ? (
                                <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                    <div onClick={() => setPreset(['ARIMA', 'Random Forest', 'GARCH'])} className={`p-3 rounded-xl border cursor-pointer transition-all ${baseModels.length === 3 && baseModels.includes('ARIMA') && baseModels.includes('GARCH') ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}>
                                        <div className="text-xs font-bold text-cyan-300 mb-1">The Quant Macro Master</div>
                                        <div className="text-[9px] text-slate-400">ARIMA + Random Forest + GARCH</div>
                                    </div>
                                    <div onClick={() => setPreset(['1D-CNN', 'Transformer', 'LightGBM'])} className={`p-3 rounded-xl border cursor-pointer transition-all ${baseModels.length === 3 && baseModels.includes('1D-CNN') && baseModels.includes('LightGBM') ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}>
                                        <div className="text-xs font-bold text-cyan-300 mb-1">The HFT Scalper</div>
                                        <div className="text-[9px] text-slate-400">1D-CNN + Transformer + LightGBM</div>
                                    </div>
                                    <div onClick={() => setPreset(['PPO-RL', 'LSTM', 'QR-DQN'])} className={`p-3 rounded-xl border cursor-pointer transition-all ${baseModels.length === 3 && baseModels.includes('PPO-RL') && baseModels.includes('QR-DQN') ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}>
                                        <div className="text-xs font-bold text-cyan-300 mb-1">The RL Alpha Seeker</div>
                                        <div className="text-[9px] text-slate-400">PPO-RL + LSTM + QR-DQN</div>
                                    </div>
                                    <div onClick={() => setPreset(['HMM', 'GRU', 'CatBoost'])} className={`p-3 rounded-xl border cursor-pointer transition-all ${baseModels.length === 3 && baseModels.includes('HMM') && baseModels.includes('CatBoost') ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}>
                                        <div className="text-xs font-bold text-cyan-300 mb-1">The Regime & Trend Follower</div>
                                        <div className="text-[9px] text-slate-400">HMM + GRU + CatBoost</div>
                                    </div>
                                    <div onClick={() => setPreset(['Auto-Encoder', 'QR-DQN', 'XGBoost'])} className={`p-3 rounded-xl border cursor-pointer transition-all ${baseModels.length === 3 && baseModels.includes('Auto-Encoder') ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}>
                                        <div className="text-xs font-bold text-cyan-300 mb-1">The Anomaly & Risk Protector</div>
                                        <div className="text-[9px] text-slate-400">Auto-Encoder + QR-DQN + XGBoost</div>
                                    </div>
                                    <div onClick={() => setPreset(['Liquid-NN', 'Decision-Transformer', 'DeepLOB'])} className={`p-3 rounded-xl border cursor-pointer transition-all ${baseModels.length === 3 && baseModels.includes('Liquid-NN') ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}>
                                        <div className="text-xs font-bold text-cyan-300 mb-1">The Ultimate Deep Quant</div>
                                        <div className="text-[9px] text-slate-400">Liquid-NN + Decision-Transformer + DeepLOB</div>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-2 gap-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                        {AVAILABLE_BASE_MODELS.map(model => (
                                            <div 
                                                key={model.id}
                                                onClick={() => toggleBaseModel(model.id)}
                                                className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${baseModels.includes(model.id) ? 'bg-cyan-500/10 border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.1)]' : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/20'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            >
                                                <div className={`mt-0.5 min-w-[16px] h-4 rounded flex items-center justify-center border transition-colors ${baseModels.includes(model.id) ? 'bg-cyan-500 border-cyan-400' : 'border-slate-500'}`}>
                                                    {baseModels.includes(model.id) && <Check className="w-3 h-3 text-black" />}
                                                </div>
                                                <div className="flex flex-col">
                                                    <div className={`text-[11px] font-bold tracking-wide ${baseModels.includes(model.id) ? 'text-cyan-300' : 'text-slate-200'}`}>{model.id}</div>
                                                    <div className="text-[8.5px] font-medium text-emerald-400/80 mb-0.5">{model.desc}</div>
                                                    <div className="text-[8px] text-slate-500/80 uppercase tracking-wider">{model.type}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <AnimatePresence>
                                        {isMoeCustomWarning && (
                                            <motion.div
                                                initial={{ opacity: 0, y: -5 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -5 }}
                                                className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl"
                                            >
                                                <div className="text-xs font-bold text-yellow-500 mb-0.5">⚠️ Warning: Low Model Diversity</div>
                                                <div className="text-[10px] text-yellow-400/80 leading-relaxed">
                                                    For optimal Mixture of Experts performance, it is highly recommended to select models from diverse categories (e.g., combine a Tree-based model with a Deep Learning model).
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </>
                            )}
                            
                            {/* Feature Subspacing Toggle */}
                            <div className="flex items-center justify-between p-3 mt-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                                <div className="flex items-center gap-2">
                                    <Dna className="w-4 h-4 text-emerald-400" />
                                    <div>
                                        <div className="text-xs font-bold text-emerald-300">Feature Subspacing</div>
                                        <div className="text-[8px] text-emerald-500/70 uppercase">Reduces model correlation</div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setFeatureSubspacing(!featureSubspacing)}
                                    disabled={disabled}
                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${featureSubspacing ? 'bg-emerald-500' : 'bg-slate-600'} ${disabled ? 'opacity-50' : ''}`}
                                >
                                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${featureSubspacing ? 'translate-x-5' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>

                        {/* 3. Select Meta Model (Only if Stacking) */}
                        <AnimatePresence>
                            {ensembleMethod === 'stacking' && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="space-y-3 pt-2 border-t border-white/10"
                                >
                                    <h5 className="text-[10px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                                        <span className="flex items-center justify-center w-4 h-4 rounded-full bg-purple-500/20 text-purple-400 text-[9px]">3</span>
                                        Select Meta-Model
                                    </h5>
                                    <div className="space-y-2">
                                        {AVAILABLE_META_MODELS.map(model => (
                                            <div 
                                                key={model.id}
                                                onClick={() => !disabled && setMetaModel(model.id)}
                                                className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-all ${metaModel === model.id ? 'bg-amber-500/10 border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.1)]' : 'bg-white/5 border-white/5 hover:bg-white/10'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            >
                                                <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 ${metaModel === model.id ? 'border-amber-400' : 'border-slate-500'}`}>
                                                    {metaModel === model.id && <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_5px_#f59e0b]"></div>}
                                                </div>
                                                <div>
                                                    <div className={`text-xs font-bold ${metaModel === model.id ? 'text-amber-300' : 'text-slate-300'}`}>{model.id}</div>
                                                    <div className="text-[9px] text-slate-500">{model.desc}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default EnsembleBuilder;
