import React, { useEffect, useRef, useState, useCallback } from 'react';

export interface UseFloatingModalDragOptions {
  isOpen: boolean;
  storageKey: string;
  defaultWidth: number;
  defaultHeight: number;
  maxCapHeight?: number;
}

interface DragState {
  isDragging: boolean;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  currentX: number;
  currentY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function getViewportSize() {
  if (typeof window === 'undefined') {
    return { width: 1920, height: 1080 };
  }
  return {
    width: window.visualViewport?.width || window.innerWidth,
    height: window.visualViewport?.height || window.innerHeight,
  };
}

export function useFloatingModalDrag({
  isOpen,
  storageKey,
  defaultWidth,
  defaultHeight,
  maxCapHeight = 480,
}: UseFloatingModalDragOptions) {
  const modalContainerRef = useRef<HTMLDivElement>(null);
  const activeDragCleanupRef = useRef<(() => void) | null>(null);
  const hasUserDraggedRef = useRef(false);

  const [modalPos, setModalPos] = useState<{ x: number; y: number }>(() => {
    const { width: winW, height: winH } = getViewportSize();
    const isCompact = winH < 920 || winW < 1200;
    const targetW = Math.min(defaultWidth, winW - 12);
    const targetH = Math.min(defaultHeight, winH - 24);

    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
            hasUserDraggedRef.current = true;
            return {
              x: Math.max(6, Math.min(Math.max(6, winW - targetW - 6), parsed.x)),
              y: Math.max(isCompact ? 6 : 10, Math.min(Math.max(8, winH - targetH - 12), parsed.y)),
            };
          }
        }
      } catch {
        // Ignore storage read errors
      }
    }

    return {
      x: Math.max(6, Math.round((winW - targetW) / 2)),
      y: Math.max(isCompact ? 10 : 40, Math.round((winH - targetH) / 2)),
    };
  });

  const dragRef = useRef<DragState>({
    isDragging: false,
    startX: 0,
    startY: 0,
    originX: modalPos.x,
    originY: modalPos.y,
    currentX: modalPos.x,
    currentY: modalPos.y,
    minX: 6,
    maxX: 1200,
    minY: 6,
    maxY: 600,
  });

  const clampPos = useCallback(
    (pos: { x: number; y: number }) => {
      const { width: winW, height: winH } = getViewportSize();
      const isCompact = winH < 920 || winW < 1200;
      const modalW = modalContainerRef.current?.offsetWidth || Math.min(defaultWidth, winW - 12);
      const modalH = modalContainerRef.current?.offsetHeight || Math.min(defaultHeight, winH - 24);
      const topMargin = isCompact ? 6 : 10;
      const bottomMargin = isCompact ? 8 : 14;
      const effectiveH = Math.min(modalH, Math.max(220, winH - 180));

      return {
        x: Math.max(6, Math.min(Math.max(6, winW - modalW - 6), pos.x)),
        y: Math.max(topMargin, Math.min(Math.max(topMargin, winH - effectiveH - bottomMargin), pos.y)),
      };
    },
    [defaultWidth, defaultHeight]
  );

  // Re-clamp cleanly when opened, resized, or content height changes
  useEffect(() => {
    if (!isOpen) return;
    const modalEl = modalContainerRef.current;
    if (!modalEl) return;

    const applyClamp = () => {
      if (dragRef.current.isDragging) return;
      if (!hasUserDraggedRef.current) {
        const { width: winW, height: winH } = getViewportSize();
        const modalW = modalEl.offsetWidth || Math.min(defaultWidth, winW - 12);
        const modalH = modalEl.offsetHeight || Math.min(defaultHeight, winH - 24);
        const centered = clampPos({
          x: Math.round((winW - modalW) / 2),
          y: Math.round((winH - modalH) / 2),
        });
        setModalPos((prev) => (prev.x !== centered.x || prev.y !== centered.y ? centered : prev));
        return;
      }
      setModalPos((prev) => {
        const next = clampPos(prev);
        return next.x !== prev.x || next.y !== prev.y ? next : prev;
      });
    };

    const rafId = requestAnimationFrame(applyClamp);
    const resizeObserver = new ResizeObserver(applyClamp);
    resizeObserver.observe(modalEl);
    window.addEventListener('resize', applyClamp);
    window.visualViewport?.addEventListener('resize', applyClamp);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', applyClamp);
      window.visualViewport?.removeEventListener('resize', applyClamp);
    };
  }, [isOpen, clampPos, defaultWidth, defaultHeight]);

  // Safety cleanup on close or unmount
  useEffect(() => {
    if (!isOpen && activeDragCleanupRef.current) {
      activeDragCleanupRef.current();
    }
    return () => {
      if (activeDragCleanupRef.current) {
        activeDragCleanupRef.current();
      }
    };
  }, [isOpen]);

  const handleStartDrag = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const isTouch = 'touches' in e;
      if (!isTouch && (e as React.MouseEvent).button !== 0) return;

      const target = e.target as HTMLElement;
      if (
        target.closest('button') ||
        target.closest('input') ||
        target.closest('select') ||
        target.closest('[data-no-drag="true"]')
      ) {
        return;
      }

      const startClientX = isTouch ? e.touches[0]?.clientX : (e as React.MouseEvent).clientX;
      const startClientY = isTouch ? e.touches[0]?.clientY : (e as React.MouseEvent).clientY;
      if (startClientX === undefined || startClientY === undefined) return;

      if (!isTouch && e.cancelable) {
        e.preventDefault();
      }
      e.stopPropagation();

      if (activeDragCleanupRef.current) {
        activeDragCleanupRef.current();
      }

      const modalEl = modalContainerRef.current;
      const { width: winW, height: winH } = getViewportSize();
      const isCompact = winH < 920 || winW < 1200;
      const modalW = modalEl?.offsetWidth || Math.min(defaultWidth, winW - 12);
      const modalH = modalEl?.offsetHeight || Math.min(defaultHeight, winH - 24);
      const topMargin = isCompact ? 6 : 10;
      const bottomMargin = isCompact ? 8 : 14;
      const cap = isCompact ? Math.min(maxCapHeight, 440) : maxCapHeight;
      const effectiveH = Math.min(modalH, Math.max(220, winH - 180));

      const drag = dragRef.current;
      drag.isDragging = true;
      drag.startX = startClientX;
      drag.startY = startClientY;
      drag.originX = modalPos.x;
      drag.originY = modalPos.y;
      drag.currentX = modalPos.x;
      drag.currentY = modalPos.y;
      drag.minX = 6;
      drag.maxX = Math.max(6, winW - modalW - 6);
      drag.minY = topMargin;
      drag.maxY = Math.max(topMargin, winH - effectiveH - bottomMargin);

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
      document.body.style.pointerEvents = 'none';

      if (modalEl) {
        modalEl.style.pointerEvents = 'auto';
        modalEl.style.backdropFilter = 'none';
        (modalEl.style as unknown as { webkitBackdropFilter: string }).webkitBackdropFilter = 'none';
        modalEl.style.backgroundColor = document.documentElement.classList.contains('light')
          ? 'rgba(255, 255, 255, 0.98)'
          : 'rgba(7, 11, 20, 0.98)';
        modalEl.style.transition = 'none';
      }

      const applyMove = (clientX: number, clientY: number) => {
        if (!drag.isDragging) return;
        const clampedX = Math.max(drag.minX, Math.min(drag.maxX, drag.originX + (clientX - drag.startX)));
        const clampedY = Math.max(drag.minY, Math.min(drag.maxY, drag.originY + (clientY - drag.startY)));
        drag.currentX = clampedX;
        drag.currentY = clampedY;

        if (modalContainerRef.current) {
          const { height: curWinH } = getViewportSize();
          const dynamicMaxH = Math.max(220, Math.min(cap, Math.round(curWinH - clampedY - bottomMargin)));
          modalContainerRef.current.style.transform = `translate3d(${clampedX}px, ${clampedY}px, 0)`;
          modalContainerRef.current.style.maxHeight = `${dynamicMaxH}px`;
        }
      };

      const onMouseMove = (mv: MouseEvent) => applyMove(mv.clientX, mv.clientY);
      const onTouchMove = (tv: TouchEvent) => {
        if (!drag.isDragging) return;
        if (tv.cancelable) tv.preventDefault();
        const touch = tv.touches[0];
        if (touch) applyMove(touch.clientX, touch.clientY);
      };

      const cleanupDrag = () => {
        drag.isDragging = false;
        if (typeof document !== 'undefined') {
          document.body.style.userSelect = '';
          document.body.style.cursor = '';
          document.body.style.pointerEvents = '';
        }
        if (modalEl) {
          modalEl.style.pointerEvents = '';
          modalEl.style.backdropFilter = '';
          (modalEl.style as unknown as { webkitBackdropFilter: string }).webkitBackdropFilter = '';
          modalEl.style.backgroundColor = '';
          modalEl.style.transition = '';
        }
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onUp);
        window.removeEventListener('touchcancel', onUp);
        window.removeEventListener('blur', onUp);
        if (activeDragCleanupRef.current === cleanupDrag) {
          activeDragCleanupRef.current = null;
        }
      };

      const onUp = () => {
        if (!drag.isDragging) {
          cleanupDrag();
          return;
        }
        cleanupDrag();
        const finalPos = { x: drag.currentX, y: drag.currentY };
        setModalPos(finalPos);
        hasUserDraggedRef.current = true;
        try {
          localStorage.setItem(storageKey, JSON.stringify(finalPos));
        } catch {
          // Ignore storage write errors
        }
      };

      activeDragCleanupRef.current = cleanupDrag;
      window.addEventListener('mousemove', onMouseMove, { passive: true });
      window.addEventListener('mouseup', onUp);
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onUp);
      window.addEventListener('touchcancel', onUp);
      window.addEventListener('blur', onUp);
    },
    [modalPos, defaultWidth, defaultHeight, maxCapHeight, storageKey]
  );

  const { width: vw, height: vh } = getViewportSize();
  const isSmall = vh < 920 || vw < 1200;
  const activeY = dragRef.current.isDragging ? dragRef.current.currentY : modalPos.y;
  const activeX = dragRef.current.isDragging ? dragRef.current.currentX : modalPos.x;
  const maxHeightPx = Math.max(
    220,
    Math.min(isSmall ? Math.min(maxCapHeight, 440) : maxCapHeight, Math.round(vh - activeY - (isSmall ? 8 : 14)))
  );

  return {
    modalContainerRef,
    handleStartDrag,
    containerStyle: {
      left: 0,
      top: 0,
      transform: `translate3d(${activeX}px, ${activeY}px, 0)`,
      maxHeight: `${maxHeightPx}px`,
      willChange: 'transform',
    } as React.CSSProperties,
  };
}

