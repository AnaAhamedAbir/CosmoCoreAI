import re

file_path = r'e:\CosmoCoreAI\frontend\src\pages\app\PortfolioTracker.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# First replace exact specific large blocks to avoid regex collisions
content = content.replace(
    'bg-white/5 dark:bg-[#050505]/40 border border-white/10 dark:border-white/5',
    'bg-white/80 dark:bg-[#050505]/40 border border-slate-200 dark:border-white/10'
)

# Then apply the general regex replacements safely
replacements = {
    r'bg-white/5(?!\s*dark)': 'bg-slate-50 dark:bg-white/5',
    r'bg-white/10(?!\s*dark)': 'bg-slate-100 dark:bg-white/10',
    r'bg-white/20(?!\s*dark)': 'bg-slate-200 dark:bg-white/20',
    r'bg-\[\#050505\](?!\/)': 'bg-white dark:bg-[#050505]',
    
    r'border-white/5(?!\s*dark)': 'border-slate-200 dark:border-white/5',
    r'border-white/10(?!\s*dark)': 'border-slate-200 dark:border-white/10',
    r'border-white/20(?!\s*dark)': 'border-slate-300 dark:border-white/20',
    r'border-white/30(?!\s*dark)': 'border-slate-400 dark:border-white/30',
    r'border-white(?!\/)(?!\s*dark)': 'border-slate-300 dark:border-white',
    
    r'text-white/80(?!\s*dark)': 'text-slate-700 dark:text-white/80',
    r'text-white/60(?!\s*dark)': 'text-slate-600 dark:text-white/60',
    r'text-white/50(?!\s*dark)': 'text-slate-500 dark:text-white/50',
    r'text-white/40(?!\s*dark)': 'text-slate-500 dark:text-white/40',
    r'text-white/30(?!\s*dark)': 'text-slate-400 dark:text-white/30',
    r'text-white/20(?!\s*dark)': 'text-slate-400 dark:text-white/20',
    r'text-white/10(?!\s*dark)': 'text-slate-300 dark:text-white/10',
    r'text-white(?!\/)(?!\s*dark)': 'text-slate-900 dark:text-white',
    
    r'from-white via-white/90 to-white/70': 'from-slate-900 via-slate-700 to-slate-500 dark:from-white dark:via-white/90 dark:to-white/70',
    r'rgba\(255,255,255,0\.5\)': 'rgba(0,0,0,0.1) dark:rgba(255,255,255,0.5)',
}

for pattern, replacement in replacements.items():
    content = re.sub(pattern, replacement, content)

# Fix AreaChart tooltip and stroke
content = content.replace('stroke="#fff"', 'stroke="var(--chart-line, #6366F1)"')
content = content.replace('stopColor="#fff"', 'stopColor="var(--chart-line, #6366F1)"')

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Clean replacements done.')
