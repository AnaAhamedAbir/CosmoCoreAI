import pandas as pd
import numpy as np

def block_bootstrap(df, block_size=10, factor=2):
    """
    Randomly samples blocks of rows to preserve time-series dependencies.
    """
    n = len(df)
    augmented_dfs = [df]
    
    for _ in range(factor - 1):
        indices = np.arange(n)
        blocks = [indices[i:i + block_size] for i in range(0, n, block_size)]
        
        # Shuffle blocks
        np.random.shuffle(blocks)
        
        # Flatten
        sampled_indices = np.concatenate(blocks)[:n]
        sampled_df = df.iloc[sampled_indices].copy()
        
        # Small noise to prevent exact duplicates
        for col in sampled_df.select_dtypes(include=[np.number]).columns:
            if 'Target' not in col:
                std = sampled_df[col].std()
                if std > 0:
                    sampled_df[col] += np.random.normal(0, std * 0.01, size=n)
                    
        augmented_dfs.append(sampled_df)
        
    return pd.concat(augmented_dfs, ignore_index=True)

def jitter_data(df, factor=2, noise_level=0.05):
    """
    Adds Gaussian noise to numerical features.
    """
    augmented_dfs = [df]
    
    for _ in range(factor - 1):
        noisy_df = df.copy()
        for col in noisy_df.select_dtypes(include=[np.number]).columns:
            if 'Target' not in col:
                std = noisy_df[col].std()
                if std > 0:
                    noisy_df[col] += np.random.normal(0, std * noise_level, size=len(noisy_df))
        augmented_dfs.append(noisy_df)
        
    return pd.concat(augmented_dfs, ignore_index=True)

def apply_data_augmentation(df, strategy='none', factor=2, samples=None, is_rl=False):
    """
    Applies data augmentation based on strategy.
    """
    if strategy == 'none' or factor <= 1 and strategy != 'timegan':
        return df
        
    if strategy == 'block_bootstrap':
        return block_bootstrap(df, block_size=20, factor=factor)
    elif strategy == 'jitter':
        return jitter_data(df, factor=factor, noise_level=0.02)
    elif strategy == 'timegan':
        try:
            from app.services.gan.generator import generate_and_save_synthetic_data
            
            # Use samples if provided, else use factor
            if samples is not None and samples > 0:
                num_samples = samples
            else:
                num_samples = len(df) * (factor - 1)
            
            print(f"Starting Live TimeGAN Generation for {num_samples} samples on CPU...")
            output_path = generate_and_save_synthetic_data(
                X_train=df.values,
                columns=df.columns.tolist(),
                num_samples=num_samples,
                seq_len=20, # Default window size
                chunk_size=10000
            )
            
            # Load synthetic data
            synthetic_df = pd.read_parquet(output_path)
            
            # Post-process target columns since GAN generates continuous values
            if not is_rl:
                target_cols = [col for col in df.columns if 'target' in col.lower()]
                for col in target_cols:
                    if col in synthetic_df.columns:
                        # Round and clip to ensure valid class labels (e.g., 0, 1, 2)
                        synthetic_df[col] = synthetic_df[col].round().clip(lower=0)
            
            return pd.concat([df, synthetic_df], ignore_index=True)
            
        except Exception as e:
            print(f"TimeGAN generation failed, falling back to Jitter. Error: {e}")
            return jitter_data(df, factor=factor, noise_level=0.08)
            
    return df
