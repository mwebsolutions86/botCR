import { Brain } from './core/Brain.js';
import { logger } from './utils/Logger.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    console.clear();
    console.log(`
    💎 TITAN ALGORITHMIC TRADING ENGINE 💎
    ---------------------------------------
    Version: Stable (IPv4 Forced)
    ---------------------------------------
    `);

    try {
        const bot = new Brain();
        await bot.start();
        
    } catch (error) {
        logger.error("FATAL ERROR", error);
        process.exit(1);
    }
}

process.on('SIGINT', () => {
    process.exit(0);
});

main();