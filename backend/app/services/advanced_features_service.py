import os
import glob
import pandas as pd
import numpy as np
from typing import List, Dict, Any

def _get_latest_dataset(rows=1000, symbol=None, timeframe=None, dataset_type=None) -> pd.DataFrame:
    """
    Attempts to load the most recent dataset from raw data directories.
    Prioritizes specific symbol/type if provided, else falls back to hybrid/l2.
    """
    base_dir = os.path.join(os.getcwd(), "data", "raw")
    files = []
    
    # Try to find specific files based on criteria
    if symbol and dataset_type:
        target_dir = None
        if dataset_type == 'ohlcv':
            target_dir = os.path.join(base_dir, "ohlcv")
        elif dataset_type == 'historical_trades':
            target_dir = os.path.join(base_dir, "historical_trades")
        elif dataset_type == 'l2_orderbook':
            target_dir = os.path.join(base_dir, "l2_snapshots")
        elif dataset_type in ['hybrid', 'hybrid_deep']:
            target_dir = os.path.join(base_dir, "hybrid_snapshots")
            
        if target_dir and os.path.exists(target_dir):
            # Try specific symbol and timeframe
            if timeframe:
                files.extend(glob.glob(os.path.join(target_dir, f"*{symbol}*{timeframe}*.parquet")))
            if not files:
                # Try just symbol
                files.extend(glob.glob(os.path.join(target_dir, f"*{symbol}*.parquet")))
                
    # Fallback to general hybrid/l2 if specific files not found
    if not files:
        hybrid_dir = os.path.join(base_dir, "hybrid_snapshots")
        l2_dir = os.path.join(base_dir, "l2_snapshots")
        
        if os.path.exists(hybrid_dir):
            files.extend(glob.glob(os.path.join(hybrid_dir, "*.parquet")))
        if os.path.exists(l2_dir):
            files.extend(glob.glob(os.path.join(l2_dir, "*.parquet")))
        
    if not files:
        # Fallback to generating mock data if no files exist, to ensure UI doesn't break
        print("Warning: No parquet files found in raw data dirs. Using generated mock data.")
        return _generate_mock_dataset(rows)
        
    # Sort by modification time
    files.sort(key=os.path.getmtime, reverse=True)
    latest_file = files[0]
    
    try:
        df = pd.read_parquet(latest_file)
        # Take the last 'rows' rows for speed
        if len(df) > rows:
            df = df.tail(rows)
        return df
    except Exception as e:
        print(f"Error reading {latest_file}: {e}")
        return _generate_mock_dataset(rows)

def _generate_mock_dataset(rows=1000) -> pd.DataFrame:
    """Generates a mock dataframe with standard trading features if no files are found."""
    np.random.seed(42)
    data = {
        'price': np.cumsum(np.random.randn(rows)) + 50000,
        'volume': np.abs(np.random.randn(rows) * 100),
        'obi': np.random.uniform(-1, 1, rows),
        'spread': np.abs(np.random.randn(rows) * 0.5),
        'microprice': np.cumsum(np.random.randn(rows)) + 50000,
        'cvd': np.cumsum(np.random.randn(rows) * 10),
        'buy_volume': np.abs(np.random.randn(rows) * 50),
        'sell_volume': np.abs(np.random.randn(rows) * 50),
        'trade_count': np.random.randint(1, 100, rows),
        'smart_money_divergence': np.random.randn(rows),
        'RSI': np.random.uniform(20, 80, rows),
        'MACD': np.random.randn(rows)
    }
    return pd.DataFrame(data)

def calculate_correlation_matrix(features: List[str]) -> Dict[str, Any]:
    """
    Calculates the Pearson correlation matrix for the requested features.
    If a feature doesn't exist in the loaded dataset, it is ignored or padded.
    """
    df = _get_latest_dataset(rows=1000)
    
    # For numeric correlation
    df_numeric = df.select_dtypes(include=[np.number])
    
    # Identify which features are actually in the dataframe
    valid_features = [f for f in features if f in df_numeric.columns]
    
    # If the user asked for features that don't exist in the current raw data,
    # fill them with NaN so they correctly show as 0 or empty in the matrix
    # instead of rendering fake random correlation values.
    for f in features:
        if f not in df_numeric.columns:
            df_numeric[f] = np.nan
            valid_features.append(f)
            
    # Calculate correlation on the requested features
    df_subset = df_numeric[features]
    corr_matrix = df_subset.corr(method='pearson').fillna(0)
    
    # Convert to 2D list for JSON response
    matrix_list = corr_matrix.values.tolist()
    
    return {
        "features": features,
        "matrix": matrix_list
    }

