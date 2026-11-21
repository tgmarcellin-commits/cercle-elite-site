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
const SUBSCRIPTION_DAYS = 30; // durée d'un abonnement payant (niveaux confirmé, vip, élite)

// Colonnes renvoyées au client (jamais password_hash)
const MEMBER_COLUMNS = 'id, email, pseudonym, name, age, birth_date, gender, sought, city, bio, photo, tier, tier_expires_at, created_at, terms_accepted_at, is_exempt, is_suspended';

class HttpError extends Error {
  constructor(status, message, code, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra || {};
  }
}

function calculateAge(birthDateStr) {
  if (!birthDateStr) return null;
  const dob = new Date(birthDateStr);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) {
    age--;
  }
  return age;
}

function toMember(row) {
  const pseudonym = row.pseudonym || row.name;
  const birthDate = row.birth_date ? new Date(row.birth_date).toISOString().slice(0, 10) : '';
  const computedAge = birthDate ? calculateAge(birthDate) : row.age;
  return {
    id: String(row.id),
    email: row.email,
    pseudonym,
    name: pseudonym,
    age: computedAge ?? 30,
    birth_date: birthDate,
    gender: row.gender,
    sought: row.sought,
    city: row.city,
    bio: row.bio || '',
    photo: row.photo,
    tier: row.tier,
    created_at: row.created_at,
    tierExpiresAt: row.is_exempt ? null : (row.tier_expires_at || null),
    isExempt: Boolean(row.is_exempt),
    termsAcceptedAt: row.terms_accepted_at || null,
  };
}

