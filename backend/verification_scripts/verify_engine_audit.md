# Training Studio Engine Audit & Fix Plan

## সব Engine-এর তালিকা (Training Studio)

| # | Engine | Type | y-scaling Bug | Feature Name Warning | Decision Tree Support |
|---|--------|------|--------------|---------------------|----------------------|
| 1 | **Random Forest** | Tree-based (sklearn) | ✅ Fixed | ⚠️ Missing (uses X_train numpy) | ✅ Already supported |
| 2 | **XGBoost** | Tree-based | ✅ Fixed | ⚠️ Missing (uses X_train numpy) | ✅ Already in SHAP support |
| 3 | **LightGBM** | Tree-based | ✅ Fixed | ✅ Fixed | ✅ Fixed |
| 4 | **CatBoost** | Tree-based | ✅ Fixed | ⚠️ Missing | ✅ Fixed |
| 5 | **LSTM** | Deep Learning (PyTorch) | ⚠️ Inherits scaled y | N/A (no feature names) | ❌ N/A (neural net) |
| 6 | **GRU** | Deep Learning (PyTorch) | ⚠️ Inherits scaled y | N/A | ❌ N/A |
| 7 | **1D-CNN** | Deep Learning (PyTorch) | ⚠️ Inherits scaled y | N/A | ❌ N/A |
| 8 | **DeepLOB** | Deep Learning (PyTorch) | ⚠️ Inherits scaled y | N/A | ❌ N/A |
| 9 | **Transformer** | Deep Learning (Advanced) | N/A (own pipeline) | N/A | ❌ N/A |
| 10 | **PPO-RL** | Reinforcement Learning | N/A (RL, no y) | N/A | ❌ N/A |

---

## বাগ বিস্তারিত

### BUG A: y-scaling classification labels (Random Forest, XGBoost, CatBoost)
- Status: **Fixed** via `prediction_target_early` check at line ~451
- LSTM/GRU/CNN/DeepLOB: এরা `y_train` use করে `y_train_t = torch.FloatTensor(y_train)` দিয়ে
  - কিন্তু classification-এ `BCEWithLogitsLoss` ব্যবহার হয়, যেটা float target accept করে
  - তাই deep learning engines-এ এটা technically সমস্যা কম করে

### BUG B: Feature Names Warning (XGBoost, Random Forest, CatBoost)
- RF ও XGBoost: `model.fit(X_train, ...)` — numpy array, কোনো feature name নেই
- SHAP তখন feature names ছাড়া predict করতে গিয়ে warning দেয়
- Fix: `X_train_df` দিয়ে fit করতে হবে (LightGBM-এর মতো)

### BUG C: XGBoost Decision Tree (ml_utils.py)
- `ml_utils.py` তে SHAP-এ XGBoost support আছে কিন্তু Decision Tree visualization নেই
- XGBoost `model.get_booster().trees_to_dataframe()` ব্যবহার করে tree extract করা যায়

### BUG D: Deep Learning Engines — Explainability
- LSTM, GRU, 1D-CNN, DeepLOB — এদের জন্য SHAP `TreeExplainer` কাজ করবে না
- এরা ml_utils.py-র `generate_real_explainability` call হয় না (line 1029 দেখো)
- এটা intentional, তবে Decision Tree সেকশনে কিছু না দেখানোটা ok

---

## Fix Plan

### Fix 1: RF ও XGBoost fit-এ DataFrame ব্যবহার (ml_training_engine.py)
- RF: `model.fit(X_train_df, ...)` এবং `model.predict(X_test_df)`
- XGBoost: `model.fit(X_train_df, ...)` এবং `model.predict(X_test_df)`
- CatBoost: ইতিমধ্যে X_train_df pass হচ্ছে না, ঠিক করতে হবে

### Fix 2: XGBoost Decision Tree Logic (ml_utils.py)
- `model.get_booster().trees_to_dataframe()` দিয়ে প্রথম tree parse করতে হবে
- Node/edge format তৈরি করতে হবে

### Fix 3: CatBoost fit-এ DataFrame pass করা (ml_training_engine.py)
- Line ~740: `model.fit(X_train, ...)` -> `model.fit(X_train_df, ...)`

### What's OK (no fix needed)
- LSTM/GRU/CNN/DeepLOB: PyTorch models, no sklearn feature-name concept
- Transformer/PPO-RL: নিজস্ব pipeline, SHAP/explainability call হয় না
- Decision Tree N/A for neural nets (correct behavior)
