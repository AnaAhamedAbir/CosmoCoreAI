import torch
import torch.nn as nn
import time
import os
import numpy as np
from torch.utils.data import TensorDataset, DataLoader

class PyTorchTrainer:
    """
    Modular trainer for PyTorch-based Deep Learning models.
    Supports Standard Classification, Regression, and Multi-Task Learning (MTL).
    RAM Optimized: Clears unused tensors and minimizes memory footprints.
    """
    @staticmethod
    def train_model(
        model, 
        X_train, y_train, 
        X_test, y_test, 
        config, 
        job, 
        add_log, 
        process_metrics, 
        calculate_classification_metrics, 
        calculate_regression_metrics,
        model_path, 
        previous_model_path=None
    ):
        prediction_target = config.get("prediction_target", "classification")
        epochs = int(config.get("epochs", 10))
        learning_rate = float(config.get("learning_rate", 0.001))
        is_fine_tune = config.get("is_fine_tune", False)
        
        # 1. Setup Tensors
        if job.algorithm in ["LSTM", "GRU"]:
            X_train_t = torch.FloatTensor(X_train).unsqueeze(1)
            X_test_t = torch.FloatTensor(X_test).unsqueeze(1)
        else:
            X_train_t = torch.FloatTensor(X_train)
            X_test_t = torch.FloatTensor(X_test)
            
        y_train_t = torch.FloatTensor(y_train)
        
        # Determine output size
        if prediction_target == "multi_task":
            out_size = 2
        elif prediction_target == "advanced_setup":
            out_size = 3
        else:
            out_size = 1

        # 2. Fine-tuning
        _ft_lr = learning_rate
        if is_fine_tune and previous_model_path:
            _pt_path = previous_model_path.replace('.pkl', '.pt') if previous_model_path.endswith('.pkl') else previous_model_path
            if os.path.exists(_pt_path):
                try:
                    model.load_state_dict(torch.load(_pt_path, map_location='cpu'))
                    _ft_lr = learning_rate * 0.1
                    add_log(f"✅ Fine-Tuning {job.algorithm} from {_pt_path} (LR: {_ft_lr:.6f})")
                except Exception as _ft_e:
                    add_log(f"⚠️ {job.algorithm} weight load failed ({_ft_e}), training fresh.")
            else:
                add_log(f"⚠️ No .pt checkpoint found, training {job.algorithm} fresh.")
        
        # 3. Setup Criterion and Optimizer
        if prediction_target == "multi_task":
            from app.services.mtl.loss import MultiTaskLoss
            criterion = MultiTaskLoss()
            optimizer = torch.optim.Adam(list(model.parameters()) + list(criterion.parameters()), lr=_ft_lr)
        elif prediction_target == "classification":
            num_pos = max(y_train_t.sum().item(), 1.0)
            num_neg = max(len(y_train_t) - y_train_t.sum().item(), 0.0)
            pos_weight = torch.tensor([num_neg / num_pos], dtype=torch.float32)
            criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
            optimizer = torch.optim.Adam(model.parameters(), lr=_ft_lr)
        else:
            from app.services.ml_custom_losses import get_custom_loss_fn
            eval_metric = config.get("eval_metric", "rmse")
            custom_loss = get_custom_loss_fn(eval_metric)
            criterion = custom_loss if custom_loss else nn.MSELoss()
            optimizer = torch.optim.Adam(model.parameters(), lr=_ft_lr)
            
        # 4. Continual Learning (EWC)
        enable_ewc = config.get("enable_ewc", False)
        ewc_lambda = float(config.get("ewc_lambda", 1.0))
        ewc_instance = None
        if enable_ewc and is_fine_tune and prediction_target != "multi_task":
            try:
                add_log("Initializing EWC (Continual Learning) to preserve prior knowledge...")
                from app.services.ml_continual_learning import EWC
                _ds = TensorDataset(X_train_t, y_train_t.reshape(-1, out_size))
                _dl = DataLoader(_ds, batch_size=32, shuffle=True)
                ewc_instance = EWC(model, _dl, device="cpu", ew_weight=ewc_lambda)
            except Exception as e_ewc:
                add_log(f"⚠️ Failed to initialize EWC: {e_ewc}")
                
        enable_adversarial = config.get("enable_adversarial", False)
        adv_epsilon = float(config.get("adversarial_epsilon", 0.01))
        if enable_adversarial:
            add_log(f"Adversarial FGSM Training Enabled (Epsilon={adv_epsilon:.3f})")
            
        # 5. Training Loop
        add_log(f"Starting {job.algorithm} training for {epochs} epochs...")
        for epoch in range(epochs):
            model.train()
            outputs = model(X_train_t)
            optimizer.zero_grad()
            
            if prediction_target == "multi_task":
                class_logits, reg_preds = outputs
                true_class = y_train_t[:, 0].unsqueeze(1)
                true_reg = y_train_t[:, 1].unsqueeze(1)
                loss = criterion(class_logits, reg_preds, true_class, true_reg)
            else:
                loss = criterion(outputs, y_train_t.reshape(-1, out_size))
                
            if ewc_instance:
                from app.services.ml_continual_learning import attach_ewc_to_loss
                loss = attach_ewc_to_loss(loss, model, ewc_instance)
                
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            
            if enable_adversarial and prediction_target != "multi_task":
                from app.services.ml_adversarial import generate_fgsm_attack
                X_adv = generate_fgsm_attack(model, criterion, X_train_t, y_train_t.reshape(-1, out_size), epsilon=adv_epsilon)
                outputs_adv = model(X_adv)
                optimizer.zero_grad()
                loss_adv = criterion(outputs_adv, y_train_t.reshape(-1, out_size))
                loss_adv.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
                optimizer.step()
                
            if job.algorithm == "LSTM":
                pct = 10.0 + (70.0 * (epoch+1)/epochs)
                job.progress = pct
                
            if (epoch+1) % max(1, epochs//5) == 0 or epoch == 0:
                add_log(f"Epoch [{epoch+1}/{epochs}], Loss: {loss.item():.6f}")
                if job.algorithm == "LSTM":
                    time.sleep(0.5)
        
        # 6. Save Model
        model_filename_pt = model_path.replace(".pkl", ".pt")
        torch.save(model.state_dict(), model_filename_pt)
        
        # 7. Evaluation
        model.eval()
        with torch.no_grad():
            start_time = time.time()
            if prediction_target == "multi_task":
                class_logits, reg_preds = model(X_test_t)
                preds_class = (torch.sigmoid(class_logits).numpy() > 0.5).astype(int)
                preds_reg = reg_preds.numpy()
                end_time = time.time()
                final_latency = max(1.0, (end_time - start_time) / max(1, len(X_test)) * 1000)
                
                process_metrics(calculate_classification_metrics(y_test[:, 0], preds_class), True)
                process_metrics(calculate_regression_metrics(y_test[:, 1], preds_reg), False)
                preds_to_return = preds_class # For explainability compatibility
            else:
                preds = model(X_test_t).numpy()
                end_time = time.time()
                final_latency = max(1.0, (end_time - start_time) / max(1, len(X_test)) * 1000)
                
                if prediction_target == "classification":
                    preds_class = (1 / (1 + np.exp(-preds)) > 0.5).astype(int)
                    process_metrics(calculate_classification_metrics(y_test, preds_class), True)
                    preds_to_return = preds_class
                else:
                    process_metrics(calculate_regression_metrics(y_test, preds), False)
                    preds_to_return = preds
                    
        add_log(f"PyTorch {job.algorithm} training complete.")
        
        del X_train_t, X_test_t, y_train_t
        import gc
        gc.collect()
        
        return final_latency, preds_to_return