// Valideurs de champs de profil
const fieldValidators = {
  pseudonym: (v) => {
    const s = String(v).trim();
    if (s.length < 2 || s.length > 40) throw new HttpError(400, 'Le pseudonyme doit faire entre 2 et 40 caractères.');
    return s;
  },
  birth_date: (v) => {
    const s = String(v).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, 'Format de date de naissance invalide (AAAA-MM-JJ).');
    const age = calculateAge(s);
    if (age === null || age > 110) throw new HttpError(400, 'Date de naissance invalide.');
    if (age < 18) throw new HttpError(400, 'Vous devez avoir au moins 18 ans pour rejoindre Cercle Élite.');
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
    if (raw === undefined || raw === null || raw === '') {
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
// À incrémenter à chaque modification du schéma ci-dessous (nouvelle table, colonne, index, migration) :
// tant que la base porte déjà ce numéro, le démarrage ne rejoue pas la trentaine de requêtes.
const SCHEMA_VERSION = '1';

function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      try {
        const current = await pool.query(`SELECT value FROM app_meta WHERE key = 'schema_version'`);
        if (current.rows[0] && current.rows[0].value === SCHEMA_VERSION) return;
      } catch {
        // table app_meta absente : premier démarrage avec cette version, on déroule le schéma complet
      }
      await pool.query(`
        CREATE TABLE IF NOT EXISTS members (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email         TEXT,
          password_hash TEXT,
          pseudonym     TEXT,
          name          TEXT,
          age           INTEGER,
          birth_date    DATE,
          gender        TEXT,
          sought        TEXT,
          city          TEXT,
          bio           TEXT,
          photo         TEXT,
          tier          TEXT NOT NULL DEFAULT 'standard',
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      for (const col of ['email', 'password_hash', 'pseudonym', 'name', 'gender', 'sought', 'city', 'bio', 'photo']) {
        await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS ${col} TEXT`);
        try {
          await pool.query(`ALTER TABLE members ALTER COLUMN ${col} TYPE TEXT`);
        } catch (e) { /* ignoré si déjà TEXT */ }
      }
      await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS age INTEGER`);
      await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS birth_date DATE`);
      await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ`);
      await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS tier_expires_at TIMESTAMPTZ`);
      await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS is_exempt BOOLEAN NOT NULL DEFAULT FALSE`);
      await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE`);
      await pool.query(`UPDATE members SET tier_expires_at = NOW() + make_interval(days => ${SUBSCRIPTION_DAYS})
                        WHERE tier <> 'standard' AND tier_expires_at IS NULL AND is_exempt IS NOT TRUE`);
      await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'standard'`);
      try {
        await pool.query(`ALTER TABLE members ALTER COLUMN tier TYPE TEXT`);
      } catch (e) { /* ignoré */ }
      await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
      try { await pool.query(`ALTER TABLE members ALTER COLUMN name DROP NOT NULL`); } catch (e) { /* ignoré */ }
      await pool.query(`UPDATE members SET pseudonym = name WHERE pseudonym IS NULL AND name IS NOT NULL`);
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
      await pool.query(`
        CREATE TABLE IF NOT EXISTS encounter_requests (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          requester_id  TEXT NOT NULL,
          recipient_id  TEXT NOT NULL,
          status        TEXT NOT NULL DEFAULT 'pending',
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          responded_at  TIMESTAMPTZ,
          UNIQUE (requester_id, recipient_id)
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS encounter_req_pair_idx ON encounter_requests (requester_id, recipient_id)`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          sender_id    TEXT NOT NULL,
          recipient_id TEXT NOT NULL,
          kind         TEXT NOT NULL,
          body         TEXT,
          media        TEXT,
          duration_ms  INTEGER,
          reply_to     UUID,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS messages_created_idx ON messages (created_at)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS messages_pair_idx ON messages (sender_id, recipient_id, created_at)`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_quota (
          member_id     TEXT PRIMARY KEY,
          sent          INTEGER NOT NULL DEFAULT 0,
          blocked_until TIMESTAMPTZ
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tier_pricing (
          tier        TEXT PRIMARY KEY,
          price_fcfa  INTEGER NOT NULL,
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await pool.query(`
        INSERT INTO tier_pricing (tier, price_fcfa) VALUES ('confirme', 7000), ('vip', 15000), ('elite', 25000)
        ON CONFLICT (tier) DO NOTHING`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS upgrade_requests (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          member_id       TEXT NOT NULL,
          member_email    TEXT NOT NULL,
          pseudonym       TEXT NOT NULL,
          requested_tier  TEXT NOT NULL,
          amount_fcfa     INTEGER NOT NULL,
          payment_method  TEXT NOT NULL,
          whatsapp_phone  TEXT,
          note            TEXT,
          status          TEXT NOT NULL DEFAULT 'pending',
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          processed_at    TIMESTAMPTZ
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS upgrade_requests_status_idx ON upgrade_requests (status, created_at DESC)`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          endpoint    TEXT PRIMARY KEY,
          member_id   TEXT NOT NULL,
          p256dh      TEXT NOT NULL,
          auth        TEXT NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS push_subscriptions_member_idx ON push_subscriptions (member_id)`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
          endpoint    TEXT PRIMARY KEY,
          p256dh      TEXT NOT NULL,
          auth        TEXT NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      await pool.query(
        `INSERT INTO app_meta (key, value) VALUES ('schema_version', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [SCHEMA_VERSION]
      );
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

let lastSweep = 0;
async function expireSubscriptions(force = false) {
  if (!force && Date.now() - lastSweep < 10 * 1000) return;
  lastSweep = Date.now();
  await pool.query(
    `UPDATE members SET tier = 'standard', tier_expires_at = NULL
     WHERE tier <> 'standard' AND is_exempt IS NOT TRUE AND tier_expires_at IS NOT NULL AND tier_expires_at <= NOW()`
  );
}

const route = (handler) => async (req, res, next) => {
  try {
    await ensureSchema();
    await expireSubscriptions();
    await handler(req, res, next);
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ success: false, error: err.message, code: err.code, ...err.extra });
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
     VALUES ($1::text, $2::text, $3::text, 0, NOW() + make_interval(mins => $4::int), NOW())
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
  await pool.query('DELETE FROM otp_codes WHERE email = $1 AND purpose = $2', [email, purpose]);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

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

app.get('/api/members', route(async (req, res) => {
  const result = await pool.query(
    `SELECT id, COALESCE(pseudonym, name) AS name,
            COALESCE(EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date))::int, age, 30) AS age,
            gender, sought, city, bio,
            CASE WHEN substr(photo, 1, 5) = 'data:' THEN '/api/members/' || id::text || '/photo' ELSE photo END AS photo,
            tier, created_at
     FROM members WHERE is_suspended IS NOT TRUE ORDER BY created_at DESC`
  );
  // Liste publique : servie par le cache Vercel 15 s, puis rafraîchie en arrière-plan
  res.set('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=120');
  res.json({ success: true, count: result.rows.length, members: result.rows });
}));

// Photo d'un membre servie à part (image mise en cache par le navigateur) : la liste reste légère
app.get('/api/members/:id/photo', async (req, res) => {
  try {
    // Identifiant libre (UUID ou numérique selon l'ancienne table `members`), comme les autres routes /api/members/:id
    const notFound = () => res.set('Cache-Control', 'no-store').status(404).end();
    if (!/^[0-9a-zA-Z_-]{1,64}$/.test(req.params.id)) return notFound();
    await ensureSchema();
    const result = await pool.query('SELECT photo FROM members WHERE id::text = $1 AND is_suspended IS NOT TRUE', [req.params.id]);
    const photo = result.rows[0] && result.rows[0].photo;
    if (!photo) return notFound();
    const comma = photo.indexOf(',');
    const header = comma > 0 ? photo.slice(0, comma) : '';
    const type = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64$/i.exec(header);
    if (!type) {
      if (/^https:\/\//.test(photo)) return res.redirect(302, photo);
      return notFound();
    }
    res.set({
      'Content-Type': type[1].toLowerCase(),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600',
    });
    res.send(Buffer.from(photo.slice(comma + 1), 'base64'));
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

app.post('/api/auth/request-otp', route(async (req, res) => {
  const email = validateEmail(req.body.email);
  const exists = await pool.query('SELECT 1 FROM members WHERE LOWER(email) = $1', [email]);
  if (exists.rows.length) {
    throw new HttpError(409, 'Cet e-mail est déjà inscrit. Connectez-vous.', 'EMAIL_EXISTS');
  }
  await issueOtp(email, 'register');
  res.json({ success: true });
}));

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

  if (body.ageConfirmed !== true || body.acceptedTerms !== true) {
    throw new HttpError(400, 'Vous devez certifier avoir 18 ans révolus et accepter les CGU et la Politique de confidentialité.', 'TERMS_REQUIRED');
  }
  const password = validatePassword(body.password);
  const f = readProfileFields(body, ['pseudonym', 'birth_date', 'gender', 'sought', 'city', 'photo', 'tier']);
  const computedAge = calculateAge(f.birth_date);

  const exists = await pool.query('SELECT 1 FROM members WHERE LOWER(email) = $1', [email]);
  if (exists.rows.length) throw new HttpError(409, 'Cet e-mail est déjà inscrit.', 'EMAIL_EXISTS');

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    `INSERT INTO members (email, password_hash, pseudonym, name, age, birth_date, gender, sought, city, bio, photo, tier, tier_expires_at, terms_accepted_at)
     VALUES ($1::text, $2::text, $3::text, $3::text, $4::int, $5::date, $6::text, $7::text, $8::text, $9::text, $10::text, $11::text,
             CASE WHEN $11::text = 'standard' THEN NULL ELSE NOW() + make_interval(days => ${SUBSCRIPTION_DAYS}) END, NOW())
     RETURNING ${MEMBER_COLUMNS}`,
    [email, passwordHash, f.pseudonym, computedAge, f.birth_date, f.gender, f.sought, f.city, f.bio ?? '', f.photo, 'standard']
  );
  const row = result.rows[0];
  res.status(201).json({ success: true, token: signSession(row), member: toMember(row) });
}));

app.post('/api/auth/login', route(async (req, res) => {
  const email = validateEmail(req.body.email);
  const password = String(req.body.password ?? '');
  const result = await pool.query('SELECT id, password_hash, is_suspended FROM members WHERE LOWER(email) = $1', [email]);
  const row = result.rows[0];
  if (!row) throw new HttpError(404, 'Aucun compte ne correspond à cet e-mail.', 'NO_ACCOUNT');
  if (!row.password_hash) {
    throw new HttpError(401, 'Ce compte n’a pas de mot de passe. Créez votre profil à nouveau.', 'NO_PASSWORD');
  }
  if (!password || !(await bcrypt.compare(password, row.password_hash))) {
    throw new HttpError(401, 'E-mail ou mot de passe incorrect.', 'INVALID_CREDENTIALS');
  }
  if (row.is_suspended) throw new HttpError(403, 'Ce compte est suspendu. Contactez le support.', 'ACCOUNT_SUSPENDED');
  await issueOtp(email, 'login');
  res.json({ success: true, otpRequired: true });
}));

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
    await expireSubscriptions(true);
    const result = await pool.query(`SELECT ${MEMBER_COLUMNS} FROM members WHERE LOWER(email) = $1`, [email]);
    const row = result.rows[0];
    if (!row) throw new HttpError(404, 'Aucun compte ne correspond à cet e-mail.', 'NO_ACCOUNT');
    if (row.is_suspended) throw new HttpError(403, 'Ce compte est suspendu. Contactez le support.', 'ACCOUNT_SUSPENDED');
    return res.json({ success: true, token: signSession(row), member: toMember(row) });
  }
  if (purpose === 'reset-password') {
    await checkOtp(email, 'reset-password', code);
    const exists = await pool.query('SELECT 1 FROM members WHERE LOWER(email) = $1', [email]);
    if (!exists.rows.length) throw new HttpError(404, 'Aucun compte ne correspond à cet e-mail.', 'NO_ACCOUNT');
    const resetToken = jwt.sign({ email, purpose: 'reset-password' }, getSecret(), { expiresIn: '20m' });
    return res.json({ success: true, resetToken });
  }
  throw new HttpError(400, 'Type de vérification invalide.');
}));

// MOT DE PASSE OUBLIÉ — étape 1 : envoi du code OTP à l'e-mail du compte existant
app.post('/api/auth/forgot-password', route(async (req, res) => {
  const email = validateEmail(req.body.email);
  const exists = await pool.query('SELECT 1 FROM members WHERE LOWER(email) = $1', [email]);
  if (!exists.rows.length) {
    throw new HttpError(404, 'Aucun compte ne correspond à cet e-mail.', 'NO_ACCOUNT');
  }
  await issueOtp(email, 'reset-password');
  res.json({ success: true });
}));

// MOT DE PASSE OUBLIÉ — étape 3 : enregistrement du nouveau mot de passe après validation OTP
app.post('/api/auth/reset-password', route(async (req, res) => {
  const body = req.body || {};
  let email;
  try {
    const payload = jwt.verify(String(body.resetToken || ''), getSecret());
    if (payload.purpose !== 'reset-password' || !payload.email) throw new Error('mauvais jeton');
    email = payload.email;
  } catch {
    throw new HttpError(401, 'Vérification expirée. Recommencez la procédure de mot de passe oublié.', 'RESET_EXPIRED');
  }

  const newPassword = validatePassword(body.newPassword ?? body.password);
  const passwordHash = await bcrypt.hash(newPassword, 10);

  await expireSubscriptions(true);
  const updated = await pool.query(
    `UPDATE members SET password_hash = $1::text
     WHERE LOWER(email) = $2::text
     RETURNING ${MEMBER_COLUMNS}`,
    [passwordHash, email]
  );
  if (!updated.rows[0]) {
    throw new HttpError(404, 'Aucun compte ne correspond à cet e-mail.', 'NO_ACCOUNT');
  }

  const row = updated.rows[0];
  res.json({ success: true, token: signSession(row), member: toMember(row) });
}));

app.get('/api/auth/me', authRequired, route(async (req, res) => {
  await expireSubscriptions(true);
  const result = await pool.query(`SELECT ${MEMBER_COLUMNS} FROM members WHERE id::text = $1`, [req.auth.sub]);
  if (!result.rows[0] || result.rows[0].is_suspended) throw new HttpError(401, 'Compte introuvable.', 'SESSION_EXPIRED');
  res.json({ success: true, member: toMember(result.rows[0]) });
}));

app.put('/api/members/:id', authRequired, route(async (req, res) => {
  if (String(req.auth.sub) !== String(req.params.id)) {
    throw new HttpError(403, 'Vous ne pouvez modifier que votre propre profil.', 'FORBIDDEN');
  }
  await expireSubscriptions(true);
  const f = readProfileFields(req.body || {}, []);
  const computedAge = f.birth_date ? calculateAge(f.birth_date) : null;
  // Un niveau payant ne s'obtient que par validation d'une demande dans /admin :
  // on refuse toute élévation, et un « même niveau » ne prolonge jamais l'abonnement.
  if (f.tier && f.tier !== 'standard') {
    const current = await pool.query('SELECT tier FROM members WHERE id::text = $1', [req.params.id]);
    if (!current.rows[0]) throw new HttpError(404, 'Membre introuvable.');
    if (current.rows[0].tier !== f.tier) {
      throw new HttpError(403, 'Un niveau payant doit être activé après validation de votre demande par la Conciergerie.', 'PAYMENT_REQUIRED');
    }
    f.tier = null;
  }
  const result = await pool.query(
    `UPDATE members SET
       pseudonym  = COALESCE($1::text, pseudonym),
       name       = COALESCE($1::text, name),
       birth_date = COALESCE($2::date, birth_date),
       age        = COALESCE($3::int, age),
       gender     = COALESCE($4::text, gender),
       sought     = COALESCE($5::text, sought),
       city       = COALESCE($6::text, city),
       bio        = COALESCE($7::text, bio),
       photo      = COALESCE($8::text, photo),
       tier       = COALESCE($9::text, tier),
       tier_expires_at = CASE
         WHEN is_exempt IS TRUE THEN NULL
         WHEN $9::text IS NULL THEN tier_expires_at
         WHEN $9::text = 'standard' THEN NULL
         ELSE NOW() + make_interval(days => ${SUBSCRIPTION_DAYS})
       END
     WHERE id::text = $10::text
     RETURNING ${MEMBER_COLUMNS}`,
    [f.pseudonym, f.birth_date, computedAge, f.gender, f.sought, f.city, f.bio, f.photo, f.tier, req.params.id]
  );
  if (!result.rows[0]) throw new HttpError(404, 'Membre introuvable.');
  res.json({ success: true, member: toMember(result.rows[0]) });
}));

// Suppression définitive du compte et de toutes ses données associées
app.delete('/api/members/:id', authRequired, route(async (req, res) => {
  const memberId = String(req.params.id ?? '').trim();
  if (String(req.auth.sub) !== memberId) {
    throw new HttpError(403, 'Vous ne pouvez supprimer que votre propre compte.', 'FORBIDDEN');
  }

  const client = await pool.connect();
  let deletedRow;
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT id, email FROM members WHERE id::text = $1 FOR UPDATE',
      [memberId]
    );
    if (!existing.rows[0]) {
      throw new HttpError(404, 'Membre introuvable.');
    }

    const memberEmail = existing.rows[0].email;

    await client.query(
      'DELETE FROM messages WHERE sender_id = $1 OR recipient_id = $1',
      [memberId]
    );
    await client.query(
      'DELETE FROM encounter_requests WHERE requester_id = $1 OR recipient_id = $1',
      [memberId]
    );
    await client.query(
      'DELETE FROM chat_quota WHERE member_id = $1',
      [memberId]
    );
    await client.query(
      'DELETE FROM push_subscriptions WHERE member_id = $1',
      [memberId]
    );
    if (memberEmail) {
      await client.query(
        'DELETE FROM otp_codes WHERE LOWER(email) = LOWER($1)',
        [memberEmail]
      );
    }

    const deleted = await client.query(
      'DELETE FROM members WHERE id::text = $1 RETURNING id',
      [memberId]
    );
    deletedRow = deleted.rows[0];

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (!deletedRow) {
    throw new HttpError(404, 'Membre introuvable.');
  }
  res.json({ success: true, deletedId: String(deletedRow.id) });
}));

// ---------------------------------------------------------------------------
// Demandes de rencontre & règle d'accès à la messagerie (1 seul message avant acceptation)
// ---------------------------------------------------------------------------
async function getEncounterState(db, me, peer) {
  const reqRes = await db.query(
    `SELECT id, requester_id, recipient_id, status, created_at, responded_at
     FROM encounter_requests
     WHERE (requester_id = $1 AND recipient_id = $2) OR (requester_id = $2 AND recipient_id = $1)
     ORDER BY CASE WHEN status = 'accepted' THEN 0 ELSE 1 END, created_at ASC`,
    [me, peer]
  );
  const msgCountRes = await db.query(
    `SELECT COUNT(*)::int AS cnt FROM messages WHERE sender_id = $1 AND recipient_id = $2`,
    [me, peer]
  );
  const mySentMessages = msgCountRes.rows[0]?.cnt ?? 0;

  if (!reqRes.rows.length) {
    return { status: 'none', direction: null, requestId: null, mySentMessages, canSendMessage: false };
  }

  const accepted = reqRes.rows.find((r) => r.status === 'accepted');
  if (accepted) {
    return {
      status: 'accepted',
      direction: accepted.requester_id === me ? 'outgoing' : 'incoming',
      requestId: String(accepted.id),
      mySentMessages,
      canSendMessage: true,
    };
  }

  const incoming = reqRes.rows.find((r) => r.recipient_id === me && r.status === 'pending');
  if (incoming) {
    return {
      status: 'pending',
      direction: 'incoming',
      requestId: String(incoming.id),
      mySentMessages,
      canSendMessage: true,
    };
  }

  const outgoing = reqRes.rows[0];
  return {
    status: outgoing.status,
    direction: 'outgoing',
    requestId: String(outgoing.id),
    mySentMessages,
    canSendMessage: outgoing.status === 'pending' ? mySentMessages < 1 : false,
  };
}

app.get('/api/encounters', authRequired, route(async (req, res) => {
  const me = String(req.auth.sub);
  const result = await pool.query(
    `SELECT er.id, er.requester_id, er.recipient_id, er.status, er.created_at, er.responded_at,
            (SELECT COUNT(*)::int FROM messages m WHERE m.sender_id = $1 AND m.recipient_id = CASE WHEN er.requester_id = $1 THEN er.recipient_id ELSE er.requester_id END) AS my_sent_messages
     FROM encounter_requests er
     WHERE er.requester_id = $1 OR er.recipient_id = $1
     ORDER BY er.created_at DESC`,
    [me]
  );
  res.json({
    success: true,
    encounters: result.rows.map((r) => ({
      id: String(r.id),
      requesterId: r.requester_id,
      recipientId: r.recipient_id,
      peerId: r.requester_id === me ? r.recipient_id : r.requester_id,
      direction: r.requester_id === me ? 'outgoing' : 'incoming',
      status: r.status,
      mySentMessages: r.my_sent_messages ?? 0,
      createdAt: r.created_at,
      respondedAt: r.responded_at,
    })),
  });
}));

app.post('/api/encounters', authRequired, route(async (req, res) => {
  const me = String(req.auth.sub);
  const recipientId = String((req.body || {}).recipientId ?? '').trim().slice(0, 64);
  if (!recipientId || recipientId === me) throw new HttpError(400, 'Destinataire invalide.');

  const peerExists = await pool.query('SELECT 1 FROM members WHERE id::text = $1', [recipientId]);
  if (!peerExists.rows.length) throw new HttpError(404, 'Ce membre est introuvable.');

  const reverse = await pool.query(
    `SELECT id, status FROM encounter_requests WHERE requester_id = $1 AND recipient_id = $2`,
    [recipientId, me]
  );
  if (reverse.rows[0]) {
    if (reverse.rows[0].status === 'pending') {
      const accepted = await pool.query(
        `UPDATE encounter_requests SET status = 'accepted', responded_at = NOW() WHERE id = $1 RETURNING *`,
        [reverse.rows[0].id]
      );
      return res.status(200).json({ success: true, encounter: accepted.rows[0], autoAccepted: true });
    }
    if (reverse.rows[0].status === 'accepted') {
      return res.status(200).json({ success: true, encounter: reverse.rows[0], autoAccepted: true });
    }
  }

  const inserted = await pool.query(
    `INSERT INTO encounter_requests (requester_id, recipient_id, status)
     VALUES ($1, $2, 'pending')
     ON CONFLICT (requester_id, recipient_id) DO UPDATE SET requester_id = EXCLUDED.requester_id
     RETURNING *`,
    [me, recipientId]
  );
  res.status(201).json({ success: true, encounter: inserted.rows[0] });
}));

app.post('/api/encounters/:id/accept', authRequired, route(async (req, res) => {
  const me = String(req.auth.sub);
  const reqId = String(req.params.id ?? '').trim();
  if (!UUID_RE.test(reqId)) throw new HttpError(400, 'Demande invalide.');

  const updated = await pool.query(
    `UPDATE encounter_requests
     SET status = 'accepted', responded_at = NOW()
     WHERE id = $1 AND recipient_id = $2
     RETURNING *`,
    [reqId, me]
  );
  if (!updated.rows[0]) throw new HttpError(404, 'Demande introuvable ou non autorisée.');
  res.json({ success: true, encounter: updated.rows[0] });
}));

// ---------------------------------------------------------------------------
// Messagerie privée (texte, photos, audio 15 s, vidéo 5 s)
// ---------------------------------------------------------------------------
const MSG_TTL_HOURS = 72;
const STANDARD_MSG_LIMIT = 5;
const STANDARD_BLOCK_HOURS = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64_TAIL = /^[A-Za-z0-9+/]+={0,2}$/;
const MEDIA_RULES = {
  photo: { prefix: /^data:image\/(png|jpe?g|webp|gif);base64,/, maxChars: 3000000 },
  audio: { prefix: /^data:audio\/[a-z0-9.+-]+;base64,/i, maxChars: 1000000, maxMs: 15000 },
  video: { prefix: /^data:video\/[a-z0-9.+-]+;base64,/i, maxChars: 3200000, maxMs: 5000 },
};

let lastPurge = 0;
async function purgeExpired(force = false) {
  if (!force && Date.now() - lastPurge < 60 * 1000) return 0;
  lastPurge = Date.now();
  const result = await pool.query(
    'DELETE FROM messages WHERE created_at < NOW() - make_interval(hours => $1::int)',
    [MSG_TTL_HOURS]
  );
  await pool.query('DELETE FROM otp_codes WHERE expires_at < NOW()');
  return result.rowCount;
}
const safePurge = () => purgeExpired().catch((e) => console.error('Purge des messages :', e.message));

async function readQuota(memberId, tier) {
  if (tier !== 'standard') return { limited: false, limit: null, remaining: null, blockedUntil: null };
  const result = await pool.query('SELECT sent, blocked_until FROM chat_quota WHERE member_id = $1', [memberId]);
  const row = result.rows[0];
  const until = row && row.blocked_until ? new Date(row.blocked_until) : null;
  const blocked = until && until > new Date() ? until : null;
  const sent = row && !(until && !blocked) ? row.sent : 0;
  return {
    limited: true,
    limit: STANDARD_MSG_LIMIT,
    remaining: blocked ? 0 : Math.max(0, STANDARD_MSG_LIMIT - sent),
    blockedUntil: blocked ? blocked.toISOString() : null,
  };
}

async function getMemberTier(memberId) {
  const result = await pool.query('SELECT tier, is_exempt FROM members WHERE id::text = $1', [memberId]);
  const row = result.rows[0];
  if (!row) return null;
  return row.is_exempt ? 'elite' : row.tier; // exempté = accès complet, sans quota Standard
}

const MESSAGE_SELECT = `
  SELECT m.id, m.sender_id, m.kind, m.body, m.media, m.duration_ms, m.reply_to, m.created_at,
         r.kind AS reply_kind, LEFT(r.body, 140) AS reply_body, r.sender_id AS reply_sender
  FROM messages m LEFT JOIN messages r ON r.id = m.reply_to`;

function toMessage(row, me) {
  let reply = null;
  if (row.reply_to) {
    reply = row.reply_kind
      ? { id: String(row.reply_to), kind: row.reply_kind, body: row.reply_body || '', fromMe: row.reply_sender === me }
      : { id: String(row.reply_to), kind: 'text', body: 'Message supprimé', fromMe: false, deleted: true };
  }
  return {
    id: String(row.id),
    fromMe: row.sender_id === me,
    kind: row.kind,
    body: row.body || '',
    media: row.media || null,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    reply,
  };
}

function validateMessage(body) {
  const kind = String(body.kind || 'text');
  if (!['text', 'photo', 'audio', 'video'].includes(kind)) throw new HttpError(400, 'Type de message invalide.');
  const text = String(body.body ?? '').trim();
  let media = null;
  let durationMs = null;

  if (kind === 'text') {
    if (!text) throw new HttpError(400, 'Le message est vide.');
    if (text.length > 1000) throw new HttpError(400, 'Message trop long (1000 caractères maximum).');
  } else {
    const rule = MEDIA_RULES[kind];
    media = String(body.media ?? '');
    const comma = media.indexOf(',');
    if (!rule.prefix.test(media) || media.length > rule.maxChars || !BASE64_TAIL.test(media.slice(comma + 1))) {
      throw new HttpError(400, kind === 'photo' ? 'Photo invalide ou trop volumineuse.' : 'Fichier multimédia invalide ou trop volumineux.');
    }
    if (kind !== 'photo') {
      durationMs = Math.round(Number(body.durationMs));
      if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > rule.maxMs + 1000) {
        throw new HttpError(400, kind === 'audio' ? 'L’audio ne doit pas dépasser 15 secondes.' : 'La vidéo ne doit pas dépasser 5 secondes.');
      }
    }
    if (text.length > 500) throw new HttpError(400, 'Légende trop longue (500 caractères maximum).');
  }
  return { kind, text, media, durationMs };
}

app.get('/api/chat/quota', authRequired, route(async (req, res) => {
  const tier = await getMemberTier(req.auth.sub);
  if (!tier) throw new HttpError(401, 'Compte introuvable.', 'SESSION_EXPIRED');
  res.json({ success: true, quota: await readQuota(req.auth.sub, tier) });
}));

app.get('/api/messages', authRequired, route(async (req, res) => {
  await safePurge();
  const me = String(req.auth.sub);
  const result = await pool.query(
    `SELECT DISTINCT ON (peer) peer, kind, body, from_me, created_at FROM (
       SELECT CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS peer,
              kind, LEFT(body, 140) AS body, (sender_id = $1) AS from_me, created_at
       FROM messages
       WHERE (sender_id = $1 OR recipient_id = $1)
         AND created_at > NOW() - make_interval(hours => $2::int)
     ) t ORDER BY peer, created_at DESC`,
    [me, MSG_TTL_HOURS]
  );
  const conversations = result.rows
    .map((r) => ({ peerId: r.peer, kind: r.kind, body: r.body || '', fromMe: r.from_me, createdAt: r.created_at }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const tier = await getMemberTier(me);
  res.json({ success: true, conversations, quota: await readQuota(me, tier) });
}));

app.get('/api/messages/:peerId', authRequired, route(async (req, res) => {
  await safePurge();
  const me = String(req.auth.sub);
  const peer = String(req.params.peerId).slice(0, 64);
  let since = null;
  if (req.query.since) {
    since = new Date(String(req.query.since));
    if (Number.isNaN(since.getTime())) throw new HttpError(400, 'Paramètre since invalide.');
  }
  const result = await pool.query(
    `${MESSAGE_SELECT}
     WHERE ((m.sender_id = $1 AND m.recipient_id = $2) OR (m.sender_id = $2 AND m.recipient_id = $1))
       AND m.created_at > NOW() - make_interval(hours => $3::int)
       AND ($4::timestamptz IS NULL OR m.created_at > $4::timestamptz)
     ORDER BY m.created_at DESC LIMIT 100`,
    [me, peer, MSG_TTL_HOURS, since]
  );
  const tier = await getMemberTier(me);
  const encounter = await getEncounterState(pool, me, peer);
  res.json({
    success: true,
    messages: result.rows.reverse().map((row) => toMessage(row, me)),
    quota: await readQuota(me, tier),
    encounter,
  });
}));

app.post('/api/messages', authRequired, route(async (req, res) => {
  await expireSubscriptions(true);
  await safePurge();
  const me = String(req.auth.sub);
  const body = req.body || {};
  const to = String(body.to ?? '').slice(0, 64);
  if (!to || to === me) throw new HttpError(400, 'Destinataire invalide.');
  const { kind, text, media, durationMs } = validateMessage(body);

  const peerExists = await pool.query('SELECT 1 FROM members WHERE id::text = $1', [to]);
  if (!peerExists.rows.length) throw new HttpError(404, 'Ce membre est introuvable.');

  let replyTo = null;
  if (body.replyTo) {
    replyTo = String(body.replyTo);
    if (!UUID_RE.test(replyTo)) throw new HttpError(400, 'Message cité invalide.');
    const target = await pool.query(
      `SELECT 1 FROM messages WHERE id = $1
         AND ((sender_id = $2 AND recipient_id = $3) OR (sender_id = $3 AND recipient_id = $2))`,
      [replyTo, me, to]
    );
    if (!target.rows.length) throw new HttpError(400, 'Le message cité n’existe plus.');
  }

  const tier = await getMemberTier(me);
  if (!tier) throw new HttpError(401, 'Compte introuvable.', 'SESSION_EXPIRED');

  const client = await pool.connect();
  let messageId;
  try {
    await client.query('BEGIN');

    const encounter = await getEncounterState(client, me, to);
    if (encounter.status === 'none') {
      throw new HttpError(
        403,
        'Envoyez d’abord une demande de rencontre avant de démarrer une discussion.',
        'REQUEST_REQUIRED'
      );
    }
    if (encounter.status === 'pending' && encounter.direction === 'outgoing' && encounter.mySentMessages >= 1) {
      throw new HttpError(
        403,
        'Votre premier message a déjà été envoyé. Attendez que ce membre accepte votre demande pour poursuivre la discussion.',
        'SINGLE_MESSAGE_LIMIT'
      );
    }
    if (encounter.status === 'declined') {
      throw new HttpError(403, 'Cette demande de rencontre a été déclinée.', 'REQUEST_DECLINED');
    }

    if (tier === 'standard') {
      await client.query('INSERT INTO chat_quota (member_id) VALUES ($1) ON CONFLICT DO NOTHING', [me]);
      const q = (await client.query('SELECT sent, blocked_until FROM chat_quota WHERE member_id = $1 FOR UPDATE', [me])).rows[0];
      let sent = q.sent;
      let blockedUntil = q.blocked_until ? new Date(q.blocked_until) : null;
      if (blockedUntil && blockedUntil <= new Date()) { sent = 0; blockedUntil = null; }
      if (blockedUntil) {
        throw new HttpError(
          429,
          `Vous avez atteint la limite de ${STANDARD_MSG_LIMIT} messages du niveau Standard.`,
          'QUOTA_REACHED',
          { blockedUntil: blockedUntil.toISOString() }
        );
      }
      sent += 1;
      if (sent >= STANDARD_MSG_LIMIT) blockedUntil = new Date(Date.now() + STANDARD_BLOCK_HOURS * 3600 * 1000);
      await client.query('UPDATE chat_quota SET sent = $2, blocked_until = $3 WHERE member_id = $1', [me, sent, blockedUntil]);
    }
    const inserted = await client.query(
      `INSERT INTO messages (sender_id, recipient_id, kind, body, media, duration_ms, reply_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [me, to, kind, text || null, media, durationMs, replyTo]
    );
    messageId = inserted.rows[0].id;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const saved = await pool.query(`${MESSAGE_SELECT} WHERE m.id = $1`, [messageId]);
  const updatedEncounter = await getEncounterState(pool, me, to);
  await Promise.race([notifyNewMessage(me, to), new Promise((resolve) => setTimeout(resolve, 2500))]);
  res.status(201).json({
    success: true,
    message: toMessage(saved.rows[0], me),
    quota: await readQuota(me, tier),
    encounter: updatedEncounter,
  });
}));

// ---------------------------------------------------------------------------
// Tarifs des niveaux payants (modifiables depuis /admin)
// ---------------------------------------------------------------------------
const PAID_TIERS = ['confirme', 'vip', 'elite'];
const DEFAULT_PRICING = { confirme: 7000, vip: 15000, elite: 25000 };
const PAYMENT_METHODS = ['T-Money', 'Flooz', 'Virement / Carte (Europe & International)', 'Autre'];

async function readPricing(db = pool) {
  const result = await db.query('SELECT tier, price_fcfa FROM tier_pricing');
  const pricing = { ...DEFAULT_PRICING };
  for (const row of result.rows) {
    if (PAID_TIERS.includes(row.tier)) pricing[row.tier] = row.price_fcfa;
  }
  return pricing;
}

app.get('/api/pricing', route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, pricing: await readPricing() });
}));

