const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const {
  OTP_TTL_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SEC,
  getSecret,
  generateOtp,
  hashOtp,
  safeEqual,
} = require('./utils/otp');
const { sendOtpEmail } = require('./utils/mailer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' })); // photo en base64 (≈ 2,4 Mo max)

// Connexion à la base de données PostgreSQL (compatible Neon.tech)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ---------------------------------------------------------------------------
// Constantes & utilitaires
// ---------------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENDERS = ['Homme', 'Femme'];
const TIERS = ['standard', 'confirme', 'vip', 'elite']; // mêmes identifiants que le front
const SESSION_TTL = '7d';

// Colonnes renvoyées au client (jamais password_hash)
const MEMBER_COLUMNS = 'id, email, pseudonym, name, gender, sought, city, bio, photo, tier, created_at';

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function toMember(row) {
  const pseudonym = row.pseudonym || row.name;
  return {
    id: String(row.id),
    email: row.email,
    pseudonym,
    name: pseudonym,
    gender: row.gender,
    sought: row.sought,
    city: row.city,
    bio: row.bio || '',
    photo: row.photo,
    tier: row.tier,
    created_at: row.created_at,
  };
}

// Valideurs de champs de profil
const fieldValidators = {
  pseudonym: (v) => {
    const s = String(v).trim();
    if (s.length < 2 || s.length > 40) throw new HttpError(400, 'Le pseudonyme doit faire entre 2 et 40 caractères.');
    return s;
  },
  gender: (v) => {
    if (!GENDERS.includes(v)) throw new HttpError(400, 'Genre invalide.');
    return v;
  },
  sought: (v) => {
    if (!GENDERS.includes(v)) throw new HttpError(400, 'Recherche invalide.');
    return v;
  },
  city: (v) => {
    const s = String(v).trim();
    if (s.length < 2 || s.length > 60) throw new HttpError(400, 'Ville invalide.');
    return s;
  },
  bio: (v) => {
    const s = String(v).trim();
    if (s.length > 260) throw new HttpError(400, 'La bio ne doit pas dépasser 260 caractères.');
    return s;
  },
  photo: (v) => {
    const s = String(v);
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(s) || s.length > 3000000) {
      throw new HttpError(400, 'Photo invalide ou trop volumineuse.');
    }
    return s;
  },
  tier: (v) => {
    if (!TIERS.includes(v)) throw new HttpError(400, 'Niveau invalide.');
    return v;
  },
};

// Lit et valide les champs de profil. Champ absent => null (ou erreur si requis).
function readProfileFields(body, required) {
  const out = {};
  for (const field of Object.keys(fieldValidators)) {
    const raw = field === 'pseudonym' ? (body.pseudonym ?? body.name) : body[field];
    if (raw === undefined || raw === null) {
      if (required.includes(field)) throw new HttpError(400, `Champ requis : ${field}.`);
      out[field] = null;
    } else {
      out[field] = fieldValidators[field](raw);
    }
  }
  return out;
}

function validateEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'Adresse e-mail invalide.');
  return email;
}

function validatePassword(value) {
  const password = String(value ?? '');
  if (password.length < 8) throw new HttpError(400, 'Le mot de passe doit contenir au moins 8 caractères.');
  if (Buffer.byteLength(password) > 72) throw new HttpError(400, 'Le mot de passe est trop long (72 octets maximum).');
  return password;
}

const signSession = (memberRow) =>
  jwt.sign({ sub: String(memberRow.id) }, getSecret(), { expiresIn: SESSION_TTL });

// Middleware : exige un jeton de session valide (Authorization: Bearer …)
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentification requise.', code: 'UNAUTHENTICATED' });
  }
  const secret = getSecret();
  try {
    const payload = jwt.verify(token, secret);
    if (payload.purpose) throw new Error('Jeton non valable pour une session.');
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Session expirée. Reconnectez-vous.', code: 'SESSION_EXPIRED' });
  }
}

// ---------------------------------------------------------------------------
// Schéma de la base (idempotent, exécuté une fois par instance serverless)
// ---------------------------------------------------------------------------
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS members (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email         TEXT,
          password_hash TEXT,
          pseudonym     TEXT,
          name          TEXT,
          age           INTEGER,
          gender        TEXT,
          sought        TEXT,
          city          TEXT,
          bio           TEXT,
          photo         TEXT,
          tier          TEXT NOT NULL DEFAULT 'standard',
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      // Table déjà existante : on complète les colonnes manquantes, sans toucher aux données.
      for (const col of ['email', 'password_hash', 'pseudonym', 'name', 'gender', 'sought', 'city', 'bio', 'photo']) {
        await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS ${col} TEXT`);
      }
      await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS age INTEGER`);
      await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'standard'`);
      await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
      try { await pool.query(`ALTER TABLE members ALTER COLUMN name DROP NOT NULL`); } catch (e) { /* ignoré */ }
      // Anciens membres : le pseudonyme reprend l'ancien champ « name »
      await pool.query(`UPDATE members SET pseudonym = name WHERE pseudonym IS NULL AND name IS NOT NULL`);
      // Un e-mail = un compte (sans échec si d'anciens doublons existent)
      try {
        await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS members_email_unique ON members (LOWER(email))`);
      } catch (e) {
        console.warn('Index unique e-mail non créé :', e.message);
      }
      await pool.query(`
        CREATE TABLE IF NOT EXISTS otp_codes (
          email      TEXT NOT NULL,
          purpose    TEXT NOT NULL,
          code_hash  TEXT NOT NULL,
          attempts   INTEGER NOT NULL DEFAULT 0,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (email, purpose)
        )`);
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

