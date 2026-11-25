import React from 'react';
import CodeEditor from '@/components/common/CodeEditor';
import {
    Sparkles,
    Code2,
    Download,
    UploadCloud,
    FileCode2,
    Cpu,
    Zap,
} from 'lucide-react';

interface AIStrategyLabProps {
    aiPrompt: string;
    setAiPrompt: (p: string) => void;
    handleAiGenerate: () => void;
    isGenerating: boolean;
    fileInputRef: React.RefObject<HTMLInputElement>;
    handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleUpload: () => void;
    fileName: string;
    strategy: string;
    currentStrategyCode: string;
    setCurrentStrategyCode: (code: string) => void;
    onDownloadCode?: () => void;
}

export const AIStrategyLab: React.FC<AIStrategyLabProps> = ({
    aiPrompt,
    setAiPrompt,
    handleAiGenerate,
    isGenerating,
    fileInputRef,
    handleFileChange,
    handleUpload,
    fileName,
    strategy,
    currentStrategyCode,
    setCurrentStrategyCode,
    onDownloadCode,
}) => {
    const suggestions = [
        'Conservative trend following with 3x leverage and 5% SL',
        'Aggressive RSI + EMA momentum scalper',
        'Balanced MACD & Bollinger breakout',
    ];

    const handleDownloadLocal = () => {
        if (onDownloadCode) {
            onDownloadCode();
            return;
        }
        const blob = new Blob([currentStrategyCode], { type: 'text/x-python' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(strategy || 'strategy').replace(/\s+/g, '_')}.py`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 animate-fade-in h-full min-h-[460px]">
            {/* Left Panel: AI Control Center */}
            <div className="lg:col-span-4 flex flex-col gap-4 h-full">
                <div className="flex-1 bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-xl p-5 flex flex-col relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-blue-500" />

                    <div className="flex items-center gap-2.5 mb-3">
                        <div className="p-2 bg-gradient-to-br from-purple-600 to-blue-600 rounded-lg">
                            <Sparkles className="text-white w-4 h-4" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-slate-900 dark:text-white leading-tight">AI Strategy Architect</h2>
                            <p className="text-[10px] font-bold text-purple-500 uppercase tracking-wider">Generates Strategy + Risk Config</p>
                        </div>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
                        Describe your trading style, risk tolerance, or indicator rules. Generated code & risk parameters will populate automatically.
                    </p>

                    <div className="relative flex-1 flex flex-col">
                        <textarea
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            placeholder="Example: Conservative swing trend follower with EMA(50/200), 3x leverage, 5% stop loss..."
                            className="flex-1 min-h-[160px] w-full bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F] rounded-xl p-3.5 pb-12 text-xs text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500 transition-all resize-none font-mono"
                        />

                        <div className="absolute bottom-2.5 left-2.5 right-2.5 flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
                            {suggestions.map((s, i) => (
                                <button
                                    key={i}
                                    onClick={() => setAiPrompt(s)}
                                    className="whitespace-nowrap px-2 py-1 bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-md text-[10px] text-slate-500 hover:text-purple-400 hover:border-purple-500 transition-colors"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>

                    <button
                        onClick={handleAiGenerate}
                        disabled={isGenerating || !aiPrompt.trim()}
                        className="mt-4 w-full rounded-xl bg-brand-primary text-white text-xs font-bold py-3 shadow-lg shadow-brand-primary/20 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isGenerating ? (
                            <><Cpu className="animate-spin w-4 h-4" /> Synthesizing Strategy...</>
                        ) : (
                            <><Zap className="w-4 h-4 text-yellow-300" /> Generate Strategy & Apply Risk</>
                        )}
                    </button>
                </div>

                <div className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-xl p-4 flex flex-col justify-center">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2 mb-2.5">
                        <UploadCloud className="w-4 h-4 text-blue-500" /> Import Strategy (.py)
                    </h3>

                    <div className="flex gap-2 items-center">
                        <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".py" />
                        <div
                            className="flex-1 border border-dashed border-slate-300 dark:border-[#2A2A2A] rounded-lg p-2 flex items-center justify-center cursor-pointer hover:bg-slate-50 dark:hover:bg-[#111] transition-colors"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <span className="text-xs text-slate-500 truncate max-w-[160px]">
                                {fileName || 'Select .py file'}
                            </span>
                        </div>
                        <button
                            onClick={handleUpload}
                            disabled={!fileName}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Upload
                        </button>
                    </div>
                </div>
            </div>

            {/* Right Panel: Code Editor */}
            <div className="lg:col-span-8 h-full min-h-[420px]">
                <div className="h-full bg-[#1e1e1e] rounded-xl border border-slate-200 dark:border-[#1F1F1F] overflow-hidden flex flex-col">
                    <div className="h-10 bg-[#141414] border-b border-[#262626] flex items-center justify-between px-4 select-none">
                        <div className="flex items-center gap-3">
                            <div className="flex gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                                <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                            </div>
                            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#1e1e1e] rounded text-xs text-blue-400 font-mono border border-[#262626]">
                                <FileCode2 size={12} />
                                {strategy || 'strategy'}.py
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Python • Backtrader</span>
                            <button
                                onClick={handleDownloadLocal}
                                className="flex items-center gap-1.5 px-3 py-1 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 text-xs font-medium transition-colors border border-blue-600/30"
                            >
                                <Download size={12} /> Export .py
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 relative font-mono text-sm bg-[#1e1e1e]">
                        <CodeEditor
                            value={currentStrategyCode}
                            onChange={setCurrentStrategyCode}
                            language="python"
                        />

                        <div className="absolute bottom-0 left-0 right-0 h-6 bg-[#007acc] text-white text-[10px] flex items-center px-3 justify-between z-10 opacity-90">
                            <div className="flex gap-4">
                                <span>{strategy || 'custom'}.py</span>
                                <span className="flex items-center gap-1"><Code2 size={10} /> Python</span>
                            </div>
                            <span>Backtrader BaseStrategy</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
