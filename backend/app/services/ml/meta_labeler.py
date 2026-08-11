import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier

def train_meta_model(X_train: pd.DataFrame, y_true: pd.Series, primary_model, algorithm: str = 'Random Forest'):
    """
    Trains a secondary Meta-Labeling model.
    The meta-model attempts to predict whether the primary model's prediction will be correct (1) or incorrect (0).
    
    Args:
        X_train: Training features
        y_true: True targets
        primary_model: The trained primary model
        
    Returns:
        meta_model: Trained secondary model
    """
    
    print("Generating Meta-Labels (1 = Primary Correct, 0 = Primary Incorrect)...")
    
    # 1. Get primary model predictions on the training set
    primary_preds = primary_model.predict(X_train)
    
    # 2. Create meta-labels: 1 if primary was correct, 0 otherwise
    meta_labels = (primary_preds == y_true).astype(int)
    
    # 3. Train the meta-model on the exact same features but with the meta-labels
    # We use a standard RF for the meta-model, but limit depth to prevent overfitting
    print("Training Secondary Meta-Model...")
    meta_model = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42, n_jobs=-1)
    meta_model.fit(X_train, meta_labels)
    
    return meta_model
