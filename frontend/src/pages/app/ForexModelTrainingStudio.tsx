import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import EnsembleBuilder from '@/components/ml/EnsembleBuilder';
import { BrainCircuit, Play, Settings, Activity, Layers, Target, Cpu, CheckCircle2, XCircle, Loader2, Globe, Terminal, Database } from 'lucide-react';
import { forexMlTrainingService, ForexTrainingJob } from '@/services/forexMlTrainingService';
import { mlModelsService } from '@/services/mlModelsService';
import { ForexAdvancedPipeline } from '@/components/features/market/ForexAdvancedPipeline';
import AdvancedHyperparameters from '@/components/ml/AdvancedHyperparameters';
import { ForexCoreParametersPanel } from '@/components/ml/forex/ForexCoreParametersPanel';
import { AutoMlToggle } from '@/components/ml/forex/AutoMlToggle';
import FeatureImportanceChart from '@/components/ml/FeatureImportanceChart';
import EquityCurveChart from '@/components/ml/EquityCurveChart';
import { CustomIndicator } from '@/components/features/market/CustomIndicatorBuilder';
import FractionalDiffConfig from '@/components/ml/FractionalDiffConfig';

interface ForexModelTrainingStudioProps {
    retrainModelId?: string | null;
}

const ForexModelTrainingStudio: React.FC<ForexModelTrainingStudioProps> = ({ retrainModelId }) => {
    // Core Parameters
    const [symbol, setSymbol] = useState('EUR_USD');
    const [broker, setBroker] = useState('oanda');
    const [timeframe, setTimeframe] = useState('1h');
    const [targetRows, setTargetRows] = useState(100000);
    const [dateRangeMode, setDateRangeMode] = useState<'ticks' | 'date'>('ticks');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [modelName, setModelName] = useState('');
    const [predictionTarget, setPredictionTarget] = useState('classification');
    const [forecastHorizon, setForecastHorizon] = useState(2);
    const [lookbackWindow, setLookbackWindow] = useState(60);
    const [evalMetric, setEvalMetric] = useState('f1');
    const [outlierRemoval, setOutlierRemoval] = useState('none');
    const [scalingMethod, setScalingMethod] = useState('standard');
    const [fractionalDiff, setFractionalDiff] = useState(false);
    const [fractionalDValue, setFractionalDValue] = useState(0.5);
    const [augmentationStrategy, setAugmentationStrategy] = useState('none');
    const [augmentationFactor, setAugmentationFactor] = useState(1);
    const [augmentationSamples, setAugmentationSamples] = useState(100000);
    const [useClusteredImportance, setUseClusteredImportance] = useState(false);
    const [enableAdversarial, setEnableAdversarial] = useState(false);
    const [adversarialEpsilon, setAdversarialEpsilon] = useState(0.01);
    const [applyPcaCollinearity, setApplyPcaCollinearity] = useState(true);
    const [applyShapSelection, setApplyShapSelection] = useState(true);
    const [shapVarianceThreshold, setShapVarianceThreshold] = useState(0.95);
    const [missingDataThreshold, setMissingDataThreshold] = useState(0.20);
    const [autoFeatureSelection, setAutoFeatureSelection] = useState(true);
    const [autoFeatureCount, setAutoFeatureCount] = useState(50);
    const [splitMethod, setSplitMethod] = useState('chronological');
    const [trainRatio, setTrainRatio] = useState(70);
    const [valRatio, setValRatio] = useState(15);
    const [testRatio, setTestRatio] = useState(15);
    const [imbalanceStrategy, setImbalanceStrategy] = useState('none');
    const [feeThreshold, setFeeThreshold] = useState(0.0001); // 0.01% for Forex
    const [purgeLength, setPurgeLength] = useState(0);
    
    // Advanced Quant States
    const [useTripleBarrier, setUseTripleBarrier] = useState(false);
    const [ptSlRatio, setPtSlRatio] = useState(1.5);
    const [barrierTimeout, setBarrierTimeout] = useState(24);
    const [useAutoMl, setUseAutoMl] = useState(false);
    const [autoMlTrials, setAutoMlTrials] = useState(50);
    const [enableMetaLabeling, setEnableMetaLabeling] = useState(false);
    const [featureSelectionMethod, setFeatureSelectionMethod] = useState('none');
    const [wfoWindows, setWfoWindows] = useState(5);

    // Forex Specific Engine Features
    // Advanced UI Features (PLP Style)
    const [selectedForexFeatures, setSelectedForexFeatures] = useState<string[]>(['session_features', 'macro_calendar']);
    
    // Neural Architecture
    const [algorithm, setAlgorithm] = useState('Random Forest');
    const [epochs, setEpochs] = useState(50);
    const [learningRate, setLearningRate] = useState(0.001);
    const [maxDepth, setMaxDepth] = useState(6);
    
    // Check if selected algorithm is God-Tier
    const isGodTier = ["Mamba SSM", "KAN Network", "JEPA World Model", "Time-LLM", "TTFT", "GNN-RL", "SNN Liquid", "Sparse MoE Router"].includes(algorithm);
    
    // Ensemble & MoE States
    const [isEnsemble, setIsEnsemble] = useState(false);
    const [ensembleMethod, setEnsembleMethod] = useState<'voting' | 'stacking' | 'rl_moe'>('voting');
    const [baseModels, setBaseModels] = useState<string[]>(['Random Forest', 'XGBoost']);
    const [metaModel, setMetaModel] = useState<string>('Logistic Regression');
    const [votingStrategy, setVotingStrategy] = useState<'hard' | 'soft'>('soft');
    const [autoOptimizeWeights, setAutoOptimizeWeights] = useState(false);
    const [featureSubspacing, setFeatureSubspacing] = useState(false);
    const [rlAlgorithm, setRlAlgorithm] = useState<'PPO' | 'SAC' | 'A2C' | 'DDPG' | 'TD3'>('PPO');
    const [moeRewardTarget, setMoeRewardTarget] = useState<'PnL' | 'Sharpe' | 'Sortino'>('Sharpe');
    const [moeMode, setMoeMode] = useState<'preset' | 'custom'>('preset');
    
    // Trading Fee & Risk States
    const [initialBalance, setInitialBalance] = useState(10000);
    const [tradingFees, setTradingFees] = useState(0.0001); // Standard for Forex
    const [slippage, setSlippage] = useState(0.0001);
    const [maxAllowedDrawdown, setMaxAllowedDrawdown] = useState(0);
    
    const [instruments, setInstruments] = useState<{name: string, display_name: string}[]>([]);
    
    // Status
    const [isTraining, setIsTraining] = useState(false);
    const [trainingJobId, setTrainingJobId] = useState<string | null>(null);
    const [activeJob, setActiveJob] = useState<ForexTrainingJob | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // Fetch config for retrain
    useEffect(() => {
        if (retrainModelId) {
            mlModelsService.getModelConfig(retrainModelId).then((config) => {
                if (config) {
                    if (config.symbol) setSymbol(config.symbol);
                    if (config.prediction_target) setPredictionTarget(config.prediction_target);
                    if (config.forecast_horizon) setForecastHorizon(config.forecast_horizon);
                    if (config.lookback_window) setLookbackWindow(config.lookback_window);
                    if (config.eval_metric) setEvalMetric(config.eval_metric);
                    if (config.algorithm) setAlgorithm(config.algorithm);
                    
                    if (config.features && Array.isArray(config.features)) {
                        setSelectedForexFeatures(config.features);
                    }
                }
            }).catch(console.error);
        }
    }, [retrainModelId]);

    // L2 Orderbook State
    const [l2OrderbookFiles, setL2OrderbookFiles] = useState<string[]>([]);
    const [selectedL2File, setSelectedL2File] = useState('');
    const [isUploadingL2, setIsUploadingL2] = useState(false);

    // Historical Ticks State
    const [tickDataFiles, setTickDataFiles] = useState<string[]>([]);
    const [selectedTickFile, setSelectedTickFile] = useState('');
    const [isUploadingTick, setIsUploadingTick] = useState(false);
    const [tickBinningStrategy, setTickBinningStrategy] = useState('time_based_5s');

    // Hybrid Merged State
    const [hybridMergedFiles, setHybridMergedFiles] = useState<string[]>([]);
    const [selectedHybridFile, setSelectedHybridFile] = useState('');
    const [isMerging, setIsMerging] = useState(false);
    // Data Source State
    const [dataSource, setDataSource] = useState<string>('ohlcv');

    const [showTerminal, setShowTerminal] = useState(false);
    const logsEndRef = useRef<HTMLDivElement>(null);

    // Scraper States
    const [forexScrapeJob, setForexScrapeJob] = useState<ForexTrainingJob | null>(null);
    const [forexSnapshotFiles, setForexSnapshotFiles] = useState<string[]>([]);
    const [selectedForexFile, setSelectedForexFile] = useState('');

    // Custom Indicators State
    const [customIndicators, setCustomIndicators] = useState<CustomIndicator[]>([
        {
            id: 'forex_smc_feature_engine',
            name: 'Forex SMC Feature Engine',
            description: 'Advanced institutional order flow and market structure features extracted via Aether Analyzer (Forex Optimized).',
            code: 'from app.services.forex_aether_ml_features import add_forex_aether_smc_features\nadd_forex_aether_smc_features(df)',
            dataSource: 'ohlcv',
            isActive: true,
            isPreset: true
        },
        {
            id: 'forex_smc_dynamic_mtf',
            name: 'Forex SMC Dynamic MTF',
            description: 'Tick-Enhanced Institutional Smart Money logic mapping HTF Liquidity Sweeps to LTF execution.',
            code: "from app.services.asmc_strategy.forex_asmc_main import apply_forex_asmc_mtf_logic\ndf = apply_forex_asmc_mtf_logic(df, config.get('asmc_htf', '4h'), config.get('asmc_ltf', '15m'))",
            dataSource: 'hybrid_ohlcv_tick',
            isActive: true,
            isPreset: true
        }
    ]);

    // ASMC Settings State
    const [asmcHtf, setAsmcHtf] = useState('4h');
    const [asmcLtf, setAsmcLtf] = useState('15m');

    const ALGORITHM_CATEGORIES = [
        { 
            name: "Econometric & Statistical (Forex Core)", 
            desc: "Classic Quant models for Macro & Volatility", 
            algos: [
                { id: 'ARIMA', type: 'Statistical', desc: 'AutoRegressive Integrated Moving Average' },
                { id: 'VAR', type: 'Statistical', desc: 'Vector AutoRegression for multi-pair correlation' },
                { id: 'GARCH', type: 'Volatility', desc: 'Predicts volatility clustering' },
                { id: 'EGARCH', type: 'Volatility', desc: 'Exponential GARCH for asymmetric shocks' },
                { id: 'NeuralProphet', type: 'Time-Series', desc: 'Captures daily/weekly session seasonality' }
            ] 
        },
        { 
            name: "Market Regime & Macro", 
            desc: "Detects hidden states and handles uncertainty", 
            algos: [
                { id: 'HMM', type: 'Regime Detection', desc: 'Hidden Markov Model for market states' },
                { id: 'Markov-Switching', type: 'Regime Detection', desc: 'Dynamic weight shifting based on regime' },
                { id: 'Bayesian NN', type: 'Probabilistic', desc: 'Handles uncertainty of macro-economic events' }
            ] 
        },
        { 
            name: "Indicator & Tabular Engines", 
            desc: "Fastest. Best for Technical Indicators & L2 Snapshots", 
            algos: [
                { id: 'Random Forest', type: 'Supervised', desc: 'Ensemble of decision trees' },
                { id: 'XGBoost', type: 'Supervised', desc: 'Optimized gradient boosting' },
                { id: 'LightGBM', type: 'Supervised', desc: 'Fast, distributed gradient boosting' },
                { id: 'CatBoost', type: 'Supervised', desc: 'Great for categorical and tabular data' },
                { id: 'TabNet', type: 'Supervised', desc: 'Deep learning for tabular data with attention' }
            ] 
        },
        { 
            name: "Trend & Sequence Memory", 
            desc: "Best for tracking long-term trends & historical patterns", 
            algos: [
                { id: 'LSTM', type: 'Supervised', desc: 'Long Short-Term Memory networks' },
                { id: 'GRU', type: 'Supervised', desc: 'Gated Recurrent Units, faster than LSTM' },
                { id: 'TCN', type: 'Supervised', desc: 'Temporal Convolutional Network' }
            ] 
        },
        { 
            name: "Micro-Pattern & Scalping", 
            desc: "Best for raw Orderbook flow & spatial feature extraction", 
            algos: [
                { id: '1D-CNN', type: 'Supervised', desc: '1D Convolutional Neural Network' },
                { id: 'DeepLOB', type: 'Supervised', desc: 'Deep learning model for Limit Order Books' },
                { id: 'Transformer', type: 'Supervised', desc: 'Attention-based sequence modeling' }
            ] 
        },
        { 
            name: "RL: Active Trading Agents", 
            desc: "Standard self-learning environments (Live/Simulated Trading)", 
            algos: [
                { id: 'PPO-RL', type: 'Reinforcement Learning', desc: 'Proximal Policy Optimization' },
                { id: 'SAC-RL', type: 'Reinforcement Learning', desc: 'Soft Actor-Critic for continuous action' },
                { id: 'A2C-RL', type: 'Reinforcement Learning', desc: 'Advantage Actor-Critic (Fast Baseline)' },
                { id: 'DDPG-RL', type: 'Reinforcement Learning', desc: 'Deep Deterministic Policy Gradient' },
                { id: 'TD3-RL', type: 'Reinforcement Learning', desc: 'Twin Delayed DDPG (Stable Continuous)' }
            ] 
        },
        { 
            name: "RL: Offline & Imitation", 
            desc: "Learn from historical or expert trader demonstrations", 
            algos: [
                { id: 'CQL', type: 'Offline RL', desc: 'Conservative Q-Learning (Learn from history)' },
                { id: 'GAIL', type: 'Imitation Learning', desc: 'Generative Adversarial Imitation Learning' }
            ] 
        },
        { 
            name: "RL: Advanced & Model-Based", 
            desc: "Learns internal environment dynamics and meta-strategies", 
            algos: [
                { id: 'MuZero', type: 'Model-Based RL', desc: 'Predicts future market states internally' },
                { id: 'Meta-RL', type: 'Meta-Learning', desc: 'Rapidly adapts to new market regimes' }
            ] 
        },
        { 
            name: "GOD-TIER AI (Next-Gen)", 
            desc: "Experimental ultra-high-performance architectures", 
            algos: [
                { id: 'Sparse MoE Router', type: 'God-Brain Orchestrator', desc: 'Dynamically routes ticks to the best expert' },
                { id: 'Mamba SSM', type: 'Sequence Model', desc: 'Infinite context window for tick-level data', disabled: true, disabledReason: 'CUDA (NVIDIA GPU) Required' },
                { id: 'KAN Network', type: 'Fractal Math', desc: 'Kolmogorov-Arnold Network for exact math patterns' },
                { id: 'JEPA World Model', type: 'Predictive Latent', desc: 'Joint Embedding Predictive Architecture' },
                { id: 'Time-LLM', type: 'LLM Time-Series', desc: 'Reprogrammed LLM for forecasting' },
                { id: 'TTFT', type: 'Tabular Foundation', desc: 'Temporal Tabular Foundation Models' },
                { id: 'GNN-RL', type: 'Graph RL', desc: 'Graph Neural Networks with Reinforcement Learning' },
                { id: 'SNN Liquid', type: 'Spiking Neural Net', desc: 'Biologically inspired asynchronous event handler' }
            ] 
        },
        { 
            name: "RL: Multi-Agent & Hierarchical", 
            desc: "Complex agent interactions and task delegation", 
            algos: [
                { id: 'HRL', type: 'Hierarchical RL', desc: 'Manager-Worker architecture for risk & execution' },
                { id: 'MAPPO', type: 'Multi-Agent RL', desc: 'Cooperative multi-agent portfolio management' }
            ] 
        },
        { 
            name: "Next-Gen Architectures", 
            desc: "Cutting-edge dynamic neural models", 
            algos: [
                { id: 'Decision-Transformer', type: 'Offline RL', desc: 'Action generation based on target ROI' },
                { id: 'Liquid-NN', type: 'Continuous RNN', desc: 'Dynamically adapts weights during live trading' }
            ] 
        },
        { 
            name: "Anomaly Detection", 
            desc: "Unsupervised learning for crash/pump detection", 
            algos: [
                { id: 'Auto-Encoder', type: 'Unsupervised', desc: 'Finds anomalies via reconstruction loss' }
            ] 
        }
    ];

    React.useEffect(() => {
        const loadInstruments = async () => {
            try {
                const data = await forexMlTrainingService.getInstruments();
                setInstruments(data);
                if (data.length > 0) {
                    const hasEurUsd = data.some((i: any) => i.name === 'EUR_USD');
                    if (hasEurUsd) {
                        setSymbol('EUR_USD');
                    } else {
                        setSymbol(data[0].name);
                    }
                }
            } catch (err) {
                console.error("Failed to load instruments", err);
            }
        };
        loadInstruments();
    }, []);

    // Auto-scroll logs
    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [activeJob?.logs, forexScrapeJob?.logs]);

    // Load Forex Snapshots
    useEffect(() => {
        forexMlTrainingService.getForexSnapshots().then((files) => {
            setForexSnapshotFiles(files);
            if (files.length > 0 && !selectedForexFile) {
                setSelectedForexFile(files[0]);
            }
        }).catch(err => console.error("Failed to load forex snapshots", err));

        // Load Tick Snapshots
        forexMlTrainingService.getTickSnapshots().then((files) => {
            setTickDataFiles(files);
            if (files.length > 0 && !selectedTickFile) {
                setSelectedTickFile(files[0]);
            }
        }).catch(err => console.error("Failed to load tick snapshots", err));

        forexMlTrainingService.getL2OrderbookFiles().then((files) => {
            setL2OrderbookFiles(files);
            if (files.length > 0 && !selectedL2File) {
                setSelectedL2File(files[0]);
            }
        }).catch(err => console.error("Failed to load L2 snapshots", err));

        forexMlTrainingService.getHybridSnapshots().then((files) => {
            setHybridMergedFiles(files);
            if (files.length > 0 && !selectedHybridFile) {
                setSelectedHybridFile(files[0]);
            }
        }).catch(err => console.error("Failed to load hybrid snapshots", err));
    }, []);

    // Advanced Setup Fallback
    useEffect(() => {
        const ADVANCED_SETUP_SUPPORTED_ALGOS = [
            'LSTM', 'GRU', 'TCN', '1D-CNN', 'DeepLOB', 'Transformer', 
            'PPO-RL', 'SAC-RL', 'DDPG-RL', 'TD3-RL', 'Ensemble Model',
            'MuZero', 'Meta-RL', 'HRL', 'MAPPO',
            'Mamba SSM', 'KAN Network', 'JEPA World Model', 'Time-LLM', 'TTFT', 'GNN-RL', 'SNN Liquid', 'Sparse MoE Router'
        ];
        
        if (predictionTarget === 'advanced_setup' && !ADVANCED_SETUP_SUPPORTED_ALGOS.includes(algorithm)) {
            setPredictionTarget('classification');
        }
    }, [algorithm, predictionTarget]);

    // Polling logic for Training and Merging Jobs
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if ((isTraining || isMerging) && activeJob && ['PENDING', 'RUNNING'].includes(activeJob.status)) {
            interval = setInterval(async () => {
                try {
                    const latestJob = await forexMlTrainingService.getJobStatus(activeJob.id);
                    setActiveJob(latestJob);
                    if (['COMPLETED', 'FAILED'].includes(latestJob.status)) {
                        if (isTraining) setIsTraining(false);
                        if (isMerging) {
                            setIsMerging(false);
                            if (latestJob.status === 'COMPLETED') {
                                const files = await forexMlTrainingService.getHybridSnapshots();
                                setHybridMergedFiles(files);
                                if (files.length > 0) setSelectedHybridFile(files[0]);
                            }
                        }
                        clearInterval(interval);
                    }
                } catch (error) {
                    console.error("Error fetching job status:", error);
                }
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [isTraining, isMerging, activeJob?.id, activeJob?.status]);

    const handleStartMerge = async () => {
        if (!selectedForexFile || !selectedTickFile) {
            alert('Please select both OHLCV and Tick data files.');
            return;
        }
        setIsMerging(true);
        setShowTerminal(true);
        
        try {
            const job = await forexMlTrainingService.mergeHybridDataset({
                symbol,
                ohlcv_file: selectedForexFile,
                tick_file: selectedTickFile,
                strategy: tickBinningStrategy
            });
            setActiveJob(job);
        } catch (error) {
            console.error(error);
            setIsMerging(false);
            alert('Failed to start merge process.');
        }
    };

    // Polling logic for Scraper Job
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (forexScrapeJob && ['PENDING', 'RUNNING'].includes(forexScrapeJob.status)) {
            interval = setInterval(async () => {
                try {
                    const latestJob = await forexMlTrainingService.getJobStatus(forexScrapeJob.id);
                    setForexScrapeJob(latestJob);
                    if (['COMPLETED', 'FAILED'].includes(latestJob.status)) {
                        clearInterval(interval);
                        if (latestJob.status === 'COMPLETED') {
                            forexMlTrainingService.getForexSnapshots().then((files) => {
                                setForexSnapshotFiles(files);
                                if (files.length > 0) {
                                    setSelectedForexFile(files[0]);
                                }
                            });
                        }
                    }
                } catch (error) {
                    console.error("Error fetching scrape job status:", error);
                }
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [forexScrapeJob?.id, forexScrapeJob?.status]);

    const handleStartForexCollector = async (config: {target_rows: number, mode?: string, start_date?: string, end_date?: string, timeframe?: string, data_source?: string}) => {
        try {
            const job = await forexMlTrainingService.startForexCollector({
                symbol: symbol,
                ...config
            });
            setForexScrapeJob(job);
        } catch (error: any) {
            alert(`Failed to start collector: ${error.message}`);
        }
    };

    const handleCancelForexCollector = async () => {
        if (!forexScrapeJob) return;
        if (!window.confirm("Are you sure you want to stop data collection?")) return;
        try {
            await forexMlTrainingService.cancelTraining(forexScrapeJob.id);
            setForexScrapeJob(prev => prev ? { ...prev, status: 'FAILED', error_message: 'Collection cancelled by user.' } : null);
        } catch (error: any) {
            alert(`Failed to cancel collection: ${error.message}`);
        }
    };

    const handleDeleteSnapshot = async (e: React.MouseEvent) => {
        e.preventDefault();
        if (!selectedForexFile) return;
        if (!window.confirm(`Are you sure you want to delete ${selectedForexFile}?`)) return;
        try {
            await forexMlTrainingService.deleteForexSnapshot(selectedForexFile);
            setForexSnapshotFiles(prev => prev.filter(f => f !== selectedForexFile));
            setSelectedForexFile('');
            alert(`Deleted ${selectedForexFile}`);
        } catch (error: any) {
            alert(`Failed to delete snapshot: ${error.message}`);
        }
    };

    const handleDeleteDataset = async () => {
        if (!confirm(`Are you sure you want to delete the local dataset for ${symbol}?`)) return;
        setIsDeleting(true);
        try {
            const res = await forexMlTrainingService.deleteDataset(symbol);
            alert(res.message || "Dataset deleted successfully.");
        } catch (error: any) {
            console.error("Failed to delete dataset", error);
            alert(error?.response?.data?.detail || "Failed to delete dataset.");
        } finally {
            setIsDeleting(false);
        }
    };

    const handleUploadL2Csv = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        
        if (!file.name.endsWith('.csv')) {
            alert('Please upload a valid CSV file');
            return;
        }

        setIsUploadingL2(true);
        try {
            const res = await forexMlTrainingService.uploadL2Csv(file);
            const newFile = res.filename;
            setL2OrderbookFiles(prev => [...prev, newFile]);
            setSelectedL2File(newFile);
            alert('✅ L2 Orderbook CSV uploaded successfully!');
        } catch (error: any) {
            alert(`❌ Upload failed: ${error.message}`);
        } finally {
            setIsUploadingL2(false);
            e.target.value = ''; // Reset input
        }
    };

    const handleDeleteL2Snapshot = async (e: React.MouseEvent) => {
        e.preventDefault();
        if (!selectedL2File) return;
        if (!confirm(`Are you sure you want to delete ${selectedL2File}?`)) return;
        
        try {
            await forexMlTrainingService.deleteL2Snapshot(selectedL2File);
            setL2OrderbookFiles(prev => prev.filter(f => f !== selectedL2File));
            setSelectedL2File('');
            alert('✅ Snapshot deleted');
        } catch (error: any) {
            alert(`❌ Delete failed: ${error.message}`);
        }
    };

    const handleUploadTickCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        
        if (!file.name.endsWith('.csv')) {
            alert('Please upload a valid CSV file');
            return;
        }

        setIsUploadingTick(true);
        try {
            const res = await forexMlTrainingService.uploadTickstoryCsv(symbol, file);
            // Assuming res returns some info or filename. We might need to refresh list.
            const files = await forexMlTrainingService.getTickSnapshots();
            setTickDataFiles(files);
            if (files.length > 0) setSelectedTickFile(files[files.length - 1]);
            alert('✅ Tickstory CSV uploaded successfully!');
        } catch (error: any) {
            alert(`❌ Upload failed: ${error.message}`);
        } finally {
            setIsUploadingTick(false);
            e.target.value = ''; // Reset input
        }
    };

    const handleDeleteTickSnapshot = async (e: React.MouseEvent) => {
        e.preventDefault();
        if (!selectedTickFile) return;
        if (!confirm(`Are you sure you want to delete ${selectedTickFile}?`)) return;
        
        try {
            await forexMlTrainingService.deleteTickSnapshot(selectedTickFile);
            setTickDataFiles(prev => prev.filter(f => f !== selectedTickFile));
            setSelectedTickFile('');
            alert('✅ Snapshot deleted');
        } catch (error: any) {
            alert(`❌ Delete failed: ${error.message}`);
        }
    };

    const handleStartTraining = async () => {
        setIsTraining(true);
        try {
            const configPayload = {
                symbol,
                timeframe,
                algorithm,
                config: {
                    epochs,
                    learning_rate: learningRate,
                    tree_depth: maxDepth,
                    broker,
                    model_name: modelName,
                    prediction_target: predictionTarget,
                    forecast_horizon: forecastHorizon,
                    lookback_window: lookbackWindow,
                    eval_metric: evalMetric,
                    outlier_removal: outlierRemoval,
                    scaling_method: scalingMethod,
                    fractional_diff: fractionalDiff,
                    fractional_d_value: fractionalDValue,
                    augmentation_strategy: augmentationStrategy,
                    augmentation_factor: augmentationFactor,
                    augmentation_samples: augmentationSamples,
                    use_clustered_importance: useClusteredImportance,
                    enable_adversarial: enableAdversarial,
                    adversarial_epsilon: adversarialEpsilon,
                    apply_pca_collinearity: applyPcaCollinearity,
                    apply_shap_selection: applyShapSelection,
                    shap_variance_threshold: shapVarianceThreshold,
                    missing_data_threshold: missingDataThreshold,
                    auto_feature_selection: autoFeatureSelection,
                    auto_feature_count: autoFeatureCount,
                    split_method: splitMethod,
                    train_ratio: trainRatio,
                    val_ratio: valRatio,
                    test_ratio: testRatio,
                    imbalance_strategy: imbalanceStrategy,
                    fee_threshold: feeThreshold,
                    purge_length: purgeLength,
                    
                    market_session_features: selectedForexFeatures.includes('session_features'),
                    ignore_weekend_gaps: selectedForexFeatures.includes('weekend_gap'),
                    macroeconomic_calendar: selectedForexFeatures.includes('macro_calendar'),
                    tick_volume_profiler: selectedForexFeatures.includes('tick_volume_profiler'),
                    cot_data: selectedForexFeatures.includes('cot_sentiment'),
                    currency_correlation: selectedForexFeatures.includes('currency_correlation'),
                    yield_differentials: selectedForexFeatures.includes('yield_differentials'),
                    target_rows: targetRows,
                    date_range_mode: dateRangeMode,
                    start_date: startDate,
                    end_date: endDate,
                    use_triple_barrier: useTripleBarrier,
                    pt_sl_ratio: ptSlRatio,
                    barrier_timeout: barrierTimeout,
                    use_automl: useAutoMl,
                    automl_trials: autoMlTrials,
                    enable_meta_labeling: enableMetaLabeling,
                    feature_selection_method: featureSelectionMethod,
                    wfo_windows: wfoWindows,
                    selected_forex_features: selectedForexFeatures,
                    snapshot_file: dataSource === 'hybrid_ohlcv_tick' ? selectedHybridFile : selectedForexFile,
                    l2_orderbook_file: dataSource === 'l2_orderbook' || dataSource === 'hybrid_ohlcv_l2' ? selectedL2File : undefined,
                    tick_data_file: undefined, // Tick data is already merged into snapshot_file
                    tick_binning_strategy: dataSource === 'hybrid_ohlcv_tick' ? tickBinningStrategy : undefined,
                    data_source_type: dataSource,
                    is_ensemble: isEnsemble,
                    ensemble_method: ensembleMethod,
                    base_models: baseModels,
                    meta_model: metaModel,
                    voting_strategy: votingStrategy,
                    auto_optimize_weights: autoOptimizeWeights,
                    feature_subspacing: featureSubspacing,
                    rlAlgorithm: rlAlgorithm,
                    moeRewardTarget: moeRewardTarget,
                    moeMode: moeMode,
                    initial_balance: initialBalance,
                    commission: tradingFees,
                    slippage: slippage,
                    max_allowed_drawdown: maxAllowedDrawdown,
                    custom_indicators: customIndicators.filter(ind => ind.isActive),
                    asmc_htf: asmcHtf,
                    asmc_ltf: asmcLtf
                }
            };
            
            const job = await forexMlTrainingService.startTraining(configPayload);
            setActiveJob(job);
            setShowTerminal(true);
            alert("Training job started successfully!");
        } catch (error) {
            console.error("Failed to start training", error);
            alert("Failed to start Forex training job.");
        }
    };

    const handleCancelTraining = async () => {
        if (!activeJob) return;
        if (!window.confirm("Are you sure you want to stop this training job?")) return;
        try {
            await forexMlTrainingService.cancelTraining(activeJob.id);
            setIsTraining(false);
            setActiveJob(prev => prev ? { ...prev, status: 'FAILED', error_message: 'Training cancelled by user.' } : null);
        } catch (error) {
            console.error("Failed to cancel training", error);
            alert("Failed to cancel training job.");
        }
    };

    return (
        <>
            <div className="h-full flex flex-col space-y-3 relative overflow-hidden bg-black/20 rounded-3xl">
            {/* Background Orbs adapted for Forex (Teal/Blue vibe) */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-teal-600/20 blur-[120px] rounded-full pointer-events-none"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/20 blur-[120px] rounded-full pointer-events-none"></div>

            <header className="flex items-center gap-4 z-10 px-2 mt-2">
                <h2 className="text-xl font-black text-white flex items-center gap-2">
                    <Globe className="w-5 h-5 text-teal-400" />
                    Forex ML Intelligence Studio
                </h2>
                <div className="w-px h-4 bg-white/20"></div>
                <div className="text-slate-400 text-xs font-medium tracking-wide flex items-center gap-2">
                    Decentralized Market Modeling with Macro-Economic Pipelines
                </div>
            </header>

            <div className="flex-1 flex flex-col min-h-0 relative z-10">
                <div className="w-full flex flex-col bg-black/40 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.5)] relative overflow-hidden h-full">
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 flex-1 min-h-0">
                        
                        {/* COLUMN 1: Core Parameters (Modularized) */}
                        <ForexCoreParametersPanel
                            symbol={symbol}
                            setSymbol={setSymbol}
                            broker={broker}
                            setBroker={setBroker}
                            instruments={instruments}
                            isTraining={isTraining}
                            isDeleting={isDeleting}
                            handleDeleteDataset={handleDeleteDataset}
                            algorithm={algorithm}
                            timeframe={timeframe}
                            setTimeframe={setTimeframe}
                            targetRows={targetRows}
                            setTargetRows={setTargetRows}
                            dateRangeMode={dateRangeMode}
                            setDateRangeMode={setDateRangeMode}
                            startDate={startDate}
                            setStartDate={setStartDate}
                            endDate={endDate}
                            setEndDate={setEndDate}
                            modelName={modelName}
                            setModelName={setModelName}
                            predictionTarget={predictionTarget}
                            setPredictionTarget={setPredictionTarget}
                            learningRate={learningRate}
                            setLearningRate={setLearningRate}
                            maxDepth={maxDepth}
                            setMaxDepth={setMaxDepth}
                            forecastHorizon={forecastHorizon}
                            setForecastHorizon={setForecastHorizon}
                            lookbackWindow={lookbackWindow}
                            setLookbackWindow={setLookbackWindow}
                            evalMetric={evalMetric}
                            setEvalMetric={setEvalMetric}
                            outlierRemoval={outlierRemoval}
                            setOutlierRemoval={setOutlierRemoval}
                            scalingMethod={scalingMethod}
                            setScalingMethod={setScalingMethod}
                            fractionalDiff={fractionalDiff}
                            setFractionalDiff={setFractionalDiff}
                            fractionalDValue={fractionalDValue}
                            setFractionalDValue={setFractionalDValue}
                            imbalanceStrategy={imbalanceStrategy}
                            setImbalanceStrategy={setImbalanceStrategy}
                            feeThreshold={feeThreshold}
                            setFeeThreshold={setFeeThreshold}
                            augmentationStrategy={augmentationStrategy}
                            setAugmentationStrategy={setAugmentationStrategy}
                            augmentationFactor={augmentationFactor}
                            setAugmentationFactor={setAugmentationFactor}
                            augmentationSamples={augmentationSamples}
                            setAugmentationSamples={setAugmentationSamples}
                            useClusteredImportance={useClusteredImportance}
                            setUseClusteredImportance={setUseClusteredImportance}
                            enableAdversarial={enableAdversarial}
                            setEnableAdversarial={setEnableAdversarial}
                            adversarialEpsilon={adversarialEpsilon}
                            setAdversarialEpsilon={setAdversarialEpsilon}
                            splitMethod={splitMethod}
                            setSplitMethod={setSplitMethod}
                            trainRatio={trainRatio}
                            setTrainRatio={setTrainRatio}
                            valRatio={valRatio}
                            setValRatio={setValRatio}
                            testRatio={testRatio}
                            setTestRatio={setTestRatio}
                            purgeLength={purgeLength}
                            setPurgeLength={setPurgeLength}
                            useTripleBarrier={useTripleBarrier}
                            setUseTripleBarrier={setUseTripleBarrier}
                            ptSlRatio={ptSlRatio}
                            setPtSlRatio={setPtSlRatio}
                            barrierTimeout={barrierTimeout}
                            setBarrierTimeout={setBarrierTimeout}
                            enableMetaLabeling={enableMetaLabeling}
                            setEnableMetaLabeling={setEnableMetaLabeling}
                            featureSelectionMethod={featureSelectionMethod}
                            setFeatureSelectionMethod={setFeatureSelectionMethod}
                            wfoWindows={wfoWindows}
                            setWfoWindows={setWfoWindows}
                            applyPcaCollinearity={applyPcaCollinearity}
                            setApplyPcaCollinearity={setApplyPcaCollinearity}
                            applyShapSelection={applyShapSelection}
                            setApplyShapSelection={setApplyShapSelection}
                            shapVarianceThreshold={shapVarianceThreshold}
                            setShapVarianceThreshold={setShapVarianceThreshold}
                            missingDataThreshold={missingDataThreshold}
                            setMissingDataThreshold={setMissingDataThreshold}
                            autoFeatureSelection={autoFeatureSelection}
                            setAutoFeatureSelection={setAutoFeatureSelection}
                            autoFeatureCount={autoFeatureCount}
                            setAutoFeatureCount={setAutoFeatureCount}
                        />

                        {/* COLUMN 2: Neural Architecture */}
                        <div className="flex flex-col h-full bg-white/5 border border-teal-500/30 rounded-2xl shadow-[0_0_12px_rgba(20,184,166,0.1)] overflow-hidden">
                            <div className="p-5 bg-black/40 border-b border-white/10 flex-shrink-0 relative z-20">
                                <h3 className="text-sm font-bold text-blue-400 flex items-center gap-2 uppercase tracking-widest"><Cpu className="w-4 h-4" /> Neural Architecture</h3>
                            </div>
                            <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar h-full flex flex-col">
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-2">Algorithm Selection</label>
                                        <EnsembleBuilder
                                            isEnsemble={isEnsemble}
                                            setIsEnsemble={setIsEnsemble}
                                            ensembleMethod={ensembleMethod}
                                            setEnsembleMethod={setEnsembleMethod}
                                            baseModels={baseModels}
                                            setBaseModels={setBaseModels}
                                            metaModel={metaModel}
                                            setMetaModel={setMetaModel}
                                            votingStrategy={votingStrategy}
                                            setVotingStrategy={setVotingStrategy}
                                            autoOptimizeWeights={autoOptimizeWeights}
                                            setAutoOptimizeWeights={setAutoOptimizeWeights}
                                            featureSubspacing={featureSubspacing}
                                            setFeatureSubspacing={setFeatureSubspacing}
                                            disabled={isTraining}
                                            rlAlgorithm={rlAlgorithm}
                                            setRlAlgorithm={setRlAlgorithm}
                                            moeRewardTarget={moeRewardTarget}
                                            setMoeRewardTarget={setMoeRewardTarget}
                                            moeMode={moeMode}
                                            setMoeMode={setMoeMode}
                                        />
                                        <AnimatePresence>
                                            {!isEnsemble && (
                                                <motion.div 
                                                    initial={{ opacity: 0, height: 0 }}
                                                    animate={{ opacity: 1, height: 'auto' }}
                                                    exit={{ opacity: 0, height: 0 }}
                                                    className="space-y-4 mt-4"
                                                >
                                                    {ALGORITHM_CATEGORIES.map(category => (
                                                        <div key={category.name} className="space-y-2">
                                                            <div>
                                                                <h4 className="text-[10px] font-black text-teal-400 uppercase tracking-widest">{category.name}</h4>
                                                                <p className="text-[10px] text-slate-500 font-medium">{category.desc}</p>
                                                            </div>
                                                            <div className="grid grid-cols-1 gap-2">
                                                                {category.algos.map(algo => (
                                                                    <div 
                                                                        key={algo.id} 
                                                                        onClick={() => {
                                                                            if ((algo as any).disabled) {
                                                                                alert((algo as any).disabledReason || "This algorithm is currently disabled.");
                                                                                return;
                                                                            }
                                                                            if (!isTraining) setAlgorithm(algo.id);
                                                                        }}
                                                                        className={`flex items-start p-3 rounded-xl border cursor-pointer transition-all duration-300 relative overflow-hidden ${algorithm === algo.id ? 'border-teal-400 bg-teal-500/20 shadow-[0_0_15px_rgba(20,184,166,0.2)]' : 'border-white/10 bg-white/5 hover:bg-white/10'} ${isTraining || (algo as any).disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                                    >
                                                                        <div className={`mt-1 w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 ${algorithm === algo.id ? 'border-teal-400' : 'border-white/30'}`}>
                                                                            {algorithm === algo.id && <div className="w-1.5 h-1.5 bg-teal-400 rounded-full" />}
                                                                        </div>
                                                                        <div className="ml-3 flex-1 min-w-0">
                                                                            <div className="flex justify-between items-start mb-1">
                                                                                <div className="flex items-center gap-2">
                                                                                    <span className={`text-xs font-bold ${algorithm === algo.id ? 'text-teal-300' : 'text-slate-300'}`}>{algo.id}</span>
                                                                                    {(algo as any).disabled && (
                                                                                        <span className="text-[8px] font-bold text-red-400 bg-red-900/30 border border-red-500/30 px-1.5 py-0.5 rounded uppercase tracking-widest">CUDA REQUIRED</span>
                                                                                    )}
                                                                                </div>
                                                                                <span className="text-[9px] font-bold tracking-wider uppercase text-slate-500 bg-black/40 px-1.5 py-0.5 rounded border border-white/5">{algo.type}</span>
                                                                            </div>
                                                                            <p className="text-[10px] text-slate-400 leading-snug">{algo.desc}</p>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                    
                                    {!isGodTier && (
                                        <AdvancedHyperparameters
                                            learningRate={learningRate}
                                            setLearningRate={setLearningRate}
                                            maxDepth={maxDepth}
                                            setMaxDepth={setMaxDepth}
                                            isTraining={isTraining}
                                        />
                                    )}

                                    {isGodTier && (
                                        <div className="mt-4 p-4 rounded-xl border border-purple-500/30 bg-purple-500/10 shadow-[0_0_15px_rgba(168,85,247,0.15)] flex items-start gap-3">
                                            <svg className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                                            <div>
                                                <h4 className="text-sm font-bold text-purple-300">God-Tier Engine Active</h4>
                                                <p className="text-xs text-slate-400 mt-1">
                                                    This Next-Gen model handles its own architecture dynamically. Standard hyperparameters are bypassed.
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                    
                                    <AutoMlToggle 
                                        useAutoMl={useAutoMl}
                                        setUseAutoMl={setUseAutoMl}
                                        autoMlTrials={autoMlTrials}
                                        setAutoMlTrials={setAutoMlTrials}
                                        epochs={epochs}
                                        setEpochs={setEpochs}
                                        isTraining={isTraining}
                                    />

                                    {/* --- Supervised ML Pipeline Settings (Hedge Fund Grade) --- */}
                                    {['Random Forest', 'XGBoost', 'LightGBM', 'CatBoost', 'Logistic Regression', 'SVM', 'MoE'].includes(algorithm) && (
                                        <motion.div 
                                            initial={{ opacity: 0, y: -10 }} 
                                            animate={{ opacity: 1, y: 0 }}
                                            className="mt-4 p-5 rounded-2xl bg-teal-900/10 border border-teal-500/30 shadow-[0_0_15px_rgba(20,184,166,0.1)]"
                                        >
                                            <div className="flex items-center gap-2 mb-4 text-teal-400">
                                                <Activity className="w-5 h-5" />
                                                <h3 className="font-bold">Supervised ML Pipeline Settings</h3>
                                            </div>
                                            <div className="space-y-4">
                                                <div className="bg-black/30 border border-teal-500/20 rounded-xl p-4">
                                                    <div className="flex justify-between items-center mb-2">
                                                        <label className="text-xs font-bold text-white flex items-center gap-2">
                                                            Profit Barrier (Fee Threshold)
                                                        </label>
                                                        <span className="text-xs font-mono text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded">
                                                            {(feeThreshold * 100).toFixed(4)}%
                                                        </span>
                                                    </div>
                                                    <p className="text-[10px] text-slate-400 mb-3">
                                                        Filters out trades whose potential profit is less than the broker fee/spread. 
                                                        If set to 0.01%, the ML model will only learn from moves strictly {'>'} 0.01%.
                                                    </p>
                                                    <input 
                                                        type="range" 
                                                        min="0" 
                                                        max="0.01" 
                                                        step="0.0001" 
                                                        value={feeThreshold} 
                                                        onChange={(e) => setFeeThreshold(parseFloat(e.target.value))}
                                                        className="w-full accent-teal-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                                                    />
                                                    <div className="flex justify-between text-[9px] text-slate-500 mt-1 font-mono">
                                                        <span>0.00%</span>
                                                        <span>0.50%</span>
                                                        <span>1.00%</span>
                                                    </div>
                                                </div>

                                                <FractionalDiffConfig 
                                                    fractionalDiff={fractionalDiff}
                                                    setFractionalDiff={setFractionalDiff}
                                                    fractionalDValue={fractionalDValue}
                                                    setFractionalDValue={setFractionalDValue}
                                                />
                                            </div>
                                        </motion.div>
                                    )}

                                    {/* 🚀 Advanced RL & Risk Settings */}
                                    {(algorithm.includes('-RL') || ['QR-DQN', 'CQL', 'GAIL', 'Transformer'].includes(algorithm) || (isEnsemble && ensembleMethod === 'rl_moe')) && (
                                        <motion.div 
                                            initial={{ opacity: 0 }} 
                                            animate={{ opacity: 1 }}
                                            className="mt-4 p-4 bg-teal-500/5 border border-teal-500/20 rounded-2xl space-y-4"
                                        >
                                            <h4 className="text-xs font-black text-teal-400 uppercase tracking-widest flex items-center gap-2">
                                                <Target className="w-3.5 h-3.5" /> Engine Specific Settings
                                            </h4>
                                            
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase">Initial Balance ($)</label>
                                                    <input 
                                                        type="number" 
                                                        value={initialBalance} 
                                                        onChange={e => setInitialBalance(parseInt(e.target.value))}
                                                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-teal-400"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase">Trading Fees / Spread</label>
                                                    <input 
                                                        type="number" 
                                                        step="0.0001"
                                                        value={tradingFees} 
                                                        onChange={e => setTradingFees(parseFloat(e.target.value))}
                                                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-teal-400"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase">Slippage</label>
                                                    <input 
                                                        type="number" 
                                                        step="0.0001"
                                                        value={slippage} 
                                                        onChange={e => setSlippage(parseFloat(e.target.value))}
                                                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-teal-400"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase" title="0 = Disabled">Max Drawdown (%)</label>
                                                    <input 
                                                        type="number" 
                                                        step="0.1"
                                                        value={maxAllowedDrawdown} 
                                                        onChange={e => setMaxAllowedDrawdown(parseFloat(e.target.value) || 0)}
                                                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-teal-400"
                                                        placeholder="0 = Disabled"
                                                    />
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* COLUMN 3: Forex Data Engine (TradFi Data Pipeline) */}
                        <ForexAdvancedPipeline 
                            selectedFeatures={selectedForexFeatures}
                            onToggleFeature={(id) => {
                                setSelectedForexFeatures(prev => 
                                    prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
                                );
                            }}
                            onSetMultipleFeatures={setSelectedForexFeatures}
                            customIndicators={customIndicators}
                            setCustomIndicators={setCustomIndicators}
                            asmcHtf={asmcHtf}
                            setAsmcHtf={setAsmcHtf}
                            asmcLtf={asmcLtf}
                            setAsmcLtf={setAsmcLtf}
                            disabled={isTraining}
                            dataSource={dataSource}
                            setDataSource={setDataSource}
                            symbol={symbol}
                            isTraining={isTraining}
                            timeframe={timeframe}
                            forexSnapshotFiles={forexSnapshotFiles}
                            selectedForexFile={selectedForexFile}
                            setSelectedForexFile={setSelectedForexFile}
                            handleDeleteSnapshot={handleDeleteSnapshot}
                            forexScrapeJob={forexScrapeJob}
                            setForexScrapeJob={setForexScrapeJob}
                            onStartCollector={handleStartForexCollector}
                            onCancelCollector={handleCancelForexCollector}
                            l2OrderbookFiles={l2OrderbookFiles}
                            selectedL2File={selectedL2File}
                            setSelectedL2File={setSelectedL2File}
                            handleUploadL2Csv={handleUploadL2Csv}
                            handleDeleteL2Snapshot={handleDeleteL2Snapshot}
                            isUploadingL2={isUploadingL2}
                            tickDataFiles={tickDataFiles}
                            selectedTickFile={selectedTickFile}
                            setSelectedTickFile={setSelectedTickFile}
                            handleUploadTickCsv={handleUploadTickCsv}
                            handleDeleteTickSnapshot={handleDeleteTickSnapshot}
                            isUploadingTick={isUploadingTick}
                            tickBinningStrategy={tickBinningStrategy}
                            setTickBinningStrategy={setTickBinningStrategy}
                            onStartMerge={handleStartMerge}
                            hybridMergedFiles={hybridMergedFiles}
                            selectedHybridFile={selectedHybridFile}
                            setSelectedHybridFile={setSelectedHybridFile}
                            isMerging={isMerging}
                        />

                        </div>

                    </div>
                    
                    <div className="pt-6 mt-2 relative z-10 flex flex-col gap-3 border-t border-white/10">
                        {isTraining && activeJob ? (
                            <div className="flex gap-3">
                                <button 
                                    onClick={() => setShowTerminal(true)}
                                    className="flex-1 py-4 rounded-2xl font-black text-[15px] flex items-center justify-center gap-3 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 transition-all duration-300 shadow-xl"
                                >
                                    <Activity className="w-5 h-5" /> SHOW LIVE TERMINAL
                                </button>
                                <button 
                                    onClick={handleCancelTraining}
                                    className="flex-1 py-4 rounded-2xl font-black text-[15px] flex items-center justify-center gap-2 bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-all"
                                >
                                    <XCircle className="w-5 h-5" /> CANCEL
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={handleStartTraining}
                                disabled={isTraining}
                                className={`w-full py-4 rounded-2xl font-black text-[15px] flex items-center justify-center gap-3 transition-all duration-300 shadow-xl bg-gradient-to-r from-teal-500 via-blue-500 to-indigo-600 text-white hover:shadow-[0_0_30px_rgba(20,184,166,0.5)] border border-white/20 hover:scale-[1.02] ${isTraining ? 'opacity-50 cursor-wait' : ''}`}
                            >
                                <Play className="w-5 h-5 fill-current" /> START DEEP TRAINING
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Live Execution Terminal Modal */}
            <AnimatePresence>
                {showTerminal && (
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
                    >
                        <div className="w-full max-w-6xl h-[85vh] relative flex flex-col min-h-0">
                            <button 
                                onClick={() => setShowTerminal(false)}
                                className="absolute -top-12 right-0 p-2 text-slate-400 hover:text-white transition-colors"
                            >
                                <XCircle className="w-8 h-8" />
                            </button>

                            <div className="flex flex-col bg-black/60 backdrop-blur-2xl border border-cyan-500/20 rounded-3xl shadow-[0_0_50px_rgba(56,189,248,0.1)] overflow-hidden h-full relative z-10 w-full">
                                {/* Header */}
                                <div className="px-6 py-4 bg-gradient-to-r from-cyan-900/40 to-blue-900/20 border-b border-cyan-500/20 flex items-center justify-between flex-shrink-0">
                                    <div className="flex items-center gap-3">
                                        <Terminal className="w-5 h-5 text-cyan-400" />
                                        <span className="text-sm font-mono text-cyan-100 tracking-widest font-bold">LIVE_CONSOLE_OUTPUT</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <div className="w-3.5 h-3.5 rounded-full bg-red-500/50 border border-red-400 shadow-[0_0_10px_#ef4444]"></div>
                                        <div className="w-3.5 h-3.5 rounded-full bg-yellow-500/50 border border-yellow-400 shadow-[0_0_10px_#eab308]"></div>
                                        <div className="w-3.5 h-3.5 rounded-full bg-green-500/50 border border-green-400 shadow-[0_0_10px_#22c55e]"></div>
                                    </div>
                                </div>

                                {/* Progress Bar */}
                                {activeJob && (
                                    <div className="h-1.5 bg-gray-900 w-full relative overflow-hidden shadow-inner flex-shrink-0 border-b border-cyan-900/50">
                                        <motion.div 
                                            className={`absolute top-0 left-0 h-full ${activeJob.status === 'FAILED' ? 'bg-red-500 shadow-[0_0_10px_#ef4444]' : activeJob.status === 'COMPLETED' ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' : 'bg-gradient-to-r from-cyan-400 to-purple-500 shadow-[0_0_15px_#22d3ee]'}`}
                                            initial={{ width: 0 }}
                                            animate={{ width: `${activeJob.progress}%` }}
                                            transition={{ duration: 0.5 }}
                                        />
                                    </div>
                                )}

                                {/* Terminal Logs Area */}
                                <div className="flex-1 p-5 overflow-y-auto custom-scrollbar font-mono text-sm leading-relaxed">
                                    {!activeJob ? (
                                        <div className="h-full flex flex-col items-center justify-center text-gray-600 space-y-4">
                                            <Database className="w-12 h-12 opacity-20" />
                                            <p>Awaiting training instructions...</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-1.5 pb-8">
                                            {activeJob.logs?.map((log, i) => {
                                                // Ignore raw timestamps for JSON extraction
                                                const cleanLog = log.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '').replace(/^\[ForexEngine\]\s*/, '');
                                                
                                                if (cleanLog.startsWith('[METRICS]')) {
                                                    try {
                                                        const metrics = JSON.parse(cleanLog.replace('[METRICS]', '').trim());
                                                        return (
                                                            <motion.div key={i} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="mt-4 mb-4 p-4 bg-gradient-to-br from-emerald-900/40 to-cyan-900/20 border border-emerald-500/30 rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.15)]">
                                                                <h4 className="text-emerald-400 font-bold text-xs mb-2 tracking-widest flex items-center gap-2">
                                                                    <Activity className="w-4 h-4" /> PERFORMANCE METRICS
                                                                </h4>
                                                                <div className="grid grid-cols-2 gap-4">
                                                                    {Object.entries(metrics).map(([k, v]) => (
                                                                        <div key={k} className="bg-black/40 rounded-lg p-3 border border-emerald-500/10">
                                                                            <div className="text-emerald-100/50 text-[10px] uppercase font-bold tracking-wider">{k}</div>
                                                                            <div className="text-emerald-400 text-lg font-black mt-1 drop-shadow-[0_0_5px_#10b981]">{Number(v).toFixed(4)}</div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </motion.div>
                                                        );
                                                    } catch (e) { return null; }
                                                }

                                                if (cleanLog.startsWith('[FEATURE_IMPORTANCE]')) {
                                                    try {
                                                        const featureData = JSON.parse(cleanLog.replace('[FEATURE_IMPORTANCE]', '').trim());
                                                        return <FeatureImportanceChart key={i} data={featureData} />;
                                                    } catch (e) { return null; }
                                                }

                                                let textColor = "text-gray-300";
                                                
                                                if (log.includes("ERROR") || log.includes("CRITICAL")) textColor = "text-red-400 drop-shadow-[0_0_5px_#ef4444]";
                                                else if (log.includes("complete") || log.includes("successfully") || log.includes("SUCCESS") || log.includes("Model saved")) textColor = "text-emerald-400 drop-shadow-[0_0_5px_#10b981]";
                                                else if (log.includes("Epoch") || log.includes("Loss") || log.includes("Accuracy")) textColor = "text-cyan-400 drop-shadow-[0_0_5px_#22d3ee]";
                                                else if (log.includes("Fetching") || log.includes("Calculating")) textColor = "text-yellow-400";
                                                else if (log.includes("WARNING")) textColor = "text-amber-400 drop-shadow-[0_0_5px_#f59e0b]";

                                                return (
                                                    <motion.div 
                                                        key={i}
                                                        initial={{ opacity: 0, x: -10 }}
                                                        animate={{ opacity: 1, x: 0 }}
                                                        className={`flex gap-3 font-mono text-sm leading-relaxed mb-1 ${textColor}`}
                                                    >
                                                        <span className="opacity-50 select-none shrink-0 w-24">
                                                            root@core:~#
                                                        </span>
                                                        <span className="break-words flex-1">
                                                            {log}
                                                        </span>
                                                    </motion.div>
                                                );
                                            })}
                                            {activeJob.status === 'RUNNING' && (
                                                <div className="flex items-center gap-2 text-cyan-500/50 mt-4 animate-pulse">
                                                    <span className="w-2 h-4 bg-cyan-400 block" />
                                                    <span>PROCESSING...</span>
                                                </div>
                                            )}
                                            {activeJob.status === 'FAILED' && (
                                                <div className="mt-4 p-4 border border-red-500/30 bg-red-500/10 rounded-xl text-red-400">
                                                    <div className="font-bold mb-1">PROCESS TERMINATED</div>
                                                    <div>{activeJob.error_message}</div>
                                                </div>
                                            )}
                                            <div ref={logsEndRef} />
                                        </div>
                                    )}
                                </div>

                                {/* Footer Status Bar */}
                                <div className="bg-black/80 backdrop-blur-md px-6 py-3 border-t border-cyan-500/30 flex justify-between items-center shrink-0">
                                    <div className="flex items-center gap-3">
                                        {activeJob?.status === 'COMPLETED' ? (
                                            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                                        ) : activeJob?.status === 'FAILED' ? (
                                            <XCircle className="w-5 h-5 text-red-400" />
                                        ) : (
                                            <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                                        )}
                                        <span className={`text-xs font-mono font-bold tracking-widest ${activeJob?.status === 'COMPLETED' ? 'text-emerald-400' : activeJob?.status === 'FAILED' ? 'text-red-400' : 'text-cyan-400'}`}>
                                            SYSTEM_STATUS: {activeJob?.status || 'IDLE'}
                                        </span>
                                    </div>
                                    <div className="text-xs font-mono text-cyan-100/50 font-bold">
                                        {activeJob?.progress ? `${Math.floor(activeJob.progress)}%` : '0%'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
};

export default ForexModelTrainingStudio;
