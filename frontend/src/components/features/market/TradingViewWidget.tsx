import React, { useEffect, useId } from 'react';
import { useTheme } from '@/context/ThemeContext';

interface TradingViewWidgetProps {
    symbol: string;
    interval: string;
    theme?: 'light' | 'dark';
    exchange?: string;
}

// Map the generic timeframe strings to TradingView specific values
const getTVInterval = (tf: string) => {
    if (!tf) return '60';
    if (tf.includes('m')) return tf.replace('m', '');
    if (tf.includes('h')) return (parseInt(tf) * 60).toString();
    if (tf.includes('d')) return 'D';
    if (tf.includes('w')) return 'W';
    return '60'; // Default 1 hour
};

export const TradingViewWidget: React.FC<TradingViewWidgetProps> = ({ 
    symbol, 
    interval, 
    theme: propTheme, 
    exchange = 'BINANCE' 
}) => {
    const { theme: contextTheme } = useTheme();
    const effectiveTheme = propTheme || contextTheme || 'dark';
    const isDark = effectiveTheme === 'dark';

    // Unique container ID that updates with theme
    const reactId = useId().replace(/:/g, '_');
    const containerId = `tv_chart_container_${reactId}_${effectiveTheme}`;

    useEffect(() => {
        let isCancelled = false;

        const createWidget = () => {
            if (isCancelled) return;
            const container = document.getElementById(containerId);

            if (container) {
                container.innerHTML = '';

                // Replace / with empty string (e.g., BTC/USDT -> BTCUSDT)
                const cleanSymbol = symbol.replace('/', '').toUpperCase();
                const exch = (exchange || 'BINANCE').toUpperCase();
                const fullSymbol = exch ? `${exch}:${cleanSymbol}` : cleanSymbol;

                new (window as any).TradingView.widget({
                    "autosize": true,
                    "symbol": fullSymbol, 
                    "interval": getTVInterval(interval),
                    "timezone": "Etc/UTC",
                    "theme": isDark ? 'Dark' : 'Light',
                    "style": "1",
                    "locale": "en",
                    "toolbar_bg": isDark ? "#131722" : "#f1f3f6",
                    "enable_publishing": false,
                    "allow_symbol_change": true, 
                    "container_id": containerId,
                    "hide_side_toolbar": false,
                    "save_image": false,
                    "studies": []
                });
            }
        };

        const checkLibraryAndCreate = () => {
            if (isCancelled) return;
            if (typeof (window as any).TradingView !== 'undefined' && (window as any).TradingView.widget) {
                createWidget();
            } else {
                setTimeout(checkLibraryAndCreate, 100);
            }
        };

        checkLibraryAndCreate();

        return () => {
            isCancelled = true;
            const container = document.getElementById(containerId);
            if (container) {
                container.innerHTML = '';
            }
        };
    }, [effectiveTheme, isDark, symbol, interval, exchange, containerId]);

    return (
        <div className="w-full h-full bg-white dark:bg-[#0A0A0A] rounded-b-xl overflow-hidden relative transition-colors">
            <div 
                key={`${effectiveTheme}-${symbol}-${interval}-${exchange}`} 
                id={containerId} 
                className="absolute inset-0 w-full h-full" 
            />
        </div>
    );
};
