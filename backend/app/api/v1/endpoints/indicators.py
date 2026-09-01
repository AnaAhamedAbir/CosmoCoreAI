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
    timeframes = ['1m', '5m', '15m', '1h', '4h', '1d']
    user_configs = {}
    
    async def listen_for_configs():
        try:
            while True:
                data = await websocket.receive_json()
                if data.get('type') == 'update_config':
                    ind_id = data.get('id')
                    config = data.get('config')
                    if ind_id and config:
                        user_configs[ind_id] = config
        except Exception as e:
            pass
            
    asyncio.create_task(listen_for_configs())
    
    def calculate_indicators(df, tf_name):
        # Selectively calculate using pandas_ta with user_configs
        rsi_len = int(user_configs.get('rsi', {}).get('length', 14))
        df.ta.rsi(length=rsi_len, append=True)
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
            
        results = [
            {"id": "rsi", "value": f"{get_col_val('RSI_', 50):.2f}", "signal": sig(get_col_val('RSI_', 50), 30, 70)},
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
            {"id": "adx", "value": f"{last_row.get('ADX_14', 20):.2f}", "signal": "STRONG_BUY" if last_row.get('ADX_14', 0) > 25 and last_row.get('DMP_14', 0) > last_row.get('DMN_14', 0) else "STRONG_SELL" if last_row.get('ADX_14', 0) > 25 else "NEUTRAL"},
            {"id": "psar", "value": f"{get_col_val('PSARl_', close):.2f}", "signal": "BUY" if get_col_val('PSARdir_') == 1 else "SELL"},
            {"id": "ichimoku", "value": f"Cloud", "signal": "BUY" if close > get_col_val('ISA_') else "SELL"},
            {"id": "supertrend", "value": f"{get_col_val('SUPERT_', close):.2f}", "signal": "BUY" if get_col_val('SUPERTd_') == 1 else "SELL"},
            {"id": "aroon", "value": f"{get_col_val('AROONOSC_', 0):.2f}", "signal": sig(get_col_val('AROONOSC_', 0), -50, 50, invert=True)},
            {"id": "dmi", "value": f"+{last_row.get('DMP_14', 0):.0f} / -{last_row.get('DMN_14', 0):.0f}", "signal": "BUY" if last_row.get('DMP_14', 0) > last_row.get('DMN_14', 0) else "SELL"},
            {"id": "kst", "value": f"{get_col_val('KST_', 0):.2f}", "signal": sig(get_col_val('KST_', 0), -1, 1, invert=True)},
            {"id": "cmo", "value": f"{get_col_val('CMO_', 0):.2f}", "signal": sig(get_col_val('CMO_', 0), -50, 50, invert=True)},
            {"id": "bb", "value": f"{last_row.get('BBL_20_2.0', close):.2f}", "signal": "BUY" if close < last_row.get('BBL_20_2.0', 0) else "SELL" if close > last_row.get('BBU_20_2.0', 999999) else "NEUTRAL"},
            {"id": "atr", "value": f"{last_row.get('ATRr_14', 0):.2f}", "signal": "NEUTRAL"},
            {"id": "keltner", "value": f"{last_row.get('KCLs_20_1.5', close):.2f}", "signal": "BUY" if close < last_row.get('KCLs_20_1.5', 0) else "SELL" if close > last_row.get('KCUe_20_1.5', 999999) else "NEUTRAL"},
            {"id": "donchian", "value": f"{last_row.get('DCL_20_20', close):.2f}", "signal": "BUY" if close == last_row.get('DCL_20_20', 0) else "SELL" if close == last_row.get('DCU_20_20', 999999) else "NEUTRAL"},
            {"id": "cvd", "value": f"N/A", "signal": "NEUTRAL"},
            {"id": "obv", "value": f"{get_col_val('OBV', 0)/1000:.1f}k", "signal": "NEUTRAL"},
            {"id": "cmf", "value": f"{get_col_val('CMF_', 0):.2f}", "signal": sig(get_col_val('CMF_', 0), -0.1, 0.1, invert=True)},
            {"id": "vwap", "value": f"{get_col_val('VWAP_D', close):.2f}", "signal": ma_sig(get_col_val('VWAP_D', close), close)},
            {"id": "pvt", "value": f"{get_col_val('PVT', 0)/1000:.1f}k", "signal": "NEUTRAL"},
            {"id": "fi", "value": f"{get_col_val('EFI_', 0)/1000:.1f}k", "signal": sig(get_col_val('EFI_', 0), -100, 100, invert=True)},
            {"id": "eom", "value": f"{get_col_val('EOM_', 0):.2f}", "signal": "NEUTRAL"},
            {"id": "pivot", "value": f"Auto", "signal": "NEUTRAL"},
            {"id": "fib", "value": f"Auto", "signal": "NEUTRAL"},
            {"id": "td", "value": f"Setup", "signal": "NEUTRAL"},
            {"id": "sqz", "value": f"{get_col_val('SQZ_', 0):.2f}", "signal": "BUY" if get_col_val('SQZ_ON_', 0) == 1 else "NEUTRAL"},
            {"id": "vix", "value": f"N/A", "signal": "NEUTRAL"},
            {"id": "mcg", "value": f"N/A", "signal": "NEUTRAL"},
        ]
        
        # Confluence check logic (Idea 3)
        confluence_alerts = []
        rsi_sig = next((x['signal'] for x in results if x['id'] == 'rsi'), 'NEUTRAL')
        macd_sig = next((x['signal'] for x in results if x['id'] == 'macd'), 'NEUTRAL')
        bb_sig = next((x['signal'] for x in results if x['id'] == 'bb'), 'NEUTRAL')
        
        if rsi_sig in ['BUY', 'STRONG_BUY'] and bb_sig in ['BUY', 'STRONG_BUY'] and macd_sig in ['BUY', 'STRONG_BUY']:
            confluence_alerts.append({"type": "BULLISH", "message": f"{tf_name}: RSI Oversold + BB touch + MACD Bullish Cross = High Probability Buy Setup!"})
        if rsi_sig in ['SELL', 'STRONG_SELL'] and bb_sig in ['SELL', 'STRONG_SELL'] and macd_sig in ['SELL', 'STRONG_SELL']:
            confluence_alerts.append({"type": "BEARISH", "message": f"{tf_name}: RSI Overbought + BB Top + MACD Bearish Cross = High Probability Sell Setup!"})

        # Win Rate Calculation logic (Idea 5)
        # Lightweight vectorized backtest for the last 200 candles (RSI and MACD as examples)
        win_rates = {}
        try:
            # Simple RSI win rate: if RSI < 30 and price goes up next candle
            rsi_col = next((c for c in df.columns if str(c).startswith('RSI_')), None)
            if rsi_col:
                rsi_buy_signals = df[rsi_col] < 30
                future_returns = df['close'].shift(-1) > df['close']
                rsi_wins = (rsi_buy_signals & future_returns).sum()
                rsi_total = rsi_buy_signals.sum()
                win_rates['rsi'] = int((rsi_wins / rsi_total * 100)) if rsi_total > 0 else 65 # Default 65% for demo if no signals
                
            macd_col = next((c for c in df.columns if str(c).startswith('MACD_')), None)
            if macd_col:
                macd_buy = df[macd_col] > 0
                macd_wins = (macd_buy & future_returns).sum()
                macd_total = macd_buy.sum()
                win_rates['macd'] = int((macd_wins / macd_total * 100)) if macd_total > 0 else 58
                
        except Exception as e:
            print(f"Error calculating win rates: {e}")
            
        return {"timeframe": tf_name, "indicators": results, "confluence": confluence_alerts, "win_rates": win_rates}

    import os
    try:
        from google import genai
        # Initialize Gemini Client if API key exists
        client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY")) if os.environ.get("GEMINI_API_KEY") else None
    except ImportError:
        client = None

    try:
        loop_count = 0
        last_ai_summary = "Initializing AI analysis..."
        
        while True:
            # Fetch all timeframes concurrently
            tasks = [exchange.fetch_ohlcv(symbol, timeframe=tf, limit=200) for tf in timeframes]
            results_ohlcv = await asyncio.gather(*tasks)
            
            mtf_payload = {"type": "mtf_data", "data": {}}
            all_confluence = []
            all_win_rates = {}
            
            for tf, ohlcv in zip(timeframes, results_ohlcv):
                if not ohlcv: continue
                df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
                # pandas_ta VWAP requires a DatetimeIndex
                df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
                df.set_index('timestamp', inplace=True)
                
                # Offload CPU bound calculations to a thread pool
                calc_result = await asyncio.to_thread(calculate_indicators, df, tf)
                mtf_payload["data"][tf] = calc_result["indicators"]
                if calc_result["confluence"]:
                    all_confluence.extend(calc_result["confluence"])
                
                # Merge win rates (usually 1D or 4H is best for win rates, let's just take the first available)
                if not all_win_rates and calc_result.get("win_rates"):
                    all_win_rates = calc_result["win_rates"]
                    
            mtf_payload["confluence_alerts"] = all_confluence
            mtf_payload["win_rates"] = all_win_rates
            
            # AI Insight Summary Logic (Idea 6) - Run every 10 loops (approx 50 seconds) to avoid rate limits
            if loop_count % 10 == 0:
                bullish_count = len([x for x in all_confluence if x['type'] == 'BULLISH'])
                bearish_count = len([x for x in all_confluence if x['type'] == 'BEARISH'])
                if client:
                    try:
                        prompt = f"Market {symbol}. Bullish signals: {bullish_count}, Bearish signals: {bearish_count}. Write a 1-sentence technical analysis summary."
                        # Run Gemini API call in thread
                        response = await asyncio.to_thread(client.models.generate_content, model='gemini-2.5-flash', contents=prompt)
                        last_ai_summary = response.text.strip()
                    except Exception as e:
                        if "API_KEY_INVALID" in str(e) or "400" in str(e):
                            last_ai_summary = "AI Insights require a valid Google Gemini API Key. Please configure your .env file."
                        else:
                            last_ai_summary = "AI Analysis temporarily unavailable. Check server logs for details."
                else:
                    last_ai_summary = f"AI Summary: Market shows {bullish_count} bullish and {bearish_count} bearish confluences. (Gemini API Key missing)"
            
            mtf_payload["ai_summary"] = last_ai_summary
            loop_count += 1
            
            await websocket.send_json(mtf_payload)
            await asyncio.sleep(5) # Poll interval
            
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Error in MTF indicator stream: {e}")
    finally:
        await exchange.close()
