import optuna
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import cross_val_score

def run_optuna_study(X: pd.DataFrame, y: pd.Series, algorithm: str, n_trials: int = 50) -> dict:
    """
    Runs an Optuna study to find the best hyperparameters for the selected algorithm.
    
    Args:
        X: Training features
        y: Training targets
        algorithm: Name of the algorithm (e.g. 'Random Forest')
        n_trials: Number of optimization trials
        
    Returns:
        dict: Best hyperparameters found
    """
    
    def objective(trial):
        if algorithm == 'Random Forest':
            n_estimators = trial.suggest_int('n_estimators', 50, 500, step=50)
            max_depth = trial.suggest_int('max_depth', 3, 20)
            min_samples_split = trial.suggest_int('min_samples_split', 2, 20)
            min_samples_leaf = trial.suggest_int('min_samples_leaf', 1, 10)
            
            model = RandomForestClassifier(
                n_estimators=n_estimators,
                max_depth=max_depth,
                min_samples_split=min_samples_split,
                min_samples_leaf=min_samples_leaf,
                random_state=42,
                n_jobs=-1
            )
        else:
            # Fallback to default RF if algorithm is not fully implemented in AutoML yet
            n_estimators = trial.suggest_int('n_estimators', 50, 200, step=50)
            model = RandomForestClassifier(n_estimators=n_estimators, random_state=42)
            
        # Use simple 3-fold CV for speed during Optuna search
        score = cross_val_score(model, X, y, cv=3, scoring='accuracy').mean()
        return score

    # Suppress optuna logging output to keep server logs clean
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    
    study = optuna.create_study(direction='maximize')
    # Limit trials artificially if dataset is large to prevent timeouts
    study.optimize(objective, n_trials=min(n_trials, 50))
    
    print(f"Optuna Study completed. Best Accuracy: {study.best_value*100:.2f}%")
    return study.best_params