def validate_custom_formula(formula: str) -> Dict[str, Any]:
    """
    Evaluates a user-provided pandas formula.
    As per user request, this allows maximum flexibility (pandas.eval) for personal use.
    """
    df = _get_latest_dataset(rows=100)
    
    # To support math functions directly in eval, pandas needs engine='python'
    # or we just use pandas DataFrame eval
    try:
        # Pre-populate some dummy columns if they don't exist so the formula doesn't break instantly
        # Just a basic safety net for the validation step
        import re
        # Find all words that look like variables
        words = re.findall(r'[a-zA-Z_][a-zA-Z0-9_]*', formula)
        # Exclude math keywords
        keywords = {'math', 'np', 'log', 'exp', 'sin', 'cos', 'tan', 'sqrt', 'abs'}
        
        for w in words:
            if w not in df.columns and w not in keywords:
                # Use ones instead of random data for validation to prevent false variance
                df[w] = np.ones(len(df))
                
        # Evaluate using pandas
        # Allowing engine='python' gives maximum flexibility for local functions
        result = df.eval(formula, engine='python')
        
        return {
            "valid": True,
            "message": "Formula evaluated successfully.",
            "sample_output": result.head(5).tolist() if isinstance(result, pd.Series) else result
        }
    except Exception as e:
        return {
            "valid": False,
            "error": str(e)
        }

def run_automl_feature_selection(symbol=None, timeframe=None, dataset_type=None) -> Dict[str, Any]:
    """
    Runs an AutoML feature selection process using XGBoost and SHAP.
    Falls back to RandomForest feature importance if xgboost/shap are not installed.
    """
    df = _get_latest_dataset(rows=2000, symbol=symbol, timeframe=timeframe, dataset_type=dataset_type)
    df_numeric = df.select_dtypes(include=[np.number]).dropna(axis=1, how='all').fillna(0)
    
    if len(df_numeric.columns) == 0:
        return {"top_features": []}
        
    # Assume we are predicting 5-step future return of the first column (usually price or midprice)
    target_col = df_numeric.columns[0]
    df_numeric['target_y'] = df_numeric[target_col].pct_change(5).shift(-5)
    
    # Clean infinity values and NaNs
    df_numeric.replace([np.inf, -np.inf], np.nan, inplace=True)
    df_numeric['target_y'] = df_numeric['target_y'].fillna(0)
    
    # Separate features (X) and target (y)
    X = df_numeric.drop(columns=['target_y', target_col], errors='ignore')
    X = X.fillna(0) # Also clean X to be safe
    y = df_numeric['target_y'] * 10000 # Scale up for XGBoost numerical stability
    
    if X.empty:
        return {"top_features": []}
    
    top_features = []
    method = ""
    
    try:
        import xgboost as xgb
        import shap
        
        # Train XGBoost model
        model = xgb.XGBRegressor(n_estimators=50, max_depth=3, random_state=42, n_jobs=-1)
        model.fit(X, y)
        
        # Calculate SHAP values
        explainer = shap.TreeExplainer(model)
        shap_values = explainer.shap_values(X)
        
        # Mean absolute SHAP values for feature importance
        mean_abs_shap = np.abs(shap_values).mean(axis=0)
        importances = pd.Series(mean_abs_shap, index=X.columns)
        importances = importances.sort_values(ascending=False)
        
        top_features = importances.head(20).index.tolist()
        method = "XGBoost + SHAP Values"
        
    except ImportError:
        # Fallback to Random Forest if xgboost or shap are missing
        try:
            from sklearn.ensemble import RandomForestRegressor
            
            # Train a quick model to get feature importance
            model = RandomForestRegressor(n_estimators=20, random_state=42, n_jobs=-1)
            model.fit(X, y)
            
            # Get importances and sort
            importances = pd.Series(model.feature_importances_, index=X.columns)
            importances = importances.sort_values(ascending=False)
            
            # Return top 20
            top_features = importances.head(20).index.tolist()
            method = "Random Forest Feature Importance (Fallback)"
        except ImportError:
            # Fallback to absolute correlation if sklearn is not installed
            importances = df_numeric.corr()['target_y'].abs().drop(labels=['target_y', target_col], errors='ignore')
            importances = importances.sort_values(ascending=False)
            top_features = importances.head(20).index.tolist()
            method = "Target Correlation (Fallback)"
    
    top_features_with_scores = []
    max_score = importances.max() if not importances.empty else 1.0
    if max_score == 0: max_score = 1.0
    
    for f in top_features:
        score = float(importances.get(f, 0.0)) / float(max_score)
        top_features_with_scores.append({"feature": f, "score": score})
    
    # If we don't have 20 features, supplement with some standard ones from the UI
    standard_features = [
        'obi', 'spread', 'microprice', 'cvd', 'buy_volume', 'sell_volume', 
        'trade_count', 'smart_money_divergence', 'liquidity_cluster', 'cascade_dynamics'
    ]
    
    for f in standard_features:
        if f not in top_features and len(top_features) < 20:
            top_features.append(f)
            top_features_with_scores.append({"feature": f, "score": 0.05}) # Default low score
            
    return {
        "top_features": top_features,
        "top_features_with_scores": top_features_with_scores,
        "method": method
    }
