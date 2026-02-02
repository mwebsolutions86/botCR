import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/Logger.js';

export interface TokenMetrics {
    mint: string;
    name: string;
    marketCap: number;
    devBuyAmount: number;
}

const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

export class RaydiumListener {
    private connection: Connection;
    public onNewToken?: (metrics: TokenMetrics) => void;
    private lastProcessedTime = 0;
    private readonly COOLDOWN_MS = 1500; 

    constructor(connection: Connection) {
        this.connection = connection;
    }

    public async startListening() {
        logger.info("🎧 TITAN-WATCH : Mode Ultra-Rapide (Filtre Dev > 0.3 SOL)");

        this.connection.onLogs(
            PUMP_PROGRAM_ID,
            ({ logs, signature, err }) => {
                if (err) return;

                if (logs.some(l => l.includes("Create"))) {
                    const now = Date.now();
                    if (now - this.lastProcessedTime > this.COOLDOWN_MS) {
                        this.lastProcessedTime = now;
                        this.processSignal(signature);
                    }
                }
            },
            "confirmed"
        );
    }

    private async processSignal(signature: string) {
        try {
            // Délai court pour laisser la transaction s'inscrire en base RPC
            await new Promise(r => setTimeout(r, 400));

            const tx = await this.connection.getParsedTransaction(signature, {
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed"
            });

            if (!tx || !tx.meta) return;

            let buyAmountSol = 0;
            const innerInstructions = tx.meta.innerInstructions || [];
            
            for (const ix of innerInstructions) {
                for (const inner of ix.instructions) {
                    const parsed = (inner as any).parsed;
                    if (parsed?.type === "transfer" && parsed?.info?.lamports) {
                        buyAmountSol = parsed.info.lamports / 1e9;
                        break;
                    }
                }
                if (buyAmountSol > 0) break;
            }

            // Seuil de détection baissé à 0.3 SOL pour ne rien rater de sérieux
            if (isNaN(buyAmountSol) || buyAmountSol < 0.3) return;

            const mint = tx.transaction.message.accountKeys[1].pubkey.toString();
            logger.info(`🔥 SIGNAL DÉTECTÉ : ${mint} (Dev Buy: ${buyAmountSol.toFixed(2)} SOL)`);

            if (this.onNewToken) {
                this.onNewToken({
                    mint,
                    name: "Fast Meme",
                    marketCap: 5000,
                    devBuyAmount: buyAmountSol
                });
            }
        } catch (e) {
            // Gestion silencieuse des erreurs de parsing ou 429
        }
    }
}