import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';
import { RaydiumListener, TokenMetrics } from '../listeners/RaydiumListener.js';
import { RiskManager } from './RiskManager.js';
import { StrategyEngine, StrategyAction } from '../engines/Strategy.js';
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
        
        const privKey = process.env.PRIVATE_KEY;
        if (!privKey) { process.exit(1); }
        this.wallet = Keypair.fromSecretKey(bs58.decode(privKey));

        this.listener = new RaydiumListener(this.connection);
        this.riskManager = new RiskManager(this.connection);
        this.strategy = new StrategyEngine(this.riskManager);
        this.executor = new Executor();

        // Le listener envoie maintenant un objet 'metrics' complet
        this.listener.onNewToken = (metrics: TokenMetrics) => {
            this.handleNewToken(metrics);
        };
    }

    public async start() {
        const balance = await this.connection.getBalance(this.wallet.publicKey);
        logger.info(`🧠 TITAN BRAIN: Démarrage... Solde Wallet: ${(balance / 1e9).toFixed(4)} SOL`);
        await this.listener.startListening();
        this.startPriceMonitoringLoop();
        logger.info("🧠 TITAN BRAIN: Prêt et en attente d'opportunités.");
    }

    private async handleNewToken(metrics: TokenMetrics) {
        if (this.activeMints.has(metrics.mint)) return;

        logger.info(`Brain ⚡: Analyse Approfondie -> ${metrics.name} (${metrics.mint})`);

        // ÉTAPE 1 : Validation Financière (MC, Liq, Tx) - Très rapide
        const isFinanciallyViable = this.riskManager.validateMarketMetrics(metrics);
        if (!isFinanciallyViable) return;

        // ÉTAPE 2 : Validation Sécurité (RugCheck / Analystes) - Un peu plus long (~1s)
        const isSafe = await this.riskManager.checkRugCheckScore(metrics.mint);
        if (!isSafe) return;

        // ÉTAPE 3 : Vérification Budget
        const balanceLamports = await this.connection.getBalance(this.wallet.publicKey);
        const balanceSol = balanceLamports / 1_000_000_000;

        if (balanceSol < 0.002) {
            logger.warn(`Brain ⚠️: Solde insuffisant (${balanceSol.toFixed(4)} SOL).`);
            return;
        }

        // ÉTAPE 4 : Calcul de la mise (10%)
        const { entrySize } = this.riskManager.getTradeConfiguration('INITIAL_LAUNCH', balanceSol);
        const amountLamports = Math.floor(entrySize * 1_000_000_000); 

        logger.info(`Brain 💰: Validation Totale OK. Tir de ${entrySize} SOL sur ${metrics.name}`);

        // ÉTAPE 5 : Exécution
        const buySuccess = await this.executor.executeTrade(CONSTANTS.SOL_MINT, metrics.mint, amountLamports);

        if (buySuccess) {
            this.activeMints.add(metrics.mint);
            logger.info(`Brain 🚀: ACHAT CONFIRMÉ sur ${metrics.name}`);
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
            }
        }, CONSTANTS.PRICE_CHECK_INTERVAL_MS);
    }

    private async executeSell(mint: string) {
        logger.info(`Brain 📉: VENTE DÉCLENCHÉE pour ${mint}`);
        const tokenBalance = await this.getTokenBalance(mint);
        if (tokenBalance <= 0) return;

        const success = await this.executor.executeTrade(mint, CONSTANTS.SOL_MINT, tokenBalance);
        if (success) {
            logger.info(`Brain ✅: Position clôturée.`);
            this.activeMints.delete(mint);
        }
    }

    private async getTokenBalance(mint: string): Promise<number> {
        try {
            const accounts = await this.connection.getParsedTokenAccountsByOwner(
                this.wallet.publicKey, { mint: new PublicKey(mint) }
            );
            if (accounts.value.length === 0) return 0;
            return Number(accounts.value[0].account.data.parsed.info.tokenAmount.amount); 
        } catch (error) {
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
            return {};
        }
    }
}