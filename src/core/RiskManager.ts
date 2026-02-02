import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/Logger.js';

export class RiskManager {
    private connection: Connection;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    /**
     * Audit On-Chain direct (Anti-Rug & Anti-Honeypot)
     */
    public async validateMeme(mint: string): Promise<boolean> {
        const mintPubkey = new PublicKey(mint);
        
        for (let i = 0; i < 3; i++) {
            try {
                const accountInfo = await this.connection.getParsedAccountInfo(mintPubkey);
                
                if (accountInfo && accountInfo.value) {
                    const data = (accountInfo.value.data as any).parsed.info;

                    // 1. Check Mint Authority (Anti-Rug)
                    if (data.mintAuthority !== null) {
                        logger.warn(`Risk 🔴: Mint Authority active sur ${mint.slice(0,6)}... Rejet.`);
                        return false;
                    }

                    // 2. Check Freeze Authority (Anti-Honeypot)
                    if (data.freezeAuthority !== null) {
                        logger.warn(`Risk 🔴: Freeze Authority active sur ${mint.slice(0,6)}... Rejet.`);
                        return false;
                    }

                    logger.info(`Risk 🟢: Audit blockchain validé.`);
                    return true;
                }
            } catch (e) {}
            await new Promise(r => setTimeout(r, 350));
        }

        logger.warn(`Risk 🔴: Token introuvable (Latence RPC) sur ${mint.slice(0,8)}...`);
        return false;
    }

    /**
     * Configuration pure de gestion du risque
     * Le Take Profit est géré dynamiquement par Strategy.ts
     */
    public getTradeConfiguration(accountBalance: number) {
        return {
            // On reste sur du 5% par trade pour préserver le capital
            entrySize: parseFloat((accountBalance * 0.05).toFixed(4)), 
            slippage: 15,      
            stopLoss: 0.20,    // Sortie de sécurité si le trade part mal (-20%)
            // On a retiré le takeProfit fixe ici
            trailingStop: true 
        };
    }
}