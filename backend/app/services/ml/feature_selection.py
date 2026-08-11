import pandas as pd
import numpy as np
import shap
from sklearn.ensemble import RandomForestClassifier

def select_features(X: pd.DataFrame, y: pd.Series, method: str = 'shap') -> pd.DataFrame:
    """
    Reduces the feature space by removing noisy features.
    
    Args:
        X: Feature matrix
        y: Target variable
        method: 'shap' or 'boruta' (falls back to SHAP/RF importance)
        
    Returns:
        pd.DataFrame: Reduced feature matrix
    """
    if method == 'none':
        return X
        
    print(f"Running Feature Selection using {method}...")
    
    # Use a quick Random Forest to evaluate feature importance
    rf = RandomForestClassifier(n_estimators=50, random_state=42, n_jobs=-1)
    rf.fit(X, y)
    
    selected_features = X.columns.tolist()
    
    if method == 'shap':
        # Calculate SHAP values
        explainer = shap.TreeExplainer(rf)
        # Use a sample if dataset is too large to speed up SHAP
        sample_size = min(2000, len(X))
        X_sample = X.sample(sample_size, random_state=42)
        shap_values = explainer.shap_values(X_sample)
        
        # Calculate mean absolute SHAP values per feature
        if isinstance(shap_values, list): # Multi-class (older SHAP API)
            mean_shap = np.abs(shap_values[1]).mean(axis=0) # Assuming class 1 is the positive class
        else:
            if len(shap_values.shape) == 3:
                # 3D array: (n_samples, n_features, n_classes)
                # Take the mean over samples (axis=0) and then mean over classes (axis=1)
                mean_shap = np.abs(shap_values).mean(axis=0).mean(axis=1)
            else:
                mean_shap = np.abs(shap_values).mean(axis=0)
            
        # Create a series with feature names and their SHAP importance
        importance = pd.Series(mean_shap, index=X.columns)
        
        # Keep features with importance > median importance (or top N)
        threshold = importance.median()
        selected_features = importance[importance > threshold].index.tolist()
        
    elif method == 'boruta':
        # Fallback to standard RF feature importance since Boruta is not installed
        importance = pd.Series(rf.feature_importances_, index=X.columns)
        threshold = importance.median()
        selected_features = importance[importance > threshold].index.tolist()
        
    # Always ensure at least 1 feature is selected
    if len(selected_features) == 0:
        selected_features = X.columns.tolist()
        
    print(f"Reduced features from {len(X.columns)} to {len(selected_features)}")
    return X[selected_features]
