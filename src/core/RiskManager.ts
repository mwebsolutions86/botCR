import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { logger } from '../utils/Logger.js';
import { TokenMetrics } from '../listeners/RaydiumListener.js';

export class RiskManager {
    private connection: Connection;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    /**
     * 1. ANALYSE DU MOMENTUM & FONDAMENTAUX
     */
    public validateMarketMetrics(metrics: TokenMetrics): boolean {
        const MIN_LIQUIDITY = 1000;
        const MIN_MARKET_CAP = 4000;
        const MIN_TX_COUNT = 2; // On augmente un peu l'exigence

        // FILTRE 1 : Les bases
        if (metrics.liquidity < MIN_LIQUIDITY) {
            logger.warn(`Risk 🔴: Liquidité trop faible ($${metrics.liquidity})`);
            return false;
        }
        if (metrics.marketCap < MIN_MARKET_CAP) {
            logger.warn(`Risk 🔴: Market Cap trop faible ($${metrics.marketCap})`);
            return false;
        }
        if (metrics.txCountM5 < MIN_TX_COUNT) {
            logger.warn(`Risk 🔴: Token mort (Pas assez de tx).`);
            return false;
        }

        // FILTRE 2 : LE MOMENTUM (Nouveau !)
        // On veut que le volume soit "vivant" par rapport à la liquidité.
        // Un ratio > 0.1 signifie que 10% de la liquidité a changé de main en 5 min. C'est bon signe.
        const momentumRatio = metrics.volumeM5 / metrics.liquidity;
        
        if (momentumRatio < 0.05) { 
            // logger.warn(`Risk 🟡: Pas assez de momentum (Ratio: ${momentumRatio.toFixed(2)}). Trop calme.`);
            // return false; // On peut décommenter pour être plus strict
        }

        logger.info(`Risk 🟢: Validé! MC: $${metrics.marketCap} | Ratio Momentum: ${momentumRatio.toFixed(2)} 🔥`);
        return true;
    }

    /**
     * 2. ANALYSE TECHNIQUE (RugCheck)
     */
    public async checkRugCheckScore(mint: string): Promise<boolean> {
        try {
            logger.info(`Risk 🔎: Audit RugCheck en cours...`);
            const response = await axios.get(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, { timeout: 3000 });
            
            if (!response.data) return true; 

            const score = response.data.score; 
            logger.info(`Risk 📊: Score Risque = ${score}`);

            if (score > 1500) {
                logger.warn(`Risk 🔴: REJETÉ (Score Risque Élevé)`);
                return false;
            }
            return true;

        } catch (error) {
            logger.warn("Risk ⚠️: RugCheck lent/HS, on passe en mode manuel (Risqué).");
            return await this.validateTokenSafety(mint);
        }
    }

    public async validateTokenSafety(mintAddress: string): Promise<boolean> {
        try {
            const mintPubkey = new PublicKey(mintAddress);
            const accountInfo = await this.connection.getParsedAccountInfo(mintPubkey);
            if (!accountInfo || !accountInfo.value) return false;
            const data: any = accountInfo.value.data;
            if (data.program !== 'spl-token' && data.program !== 'spl-token-2022') return false;
            if (data.parsed.info.freezeAuthority || data.parsed.info.mintAuthority) return false;
            return true;
        } catch (e) { return false; }
    }

    /**
     * 3. GESTION DU CAPITAL (Money Management)
     */
    public getTradeConfiguration(mint: string, accountBalance: number) {
        // STRATÉGIE AGRESSIVE MAIS CONTRÔLÉE
        const RISK_PERCENTAGE = 0.10; // 10% du wallet
        let entrySize = accountBalance * RISK_PERCENTAGE;
        if (entrySize < 0.001) entrySize = 0.001;

        return {
            entrySize: parseFloat(entrySize.toFixed(4)),
            slippage: 20,      // On accepte un peu de glissement à l'entrée
            stopLoss: 0.25,    // -25% on coupe (Stop Loss dur)
            takeProfit: 1.00,  // x2 on vise la lune (mais le Trailing Stop vendra avant)
            trailingStop: true // ✅ ON ACTIVE LE MODE INTELLIGENT
        };
    }

    /**
     * 4. LOGIQUE DE STOP SUIVEUR (TRAILING STOP)
     * C'est ici que se joue le profit.
     */
    public updateTrailingStop(currentPrice: number, entryPrice: number, currentStopLoss: number): number {
        // Si le prix monte, on remonte le Stop Loss pour sécuriser les gains.
        // On garde toujours une distance de 20% par rapport au plus haut atteint.
        
        const trailingPercent = 0.20; // 20% de distance
        const newStopLoss = currentPrice * (1 - trailingPercent);

        // Si le nouveau SL calculé est plus haut que l'ancien, on le monte !
        // (On ne redescend jamais un SL)
        if (newStopLoss > currentStopLoss) {
            // logger.info(`Strategy 📈: Stop Loss remonté à $${newStopLoss.toFixed(6)}`);
            return newStopLoss;
        }

        return currentStopLoss;
    }
}