// Point d'entrée serverless Vercel : réutilise l'app Express de /server
// (Vercel n'exécute les fonctions que depuis le dossier /api).
import app from '../server/index.js';

export default app;
