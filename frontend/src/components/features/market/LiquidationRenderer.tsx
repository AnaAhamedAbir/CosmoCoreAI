import React, { useEffect, useRef, useCallback } from 'react';
import { IChartApi, ISeriesApi } from 'lightweight-charts';
import { GodModeState } from '../../../hooks/useGodModeData';

interface LiquidationRendererProps {
    chart: IChartApi | null;
    series: ISeriesApi<'Candlestick'> | null;
    data: GodModeState | null;
    showBubbles: boolean;
    intensityScale: number; // 10-100
    useTrailingLiquidity?: boolean;
}

export const LiquidationRenderer: React.FC<LiquidationRendererProps> = ({ chart, series, data, showBubbles, intensityScale, useTrailingLiquidity }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawRequested = useRef<boolean>(false);
    
    // Track persisting bubbles
    const bubblesRef = useRef<any[]>([]);
    
    // Crosshair state for tooltips
    const crosshairRef = useRef<{ price: number, x: number, y: number, visible: boolean }>({ price: 0, x: 0, y: 0, visible: false });

    const requestDraw = useCallback(() => {
        if (!drawRequested.current) {
            drawRequested.current = true;
            requestAnimationFrame(() => {
                drawRequested.current = false;
                drawHeatmap();
            });
        }
    }, [chart, series, data, showBubbles, intensityScale]);

    const drawHeatmap = useCallback(() => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!chart || !series || !data) return;

        const timeScale = chart.timeScale();
        const priceScale = series.priceScale();
        if (!timeScale || !priceScale) return;

        const timeWidth = timeScale.width();
        const parent = canvas.parentElement;
        if (parent) {
            if (canvas.width !== parent.clientWidth) canvas.width = parent.clientWidth;
            if (canvas.height !== parent.clientHeight) canvas.height = parent.clientHeight;
        }

        const currentPrice = data.current_price;

        // 1. Draw Magnet Zones & Cascade Probs (Heatmap Bands)
        const activeMagnetZones = (useTrailingLiquidity && data.smoothed_zones) ? data.smoothed_zones : (data.magnet_zones || []);
        
        const allZones = [
            ...activeMagnetZones.map(z => ({ ...z, type: 'magnet' as const })),
            ...(data.cascade_probs || []).map(z => ({ price: z.price, intensity: z.prob, volume: z.volume, type: 'cascade' as const }))
        ];

        // Ensure text labels don't overlap vertically on compressed scales
        const drawnTextY: number[] = [];

        allZones.forEach(zone => {
            // Dynamic thickness based on volume (min 0.1%, max 0.6%)
            const baseThickness = currentPrice * 0.001; 
            let calculatedThickness = baseThickness;
            if (zone.volume) {
                // Cap volume multiplier at ~1M USD equivalent for visual sanity
                const volumeScale = Math.min(5, zone.volume / 200000); 
                calculatedThickness = baseThickness + (baseThickness * volumeScale);
            }
            
            const yTop = series.priceToCoordinate(zone.price + (calculatedThickness/2));
            const yBottom = series.priceToCoordinate(zone.price - (calculatedThickness/2));
            const yCenter = series.priceToCoordinate(zone.price);

            if (yTop !== null && yBottom !== null && yCenter !== null) {
                const height = Math.abs(yBottom - yTop);
                // Base opacity scaled by user intensity ratio 
                const alpha = (zone.intensity / 100) * (intensityScale / 100);
                
                // Color logic: Cascade Red, Magnet Green
                let colorBase = zone.type === 'magnet' ? `34, 197, 94` : `239, 68, 68`; // Green, Red
                
                // ── TRADITIONAL HEATMAP BAND (Spans behind candles) ──
                // Draw glow block exactly behind the candles
                ctx.fillStyle = `rgba(${colorBase}, ${alpha * 0.35})`; // Soften background
                ctx.fillRect(0, Math.min(yTop, yBottom), timeWidth, height);
                
                // Center Horizontal Laser Line
                ctx.beginPath();
                ctx.strokeStyle = `rgba(${colorBase}, ${alpha * 0.8})`;
                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 1;
                ctx.moveTo(0, yCenter);
                ctx.lineTo(timeWidth, yCenter);
                ctx.stroke();
                ctx.setLineDash([]); // reset dash for future drawing

                // Draw Text Label on the right edge
                ctx.fillStyle = `rgba(${colorBase}, 0.95)`;
                ctx.font = 'bold 11px Inter, sans-serif';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                const formattedPrice = zone.price < 0.1 ? zone.price.toFixed(5) : zone.price < 1 ? zone.price.toFixed(4) : zone.price.toFixed(2);
                const label = zone.type === 'magnet' ? `🧲 MGNT ${zone.intensity}% @ ${formattedPrice}` : `🔥 LIQ ${zone.intensity}% @ ${formattedPrice}`;
                
                // Basic Collision Detection for Text
                let textY = yCenter as number;
                for (let i = 0; i < 10; i++) {
                    const hasCollision = drawnTextY.some(dy => Math.abs(dy - textY) < 16);
                    if (hasCollision) {
                        textY -= 16; // Push label up if colliding
                    } else {
                        break;
                    }
                }
                drawnTextY.push(textY);

                ctx.fillText(label, timeWidth - 6, textY);
            }
        });
        
        // 1.5 Draw Trailing Liquidity Clouds (if enabled)
        if (useTrailingLiquidity && data.trailing_liquidity) {
            const tl = data.trailing_liquidity;
            
            // Draw Long Trail (Support Cloud below price)
            if (tl.long_level > 0 && currentPrice >= tl.long_level) {
                const yL = series.priceToCoordinate(tl.long_level);
                if (yL !== null) {
                    const cloudHeight = 60; // thick cloud
                    const grad = ctx.createLinearGradient(0, yL - cloudHeight/2, 0, yL + cloudHeight/2);
                    grad.addColorStop(0, 'rgba(16,185,129,0)');
                    grad.addColorStop(0.5, `rgba(16,185,129,${Math.min(0.25, Math.max(0.05, tl.long_intensity/100))})`);
                    grad.addColorStop(1, 'rgba(16,185,129,0)');
                    ctx.fillStyle = grad;
                    ctx.fillRect(0, yL - cloudHeight/2, timeWidth, cloudHeight);
                    
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(16, 185, 129, 0.6)`;
                    ctx.setLineDash([12, 6]);
                    ctx.lineWidth = 2;
                    ctx.moveTo(0, yL);
                    ctx.lineTo(timeWidth, yL);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    
                    ctx.fillStyle = 'rgba(16, 185, 129, 0.8)';
                    ctx.font = 'bold 10px Inter';
                    ctx.fillText('TRAILING SUPPORT CLOUD', timeWidth / 2, yL - 6);
                }
            }
            // Draw Short Trail (Resistance Cloud above price)
            if (tl.short_level > 0 && currentPrice <= tl.short_level) {
                const yS = series.priceToCoordinate(tl.short_level);
                if (yS !== null) {
                    const cloudHeight = 60; 
                    const grad = ctx.createLinearGradient(0, yS - cloudHeight/2, 0, yS + cloudHeight/2);
                    grad.addColorStop(0, 'rgba(239,68,68,0)');
                    grad.addColorStop(0.5, `rgba(239,68,68,${Math.min(0.25, Math.max(0.05, tl.short_intensity/100))})`);
                    grad.addColorStop(1, 'rgba(239,68,68,0)');
                    ctx.fillStyle = grad;
                    ctx.fillRect(0, yS - cloudHeight/2, timeWidth, cloudHeight);
                    
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(239, 68, 68, 0.6)`;
                    ctx.setLineDash([12, 6]);
                    ctx.lineWidth = 2;
                    ctx.moveTo(0, yS);
                    ctx.lineTo(timeWidth, yS);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    
                    ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
                    ctx.font = 'bold 10px Inter';
                    ctx.fillText('TRAILING RESISTANCE CLOUD', timeWidth / 2, yS + 12);
                }
            }
        }

        // 2. Draw Live Liquidation Bubbles
        if (showBubbles && data.whale_feed) {
            // Unify new bubbles with existing ones, expiring after 60 seconds
            const now = Date.now();
            
            data.whale_feed.forEach(wf => {
                if (wf.price && wf.timestamp) {
                    const existing = bubblesRef.current.find(b => b.timestamp === wf.timestamp && b.price === wf.price);
                    if (!existing) {
                        bubblesRef.current.push({ ...wf, createdAt: now });
                    }
                }
            });

            // Clean old bubbles (> 1 min)
            bubblesRef.current = bubblesRef.current.filter(b => now - b.createdAt < 60000);

            bubblesRef.current.forEach(bubble => {
                const x = timeScale.timeToCoordinate((bubble.timestamp / 1000) as any);
                const y = series.priceToCoordinate(bubble.price);
                
                if (x !== null && y !== null) {
                    // Radius based on USD value (e.g. 100k -> small, 1m -> big)
                    const baseRadius = Math.max(8, Math.min(40, (bubble.value / 1000000) * 15));
                    const isLongRekt = bubble.type?.toLowerCase().includes('long');
                    
                    // Bubble core color based on exchange
                    const ex = bubble.exchange?.toLowerCase();
                    const coreColor = ex === 'binance' ? '250, 204, 21' : ex === 'bybit' ? '59, 130, 246' : '168, 85, 247'; // Yellow, Blue, Purple
                    // Stroke color based on Long/Short
                    const strokeColor = isLongRekt ? '239, 68, 68' : '34, 197, 94';

                    const age = now - bubble.createdAt;
                    
                    // Ripple Blast Animation (up to 2000ms)
                    if (age < 2000) {
                        const progress = age / 2000; // 0 to 1
                        const rippleRadius = baseRadius + (progress * 150); // expands up to 150px
                        const rippleAlpha = (1 - progress) * 0.6; // fades out
                        
                        ctx.beginPath();
                        ctx.strokeStyle = `rgba(${strokeColor}, ${rippleAlpha})`;
                        ctx.lineWidth = Math.max(1, 4 * (1 - progress));
                        ctx.arc(x, y, rippleRadius, 0, 2 * Math.PI);
                        ctx.stroke();

                        // Second inner ripple
                        if (progress > 0.2) {
                            const prog2 = (age - 400) / 1600;
                            const r2 = baseRadius + (prog2 * 100);
                            const alpha2 = (1 - prog2) * 0.5;
                            ctx.beginPath();
                            ctx.strokeStyle = `rgba(${coreColor}, ${alpha2})`;
                            ctx.lineWidth = Math.max(1, 3 * (1 - prog2));
                            ctx.arc(x, y, r2, 0, 2 * Math.PI);
                            ctx.stroke();
                        }
                    }

                    // Horizontal Footprint Laser (Fades over 10 seconds)
                    if (age < 10000) {
                        const footprintAlpha = (1 - (age / 10000)) * 0.6;
                        ctx.beginPath();
                        ctx.strokeStyle = `rgba(${strokeColor}, ${footprintAlpha})`;
                        ctx.setLineDash([4, 4]);
                        ctx.lineWidth = footprintAlpha > 0.3 ? 2 : 1;
                        ctx.moveTo(x, y);
                        ctx.lineTo(timeWidth, y);
                        ctx.stroke();
                        ctx.setLineDash([]);
                    }

                    // Main Pulse Bubble
                    const pulse = Math.sin(age / 200) * 2;
                    const radius = baseRadius + pulse;

                    ctx.beginPath();
                    ctx.fillStyle = `rgba(${coreColor}, 0.3)`;
                    ctx.arc(x, y, radius, 0, 2 * Math.PI);
                    ctx.fill();

                    // Inner bright core
                    ctx.beginPath();
                    ctx.fillStyle = `rgba(${coreColor}, 0.8)`;
                    ctx.arc(x, y, radius * 0.3, 0, 2 * Math.PI);
                    ctx.fill();

                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(${strokeColor}, 1)`;
                    ctx.lineWidth = 2;
                    ctx.arc(x, y, radius, 0, 2 * Math.PI);
                    ctx.stroke();
                    
                    // Value text Float above bubble
                    ctx.fillStyle = '#fff';
                    ctx.font = 'bold 9px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    const valK = bubble.value >= 1000000 ? (bubble.value / 1000000).toFixed(1) + 'M' : (bubble.value / 1000).toFixed(0) + 'k';
                    ctx.fillText(valK, x, y - radius - 8);
                }
            });
        }
        
        // 3. Draw Interactive Tooltip for hovered zone
        if (crosshairRef.current.visible) {
            const hoveredZone = allZones.find(z => Math.abs(z.price - crosshairRef.current.price) < (currentPrice * 0.003));
            if (hoveredZone) {
                const ttX = crosshairRef.current.x + 15;
                const ttY = crosshairRef.current.y - 15;
                
                ctx.fillStyle = 'rgba(15, 23, 42, 0.9)'; // Slate-900 background
                ctx.strokeStyle = hoveredZone.type === 'magnet' ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)';
                ctx.lineWidth = 1;
                
                const volText = hoveredZone.volume ? `Vol: $${(hoveredZone.volume / 1000).toFixed(1)}k` : `Int: ${hoveredZone.intensity}%`;
                const typeText = hoveredZone.type === 'magnet' ? 'Magn. Support' : 'Liq. Cascade';
                
                // Calculate estimated leverage based on distance from current price
                // 100x = 1%, 50x = 2%, 25x = 4%, 10x = 10%
                const distancePct = Math.abs(currentPrice - hoveredZone.price) / currentPrice;
                let levText = 'Est. Lev: ';
                if (distancePct <= 0.015) levText += '100x';
                else if (distancePct <= 0.03) levText += '50x';
                else if (distancePct <= 0.055) levText += '20x-25x';
                else if (distancePct <= 0.11) levText += '10x';
                else levText += '<10x';
                
                ctx.beginPath();
                ctx.roundRect(ttX, ttY - 40, 115, 48, 4);
                ctx.fill();
                ctx.stroke();
                
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 10px Inter';
                ctx.textAlign = 'left';
                ctx.fillText(typeText, ttX + 6, ttY - 26);
                
                ctx.fillStyle = 'rgba(148, 163, 184, 1)'; // Slate-400
                ctx.font = '9px Inter';
                ctx.fillText(volText, ttX + 6, ttY - 14);
                
                ctx.fillStyle = 'rgba(251, 191, 36, 1)'; // Amber-400 for leverage
                ctx.fillText(levText, ttX + 6, ttY - 2);
            }
        }

        // 4. Draw AI Trajectory Arrow
        if (data.ai_trajectory && data.ai_trajectory.direction !== 'NEUTRAL') {
            const currentY = series.priceToCoordinate(currentPrice);
            const targetY = series.priceToCoordinate(data.ai_trajectory.target_price);
            
            if (currentY !== null && targetY !== null) {
                const isUp = data.ai_trajectory.direction === 'UP';
                const color = isUp ? '34, 197, 94' : '239, 68, 68'; // green : red
                
                // Calculate arrow start and end points
                const startX = timeWidth * 0.85; // start near the right edge
                const endX = timeWidth * 0.85;
                
                ctx.beginPath();
                // Draw glowing line
                ctx.strokeStyle = `rgba(${color}, 0.8)`;
                ctx.shadowColor = `rgba(${color}, 1)`;
                ctx.shadowBlur = 10;
                ctx.lineWidth = 2 + (data.ai_trajectory.strength / 25); // thicker based on strength
                
                // Draw a dashed path
                ctx.setLineDash([5, 5]);
                ctx.moveTo(startX, currentY);
                ctx.lineTo(endX, targetY);
                ctx.stroke();
                ctx.setLineDash([]); // reset
                ctx.shadowBlur = 0; // reset
                
                // Draw arrow head
                ctx.beginPath();
                ctx.fillStyle = `rgba(${color}, 1)`;
                const headSize = 8;
                if (isUp) {
                    ctx.moveTo(endX, targetY);
                    ctx.lineTo(endX - headSize, targetY + headSize);
                    ctx.lineTo(endX + headSize, targetY + headSize);
                } else {
                    ctx.moveTo(endX, targetY);
                    ctx.lineTo(endX - headSize, targetY - headSize);
                    ctx.lineTo(endX + headSize, targetY - headSize);
                }
                ctx.fill();
                
                // Label for Trajectory
                ctx.fillStyle = `rgba(${color}, 1)`;
                ctx.font = 'bold 9px Inter';
                ctx.textAlign = 'center';
                const lblY = isUp ? targetY - 12 : targetY + 18;
                ctx.fillText(`ALGO TARGET`, endX, lblY);
            }
        }

    }, [chart, series, data, showBubbles, intensityScale]);

    useEffect(() => {
        if (!chart || !series) return;
        requestDraw();

        const timeScale = chart.timeScale();
        timeScale.subscribeVisibleTimeRangeChange(requestDraw);
        timeScale.subscribeSizeChange(requestDraw);
        
        const crosshairHandler = (param: any) => {
            if (!param.point || !param.time) {
                crosshairRef.current.visible = false;
            } else {
                crosshairRef.current = {
                    price: series.coordinateToPrice(param.point.y) || 0,
                    x: param.point.x,
                    y: param.point.y,
                    visible: true
                };
            }
            requestDraw();
        };
        chart.subscribeCrosshairMove(crosshairHandler);

        // Continuous animation loop for bubbles
        let animationFrameId: number;
        const animate = () => {
            if (showBubbles && bubblesRef.current.length > 0) {
                requestDraw();
            }
            animationFrameId = requestAnimationFrame(animate);
        };
        animate();

        return () => {
            timeScale.unsubscribeVisibleTimeRangeChange(requestDraw);
            timeScale.unsubscribeSizeChange(requestDraw);
            chart.unsubscribeCrosshairMove(crosshairHandler);
            cancelAnimationFrame(animationFrameId);
        };
    }, [chart, series, requestDraw, showBubbles]);

    // Force redraw when data changes
    useEffect(() => {
        requestDraw();
    }, [data, requestDraw]);

    return (
        <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 pointer-events-none"
            style={{ zIndex: 5 }}
        />
    );
};
