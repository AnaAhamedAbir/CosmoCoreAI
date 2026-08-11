import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset
import torch.optim as optim
from .timegan import TimeGANWrapper
import numpy as np

def train_timegan(X_train: np.ndarray, 
                  input_dim: int, 
                  seq_len: int = 20, 
                  batch_size: int = 64, 
                  epochs: int = 10,  # Kept small for CPU Live Generation
                  hidden_dim: int = 24):
    """
    Trains the TimeGAN model using a memory-optimized batched approach.
    X_train should be shape (num_samples, seq_len, input_dim).
    If X_train is 2D (num_samples, input_dim), we'll window it first.
    """
    device = torch.device('cpu')  # Optimized for Ryzen iGPU/CPU environments
    
    # 1. Windowing if necessary
    if len(X_train.shape) == 2:
        num_samples = len(X_train) - seq_len + 1
        # Strided windowing to save RAM, avoiding huge allocations
        windows = np.lib.stride_tricks.sliding_window_view(X_train, window_shape=(seq_len, input_dim))
        windows = windows.squeeze(1) # shape: (num_samples, seq_len, input_dim)
        X_train_tensor = torch.tensor(windows, dtype=torch.float32)
    else:
        X_train_tensor = torch.tensor(X_train, dtype=torch.float32)
        
    dataset = TensorDataset(X_train_tensor)
    dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=True, drop_last=True)
    
    # 2. Initialize Model
    model = TimeGANWrapper(input_dim=input_dim, hidden_dim=hidden_dim, z_dim=hidden_dim).to(device)
    
    # 3. Optimizers
    opt_e0 = optim.Adam(list(model.embedder.parameters()) + list(model.recovery.parameters()), lr=0.001)
    opt_gs = optim.Adam(list(model.generator.parameters()) + list(model.supervisor.parameters()), lr=0.001)
    opt_d = optim.Adam(model.discriminator.parameters(), lr=0.001)
    
    criterion_mse = nn.MSELoss()
    criterion_bce = nn.BCELoss()
    
    # Note: A full Hedge-Fund level TimeGAN has 3 phases (Autoencoder, Supervision, Joint Training)
    # For live CPU generation where speed is critical, we use a simplified joint-training loop
    # that ensures stable gradients without taking hours.
    
    model.train()
    
    for epoch in range(epochs):
        for batch_idx, (X_mb,) in enumerate(dataloader):
            X_mb = X_mb.to(device)
            bs = X_mb.size(0)
            
            # --- 1. Train Embedder & Recovery (Autoencoder) ---
            opt_e0.zero_grad()
            H = model.embedder(X_mb)
            X_tilde = model.recovery(H)
            loss_e0 = criterion_mse(X_mb, X_tilde)
            loss_e0.backward()
            opt_e0.step()
            
            # --- 2. Train Generator & Supervisor ---
            opt_gs.zero_grad()
            Z = torch.rand((bs, seq_len, hidden_dim), device=device)
            H = model.embedder(X_mb).detach()
            
            E_hat = model.generator(Z)
            H_hat = model.supervisor(E_hat)
            H_hat_supervise = model.supervisor(H)
            
            # Generator wants Discriminator to predict 1
            Y_fake = model.discriminator(H_hat)
            loss_g_bce = criterion_bce(Y_fake, torch.ones_like(Y_fake))
            loss_s_mse = criterion_mse(H[:, 1:, :], H_hat_supervise[:, :-1, :]) # Next step prediction
            
            loss_gs = loss_g_bce + 10 * loss_s_mse 
            loss_gs.backward()
            opt_gs.step()
            
            # --- 3. Train Discriminator ---
            opt_d.zero_grad()
            H = model.embedder(X_mb).detach()
            
            Z = torch.rand((bs, seq_len, hidden_dim), device=device)
            E_hat = model.generator(Z).detach()
            H_hat = model.supervisor(E_hat).detach()
            
            Y_real = model.discriminator(H)
            Y_fake = model.discriminator(H_hat)
            
            loss_d_real = criterion_bce(Y_real, torch.ones_like(Y_real))
            loss_d_fake = criterion_bce(Y_fake, torch.zeros_like(Y_fake))
            loss_d = loss_d_real + loss_d_fake
            loss_d.backward()
            opt_d.step()
            
    # Return trained model
    return model
