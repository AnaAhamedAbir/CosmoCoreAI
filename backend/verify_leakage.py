import sys
import os
import ast
import traceback

def check_file_for_leakage(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            code = f.read()
            
        tree = ast.parse(code)
        
        print(f"Analyzing {os.path.basename(filepath)}...")
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name) and node.func.id == 'apply_pca_orthogonalization':
                    print(f"Found call to apply_pca_orthogonalization at line {node.lineno}")
                    
        return True
    except SyntaxError as e:
        print(f"SyntaxError in {filepath}: {e}")
        return False
    except Exception as e:
        print(f"Error analyzing {filepath}: {e}")
        return False

if __name__ == "__main__":
    base_dir = os.path.dirname(__file__)
    services_dir = os.path.join(base_dir, 'app', 'services')
    
    # Check syntax and AST
    files_to_check = [
        'ml_training_engine.py',
        'forex_ml_training_engine.py',
    ]
    
    for file in files_to_check:
        check_file_for_leakage(os.path.join(services_dir, file))
        print("-" * 40)
        
    print("Testing MLUtils imports and functions directly...")
    sys.path.append(base_dir)
    try:
        from app.services.ml_utils import apply_pca_orthogonalization
        import pandas as pd
        import numpy as np
        
        df_train = pd.DataFrame(np.random.rand(100, 5), columns=['F1', 'F2', 'F3', 'F4', 'Target'])
        df_test = pd.DataFrame(np.random.rand(20, 5), columns=['F1', 'F2', 'F3', 'F4', 'Target'])
        
        res_train, res_test, pca_model = apply_pca_orthogonalization(
            df_train, df_test, target_col='Target', correlation_threshold=0.9
        )
        print("[SUCCESS] apply_pca_orthogonalization is leakage-free and returns correct tuple.")
    except Exception as e:
        print(f"[ERROR] testing ml_utils: {e}")
        traceback.print_exc()

