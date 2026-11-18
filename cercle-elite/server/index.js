const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Connexion à la base de données PostgreSQL (compatible Neon.tech)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Route d'accueil pour éviter l'erreur "Cannot GET /"
app.get('/', (req, res) => {
  res.json({
    status: 'success',
    message: 'Bienvenue sur l’API de Cercle-Elite 🚀',
    endpoints: {
      health: '/api/health',
      members: '/api/members'
    }
  });
});

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
    const result = await pool.query('SELECT * FROM members ORDER BY created_at DESC');
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Serveur back-end démarré sur le port ${PORT}`);
});
