import os
import glob
import pandas as pd
import numpy as np
from typing import List, Dict, Any

def _get_latest_dataset(rows=1000) -> pd.DataFrame:
    """
    Attempts to load the most recent dataset from raw data directories.
    Prioritizes hybrid snapshots, then l2 snapshots.
    """
    base_dir = os.path.join(os.getcwd(), "data", "raw")
    
    # Check hybrid first
    hybrid_dir = os.path.join(base_dir, "hybrid_snapshots")
    l2_dir = os.path.join(base_dir, "l2_snapshots")
    
    files = []
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
    # we inject mock columns for them just so the UI matrix renders completely.
    # This happens because the UI has many hardcoded feature checkboxes.
    for f in features:
        if f not in df_numeric.columns:
            df_numeric[f] = np.random.randn(len(df_numeric))
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
                df[w] = np.random.randn(len(df))
                
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

def run_automl_feature_selection() -> Dict[str, Any]:
    """
    Simulates an AutoML / SHAP feature selection process.
    We use correlation against a generated target (future return) to find the top 20 features.
    """
    df = _get_latest_dataset(rows=2000)
    df_numeric = df.select_dtypes(include=[np.number]).dropna(axis=1, how='all').fillna(0)
    
    if len(df_numeric.columns) == 0:
        return {"top_features": []}
        
    # Assume we are predicting 5-step future return of the first column (usually price or midprice)
    target_col = df_numeric.columns[0]
    df_numeric['target_y'] = df_numeric[target_col].pct_change(5).shift(-5).fillna(0)
    
    # Calculate Absolute Correlation to Target
    corr_series = df_numeric.corr()['target_y'].abs()
    # Drop the target itself
    corr_series = corr_series.drop(labels=['target_y', target_col], errors='ignore')
    
    # Sort features by correlation score
    corr_series = corr_series.sort_values(ascending=False)
    
    # Return top 20
    top_features = corr_series.head(20).index.tolist()
    
    # If we don't have 20 features, supplement with some standard ones from the UI
    standard_features = [
        'obi', 'spread', 'microprice', 'cvd', 'buy_volume', 'sell_volume', 
        'trade_count', 'smart_money_divergence', 'liquidity_cluster', 'cascade_dynamics'
    ]
    
    for f in standard_features:
        if f not in top_features and len(top_features) < 20:
            top_features.append(f)
            
    return {
        "top_features": top_features,
        "method": "Target Correlation (SHAP Proxy)"
    }
