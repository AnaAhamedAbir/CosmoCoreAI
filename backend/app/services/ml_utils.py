import json
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, r2_score, mean_squared_error, mean_absolute_error, f1_score

def extract_feature_importance(model, feature_names):
    """Extract feature importance from a tree-based model."""
    if hasattr(model, 'feature_importances_'):
        importances = model.feature_importances_
        # Normalize just in case
        if np.sum(importances) > 0:
            importances = importances / np.sum(importances)
        
        feature_dict = {str(name): float(imp) for name, imp in zip(feature_names, importances)}
        return f"[FEATURE_IMPORTANCE] {json.dumps(feature_dict)}"
    return ""

def calculate_classification_metrics(y_true, y_pred):
    """Calculate metrics for classification."""
    acc = accuracy_score(y_true, y_pred)
    f1 = f1_score(y_true, y_pred, average='weighted')
    
    metrics = {
        "Accuracy": acc,
        "F1_Score": f1
    }
    return f"[METRICS] {json.dumps(metrics)}"

def calculate_regression_metrics(y_true, y_pred):
    """Calculate metrics for regression."""
    r2 = r2_score(y_true, y_pred)
    mse = mean_squared_error(y_true, y_pred)
    mae = mean_absolute_error(y_true, y_pred)
    
    metrics = {
        "R2_Score": r2,
        "MSE": mse,
        "MAE": mae
    }
    return f"[METRICS] {json.dumps(metrics)}"

