import { Connection } from '@solana/web3.js';
import axios from 'axios';
import { logger } from '../utils/Logger.js';

const NEW_POOLS_API = "https://api.geckoterminal.com/api/v2/networks/solana/new_pools";

// Structure des données financières
export interface TokenMetrics {
    mint: string;
    name: string;
    marketCap: number;
    liquidity: number;
    volumeM5: number;   // Volume des 5 dernières minutes
    txCountM5: number;  // Nombre de transactions (5 min)
    poolAge: number;    // En minutes
}

export class RaydiumListener {
    private connection: Connection;
    public onNewToken?: (metrics: TokenMetrics) => void;
    private isScanning = false;
    private processedMints: Set<string> = new Set();

    constructor(connection: Connection) {
        this.connection = connection;
    }

    public async startListening() {
        logger.info("🎧 RaydiumListener: Mode ANALYSTE (GeckoTerminal).");
        logger.info("📊 Suivi: MarketCap, Liq, Volume, Transactions...");

        setInterval(async () => {
            await this.scanGeckoTerminal();
        }, 3000); 
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

            for (const pool of pools) {
                const dexId = pool.relationships?.dex?.data?.id; 
                // On accepte Raydium et Pump.fun (si indexé)
                if (dexId !== 'raydium' && dexId !== 'pump-fun') continue;

                const baseTokenId = pool.relationships?.base_token?.data?.id; 
                if (!baseTokenId) continue;
                const mint = baseTokenId.replace('solana_', '');

                if (this.processedMints.has(mint)) continue;

                // --- EXTRACTION DES DONNÉES ANALYTIQUES ---
                const createdAt = new Date(pool.attributes.pool_created_at).getTime();
                const ageMin = (Date.now() - createdAt) / 1000 / 60;
                
                // On ignore les tokens trop vieux (> 60 min) pour ce bot de sniping
                if (ageMin > 60) continue;

                const fdv = parseFloat(pool.attributes.fdv_usd || '0'); // Market Cap
                const liq = parseFloat(pool.attributes.reserve_in_usd || '0'); // Liquidité
                const volM5 = parseFloat(pool.attributes.volume_usd?.m5 || '0'); // Volume 5 min
                
                const txBuy = pool.attributes.transactions?.m5?.buys || 0;
                const txSell = pool.attributes.transactions?.m5?.sells || 0;
                const totalTx = txBuy + txSell;

                const metrics: TokenMetrics = {
                    mint: mint,
                    name: pool.attributes.name,
                    marketCap: fdv,
                    liquidity: liq,
                    volumeM5: volM5,
                    txCountM5: totalTx,
                    poolAge: ageMin
                };

                logger.info(`🚨 DETECTÉ: ${metrics.name} | MC: $${fdv.toFixed(0)} | Liq: $${liq.toFixed(0)} | Tx(5m): ${totalTx}`);

                this.processedMints.add(mint);
                
                if (this.onNewToken) {
                    this.onNewToken(metrics); // On envoie le dossier complet au Cerveau
                    break; 
                }
            }
        } catch (error: any) {
            // logger.error(`Erreur Listener: ${error.message}`);
        } finally {
            this.isScanning = false;
        }
    }
}