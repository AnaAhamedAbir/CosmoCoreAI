import React, { useState } from 'react';
import LiquidationCommandBar from '@/components/features/market/LiquidationCommandBar';
import { useCCXTMarkets } from '@/hooks/useCCXTMarkets';
import { LiquidationPoolHorizon, useGodModeStream } from '@/hooks/useGodModeData';
import { useLiquidationWebSocket } from '@/hooks/useLiquidationWebSocket';
import { useBotStore } from '@/store/botStore';
import { useUIStore } from '@/store/uiStore';
import StandardLiquidationView from './StandardLiquidationView';
import GodModeLiquidationView from './GodModeLiquidationView';

const LiquidationMap: React.FC = () => {
    const [isGodMode, setIsGodMode] = useState(false);

    const {
        exchanges,
        selectedExchange,
        setSelectedExchange,
        availablePairs,
        selectedPair,
        setSelectedPair,
        isLoading: isPairsLoading,
    } = useCCXTMarkets();

    const activePair = selectedPair || 'BTC/USDT';
    const { indicatorSettings, setIndicatorSettings } = useBotStore();
    const { liquidationTimeframe, setLiquidationTimeframe } = useUIStore();

    const activeHorizon: LiquidationPoolHorizon = indicatorSettings.liquidationPoolHorizon || '24h';

    const handleHorizonChange = (h: LiquidationPoolHorizon) => {
        setIndicatorSettings({ liquidationPoolHorizon: h });
    };

    // Single unified WebSocket streams shared seamlessly across Standard & God Mode
    const { state: godModeState, isConnected: godModeConnected } = useGodModeStream(
        activePair.split(':')[0],
        true,
        selectedExchange.toLowerCase(),
        activeHorizon,
    );

    const liqStream = useLiquidationWebSocket(selectedExchange, activePair);

    const oraclePrice =
        liqStream.currentPrice > 0
            ? liqStream.currentPrice
            : godModeState?.current_price || 0;

    return (
        <div data-viewport-flow="adaptive" className="h-full flex flex-col gap-3 relative overflow-hidden text-slate-900 dark:text-white">
            <LiquidationCommandBar
                exchanges={exchanges}
                selectedExchange={selectedExchange}
                onExchangeChange={setSelectedExchange}
                availablePairs={availablePairs}
                activePair={activePair}
                onPairChange={setSelectedPair}
                isPairsLoading={isPairsLoading}
                timeframe={liquidationTimeframe || '15m'}
                onTimeframeChange={setLiquidationTimeframe}
                horizon={activeHorizon}
                onHorizonChange={handleHorizonChange}
                isGodMode={isGodMode}
                onModeChange={setIsGodMode}
                oraclePrice={oraclePrice}
                priceUpdateStatus={liqStream.priceUpdateStatus}
                fundingRate={godModeState?.funding_rate}
                openInterestUsd={godModeState?.open_interest_usd}
                isConnected={isGodMode ? godModeConnected : liqStream.isConnected}
            />

            <div className="flex-1 min-h-0 relative">
                {isGodMode ? (
                    <div key="god-mode" className="absolute inset-0 animate-fade-in">
                        <GodModeLiquidationView
                            sharedExchange={selectedExchange}
                            sharedPair={activePair}
                            sharedTimeframe={liquidationTimeframe || '15m'}
                            sharedHorizon={activeHorizon}
                            sharedGodModeState={godModeState}
                            sharedConnected={godModeConnected}
                        />
                    </div>
                ) : (
                    <div key="standard-mode" className="absolute inset-0 animate-fade-in">
                        <StandardLiquidationView
                            sharedExchange={selectedExchange}
                            sharedPair={activePair}
                            sharedTimeframe={liquidationTimeframe || '15m'}
                            sharedHorizon={activeHorizon}
                            sharedGodModeState={godModeState}
                            sharedLiqStream={liqStream}
                        />
                    </div>
                )}
            </div>

            <style
                dangerouslySetInnerHTML={{
                    __html: `
                @keyframes fadeIn {
                    from { opacity: 0; filter: blur(4px); }
                    to { opacity: 1; filter: blur(0); }
                }
                .animate-fade-in {
                    animation: fadeIn 0.35s ease-out forwards;
                }
            `,
                }}
            />
        </div>
    );
};

export default LiquidationMap;
