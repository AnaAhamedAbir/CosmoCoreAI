import os
import torch
import pandas as pd
import numpy as np
from .timegan import TimeGANWrapper
from .trainer import train_timegan

def generate_and_save_synthetic_data(
    X_train: np.ndarray, 
    columns: list,
    num_samples: int = 100000, 
    seq_len: int = 20, 
    chunk_size: int = 10000, 
    output_path: str = "data/synthetic_black_swan.parquet"
):
    """
    Trains TimeGAN on the given data and generates `num_samples` rows 
    in chunks to save RAM, directly appending to a Parquet file.
    """
    # 1. Ensure directory exists
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    if os.path.exists(output_path):
        os.remove(output_path) # clear old runs
        
    input_dim = len(columns)
    device = torch.device('cpu')
    
    # 2. Train the model (small epochs for live generation)
    model = train_timegan(X_train, input_dim=input_dim, seq_len=seq_len)
    
    # 3. Generate in chunks to prevent RAM overflow
    # For a TimeGAN, it outputs sequences (batch_size, seq_len, input_dim)
    # We will just flatten the sequences into individual rows since the 
    # original tabular data might not have been sequenced strictly for tree models.
    # We only take the last row of each generated sequence to maintain unique samples.
    
    samples_generated = 0
    first_chunk = True
    
    while samples_generated < num_samples:
        current_chunk_size = min(chunk_size, num_samples - samples_generated)
        
        # Generate raw sequences
        synthetic_seq = model.generate(batch_size=current_chunk_size, seq_len=seq_len, device=device)
        synthetic_seq = synthetic_seq.cpu().numpy()
        
        # We only take the final step of the generated sequence to match standard 2D ML inputs
        synthetic_2d = synthetic_seq[:, -1, :] 
        
        df_chunk = pd.DataFrame(synthetic_2d, columns=columns)
        
        # Save to disk using fastparquet with append mode
        if first_chunk:
            df_chunk.to_parquet(output_path, engine='fastparquet')
            first_chunk = False
        else:
            df_chunk.to_parquet(output_path, engine='fastparquet', append=True)
            
        samples_generated += current_chunk_size
        
    return output_path
