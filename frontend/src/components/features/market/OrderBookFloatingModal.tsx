import React from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, X } from 'lucide-react';
import { useFloatingModalDrag } from '@/hooks/useFloatingModalDrag';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';

interface OrderBookFloatingModalProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  children: React.ReactNode;
}

export const OrderBookFloatingModal: React.FC<OrderBookFloatingModalProps> = ({
  isOpen,
  onClose,
  symbol,
  children,
}) => {
  const { isThermalGuardActive } = useDeviceProfile();
  const { modalContainerRef, handleStartDrag, containerStyle } = useFloatingModalDrag({
    isOpen,
    storageKey: 'cosmo_l2_orderbook_modal_pos_v1',
    defaultWidth: 350,
    defaultHeight: 430,
    maxCapHeight: 455,
  });

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={modalContainerRef}
      style={containerStyle}
      className={`cosmo-theme-modal fixed w-[350px] max-w-[calc(100vw-12px)] h-[430px] rounded-xl border z-[99999] overflow-hidden transition-colors duration-200 select-none flex flex-col ${
        isThermalGuardActive
          ? 'bg-[#080c16] border-cyan-500/45 shadow-[0_14px_36px_rgba(0,0,0,0.92)]'
          : 'bg-[#070b14] bg-gradient-to-b from-[#0c1220]/95 via-[#080d1a]/[0.98] to-[#050811]/[0.98] border-cyan-500/35 shadow-[0_14px_40px_rgba(0,0,0,0.85),0_0_20px_rgba(6,182,212,0.18),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl'
      }`}
    >
      {/* Top Neon Accent Line */}
      <div className="h-[1.5px] w-full bg-gradient-to-r from-transparent via-cyan-400 to-blue-500 opacity-85 shrink-0" />

      {/* Draggable Header */}
      <div
        onMouseDown={handleStartDrag}
        onTouchStart={handleStartDrag}
        style={{ touchAction: 'none' }}
        className="flex items-center justify-between px-2.5 py-1.5 border-b border-white/10 bg-white/[0.03] cursor-grab active:cursor-grabbing select-none shrink-0"
        title="Drag to move Order Book"
      >
        <div className="flex items-center gap-1.5 pointer-events-none min-w-0">
          <GripVertical className="w-3.5 h-3.5 text-cyan-400/80 shrink-0" />
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
          <span className="text-[11px] font-black tracking-wide uppercase bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-400 truncate">
            L2 Order Book
          </span>
          <span className="text-[8.5px] font-mono font-bold px-1.5 py-0.2 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 truncate max-w-[90px]">
            {symbol}
          </span>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="p-1 rounded-md bg-white/[0.04] hover:bg-rose-500/20 border border-white/[0.08] hover:border-rose-500/40 text-gray-400 hover:text-rose-300 transition-all cursor-pointer shrink-0"
          title="Close Level 2 Order Book"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Compact Scrollable Body */}
      <div
        style={{ touchAction: 'pan-y' }}
        className="flex-1 min-h-0 overflow-hidden p-1.5 flex flex-col"
      >
        {children}
      </div>
    </div>,
    document.body
  );
};

