from app.services.ml.forex_statistical_models import ForexARIMAModel, ForexVARModel, ForexNeuralProphetModel
from app.services.ml.forex_volatility_models import ForexGARCHModel, ForexEGARCHModel
from app.services.ml.market_regime_models import MarketHMMModel, MarketMarkovSwitchingModel
from app.services.ml.market_probabilistic_models import MarketBayesianNNModel

def get_forex_model(algorithm_name: str, config: dict = None):
    """
    Factory method to instantiate the correct ML model based on the algorithm name.
    Supports 31 different algorithms (Forex specific + Scikit-Learn + RL/DeepLearning fallbacks).
    """
    if config is None:
        config = {}

    base_algo = algorithm_name.replace("Crypto", "").replace("Forex", "").replace(" ", "").strip()
    
    # Re-add space for specific names if needed or just use original for sklearn models
    if algorithm_name in ["Random Forest", "Logistic Regression", "Bayesian NN", "Markov-Switching"]:
        base_algo = algorithm_name
        
    # Also handle some edge cases
    if base_algo == "LSTM": pass # example

    # 1. Econometric & Statistical (Forex Core)
    if base_algo == 'ARIMA':
        return ForexARIMAModel()
    elif base_algo == 'VAR':
        return ForexVARModel()
    elif base_algo == 'GARCH':
        return ForexGARCHModel()
    elif base_algo == 'EGARCH':
        return ForexEGARCHModel()
    elif base_algo == 'NeuralProphet':
        return ForexNeuralProphetModel()
        
    # 2. Market Regime & Macro
    elif base_algo == 'HMM':
        return MarketHMMModel()
    elif base_algo == 'Markov-Switching':
        return MarketMarkovSwitchingModel()
    elif base_algo == 'Bayesian NN':
        return MarketBayesianNNModel()

    # Extract core parameters from frontend config
    is_clf = config.get('prediction_target', 'classification') == 'classification'
    n_estimators = config.get('n_estimators', config.get('epochs', 100))
    epochs = config.get('epochs', 10)
    tree_depth = config.get('tree_depth', None)
    # Some algorithms don't like max_depth=0 or None, handle accordingly per algo
    max_depth = tree_depth if tree_depth and tree_depth > 0 else None
    
    lr = config.get('learning_rate', 1e-3)
    batch_size = config.get('batch_size', 32)
    seq_len = config.get('sequence_length', 10)
    class_weight = config.get('class_weight', None)
    if class_weight == 'balanced':
        cw_param = 'balanced'
    else:
        cw_param = None

    # 3. Indicator & Tabular Engines (Scikit-Learn / Boosters)
    if base_algo == 'Random Forest':
        from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
        if is_clf:
            return RandomForestClassifier(n_estimators=n_estimators, max_depth=max_depth, class_weight=cw_param, random_state=42, n_jobs=1)
        return RandomForestRegressor(n_estimators=n_estimators, max_depth=max_depth, random_state=42, n_jobs=1)
        
    elif base_algo == 'XGBoost':
        try:
            from xgboost import XGBClassifier, XGBRegressor
            if is_clf:
                return XGBClassifier(n_estimators=n_estimators, max_depth=max_depth or 6, learning_rate=lr, random_state=42, use_label_encoder=False, eval_metric='logloss')
            return XGBRegressor(n_estimators=n_estimators, max_depth=max_depth or 6, learning_rate=lr, random_state=42)
        except ImportError:
            from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
            if is_clf:
                return GradientBoostingClassifier(n_estimators=n_estimators, max_depth=max_depth or 3, learning_rate=lr, random_state=42)
            return GradientBoostingRegressor(n_estimators=n_estimators, max_depth=max_depth or 3, learning_rate=lr, random_state=42)
            
    elif base_algo == 'LightGBM':
        try:
            from lightgbm import LGBMClassifier, LGBMRegressor
            if is_clf:
                return LGBMClassifier(n_estimators=n_estimators, max_depth=max_depth or -1, learning_rate=lr, class_weight=cw_param, random_state=42)
            return LGBMRegressor(n_estimators=n_estimators, max_depth=max_depth or -1, learning_rate=lr, random_state=42)
        except ImportError:
            from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
            if is_clf:
                return GradientBoostingClassifier(n_estimators=n_estimators, max_depth=max_depth or 3, learning_rate=lr, random_state=42)
            return GradientBoostingRegressor(n_estimators=n_estimators, max_depth=max_depth or 3, learning_rate=lr, random_state=42)
            
    elif base_algo == 'CatBoost':
        try:
            from catboost import CatBoostClassifier, CatBoostRegressor
            if is_clf:
                return CatBoostClassifier(iterations=n_estimators, depth=max_depth or 6, learning_rate=lr, random_state=42, verbose=0)
            return CatBoostRegressor(iterations=n_estimators, depth=max_depth or 6, learning_rate=lr, random_state=42, verbose=0)
        except ImportError:
            from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
            if is_clf:
                return GradientBoostingClassifier(n_estimators=n_estimators, max_depth=max_depth or 3, learning_rate=lr, random_state=42)
            return GradientBoostingRegressor(n_estimators=n_estimators, max_depth=max_depth or 3, learning_rate=lr, random_state=42)
            
    elif base_algo == 'TabNet':
        from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
        if is_clf:
            return RandomForestClassifier(n_estimators=n_estimators, max_depth=max_depth, class_weight=cw_param, random_state=42, n_jobs=1)
        return RandomForestRegressor(n_estimators=n_estimators, max_depth=max_depth, random_state=42, n_jobs=1)

    # 4. Deep Learning Models (Native PyTorch)
    elif base_algo == 'LSTM':
        from app.services.ml.forex_deep_learning_models import ForexLSTM
        return ForexLSTM(epochs=epochs, seq_len=seq_len, batch_size=batch_size, lr=lr)
    elif base_algo == 'GRU':
        from app.services.ml.forex_deep_learning_models import ForexGRU
        return ForexGRU(epochs=epochs, seq_len=seq_len, batch_size=batch_size, lr=lr)
    elif base_algo == 'TCN':
        from app.services.ml.forex_deep_learning_models import ForexTCN
        return ForexTCN(epochs=epochs, seq_len=seq_len, batch_size=batch_size, lr=lr)
    elif base_algo == '1D-CNN':
        from app.services.ml.forex_deep_learning_models import ForexCNN1D
        return ForexCNN1D(epochs=epochs, seq_len=seq_len, batch_size=batch_size, lr=lr)
    elif base_algo == 'DeepLOB':
        from app.services.ml.forex_deep_learning_models import ForexDeepLOB
        return ForexDeepLOB(epochs=epochs, seq_len=seq_len, batch_size=batch_size, lr=lr)
    elif base_algo == 'Transformer':
        from app.services.ml.forex_deep_learning_models import ForexTransformer
        return ForexTransformer(epochs=epochs, seq_len=seq_len, batch_size=batch_size, lr=lr)
    elif base_algo == 'Auto-Encoder':
        from app.services.ml.forex_deep_learning_models import ForexAutoEncoder
        return ForexAutoEncoder(epochs=epochs, seq_len=seq_len, batch_size=batch_size, lr=lr)
    elif base_algo == 'Liquid-NN':
        from app.services.ml.forex_deep_learning_models import ForexLiquidNN
        return ForexLiquidNN(epochs=epochs, seq_len=seq_len, batch_size=batch_size, lr=lr)

    # 5. Reinforcement Learning Models (Native stable-baselines3)
    elif base_algo == 'PPO-RL':
        from app.services.ml.forex_rl_models import ForexPPORL
        return ForexPPORL(epochs=epochs)
    elif base_algo == 'SAC-RL':
        from app.services.ml.forex_rl_models import ForexSACRL
        return ForexSACRL(epochs=epochs)
    elif base_algo == 'A2C-RL':
        from app.services.ml.forex_rl_models import ForexA2CRL
        return ForexA2CRL(epochs=epochs)
    elif base_algo == 'DDPG-RL':
        from app.services.ml.forex_rl_models import ForexDDPGRL
        return ForexDDPGRL(epochs=epochs)
    elif base_algo == 'TD3-RL':
        from app.services.ml.forex_rl_models import ForexTD3RL
        return ForexTD3RL(epochs=epochs)
    elif base_algo == 'DQN-RL':
        from app.services.ml.forex_rl_models import ForexDQNRL
        return ForexDQNRL(epochs=epochs)
    elif base_algo in ['QR-DQN', 'CQL', 'GAIL', 'Decision-Transformer']:
        from app.services.ml.forex_rl_models import ForexAdvancedRL
        return ForexAdvancedRL(algo_name=base_algo, epochs=epochs)
    else:
        raise ValueError(f"Algorithm '{algorithm_name}' not natively supported in Engine.")
