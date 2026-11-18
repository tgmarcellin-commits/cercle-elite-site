const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));

// Connexion à la base de données PostgreSQL (compatible Neon.tech)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// NOTE : La route d'accueil '/' a été retirée d'ici pour laisser 
// la place à l'application React (frontend) sur Vercel.

// Route de test de santé et de connexion DB
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ 
      status: 'success', 
      message: 'Serveur et base de données connectés avec succès !',
      databaseTime: result.rows[0].now 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur de connexion à la base de données PostgreSQL' });
  }
});

// Route pour récupérer la liste des membres depuis PostgreSQL
app.get('/api/members', async (req, res) => {
  try {
    // L'email n'est volontairement PAS renvoyé : l'API est publique.
    const result = await pool.query(
      `SELECT id, name, age, gender, sought, city, bio, photo, tier, created_at
       FROM members ORDER BY created_at DESC`
    );
    res.json({
      success: true,
      count: result.rows.length,
      members: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des membres' });
  }
});

// ---------------------------------------------------------------------------
// Création / mise à jour du schéma (idempotent, exécuté une seule fois par
// instance serverless au premier POST). Ne touche pas aux données existantes.
// ---------------------------------------------------------------------------
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS members (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name       TEXT NOT NULL,
          email      TEXT,
          gender     TEXT,
          sought     TEXT,
          city       TEXT,
          bio        TEXT,
          photo      TEXT,
          tier       TEXT NOT NULL DEFAULT 'standard',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      // Si la table existait déjà avec moins de colonnes, on complète.
      for (const col of ['email', 'gender', 'sought', 'city', 'bio', 'photo']) {
        await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS ${col} TEXT`);
      }
      await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'standard'`);
      await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
      // Un email = un compte (n'échoue pas si des doublons existent déjà)
      try {
        await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS members_email_unique ON members (LOWER(email))`);
      } catch (e) {
        console.warn('Index unique email non créé :', e.message);
      }
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

const GENDERS = ['Homme', 'Femme'];

// Route pour inscrire un nouveau membre dans PostgreSQL
app.post('/api/members', async (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name ?? body.pseudonym ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const gender = String(body.gender ?? '');
    const sought = String(body.sought ?? '');
    const city = String(body.city ?? '').trim();
    const bio = String(body.bio ?? '').trim();
    const photo = String(body.photo ?? '');

    // --- Validation ---
    if (name.length < 2 || name.length > 40) {
      return res.status(400).json({ success: false, error: 'Le pseudonyme doit faire entre 2 et 40 caractères.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ success: false, error: 'Adresse email invalide.' });
    }
    if (!GENDERS.includes(gender) || !GENDERS.includes(sought)) {
      return res.status(400).json({ success: false, error: 'Genre ou recherche invalide.' });
    }
    if (city.length < 2 || city.length > 60) {
      return res.status(400).json({ success: false, error: 'Ville invalide.' });
    }
    if (bio.length > 260) {
      return res.status(400).json({ success: false, error: 'La bio ne doit pas dépasser 260 caractères.' });
    }
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(photo) || photo.length > 3000000) {
      return res.status(400).json({ success: false, error: 'Photo invalide ou trop volumineuse.' });
    }
    // Les niveaux payants ne doivent jamais être attribués depuis le navigateur :
    // à l'inscription, tout le monde démarre en « standard ».
    const tier = 'standard';

    await ensureSchema();

    // Requête paramétrée ($1…$8) : aucune injection SQL possible.
    // L'id (UUID) et created_at sont générés par PostgreSQL.
    const result = await pool.query(
      `INSERT INTO members (name, email, gender, sought, city, bio, photo, tier)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, gender, sought, city, bio, photo, tier, created_at`,
      [name, email, gender, sought, city, bio || null, photo, tier]
    );

    res.status(201).json({ success: true, member: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: 'Cet email est déjà inscrit.' });
    }
    console.error(err);
    res.status(500).json({ success: false, error: "Erreur lors de l'inscription du membre" });
  }
});

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Serveur back-end démarré sur le port ${PORT}`);
  });
}

// Indispensable pour que Vercel exécute Express en mode serverless
module.exports = app;
