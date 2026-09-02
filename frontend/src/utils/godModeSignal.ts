export interface GodModeSignalData {
    current_price: number;
    magnet_zones?: { price: number; intensity?: number; weight?: number }[];
    cascade_probs?: { price: number; probability?: number; prob?: number }[];
    cvd_spoof?: string;
}

export interface GodModeSignalResult {
    score: number;
    signal: 'BUY' | 'SELL' | 'NEUTRAL';
}

export function calculateGodModeSignal(data: GodModeSignalData | null): GodModeSignalResult {
    if (!data) return { score: 0, signal: 'NEUTRAL' };
    
    let score = 0;
    
    // 1. Magnet Zones Analysis
    if (data.magnet_zones && data.magnet_zones.length > 0) {
        // Find the strongest magnet zone
        const strongestMagnet = data.magnet_zones.reduce((prev, current) => {
            const prevVal = prev.intensity || prev.weight || 0;
            const currVal = current.intensity || current.weight || 0;
            return (prevVal > currVal) ? prev : current;
        });
        
        if (strongestMagnet.price > data.current_price) {
            score += 40; // Bullish magnet above
        } else if (strongestMagnet.price < data.current_price) {
            score -= 40; // Bearish magnet below
        }
    }
    
    // 2. Cascade Probabilities Analysis
    if (data.cascade_probs && data.cascade_probs.length > 0) {
        const strongestCascade = data.cascade_probs.reduce((prev, current) => {
            const prevVal = prev.probability || prev.prob || 0;
            const currVal = current.probability || current.prob || 0;
            return (prevVal > currVal) ? prev : current;
        });
        
        if (strongestCascade.price > data.current_price) {
            score += 30;
        } else if (strongestCascade.price < data.current_price) {
            score -= 30;
        }
    }
    
    // 3. CVD Spoof Analysis
    if (data.cvd_spoof) {
        if (data.cvd_spoof === 'POSITIVE') {
            score += 30;
        } else if (data.cvd_spoof === 'NEGATIVE') {
            score -= 30;
        }
    }
    
    // Determine final signal
    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    if (score >= 50) signal = 'BUY';
    if (score <= -50) signal = 'SELL';
    
    return { score, signal };
}
