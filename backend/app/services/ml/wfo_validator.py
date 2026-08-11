import pandas as pd
import numpy as np

def walk_forward_split(X: pd.DataFrame, y: pd.Series, n_splits: int = 5):
    """
    Generates indices to split data into training and test set in a walk-forward manner.
    Similar to TimeSeriesSplit but returns actual data subsets for easier looping.
    
    Args:
        X: Feature matrix (chronologically ordered)
        y: Target series
        n_splits: Number of Walk-Forward windows (folds)
        
    Yields:
        (X_train, X_test, y_train, y_test) for each fold
    """
    total_samples = len(X)
    
    # Calculate fold size
    # In Walk-Forward, the window expands or shifts. We will use an expanding window.
    # Base train size = total / (n_splits + 1)
    # Test size = total / (n_splits + 1)
    
    fold_size = total_samples // (n_splits + 1)
    
    for i in range(n_splits):
        train_end = (i + 1) * fold_size
        test_end = train_end + fold_size
        
        # In case it's the last split, take all remaining data
        if i == n_splits - 1:
            test_end = total_samples
            
        X_train = X.iloc[0:train_end]
        y_train = y.iloc[0:train_end]
        
        X_test = X.iloc[train_end:test_end]
        y_test = y.iloc[train_end:test_end]
        
        yield X_train, X_test, y_train, y_test
