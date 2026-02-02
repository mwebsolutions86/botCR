import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';
import { RaydiumListener, TokenMetrics } from '../listeners/RaydiumListener.js';
import { RiskManager } from './RiskManager.js';
import { StrategyEngine } from '../engines/Strategy.js';
import { Executor } from '../engines/Executor.js';
import { logger } from '../utils/Logger.js';
import { CONSTANTS, JUPITER_PRICE_API } from '../utils/Constants.js';
import dotenv from 'dotenv';

dotenv.config();

export class Brain {
    private connection: Connection;
    private wallet: Keypair;
    private listener: RaydiumListener;
    private riskManager: RiskManager;
    private strategy: StrategyEngine;
    private executor: Executor;
    private activeMints: Set<string> = new Set();

    constructor() {
        this.connection = new Connection(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com');
        
        if (!process.env.PRIVATE_KEY) {
            logger.error("Brain 🔴: PRIVATE_KEY manquante dans le .env");
            process.exit(1);
        }
        
        this.wallet = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY!));
        this.listener = new RaydiumListener(this.connection);
        this.riskManager = new RiskManager(this.connection);
        this.strategy = new StrategyEngine(this.riskManager);
        this.executor = new Executor();

        // Liaison avec le listener sélectif
        this.listener.onNewToken = (metrics) => this.handleNewToken(metrics);
    }

    /**
     * Démarre le moteur Titan
     */
    public async start() {
        try {
            const balance = await this.connection.getBalance(this.wallet.publicKey);
            logger.info(`🧠 TITAN-BRAIN : Démarrage... Solde: ${(balance / 1e9).toFixed(4)} SOL`);
            
            await this.listener.startListening();
            this.startPriceMonitoringLoop();
            
            logger.info("🧠 TITAN-BRAIN : Système opérationnel et prêt à sniper.");
        } catch (error) {
            logger.error("Brain 🔴: Erreur au démarrage", error);
        }
    }

    /**
     * Analyse et exécution d'un trade sur signal
     */
    private async handleNewToken(metrics: TokenMetrics) {
        if (this.activeMints.has(metrics.mint)) return;

        // 1. Audit de sécurité on-chain (Mint/Freeze Authority)
        const isSafe = await this.riskManager.validateMeme(metrics.mint);
        if (!isSafe) return;

        const balanceLamports = await this.connection.getBalance(this.wallet.publicKey);
        const balanceSol = balanceLamports / 1e9;
        
        // 2. Récupération de la config de mise
        const config = this.riskManager.getTradeConfiguration(balanceSol);

        if (balanceSol < 0.05) {
            logger.warn(`Brain ⚠️: Solde trop bas (${balanceSol.toFixed(4)} SOL). Envoie du SOL pour trader.`);
            return;
        }

        logger.info(`🚀 EXECUTION : Achat de ${config.entrySize} SOL sur ${metrics.mint}`);

        // 3. Exécution de l'achat (Swap SOL -> Token)
        const success = await this.executor.executeTrade(
            CONSTANTS.SOL_MINT, 
            metrics.mint, 
            Math.floor(config.entrySize * 1e9)
        );

        if (success) {
            this.activeMints.add(metrics.mint);
            logger.info(`✅ POSITION OUVERTE : ${metrics.mint}`);
        }
    }

    /**
     * Surveillance active des prix et gestion des sorties (TP/SL/Partial)
     */
    private startPriceMonitoringLoop() {
        setInterval(async () => {
            if (this.activeMints.size === 0) return;
            
            const mints = Array.from(this.activeMints);
            const prices = await this.fetchPrices(mints);
            const now = Date.now();
            
            for (const mint of mints) {
                const price = prices[mint];
                if (!price) continue;
                
                // Calcul de l'action à entreprendre selon la stratégie
                const action = await this.strategy.onPriceUpdate(mint, price, now);
                
                if (action === 'SELL_PARTIAL') {
                    // Sécurisation : Vente de 50% (Break-even)
                    await this.executeSell(mint, true);
                } else if (action === 'SELL_EXIT') {
                    // Sortie totale (TP final ou Stop Loss)
                    await this.executeSell(mint, false);
                }
            }
        }, 3000); // Intervalle de 3s pour éviter le 429 RPC
    }

    /**
     * Logique de vente (Swap Token -> SOL)
     */
    private async executeSell(mint: string, isPartial: boolean = false) {
        const typeLabel = isPartial ? "PARTIELLE (50%)" : "TOTALE";
        
        try {
            const totalBalance = await this.getTokenBalance(mint);
            if (totalBalance <= 0) {
                this.activeMints.delete(mint);
                return;
            }

            // Calcul du montant à vendre
            const amountToSell = isPartial ? Math.floor(totalBalance / 2) : totalBalance;

            logger.info(`📉 Brain : VENTE ${typeLabel} sur ${mint}`);

            const success = await this.executor.executeTrade(
                mint, 
                CONSTANTS.SOL_MINT, 
                amountToSell
            );

            if (success) {
                logger.info(`✅ Brain : Vente ${typeLabel} réussie.`);
                // On ne retire du set que si la vente est totale
                if (!isPartial) {
                    this.activeMints.delete(mint);
                }
            }
        } catch (error) {
            logger.error(`Brain ❌: Échec vente ${typeLabel} sur ${mint}`, error);
        }
    }

    /**
     * Récupère le solde réel de tokens SPL
     */
    private async getTokenBalance(mint: string): Promise<number> {
        try {
            const accounts = await this.connection.getParsedTokenAccountsByOwner(
                this.wallet.publicKey, 
                { mint: new PublicKey(mint) }
            );
            return accounts.value[0] ? Number(accounts.value[0].account.data.parsed.info.tokenAmount.amount) : 0;
        } catch (e) { 
            return 0; 
        }
    }

    /**
     * Batch fetch des prix via Jupiter
     */
    private async fetchPrices(mints: string[]): Promise<Record<string, number>> {
        try {
            if (mints.length === 0) return {};
            const response = await axios.get(`${JUPITER_PRICE_API}?ids=${mints.join(',')}`);
            const data = response.data.data;
            const prices: Record<string, number> = {};
            for (const m of mints) {
                if (data[m]) prices[m] = data[m].price;
            }
            return prices;
        } catch (e) { 
            return {}; 
        }
    }
}