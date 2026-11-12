import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useTheme } from '@/context/ThemeContext';

interface SocialDominanceData {
    timestamp: string;
    BTC: number;
    ETH: number;
    SOL: number;
    Others: number;
}

interface SocialDominanceChartProps {
    data: SocialDominanceData[];
}

const SocialDominanceChart: React.FC<SocialDominanceChartProps> = ({ data }) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    if (!data || data.length === 0) {
        return <div className="text-slate-500 dark:text-gray-400 text-center py-10">No Social Dominance Data Available</div>;
    }

    return (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-md dark:shadow-lg border border-slate-200 dark:border-gray-700">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Social Volume Dominance</h3>
            <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                        data={data}
                        margin={{
                            top: 10,
                            right: 30,
                            left: 0,
                            bottom: 0,
                        }}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#374151' : '#E2E8F0'} />
                        <XAxis dataKey="timestamp" stroke={isDark ? '#9CA3AF' : '#64748B'} />
                        <YAxis stroke={isDark ? '#9CA3AF' : '#64748B'} />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
                                borderColor: isDark ? '#374151' : '#E2E8F0',
                                color: isDark ? '#F3F4F6' : '#0F172A'
                            }}
                            itemStyle={{ color: isDark ? '#F3F4F6' : '#0F172A' }}
                        />
                        <Legend />
                        <Area type="monotone" dataKey="BTC" stackId="1" stroke="#F7931A" fill="#F7931A" />
                        <Area type="monotone" dataKey="ETH" stackId="1" stroke="#627EEA" fill="#627EEA" />
                        <Area type="monotone" dataKey="SOL" stackId="1" stroke="#14F195" fill="#14F195" />
                        <Area type="monotone" dataKey="Others" stackId="1" stroke="#9CA3AF" fill="#9CA3AF" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default SocialDominanceChart;
