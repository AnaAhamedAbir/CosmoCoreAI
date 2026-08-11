import os
import sys
import importlib.util

def check_file_exists(path):
    if not os.path.exists(path):
        print(f"[FAIL] File missing: {path}")
        return False
    print(f"[OK] File exists: {path}")
    return True

def check_python_syntax(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            source = f.read()
        compile(source, path, 'exec')
        print(f"[OK] Syntax OK: {path}")
        return True
    except SyntaxError as e:
        print(f"[FAIL] Syntax Error in {path}: {e}")
        return False

def check_frontend_content(path, keywords):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
            for keyword in keywords:
                if keyword not in content:
                    print(f"[FAIL] Keyword missing in {path}: {keyword}")
                    return False
        print(f"[OK] Frontend Content OK: {path}")
        return True
    except Exception as e:
        print(f"[FAIL] Error reading {path}: {e}")
        return False

def run_verification():
    print("--- Starting Verification for ML Prediction Cloud Feature ---")
    
    backend_base = r"d:\CosmoQuantAI\backend\app"
    frontend_base = r"d:\CosmoQuantAI\frontend\src"
    
    # 1. Check live_inference_engine.py
    engine_path = os.path.join(backend_base, "services", "live_inference_engine.py")
    if check_file_exists(engine_path):
        check_python_syntax(engine_path)
        
    # 2. Check ml_models.py
    api_path = os.path.join(backend_base, "api", "v1", "endpoints", "ml_models.py")
    if check_file_exists(api_path):
        check_python_syntax(api_path)
        
    # 3. Check HeatmapSubNav.tsx
    subnav_path = os.path.join(frontend_base, "components", "features", "market", "HeatmapSubNav.tsx")
    if check_file_exists(subnav_path):
        check_frontend_content(subnav_path, ["MLIndicatorsDropdown", "activeMLModelId"])
        
    # 4. Check MLIndicatorsDropdown.tsx
    dropdown_path = os.path.join(frontend_base, "components", "features", "market", "MLIndicatorsDropdown.tsx")
    if check_file_exists(dropdown_path):
        check_frontend_content(dropdown_path, ["apiClient.get('/ml-models?mode=advanced_sl_tp')", "onSelectModel"])
        
    # 5. Check MLPredictionCloudRenderer.tsx
    renderer_path = os.path.join(frontend_base, "components", "features", "market", "AdvancedMetrics", "MLPredictionCloudRenderer.tsx")
    if check_file_exists(renderer_path):
        check_frontend_content(renderer_path, ["createPriceLine", "AI_PREDICTION"])
        
    # 6. Check OrderFlowHeatmap.tsx
    heatmap_path = os.path.join(frontend_base, "pages", "app", "OrderFlowHeatmap.tsx")
    if check_file_exists(heatmap_path):
        check_frontend_content(heatmap_path, ["MLPredictionCloudRenderer", "activeMLModelId"])
        
    print("--- Verification Complete ---")

if __name__ == "__main__":
    run_verification()
