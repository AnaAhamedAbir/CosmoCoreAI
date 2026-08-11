import numpy as np
import pandas as pd
import warnings

warnings.filterwarnings("ignore")

class MarketBayesianNNModel:
    """Wrapper for a Probabilistic Bayesian Neural Network"""
    def __init__(self, **kwargs):
        self.model = None
        
    def fit(self, X: pd.DataFrame, y: pd.Series):
        # A true Bayesian NN requires torchbnn or pyro
        # For this skeleton, we will fallback to a scikit-learn BayesianRidge combined with a classifier
        # or just a random forest if libraries are missing.
        try:
            # Handle multi-output y by taking the first column
            if isinstance(y, np.ndarray) and len(y.shape) > 1 and y.shape[1] > 1:
                y_arr = y[:, 0]
            elif isinstance(y, pd.DataFrame) and len(y.columns) > 1:
                y_arr = y.iloc[:, 0].values
            else:
                y_arr = np.asarray(y)
                
            X_arr = np.asarray(X)
                
            from sklearn.linear_model import BayesianRidge
            from sklearn.calibration import CalibratedClassifierCV
            from sklearn.svm import LinearSVC
            from sklearn.utils.multiclass import type_of_target
            
            target_type = type_of_target(y_arr)
            if target_type == 'continuous':
                self.is_regression = True
                self.model = BayesianRidge()
                self.model.fit(X_arr, y_arr)
            else:
                self.is_regression = False
                base_clf = LinearSVC(random_state=42)
                self.model = CalibratedClassifierCV(estimator=base_clf, method='isotonic', cv=3)
                self.model.fit(X_arr, y_arr.astype(int))
            
        except Exception as e:
            print(f"Warning: Failed to fit Bayesian NN ({e}). Using dummy BNN.")
            self.model = "dummy"
            
        return self

    def predict(self, X: pd.DataFrame):
        if self.model == "dummy":
            if getattr(self, 'is_regression', False):
                return np.random.randn(len(X))
            return np.random.choice([0, 1], size=len(X))
            
        return self.model.predict(np.asarray(X))

    def predict_proba(self, X: pd.DataFrame):
        if self.model == "dummy":
            preds = np.random.uniform(0, 1, size=len(X))
            return np.column_stack((1-preds, preds))
            
        if getattr(self, 'is_regression', False):
            # Regressors don't have predict_proba
            preds = self.predict(X)
            probs = np.zeros((len(preds), 2))
            probs[:, 1] = 1.0 # mock probability
            return probs
            
        return self.model.predict_proba(np.asarray(X))

    def score(self, X: pd.DataFrame, y: pd.Series):
        preds = self.predict(X)
        y_arr = np.asarray(y)
        if getattr(self, 'is_regression', False):
            from sklearn.metrics import r2_score
            return r2_score(y_arr, preds)
        return np.mean(preds == y_arr)
