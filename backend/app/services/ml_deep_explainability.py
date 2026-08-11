import numpy as np
import pandas as pd
import traceback

def generate_deep_shap_summary(model, X_test, feature_names, is_classification=True):
    """
    Generates SHAP summary for PyTorch Deep Learning models.
    Uses shap.DeepExplainer or shap.GradientExplainer.
    """
    try:
        import torch
        import shap
        
        # We only need a small sample for background and testing to keep it fast
        bg_size = min(50, len(X_test))
        test_size = min(20, len(X_test))
        
        X_bg_np = X_test[:bg_size]
        X_test_np = X_test[bg_size:bg_size+test_size] if len(X_test) > bg_size else X_test[:test_size]
        
        # Determine device
        device = torch.device('cuda' if torch.cuda.is_available() and next(model.parameters()).is_cuda else 'cpu')
        
        X_bg_tensor = torch.tensor(X_bg_np, dtype=torch.float32).to(device)
        X_test_tensor = torch.tensor(X_test_np, dtype=torch.float32).to(device)
        
        # Handle 3D tensors expected by some models (like CNN1D or Transformers)
        # ml_architectures uses x.unsqueeze(1) inside forward for these, but let's be safe
        # shap.DeepExplainer handles the forward pass directly, so as long as X_test_tensor matches
        # what the model expects, it's fine. 
        
        try:
            # shap.DeepExplainer has issues with some PyTorch 2.x versions, GradientExplainer is a robust fallback
            explainer = shap.DeepExplainer(model, X_bg_tensor)
            shap_values = explainer.shap_values(X_test_tensor)
        except Exception as deep_err:
            print(f"[DeepExplainer Failed] {deep_err}. Falling back to GradientExplainer.")
            explainer = shap.GradientExplainer(model, X_bg_tensor)
            shap_values = explainer.shap_values(X_test_tensor)

        # Parse SHAP values correctly depending on output shape
        if isinstance(shap_values, list):
            # Binary classification usually returns a list of length 2
            idx = 1 if len(shap_values) > 1 else 0
            sv = shap_values[idx]
        else:
            sv = shap_values
            
        # Ensure it's numpy
        if torch.is_tensor(sv):
            sv = sv.cpu().detach().numpy()
        elif isinstance(sv, np.ndarray):
            pass
        else:
            sv = np.array(sv)

        # Check dimensions
        if len(sv.shape) == 3:
            # (batch, seq_len, features) or (batch, classes, features)
            sv = np.mean(sv, axis=1)

        shap_summary = []
        top_features = feature_names[:5] # Default to first 5
        
        # Calculate mean absolute shap value for feature importance sorting
        if sv.shape[1] == len(feature_names):
            mean_abs_shap = np.mean(np.abs(sv), axis=0)
            top_indices = np.argsort(mean_abs_shap)[::-1][:5]
            top_features = [feature_names[i] for i in top_indices]
            
        for feature in top_features:
            if feature in feature_names:
                f_idx = feature_names.index(feature)
                f_shap = sv[:, f_idx]
                f_val = X_test_np[:, f_idx]
                
                val_min, val_max = np.min(f_val), np.max(f_val)
                for i in range(len(f_shap)):
                    impact = float(f_shap[i])
                    is_high = False
                    if val_max > val_min:
                        is_high = ((f_val[i] - val_min) / (val_max - val_min)) > 0.5
                        
                    shap_summary.append({
                        "feature": feature,
                        "impact": impact,
                        "value": "High" if is_high else "Low"
                    })
                    
        return shap_summary

    except Exception as e:
        print(f"Failed to generate Deep SHAP summary: {e}")
        traceback.print_exc()
        return []