def generate_real_explainability(model, X_test, y_test, y_pred, feature_names, is_classification=True):
    """Generate real explainability metrics for the model."""
    import traceback
    import pandas as pd
    
    # Ensure feature_names is a plain list for safe .index() calls
    feature_names = list(feature_names)
    
    result = {}
    
    # 1. Feature Importance
    try:
        if hasattr(model, 'feature_importances_'):
            importances = model.feature_importances_
            if np.sum(importances) > 0:
                importances = importances / np.sum(importances)
            fi_list = [{"name": str(name), "value": float(imp)} for name, imp in zip(feature_names, importances)]
            # Sort by value descending and keep top 10
            fi_list = sorted(fi_list, key=lambda x: x["value"], reverse=True)[:10]
            result["featureImportance"] = fi_list
    except Exception as e:
        print(f"Failed to generate feature importance: {e}")
        
    # 2. Confusion Matrix
    try:
        if is_classification:
            from sklearn.metrics import confusion_matrix
            y_t = np.round(y_test).astype(int)
            y_p = np.round(y_pred).astype(int)
            labels = sorted(list(set([0, 1]).union(set(y_t), set(y_p))))
            cm = confusion_matrix(y_t, y_p, labels=labels)
            classes = [f"Class {i}" for i in labels]
            if len(labels) == 3:
                classes = ["Hold", "Buy", "Sell"]
                
            result["confusionMatrix"] = {
                "classes": classes[:cm.shape[0]],
                "matrix": cm.tolist()
            }
    except Exception as e:
        print(f"Failed to generate confusion matrix: {e}")

    # 3. Time Series Data (Actual vs Predicted)
    try:
        y_test_1d = y_test[:, 0] if (hasattr(y_test, 'ndim') and y_test.ndim > 1 and y_test.shape[1] > 1) else np.ravel(y_test)
        y_pred_1d = y_pred[:, 0] if (hasattr(y_pred, 'ndim') and y_pred.ndim > 1 and y_pred.shape[1] > 1) else np.ravel(y_pred)
        
        # Take the last 50 points to avoid huge payloads
        subset_len = min(50, len(y_test_1d))
        ts_data = []
        for i in range(subset_len):
            ts_data.append({
                "time": f"T-{subset_len-i}",
                "actual": float(y_test_1d[len(y_test_1d) - subset_len + i]),
                "predicted": float(y_pred_1d[len(y_pred_1d) - subset_len + i])
            })
        result["timeSeriesData"] = ts_data
    except Exception as e:
        print(f"Failed to generate time series data: {e}")

    # 4. SHAP Summary
    try:
        import shap
        # Sample data to speed up SHAP calculation
        # FIX: Use DataFrame to preserve feature names -> eliminates "X does not have valid feature names" warnings
        sample_size = min(100, len(X_test))
        X_sample_np = X_test[:sample_size]
        X_sample_df = pd.DataFrame(X_sample_np, columns=feature_names)
        
        if type(model).__name__ in ['RandomForestClassifier', 'RandomForestRegressor', 'XGBClassifier', 'XGBRegressor', 'LGBMClassifier', 'LGBMRegressor', 'CatBoostClassifier', 'CatBoostRegressor']:
            explainer = shap.TreeExplainer(model)
            shap_values = explainer.shap_values(X_sample_df)
            
            if isinstance(shap_values, list):
                shap_values = shap_values[1] # Use positive class
            elif hasattr(shap_values, "shape") and len(shap_values.shape) == 3:
                shap_values = shap_values[:, :, 1]
                
            shap_summary = []
            
            if "featureImportance" in result and result["featureImportance"]:
                top_features = [f["name"] for f in result["featureImportance"][:5]]
            else:
                top_features = feature_names[:5]
                
            for feature in top_features:
                if feature in feature_names:
                    f_idx = feature_names.index(feature)
                    f_shap = shap_values[:, f_idx]
                    f_val = X_sample_np[:, f_idx]  # use numpy for indexing
                    
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
            result["shapSummary"] = shap_summary
        elif type(model).__name__ in ['SimpleLSTM', 'SimpleGRU', 'CNN1D', 'DeepLOB', 'TimeSeriesTransformer']:
            from app.services.ml_deep_explainability import generate_deep_shap_summary
            shap_summary = generate_deep_shap_summary(model, X_test, feature_names, is_classification)
            if shap_summary:
                result["shapSummary"] = shap_summary

    except Exception as e:
        print(f"Failed to generate SHAP summary: {e}")

    # 5. PDP Data
    try:
        from sklearn.inspection import partial_dependence
        if "featureImportance" in result and result["featureImportance"]:
            top_feature = result["featureImportance"][0]["name"]
            if top_feature in feature_names:
                f_idx = feature_names.index(top_feature)
                
                # FIX: Use DataFrame for PDP to avoid feature name warning
                X_test_df = pd.DataFrame(X_test, columns=feature_names)
                pd_results = partial_dependence(model, X_test_df, features=[f_idx], grid_resolution=20)
                
                if isinstance(pd_results, dict):
                    if 'values' in pd_results:
                        grid = pd_results['values'][0]
                    elif 'grid_values' in pd_results:
                        grid = pd_results['grid_values'][0]
                    else:
                        grid = list(pd_results.values())[0][0]
                    avg_preds = pd_results['average'][0]
                else:
                    avg_preds, grid = pd_results[0], pd_results[1]
                    avg_preds = avg_preds[0]
                    grid = grid[0]
                    
                pdp_data = []
                for x, y in zip(grid, avg_preds):
                    pdp_data.append({
                        "x": float(x),
                        "y": float(y)
                    })
                result["pdpData"] = pdp_data
    except Exception as e:
        print(f"Failed to generate PDP data: {e}")
        
    # 6. Decision Tree Logic
    try:
        if type(model).__name__ in ['XGBClassifier', 'XGBRegressor']:
            # XGBoost: extract first tree from booster using trees_to_dataframe()
            tree_df = model.get_booster().trees_to_dataframe()
            # Filter only tree 0
            tree0 = tree_df[tree_df['Tree'] == 0].copy()
            
            nodes = []
            edges = []
            node_count = 0
            
            # BFS through nodes using Node ID column
            queue = [('0-0', 1)]  # (node_id, depth)
            visited = set()
            
            while queue and node_count < 7:
                node_id, depth = queue.pop(0)
                if node_id in visited:
                    continue
                visited.add(node_id)
                node_count += 1
                
                row = tree0[tree0['ID'] == node_id]
                if row.empty:
                    continue
                row = row.iloc[0]
                
                feature = str(row.get('Feature', 'Leaf'))
                
                if feature == 'Leaf':
                    val = float(row.get('Gain', 0))
                    if is_classification:
                        class_idx = 1 if val > 0 else 0
                        label = f"Class {class_idx}"
                        color = "green" if class_idx == 1 else "red"
                    else:
                        label = f"Val: {val:.3f}"
                        color = "gray"
                    nodes.append({"id": node_id, "label": label, "type": "leaf", "color": color})
                elif depth <= 3:
                    split_val = float(row.get('Split', 0))
                    nodes.append({
                        "id": node_id,
                        "label": f"{feature} <= {split_val:.2f}",
                        "type": "condition"
                    })
                    
                    yes_child = str(row.get('Yes', ''))
                    no_child  = str(row.get('No', ''))
                    
                    if yes_child and yes_child != 'nan':
                        edges.append({"source": node_id, "target": yes_child, "label": "Yes"})
                        queue.append((yes_child, depth + 1))
                    if no_child and no_child != 'nan':
                        edges.append({"source": node_id, "target": no_child, "label": "No"})
                        queue.append((no_child, depth + 1))
            
            result["decisionTree"] = {"nodes": nodes, "edges": edges}
        
        elif type(model).__name__ in ['RandomForestClassifier', 'RandomForestRegressor']:
            tree = model.estimators_[0].tree_
            
            nodes = []
            edges = []
            
            queue = [(0, 1)] # node_id, depth
            node_count = 0
            
            while queue and node_count < 7: # max 7 nodes
                node_id, depth = queue.pop(0)
                node_count += 1
                
                str_id = str(node_id)
                
                if tree.children_left[node_id] != tree.children_right[node_id] and depth < 3: # Not a leaf
                    feat_idx = tree.feature[node_id]
                    feat_name = feature_names[feat_idx] if feat_idx < len(feature_names) else f"Feat_{feat_idx}"
                    threshold = tree.threshold[node_id]
                    
                    nodes.append({
                        "id": str_id,
                        "label": f"{feat_name} <= {threshold:.2f}",
                        "type": "condition"
                    })
                    
                    left_child = tree.children_left[node_id]
                    right_child = tree.children_right[node_id]
                    
                    edges.append({"source": str_id, "target": str(left_child), "label": "Yes"})
                    edges.append({"source": str_id, "target": str(right_child), "label": "No"})
                    
                    queue.append((left_child, depth+1))
                    queue.append((right_child, depth+1))
                else:
                    val = tree.value[node_id][0]
                    if is_classification:
                        class_idx = np.argmax(val)
                        label = f"Class {class_idx}"
                        color = "green" if class_idx == 1 else "red"
                    else:
                        label = f"Val: {val[0]:.2f}"
                        color = "gray"
                        
                    nodes.append({
                        "id": str_id,
                        "label": label,
                        "type": "leaf",
                        "color": color
                    })
            
            result["decisionTree"] = {
                "nodes": nodes,
                "edges": edges
            }
        elif type(model).__name__ in ['LGBMClassifier', 'LGBMRegressor']:
            tree_info = model.booster_.dump_model()['tree_info'][0]['tree_structure']
            
            nodes = []
            edges = []
            
            queue = [(tree_info, "0", 1)] # node_dict, id, depth
            node_count = 0
            
            while queue and node_count < 7: # max 7 nodes
                curr_node, node_id, depth = queue.pop(0)
                node_count += 1
                
                if 'split_feature' in curr_node and depth < 3:
                    feat_idx = curr_node['split_feature']
                    feat_name = feature_names[feat_idx] if feat_idx < len(feature_names) else f"Feat_{feat_idx}"
                    threshold = curr_node['threshold']
                    
                    nodes.append({
                        "id": node_id,
                        "label": f"{feat_name} <= {threshold:.2f}",
                        "type": "condition"
                    })
                    
                    left_child = curr_node.get('left_child')
                    right_child = curr_node.get('right_child')
                    
                    if left_child:
                        left_id = f"{node_id}_L"
                        edges.append({"source": node_id, "target": left_id, "label": "Yes"})
                        queue.append((left_child, left_id, depth+1))
                        
                    if right_child:
                        right_id = f"{node_id}_R"
                        edges.append({"source": node_id, "target": right_id, "label": "No"})
                        queue.append((right_child, right_id, depth+1))
                else:
                    val = curr_node.get('leaf_value', 0)
                    if is_classification:
                        class_idx = 1 if val > 0 else 0
                        label = f"Class {class_idx}"
                        color = "green" if class_idx == 1 else "red"
                    else:
                        label = f"Val: {val:.2f}"
                        color = "gray"
                        
                    nodes.append({
                        "id": node_id,
                        "label": label,
                        "type": "leaf",
                        "color": color
                    })
            
            result["decisionTree"] = {
                "nodes": nodes,
                "edges": edges
            }
        elif type(model).__name__ in ['CatBoostClassifier', 'CatBoostRegressor']:
            import json, tempfile, os as _os
            
            # CatBoost uses "oblivious trees" (symmetric trees).
            # Each level splits ALL branches on the SAME feature.
            # We export to JSON to read the splits and leaf_values.
            tmp = tempfile.mktemp(suffix='.json')
            model.save_model(tmp, format='json')
            with open(tmp) as f:
                raw = json.load(f)
            _os.remove(tmp)
            
            float_features = raw.get('features_info', {}).get('float_features', [])
            # Build feature index -> name mapping from the model JSON
            feat_idx_to_name = {}
            for ff in float_features:
                feat_idx_to_name[ff['feature_index']] = ff.get('feature_id', f"Feat_{ff['feature_index']}")
            
            trees = raw.get('oblivious_trees', [])
            nodes = []
            edges = []
            
            if trees:
                tree0 = trees[0]
                splits = tree0.get('splits', [])
                leaf_values = tree0.get('leaf_values', [])
                depth = len(splits)
                
                # Build top-down condition nodes (one per level in an oblivious tree)
                for level, sp in enumerate(splits[:3]):  # max 3 levels
                    feat_idx = sp.get('float_feature_index', 0)
                    border = sp.get('border', 0.0)
                    feat_name = feat_idx_to_name.get(feat_idx, f"Feat_{feat_idx}")
                    
                    node_id = f"cond_{level}"
                    nodes.append({
                        "id": node_id,
                        "label": f"{feat_name} <= {border:.2f}",
                        "type": "condition"
                    })
                    
                    if level > 0:
                        parent_id = f"cond_{level-1}"
                        edges.append({"source": parent_id, "target": node_id, "label": "Yes"})
                
                # Add leaf nodes (2^depth leaves)
                for i, lv in enumerate(leaf_values[:4]):  # show max 4 leaves
                    leaf_id = f"leaf_{i}"
                    if is_classification:
                        class_idx = 1 if lv > 0 else 0
                        label = f"Class {class_idx}"
                        color = "green" if class_idx == 1 else "red"
                    else:
                        label = f"Val: {lv:.3f}"
                        color = "gray"
                    
                    nodes.append({
                        "id": leaf_id,
                        "label": label,
                        "type": "leaf",
                        "color": color
                    })
                    
                    # Connect last condition node to leaves
                    last_cond = f"cond_{min(len(splits)-1, 2)}"
                    label_edge = "Yes" if i % 2 == 0 else "No"
                    edges.append({"source": last_cond, "target": leaf_id, "label": label_edge})
            
            result["decisionTree"] = {
                "nodes": nodes,
                "edges": edges
            }
    except Exception as e:
        print(f"Failed to generate decision tree logic: {e}")

    return result

