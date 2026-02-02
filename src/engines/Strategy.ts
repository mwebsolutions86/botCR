import { RiskManager } from '../core/RiskManager.js';
import { logger } from '../utils/Logger.js';

// Ajout explicite de SELL_PARTIAL pour correspondre à la logique du Brain
export type StrategyAction = 'BUY' | 'SELL_EXIT' | 'HOLD' | 'SELL_PARTIAL';

interface PositionState {
    entryPrice: number;
    highestPrice: number;
    stopLoss: number;
    halfSold: boolean; // Marqueur pour ne pas vendre 50% plusieurs fois
}

export class StrategyEngine {
    private riskManager: RiskManager;
    private positions: Map<string, PositionState> = new Map();

    constructor(riskManager: RiskManager) {
        this.riskManager = riskManager;
    }

    public async onPriceUpdate(mint: string, currentPrice: number, now: number): Promise<StrategyAction> {
        // 1. Initialisation de la position si c'est un nouveau token acheté
        if (!this.positions.has(mint)) {
            this.positions.set(mint, {
                entryPrice: currentPrice,
                highestPrice: currentPrice,
                stopLoss: currentPrice * 0.85, // Stop Loss initial à -15%
                halfSold: false
            });
            return 'HOLD';
        }

        const pos = this.positions.get(mint)!;
        const pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;

        // 2. LOGIQUE DE VENTE PARTIELLE (Take Profit +50%)
        // Si on gagne 50% et qu'on n'a pas encore vendu la moitié
        if (pnlPercent >= 50 && !pos.halfSold) {
            logger.info(`Strategy 💰: Palier +50% atteint pour ${mint.slice(0, 8)}. Sécurisation de la mise.`);
            pos.halfSold = true;
            
            // OPTIMISATION : Une fois la moitié vendue, on remonte le Stop Loss au prix d'entrée
            // Comme ça, le trade devient "Risk-Free" (Impossible de perdre de l'argent)
            pos.stopLoss = pos.entryPrice; 
            
            return 'SELL_PARTIAL';
        }

        // 3. MISE À JOUR DU TRAILING STOP (Suivi de tendance)
        // Si le prix bat un nouveau record (ATH), on remonte le Stop Loss
        if (currentPrice > pos.highestPrice) {
            pos.highestPrice = currentPrice;
            
            // On garde une distance de sécurité de 10% par rapport au sommet
            const trailingDistance = 0.10; 
            const newStop = currentPrice * (1 - trailingDistance);
            
            if (newStop > pos.stopLoss) {
                pos.stopLoss = newStop;
            }
        }

        // 4. SORTIE DE POSITION (Stop Loss ou Trailing Stop touché)
        if (currentPrice <= pos.stopLoss) {
            const exitLabel = pnlPercent > 0 ? "PROFIT" : "STOP LOSS";
            logger.info(`Strategy 📉: Sortie ${exitLabel} pour ${mint.slice(0, 8)} (${pnlPercent.toFixed(2)}%)`);
            
            this.positions.delete(mint);
            return 'SELL_EXIT';
        }

        return 'HOLD';
    }

    /**
     * Optionnel : Nettoyer une position manuellement si besoin
     */
    public removePosition(mint: string) {
        this.positions.delete(mint);
    }
}