// ---------------------------------------------------------------------------
// Demandes d'abonnement (activation assistée via WhatsApp + validation admin)
// ---------------------------------------------------------------------------
function toUpgradeRequest(row) {
  return {
    id: String(row.id),
    memberId: row.member_id,
    memberEmail: row.member_email,
    pseudonym: row.pseudonym,
    requestedTier: row.requested_tier,
    amountFcfa: row.amount_fcfa,
    paymentMethod: row.payment_method,
    whatsappPhone: row.whatsapp_phone || null,
    note: row.note || null,
    status: row.status,
    createdAt: row.created_at,
    processedAt: row.processed_at || null,
  };
}

app.post('/api/upgrade-requests', authRequired, route(async (req, res) => {
  const body = req.body || {};
  const tier = String(body.tier ?? '');
  if (!PAID_TIERS.includes(tier)) throw new HttpError(400, 'Niveau invalide.', 'INVALID_TIER');
  const paymentMethod = String(body.paymentMethod ?? '');
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    throw new HttpError(400, 'Choisissez un moyen de paiement.', 'INVALID_PAYMENT_METHOD');
  }
  let whatsappPhone = null;
  if (body.whatsappPhone !== undefined && body.whatsappPhone !== null && String(body.whatsappPhone).trim() !== '') {
    whatsappPhone = String(body.whatsappPhone).trim();
    if (!/^[+0-9()\s.-]{6,24}$/.test(whatsappPhone)) throw new HttpError(400, 'Numéro WhatsApp invalide.', 'INVALID_PHONE');
  }
  const note = body.note ? String(body.note).trim().slice(0, 500) || null : null;

  const me = String(req.auth.sub);
  const memberResult = await pool.query(
    `SELECT email, COALESCE(pseudonym, name, 'Membre') AS pseudonym, is_exempt FROM members WHERE id::text = $1`,
    [me]
  );
  const member = memberResult.rows[0];
  if (!member) throw new HttpError(401, 'Compte introuvable.', 'SESSION_EXPIRED');
  if (member.is_exempt) {
    throw new HttpError(400, 'Votre compte est exempté : tous les niveaux sont déjà débloqués.', 'ALREADY_EXEMPT');
  }

  // Le montant vient toujours de la table des tarifs, jamais du corps de la requête
  const amount = (await readPricing())[tier];

  // Une seule demande en attente par niveau : on met à jour la précédente au lieu d'en empiler
  const existing = await pool.query(
    `SELECT id FROM upgrade_requests WHERE member_id = $1 AND requested_tier = $2 AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
    [me, tier]
  );
  let saved;
  let isNewRequest = false;
  if (existing.rows[0]) {
    saved = await pool.query(
      `UPDATE upgrade_requests SET amount_fcfa = $2, payment_method = $3, whatsapp_phone = $4, note = $5,
              member_email = $6, pseudonym = $7
       WHERE id = $1 RETURNING *`,
      [existing.rows[0].id, amount, paymentMethod, whatsappPhone, note, member.email, member.pseudonym]
    );
  } else {
    isNewRequest = true;
    saved = await pool.query(
      `INSERT INTO upgrade_requests (member_id, member_email, pseudonym, requested_tier, amount_fcfa, payment_method, whatsapp_phone, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [me, member.email, member.pseudonym, tier, amount, paymentMethod, whatsappPhone, note]
    );
  }
  if (isNewRequest) {
    const tierNames = { confirme: 'Confirmé', vip: 'VIP', elite: 'Élite' };
    const amountText = String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    await Promise.race([
      notifyAdmins({
        title: 'Nouvelle demande d’abonnement',
        body: `${member.pseudonym} · ${tierNames[tier]} · ${amountText} FCFA`,
        url: '/admin',
        tag: 'admin-upgrade',
      }),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  }
  res.status(201).json({ success: true, request: toUpgradeRequest(saved.rows[0]) });
}));

// ---------------------------------------------------------------------------
// Notifications push (optionnelles : actives si `web-push` est installé et si
// VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY sont définies dans l'environnement)
// ---------------------------------------------------------------------------
let webpush = null;
try { webpush = require('web-push'); } catch { webpush = null; }
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const pushEnabled = Boolean(webpush && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushEnabled) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:contact@cercle-elite.site', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// Envoie une notification à une liste d'abonnements ; supprime ceux que le navigateur a résiliés.
// `table` ne reçoit jamais qu'une constante interne (push_subscriptions ou admin_push_subscriptions).
async function deliverPush(rows, payload, table) {
  if (!pushEnabled || !rows.length) return 0;
  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(rows.map(async (sub) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, { TTL: 3600, timeout: 4000 });
      return true;
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        await pool.query(`DELETE FROM ${table} WHERE endpoint = $1`, [sub.endpoint]);
      }
      return false;
    }
  }));
  return results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
}

