import { Connection } from '@solana/web3.js';
import axios from 'axios';
import { logger } from '../utils/Logger.js';

const NEW_POOLS_API = "https://api.geckoterminal.com/api/v2/networks/solana/new_pools";

export class RaydiumListener {
    private connection: Connection;
    public onNewToken?: (mint: string) => void;
    private isScanning = false;
    private processedMints: Set<string> = new Set();

    constructor(connection: Connection) {
        this.connection = connection;
    }

    public async startListening() {
        logger.info("🎧 RaydiumListener: MODE HYBRIDE (Raydium + Pump.fun).");
        logger.info("📡 Vannes ouvertes : On tire sur tout ce qui bouge.");

        setInterval(async () => {
            await this.scanGeckoTerminal();
        }, 6000); // 6s pour être safe avec Gecko
    }

    private async scanGeckoTerminal() {
        if (this.isScanning) return;
        this.isScanning = true;

        try {
            const response = await axios.get(NEW_POOLS_API, {
                headers: { 'Accept': 'application/json' }
            });

            const pools = response.data.data;
            if (!pools || pools.length === 0) return;

            logger.info(`✅ RADAR OK: ${pools.length} pools. Dernier: ${pools[0].attributes.name}`);

            for (const pool of pools) {
                const name = pool.attributes.name;
                const dexId = pool.relationships?.dex?.data?.id; 

                // --- 🔓 MODIFICATION CRITIQUE ICI ---
                // On accepte 'raydium' ET 'pump-fun'
                if (dexId !== 'raydium' && dexId !== 'pump-fun') {
                    // logger.warn(`❌ REJETÉ: Dex inconnu (${dexId}) pour ${name}`);
                    continue; 
                }

                // Extraction Mint
                const baseTokenId = pool.relationships?.base_token?.data?.id; 
                if (!baseTokenId) continue;
                const mint = baseTokenId.replace('solana_', '');

                // Vérification si déjà traité
                if (this.processedMints.has(mint)) continue;

                // Calcul Âge
                const createdAt = new Date(pool.attributes.pool_created_at).getTime();
                const ageMin = ((Date.now() - createdAt) / 1000 / 60).toFixed(0);

                // LOG DE SUCCÈS
                logger.info(`🚨 CIBLE VALIDÉE (${dexId}): ${name} | Âge: ${ageMin} min`);
                logger.info(`🔫 TIR DÉCLENCHÉ -> Envoi au Brain...`);

                this.processedMints.add(mint);
                
                if (this.onNewToken) {
                    this.onNewToken(mint);
                    
                    // Pause de sécurité après un tir pour laisser le temps au Brain de traiter
                    await new Promise(r => setTimeout(r, 1000));
                    // On sort de la boucle pour ne pas en acheter 20 d'un coup
                    break; 
                }
            }

        } catch (error: any) {
            logger.error(`Erreur: ${error.message}`);
        } finally {
            this.isScanning = false;
        }
    }
}