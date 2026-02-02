import { PublicKey } from '@solana/web3.js';

export const CONSTANTS = {
    // Adresses Clés
    SOL_MINT: 'So11111111111111111111111111111111111111112',
    RAYDIUM_PROGRAM_ID: '675k1q2AYp745G2fgp18n65pS1oBa2YghYtV66P5m754',
    
    // Configuration Trading
    MAX_CONCURRENT_TRADES: 5,  // Limite pour ne pas diluer le capital
    TAKE_PROFIT_PERCENT: 2.0,  // x2 (200%) - Objectif long terme (exemple)
    
    // Timeouts & Intervalles
    PRICE_CHECK_INTERVAL_MS: 2000, // Vérifier les prix toutes les 2s
    AUTO_SELL_TIMEOUT_MS: 30 * 60 * 1000, // Vendre de force après 30 min si rien ne se passe
};

// URL API Prix (Jupiter est excellent pour les prix gratuits & précis)
export const JUPITER_PRICE_API = 'https://price.jup.ag/v6/price';