// Enveloppe les routes : schéma prêt + gestion uniforme des erreurs
const route = (handler) => async (req, res, next) => {
  try {
    await ensureSchema();
    await handler(req, res, next);
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ success: false, error: err.message, code: err.code });
    }
    if (err && err.code === '23505') {
      return res.status(409).json({ success: false, error: 'Cet e-mail est déjà inscrit.', code: 'EMAIL_EXISTS' });
    }
    if (err && err.code === 'MAIL_NOT_CONFIGURED') {
      console.error(err.message);
      return res.status(503).json({ success: false, error: "L'envoi d'e-mails n'est pas encore configuré sur le serveur.", code: 'MAIL_NOT_CONFIGURED' });
    }
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur interne du serveur.' });
  }
};

// ---------------------------------------------------------------------------
// OTP : émission et vérification (stockés en base : compatible serverless)
// ---------------------------------------------------------------------------
async function issueOtp(email, purpose) {
  const existing = await pool.query('SELECT created_at FROM otp_codes WHERE email = $1 AND purpose = $2', [email, purpose]);
  if (existing.rows[0]) {
    const ageSec = (Date.now() - new Date(existing.rows[0].created_at).getTime()) / 1000;
    if (ageSec < OTP_RESEND_COOLDOWN_SEC) {
      throw new HttpError(429, 'Un code vient d’être envoyé. Patientez une minute avant d’en demander un nouveau.', 'OTP_COOLDOWN');
    }
  }
  const code = generateOtp();
  await pool.query(
    `INSERT INTO otp_codes (email, purpose, code_hash, attempts, expires_at, created_at)
     VALUES ($1, $2, $3, 0, NOW() + make_interval(mins => $4::int), NOW())
     ON CONFLICT (email, purpose) DO UPDATE
       SET code_hash = EXCLUDED.code_hash, attempts = 0,
           expires_at = EXCLUDED.expires_at, created_at = NOW()`,
    [email, purpose, hashOtp(email, purpose, code), OTP_TTL_MINUTES]
  );
  try {
    await sendOtpEmail(email, code, purpose);
  } catch (err) {
    await pool.query('DELETE FROM otp_codes WHERE email = $1 AND purpose = $2', [email, purpose]);
    throw err;
  }
}

