import { useState, useEffect } from 'react';
import React from 'react';
import { toast } from 'react-hot-toast';
import { subscribeMarketDepthEvents } from './useMarketDepthEvents';

export interface IcebergEvent {
    type: string;
    symbol: string;
    side: string;
    price: number;
    absorbed_vol: number;
    limit_vol_remaining: number;
    timestamp: number;
}

export const useIcebergEvents = (symbol: string, enabled: boolean = true) => {
    const [events, setEvents] = useState<IcebergEvent[]>([]);

    useEffect(() => {
        if (!symbol || !enabled) return;

        return subscribeMarketDepthEvents(symbol, (data: IcebergEvent) => {
            if (data && data.type === 'ICEBERG_DETECTED') {
                const eventWithTimestamp: IcebergEvent = {
                    ...data,
                    timestamp: Date.now(),
                };
                setEvents(prev => [...prev.slice(-49), eventWithTimestamp]);

                const isBuy = eventWithTimestamp.side === 'buy';
                const emoji = isBuy ? '🔥' : '🩸';
                const borderColor = isBuy ? 'border-blue-500' : 'border-red-500';
                const textColor = isBuy ? 'text-blue-400' : 'text-red-400';
                const absorbedFormatted = eventWithTimestamp.absorbed_vol.toLocaleString(undefined, { maximumFractionDigits: 0 });

                toast.custom((t) =>
                    React.createElement('div', {
                        key: t.id,
                        className: `bg-[#0f172a] border ${borderColor} border-l-4 p-4 rounded-lg shadow-xl text-white min-w-[300px] flex items-start gap-3 cursor-pointer`,
                        onClick: () => toast.dismiss(t.id),
                    },
                        React.createElement('div', { className: 'text-2xl leading-none mt-0.5' }, emoji),
                        React.createElement('div', { className: 'flex-1' },
                            React.createElement('h3', { className: `font-bold ${textColor} mb-1 text-sm uppercase tracking-wide` },
                                `Hidden Iceberg ${eventWithTimestamp.side.toUpperCase()} Wall`
                            ),
                            React.createElement('p', { className: 'text-xs text-gray-300' },
                                'Price: ',
                                React.createElement('span', { className: `font-mono font-bold ${textColor}` }, eventWithTimestamp.price)
                            ),
                            React.createElement('p', { className: 'text-xs text-gray-300 mt-0.5' },
                                'Absorbed: ',
                                React.createElement('span', { className: 'font-mono font-bold text-white' }, `$${absorbedFormatted}`)
                            ),
                            React.createElement('p', { className: 'text-[10px] text-gray-500 mt-1.5' },
                                'Institutional Reload Detected — Click to dismiss'
                            )
                        )
                    ),
                    { duration: 8000, position: 'bottom-right' }
                );
            }
        });
    }, [symbol, enabled]);

    return events;
};