async function notifyNewMessage(senderId, recipientId) {
  if (!pushEnabled) return;
  try {
    const subs = await pool.query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE member_id = $1', [recipientId]);
    if (!subs.rows.length) return;
    const sender = await pool.query(`SELECT COALESCE(pseudonym, name, 'Un membre') AS name FROM members WHERE id::text = $1`, [senderId]);
    await deliverPush(subs.rows, {
      title: 'Cercle Élite',
      body: `${sender.rows[0] ? sender.rows[0].name : 'Un membre'} vous a écrit un message.`,
      url: '/',
      tag: `msg-${senderId}`,
    }, 'push_subscriptions');
  } catch (err) {
    console.warn('Notification push ignorée :', err.message);
  }
}

// Notification envoyée aux appareils de l'administrateur (activés depuis /admin)
async function notifyAdmins(payload) {
  if (!pushEnabled) return 0;
  try {
    const subs = await pool.query('SELECT endpoint, p256dh, auth FROM admin_push_subscriptions');
    return await deliverPush(subs.rows, payload, 'admin_push_subscriptions');
  } catch (err) {
    console.warn('Notification admin ignorée :', err.message);
    return 0;
  }
}

app.get('/api/push/config', (req, res) => {
  res.json({ success: true, enabled: pushEnabled, publicKey: pushEnabled ? VAPID_PUBLIC_KEY : null });
});

