import type { IChartApi, ISeriesApi, ISeriesPrimitive } from 'lightweight-charts';

const disposedCharts = new WeakSet<object>();

/**
 * Checks whether a Lightweight Charts instance has already been disposed via safeRemoveChart.
 */
export function isChartDisposed(chart: IChartApi | null | undefined): boolean {
    if (!chart) return true;
    return disposedCharts.has(chart as unknown as object);
}

/**
 * Marks a chart as disposed BEFORE calling chart.remove() so any child React effect
 * cleanups or animation frames know not to call detachPrimitive/applyOptions on it.
 */
export function safeRemoveChart(chart: IChartApi | null | undefined): void {
    if (!chart) return;
    if (disposedCharts.has(chart as unknown as object)) return;
    disposedCharts.add(chart as unknown as object);
    try {
        chart.remove();
    } catch {
        // Ignore if already disposed
    }
}

/**
 * Detaches a series primitive only if the owning chart has NOT already been disposed.
 * Calling series.detachPrimitive() after chart.remove() schedules a requestAnimationFrame
 * redraw on a disposed chart in lightweight-charts v5, throwing "Object is disposed".
 */
export function safeDetachPrimitive(
    chart: IChartApi | null | undefined,
    series: ISeriesApi<any> | null | undefined,
    primitive: ISeriesPrimitive<any> | null | undefined
): void {
    if (!chart || !series || !primitive) return;
    if (isChartDisposed(chart)) return;
    try {
        series.detachPrimitive(primitive);
    } catch {
        // Ignore if chart/series was disposed externally
    }
}
