import type { IChartApi, LogicalRange } from 'lightweight-charts';

export interface ChartPaneSyncOptions {
    mainChart: IChartApi;
    subChart: IChartApi;
    subContainer: HTMLElement;
    /**
     * Returns candidate anchor timestamps (in seconds, priority order e.g. [last, prev, mid, first])
     * currently loaded in the sub-pane series so we find an exact shared bar between both charts.
     */
    getSubAnchorTimes: () => number[];
    /** Returns true while the sub-pane is applying setData() so programmatic updates never echo back. */
    isSubMutating?: () => boolean;
    /** Optional initial sync-lock state (default true). */
    initialLocked?: boolean;
}

export interface ChartPaneSyncController {
    /** Push mainChart's current logical range to subChart (preserving whitespace & rightOffset). */
    syncMainToSub: () => void;
    /** Align subChart's right/left price scale widths with mainChart so bars align vertically pixel-for-pixel. */
    syncPriceScales: () => void;
    /** Enable or disable linked time-scale syncing (when re-enabled, immediately snaps subChart to mainChart). */
    setLocked: (locked: boolean) => void;
    /** Clean up all chart subscriptions and DOM event listeners. */
    destroy: () => void;
}

/**
 * Computes the exact logical bar-index offset between subChart and mainChart:
 *   subLogicalIndex = mainLogicalIndex + offset
 *
 * First tries exact timestamp matches (`findNearest = false`) across candidate anchors so even if one
 * feed is 1-2 bars ahead/behind the other, alignment stays 0-bar-error exact. Falls back to nearest match.
 *
 * Unlike `setVisibleRange(timeRange)` (which strips left/right whitespace, strips `rightOffset`,
 * and clamps to data boundaries — causing violent auto-zoom-in on pan), logical-range syncing
 * with a timestamp-calibrated index offset preserves 100% of whitespace, barSpacing, and panning.
 */
export function computeTimestampIndexOffset(
    mainChart: IChartApi,
    subChart: IChartApi,
    anchorTimes: number[]
): number {
    if (!anchorTimes || anchorTimes.length === 0) return 0;

    const mainScale = mainChart.timeScale();
    const subScale = subChart.timeScale();

    try {
        // Pass 1: exact shared timestamp match (zero 1-bar drift if latest candle differs)
        for (let i = 0; i < anchorTimes.length; i++) {
            const t = anchorTimes[i];
            if (!Number.isFinite(t) || t <= 0) continue;
            const subIdx = subScale.timeToIndex(t as any, false);
            const mainIdx = mainScale.timeToIndex(t as any, false);
            if (
                typeof subIdx === 'number' &&
                Number.isFinite(subIdx) &&
                typeof mainIdx === 'number' &&
                Number.isFinite(mainIdx)
            ) {
                return subIdx - mainIdx;
            }
        }

        // Pass 2: nearest timestamp fallback
        for (let i = 0; i < anchorTimes.length; i++) {
            const t = anchorTimes[i];
            if (!Number.isFinite(t) || t <= 0) continue;
            const subIdx = subScale.timeToIndex(t as any, true);
            const mainIdx = mainScale.timeToIndex(t as any, true);
            if (
                typeof subIdx === 'number' &&
                Number.isFinite(subIdx) &&
                typeof mainIdx === 'number' &&
                Number.isFinite(mainIdx)
            ) {
                return subIdx - mainIdx;
            }
        }
    } catch {
        // Fallback safely to 0 if either chart has no indexed bars yet
    }
    return 0;
}

/**
 * Attaches institutional, zero-feedback-loop logical-range synchronization between a primary chart
 * and a sub-pane chart (e.g., CVD, Open Interest, Delta Oscillator).
 *
 * Key guarantees:
 * 1. Preserves zoom-out whitespace & rightOffset on both panes (no auto-zoom-in when panning).
 * 2. Strict pointer-owner gating: `sub -> main` ONLY runs while the user is actively interacting
 *    inside `subContainer` (supports arbitrarily long drags without timing out, and yields immediately
 *    when the user clicks or wheels on `mainChart`).
 * 3. Async-safe echo guard released via `requestAnimationFrame` instead of synchronously.
 * 4. Mirrors both right and left (e.g. RSI) price scale widths so vertical candle alignment stays exact.
 */
