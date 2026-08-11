import React, { useEffect, useState } from 'react';

interface TradingViewWidgetProps {
    symbol: string;
    interval: string;
    theme?: 'light' | 'dark';
    exchange?: string;
}

// Map the generic timeframe strings to TradingView specific values
const getTVInterval = (tf: string) => {
    if (tf.includes('m')) return tf.replace('m', '');
    if (tf.includes('h')) return (parseInt(tf) * 60).toString();
    if (tf.includes('d')) return 'D';
    if (tf.includes('w')) return 'W';
    return '60'; // Default 1 hour
};

export const TradingViewWidget: React.FC<TradingViewWidgetProps> = ({ symbol, interval, theme = 'dark', exchange = 'BINANCE' }) => {
    const [widgetKey, setWidgetKey] = useState(Date.now());

    useEffect(() => {
        const createWidget = () => {
            const containerId = `tv_chart_container_${widgetKey}`;
            const container = document.getElementById(containerId);

            if (container) {
                container.innerHTML = '';

                // Replace / with empty string (e.g., BTC/USDT -> BTCUSDT)
                const cleanSymbol = symbol.replace('/', '');
                const fullSymbol = exchange ? `${exchange}:${cleanSymbol}` : cleanSymbol;

                new (window as any).TradingView.widget({
                    "autosize": true,
                    "symbol": fullSymbol, 
                    "interval": getTVInterval(interval),
                    "timezone": "Etc/UTC",
                    "theme": theme === 'dark' ? 'Dark' : 'Light',
                    "style": "1",
                    "locale": "en",
                    "toolbar_bg": "#f1f3f6",
                    "enable_publishing": false,
                    "allow_symbol_change": true, 
                    "container_id": containerId,
                    "hide_side_toolbar": false,
                    // Use localstorage for settings if possible
                    "save_image": false,
                    "studies": []
                });
            }
        };

        const checkLibraryAndCreate = () => {
            if (typeof (window as any).TradingView !== 'undefined' && (window as any).TradingView.widget) {
                createWidget();
            } else {
                setTimeout(checkLibraryAndCreate, 100);
            }
        };

        checkLibraryAndCreate();

        // Regenerate widget key on symbol/interval change if necessary, or just rely on the effect to clear innerHTML
    }, [theme, symbol, interval, widgetKey]);

    return (
        <div className="w-full h-full bg-white dark:bg-[#0A0A0A] rounded-b-xl overflow-hidden relative">
            <div id={`tv_chart_container_${widgetKey}`} className="absolute inset-0 w-full h-full" />
        </div>
    );
};
