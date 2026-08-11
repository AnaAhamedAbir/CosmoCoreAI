import pandas as pd
import logging
from app.services.asmc_strategy.mtf_processor import calculate_mtf_structure
from app.services.asmc_strategy.cisd_engine import detect_cisd

def apply_asmc_mtf_logic(df: pd.DataFrame, htf_str: str = '4h', ltf_str: str = '15m') -> pd.DataFrame:
    """
    Main orchestration function for the ASMC MTF Strategy.
    This function is dynamically executed from the CustomIndicatorBuilder.
    It performs:
    1. Multi-timeframe structural processing (FVG/OB mapping)
    2. LTF CISD (Change in State of Delivery) detection
    """
    logging.info(f"Applying ASMC Strategy MTF Logic (HTF: {htf_str}, LTF: {ltf_str})")
    
    try:
        # Step 1: HTF Structure Calculation
        df = calculate_mtf_structure(df, htf_str)
        
        # Step 2: LTF CISD Execution Triggers
        df = detect_cisd(df)
        
        logging.info("Successfully applied ASMC MTF Strategy logic.")
    except Exception as e:
        logging.error(f"Error applying ASMC Strategy logic: {e}")
        
    return df
