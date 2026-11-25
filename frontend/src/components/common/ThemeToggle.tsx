import React, { useState } from 'react';
import { useTheme } from '@/context/ThemeContext';

const SunIcon: React.FC<{ className?: string }> = ({ className = "h-5 w-5" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
);

const MoonIcon: React.FC<{ className?: string }> = ({ className = "h-5 w-5" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
);

const ThemeToggle: React.FC = () => {
    const { theme, toggleTheme, setTheme } = useTheme();
    const [isRotating, setIsRotating] = useState(false);

    const handleToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
        setIsRotating(true);
        setTimeout(() => setIsRotating(false), 550);

        if (toggleTheme) {
            toggleTheme(e);
        } else {
            setTheme(theme === 'dark' ? 'light' : 'dark', { clientX: e.clientX, clientY: e.clientY });
        }
    };

    const isDark = theme === 'dark';

    return (
        <button
            type="button"
            onClick={handleToggle}
            className={`group relative w-9 h-9 rounded-xl flex items-center justify-center border transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500/40 select-none cursor-pointer ${
                isDark
                    ? 'text-amber-400 hover:text-amber-300 bg-[#0B1120] hover:bg-amber-400/10 border-slate-800/80 hover:border-amber-400/40'
                    : 'text-indigo-600 hover:text-indigo-500 bg-slate-100 hover:bg-indigo-50 border-slate-200 hover:border-indigo-400/40'
            }`}
            aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        >
            <div className={`transition-transform duration-300 ${
                isRotating ? 'rotate-180 scale-105' : 'rotate-0 scale-100'
            }`}>
                {isDark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
            </div>
        </button>
    );
};

export default ThemeToggle;