app.post('/api/push/subscribe', authRequired, route(async (req, res) => {
  if (!pushEnabled) throw new HttpError(503, 'Les notifications push ne sont pas configurées.', 'PUSH_DISABLED');
  const sub = (req.body && req.body.subscription) || {};
  const endpoint = String(sub.endpoint || '');
  const p256dh = String((sub.keys && sub.keys.p256dh) || '');
  const authKey = String((sub.keys && sub.keys.auth) || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || p256dh.length > 200 || !authKey || authKey.length > 100) {
    throw new HttpError(400, 'Abonnement push invalide.', 'INVALID_SUBSCRIPTION');
  }
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, member_id, p256dh, auth) VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET member_id = EXCLUDED.member_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [endpoint, String(req.auth.sub), p256dh, authKey]
  );
  res.json({ success: true });
}));

app.post('/api/push/unsubscribe', authRequired, route(async (req, res) => {
  const endpoint = String((req.body && req.body.endpoint) || '');
  if (endpoint) await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND member_id = $2', [endpoint, String(req.auth.sub)]);
  res.json({ success: true });
}));

app.get('/api/cron/purge', route(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    throw new HttpError(401, 'Non autorisé.');
  }
  res.json({ success: true, deleted: await purgeExpired(true) });
}));

// Espace d'administration (/api/admin/*) — voir server/admin.js
require('./admin')(app, { pool, ensureSchema, route, HttpError, TIERS, UUID_RE, SUBSCRIPTION_DAYS, MEMBER_COLUMNS, toMember, readProfileFields, validateEmail, validatePassword, calculateAge, PAID_TIERS, readPricing, toUpgradeRequest, pushEnabled, VAPID_PUBLIC_KEY, notifyAdmins });

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Serveur back-end démarré sur le port ${PORT}`);
  });
}

module.exports = app;