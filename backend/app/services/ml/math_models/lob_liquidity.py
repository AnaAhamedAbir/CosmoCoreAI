import pandas as pd
import numpy as np

def generate_lob_liquidity_features(df: pd.DataFrame, selected_features: list[str]) -> pd.DataFrame:
    """
    Category 12: Limit Order Book (L2) & Liquidity Dynamics (Features 111-120)
    Note: Using tick and OHLCV data to proxy L2 properties.
    """
    if df.empty:
        return df
        
    df.columns = [str(c).lower() for c in df.columns]
    close = df['close']
    returns = close.pct_change().fillna(0)
    tick_vol = df.get('tick_net_volume', pd.Series(1, index=df.index)).abs()
    tick_imb = df.get('tick_volume_imbalance', pd.Series(0, index=df.index))
    
    # 111. Order Book Center of Mass
    if 'order_book_center_of_mass' in selected_features:
        # Proxy: Typical price weighted by tick volume
        typical = (df['high'] + df['low'] + close) / 3
        df['order_book_center_of_mass'] = (typical * tick_vol).rolling(20).sum() / (tick_vol.rolling(20).sum() + 1e-8)
        
    # 112. Micro-Price Deviation
    if 'micro_price_deviation' in selected_features:
        # Proxy: Difference between Volume Weighted Price and Simple Mid Price
        mid = (df['high'] + df['low']) / 2
        vwap = (close * tick_vol).rolling(20).sum() / (tick_vol.rolling(20).sum() + 1e-8)
        df['micro_price_deviation'] = vwap - mid
        
    # 113. Order Flow Imbalance (OFI) Z-Score
    if 'ofi_z_score' in selected_features:
        ofi_mean = tick_imb.rolling(50).mean()
        ofi_std = tick_imb.rolling(50).std()
        df['ofi_z_score'] = (tick_imb - ofi_mean) / (ofi_std + 1e-8)
        
    # 114. Quote Stuffing Ratio
    if 'quote_stuffing_ratio' in selected_features:
        # Proxy: High tick count but extremely low price movement
        tick_count = df.get('tick_count', tick_vol)
        hl_range = df['high'] - df['low']
        df['quote_stuffing_ratio'] = tick_count / (hl_range + 1e-8)
        
    # 115. Liquidity Replenishment Rate
    if 'liquidity_replenishment_rate' in selected_features:
        # Proxy: How fast volume recovers after a high-volume spike
        vol_ma = tick_vol.rolling(50).mean()
        spike = tick_vol > (vol_ma * 2)
        # Ratio of current volume to the moving average post-spike
        df['liquidity_replenishment_rate'] = np.where(spike.shift(1), tick_vol / (vol_ma + 1e-8), 0)
        
    # 116. Bid-Ask Volume Divergence
    if 'bid_ask_volume_divergence' in selected_features:
        # Proxy: Price goes up but tick imbalance is negative (or vice versa)
        df['bid_ask_volume_divergence'] = np.sign(returns) * -np.sign(tick_imb)
        
    # 117. Iceberg Order Detection Proxy
    if 'iceberg_order_proxy' in selected_features:
        # Proxy: Price stalls at a level while immense volume is traded
        hl_range = df['high'] - df['low']
        avg_range = hl_range.rolling(20).mean()
        avg_vol = tick_vol.rolling(20).mean()
        df['iceberg_order_proxy'] = np.where((hl_range < avg_range * 0.5) & (tick_vol > avg_vol * 2), 1, 0)
        
    # 118. Order Book Shape (Skewness)
    if 'order_book_skewness' in selected_features:
        # Proxy: Skewness of returns (if returns are positively skewed, offers are thin)
        df['order_book_skewness'] = returns.rolling(20).skew().fillna(0)
        
    # 119. Order Cancellation Ratio
    if 'order_cancellation_ratio' in selected_features:
        # Proxy: High volume volatility before a breakout, followed by sudden drop in volume
        vol_vol = tick_vol.rolling(10).std()
        df['order_cancellation_ratio'] = vol_vol / (tick_vol + 1e-8)
        
    # 120. Market-to-Limit Order Arrival Ratio
    if 'market_to_limit_ratio' in selected_features:
        # Proxy: Net directional volume (Market orders) / Total absolute volume (Limit absorption)
        df['market_to_limit_ratio'] = abs(tick_imb) / (tick_vol + 1e-8)
        
    return df
