import { 
    Connection, 
    Keypair, 
    PublicKey, 
    VersionedTransaction, 
    TransactionMessage, 
    TransactionInstruction,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
    ComputeBudgetProgram
} from '@solana/web3.js';
import { 
    getAssociatedTokenAddress, 
    createAssociatedTokenAccountInstruction, 
    TOKEN_PROGRAM_ID, 
    ASSOCIATED_TOKEN_PROGRAM_ID 
} from '@solana/spl-token';
import bs58 from 'bs58';
import axios from 'axios';
import { logger } from '../utils/Logger.js';
import dotenv from 'dotenv';
import { Buffer } from 'buffer';

dotenv.config();

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const GLOBAL_ACCOUNT = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqPkpGGTJ1coy1vJm1pump");
const FEE_RECIPIENT = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");
const EVENT_AUTHORITY = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjxc7UyXVxv");

const JITO_ENGINES = [
    "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles",
    "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles",
    "https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles",
    "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles"
];

const JITO_TIP_ACCOUNTS = [
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "Hf3aaSbmJf8cxXHXpH37UYoY81af7yyPWWb5XtwYHMx7",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49"
];

export class Executor {
    private connection: Connection;
    private wallet: Keypair;

    constructor() {
        this.connection = new Connection(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com');
        const privKey = process.env.PRIVATE_KEY;
        if (!privKey) { process.exit(1); }
        this.wallet = Keypair.fromSecretKey(bs58.decode(privKey));
    }

    private getRandomJitoUrl(): string {
        return JITO_ENGINES[Math.floor(Math.random() * JITO_ENGINES.length)];
    }

    public async executeTrade(inputMint: string, outputMint: string, amountRaw: number): Promise<boolean> {
        if (inputMint !== 'So11111111111111111111111111111111111111112') return false;

        try {
            logger.info(`Executor ⚡: Construction TX Locale pour ${outputMint}...`);

            const mint = new PublicKey(outputMint);
            const owner = this.wallet.publicKey;

            // 1. Calcul adresses
            const [bondingCurve] = PublicKey.findProgramAddressSync(
                [Buffer.from("bonding-curve"), mint.toBuffer()], PUMP_PROGRAM
            );
            const [assocBondingCurve] = PublicKey.findProgramAddressSync(
                [bondingCurve.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID
            );

            // 2. Calcul Prix (Bonding Curve)
            const curveAccount = await this.connection.getAccountInfo(bondingCurve);
            if (!curveAccount) return false;

            const data = curveAccount.data;
            const virtualTokenReserves = data.readBigUInt64LE(8);
            const virtualSolReserves = data.readBigUInt64LE(16);
            
            const solIn = BigInt(amountRaw);
            const tokenOut = (virtualTokenReserves * solIn) / (virtualSolReserves + solIn);

            // ⚠️ MODIFICATION MAJEURE : SLIPPAGE AGRESSIF (50%)
            // On accepte de recevoir beaucoup moins de tokens que prévu si le prix bouge.
            // Cela garantit que la transaction ne "fail" pas à cause d'un changement de prix minime.
            const minTokensOut = (tokenOut * BigInt(50)) / BigInt(100); 

            logger.info(`Executor 📐: Mise: ${(Number(solIn)/1e9).toFixed(4)} SOL | Tokens attendus: ~${tokenOut} (Min: ${minTokensOut})`);

            // 3. Instructions
            const instructions: TransactionInstruction[] = [];

            instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150000 })); // Frais priorité augmentés
            instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }));

            const userTokenAccount = await getAssociatedTokenAddress(mint, owner);
            const accountInfo = await this.connection.getAccountInfo(userTokenAccount);
            if (!accountInfo) {
                instructions.push(createAssociatedTokenAccountInstruction(owner, userTokenAccount, owner, mint));
            }

            // BUY Instruction
            const discriminator = Buffer.from([102, 6, 61, 18, 1, 218, 235, 239]); 
            const amountBuffer = Buffer.alloc(8);
            const maxSolBuffer = Buffer.alloc(8);

            // On demande le montant MINIMUM de tokens (minTokensOut)
            // Et on dit qu'on paie le montant EXACT de SOL (solIn)
            // C'est l'inverse de la logique précédente, c'est plus robuste sur Pump.fun
            amountBuffer.writeBigUInt64LE(tokenOut); 
            const maxSolWithSlippage = (solIn * BigInt(120)) / BigInt(100); // On autorise 20% de SOL en plus au pire
            maxSolBuffer.writeBigUInt64LE(maxSolWithSlippage);

            const txData = Buffer.concat([discriminator, amountBuffer, maxSolBuffer]);

            const keys = [
                { pubkey: GLOBAL_ACCOUNT, isSigner: false, isWritable: false },
                { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
                { pubkey: mint, isSigner: false, isWritable: false },
                { pubkey: bondingCurve, isSigner: false, isWritable: true },
                { pubkey: assocBondingCurve, isSigner: false, isWritable: true },
                { pubkey: userTokenAccount, isSigner: false, isWritable: true },
                { pubkey: owner, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
                { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
                { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
            ];

            instructions.push(new TransactionInstruction({
                keys, programId: PUMP_PROGRAM, data: txData
            }));

            // Tip Jito
            const tipAccount = new PublicKey(JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]);
            instructions.push(SystemProgram.transfer({
                fromPubkey: owner, toPubkey: tipAccount, lamports: 100000 
            }));

            // 4. Envoi
            const { blockhash } = await this.connection.getLatestBlockhash("finalized");
            
            const messageV0 = new TransactionMessage({
                payerKey: owner, recentBlockhash: blockhash, instructions,
            }).compileToV0Message();

            const transaction = new VersionedTransaction(messageV0);
            transaction.sign([this.wallet]);

            const b58Tx = bs58.encode(transaction.serialize());
            const jitoUrl = this.getRandomJitoUrl();

            const payload = { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[b58Tx]] };

            const response = await axios.post(jitoUrl, payload, {
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.data.result) {
                logger.info(`Executor 🚀: TRANSACTION ENVOYÉE (Jito: ${jitoUrl.split('//')[1].split('.')[0]})`);
                return true;
            }
            return false;

        } catch (error: any) {
            if (error.response && error.response.status === 429) {
                logger.warn("Executor ⚠️: Jito Rate Limit (429)");
            } else {
                logger.error(`Executor: Erreur -> ${error.message}`);
            }
            return false;
        }
    }
}