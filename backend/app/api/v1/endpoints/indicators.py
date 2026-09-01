from typing import Any, List, Dict
import asyncio
import pandas as pd
import pandas_ta as ta
import ccxt.async_support as ccxt
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from app import schemas, models
from app.crud import indicator as crud_indicator
from app.api import deps

router = APIRouter()

@router.post("/", response_model=schemas.IndicatorResponse)
def create_indicator(
    *,
    db: Session = Depends(deps.get_db),
    indicator_in: schemas.IndicatorCreate,
    current_user: models.User = Depends(deps.get_current_user),
) -> Any:
    """
    Create new indicator.
    """
    indicator = crud_indicator.create_indicator(db=db, indicator=indicator_in, user_id=current_user.id)
    return indicator

@router.get("/", response_model=List[schemas.IndicatorResponse])
def read_indicators(
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user),
) -> Any:
    """
    Retrieve indicators.
    """
    indicators = crud_indicator.get_indicators_by_user(db=db, user_id=current_user.id)
    return indicators

@router.delete("/{id}", response_model=Dict[str, str])
def delete_indicator(
    *,
    db: Session = Depends(deps.get_db),
    id: int,
    current_user: models.User = Depends(deps.get_current_user),
) -> Any:
    """
    Delete an indicator.
    """
    success = crud_indicator.delete_indicator(db=db, indicator_id=id, user_id=current_user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Indicator not found")
    return {"message": "Indicator deleted successfully"}


@router.get("/templates", response_model=List[schemas.IndicatorBase])
def get_templates() -> Any:
    """
    Get default Pine Script templates.
    """
    templates = [
        {
            "name": "Simple Moving Average (SMA)",
            "code": """//@version=5
indicator("Simple Moving Average", overlay=true)
length = input(14, "Length")
source = input(close, "Source")
avg = ta.sma(source, length)
plot(avg, color=color.blue)
""",
            "base_type": "indicator",
            "parameters": {"length": 14, "source": "close"}
        },
        {
            "name": "Relative Strength Index (RSI)",
            "code": """//@version=5
indicator("RSI", overlay=false)
length = input(14, "RSI Length")
rsi = ta.rsi(close, length)
plot(rsi, color=color.purple)
hline(70, "Overbought", color=color.red)
hline(30, "Oversold", color=color.green)
""",
            "base_type": "indicator",
            "parameters": {"length": 14}
        }
    ]
    return templates


@router.websocket("/ws/stream/{symbol_param}")
async def websocket_indicator_stream(websocket: WebSocket, symbol_param: str):
    await websocket.accept()
    # Decode symbol e.g., BTC-USDT to BTC/USDT
    symbol = symbol_param.replace("-", "/").upper()
    
    exchange = ccxt.binance({'enableRateLimit': True})
    try:
        while True:
            # Fetch last 200 candles (1m timeframe for rapid real-time updates)
            ohlcv = await exchange.fetch_ohlcv(symbol, timeframe='1m', limit=200)
            if not ohlcv:
                await asyncio.sleep(5)
                continue
                
            df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            
            # Selectively calculate using pandas_ta
            df.ta.rsi(length=14, append=True)
            df.ta.macd(fast=12, slow=26, signal=9, append=True)
            df.ta.stoch(append=True)
            df.ta.cci(length=20, append=True)
            df.ta.ao(append=True)
            df.ta.mom(length=10, append=True)
            df.ta.stochrsi(append=True)
            df.ta.willr(length=14, append=True)
            df.ta.mfi(length=14, append=True)
            df.ta.roc(length=9, append=True)
            df.ta.trix(length=15, append=True)
            df.ta.uo(append=True) # Ultimate Oscillator
            
            # MAs
            for length in [5, 10, 20, 50, 100, 200]:
                df.ta.sma(length=length, append=True)
                df.ta.ema(length=length, append=True)
            df.ta.wma(length=20, append=True)
            df.ta.vwma(length=20, append=True)
            df.ta.hma(length=9, append=True)
            
            # Trend / Volatility / Momentum
            df.ta.adx(length=14, append=True)
            df.ta.bbands(length=20, std=2, append=True)
            df.ta.atr(length=14, append=True)
            df.ta.kc(length=20, scalar=1.5, append=True)
            df.ta.donchian(length=20, append=True)
            df.ta.psar(append=True)
            
            # Safe ichimoku/supertrend (can crash if not enough data)
            try: df.ta.supertrend(append=True)
            except: pass
            try: df.ta.aroon(append=True)
            except: pass
            try: df.ta.kst(append=True)
            except: pass
            try: df.ta.cmo(append=True)
            except: pass
            
            # Volume
            df.ta.obv(append=True)
            df.ta.cmf(append=True)
            df.ta.vwap(append=True)
            df.ta.pvt(append=True)
            df.ta.efi(append=True) # Force Index
            df.ta.eom(append=True)
            
            # Other
            try: df.ta.squeeze(append=True)
            except: pass
            
            last_row = df.iloc[-1]
            close = last_row['close']
            
            def sig(val, buy_thresh, sell_thresh, invert=False):
                if pd.isna(val): return 'NEUTRAL'
                if not invert:
                    if val < buy_thresh: return 'STRONG_BUY' if val < buy_thresh - 10 else 'BUY'
                    if val > sell_thresh: return 'STRONG_SELL' if val > sell_thresh + 10 else 'SELL'
                else:
                    if val > buy_thresh: return 'STRONG_BUY' if val > buy_thresh + 10 else 'BUY'
                    if val < sell_thresh: return 'STRONG_SELL' if val < sell_thresh - 10 else 'SELL'
                return 'NEUTRAL'
                
            def ma_sig(val, c):
                if pd.isna(val): return 'NEUTRAL'
                diff = (c - val) / val * 100
                if diff > 2: return 'STRONG_BUY'
                if diff > 0: return 'BUY'
                if diff < -2: return 'STRONG_SELL'
                if diff < 0: return 'SELL'
                return 'NEUTRAL'
                
            def get_col_val(prefix, default=0):
                for col in last_row.index:
                    if str(col).startswith(prefix):
                        return last_row[col]
                return default
            
            # Construct response payload mapped to indicator IDs (ALL 50+)
            results = [
                # Oscillators
                {"id": "rsi", "value": f"{last_row.get('RSI_14', 50):.2f}", "signal": sig(last_row.get('RSI_14', 50), 30, 70)},
                {"id": "macd", "value": f"{last_row.get('MACD_12_26_9', 0):.4f}", "signal": sig(last_row.get('MACD_12_26_9', 0), -0.5, 0.5, invert=True)},
                {"id": "stoch", "value": f"{last_row.get('STOCHk_14_3_3', 50):.2f}", "signal": sig(last_row.get('STOCHk_14_3_3', 50), 20, 80)},
                {"id": "cci", "value": f"{last_row.get('CCI_20_0.015', 0):.2f}", "signal": sig(last_row.get('CCI_20_0.015', 0), -100, 100)},
                {"id": "ao", "value": f"{last_row.get('AO_5_34', 0):.4f}", "signal": sig(last_row.get('AO_5_34', 0), -0.1, 0.1, invert=True)},
                {"id": "mom", "value": f"{last_row.get('MOM_10', 0):.2f}", "signal": sig(last_row.get('MOM_10', 0), -10, 10, invert=True)},
                {"id": "stochrsi", "value": f"{last_row.get('STOCHRSIk_14_14_3_3', 50):.2f}", "signal": sig(last_row.get('STOCHRSIk_14_14_3_3', 50), 20, 80)},
                {"id": "uo", "value": f"{get_col_val('UO_', 50):.2f}", "signal": sig(get_col_val('UO_', 50), 30, 70)},
                {"id": "wpr", "value": f"{last_row.get('WILLR_14', -50):.2f}", "signal": sig(last_row.get('WILLR_14', -50), -80, -20)},
                {"id": "mfi", "value": f"{last_row.get('MFI_14', 50):.2f}", "signal": sig(last_row.get('MFI_14', 50), 20, 80)},
                {"id": "roc", "value": f"{last_row.get('ROC_9', 0):.2f}", "signal": sig(last_row.get('ROC_9', 0), -5, 5, invert=True)},
                {"id": "trix", "value": f"{get_col_val('TRIX_', 0):.4f}", "signal": sig(get_col_val('TRIX_', 0), -0.1, 0.1, invert=True)},
                
                # MAs
                {"id": "sma5", "value": f"{last_row.get('SMA_5', close):.2f}", "signal": ma_sig(last_row.get('SMA_5', close), close)},
                {"id": "sma10", "value": f"{last_row.get('SMA_10', close):.2f}", "signal": ma_sig(last_row.get('SMA_10', close), close)},
                {"id": "sma20", "value": f"{last_row.get('SMA_20', close):.2f}", "signal": ma_sig(last_row.get('SMA_20', close), close)},
                {"id": "sma50", "value": f"{last_row.get('SMA_50', close):.2f}", "signal": ma_sig(last_row.get('SMA_50', close), close)},
                {"id": "sma100", "value": f"{last_row.get('SMA_100', close):.2f}", "signal": ma_sig(last_row.get('SMA_100', close), close)},
                {"id": "sma200", "value": f"{last_row.get('SMA_200', close):.2f}", "signal": ma_sig(last_row.get('SMA_200', close), close)},
                {"id": "ema5", "value": f"{last_row.get('EMA_5', close):.2f}", "signal": ma_sig(last_row.get('EMA_5', close), close)},
                {"id": "ema10", "value": f"{last_row.get('EMA_10', close):.2f}", "signal": ma_sig(last_row.get('EMA_10', close), close)},
                {"id": "ema20", "value": f"{last_row.get('EMA_20', close):.2f}", "signal": ma_sig(last_row.get('EMA_20', close), close)},
                {"id": "ema50", "value": f"{last_row.get('EMA_50', close):.2f}", "signal": ma_sig(last_row.get('EMA_50', close), close)},
                {"id": "ema100", "value": f"{last_row.get('EMA_100', close):.2f}", "signal": ma_sig(last_row.get('EMA_100', close), close)},
                {"id": "ema200", "value": f"{last_row.get('EMA_200', close):.2f}", "signal": ma_sig(last_row.get('EMA_200', close), close)},
                {"id": "wma20", "value": f"{last_row.get('WMA_20', close):.2f}", "signal": ma_sig(last_row.get('WMA_20', close), close)},
                {"id": "vwma20", "value": f"{last_row.get('VWMA_20', close):.2f}", "signal": ma_sig(last_row.get('VWMA_20', close), close)},
                {"id": "hma", "value": f"{last_row.get('HMA_9', close):.2f}", "signal": ma_sig(last_row.get('HMA_9', close), close)},
                
                # Trend / Momentum
                {"id": "adx", "value": f"{last_row.get('ADX_14', 20):.2f}", "signal": "STRONG_BUY" if last_row.get('ADX_14', 0) > 25 and last_row.get('DMP_14', 0) > last_row.get('DMN_14', 0) else "STRONG_SELL" if last_row.get('ADX_14', 0) > 25 else "NEUTRAL"},
                {"id": "psar", "value": f"{get_col_val('PSARl_', close):.2f}", "signal": "BUY" if get_col_val('PSARdir_') == 1 else "SELL"},
                {"id": "ichimoku", "value": f"Cloud", "signal": "BUY" if close > get_col_val('ISA_') else "SELL"},
                {"id": "supertrend", "value": f"{get_col_val('SUPERT_', close):.2f}", "signal": "BUY" if get_col_val('SUPERTd_') == 1 else "SELL"},
                {"id": "aroon", "value": f"{get_col_val('AROONOSC_', 0):.2f}", "signal": sig(get_col_val('AROONOSC_', 0), -50, 50, invert=True)},
                {"id": "dmi", "value": f"+{last_row.get('DMP_14', 0):.0f} / -{last_row.get('DMN_14', 0):.0f}", "signal": "BUY" if last_row.get('DMP_14', 0) > last_row.get('DMN_14', 0) else "SELL"},
                {"id": "kst", "value": f"{get_col_val('KST_', 0):.2f}", "signal": sig(get_col_val('KST_', 0), -1, 1, invert=True)},
                {"id": "cmo", "value": f"{get_col_val('CMO_', 0):.2f}", "signal": sig(get_col_val('CMO_', 0), -50, 50, invert=True)},
                
                # Volatility
                {"id": "bb", "value": f"{last_row.get('BBL_20_2.0', close):.2f}", "signal": "BUY" if close < last_row.get('BBL_20_2.0', 0) else "SELL" if close > last_row.get('BBU_20_2.0', 999999) else "NEUTRAL"},
                {"id": "atr", "value": f"{last_row.get('ATRr_14', 0):.2f}", "signal": "NEUTRAL"},
                {"id": "keltner", "value": f"{last_row.get('KCLs_20_1.5', close):.2f}", "signal": "BUY" if close < last_row.get('KCLs_20_1.5', 0) else "SELL" if close > last_row.get('KCUe_20_1.5', 999999) else "NEUTRAL"},
                {"id": "donchian", "value": f"{last_row.get('DCL_20_20', close):.2f}", "signal": "BUY" if close == last_row.get('DCL_20_20', 0) else "SELL" if close == last_row.get('DCU_20_20', 999999) else "NEUTRAL"},
                {"id": "cvd", "value": f"N/A", "signal": "NEUTRAL"},
                
                # Volume
                {"id": "obv", "value": f"{get_col_val('OBV', 0)/1000:.1f}k", "signal": "NEUTRAL"},
                {"id": "cmf", "value": f"{get_col_val('CMF_', 0):.2f}", "signal": sig(get_col_val('CMF_', 0), -0.1, 0.1, invert=True)},
                {"id": "vwap", "value": f"{get_col_val('VWAP_D', close):.2f}", "signal": ma_sig(get_col_val('VWAP_D', close), close)},
                {"id": "pvt", "value": f"{get_col_val('PVT', 0)/1000:.1f}k", "signal": "NEUTRAL"},
                {"id": "fi", "value": f"{get_col_val('EFI_', 0)/1000:.1f}k", "signal": sig(get_col_val('EFI_', 0), -100, 100, invert=True)},
                {"id": "eom", "value": f"{get_col_val('EOM_', 0):.2f}", "signal": "NEUTRAL"},
                
                # Other / Advanced
                {"id": "pivot", "value": f"Auto", "signal": "NEUTRAL"},
                {"id": "fib", "value": f"Auto", "signal": "NEUTRAL"},
                {"id": "td", "value": f"Setup", "signal": "NEUTRAL"},
                {"id": "sqz", "value": f"{get_col_val('SQZ_', 0):.2f}", "signal": "BUY" if get_col_val('SQZ_ON_', 0) == 1 else "NEUTRAL"},
                {"id": "vix", "value": f"N/A", "signal": "NEUTRAL"},
                {"id": "mcg", "value": f"N/A", "signal": "NEUTRAL"},
            ]
            
            await websocket.send_json(results)
            await asyncio.sleep(5) # Poll interval
            
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Error in indicator stream: {e}")
    finally:
        await exchange.close()
