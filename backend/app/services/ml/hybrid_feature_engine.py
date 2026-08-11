import pandas as pd
import numpy as np
import logging

logger = logging.getLogger(__name__)

def generate_hybrid_features(df: pd.DataFrame, selected_features: list[str]) -> pd.DataFrame:
    """
    Main entry point for calculating advanced Institutional Quant features.
    Routes to 15 distinct modular engines based on selected features.
    Total available features: 150.
    """
    if not selected_features:
        return df
        
    logger.info(f"Generating advanced hybrid features. Total selected: {len(selected_features)}")
    
    try:
        # --- CATEGORY 1: SMC & ICT (Tick-Verified) (1-10) ---
        from app.services.ml.smc_ict.tick_verified_smc import generate_tick_verified_smc
        df = generate_tick_verified_smc(df, selected_features)
        
        # --- CATEGORY 2: Candlestick Psychology & Micro-Anatomy (11-20) ---
        from app.services.ml.price_action.candlestick_anatomy import generate_candlestick_anatomy
        df = generate_candlestick_anatomy(df, selected_features)
        
        # --- CATEGORY 3: Advanced Price Action & Swing Structuring (21-30) ---
        from app.services.ml.price_action.swing_structuring import generate_swing_structuring_features
        df = generate_swing_structuring_features(df, selected_features)
        
        # --- CATEGORY 4: Information Theory & Entropy (31-40) ---
        from app.services.ml.math_models.information_theory import generate_information_theory_features
        df = generate_information_theory_features(df, selected_features)
        
        # --- CATEGORY 5: Chaos Theory & Non-linear Dynamics (41-50) ---
        from app.services.ml.math_models.chaos_theory import generate_chaos_theory_features
        df = generate_chaos_theory_features(df, selected_features)
        
        # --- CATEGORY 6: Spectral & Frequency Domain Analysis (51-60) ---
        from app.services.ml.math_models.spectral_analysis import generate_spectral_analysis_features
        df = generate_spectral_analysis_features(df, selected_features)
        
        # --- CATEGORY 7: Fractional Calculus & Memory Models (61-70) ---
        from app.services.ml.math_models.fractional_calculus import generate_fractional_calculus_features
        df = generate_fractional_calculus_features(df, selected_features)
        
        # --- CATEGORY 8: Topological Data Analysis (TDA) (71-80) ---
        from app.services.ml.math_models.topological_data_tda import generate_topological_data_tda_features
        df = generate_topological_data_tda_features(df, selected_features)
        
        # --- CATEGORY 9: Advanced Microstructure & Point Processes (81-90) ---
        from app.services.ml.math_models.microstructure_point_process import generate_microstructure_features
        df = generate_microstructure_features(df, selected_features)
        
        # --- CATEGORY 10: Stochastic Calculus & Jump Diffusion (91-100) ---
        from app.services.ml.math_models.stochastic_jump import generate_stochastic_jump_features
        df = generate_stochastic_jump_features(df, selected_features)
        
        # --- CATEGORY 11: Graph Theory & Network Analysis (101-110) ---
        from app.services.ml.math_models.graph_network import generate_graph_network_features
        df = generate_graph_network_features(df, selected_features)
        
        # --- CATEGORY 12: Limit Order Book (L2) & Liquidity Dynamics (111-120) ---
        from app.services.ml.math_models.lob_liquidity import generate_lob_liquidity_features
        df = generate_lob_liquidity_features(df, selected_features)
        
        # --- CATEGORY 13: Statistical Arbitrage & Mean Reversion (121-130) ---
        from app.services.ml.math_models.stat_arb_mean_reversion import generate_stat_arb_features
        df = generate_stat_arb_features(df, selected_features)
        
        # --- CATEGORY 14: Regime Detection & Behavioral Sentiment (131-140) ---
        from app.services.ml.math_models.regime_sentiment import generate_regime_sentiment_features
        df = generate_regime_sentiment_features(df, selected_features)
        
        # --- CATEGORY 15: Machine Learning Meta-Features (141-150) ---
        from app.services.ml.math_models.ml_meta_features import generate_ml_meta_features
        df = generate_ml_meta_features(df, selected_features)
        
    except Exception as e:
        logger.error(f"Error in hybrid feature generation: {e}")
        
    return df