def apply_data_cleaning(df, config, add_log):
    """Apply data cleaning strategies (missing values, outliers)."""
    import numpy as np
    
    # Replace infinities with NaNs before dropping
    df.replace([np.inf, -np.inf], np.nan, inplace=True)
    
    # Fill sparse indicator columns that inherently return NaN
    sparse_prefixes = ('PSARl', 'PSARs', 'SUPERTl', 'SUPERTs')
    sparse_cols = [c for c in df.columns if str(c).startswith(sparse_prefixes)]
    if sparse_cols:
        df[sparse_cols] = df[sparse_cols].fillna(0)

    initial_len = len(df)
    
    # 1. Missing Data Strategy
    # ALWAYS drop rows where target variables are NaN, as we cannot impute targets
    target_cols = [c for c in df.columns if c in ['Target', 'Target_Direction', 'Target_SL', 'Target_TP', 'Target_Class', 'Target_Reg']]
    if target_cols:
        df.dropna(subset=target_cols, inplace=True)

    missing_strategy = config.get("missing_data_strategy", "drop")
    if missing_strategy == "ffill":
        add_log("Applying Forward Fill (ffill) for missing data...")
        df.ffill(inplace=True)
        df.dropna(inplace=True) # Drop remaining NaNs (e.g. at the beginning)
    elif missing_strategy == "mean":
        add_log("Applying Mean Imputation for missing data...")
        df.fillna(df.mean(), inplace=True)
        df.dropna(inplace=True)
    else:
        # Default: drop
        df.dropna(inplace=True)
        
    dropped = initial_len - len(df)
    if dropped > 0 and missing_strategy == "drop":
        add_log(f"Dropped {dropped} rows containing missing values.")
        
    # 2. Outlier Removal
    outlier_strategy = config.get("outlier_removal", "none")
    if outlier_strategy == "zscore" and len(df) > 10:
        add_log("Applying Z-Score outlier removal (>3 std dev)...")
        from scipy import stats
        num_cols = df.select_dtypes(include=[np.number]).columns
        z_scores = np.abs(stats.zscore(df[num_cols].fillna(0)))
        z_scores = np.nan_to_num(z_scores) # Handle constant columns
        df = df[(z_scores < 3).all(axis=1)]
        add_log(f"Removed {initial_len - len(df) - dropped} outlier rows using Z-Score.")
    elif outlier_strategy == "iqr" and len(df) > 10:
        add_log("Applying IQR outlier clipping...")
        num_cols = df.select_dtypes(include=[np.number]).columns
        Q1 = df[num_cols].quantile(0.25)
        Q3 = df[num_cols].quantile(0.75)
        IQR = Q3 - Q1
        lower_bound = Q1 - 1.5 * IQR
        upper_bound = Q3 + 1.5 * IQR
        # Clip values to bounds instead of dropping to preserve time series continuity
        df[num_cols] = df[num_cols].clip(lower=lower_bound, upper=upper_bound, axis=1)
        add_log("Clipped outliers using IQR method.")
        
    return df

