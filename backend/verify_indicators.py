import asyncio
import pandas as pd
import pandas_ta as ta
import ccxt.async_support as ccxt
import json

async def verify():
    print("Testing CCXT and Pandas TA logic...")
    exchange = ccxt.binance({'enableRateLimit': True})
    try:
        ohlcv = await exchange.fetch_ohlcv('BTC/USDT', timeframe='1h', limit=200)
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
        
        for length in [5, 10, 20, 50, 100, 200]:
            df.ta.sma(length=length, append=True)
            df.ta.ema(length=length, append=True)
        df.ta.wma(length=20, append=True)
        df.ta.vwma(length=20, append=True)
        df.ta.hma(length=9, append=True)
        
        df.ta.adx(length=14, append=True)
        df.ta.bbands(length=20, std=2, append=True)
        df.ta.atr(length=14, append=True)
        df.ta.kc(length=20, scalar=1.5, append=True)
        df.ta.donchian(length=20, append=True)
        df.ta.psar(append=True)
        
        try: df.ta.supertrend(append=True)
        except Exception as e: print(f"Supertrend error: {e}")
        try: df.ta.aroon(append=True)
        except Exception as e: print(f"Aroon error: {e}")
        try: df.ta.kst(append=True)
        except Exception as e: print(f"KST error: {e}")
        try: df.ta.cmo(append=True)
        except Exception as e: print(f"CMO error: {e}")
        
        df.ta.obv(append=True)
        df.ta.cmf(append=True)
        df.ta.vwap(append=True)
        df.ta.pvt(append=True)
        df.ta.efi(append=True) # Force Index
        df.ta.eom(append=True)
        
        try: df.ta.squeeze(append=True)
        except Exception as e: print(f"Squeeze error: {e}")
        
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
            {"id": "sma5", "value": f"{last_row.get('SMA_5', close):.2f}", "signal": ma_sig(last_row.get('SMA_5', close), close)},
            {"id": "adx", "value": f"{last_row.get('ADX_14', 20):.2f}", "signal": "NEUTRAL"},
            {"id": "psar", "value": f"{get_col_val('PSARl_', close):.2f}", "signal": "BUY" if get_col_val('PSARdir_') == 1 else "SELL"},
            {"id": "ichimoku", "value": f"Cloud", "signal": "BUY" if close > get_col_val('ISA_') else "SELL"},
            {"id": "supertrend", "value": f"{get_col_val('SUPERT_', close):.2f}", "signal": "BUY" if get_col_val('SUPERTd_') == 1 else "SELL"},
            {"id": "aroon", "value": f"{get_col_val('AROONOSC_', 0):.2f}", "signal": sig(get_col_val('AROONOSC_', 0), -50, 50, invert=True)},
            {"id": "dmi", "value": f"+{last_row.get('DMP_14', 0):.0f} / -{last_row.get('DMN_14', 0):.0f}", "signal": "BUY" if last_row.get('DMP_14', 0) > last_row.get('DMN_14', 0) else "SELL"},
            {"id": "kst", "value": f"{get_col_val('KST_', 0):.2f}", "signal": sig(get_col_val('KST_', 0), -1, 1, invert=True)},
            {"id": "cmo", "value": f"{get_col_val('CMO_', 0):.2f}", "signal": sig(get_col_val('CMO_', 0), -50, 50, invert=True)},
            {"id": "bb", "value": f"{last_row.get('BBL_20_2.0', close):.2f}", "signal": "BUY" if close < last_row.get('BBL_20_2.0', 0) else "SELL"},
            {"id": "atr", "value": f"{last_row.get('ATRr_14', 0):.2f}", "signal": "NEUTRAL"},
            {"id": "keltner", "value": f"{last_row.get('KCLs_20_1.5', close):.2f}", "signal": "BUY"},
            {"id": "donchian", "value": f"{last_row.get('DCL_20_20', close):.2f}", "signal": "BUY"},
            {"id": "obv", "value": f"{get_col_val('OBV', 0)/1000:.1f}k", "signal": "NEUTRAL"},
            {"id": "cmf", "value": f"{get_col_val('CMF_', 0):.2f}", "signal": sig(get_col_val('CMF_', 0), -0.1, 0.1, invert=True)},
            {"id": "vwap", "value": f"{get_col_val('VWAP_D', close):.2f}", "signal": ma_sig(get_col_val('VWAP_D', close), close)},
            {"id": "pvt", "value": f"{get_col_val('PVT', 0)/1000:.1f}k", "signal": "NEUTRAL"},
            {"id": "fi", "value": f"{get_col_val('EFI_', 0)/1000:.1f}k", "signal": sig(get_col_val('EFI_', 0), -100, 100, invert=True)},
            {"id": "eom", "value": f"{get_col_val('EOM_', 0):.2f}", "signal": "NEUTRAL"},
            {"id": "sqz", "value": f"{get_col_val('SQZ_', 0):.2f}", "signal": "BUY" if get_col_val('SQZ_ON_', 0) == 1 else "NEUTRAL"},
        ]
        
        print("Success! Processed indicators:")
        print(json.dumps(results, indent=2))
        
    except Exception as e:
        print(f"Error during verification: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await exchange.close()

if __name__ == '__main__':
    asyncio.run(verify())
