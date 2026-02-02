import { RiskManager } from '../core/RiskManager.js';
import { logger } from '../utils/Logger.js';

// --- TYPES ---
export interface Candle {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestamp: number;
    isClosed: boolean;
}

// ✅ NOUVEAU : Les ordres que la stratégie peut donner au Brain
export type StrategyAction = 'HOLD' | 'SELL_EXIT' | 'BUY_REBOUND';

export interface TokenState {
    mint: string;
    phase: 'MONITORING' | 'BOUGHT_INITIAL' | 'STOP_LOSS_HIT' | 'WAITING_FOR_REBOUND' | 'BOUGHT_REBOUND' | 'EXITED';
    candles: Candle[];
    currentCandle: Candle | null;
    highestPrice: number;
    entryPrice: number;
    stopLossPrice: number;
}

export class StrategyEngine {
    private activeTokens: Map<string, TokenState> = new Map();
    private riskManager: RiskManager;
    
    // CONFIGURATION
    private readonly TIMEFRAME_MS = 60 * 1000; // 1 minute
    private readonly RSI_PERIOD = 14;
    private readonly RSI_OVERSOLD_THRESHOLD = 30;

    constructor(riskManager: RiskManager) {
        this.riskManager = riskManager;
    }

    /**
     * Point d'entrée principal : Retourne une ACTION à exécuter immédiatement
     */
    public async onPriceUpdate(mint: string, price: number, timestamp: number): Promise<StrategyAction> {
        let state = this.activeTokens.get(mint);
        let action: StrategyAction = 'HOLD';

        // Initialisation (Si le token n'est pas encore suivi par la stratégie)
        if (!state) {
            state = this.initializeTokenState(mint, price);
            this.activeTokens.set(mint, state);
            // On considère qu'on vient d'acheter la phase initiale
            state.phase = 'BOUGHT_INITIAL'; 
            // Premier SL fixé par le RiskManager pour la phase initiale
            const config = this.riskManager.getTradeConfiguration('INITIAL_LAUNCH', 0); // Capital ignoré ici, on veut juste le %
            state.stopLossPrice = price * (1 - config.stopLoss);
        }

        // 1. Mise à jour des bougies (OHLC)
        this.updateCandle(state, price, timestamp);

        // 2. Logique décisionnelle
        switch (state.phase) {
            case 'BOUGHT_INITIAL':
                // Gestion du Trailing Stop
                if (price > state.highestPrice) {
                    state.highestPrice = price;
                    // SL dynamique à 5% (ou autre config)
                    state.stopLossPrice = this.riskManager.updateTrailingStop(price, state.highestPrice, 0.05);
                }

                // Vérification STOP LOSS
                if (price <= state.stopLossPrice) {
                    logger.warn(`Strategy 🛑: SL touché sur ${mint} (Initial). Signal VENTE envoyé.`);
                    state.phase = 'WAITING_FOR_REBOUND'; // On passe en attente
                    action = 'SELL_EXIT';
                }
                break;

            case 'WAITING_FOR_REBOUND':
                // On a vendu, on attend un signal pour racheter
                if (this.checkReboundConditions(state)) {
                    logger.info(`Strategy 🚀: SIGNAL REBOND VALIDÉ sur ${mint} !`);
                    
                    // On prépare l'état pour l'après-achat
                    state.phase = 'BOUGHT_REBOUND';
                    state.entryPrice = price;
                    state.highestPrice = price;
                    
                    // SL plus serré pour le rebond (ex: 2.5%)
                    state.stopLossPrice = price * (1 - 0.025); 
                    
                    action = 'BUY_REBOUND';
                }
                break;
                
            case 'BOUGHT_REBOUND':
                // Gestion après le 2ème achat (SL Strict)
                if (price <= state.stopLossPrice) {
                    logger.warn(`Strategy 💀: SL Rebond touché sur ${mint}. Sortie définitive.`);
                    state.phase = 'EXITED';
                    this.activeTokens.delete(mint); // On arrête de suivre ce token
                    action = 'SELL_EXIT';
                }
                // Ici on pourrait ajouter un Trailing Stop aussi pour le rebond
                if (price > state.highestPrice) {
                    state.highestPrice = price;
                    state.stopLossPrice = this.riskManager.updateTrailingStop(price, state.highestPrice, 0.025);
                }
                break;
        }

        return action;
    }

    // --- LOGIQUE INTERNE (Déjà vue précédemment) ---

    private checkReboundConditions(state: TokenState): boolean {
        if (state.candles.length < 3) return false;
        const last = state.candles[state.candles.length - 1];
        const prev = state.candles[state.candles.length - 2];
        const rsi = this.calculateRSI(state.candles);

        // RSI < 30
        if (rsi > this.RSI_OVERSOLD_THRESHOLD) return false;

        // Bougie Englobante (Bullish Engulfing)
        const isBullishEngulfing = 
            prev.close < prev.open && // Précédente rouge
            last.close > last.open && // Actuelle verte
            last.open <= prev.close && 
            last.close >= prev.open;

        return isBullishEngulfing;
    }

    private updateCandle(state: TokenState, price: number, timestamp: number) {
        if (!state.currentCandle) {
            state.currentCandle = { open: price, high: price, low: price, close: price, volume: 0, timestamp, isClosed: false };
            return;
        }
        const startTime = Math.floor(timestamp / this.TIMEFRAME_MS) * this.TIMEFRAME_MS;
        
        if (state.currentCandle.timestamp < startTime) {
            state.currentCandle.isClosed = true;
            state.candles.push(state.currentCandle);
            if (state.candles.length > 50) state.candles.shift();
            state.currentCandle = { open: price, high: price, low: price, close: price, volume: 0, timestamp: startTime, isClosed: false };
        } else {
            state.currentCandle.close = price;
            state.currentCandle.high = Math.max(state.currentCandle.high, price);
            state.currentCandle.low = Math.min(state.currentCandle.low, price);
        }
    }

    private calculateRSI(candles: Candle[]): number {
        if (candles.length < this.RSI_PERIOD + 1) return 50;
        let gains = 0, losses = 0;
        for (let i = candles.length - this.RSI_PERIOD; i < candles.length; i++) {
            const diff = candles[i].close - candles[i - 1].close;
            (diff >= 0) ? gains += diff : losses -= diff;
        }
        if (losses === 0) return 100;
        return 100 - (100 / (1 + (gains / losses)));
    }

    private initializeTokenState(mint: string, price: number): TokenState {
        return {
            mint,
            phase: 'MONITORING',
            candles: [],
            currentCandle: null,
            highestPrice: price,
            entryPrice: price,
            stopLossPrice: 0
        };
    }
}