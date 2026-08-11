import numpy as np
import pandas as pd
import warnings

warnings.filterwarnings("ignore")

class ForexVolatilityModel:
    """Wrapper for ARCH/GARCH Volatility Models"""
    def __init__(self, vol='Garch', p=1, q=1, **kwargs):
        self.vol = vol # 'Garch' or 'EGARCH'
        self.p = p
        self.q = q
        self.model_fit = None
        
    def fit(self, X: pd.DataFrame, y: pd.Series):
        try:
            from arch import arch_model
            # Volatility models typically fit on returns, not binary targets
            # Since our pipeline provides a binary target `y`, we will instead fit GARCH on the first feature
            # Assuming first feature is some form of return or price difference.
            # In a real implementation, we would extract 'close' returns.
            returns = X.iloc[:, 0].values * 100 # Rescaling for GARCH convergence
            
            am = arch_model(returns, vol=self.vol, p=self.p, q=self.q)
            self.model_fit = am.fit(disp='off')
        except ImportError:
            print(f"Warning: arch not installed. Using dummy {self.vol}.")
            self.model_fit = "dummy"
            
        return self

    def predict(self, X: pd.DataFrame):
        if self.model_fit == "dummy":
            return np.random.choice([0, 1], size=len(X))
            
        # Forecast volatility
        forecasts = self.model_fit.forecast(horizon=len(X), reindex=False, method='simulation')
        vol_pred = np.sqrt(forecasts.variance.values[-1, :])
        
        # This is a hack for classification: if volatility increases, output 1 (long volatility)
        # For a true trading signal, GARCH would be a feature, not the final predictor.
        mean_vol = np.mean(vol_pred)
        return (vol_pred > mean_vol).astype(int)

    def score(self, X: pd.DataFrame, y: pd.Series):
        preds = self.predict(X)
        return np.mean(preds == y.values)


class ForexGARCHModel(ForexVolatilityModel):
    def __init__(self, **kwargs):
        super().__init__(vol='Garch', **kwargs)


class ForexEGARCHModel(ForexVolatilityModel):
    def __init__(self, **kwargs):
        super().__init__(vol='EGARCH', **kwargs)
