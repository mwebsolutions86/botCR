import { Brain } from './core/Brain.js';
import { logger } from './utils/Logger.js';
import dotenv from 'dotenv';

// Chargement des variables d'environnement
dotenv.config();

async function main() {
    console.clear();
    console.log(`
    💎 TITAN ALGORITHMIC TRADING ENGINE 💎
    ---------------------------------------
    Architecture: Solana / Jito / Jupiter
    Mode: Autonomous
    ---------------------------------------
    `);

    try {
        const bot = new Brain();
        await bot.start();
        
        logger.info("TITAN est en ligne et scanne la mempool...");

    } catch (error) {
        logger.error("FATAL ERROR: Le bot s'est arrêté.", error);
        process.exit(1);
    }
}

// Gestion des arrêts propres (Ctrl+C)
process.on('SIGINT', () => {
    logger.info("Arrêt manuel détecté. Fermeture des connexions...");
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

main();