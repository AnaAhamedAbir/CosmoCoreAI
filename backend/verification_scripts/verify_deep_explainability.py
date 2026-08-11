import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import numpy as np
import torch
import torch.nn as nn
from app.services.ml_architectures import SimpleLSTM
from app.services.ml_deep_explainability import generate_deep_shap_summary

def test_deep_explainability():
    print("Testing Deep Model Explainability (SHAP)...")
    
    # Create dummy data
    np.random.seed(42)
    torch.manual_seed(42)
    
    num_samples = 150
    num_features = 10
    X_test = np.random.randn(num_samples, num_features)
    feature_names = [f"Feature_{i}" for i in range(num_features)]
    
    # Initialize a PyTorch model
    model = SimpleLSTM(input_size=num_features, hidden_size=16, num_layers=1, output_size=1)
    
    class WrappedModel(nn.Module):
        def __init__(self, base_model):
            super().__init__()
            self.base = base_model
        def forward(self, x):
            x = x.unsqueeze(1) # (batch, 1, features)
            return self.base(x)
            
    wrapped_model = WrappedModel(model)
    wrapped_model.eval()

    try:
        summary = generate_deep_shap_summary(wrapped_model, X_test, feature_names, is_classification=True)
        print("SHAP Summary generated successfully!")
        for item in summary:
            print(item)
        assert len(summary) > 0, "Summary should not be empty"
        print("Verification PASSED.")
    except Exception as e:
        print(f"Verification FAILED: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_deep_explainability()
