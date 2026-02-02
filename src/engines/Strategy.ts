import { RiskManager } from '../core/RiskManager.js';
import { logger } from '../utils/Logger.js';

export type StrategyAction = 'BUY' | 'SELL_EXIT' | 'HOLD';

interface PositionState {
    entryPrice: number;
    highestPrice: number; // Le sommet atteint (ATH local)
    stopLoss: number;     // Le prix de déclenchement de la vente
    entryTime: number;
}

export class StrategyEngine {
    private riskManager: RiskManager;
    // Mémoire des positions actives
    private positions: Map<string, PositionState> = new Map();

    constructor(riskManager: RiskManager) {
        this.riskManager = riskManager;
    }

    public async onPriceUpdate(mint: string, currentPrice: number, now: number): Promise<StrategyAction> {
        // 1. INITIALISATION (Premier contact avec le Token)
        if (!this.positions.has(mint)) {
            // On récupère la config du RiskManager (Stop Loss initial de 25% par exemple)
            const config = this.riskManager.getTradeConfiguration(mint, 0); 
            const initialStopPrice = currentPrice * (1 - config.stopLoss);
            
            this.positions.set(mint, {
                entryPrice: currentPrice,
                highestPrice: currentPrice,
                stopLoss: initialStopPrice,
                entryTime: now
            });
            
            logger.info(`Strategy 🏁: Suivi démarré pour ${mint} à $${currentPrice.toFixed(6)} (SL Initial: $${initialStopPrice.toFixed(6)})`);
            return 'HOLD';
        }

        const pos = this.positions.get(mint)!;

        // 2. MISE À JOUR DU SOMMET (Trailing)
        // Si le prix monte plus haut que jamais, on met à jour le sommet
        if (currentPrice > pos.highestPrice) {
            pos.highestPrice = currentPrice;

            // APPEL AU RISK MANAGER : "Le prix a monté, dois-je remonter le Stop Loss ?"
            // C'est ici que la magie du "Gem" opère : on sécurise les gains en montant l'échelle.
            const newStopLoss = this.riskManager.updateTrailingStop(currentPrice, pos.entryPrice, pos.stopLoss);
            
            if (newStopLoss > pos.stopLoss) {
                logger.info(`Strategy 📈: GEM DETECTÉ ! Stop Loss remonté à $${newStopLoss.toFixed(6)} (Sécurisation gains)`);
                pos.stopLoss = newStopLoss;
            }
        }

        // Calcul du PnL (Profit/Perte) actuel en %
        const pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
        
        // 3. VÉRIFICATION DE SORTIE (Le prix est-il passé sous le filet de sécurité ?)
        if (currentPrice <= pos.stopLoss) {
            if (pnlPercent > 0) {
                logger.info(`Strategy 💰: TAKE PROFIT ! Vente à $${currentPrice.toFixed(6)} (+${pnlPercent.toFixed(2)}%)`);
            } else {
                logger.info(`Strategy 🛡️: STOP LOSS ! Vente à $${currentPrice.toFixed(6)} (${pnlPercent.toFixed(2)}%)`);
            }
            
            this.positions.delete(mint);
            return 'SELL_EXIT';
        }

        // 4. LOGS DE SUIVI (Pour que tu voies ton Gem grandir)
        // On log uniquement si le mouvement est significatif ou aléatoirement pour ne pas spammer
        if (Math.abs(pnlPercent) > 5 || Math.random() < 0.1) { 
            const distanceToSL = ((currentPrice - pos.stopLoss) / currentPrice) * 100;
            logger.info(`Strategy 👀: ${mint} | Prix: $${currentPrice.toFixed(6)} | PnL: ${pnlPercent > 0 ? '+' : ''}${pnlPercent.toFixed(2)}% | SL à -${distanceToSL.toFixed(1)}%`);
        }

        return 'HOLD';
    }
}