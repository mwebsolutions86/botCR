import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/Logger.js';

export class RiskManager {
    private connection: Connection;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    /**
     * 1. VALIDATION DE SÉCURITÉ
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

            logger.info(`Risk 🟢: Token ${mintAddress} validé (Sûr).`);
            return true;

        } catch (error) {
            logger.error(`Risk Error: ${error}`);
            return false;
        }
    }

    // Alias pour compatibilité
    public async validateToken(mintAddress: string): Promise<boolean> {
        return this.validateTokenSafety(mintAddress);
    }

    /**
     * 2. CONFIGURATION DU TRADE
     * Correction ici : On accepte un 2ème argument (balance) même si on ne l'utilise pas,
     * et on renomme 'buyAmount' en 'entrySize' pour satisfaire Brain.ts.
     */
    public getTradeConfiguration(mint: string, accountBalance: number = 0) {
        return {
            entrySize: 0.001,  // <--- C'est le nom que Brain.ts attend !
            slippage: 10,
            stopLoss: 0.20,
            takeProfit: 0.50,
            trailingStop: false
        };
    }

    /**
     * 3. STOP SUIVEUR
     */
    public updateTrailingStop(currentPrice: number, entryPrice: number, currentStopLoss: number): number {
        return currentStopLoss;
    }
}