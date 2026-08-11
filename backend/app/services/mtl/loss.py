import torch
import torch.nn as nn

class MultiTaskLoss(nn.Module):
    """
    Multi-Task Learning Loss with Homoscedastic Uncertainty Weighting.
    Combines Binary Cross Entropy (BCE) for classification and Mean Squared Error (MSE) for regression.
    """
    def __init__(self):
        super(MultiTaskLoss, self).__init__()
        # Learnable parameters for uncertainty weighting
        # We initialize them to 0 (which means exp(0) = 1)
        self.log_var_class = nn.Parameter(torch.zeros(1))
        self.log_var_reg = nn.Parameter(torch.zeros(1))
        
        self.bce = nn.BCEWithLogitsLoss()
        self.mse = nn.MSELoss()
        
    def forward(self, pred_c, pred_r, true_c, true_r):
        # Calculate individual losses
        loss_c = self.bce(pred_c, true_c)
        loss_r = self.mse(pred_r, true_r)
        
        # Apply uncertainty weighting
        # L = sum( 1/(2*sigma^2) * Loss_i + log(sigma) )
        # Using log_var (which is log(sigma^2)) for numerical stability:
        # 1/(2*exp(log_var)) * Loss + 0.5 * log_var
        
        precision_c = torch.exp(-self.log_var_class)
        precision_r = torch.exp(-self.log_var_reg)
        
        weighted_loss_c = precision_c * loss_c + 0.5 * self.log_var_class
        weighted_loss_r = precision_r * loss_r + 0.5 * self.log_var_reg
        
        return weighted_loss_c + weighted_loss_r
