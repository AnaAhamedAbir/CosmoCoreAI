import asyncio
import logging
import pandas as pd
import pandas_ta as ta
import mplfinance as mpf
import io

logger = logging.getLogger(__name__)

class TASnapshotService:
    @staticmethod
    def _generate_chart_image(df: pd.DataFrame, symbol: str, timeframe: str, actual_entry: float, side: str) -> bytes:
        # Create a copy to avoid modifying the original dataframe which might be used elsewhere
        plot_df = df.copy()
        plot_df['timestamp'] = pd.to_datetime(plot_df['timestamp'], unit='ms')
        plot_df.set_index('timestamp', inplace=True)
        
        # Take the last 50 candles for a better view
        plot_df = plot_df.tail(50)
        
        mc = mpf.make_marketcolors(up='#00ff00', down='#ff0000', edge='inherit', wick='inherit', volume='in')
        s  = mpf.make_mpf_style(marketcolors=mc, gridstyle=':', y_on_right=True, base_mpf_style='nightclouds')

        addplots = []
        if 'EMA_50' in plot_df.columns:
            addplots.append(mpf.make_addplot(plot_df['EMA_50'], color='cyan', width=1.5))
        if 'BBU_20_2.0' in plot_df.columns and 'BBL_20_2.0' in plot_df.columns:
            addplots.append(mpf.make_addplot(plot_df['BBU_20_2.0'], color='magenta', alpha=0.4))
            addplots.append(mpf.make_addplot(plot_df['BBL_20_2.0'], color='magenta', alpha=0.4))

        title = f"{symbol} ({timeframe}) - {side.upper()} @ {actual_entry}"
        hline_color = '#00ff00' if side.lower() in ['buy', 'long'] else '#ff0000'
        
        buf = io.BytesIO()
        mpf.plot(plot_df, type='candle', style=s, volume=True, 
                 addplot=addplots, 
                 hlines=dict(hlines=[actual_entry], colors=[hline_color], linestyle='-.', linewidths=2),
                 title=title, 
                 figsize=(8, 5),
                 savefig=dict(fname=buf, format='png', dpi=120, bbox_inches='tight'))
        
        buf.seek(0)
        return buf.read()

    @staticmethod
    async def send_snapshot_telegram(bot, actual_entry: float, side: str):
        """
        Fetches market data, calculates TA indicators at the exact time of entry,
        and sends a detailed Telegram notification.
        """
        try:
            logger.info(f"TASnapshotService called for {bot.symbol} at entry {actual_entry}")
            # 1. Check Configuration
            # Check if bot has config dict
            config = getattr(bot, 'config', {})
            # Defaulting to True so that it works out of the box before UI toggle is added
            enable_snapshot = True # Forced ON for now
            
            logger.info(f"TA Snapshot Enable Status: {enable_snapshot}")
            
            if not enable_snapshot:
                logger.info("TA Snapshot is disabled. Returning early.")
                return

            timeframe = config.get('ta_snapshot_timeframe', getattr(bot, 'ta_snapshot_timeframe', '15m'))
            symbol = bot.symbol
            exchange = bot.public_exchange
            
            logger.info(f"Using timeframe {timeframe} for {symbol}. Exchange: {exchange}")

            # Give a small delay to let the primary notification send first
            await asyncio.sleep(1.0)

            # 2. Fetch OHLCV data
            limit = 100
            ohlcv = await exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
            if not ohlcv or len(ohlcv) < 50:
                logger.warning(f"Not enough OHLCV data to generate TA snapshot for {symbol}")
                return

            df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])

            # 3. Calculate Indicators using pandas_ta
            # EMA 50
            df.ta.ema(length=50, append=True)
            ema_col = 'EMA_50'

            # RSI 14
            df.ta.rsi(length=14, append=True)
            rsi_col = 'RSI_14'

            # MACD (12, 26, 9)
            df.ta.macd(fast=12, slow=26, signal=9, append=True)
            macd_col = 'MACD_12_26_9'
            macds_col = 'MACDs_12_26_9'

            # Supertrend (10, 3)
            df.ta.supertrend(length=10, multiplier=3.0, append=True)
            st_dir_col = 'SUPERTd_10_3.0' # 1 for bull, -1 for bear

            # ATR 14
            df.ta.atr(length=14, append=True)
            atr_col = 'ATRr_14'

            # Bollinger Bands (20, 2)
            df.ta.bbands(length=20, std=2, append=True)
            bbl_col = 'BBL_20_2.0'
            bbu_col = 'BBU_20_2.0'
            bbm_col = 'BBM_20_2.0'

            # Average Volume (last 10 periods)
            avg_volume = df['volume'].tail(10).mean()

            # 4. Extract the latest values
            latest = df.iloc[-1]
            
            ema_50 = latest.get(ema_col, 0)
            rsi = latest.get(rsi_col, 50)
            macd_line = latest.get(macd_col, 0)
            macd_signal = latest.get(macds_col, 0)
            st_dir = latest.get(st_dir_col, 1)
            atr = latest.get(atr_col, 0)
            bbl = latest.get(bbl_col, 0)
            bbu = latest.get(bbu_col, 0)
            bbm = latest.get(bbm_col, 0)

            # 5. Format Interpretations
            # Trend
            trend_str = "Bullish 🟢" if actual_entry > ema_50 else "Bearish 🔴"
            
            # RSI
            if rsi >= 70:
                rsi_str = "Overbought 🔴"
            elif rsi <= 30:
                rsi_str = "Oversold 🟢"
            else:
                rsi_str = "Neutral ⚪"
                
            # MACD
            macd_str = "Bullish 🟢" if macd_line > macd_signal else "Bearish 🔴"
            
            # Supertrend
            st_str = "BUY 🟢" if st_dir == 1 else "SELL 🔴"
            
            # Bollinger Bands
            if bbu and bbl:
                if actual_entry >= bbu:
                    bb_str = "Touching Upper Band 📈"
                elif actual_entry <= bbl:
                    bb_str = "Touching Lower Band 📉"
                elif actual_entry > bbm:
                    bb_str = "Above Middle Band 🔼"
                else:
                    bb_str = "Below Middle Band 🔽"
            else:
                bb_str = "N/A"

            # 6. Format the Volume
            def format_volume(vol):
                if vol >= 1e6:
                    return f"{vol/1e6:.2f}M"
                elif vol >= 1e3:
                    return f"{vol/1e3:.2f}K"
                return f"{vol:.2f}"

            # 7. Fetch Futures Context (if available)
            futures_context = ""
            is_futures = getattr(bot, 'is_futures', False) or getattr(bot, 'exchange_type', '') == 'swap' or 'Futures' in str(type(bot))
            
            if is_futures:
                try:
                    # Funding Rate
                    funding_info = await exchange.fetch_funding_rate(symbol)
                    funding_rate = funding_info.get('fundingRate', 0)
                    funding_str = f"{funding_rate * 100:.4f}%" if funding_rate else "N/A"
                    
                    # Open Interest
                    oi_info = await exchange.fetch_open_interest(symbol)
                    oi_val = oi_info.get('openInterestValue') or oi_info.get('openInterestAmount', 0)
                    oi_str = format_volume(oi_val) if oi_val else "N/A"
                    
                    futures_context = (
                        f"\n⚙️ **Futures Context**\n"
                        f"• Funding Rate: {funding_str}\n"
                        f"• Open Interest: {oi_str}\n"
                    )
                except Exception as e:
                    logger.debug(f"Could not fetch futures context for {symbol}: {e}")

            # 8. Construct Message
            msg = (
                f"📊 **TA Snapshot @ Entry**\n"
                f"Pair: {symbol} ({timeframe})\n"
                f"Entry Price: {actual_entry:.6f}\n"
                f"\n"
                f"📈 **Trend & Momentum**\n"
                f"• EMA 50: {ema_50:.6f} ({trend_str})\n"
                f"• RSI (14): {rsi:.2f} ({rsi_str})\n"
                f"• MACD: {macd_str}\n"
                f"• Supertrend: {st_str}\n"
                f"\n"
                f"📊 **Volatility & Volume**\n"
                f"• Avg Volume (10p): {format_volume(avg_volume)}\n"
                f"• ATR (14): {atr:.6f}\n"
                f"• BB (20,2): {bb_str}\n"
                f"{futures_context}"
            )

            # 9. Generate Chart Image (Offload to thread to prevent blocking)
            photo_bytes = await asyncio.to_thread(TASnapshotService._generate_chart_image, df, symbol, timeframe, actual_entry, side)

            # 10. Send Telegram
            if hasattr(bot, '_send_telegram_photo'):
                await bot._send_telegram_photo(photo_bytes, msg)
            elif hasattr(bot, '_send_telegram'):
                await bot._send_telegram(msg)
            else:
                logger.warning("Bot instance has no _send_telegram method")

        except Exception as e:
            logger.error(f"Error generating TA Snapshot: {e}")

ta_snapshot_service = TASnapshotService()