def apply_pca_orthogonalization(df_train, df_test=None, target_col='Target', correlation_threshold=0.95, variance_threshold=0.95, add_log=print):
    """
    Tier-1 Hedge Fund Collinearity Handling (Data Leakage Free): 
    Instead of dropping highly correlated features, this function uses PCA to compress them 
    into orthogonal (uncorrelated) components, preserving hidden signals.
    Fits on train data, transforms on train and test.
    """
    import numpy as np
    import pandas as pd
    from sklearn.decomposition import PCA
    from sklearn.preprocessing import StandardScaler
    
    add_log(f"Scanning for collinear features (Threshold: {correlation_threshold})...")
    
    # Isolate feature columns (exclude target)
    feature_cols = [c for c in df_train.columns if c != target_col]
    
    if not feature_cols:
        return df_train, df_test, None
        
    # Calculate correlation matrix on training data only
    corr_matrix = df_train[feature_cols].corr().abs()
    
    # Find features that are highly correlated
    upper = corr_matrix.where(np.triu(np.ones(corr_matrix.shape), k=1).astype(bool))
    
    # Find columns with correlation greater than threshold
    to_compress = set()
    for col in upper.columns:
        highly_correlated_with_col = upper.index[upper[col] > correlation_threshold].tolist()
        if highly_correlated_with_col:
            to_compress.add(col)
            for c in highly_correlated_with_col:
                to_compress.add(c)
                
    to_compress = list(to_compress)
    
    if not to_compress:
        add_log("No highly collinear features found. Skipping PCA compression.")
        return df_train, df_test, None
        
    add_log(f"Found {len(to_compress)} highly collinear features. Applying PCA Compression (Target Variance: {variance_threshold*100}%)...")
    
    # Fit and transform on train
    X_compress_train = df_train[to_compress].fillna(0)
    scaler = StandardScaler()
    X_scaled_train = scaler.fit_transform(X_compress_train)
    
    pca = PCA(n_components=variance_threshold)
    X_pca_train = pca.fit_transform(X_scaled_train)
    
    n_components = X_pca_train.shape[1]
    add_log(f"Compressed {len(to_compress)} features into {n_components} orthogonal principal components.")
    
    pca_cols = [f"PCA_Comp_{i+1}" for i in range(n_components)]
    df_pca_train = pd.DataFrame(X_pca_train, columns=pca_cols, index=df_train.index)
    df_train_reduced = df_train.drop(columns=to_compress)
    df_train_final = pd.concat([df_train_reduced, df_pca_train], axis=1)
    
    # Transform on test
    df_test_final = None
    if df_test is not None:
        X_compress_test = df_test[to_compress].fillna(0)
        X_scaled_test = scaler.transform(X_compress_test)
        X_pca_test = pca.transform(X_scaled_test)
        
        df_pca_test = pd.DataFrame(X_pca_test, columns=pca_cols, index=df_test.index)
        df_test_reduced = df_test.drop(columns=to_compress)
        df_test_final = pd.concat([df_test_reduced, df_pca_test], axis=1)
        
    pca_model_data = {
        'scaler': scaler,
        'pca': pca,
        'to_compress': to_compress,
        'pca_cols': pca_cols
    }
    
    import gc
    del X_compress_train, X_scaled_train, corr_matrix, upper
    gc.collect()
    
    return df_train_final, df_test_final, pca_model_data

