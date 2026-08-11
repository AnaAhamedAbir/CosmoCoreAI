import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Clock, AlertCircle, Filter, ZapOff, CheckCircle2, Search } from 'lucide-react';
import Button from '@/components/common/Button';

const ImpactBadge = ({ level }: { level: 'High' | 'Medium' | 'Low' }) => {
  const styles = {
    High: 'bg-red-500/10 text-red-500 border-red-500/20',
    Medium: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    Low: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  };
  
  return (
    <span className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded border ${styles[level]}`}>
      {level} Impact
    </span>
  );
};

const ForexCalendar = () => {
  // Mock Data for Economic Events
  const events = [
    { id: 1, time: '08:30 AM', currency: 'USD', event: 'Non-Farm Employment Change', impact: 'High', actual: '215K', forecast: '190K', previous: '185K', botAction: 'Paused' },
    { id: 2, time: '08:30 AM', currency: 'USD', event: 'Unemployment Rate', impact: 'High', actual: '3.8%', forecast: '3.9%', previous: '3.9%', botAction: 'Paused' },
    { id: 3, time: '10:00 AM', currency: 'EUR', event: 'ECB President Lagarde Speaks', impact: 'High', actual: '-', forecast: '-', previous: '-', botAction: 'Paused' },
    { id: 4, time: '01:30 PM', currency: 'CAD', event: 'Building Permits m/m', impact: 'Low', actual: '1.2%', forecast: '2.0%', previous: '-1.5%', botAction: 'Running' },
    { id: 5, time: '04:00 PM', currency: 'GBP', event: 'BOE Gov Bailey Speaks', impact: 'Medium', actual: '-', forecast: '-', previous: '-', botAction: 'Running' },
  ];

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
            <Calendar className="text-[#D4AF37]" size={28} />
            Economic Calendar
          </h1>
          <p className="text-gray-500 mt-1">Real-time macroeconomic events and automated bot safeguards.</p>
        </div>
        
        {/* Next Event Countdown Widget */}
        <div className="flex items-center gap-4 bg-red-500/5 border border-red-500/20 px-4 py-2 rounded-xl">
          <Clock className="text-red-500 animate-pulse" size={20} />
          <div>
            <p className="text-[10px] text-red-400 font-bold uppercase">Next High Impact Event</p>
            <p className="text-sm font-mono text-white font-bold">02:15:45 <span className="text-xs font-sans font-normal text-gray-400">until NFP</span></p>
          </div>
        </div>
      </div>

      {/* Filters and Controls */}
      <div className="flex flex-wrap gap-4 items-center justify-between p-4 rounded-2xl bg-white/5 dark:bg-[#0A101D]/80 border border-gray-200 dark:border-white/10">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-gray-500" size={16} />
            <input 
              type="text" 
              placeholder="Search events or currency..." 
              className="pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-[#D4AF37] w-64"
            />
          </div>
          <Button variant="outline" className="border-white/10 text-gray-400 hover:text-white hover:border-gray-500">
            <Filter size={16} className="mr-2" />
            Filters
          </Button>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span>Show Impact:</span>
          <label className="flex items-center gap-1 cursor-pointer hover:text-white"><input type="checkbox" defaultChecked className="accent-red-500" /> High</label>
          <label className="flex items-center gap-1 cursor-pointer hover:text-white"><input type="checkbox" defaultChecked className="accent-orange-500" /> Medium</label>
          <label className="flex items-center gap-1 cursor-pointer hover:text-white"><input type="checkbox" className="accent-emerald-500" /> Low</label>
        </div>
      </div>

      {/* Calendar Table */}
      <div className="rounded-2xl border bg-white/5 dark:bg-[#0A101D]/90 border-gray-200 dark:border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 dark:bg-[#121A2F]/50 border-b border-gray-200 dark:border-white/10">
                <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Time (Local)</th>
                <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Currency</th>
                <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Event</th>
                <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Impact</th>
                <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">Actual</th>
                <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">Forecast</th>
                <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">Previous</th>
                <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-center">Bot Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
              {events.map((ev) => (
                <tr key={ev.id} className="hover:bg-white/5 dark:hover:bg-white/5 transition-colors group">
                  <td className="p-4 text-sm font-mono text-gray-300">{ev.time}</td>
                  <td className="p-4">
                    <span className="flex items-center gap-2 text-sm font-bold text-white">
                      <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px]">
                        {ev.currency}
                      </div>
                      {ev.currency}
                    </span>
                  </td>
                  <td className="p-4 text-sm text-gray-300 group-hover:text-white transition-colors">{ev.event}</td>
                  <td className="p-4"><ImpactBadge level={ev.impact as any} /></td>
                  <td className="p-4 text-sm font-mono text-right font-bold text-emerald-400">{ev.actual}</td>
                  <td className="p-4 text-sm font-mono text-right text-gray-400">{ev.forecast}</td>
                  <td className="p-4 text-sm font-mono text-right text-gray-500">{ev.previous}</td>
                  <td className="p-4 text-center">
                    {ev.botAction === 'Paused' ? (
                      <div className="flex items-center justify-center gap-1 text-xs text-orange-400 bg-orange-500/10 px-2 py-1 rounded-md border border-orange-500/20 mx-auto w-max">
                        <ZapOff size={14} /> Paused
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20 mx-auto w-max">
                        <CheckCircle2 size={14} /> Running
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {/* Footer info */}
        <div className="p-4 border-t border-white/10 bg-white/5 flex items-center gap-3 text-xs text-gray-500">
          <AlertCircle size={14} className="text-[#D4AF37]" />
          Bots configured with "High-Impact News Filter" will automatically pause 30 minutes before and after events marked as High Impact.
        </div>
      </div>
    </motion.div>
  );
};

export default ForexCalendar;
