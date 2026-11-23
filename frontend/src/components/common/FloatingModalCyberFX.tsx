import React, { useEffect, useState } from 'react';

export type FloatingModalColor =
  | 'cyan'
  | 'teal'
  | 'orange'
  | 'purple'
  | 'indigo'
  | 'violet'
  | 'amber'
  | 'emerald';

interface FloatingModalCyberFXProps {
  color?: FloatingModalColor;
  isThermalGuard?: boolean;
}

export const FloatingModalCyberFX: React.FC<FloatingModalCyberFXProps> = ({
  color = 'cyan',
  isThermalGuard = false,
}) => {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (isThermalGuard) return;
    const timer = window.setTimeout(() => setDone(true), 700);
    return () => window.clearTimeout(timer);
  }, [isThermalGuard]);

  if (isThermalGuard || done) return null;

  const colorMap: Record<FloatingModalColor, { corner: string; beam: string }> = {
    cyan: {
      corner: 'border-cyan-400 shadow-[0_0_8px_#22d3ee]',
      beam: 'from-transparent via-cyan-300 via-white to-transparent shadow-[0_0_14px_#22d3ee]',
    },
    teal: {
      corner: 'border-teal-400 shadow-[0_0_8px_#2dd4bf]',
      beam: 'from-transparent via-teal-300 via-white to-transparent shadow-[0_0_14px_#2dd4bf]',
    },
    orange: {
      corner: 'border-orange-400 shadow-[0_0_8px_#fb923c]',
      beam: 'from-transparent via-orange-300 via-white to-transparent shadow-[0_0_14px_#fb923c]',
    },
    purple: {
      corner: 'border-purple-400 shadow-[0_0_8px_#c084fc]',
      beam: 'from-transparent via-purple-300 via-white to-transparent shadow-[0_0_14px_#c084fc]',
    },
    indigo: {
      corner: 'border-indigo-400 shadow-[0_0_8px_#818cf8]',
      beam: 'from-transparent via-indigo-300 via-white to-transparent shadow-[0_0_14px_#818cf8]',
    },
    violet: {
      corner: 'border-violet-400 shadow-[0_0_8px_#a78bfa]',
      beam: 'from-transparent via-violet-300 via-white to-transparent shadow-[0_0_14px_#a78bfa]',
    },
    amber: {
      corner: 'border-amber-400 shadow-[0_0_8px_#fbbf24]',
      beam: 'from-transparent via-amber-300 via-white to-transparent shadow-[0_0_14px_#fbbf24]',
    },
    emerald: {
      corner: 'border-emerald-400 shadow-[0_0_8px_#34d399]',
      beam: 'from-transparent via-emerald-300 via-white to-transparent shadow-[0_0_14px_#34d399]',
    },
  };

  const scheme = colorMap[color] || colorMap.cyan;

  return (
    <>
      {/* Reticles / Corner Brackets snapping in on open */}
      <div className="absolute inset-1 pointer-events-none z-50 animate-cosmo-modal-corner">
        <span className={`absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 rounded-tl-sm ${scheme.corner}`} />
        <span className={`absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 rounded-tr-sm ${scheme.corner}`} />
        <span className={`absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 rounded-bl-sm ${scheme.corner}`} />
        <span className={`absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 rounded-br-sm ${scheme.corner}`} />
      </div>

      {/* Horizon Laser Scan Sweep across top bar on open */}
      <div className="absolute top-0 left-0 right-0 h-[2px] pointer-events-none z-50 overflow-hidden">
        <div
          className={`w-full h-full animate-cosmo-modal-beam bg-gradient-to-r ${scheme.beam}`}
        />
      </div>
    </>
  );
};
