import React from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, X, Terminal } from 'lucide-react';
import { useFloatingModalDrag } from '@/hooks/useFloatingModalDrag';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';
import { BotLogsTab } from './BotLogsTab';

interface BotLogsFloatingModalProps {
  isOpen: boolean;
  onClose: () => void;
  botId?: number | null;
}

export const BotLogsFloatingModal: React.FC<BotLogsFloatingModalProps> = ({
  isOpen,
  onClose,
  botId,
}) => {
  const { isThermalGuardActive } = useDeviceProfile();
  const { modalContainerRef, handleStartDrag, containerStyle } = useFloatingModalDrag({
    isOpen,
    storageKey: 'cosmo_wallhunter_bot_logs_modal_pos_v1',
    defaultWidth: 640,
    defaultHeight: 460,
    maxCapHeight: 520,
  });

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={modalContainerRef}
      style={containerStyle}
      className={`cosmo-theme-modal fixed w-[640px] max-w-[calc(100vw-12px)] h-[460px] rounded-xl border z-[99999] overflow-hidden transition-colors duration-200 select-none flex flex-col ${
        isThermalGuardActive
          ? 'bg-[#080c16] border-purple-500/45 shadow-[0_14px_36px_rgba(0,0,0,0.92)]'
          : 'bg-[#070b14] bg-gradient-to-b from-[#0c1220]/95 via-[#080d1a]/[0.98] to-[#050811]/[0.98] border-purple-500/35 shadow-[0_14px_40px_rgba(0,0,0,0.85),0_0_20px_rgba(168,85,247,0.18),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl'
      }`}
    >
      {/* Top Neon Accent Line */}
      <div className="h-[1.5px] w-full bg-gradient-to-r from-transparent via-purple-500 to-indigo-500 opacity-85 shrink-0" />

      {/* Draggable Header */}
      <div
        onMouseDown={handleStartDrag}
        onTouchStart={handleStartDrag}
        style={{ touchAction: 'none' }}
        className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-white/10 bg-gray-50/80 dark:bg-white/[0.03] cursor-grab active:cursor-grabbing select-none shrink-0"
        title="Drag to move Terminal Logs"
      >
        <div className="flex items-center gap-2 pointer-events-none min-w-0">
          <GripVertical className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400 shrink-0" />
          <Terminal className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400 shrink-0" />
          <span className="text-[11px] font-black tracking-wide uppercase bg-clip-text text-transparent bg-gradient-to-r from-purple-500 to-indigo-400 truncate">
            WallHunter Bot Terminal Logs
          </span>
          <span className="text-[8.5px] font-mono font-bold px-1.5 py-0.2 rounded bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30 truncate max-w-[110px]">
            {botId ? `BOT #${botId}` : 'ALL BOTS'}
          </span>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="p-1 rounded-md bg-white/[0.04] hover:bg-rose-500/20 border border-gray-200 dark:border-white/[0.08] hover:border-rose-500/40 text-gray-400 hover:text-rose-500 dark:hover:text-rose-300 transition-all cursor-pointer shrink-0"
          title="Close Terminal Logs"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scrollable Body */}
      <div
        style={{ touchAction: 'pan-y' }}
        className="flex-1 min-h-0 overflow-hidden flex flex-col"
      >
        <BotLogsTab botId={botId} />
      </div>
    </div>,
    document.body
  );
};
