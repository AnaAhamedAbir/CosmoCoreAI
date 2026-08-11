const fs = require('fs');
const path = require('path');

const targetDirs = [
  path.join(__dirname, '../src/pages/app'),
  path.join(__dirname, '../src/components')
];

const classMap = {
  'bg-slate-900': 'bg-[#050505]',
  'dark:bg-slate-900': 'dark:bg-[#050505]',
  'bg-slate-800/50': 'bg-[#0A0A0A]/50',
  'dark:bg-slate-800/50': 'dark:bg-[#0A0A0A]/50',
  'bg-slate-800': 'bg-[#0A0A0A]',
  'dark:bg-slate-800': 'dark:bg-[#0A0A0A]',
  'bg-slate-700': 'bg-[#141414]',
  'dark:bg-slate-700': 'dark:bg-[#141414]',
  'border-slate-800': 'border-[#141414]',
  'dark:border-slate-800': 'dark:border-[#141414]',
  'border-slate-700': 'border-[#1F1F1F]',
  'dark:border-slate-700': 'dark:border-[#1F1F1F]',
  'bg-[#141414]': 'bg-[#0A0A0A]', // Because I see #141414 was used for some cards, let's make it darker #0A0A0A
  'bg-brand-darkest': 'bg-[#000000]', // Just in case
  'dark:bg-brand-darkest/50': 'dark:bg-[#000000]/50',
  'bg-slate-900/80': 'bg-[#050505]/80',
  'dark:bg-[#1e293b]': 'dark:bg-[#0A0A0A]',
  'bg-[#1e293b]': 'bg-[#0A0A0A]'
};

let filesModified = 0;

function processDirectory(directory) {
  if (!fs.existsSync(directory)) return;
  
  const files = fs.readdirSync(directory);
  
  for (const file of files) {
    const fullPath = path.join(directory, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      processDirectory(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts') || fullPath.endsWith('.jsx') || fullPath.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let modified = false;
      
      for (const [oldClass, newClass] of Object.entries(classMap)) {
        if (content.includes(oldClass)) {
          content = content.split(oldClass).join(newClass);
          modified = true;
        }
      }
      
      if (modified) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`Updated slate classes in: ${fullPath}`);
        filesModified++;
      }
    }
  }
}

console.log('Starting slate class replacement...');
targetDirs.forEach(dir => processDirectory(dir));
console.log(`Finished! Modified ${filesModified} files.`);
