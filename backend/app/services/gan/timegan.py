import torch
import torch.nn as nn
from .models import Embedder, Recovery, Generator, Discriminator, Supervisor

class TimeGANWrapper(nn.Module):
    """
    A unified wrapper for the TimeGAN components, designed for CPU optimization.
    """
    def __init__(self, input_dim: int, hidden_dim: int = 24, z_dim: int = 24, num_layers: int = 1):
        super(TimeGANWrapper, self).__init__()
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.z_dim = z_dim
        self.num_layers = num_layers
        
        # Initialize Core Modules
        self.embedder = Embedder(input_dim=self.input_dim, hidden_dim=self.hidden_dim, num_layers=self.num_layers)
        self.recovery = Recovery(hidden_dim=self.hidden_dim, output_dim=self.input_dim, num_layers=self.num_layers)
        self.generator = Generator(z_dim=self.z_dim, hidden_dim=self.hidden_dim, num_layers=self.num_layers)
        self.discriminator = Discriminator(hidden_dim=self.hidden_dim, num_layers=self.num_layers)
        self.supervisor = Supervisor(hidden_dim=self.hidden_dim, num_layers=self.num_layers)

    def forward(self, x):
        """
        Forward pass is not typically used as a single block for TimeGAN since 
        the training involves multiple separate loss functions (reconstruction, 
        supervised, generator, discriminator). 
        """
        pass
        
    def generate(self, batch_size: int, seq_len: int, device: torch.device):
        """
        Generates synthetic time-series data.
        """
        self.generator.eval()
        self.supervisor.eval()
        self.recovery.eval()
        
        with torch.no_grad():
            # 1. Random noise
            Z = torch.rand((batch_size, seq_len, self.z_dim), device=device)
            # 2. Generate latent sequence
            E_hat = self.generator(Z)
            # 3. Supervise latent sequence
            H_hat = self.supervisor(E_hat)
            # 4. Recover to original feature space
            X_hat = self.recovery(H_hat)
            
        return X_hat