export function attachChartPaneSync(options: ChartPaneSyncOptions): ChartPaneSyncController {
    const {
        mainChart,
        subChart,
        subContainer,
        getSubAnchorTimes,
        isSubMutating,
        initialLocked = true,
    } = options;

    const mainTimeScale = mainChart.timeScale();
    const subTimeScale = subChart.timeScale();

    let isLocked = initialLocked;
    let activeDriver: 'main' | 'sub' | null = null;
    let isSubPointerPressed = false;
    let driverTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let suppressMainEcho = false;
    let suppressSubEcho = false;
    let mainEchoRafId: number | null = null;
    let subEchoRafId: number | null = null;
    let lastRightMinWidth = -1;
    let lastLeftMinWidth = -1;
    let destroyed = false;

    const clearDriverTimer = () => {
        if (driverTimeoutId !== null) {
            clearTimeout(driverTimeoutId);
            driverTimeoutId = null;
        }
    };

    const scheduleDriverClear = (delayMs: number) => {
        clearDriverTimer();
        driverTimeoutId = setTimeout(() => {
            if (!isSubPointerPressed) {
                activeDriver = null;
            }
            driverTimeoutId = null;
        }, delayMs);
    };

    const markMainDriver = () => {
        isSubPointerPressed = false;
        clearDriverTimer();
        if (activeDriver === 'sub') {
            activeDriver = 'main';
        }
    };

    const onSubPointerDown = () => {
        isSubPointerPressed = true;
        activeDriver = 'sub';
        clearDriverTimer();
    };

    const onSubTouchStart = () => {
        isSubPointerPressed = true;
        activeDriver = 'sub';
        clearDriverTimer();
    };

    const onSubWheel = () => {
        activeDriver = 'sub';
        scheduleDriverClear(350);
    };

    const onWindowPointerRelease = () => {
        if (isSubPointerPressed) {
            isSubPointerPressed = false;
            if (activeDriver === 'sub') {
                scheduleDriverClear(140);
            }
        }
    };

    const onWindowPointerDown = (ev: PointerEvent) => {
        const target = ev.target as Node | null;
        if (target && !subContainer.contains(target)) {
            markMainDriver();
        }
    };

    const onWindowWheel = (ev: WheelEvent) => {
        const target = ev.target as Node | null;
        if (target && !subContainer.contains(target)) {
            markMainDriver();
        }
    };

    subContainer.addEventListener('pointerdown', onSubPointerDown, { capture: true, passive: true });
    subContainer.addEventListener('touchstart', onSubTouchStart, { capture: true, passive: true });
    subContainer.addEventListener('wheel', onSubWheel, { capture: true, passive: true });
    window.addEventListener('pointerup', onWindowPointerRelease, { passive: true });
    window.addEventListener('pointercancel', onWindowPointerRelease, { passive: true });
    window.addEventListener('touchend', onWindowPointerRelease, { passive: true });
    window.addEventListener('blur', onWindowPointerRelease, { passive: true });
    window.addEventListener('pointerdown', onWindowPointerDown, { capture: true, passive: true });
    window.addEventListener('wheel', onWindowWheel, { capture: true, passive: true });

    const releaseSubEchoNextFrame = () => {
        if (subEchoRafId !== null) cancelAnimationFrame(subEchoRafId);
        subEchoRafId = requestAnimationFrame(() => {
            suppressSubEcho = false;
            subEchoRafId = null;
        });
    };

    const releaseMainEchoNextFrame = () => {
        if (mainEchoRafId !== null) cancelAnimationFrame(mainEchoRafId);
        mainEchoRafId = requestAnimationFrame(() => {
            suppressMainEcho = false;
            mainEchoRafId = null;
        });
    };

    const syncPriceScales = () => {
        if (destroyed) return;
        try {
            const mainRightWidth = mainChart.priceScale('right').width();
            if (Number.isFinite(mainRightWidth) && mainRightWidth > 0) {
                const targetRight = Math.max(64, Math.ceil(mainRightWidth));
                if (targetRight !== lastRightMinWidth) {
                    lastRightMinWidth = targetRight;
                    subChart.priceScale('right').applyOptions({
                        minimumWidth: targetRight,
                    });
                }
            }

            // Mirror left price scale spacer if mainChart shows a left axis (e.g. RSI enabled)
            const mainLeftWidth = mainChart.priceScale('left').width();
            const targetLeft = Number.isFinite(mainLeftWidth) && mainLeftWidth > 0 ? Math.ceil(mainLeftWidth) : 0;
            if (targetLeft !== lastLeftMinWidth) {
                lastLeftMinWidth = targetLeft;
                if (targetLeft > 0) {
                    subChart.priceScale('left').applyOptions({
                        visible: true,
                        minimumWidth: targetLeft,
                        borderVisible: false,
                        ticksVisible: false,
                        textColor: 'rgba(0, 0, 0, 0)',
                    });
                } else {
                    subChart.priceScale('left').applyOptions({
                        visible: false,
                        minimumWidth: 0,
                    });
                }
            }
        } catch {
            // Ignore if chart is disposed mid-frame
        }
    };

    const applyMainLogicalToSub = (mainLogical: LogicalRange | null) => {
        if (destroyed || !isLocked || !mainLogical) return;
        if (!Number.isFinite(mainLogical.from) || !Number.isFinite(mainLogical.to)) return;
        if (mainLogical.to <= mainLogical.from) return;

        const anchorTimes = getSubAnchorTimes();
        if (!anchorTimes || anchorTimes.length === 0) return;

        const offset = computeTimestampIndexOffset(mainChart, subChart, anchorTimes);
        suppressSubEcho = true;
        try {
            subTimeScale.setVisibleLogicalRange({
                from: mainLogical.from + offset,
                to: mainLogical.to + offset,
            });
        } catch {
            // Ignore transient disposed/empty errors
        } finally {
            releaseSubEchoNextFrame();
        }
    };

    const handleMainLogicalChange = (mainLogical: LogicalRange | null) => {
        if (destroyed || !isLocked || suppressMainEcho) return;
        if (activeDriver === 'sub') return;
        applyMainLogicalToSub(mainLogical);
    };

    const handleSubLogicalChange = (subLogical: LogicalRange | null) => {
        if (destroyed || !isLocked || suppressSubEcho) return;
        if (isSubMutating && isSubMutating()) return;
        // CRITICAL: Only allow subChart to drive mainChart when the user is actively interacting inside subContainer
        if (activeDriver !== 'sub') return;
        if (!subLogical || !Number.isFinite(subLogical.from) || !Number.isFinite(subLogical.to)) return;
        if (subLogical.to <= subLogical.from) return;

        const anchorTimes = getSubAnchorTimes();
        if (!anchorTimes || anchorTimes.length === 0) return;

        const offset = computeTimestampIndexOffset(mainChart, subChart, anchorTimes);
        suppressMainEcho = true;
        try {
            mainTimeScale.setVisibleLogicalRange({
                from: subLogical.from - offset,
                to: subLogical.to - offset,
            });
        } catch {
            // Ignore transient errors
        } finally {
            releaseMainEchoNextFrame();
        }
    };

    const handleMainSizeChange = () => {
        if (destroyed) return;
        syncPriceScales();
        if (isLocked && activeDriver !== 'sub') {
            applyMainLogicalToSub(mainTimeScale.getVisibleLogicalRange());
        }
    };

    mainTimeScale.subscribeVisibleLogicalRangeChange(handleMainLogicalChange);
    subTimeScale.subscribeVisibleLogicalRangeChange(handleSubLogicalChange);
    mainTimeScale.subscribeSizeChange(handleMainSizeChange);

    // Initial alignment
    syncPriceScales();
    if (isLocked) {
        applyMainLogicalToSub(mainTimeScale.getVisibleLogicalRange());
    }

    return {
        syncMainToSub: () => {
            if (destroyed || !isLocked) return;
            syncPriceScales();
            applyMainLogicalToSub(mainTimeScale.getVisibleLogicalRange());
        },
        syncPriceScales,
        setLocked: (locked: boolean) => {
            isLocked = locked;
            isSubPointerPressed = false;
            activeDriver = null;
            clearDriverTimer();
            if (locked && !destroyed) {
                syncPriceScales();
                applyMainLogicalToSub(mainTimeScale.getVisibleLogicalRange());
            }
        },
        destroy: () => {
            destroyed = true;
            isSubPointerPressed = false;
            clearDriverTimer();
            if (mainEchoRafId !== null) cancelAnimationFrame(mainEchoRafId);
            if (subEchoRafId !== null) cancelAnimationFrame(subEchoRafId);
            subContainer.removeEventListener('pointerdown', onSubPointerDown, { capture: true });
            subContainer.removeEventListener('touchstart', onSubTouchStart, { capture: true });
            subContainer.removeEventListener('wheel', onSubWheel, { capture: true });
            window.removeEventListener('pointerup', onWindowPointerRelease);
            window.removeEventListener('pointercancel', onWindowPointerRelease);
            window.removeEventListener('touchend', onWindowPointerRelease);
            window.removeEventListener('blur', onWindowPointerRelease);
            window.removeEventListener('pointerdown', onWindowPointerDown, { capture: true });
            window.removeEventListener('wheel', onWindowWheel, { capture: true });
            try {
                mainTimeScale.unsubscribeVisibleLogicalRangeChange(handleMainLogicalChange);
                subTimeScale.unsubscribeVisibleLogicalRangeChange(handleSubLogicalChange);
                mainTimeScale.unsubscribeSizeChange(handleMainSizeChange);
            } catch {}
        },
    };
}
