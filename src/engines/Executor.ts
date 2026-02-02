import { 
    Connection, 
    Keypair, 
    PublicKey, 
    VersionedTransaction, 
    SystemProgram, 
    TransactionMessage 
} from '@solana/web3.js';
import bs58 from 'bs58'; // ✅ FIX : Import par défaut (le paquet entier)
import axios from 'axios';
import { logger } from '../utils/Logger.js';
import dotenv from 'dotenv';

dotenv.config();

// --- CONSTANTES ---
const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6';

// Comptes de "Pourboire" Jito
const JITO_TIP_ACCOUNTS = [
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "Hf3aaSbmJf8cxXHXpH37UYoY81af7yyPWWb5XtwYHMx7",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49"
];

export class Executor {
    private connection: Connection;
    private wallet: Keypair;
    private jitoUrl: string;

    constructor() {
        this.connection = new Connection(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com');
        
        const privKey = process.env.PRIVATE_KEY;
        if (!privKey) {
            logger.error("CRITICAL: PRIVATE_KEY manquante dans le fichier .env");
            process.exit(1);
        }

        try {
            // ✅ FIX : Utilisation de bs58.decode() au lieu de decode()
            this.wallet = Keypair.fromSecretKey(bs58.decode(privKey));
        } catch (err) {
            logger.error("CRITICAL: Clé privée invalide (Erreur de décodage Base58)");
            throw err;
        }
        
        this.jitoUrl = process.env.JITO_BLOCK_ENGINE_URL || 'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles';
    }

    public async executeTrade(inputMint: string, outputMint: string, amountRaw: number): Promise<boolean> {
        // --- MODE SIMULATION (DÉCOMMENTER POUR LE TEST DRY RUN) ---
        /*
        logger.info(`Executor 🧪 [SIMULATION]: Demande de trade ${inputMint} -> ${outputMint} | Montant: ${amountRaw}`);
        await new Promise(resolve => setTimeout(resolve, 100));
        logger.info(`Executor 🧪 [SIMULATION]: Trade "virtuellement" confirmé !`);
        return true;
        */
        // ---------------------------------------------------------

        try {
            logger.info(`Executor ⚙️: Calcul de route ${inputMint} -> ${outputMint} (${amountRaw})`);

            const quote = await this.getJupiterQuote(inputMint, outputMint, amountRaw);
            if (!quote) return false;

            const swapTransaction = await this.getSwapTransaction(quote);
            if (!swapTransaction) return false;

            const bundleId = await this.sendJitoBundle(swapTransaction);
            
            if (bundleId) {
                logger.info(`Executor 🚀: Bundle envoyé avec succès ! ID: ${bundleId}`);
                return true;
            } else {
                logger.error("Executor ❌: Échec de l'envoi du bundle Jito.");
                return false;
            }

        } catch (error) {
            logger.error(`Executor: Crash critique lors du trade`, error);
            return false;
        }
    }

    private async getJupiterQuote(inputMint: string, outputMint: string, amount: number) {
        try {
            const url = `${JUPITER_QUOTE_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${Math.floor(amount)}&slippageBps=50`;
            const response = await axios.get(url);
            return response.data;
        } catch (error) {
            logger.error("Executor: Erreur Jupiter Quote", error);
            return null;
        }
    }

    private async getSwapTransaction(quoteResponse: any): Promise<VersionedTransaction | null> {
        try {
            const response = await axios.post(`${JUPITER_QUOTE_API}/swap`, {
                quoteResponse,
                userPublicKey: this.wallet.publicKey.toString(),
                wrapAndUnwrapSol: true,
            });
            
            const swapTransactionBuf = Buffer.from(response.data.swapTransaction, 'base64');
            const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
            transaction.sign([this.wallet]);
            
            return transaction;
        } catch (error) {
            logger.error("Executor: Erreur Swap Tx", error);
            return null;
        }
    }

    private async sendJitoBundle(swapTransaction: VersionedTransaction): Promise<string | null> {
        try {
            const tipAccount = new PublicKey(JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]);
            const tipAmount = 100000; // 0.0001 SOL
            
            const tipInstruction = SystemProgram.transfer({
                fromPubkey: this.wallet.publicKey,
                toPubkey: tipAccount,
                lamports: tipAmount
            });

            const { blockhash } = await this.connection.getLatestBlockhash("finalized");
            
            const messageV0 = new TransactionMessage({
                payerKey: this.wallet.publicKey,
                recentBlockhash: blockhash,
                instructions: [tipInstruction],
            }).compileToV0Message();

            const tipTransaction = new VersionedTransaction(messageV0);
            tipTransaction.sign([this.wallet]);

            // ✅ FIX : Utilisation de bs58.encode()
            const b58Swap = bs58.encode(swapTransaction.serialize());
            const b58Tip = bs58.encode(tipTransaction.serialize());

            const payload = {
                jsonrpc: "2.0",
                id: 1,
                method: "sendBundle",
                params: [[b58Swap, b58Tip]]
            };

            const response = await axios.post(this.jitoUrl, payload, {
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.data.result) {
                return response.data.result;
            } else {
                logger.error("Executor: Erreur API Jito", response.data);
                return null;
            }

        } catch (error) {
            logger.error("Executor: Erreur réseau Jito", error);
            return null;
        }
    }
}