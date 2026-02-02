import { Connection } from '@solana/web3.js';
import dotenv from 'dotenv';
import { logger } from './Logger.js';

dotenv.config();

export class ConnectionManager {
    private endpoints: string[];
    private currentIdx = 0;

    constructor() {
        // On récupère la liste et on nettoie les espaces éventuels
        const rawList = process.env.RPC_ENDPOINTS || 'https://api.mainnet-beta.solana.com';
        this.endpoints = rawList.split(',').map(url => url.trim());
        
        logger.info(`🔌 ConnectionManager: ${this.endpoints.length} RPCs chargés.`);
    }

    /**
     * Retourne une connexion active.
     * En cas d'erreur sur l'actuelle, passe à la suivante.
     */
    public getConnection(): Connection {
        const url = this.endpoints[this.currentIdx];
        // logger.info(`Using RPC: ${url.slice(0, 25)}...`); // Décommenter pour debug
        return new Connection(url, 'confirmed');
    }

    /**
     * Appelé quand une requête échoue ou renvoie vide.
     * Change l'endpoint actif pour le suivant dans la liste.
     */
    public rotateEndpoint(): Connection {
        this.currentIdx = (this.currentIdx + 1) % this.endpoints.length;
        const newUrl = this.endpoints[this.currentIdx];
        logger.warn(`🔄 ROTATION RPC -> Bascule sur : ${newUrl.slice(0, 25)}...`);
        return new Connection(newUrl, 'confirmed');
    }
    
    public getCount(): number {
        return this.endpoints.length;
    }
}