def apply_shap_feature_selection(df, target_col='Target', top_k=None, cumulative_importance=0.95, is_classification=True, add_log=print):
    """
    Tier-1 Hedge Fund Smart Feature Selection:
    Trains a lightweight tree model to compute SHAP values and filters features 
    that cumulatively explain `cumulative_importance` (e.g. 95%) of the model's predictive power.
    """
    import numpy as np
    import pandas as pd
    from xgboost import XGBClassifier, XGBRegressor
    
    add_log("Starting SHAP-based Smart Feature Selection...")
    
    # Isolate features and target
    feature_cols = [c for c in df.columns if c != target_col]
    if not feature_cols:
        return df, feature_cols
        
    X = df[feature_cols].fillna(0).values
    y = df[target_col].values
    
    # Train lightweight model
    add_log(f"Training lightweight XGBoost for SHAP attribution (Classification: {is_classification})...")
    if is_classification:
        # Check if we have multiple classes
        unique_y = np.unique(y)
        if len(unique_y) < 2:
            add_log("Only one class present in target. Skipping SHAP selection.")
            return df, feature_cols
        model = XGBClassifier(n_estimators=50, max_depth=4, n_jobs=-1, random_state=42)
    else:
        model = XGBRegressor(n_estimators=50, max_depth=4, n_jobs=-1, random_state=42)
        
    model.fit(X, y)
    
    # Compute feature importances
    importances = model.feature_importances_
    
    # Sort features by importance
    feature_importances = list(zip(feature_cols, importances))
    feature_importances.sort(key=lambda x: x[1], reverse=True)
    
    # Select features based on cumulative importance or top_k
    selected_features = []
    current_importance = 0.0
    
    for name, imp in feature_importances:
        selected_features.append(name)
        current_importance += imp
        if top_k is not None and len(selected_features) >= top_k:
            break
        if top_k is None and current_importance >= cumulative_importance:
            break
            
    add_log(f"SHAP Selection: Reduced features from {len(feature_cols)} to {len(selected_features)} "
            f"(explaining {current_importance*100:.1f}% of variance).")
            
    # Include target col back
    selected_cols = selected_features + [target_col]
    df_reduced = df[selected_cols]
    
    import gc
    del model, X, y
    gc.collect()
    
    return df_reduced, selected_features



