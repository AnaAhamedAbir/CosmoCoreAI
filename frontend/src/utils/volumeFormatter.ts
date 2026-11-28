export function formatFootprintVolume(volume: number | undefined | null): string {
    if (volume === 0 || !volume || !Number.isFinite(volume)) return '0';
    const sign = volume < 0 ? '-' : '';
    const abs = Math.abs(volume);

    // Always abbreviate large numbers (including integers) so footprint cells never overflow
    if (abs >= 1_000_000_000) {
        return `${sign}${(abs / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 1 : 2)}B`;
    }
    if (abs >= 1_000_000) {
        return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
    }
    if (abs >= 1_000) {
        return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
    }
    if (Number.isInteger(abs)) {
        return `${sign}${abs}`;
    }
    if (abs < 1) {
        return `${sign}${parseFloat(abs.toFixed(4))}`;
    }
    return `${sign}${Math.floor(abs)}`;
}
