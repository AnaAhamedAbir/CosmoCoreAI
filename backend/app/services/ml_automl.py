import optuna
from sklearn.metrics import accuracy_score, mean_squared_error
import numpy as np

def run_optuna_study(algorithm: str, X_train, y_train, X_val, y_val, is_classification: bool, n_trials: int = 20, add_log=None):
    """
    Runs an Optuna hyperparameter optimization study for the specified algorithm.
    Returns a dictionary of the best hyperparameters.
    """
    if add_log:
        add_log(f"🔍 Starting AutoML (Optuna) for {algorithm} with {n_trials} trials...")

    def objective(trial):
        if algorithm == "Random Forest":
            if is_classification:
                from sklearn.ensemble import RandomForestClassifier
                n_estimators = trial.suggest_int('n_estimators', 50, 300)
                max_depth = trial.suggest_int('max_depth', 3, 20)
                min_samples_split = trial.suggest_int('min_samples_split', 2, 10)
                model = RandomForestClassifier(
                    n_estimators=n_estimators, 
                    max_depth=max_depth, 
                    min_samples_split=min_samples_split,
                    random_state=42
                )
            else:
                from sklearn.ensemble import RandomForestRegressor
                n_estimators = trial.suggest_int('n_estimators', 50, 300)
                max_depth = trial.suggest_int('max_depth', 3, 20)
                min_samples_split = trial.suggest_int('min_samples_split', 2, 10)
                model = RandomForestRegressor(
                    n_estimators=n_estimators, 
                    max_depth=max_depth, 
                    min_samples_split=min_samples_split,
                    random_state=42
                )
                
            model.fit(X_train, y_train)
            preds = model.predict(X_val)
            
        elif algorithm == "XGBoost":
            if is_classification:
                from xgboost import XGBClassifier
                n_estimators = trial.suggest_int('n_estimators', 50, 300)
                max_depth = trial.suggest_int('max_depth', 3, 10)
                learning_rate = trial.suggest_float('learning_rate', 1e-3, 0.3, log=True)
                model = XGBClassifier(
                    n_estimators=n_estimators, 
                    max_depth=max_depth, 
                    learning_rate=learning_rate,
                    random_state=42
                )
            else:
                from xgboost import XGBRegressor
                n_estimators = trial.suggest_int('n_estimators', 50, 300)
                max_depth = trial.suggest_int('max_depth', 3, 10)
                learning_rate = trial.suggest_float('learning_rate', 1e-3, 0.3, log=True)
                model = XGBRegressor(
                    n_estimators=n_estimators, 
                    max_depth=max_depth, 
                    learning_rate=learning_rate,
                    random_state=42
                )
            
            # Using eval_set to prevent overfitting
            model.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)
            preds = model.predict(X_val)
            
        elif algorithm == "LightGBM":
            if is_classification:
                import lightgbm as lgb
                n_estimators = trial.suggest_int('n_estimators', 50, 300)
                max_depth = trial.suggest_int('max_depth', 3, 15)
                learning_rate = trial.suggest_float('learning_rate', 1e-3, 0.3, log=True)
                num_leaves = trial.suggest_int('num_leaves', 20, 100)
                model = lgb.LGBMClassifier(
                    n_estimators=n_estimators, 
                    max_depth=max_depth, 
                    learning_rate=learning_rate,
                    num_leaves=num_leaves,
                    random_state=42,
                    verbose=-1
                )
            else:
                import lightgbm as lgb
                n_estimators = trial.suggest_int('n_estimators', 50, 300)
                max_depth = trial.suggest_int('max_depth', 3, 15)
                learning_rate = trial.suggest_float('learning_rate', 1e-3, 0.3, log=True)
                num_leaves = trial.suggest_int('num_leaves', 20, 100)
                model = lgb.LGBMRegressor(
                    n_estimators=n_estimators, 
                    max_depth=max_depth, 
                    learning_rate=learning_rate,
                    num_leaves=num_leaves,
                    random_state=42,
                    verbose=-1
                )
                
            model.fit(X_train, y_train, eval_set=[(X_val, y_val)])
            preds = model.predict(X_val)
            
        elif algorithm == "CatBoost":
            if is_classification:
                import catboost as cb
                iterations = trial.suggest_int('iterations', 50, 300)
                depth = trial.suggest_int('depth', 3, 10)
                learning_rate = trial.suggest_float('learning_rate', 1e-3, 0.3, log=True)
                model = cb.CatBoostClassifier(
                    iterations=iterations, 
                    depth=depth, 
                    learning_rate=learning_rate,
                    random_seed=42,
                    verbose=False
                )
            else:
                import catboost as cb
                iterations = trial.suggest_int('iterations', 50, 300)
                depth = trial.suggest_int('depth', 3, 10)
                learning_rate = trial.suggest_float('learning_rate', 1e-3, 0.3, log=True)
                model = cb.CatBoostRegressor(
                    iterations=iterations, 
                    depth=depth, 
                    learning_rate=learning_rate,
                    random_seed=42,
                    verbose=False
                )
                
            model.fit(X_train, y_train, eval_set=(X_val, y_val))
            preds = model.predict(X_val)
        else:
            raise ValueError(f"AutoML is not yet supported for {algorithm}")

        # Metric computation
        if is_classification:
            return accuracy_score(y_val, np.round(preds))
        else:
            return mean_squared_error(y_val, preds)

    direction = 'maximize' if is_classification else 'minimize'
    study = optuna.create_study(direction=direction)
    
    # We catch exceptions to not crash if a single trial fails
    try:
        study.optimize(objective, n_trials=n_trials, n_jobs=1)  # single threaded to avoid memory spikes
        best_params = study.best_params
        
        if add_log:
            best_val = study.best_value
            metric_name = 'Accuracy' if is_classification else 'MSE'
            add_log(f"✅ AutoML Complete. Best {metric_name}: {best_val:.4f}")
            add_log(f"   Best Params: {best_params}")
            
        return best_params
    except Exception as e:
        if add_log:
            add_log(f"⚠️ AutoML optimization failed: {e}. Falling back to default params.")
        return {}
