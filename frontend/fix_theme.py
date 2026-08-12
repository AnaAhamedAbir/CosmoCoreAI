import re

file_path = r'e:\CosmoCoreAI\frontend\src\pages\app\PortfolioTracker.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replacements for background and borders
content = content.replace('bg-white/5 dark:bg-[#050505]/40', 'bg-white dark:bg-[#050505]/40')
content = content.replace('bg-white/5 border border-white/10', 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10')
content = content.replace('bg-[#050505]', 'bg-white dark:bg-[#050505]')
content = content.replace('bg-white/5 border border-white/5', 'bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/5')
content = content.replace('bg-white/10', 'bg-slate-100 dark:bg-white/10')
content = content.replace('bg-white/5', 'bg-slate-50 dark:bg-white/5')
content = content.replace('border-white/10', 'border-slate-200 dark:border-white/10')
content = content.replace('border-white/5', 'border-slate-200 dark:border-white/5')
content = content.replace('border-white/20', 'border-slate-300 dark:border-white/20')
content = content.replace('border border-white ', 'border border-slate-300 dark:border-white ')

# Replacements for text
content = content.replace('text-white/40', 'text-slate-500 dark:text-white/40')
content = content.replace('text-white/30', 'text-slate-400 dark:text-white/30')
content = content.replace('text-white/20', 'text-slate-400 dark:text-white/20')
content = content.replace('text-white/10', 'text-slate-300 dark:text-white/10')
content = content.replace('text-white/50', 'text-slate-500 dark:text-white/50')
content = content.replace('text-white/60', 'text-slate-600 dark:text-white/60')
content = content.replace('text-white/80', 'text-slate-700 dark:text-white/80')
content = content.replace('text-white', 'text-slate-900 dark:text-white')

# Specific fixes
content = content.replace('from-white via-white/90 to-white/70', 'from-slate-900 via-slate-700 to-slate-500 dark:from-white dark:via-white/90 dark:to-white/70')
content = content.replace('rgba(255,255,255,0.5)', 'rgba(0,0,0,0.1) dark:rgba(255,255,255,0.5)') # Drop shadow

# Fixing the tooltip gradient stroke inside AreaChart
content = content.replace('stroke="#fff"', 'stroke="var(--chart-line, #6366F1)"')

# Add dark mode styles to GlassCard
content = content.replace(
    'backdrop-blur-xl bg-white dark:bg-[#050505]/40 border border-slate-200 dark:border-white/10 rounded-[2rem] shadow-[0_8px_32px_0_rgba(0,0,0,0.36)] overflow-hidden',
    'backdrop-blur-xl bg-white dark:bg-[#050505]/40 border border-slate-200 dark:border-white/10 rounded-[2rem] shadow-xl dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.36)] overflow-hidden'
)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Replacements done.')