async function checkOtp(email, purpose, code) {
  const result = await pool.query(
    'SELECT code_hash, attempts, expires_at FROM otp_codes WHERE email = $1 AND purpose = $2',
    [email, purpose]
  );
  const row = result.rows[0];
  if (!row || new Date(row.expires_at) < new Date()) {
    throw new HttpError(400, 'Code expiré ou introuvable. Demandez un nouveau code.', 'OTP_EXPIRED');
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    throw new HttpError(429, 'Trop de tentatives. Demandez un nouveau code.', 'OTP_LOCKED');
  }
  if (!/^\d{6}$/.test(code) || !safeEqual(hashOtp(email, purpose, code), row.code_hash)) {
    await pool.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE email = $1 AND purpose = $2', [email, purpose]);
    throw new HttpError(400, 'Code incorrect.', 'OTP_INVALID');
  }
  await pool.query('DELETE FROM otp_codes WHERE email = $1 AND purpose = $2', [email, purpose]); // usage unique
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

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

// Liste publique des membres (sans e-mail ni mot de passe)
app.get('/api/members', route(async (req, res) => {
  const result = await pool.query(
    `SELECT id, COALESCE(pseudonym, name) AS name, age, gender, sought, city, bio, photo, tier, created_at
     FROM members ORDER BY created_at DESC`
  );
  res.json({ success: true, count: result.rows.length, members: result.rows });
}));

// INSCRIPTION — étape 1 : envoi du code OTP à l'e-mail
app.post('/api/auth/request-otp', route(async (req, res) => {
  const email = validateEmail(req.body.email);
  const exists = await pool.query('SELECT 1 FROM members WHERE LOWER(email) = $1', [email]);
  if (exists.rows.length) {
    throw new HttpError(409, 'Cet e-mail est déjà inscrit. Connectez-vous.', 'EMAIL_EXISTS');
  }
  await issueOtp(email, 'register');
  res.json({ success: true });
}));

// INSCRIPTION — étape 3 : création du compte (e-mail déjà prouvé par l'OTP)
app.post('/api/auth/register', route(async (req, res) => {
  const body = req.body || {};
  let email;
  try {
    const payload = jwt.verify(String(body.registrationToken || ''), getSecret());
    if (payload.purpose !== 'register' || !payload.email) throw new Error('mauvais jeton');
    email = payload.email;
  } catch {
    throw new HttpError(401, 'Vérification e-mail expirée. Recommencez l’inscription.', 'REGISTRATION_EXPIRED');
  }

  const password = validatePassword(body.password);
  const f = readProfileFields(body, ['pseudonym', 'gender', 'sought', 'city', 'photo', 'tier']);

  const exists = await pool.query('SELECT 1 FROM members WHERE LOWER(email) = $1', [email]);
  if (exists.rows.length) throw new HttpError(409, 'Cet e-mail est déjà inscrit.', 'EMAIL_EXISTS');

  const passwordHash = await bcrypt.hash(password, 10);
  // TODO paiement : vérifier le paiement (CinetPay) avant d'accepter un niveau payant.
  const result = await pool.query(
    `INSERT INTO members (email, password_hash, pseudonym, name, gender, sought, city, bio, photo, tier)
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${MEMBER_COLUMNS}`,
    [email, passwordHash, f.pseudonym, f.gender, f.sought, f.city, f.bio ?? '', f.photo, f.tier]
  );
  const row = result.rows[0];
  res.status(201).json({ success: true, token: signSession(row), member: toMember(row) });
}));

// CONNEXION — étape 1 : e-mail + mot de passe, puis envoi du code OTP
app.post('/api/auth/login', route(async (req, res) => {
  const email = validateEmail(req.body.email);
  const password = String(req.body.password ?? '');
  const result = await pool.query('SELECT id, password_hash FROM members WHERE LOWER(email) = $1', [email]);
  const row = result.rows[0];
  if (!row) throw new HttpError(404, 'Aucun compte ne correspond à cet e-mail.', 'NO_ACCOUNT');
  if (!row.password_hash) {
    throw new HttpError(401, 'Ce compte n’a pas de mot de passe. Créez votre profil à nouveau.', 'NO_PASSWORD');
  }
  if (!password || !(await bcrypt.compare(password, row.password_hash))) {
    throw new HttpError(401, 'E-mail ou mot de passe incorrect.', 'INVALID_CREDENTIALS');
  }
  await issueOtp(email, 'login');
  res.json({ success: true, otpRequired: true });
}));

// Vérification du code OTP (inscription ou connexion)
app.post('/api/auth/verify-otp', route(async (req, res) => {
  const email = validateEmail(req.body.email);
  const code = String(req.body.code ?? '').trim();
  const purpose = req.body.purpose;

  if (purpose === 'register') {
    await checkOtp(email, 'register', code);
    const registrationToken = jwt.sign({ email, purpose: 'register' }, getSecret(), { expiresIn: '30m' });
    return res.json({ success: true, registrationToken });
  }
  if (purpose === 'login') {
    await checkOtp(email, 'login', code);
    const result = await pool.query(`SELECT ${MEMBER_COLUMNS} FROM members WHERE LOWER(email) = $1`, [email]);
    const row = result.rows[0];
    if (!row) throw new HttpError(404, 'Aucun compte ne correspond à cet e-mail.', 'NO_ACCOUNT');
    return res.json({ success: true, token: signSession(row), member: toMember(row) });
  }
  throw new HttpError(400, 'Type de vérification invalide.');
}));

// Session courante (restauration au chargement de la page)
app.get('/api/auth/me', authRequired, route(async (req, res) => {
  const result = await pool.query(`SELECT ${MEMBER_COLUMNS} FROM members WHERE id::text = $1`, [req.auth.sub]);
  if (!result.rows[0]) throw new HttpError(401, 'Compte introuvable.', 'SESSION_EXPIRED');
  res.json({ success: true, member: toMember(result.rows[0]) });
}));

// Mise à jour du profil — uniquement par le propriétaire du compte
app.put('/api/members/:id', authRequired, route(async (req, res) => {
  if (String(req.auth.sub) !== String(req.params.id)) {
    throw new HttpError(403, 'Vous ne pouvez modifier que votre propre profil.', 'FORBIDDEN');
  }
  const f = readProfileFields(req.body || {}, []); // champs absents => inchangés
  // TODO paiement : vérifier le paiement avant d'accepter un changement vers un niveau payant.
  const result = await pool.query(
    `UPDATE members SET
       pseudonym = COALESCE($1, pseudonym),
       name      = COALESCE($1, name),
       gender    = COALESCE($2, gender),
       sought    = COALESCE($3, sought),
       city      = COALESCE($4, city),
       bio       = COALESCE($5, bio),
       photo     = COALESCE($6, photo),
       tier      = COALESCE($7, tier)
     WHERE id::text = $8
     RETURNING ${MEMBER_COLUMNS}`,
    [f.pseudonym, f.gender, f.sought, f.city, f.bio, f.photo, f.tier, req.params.id]
  );
  if (!result.rows[0]) throw new HttpError(404, 'Membre introuvable.');
  res.json({ success: true, member: toMember(result.rows[0]) });
}));

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Serveur back-end démarré sur le port ${PORT}`);
  });
}

// Indispensable pour que Vercel exécute Express en mode serverless
module.exports = app;
