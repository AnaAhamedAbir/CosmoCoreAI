import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
import warnings

warnings.filterwarnings("ignore")

# Import the PyTorch architectures from Crypto ML layer
from app.services.ml_architectures import SimpleLSTM, SimpleGRU, CNN1D, DeepLOB, TimeSeriesTransformer

class PyTorchModelWrapper:
    """
    Scikit-Learn compatible wrapper for native PyTorch Deep Learning models.
    Converts 2D tabular data into 3D sequences (batch, seq_len, features) for time-series NNs.
    """
    def __init__(self, architecture_class, seq_len=10, epochs=10, batch_size=32, lr=1e-3, **kwargs):
        self.architecture_class = architecture_class
        self.seq_len = seq_len
        self.epochs = epochs
        self.batch_size = batch_size
        self.lr = lr
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.model = None

    def _create_sequences(self, X: np.ndarray, y: np.ndarray = None):
        """Convert 2D array into 3D sequences using sliding window"""
        Xs, ys = [], []
        for i in range(len(X) - self.seq_len):
            Xs.append(X[i:(i + self.seq_len)])
            if y is not None:
                ys.append(y[i + self.seq_len])
        if y is not None:
            return np.array(Xs), np.array(ys)
        return np.array(Xs)

    def fit(self, X: pd.DataFrame, y: pd.Series):
        X_vals = X.values.astype(np.float32)
        y_vals = y.values.astype(np.float32)

        if len(X_vals) <= self.seq_len:
            print(f"Warning: Not enough data for seq_len {self.seq_len}. Skipping training.")
            self.model = "dummy"
            return self

        X_seq, y_seq = self._create_sequences(X_vals, y_vals)
        
        # Instantiate actual model dynamically
        input_size = X_seq.shape[2]
        if self.architecture_class in [SimpleLSTM, SimpleGRU]:
            self.model = self.architecture_class(input_size=input_size, hidden_size=64, num_layers=2, output_size=1)
        elif self.architecture_class in [CNN1D, DeepLOB, TimeSeriesTransformer]:
            self.model = self.architecture_class(input_size=input_size, output_size=1)
        else:
            # Fallback placeholder for Auto-Encoder, Liquid-NN, etc if not defined in architectures
            self.model = SimpleLSTM(input_size=input_size, hidden_size=64, num_layers=2, output_size=1)

        self.model = self.model.to(self.device)
        
        # DataLoader
        dataset = TensorDataset(torch.tensor(X_seq), torch.tensor(y_seq).unsqueeze(1))
        loader = DataLoader(dataset, batch_size=self.batch_size, shuffle=True)

        criterion = nn.BCEWithLogitsLoss()
        optimizer = optim.Adam(self.model.parameters(), lr=self.lr)

        self.model.train()
        for epoch in range(self.epochs):
            for batch_X, batch_y in loader:
                batch_X, batch_y = batch_X.to(self.device), batch_y.to(self.device)
                optimizer.zero_grad()
                outputs = self.model(batch_X)
                loss = criterion(outputs, batch_y)
                loss.backward()
                optimizer.step()

        return self

    def predict(self, X: pd.DataFrame):
        if self.model == "dummy":
            return np.random.choice([0, 1], size=len(X))
            
        X_vals = X.values.astype(np.float32)
        
        # Handle padding for the first `seq_len` steps to keep output array same size as input
        if len(X_vals) <= self.seq_len:
            return np.random.choice([0, 1], size=len(X))
            
        X_seq = self._create_sequences(X_vals)
        dataset = TensorDataset(torch.tensor(X_seq))
        loader = DataLoader(dataset, batch_size=self.batch_size, shuffle=False)

        self.model.eval()
        preds = []
        with torch.no_grad():
            for (batch_X,) in loader:
                batch_X = batch_X.to(self.device)
                outputs = self.model(batch_X)
                probs = torch.sigmoid(outputs)
                preds.extend((probs > 0.5).int().cpu().numpy().flatten())
                
        # Pad beginning
        padding = [preds[0]] * self.seq_len
        full_preds = padding + preds
        return np.array(full_preds)

    def score(self, X: pd.DataFrame, y: pd.Series):
        preds = self.predict(X)
        return np.mean(preds == y.values)


# Explicit Wrappers for the Factory
class ForexLSTM(PyTorchModelWrapper):
    def __init__(self, **kwargs):
        super().__init__(architecture_class=SimpleLSTM, **kwargs)

class ForexGRU(PyTorchModelWrapper):
    def __init__(self, **kwargs):
        super().__init__(architecture_class=SimpleGRU, **kwargs)

class ForexTCN(PyTorchModelWrapper):
    def __init__(self, **kwargs):
        # Using CNN1D as a TCN stand-in if TCN is missing from architectures
        super().__init__(architecture_class=CNN1D, **kwargs)

class ForexCNN1D(PyTorchModelWrapper):
    def __init__(self, **kwargs):
        super().__init__(architecture_class=CNN1D, **kwargs)

class ForexDeepLOB(PyTorchModelWrapper):
    def __init__(self, **kwargs):
        super().__init__(architecture_class=DeepLOB, **kwargs)

class ForexTransformer(PyTorchModelWrapper):
    def __init__(self, **kwargs):
        super().__init__(architecture_class=TimeSeriesTransformer, **kwargs)
        
class ForexAutoEncoder(PyTorchModelWrapper):
    def __init__(self, **kwargs):
        # AutoEncoders usually require custom loss. Using LSTM fallback for now as specified in architectures.
        super().__init__(architecture_class=SimpleLSTM, **kwargs)
        
class ForexLiquidNN(PyTorchModelWrapper):
    def __init__(self, **kwargs):
        super().__init__(architecture_class=SimpleLSTM, **kwargs)
