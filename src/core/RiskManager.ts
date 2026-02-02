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
     * 1. ANALYSE FINANCIÈRE (Market Cap, Liq, Transactions)
     */
    public validateMarketMetrics(metrics: TokenMetrics): boolean {
        // RÈGLES DE TRADING (Ajustables)
        const MIN_LIQUIDITY = 1000;   // Minimum $1000 de liquidité
        const MIN_MARKET_CAP = 4000;  // Minimum $4000 MC
        const MIN_TX_COUNT = 1;       // Au moins 1 transaction

        if (metrics.liquidity < MIN_LIQUIDITY) {
            logger.warn(`Risk 🔴: Liquidité trop faible ($${metrics.liquidity}) pour ${metrics.name}`);
            return false;
        }

        if (metrics.marketCap < MIN_MARKET_CAP) {
            logger.warn(`Risk 🔴: Market Cap trop faible ($${metrics.marketCap})`);
            return false;
        }

        if (metrics.txCountM5 < MIN_TX_COUNT) {
            logger.warn(`Risk 🔴: Aucune transaction récente.`);
            return false;
        }

        logger.info(`Risk 🟢: Métriques financières valides pour ${metrics.name}`);
        return true;
    }

    /**
     * 2. ANALYSE TECHNIQUE (RugCheck API)
     */
    public async checkRugCheckScore(mint: string): Promise<boolean> {
        try {
            logger.info(`Risk 🔎: Consultation de l'analyste (RugCheck)...`);
            const response = await axios.get(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`);
            
            if (!response.data) return true; 

            const score = response.data.score; 
            logger.info(`Risk 📊: Score RugCheck = ${score}`);

            if (score > 1500) {
                logger.warn(`Risk 🔴: REJETÉ par l'analyste (Score Risque Élevé: ${score})`);
                return false;
            }

            logger.info(`Risk 🟢: APPROUVÉ par l'analyste (Score Sûr).`);
            return true;

        } catch (error) {
            logger.warn("Risk ⚠️: RugCheck indisponible, passage en mode manuel.");
            return await this.validateTokenSafety(mint);
        }
    }

    /**
     * 3. VÉRIFICATION MANUELLE DE SECOURS
     */
    public async validateTokenSafety(mintAddress: string): Promise<boolean> {
        try {
            const mintPubkey = new PublicKey(mintAddress);
            const accountInfo = await this.connection.getParsedAccountInfo(mintPubkey);

            if (!accountInfo || !accountInfo.value) return false;

            const data: any = accountInfo.value.data;
            if (data.program !== 'spl-token' && data.program !== 'spl-token-2022') return false;

            const freezeAuthority = data.parsed.info.freezeAuthority;
            const mintAuthority = data.parsed.info.mintAuthority;

            if (freezeAuthority) {
                logger.warn(`Risk 🔴: Freeze Authority détectée.`);
                return false;
            }
            if (mintAuthority) {
                logger.warn(`Risk 🔴: Mint Authority détectée.`);
                return false;
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * 4. GESTION DE LA MISE (Règle des 10%)
     */
    public getTradeConfiguration(mint: string, accountBalance: number) {
        const RISK_PERCENTAGE = 0.10; 
        let entrySize = accountBalance * RISK_PERCENTAGE;
        if (entrySize < 0.001) entrySize = 0.001;

        return {
            entrySize: parseFloat(entrySize.toFixed(4)),
            slippage: 10,
            stopLoss: 0.20,
            takeProfit: 0.50,
            trailingStop: false
        };
    }

    /**
     * ✅ 5. STOP SUIVEUR (La méthode qui manquait !)
     * Appelé par Strategy.ts
     */
    public updateTrailingStop(currentPrice: number, entryPrice: number, currentStopLoss: number): number {
        // Logique simple : on retourne le SL actuel pour satisfaire Strategy.ts
        // Tu pourras implémenter une logique complexe plus tard ici.
        return currentStopLoss;
    }
}