import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58'; // ✅ AJOUT : Import statique ici aussi
import { Keypair } from '@solana/web3.js'; // Import statique direct
import { RaydiumListener } from '../listeners/RaydiumListener.js';
import { RiskManager } from './RiskManager.js';
import { StrategyEngine, StrategyAction } from '../engines/Strategy.js';
import { Executor } from '../engines/Executor.js';
import { logger } from '../utils/Logger.js';
import { CONSTANTS, JUPITER_PRICE_API } from '../utils/Constants.js';

export class Brain {
    private connection: Connection;
    private listener: RaydiumListener;
    private riskManager: RiskManager;
    private strategy: StrategyEngine;
    private executor: Executor;

    private activeMints: Set<string> = new Set();
    private TOTAL_CAPITAL_SOL = 0.01; // ✅ Capital bas pour le test

    constructor() {
        this.connection = new Connection(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com');
        
        this.listener = new RaydiumListener(this.connection);
        this.riskManager = new RiskManager(this.connection);
        this.strategy = new StrategyEngine(this.riskManager);
        this.executor = new Executor();

        this.listener.onNewToken = (mint: string) => {
            this.handleNewToken(mint);
        };
    }

    public async start() {
        logger.info("🧠 TITAN BRAIN: Démarrage des systèmes...");
        await this.listener.startListening();
        this.startPriceMonitoringLoop();
        logger.info("🧠 TITAN BRAIN: Systèmes opérationnels.");
    }

    private async handleNewToken(mint: string) {
        if (this.activeMints.has(mint)) return;

        logger.info(`Brain ⚡: Analyse du candidat -> ${mint}`);
        const isSafe = await this.riskManager.validateTokenSafety(mint);
        
        if (!isSafe) {
            logger.warn(`Brain 🛡️: Token ${mint} REJETÉ.`);
            return;
        }

        const { entrySize } = this.riskManager.getTradeConfiguration('INITIAL_LAUNCH', this.TOTAL_CAPITAL_SOL);
        const amountLamports = Math.floor(entrySize * 1_000_000_000); 

        const buySuccess = await this.executor.executeTrade(CONSTANTS.SOL_MINT, mint, amountLamports);

        if (buySuccess) {
            this.activeMints.add(mint);
            logger.info(`Brain 🚀: Achat INITIAL confirmé sur ${mint}.`);
        }
    }

    private startPriceMonitoringLoop() {
        setInterval(async () => {
            if (this.activeMints.size === 0) return;

            const mints = Array.from(this.activeMints);
            const prices = await this.fetchPrices(mints);
            const now = Date.now();

            for (const mint of mints) {
                const price = prices[mint];
                if (!price) continue;

                const action: StrategyAction = await this.strategy.onPriceUpdate(mint, price, now);

                if (action === 'SELL_EXIT') {
                    await this.executeSell(mint);
                } 
                else if (action === 'BUY_REBOUND') {
                    await this.executeReboundBuy(mint);
                }
            }
        }, CONSTANTS.PRICE_CHECK_INTERVAL_MS);
    }

    private async executeSell(mint: string) {
        logger.info(`Brain 📉: Exécution VENTE TOTALE pour ${mint}`);
        
        const tokenBalance = await this.getTokenBalance(mint);

        if (tokenBalance <= 0) {
            logger.warn(`Brain: Tentative de vente sur ${mint} mais solde = 0.`);
            // this.activeMints.delete(mint); // Optionnel : retirer de la liste
            return;
        }

        const success = await this.executor.executeTrade(mint, CONSTANTS.SOL_MINT, tokenBalance);

        if (success) {
            logger.info(`Brain ✅: Vente confirmée pour ${mint}.`);
        }
    }

    private async executeReboundBuy(mint: string) {
        logger.info(`Brain 📈: Exécution ACHAT REBOND pour ${mint}`);
        const { entrySize } = this.riskManager.getTradeConfiguration('REBOUND_ENTRY', this.TOTAL_CAPITAL_SOL);
        const amountLamports = Math.floor(entrySize * 1_000_000_000);
        const success = await this.executor.executeTrade(CONSTANTS.SOL_MINT, mint, amountLamports);
        if (success) logger.info(`Brain ✅: Achat Rebond confirmé sur ${mint}.`);
    }

    private async getTokenBalance(mint: string): Promise<number> {
        try {
            // ✅ FIX: On utilise l'import statique bs58 défini en haut du fichier
            // Plus besoin d'import dynamique ici
            const wallet = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY!));

            const accounts = await this.connection.getParsedTokenAccountsByOwner(
                wallet.publicKey,
                { mint: new PublicKey(mint) }
            );

            if (accounts.value.length === 0) return 0;

            const tokenAmount = accounts.value[0].account.data.parsed.info.tokenAmount;
            return Number(tokenAmount.amount); 

        } catch (error) {
            logger.error(`Brain: Erreur lecture solde pour ${mint}`, error);
            return 0;
        }
    }

    private async fetchPrices(mints: string[]): Promise<Record<string, number>> {
        try {
            if (mints.length === 0) return {};
            const ids = mints.join(',');
            const response = await axios.get(`${JUPITER_PRICE_API}?ids=${ids}`);
            const data = response.data.data;
            const prices: Record<string, number> = {};
            for (const mint of mints) {
                if (data[mint]) prices[mint] = data[mint].price;
            }
            return prices;
        } catch (error) {
            logger.error("Brain: Erreur Jupiter Price API");
            return {};
        }
    }
}