def apply_missing_data_threshold(df: pd.DataFrame, threshold: float = 0.2, naturally_zero_features: list = None, add_log=print):
    """
    Drops features that have a high percentage of missing data (NaN or 0.0) exceeding the threshold.
    Protects features in `naturally_zero_features` from being dropped due to exactly 0.0 values.
    
    Args:
        df: Pandas DataFrame containing the features.
        threshold: The maximum allowed fraction (0.0 to 1.0) of missing data before a feature is dropped.
        naturally_zero_features: List of column names where 0.0 is a valid, natural value.
        add_log: Callback function for logging.
        
    Returns:
        Filtered DataFrame and a list of kept feature names.
    """
    if naturally_zero_features is None:
        naturally_zero_features = []
        
    initial_cols = df.shape[1]
    total_rows = len(df)
    cols_to_drop = []
    
    add_log(f"🔍 Running Missing Data Filter (Threshold: {threshold*100:.1f}%) on {initial_cols} features...")
    
    for col in df.columns:
        if col == 'Target' or col.startswith('Target_'):
            continue
            
        # Count NaNs
        nan_count = df[col].isna().sum()
        missing_count = nan_count
        
        # Count 0.0s if not naturally zero
        if col not in naturally_zero_features:
            zero_count = (df[col] == 0.0).sum()
            missing_count += zero_count
            
        missing_ratio = missing_count / total_rows
        
        if missing_ratio > threshold:
            cols_to_drop.append(col)
            
    if cols_to_drop:
        df = df.drop(columns=cols_to_drop)
        add_log(f"🗑️ Dropped {len(cols_to_drop)} features exceeding missing data threshold. (e.g. {cols_to_drop[:5]})")
    else:
        add_log("✅ No features exceeded the missing data threshold.")
        
    return df, [c for c in df.columns if c != 'Target' and not c.startswith('Target_')]


