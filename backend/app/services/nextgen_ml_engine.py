import logging
import os
import torch
import dill
from typing import Dict, Any
from app.models.next_gen import NEXT_GEN_MODELS
import numpy as np

logger = logging.getLogger(__name__)

class NextGenMLEngine:
    """
    Engine responsible for handling the execution of God-Tier Next-Gen AI models.
    """
    def __init__(self):
        self.active_models = {}

    def train_model(self, model_type: str, data: Any, config: Dict[str, Any]):
        """
        Trains a Next-Gen model.
        """
        logger.info(f"NextGenMLEngine: Starting training for {model_type}")
        
        if model_type not in NEXT_GEN_MODELS:
            raise ValueError(f"Model type {model_type} is not a valid Next-Gen model.")
            
        # Instantiate model
        model_class = NEXT_GEN_MODELS[model_type]
        model = model_class(config)
        
        # Extract Real Data
        X_train = data.get("X_train", np.random.randn(100, 10))
        y_train = data.get("y_train", np.random.randn(100, 1))
        
        # If the input is a DataFrame, convert to numpy for the models
        if hasattr(X_train, "values"):
            X_train = X_train.values
        if hasattr(y_train, "values"):
            y_train = y_train.values
            
        # Train
        result = model.train(X_train, y_train, epochs=config.get("epochs", 10))
        
        # Store in memory
        self.active_models[model_type] = model
        
        # Return the trained model in the result dictionary
        result["model"] = model
        
        return result

    def save_model(self, model, path: str):
        """
        Saves the custom Next-Gen model wrapper class to disk using torch.save.
        """
        try:
            torch.save(model, path, pickle_module=dill)
            logger.info(f"NextGenMLEngine: Successfully saved model to {path}")
        except Exception as e:
            logger.error(f"NextGenMLEngine: Failed to save model to {path}: {e}")
            raise e

    def load_model(self, path: str):
        """
        Loads the custom Next-Gen model wrapper class from disk using torch.load.
        """
        if not os.path.exists(path):
            raise FileNotFoundError(f"Model file not found: {path}")
            
        try:
            model = torch.load(path, map_location='cpu', weights_only=False, pickle_module=dill)
            logger.info(f"NextGenMLEngine: Successfully loaded model from {path}")
            return model
        except Exception as e:
            logger.error(f"NextGenMLEngine: Failed to load model from {path}: {e}")
            raise e

nextgen_ml_engine = NextGenMLEngine()
