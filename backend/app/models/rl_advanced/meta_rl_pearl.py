import torch
import torch.nn as nn

class PEARLMetaLearner(nn.Module):
    """
    PEARL (Probabilistic Embeddings for Actor-Critic RL)
    Designed for rapid adaptation to new market regimes (e.g., Bull to Bear shift).
    Uses a context encoder to infer the current market state from a few recent samples,
    which conditions the policy network.
    """
    def __init__(self, obs_dim: int, action_dim: int, latent_dim: int = 32, hidden_dim: int = 128):
        super().__init__()
        self.obs_dim = obs_dim
        self.action_dim = action_dim
        self.latent_dim = latent_dim
        
        # Context Encoder: Maps (state, action, reward, next_state) to latent Gaussian distribution
        # In financial context, 'reward' can be recent trade outcomes or PnL
        context_dim = obs_dim * 2 + action_dim + 1
        self.context_encoder = nn.Sequential(
            nn.Linear(context_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, latent_dim * 2) # Outputs mu and logvar
        )
        
        # Conditioned Policy: Takes current state and inferred latent context
        self.policy_net = nn.Sequential(
            nn.Linear(obs_dim + latent_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, action_dim)
        )

    def infer_posterior(self, context: torch.Tensor):
        """
        Infer the latent distribution over the current market regime.
        context shape: (batch, num_samples, context_dim)
        """
        params = self.context_encoder(context)
        mu, logvar = torch.chunk(params, 2, dim=-1)
        
        # Product of Gaussians over samples
        var = torch.exp(logvar)
        precision = 1.0 / (var + 1e-8)
        
        mu_product = torch.sum(mu * precision, dim=1) / torch.sum(precision, dim=1)
        var_product = 1.0 / torch.sum(precision, dim=1)
        
        return mu_product, var_product

    def sample_z(self, mu: torch.Tensor, var: torch.Tensor):
        """Reparameterization trick"""
        std = torch.sqrt(var)
        eps = torch.randn_like(std)
        return mu + eps * std

    def forward(self, obs: torch.Tensor, context: torch.Tensor):
        mu, var = self.infer_posterior(context)
        z = self.sample_z(mu, var)
        # Expand z to match obs batch size if needed
        policy_input = torch.cat([obs, z], dim=-1)
        return self.policy_net(policy_input)