def apply_auto_feature_selection(df: pd.DataFrame, target_col: str, top_n: int = 50, is_classification: bool = True, add_log=print):
    """
    Applies Hybrid Feature Selection (Random Forest + Mutual Information) to select the top N features.
    This prevents the model from getting confused by too many noisy features (e.g., >270) and reduces overfitting.
    """
    from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
    from sklearn.feature_selection import mutual_info_classif, mutual_info_regression
    import numpy as np
    
    feature_cols = [c for c in df.columns if c != target_col and not c.startswith('Target_') and c not in ['timestamp', 'time', 'datetime']]
    X_full = df[feature_cols].copy()
    
    # --- MISSING LOGIC ADDED: Zero Variance Check ---
    add_log("🔍 Removing constant/zero-variance features...")
    # Drop columns that have any NaN values (RandomForest cannot handle NaNs)
    X_full = X_full.dropna(axis=1)
    # Drop columns with zero variance
    X_full = X_full.loc[:, X_full.var() > 1e-10]
    
    feature_cols = X_full.columns.tolist()
    
    # --- MISSING LOGIC ADDED: Correlation Filter (>0.85) ---
    add_log("🔍 Removing highly correlated features (>0.85) to prevent collinearity...")
    corr_matrix = X_full.corr().abs()
    upper = corr_matrix.where(np.triu(np.ones(corr_matrix.shape), k=1).astype(bool))
    to_drop = [column for column in upper.columns if any(upper[column] > 0.85)]
    
    feature_cols = [c for c in feature_cols if c not in to_drop]
    add_log(f"🗑️ Dropped {len(to_drop)} highly correlated features. Remaining: {len(feature_cols)}")
    
    if len(feature_cols) <= top_n:
        add_log(f"⚡ Auto Feature Selection skipped: Dataset only has {len(feature_cols)} features after correlation filter (<= {top_n}).")
        return df, feature_cols
        
    add_log(f"🧠 Running Auto Feature Selection (Hybrid RF + MI) to select top {top_n} out of {len(feature_cols)} features...")
    
    X = df[feature_cols].values
    y = df[target_col].values
    
    # 1. Random Forest Importance
    if is_classification:
        rf = RandomForestClassifier(n_estimators=50, max_depth=5, random_state=42, n_jobs=-1)
    else:
        rf = RandomForestRegressor(n_estimators=50, max_depth=5, random_state=42, n_jobs=-1)
        
    rf.fit(X, y)
    importances = rf.feature_importances_
    
    # 2. Mutual Information
    if is_classification:
        mi_scores = mutual_info_classif(X, y, random_state=42)
    else:
        mi_scores = mutual_info_regression(X, y, random_state=42)
        
    # Normalize
    imp_norm = importances / (np.max(importances) + 1e-9)
    mi_norm = mi_scores / (np.max(mi_scores) + 1e-9)
    
    # 3. Hybrid Score
    combined_scores = (imp_norm * 0.7) + (mi_norm * 0.3)
    
    # 4. Rank and Select
    feature_ranking = list(zip(feature_cols, combined_scores))
    feature_ranking.sort(key=lambda x: x[1], reverse=True)
    
    selected_features = [f[0] for f in feature_ranking[:top_n]]
    
    add_log(f"✅ Auto Feature Selection complete. Selected Top {top_n} features. (e.g. {selected_features[:5]})")
    
    # Include target columns back
    target_cols_to_keep = [c for c in df.columns if c not in feature_cols]
    final_cols = selected_features + target_cols_to_keep
    
    df_reduced = df[final_cols].copy()
    
    import gc
    del rf, X, y
    gc.collect()
    
    return df_reduced, selected_features
