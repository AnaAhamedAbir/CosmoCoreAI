import pandas as pd
import logging
from app.services.asmc_strategy.forex_mtf_processor import calculate_forex_mtf_structure
from app.services.asmc_strategy.forex_cisd_engine import detect_forex_cisd

def apply_forex_asmc_mtf_logic(df: pd.DataFrame, htf_str: str = '4h', ltf_str: str = '15m') -> pd.DataFrame:
    """
    Main orchestration function for the Forex ASMC MTF Strategy (Tick-Enhanced).
    This function is dynamically executed from the CustomIndicatorBuilder.
    It performs:
    1. Multi-timeframe structural processing (FVG/OB mapping)
    2. LTF CISD (Change in State of Delivery) detection via Tick Order Flow mechanics
    Outputs 27 advanced Institutional Quantitative Metrics.
    """
    logging.info(f"Applying Forex ASMC Strategy MTF Logic (HTF: {htf_str}, LTF: {ltf_str})")
    
    try:
        # Step 1: HTF Structure Calculation
        df = calculate_forex_mtf_structure(df, htf_str)
        
        # Step 2: LTF CISD & Tick Mechanics Execution Triggers
        df = detect_forex_cisd(df)
        
        logging.info("Successfully applied Forex ASMC MTF Strategy logic with 27 metrics.")
    except Exception as e:
        logging.error(f"Error applying Forex ASMC Strategy logic: {e}")
        
    return df
