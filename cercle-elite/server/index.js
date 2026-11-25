const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
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
// Photo de profil : photo réelle (data-URI), avatar de la galerie (/avatars/femme-N.png, homme-N.png…)
// ou avatar SVG de repli (data-URI). Ajouter un avatar = déposer le fichier dans public/avatars/, sans toucher ici.
const PHOTO_DATA_RE = /^data:image\/(png|jpe?g|webp|gif);base64,/;
const AVATAR_PATH_RE = /^\/avatars\/(femme|homme)-[1-9]\d*\.(png|jpe?g|webp)$/;
const AVATAR_SVG_RE = /^data:image\/svg\+xml/i;
const AVATAR_SVG_MAX_CHARS = 20000;

// Un SVG d'avatar doit rester un simple dessin : pas de script, d'événement, de lien ni d'élément externe.
function isSafeAvatarSvg(value) {
  if (!AVATAR_SVG_RE.test(value) || value.length > AVATAR_SVG_MAX_CHARS) return false;
  const comma = value.indexOf(',');
  if (comma < 0) return false;
  const header = value.slice(0, comma).toLowerCase();
  const payload = value.slice(comma + 1);
  let svg;
  try {
    svg = header.includes(';base64') ? Buffer.from(payload, 'base64').toString('utf8') : decodeURIComponent(payload);
  } catch {
    return false;
  }
  const lower = svg.toLowerCase();
  if (!lower.includes('<svg')) return false;
  return !/<script|<foreignobject|<iframe|<embed|<object|<image|<use[\s>/]|<a[\s>]|<!entity|<!doctype|javascript:|[\s"'/]on[a-z]+\s*=|href\s*=/.test(lower);
}

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
    if (AVATAR_PATH_RE.test(s)) return s;
    if (AVATAR_SVG_RE.test(s)) {
      if (!isSafeAvatarSvg(s)) throw new HttpError(400, 'Avatar invalide.');
      return s;
    }
    if (!PHOTO_DATA_RE.test(s) || s.length > 3000000) {
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
const SCHEMA_VERSION = '7';

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
      await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ`);
      await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ`);
      // Appui long : modification et suppression de messages
      await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ`);
      await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_for_everyone BOOLEAN NOT NULL DEFAULT false`);
      await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_for_sender BOOLEAN NOT NULL DEFAULT false`);
      await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_for_receiver BOOLEAN NOT NULL DEFAULT false`);
      await pool.query(`CREATE INDEX IF NOT EXISTS messages_undelivered_idx ON messages (recipient_id) WHERE delivered_at IS NULL`);
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
        CREATE TABLE IF NOT EXISTS member_blocks (
          blocker_id  TEXT NOT NULL,
          blocked_id  TEXT NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (blocker_id, blocked_id)
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS member_blocks_blocked_idx ON member_blocks (blocked_id)`);
      await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS tier_downgraded_at TIMESTAMPTZ`);
      await pool.query(`ALTER TABLE encounter_requests ADD COLUMN IF NOT EXISTS exchange_started_at TIMESTAMPTZ`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
          endpoint    TEXT PRIMARY KEY,
          p256dh      TEXT NOT NULL,
          auth        TEXT NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      // Nettoyage unique : plus aucune discussion ni demande de rencontre entre deux membres du même genre.
      // Les échanges entre une femme et un homme (ou avec un genre non renseigné) sont conservés.
      await pool.query(
        `DELETE FROM messages m USING members a, members b
         WHERE a.id::text = m.sender_id AND b.id::text = m.recipient_id
           AND a.gender IS NOT NULL AND a.gender = b.gender`
      );
      await pool.query(
        `DELETE FROM encounter_requests e USING members a, members b
         WHERE a.id::text = e.requester_id AND b.id::text = e.recipient_id
           AND a.gender IS NOT NULL AND a.gender = b.gender`
      );
      // Demandes : type (rencontre / invitation) + notifications en base
      await pool.query(`ALTER TABLE encounter_requests ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'meeting'`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          member_id   TEXT NOT NULL,
          kind        TEXT NOT NULL,
          actor_id    TEXT,
          request_id  UUID,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          read_at     TIMESTAMPTZ
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS notifications_member_idx ON notifications (member_id, created_at DESC)`);
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
    `UPDATE members SET tier = 'standard', tier_downgraded_at = tier_expires_at, tier_expires_at = NULL
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

// ---------------------------------------------------------------------------
// Adresses de photo signées : /api/members/<id>/photo?v=<version>&e=<expiration>&s=<signature>
// Seul le serveur les fabrique, et uniquement pour les profils qu'il renvoie à la session (liste filtrée).
// L'expiration est arrondie par tranches de 6 h : l'adresse reste identique pendant plusieurs heures,
// donc le navigateur met l'image en cache au lieu de la retélécharger à chaque rechargement.
// ---------------------------------------------------------------------------
const PHOTO_URL_WINDOW_MS = 6 * 60 * 60 * 1000;

function photoSignature(id, exp) {
  return crypto.createHmac('sha256', getSecret()).update(`photo:${id}:${exp}`).digest('base64url').slice(0, 32);
}

function signPhotoUrl(url) {
  const match = /^\/api\/members\/([0-9a-zA-Z_-]{1,64})\/photo(\?v=\d+)?$/.exec(url || '');
  if (!match) return url; // avatar (/avatars/…), SVG ou URL externe : rien à signer
  try {
    const exp = (Math.floor(Date.now() / PHOTO_URL_WINDOW_MS) + 2) * PHOTO_URL_WINDOW_MS;
    return `${url}${match[2] ? '&' : '?'}e=${exp}&s=${photoSignature(match[1], exp)}`;
  } catch {
    return url;
  }
}

function hasValidPhotoSignature(id, query) {
  const exp = Number(query.e);
  const signature = String(query.s || '');
  if (!Number.isFinite(exp) || exp < Date.now() || signature.length !== 32) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(photoSignature(id, exp)));
  } catch {
    return false;
  }
}

let adminApi = null; // renseigné au montage de server/admin.js (fin de fichier)

// Session facultative : administrateur, membre connecté ou visiteur anonyme (jeton absent ou invalide).
function readViewer(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return { kind: 'anonymous' };
  if (adminApi && adminApi.isAdminToken(token)) return { kind: 'admin' };
  try {
    const payload = jwt.verify(token, getSecret());
    if (payload.purpose || !payload.sub) return { kind: 'anonymous' };
    return { kind: 'member', id: String(payload.sub) };
  } catch {
    return { kind: 'anonymous' };
  }
}

// Vitrine publique : au plus SHOWCASE_PER_TIER profils par niveau, en alternant femmes et hommes
const SHOWCASE_PER_TIER = 6;
function buildShowcase(rows) {
  const byTier = new Map();
  for (const row of rows) {
    if (!byTier.has(row.tier)) byTier.set(row.tier, { Femme: [], Homme: [], other: [] });
    const bucket = byTier.get(row.tier);
    (bucket[row.gender] || bucket.other).push(row);
  }
  const picked = [];
  for (const bucket of byTier.values()) {
    const chosen = [];
    for (let i = 0; chosen.length < SHOWCASE_PER_TIER && (i < bucket.Femme.length || i < bucket.Homme.length); i += 1) {
      if (bucket.Femme[i] && chosen.length < SHOWCASE_PER_TIER) chosen.push(bucket.Femme[i]);
      if (bucket.Homme[i] && chosen.length < SHOWCASE_PER_TIER) chosen.push(bucket.Homme[i]);
    }
    picked.push(...chosen);
  }
  const order = new Map(rows.map((row, index) => [row.id, index]));
  return picked.sort((a, b) => order.get(a.id) - order.get(b.id));
}

app.get('/api/members', route(async (req, res) => {
  const viewer = readViewer(req);
  const where = ['is_suspended IS NOT TRUE'];
  const params = [];
  let kind = viewer.kind;

  if (kind === 'member') {
    const me = await pool.query('SELECT gender FROM members WHERE id::text = $1', [viewer.id]);
    if (!me.rows[0]) {
      kind = 'anonymous'; // compte supprimé : on retombe sur la vitrine publique
    } else {
      const own = me.rows[0].gender;
      const wanted = own === 'Femme' ? 'Homme' : own === 'Homme' ? 'Femme' : null;
      res.set({ 'Cache-Control': 'private, no-store', Vary: 'Authorization' });
      if (!wanted) return res.json({ success: true, viewer: 'member', count: 0, members: [] });
      params.push(wanted, viewer.id);
      where.push('gender = $1', 'id::text <> $2'); // genre opposé uniquement, jamais son propre profil
    }
  }

  const result = await pool.query(
    `SELECT id, COALESCE(pseudonym, name) AS name,
            COALESCE(EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date))::int, age, 30) AS age,
            gender, sought, city, ${kind === 'anonymous' ? `''::text AS bio` : 'bio'},
            CASE WHEN substr(photo, 1, 5) = 'data:' AND substr(photo, 1, 15) <> 'data:image/svg+' THEN '/api/members/' || id::text || '/photo?v=' || pg_column_size(photo)::text ELSE photo END AS photo,
            tier, created_at
     FROM members WHERE ${where.join(' AND ')} ORDER BY created_at DESC`,
    params
  );

  if (kind === 'anonymous') {
    // Aperçu public mixte, sans données privées, mis en cache 15 s côté Vercel (variante sans en-tête Authorization)
    res.set({ 'Cache-Control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=120', Vary: 'Authorization' });
    const showcase = buildShowcase(result.rows).map((row) => ({ ...row, photo: signPhotoUrl(row.photo) }));
    return res.json({ success: true, viewer: 'anonymous', count: showcase.length, members: showcase });
  }
  res.set({ 'Cache-Control': 'private, no-store', Vary: 'Authorization' });
  const members = result.rows.map((row) => ({ ...row, photo: signPhotoUrl(row.photo) }));
  res.json({ success: true, viewer: kind, count: members.length, members });
}));

// Photo d'un membre servie à part (image mise en cache par le navigateur) : la liste reste légère
app.get('/api/members/:id/photo', async (req, res) => {
  try {
    // Identifiant libre (UUID ou numérique selon l'ancienne table `members`), comme les autres routes /api/members/:id
    const notFound = () => res.set('Cache-Control', 'no-store').status(404).end();
    if (!/^[0-9a-zA-Z_-]{1,64}$/.test(req.params.id)) return notFound();
    // Adresse signée obligatoire : sans signature valide (ou expirée), la photo n'est pas servie
    if (!hasValidPhotoSignature(req.params.id, req.query)) return res.set('Cache-Control', 'no-store').status(403).end();
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
      'Cache-Control': 'private, max-age=21600',
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
      'DELETE FROM notifications WHERE member_id = $1 OR actor_id = $1',
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
    await client.query(
      'DELETE FROM member_blocks WHERE blocker_id = $1 OR blocked_id = $1',
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

// Une rencontre n'est possible qu'entre une femme et un homme
async function assertOppositeGenders(idA, idB) {
  const result = await pool.query('SELECT id::text AS id, gender FROM members WHERE id::text = ANY($1::text[])', [[idA, idB]]);
  const genderA = (result.rows.find((r) => r.id === idA) || {}).gender;
  const genderB = (result.rows.find((r) => r.id === idB) || {}).gender;
  if (!genderA || !genderB || genderA === genderB) {
    throw new HttpError(403, 'Les rencontres ne sont possibles qu’entre une femme et un homme.', 'SAME_GENDER');
  }
}

app.get('/api/encounters', authRequired, route(async (req, res) => {
  const me = String(req.auth.sub);
  const result = await pool.query(
    `SELECT er.id, er.requester_id, er.recipient_id, er.status, er.created_at, er.responded_at,
            (SELECT COUNT(*)::int FROM messages m WHERE m.sender_id = $1 AND m.recipient_id = CASE WHEN er.requester_id = $1 THEN er.recipient_id ELSE er.requester_id END) AS my_sent_messages
     FROM encounter_requests er
     JOIN members ra ON ra.id::text = er.requester_id
     JOIN members rb ON rb.id::text = er.recipient_id
     WHERE (er.requester_id = $1 OR er.recipient_id = $1) AND ra.gender IS DISTINCT FROM rb.gender
       AND NOT (er.recipient_id = $1 AND EXISTS (SELECT 1 FROM member_blocks mb WHERE mb.blocker_id = $1 AND mb.blocked_id = er.requester_id))
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

const REQUEST_TYPES = ['meeting', 'invitation'];
const withTimeout = (promise, ms = 2500) => Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);

const createEncounterRequest = route(async (req, res) => {
  const me = String(req.auth.sub);
  const body = req.body || {};
  const recipientId = String(body.recipientId ?? '').trim().slice(0, 64);
  const type = REQUEST_TYPES.includes(String(body.type)) ? String(body.type) : 'meeting';
  if (!recipientId || recipientId === me) throw new HttpError(400, 'Destinataire invalide.');

  const peerExists = await pool.query('SELECT 1 FROM members WHERE id::text = $1', [recipientId]);
  if (!peerExists.rows.length) throw new HttpError(404, 'Ce membre est introuvable.');
  await assertOppositeGenders(me, recipientId);
  const blockState = await readBlockState(me, recipientId);
  if (blockState.byMe) throw new HttpError(403, 'Vous avez bloqué ce membre. Débloquez-le pour lui proposer une rencontre.', 'BLOCKED_BY_ME');
  if (blockState.byPeer) throw new HttpError(403, 'Ce membre ne peut pas recevoir votre demande.', 'BLOCKED');

  const reverse = await pool.query(
    `SELECT id, status FROM encounter_requests WHERE requester_id = $1 AND recipient_id = $2`,
    [recipientId, me]
  );
  if (reverse.rows[0]) {
    if (reverse.rows[0].status === 'pending') {
      // Demande croisée : l'autre membre m'avait déjà écrit, la rencontre est acceptée d'office
      const accepted = await pool.query(
        `UPDATE encounter_requests SET status = 'accepted', responded_at = NOW(), exchange_started_at = COALESCE(exchange_started_at, NOW())
         WHERE id = $1 RETURNING *`,
        [reverse.rows[0].id]
      );
      await withTimeout(notifyRequestEvent('request_accepted', me, recipientId, accepted.rows[0].id));
      return res.status(200).json({ success: true, encounter: accepted.rows[0], autoAccepted: true });
    }
    if (reverse.rows[0].status === 'accepted') {
      return res.status(200).json({ success: true, encounter: reverse.rows[0], autoAccepted: true });
    }
  }

  const inserted = await pool.query(
    `INSERT INTO encounter_requests (requester_id, recipient_id, status, type)
     VALUES ($1, $2, 'pending', $3)
     ON CONFLICT (requester_id, recipient_id) DO UPDATE SET requester_id = EXCLUDED.requester_id
     RETURNING *, (xmax = 0) AS was_inserted`,
    [me, recipientId, type]
  );
  const { was_inserted: wasInserted, ...encounter } = inserted.rows[0];
  // Notification (base + push) uniquement pour une vraie nouvelle demande, jamais pour un doublon
  if (wasInserted) await withTimeout(notifyRequestEvent('request_received', me, recipientId, encounter.id));
  res.status(wasInserted ? 201 : 200).json({ success: true, encounter });
});
app.post('/api/encounters', authRequired, createEncounterRequest);
app.post('/api/requests', authRequired, createEncounterRequest);

// Réponse du destinataire (acceptée / refusée) : commune à PATCH /api/requests/:id et à l'ancienne route /accept
async function respondToRequest(me, reqId, nextStatus) {
  if (!UUID_RE.test(reqId)) throw new HttpError(400, 'Demande invalide.');
  const found = await pool.query('SELECT requester_id, status FROM encounter_requests WHERE id = $1 AND recipient_id = $2', [reqId, me]);
  const row = found.rows[0];
  if (!row) throw new HttpError(404, 'Demande introuvable ou non autorisée.');
  if (row.status === nextStatus) {
    const same = await pool.query('SELECT * FROM encounter_requests WHERE id = $1', [reqId]);
    return same.rows[0]; // déjà dans cet état : réponse idempotente
  }
  if (row.status !== 'pending') throw new HttpError(409, 'Cette demande a déjà reçu une réponse.', 'ALREADY_ANSWERED');

  if (nextStatus === 'accepted') {
    await assertOppositeGenders(me, row.requester_id);
    const block = await readBlockState(me, String(row.requester_id));
    if (block.byMe || block.byPeer) throw new HttpError(403, 'Cette demande ne peut pas être acceptée.', 'BLOCKED');
  }

  // L'acceptation ouvre le chat : le début de l'échange est fixé ici (messages effacés après MSG_TTL_HOURS = 72 h par purgeExpired)
  const updated = await pool.query(
    `UPDATE encounter_requests
     SET status = $3::text, responded_at = NOW(),
         exchange_started_at = CASE WHEN $3::text = 'accepted' THEN COALESCE(exchange_started_at, NOW()) ELSE exchange_started_at END
     WHERE id = $1 AND recipient_id = $2 AND status = 'pending'
     RETURNING *`,
    [reqId, me, nextStatus]
  );
  if (!updated.rows[0]) throw new HttpError(409, 'Cette demande a déjà reçu une réponse.', 'ALREADY_ANSWERED');
  if (nextStatus === 'accepted') await withTimeout(notifyRequestEvent('request_accepted', me, String(row.requester_id), reqId));
  return updated.rows[0];
}

// Boîte de réception / d'envoi : infos essentielles du membre en face, sans charger toute la fiche
app.get('/api/requests', authRequired, route(async (req, res) => {
  const me = String(req.auth.sub);
  const box = req.query.box === 'sent' ? 'sent' : req.query.box === 'received' ? 'received' : null;
  if (!box) throw new HttpError(400, 'Paramètre box invalide (received ou sent).');
  const received = box === 'received';
  const result = await pool.query(
    `SELECT er.id, er.type, er.status, er.created_at, er.responded_at,
            m.id::text AS peer_id, COALESCE(m.pseudonym, m.name) AS name,
            COALESCE(EXTRACT(YEAR FROM AGE(CURRENT_DATE, m.birth_date))::int, m.age) AS age,
            m.city, m.tier, m.gender,
            CASE WHEN substr(m.photo, 1, 5) = 'data:' AND substr(m.photo, 1, 15) <> 'data:image/svg+' THEN '/api/members/' || m.id::text || '/photo?v=' || pg_column_size(m.photo)::text ELSE m.photo END AS photo
     FROM encounter_requests er
     JOIN members m ON m.id::text = ${received ? 'er.requester_id' : 'er.recipient_id'}
     WHERE ${received ? 'er.recipient_id' : 'er.requester_id'} = $1
       AND m.is_suspended IS NOT TRUE
       AND m.gender IS DISTINCT FROM (SELECT gender FROM members WHERE id::text = $1)
       AND NOT EXISTS (SELECT 1 FROM member_blocks mb WHERE mb.blocker_id = $1 AND mb.blocked_id = m.id::text)
     ORDER BY (er.status = 'pending') DESC, er.created_at DESC
     LIMIT 100`,
    [me]
  );
  res.set('Cache-Control', 'private, no-store');
  res.json({
    success: true,
    box,
    requests: result.rows.map((r) => {
      const isAvatar = /^\/avatars\//.test(r.photo || '') || /^data:image\/svg\+xml/i.test(r.photo || '');
      return {
        id: String(r.id),
        type: r.type,
        status: r.status,
        createdAt: r.created_at,
        respondedAt: r.responded_at,
        member: {
          id: r.peer_id,
          name: r.name || 'Membre',
          age: r.age ?? null,
          city: r.city || '',
          tier: r.tier || 'standard',
          gender: r.gender || '',
          photo: signPhotoUrl(r.photo || ''),
          isAvatar,
          verified: !isAvatar,
        },
      };
    }),
  });
}));

// Compteurs des pastilles du profil : demandes reçues en attente + messages reçus non lus (non expirés)
app.get('/api/counts', authRequired, route(async (req, res) => {
  const me = String(req.auth.sub);
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM encounter_requests er
          JOIN members m ON m.id::text = er.requester_id
          WHERE er.recipient_id = $1 AND er.status = 'pending' AND m.is_suspended IS NOT TRUE
            AND m.gender IS DISTINCT FROM (SELECT gender FROM members WHERE id::text = $1)
            AND NOT EXISTS (SELECT 1 FROM member_blocks mb WHERE mb.blocker_id = $1 AND mb.blocked_id = m.id::text)) AS requests,
       (SELECT COUNT(*)::int FROM messages msg
          WHERE msg.recipient_id = $1 AND msg.read_at IS NULL AND NOT msg.deleted_for_receiver AND NOT msg.deleted_for_everyone
            AND msg.created_at > NOW() - make_interval(hours => $2::int)
            AND NOT EXISTS (SELECT 1 FROM member_blocks mb WHERE mb.blocker_id = $1 AND mb.blocked_id = msg.sender_id)) AS messages`,
    [me, MSG_TTL_HOURS]
  );
  res.set('Cache-Control', 'private, no-store');
  res.json({
    success: true,
    unreadRequestsCount: result.rows[0].requests ?? 0,
    unreadMessagesCount: result.rows[0].messages ?? 0,
  });
}));

app.patch('/api/requests/:id', authRequired, route(async (req, res) => {
  const me = String(req.auth.sub);
  const status = String((req.body || {}).status ?? '');
  if (!['accepted', 'declined'].includes(status)) throw new HttpError(400, 'Statut invalide (accepted ou declined).');
  const request = await respondToRequest(me, String(req.params.id ?? '').trim(), status);
  res.json({
    success: true,
    request: { id: String(request.id), status: request.status, respondedAt: request.responded_at },
    chat: status === 'accepted' ? { enabled: true, peerId: String(request.requester_id), messageTtlHours: MSG_TTL_HOURS } : null,
  });
}));

app.post('/api/encounters/:id/accept', authRequired, route(async (req, res) => {
  const encounter = await respondToRequest(String(req.auth.sub), String(req.params.id ?? '').trim(), 'accepted');
  res.json({ success: true, encounter });
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

// ---------------------------------------------------------------------------
// Fenêtre d'échange de 24 h : une discussion entre un membre Standard (non exempté) et un membre de niveau
// supérieur ne dure que 24 h. Le quota du niveau Standard (5 messages / 5 h) continue de s'appliquer.
// Départ de la fenêtre :
//  - début de l'échange = le plus tôt entre l'acceptation de la rencontre et le premier message
//    (à défaut, la création de la demande) — mémorisé dans encounter_requests.exchange_started_at ;
//  - si le membre Standard était abonné et que son abonnement a expiré, la fenêtre part du moment de
//    l'expiration (members.tier_downgraded_at) lorsqu'il est plus récent que le début de l'échange.
// ---------------------------------------------------------------------------
const WINDOW_24H_MS = 24 * 3600 * 1000;

async function computeWindows(db, me, peerIds) {
  const windows = new Map();
  if (!peerIds.length) return windows;

  const members = await db.query(
    'SELECT id::text AS id, tier, is_exempt, tier_downgraded_at FROM members WHERE id::text = ANY($1::text[])',
    [[me, ...peerIds]]
  );
  const byId = new Map(members.rows.map((r) => [r.id, {
    standard: r.tier === 'standard' && !r.is_exempt,
    downgradedAt: r.tier_downgraded_at ? new Date(r.tier_downgraded_at) : null,
  }]));
  const mine = byId.get(me);

  const inactive = (peer) => ({
    active: false,
    expiresAt: null,
    expired: false,
    peerIsStandard: Boolean(byId.get(peer) && byId.get(peer).standard),
    meIsStandard: Boolean(mine && mine.standard),
  });

  // La règle ne concerne que les paires « un Standard + un niveau supérieur »
  const concerned = peerIds.filter((peer) => mine && byId.get(peer) && byId.get(peer).standard !== mine.standard);
  for (const peer of peerIds) if (!concerned.includes(peer)) windows.set(peer, inactive(peer));
  if (!concerned.length) return windows;

  const encounters = await db.query(
    `SELECT id, requester_id, recipient_id, status, created_at, responded_at, exchange_started_at
     FROM encounter_requests
     WHERE (requester_id = $1 AND recipient_id = ANY($2::text[])) OR (recipient_id = $1 AND requester_id = ANY($2::text[]))
     ORDER BY CASE WHEN status = 'accepted' THEN 0 ELSE 1 END, created_at ASC`,
    [me, concerned]
  );
  const firstMessages = await db.query(
    `SELECT CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS peer, MIN(created_at) AS first_at
     FROM messages
     WHERE (sender_id = $1 AND recipient_id = ANY($2::text[])) OR (recipient_id = $1 AND sender_id = ANY($2::text[]))
     GROUP BY 1`,
    [me, concerned]
  );
  const firstAt = new Map(firstMessages.rows.map((r) => [r.peer, new Date(r.first_at)]));

  for (const peer of concerned) {
    const encounter = encounters.rows.find((r) => (r.requester_id === peer || r.recipient_id === peer));
    const candidates = [];
    if (encounter && encounter.status === 'accepted' && encounter.responded_at) candidates.push(new Date(encounter.responded_at));
    if (firstAt.has(peer)) candidates.push(firstAt.get(peer));
    if (!candidates.length && encounter) candidates.push(new Date(encounter.created_at));
    if (encounter && encounter.exchange_started_at) candidates.push(new Date(encounter.exchange_started_at));

    let exchangeStart = candidates.length ? new Date(Math.min(...candidates.map((d) => d.getTime()))) : null;
    if (encounter && exchangeStart && (!encounter.exchange_started_at || new Date(encounter.exchange_started_at) > exchangeStart)) {
      await db.query('UPDATE encounter_requests SET exchange_started_at = $2 WHERE id = $1', [encounter.id, exchangeStart]);
    }

    const standardSide = mine.standard ? mine : byId.get(peer);
    let start = exchangeStart;
    if (start && standardSide.downgradedAt && standardSide.downgradedAt > start) start = standardSide.downgradedAt;

    const expiresAt = start ? new Date(start.getTime() + WINDOW_24H_MS) : null;
    windows.set(peer, {
      active: true,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      expired: expiresAt ? Date.now() >= expiresAt.getTime() : false,
      peerIsStandard: byId.get(peer).standard,
      meIsStandard: mine.standard,
    });
  }
  return windows;
}

async function readWindow(db, me, peer) {
  return (await computeWindows(db, me, [peer])).get(peer)
    || { active: false, expiresAt: null, expired: false, peerIsStandard: false, meIsStandard: false };
}

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
  SELECT m.id, m.sender_id, m.kind, m.body, m.media, m.duration_ms, m.reply_to, m.created_at, m.delivered_at, m.read_at,
         m.edited_at, m.deleted_for_everyone,
         r.kind AS reply_kind, LEFT(r.body, 140) AS reply_body, r.sender_id AS reply_sender, r.deleted_for_everyone AS reply_deleted
  FROM messages m LEFT JOIN messages r ON r.id = m.reply_to`;

function toMessage(row, me) {
  let reply = null;
  if (row.reply_to) {
    // Citation d'un message supprimé pour tous (ou purgé) : « Message supprimé »
    reply = row.reply_kind && !row.reply_deleted
      ? { id: String(row.reply_to), kind: row.reply_kind, body: row.reply_body || '', fromMe: row.reply_sender === me }
      : { id: String(row.reply_to), kind: 'text', body: 'Message supprimé', fromMe: false, deleted: true };
  }
  const gone = Boolean(row.deleted_for_everyone);
  return {
    id: String(row.id),
    fromMe: row.sender_id === me,
    kind: row.kind,
    body: gone ? '' : (row.body || ''),
    media: gone ? null : (row.media || null),
    durationMs: gone ? null : row.duration_ms,
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
    deleted: gone,
    deletedForEveryone: gone,
    // Coches : envoyé (aucune date), distribué (deliveredAt), vu (readAt) — visibles par l'expéditeur seulement
    deliveredAt: row.sender_id === me ? (row.delivered_at || null) : null,
    readAt: row.sender_id === me ? (row.read_at || null) : null,
    reply: gone ? null : reply,
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

// ---------------------------------------------------------------------------
// Blocage d'un correspondant : plus de messages ni de demandes de rencontre de sa part
// ---------------------------------------------------------------------------
async function readBlockState(me, peer) {
  const result = await pool.query(
    'SELECT blocker_id FROM member_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)',
    [me, peer]
  );
  return { byMe: result.rows.some((r) => r.blocker_id === me), byPeer: result.rows.some((r) => r.blocker_id === peer) };
}

app.get('/api/blocks', authRequired, route(async (req, res) => {
  const result = await pool.query('SELECT blocked_id FROM member_blocks WHERE blocker_id = $1 ORDER BY created_at DESC', [String(req.auth.sub)]);
  res.json({ success: true, blocked: result.rows.map((r) => r.blocked_id) });
}));

app.post('/api/blocks', authRequired, route(async (req, res) => {
  const me = String(req.auth.sub);
  const memberId = String((req.body && req.body.memberId) ?? '').slice(0, 64);
  if (!memberId || memberId === me) throw new HttpError(400, 'Membre invalide.');
  const exists = await pool.query('SELECT 1 FROM members WHERE id::text = $1', [memberId]);
  if (!exists.rows.length) throw new HttpError(404, 'Ce membre est introuvable.');
  await pool.query('INSERT INTO member_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me, memberId]);
  res.status(201).json({ success: true, blocked: true });
}));

app.delete('/api/blocks/:peerId', authRequired, route(async (req, res) => {
  await pool.query('DELETE FROM member_blocks WHERE blocker_id = $1 AND blocked_id = $2', [String(req.auth.sub), String(req.params.peerId).slice(0, 64)]);
  res.json({ success: true, blocked: false });
}));

app.get('/api/messages', authRequired, route(async (req, res) => {
  await safePurge();
  const me = String(req.auth.sub);
  // L'application du destinataire a récupéré ses messages : ils passent à « distribué » (✓✓)
  await pool.query('UPDATE messages SET delivered_at = NOW() WHERE recipient_id = $1 AND delivered_at IS NULL', [me]);
  const result = await pool.query(
    `SELECT DISTINCT ON (peer) peer, kind, body, from_me, created_at, delivered_at, read_at, deleted FROM (
       SELECT CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS peer,
              kind, CASE WHEN deleted_for_everyone THEN '' ELSE LEFT(body, 140) END AS body, (sender_id = $1) AS from_me,
              created_at, delivered_at, read_at, deleted_for_everyone AS deleted
       FROM messages
       WHERE (sender_id = $1 OR recipient_id = $1)
         AND created_at > NOW() - make_interval(hours => $2::int)
         AND NOT (CASE WHEN sender_id = $1 THEN deleted_for_sender ELSE deleted_for_receiver END)
     ) t ORDER BY peer, created_at DESC`,
    [me, MSG_TTL_HOURS]
  );
  const conversations = result.rows
    .map((r) => ({
      peerId: r.peer,
      kind: r.deleted ? 'text' : r.kind,
      deleted: Boolean(r.deleted),
      body: r.body || '',
      fromMe: r.from_me,
      createdAt: r.created_at,
      status: r.from_me ? (r.read_at ? 'read' : r.delivered_at ? 'delivered' : 'sent') : null,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const blockedRows = await pool.query('SELECT blocked_id FROM member_blocks WHERE blocker_id = $1', [me]);
  const blockedByMe = new Set(blockedRows.rows.map((r) => r.blocked_id));
  const windows = await computeWindows(pool, me, conversations.map((c) => c.peerId));
  for (const conversation of conversations) {
    conversation.blockedByMe = blockedByMe.has(conversation.peerId);
    conversation.window24h = windows.get(conversation.peerId) || null;
  }
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
       AND NOT (CASE WHEN m.sender_id = $1 THEN m.deleted_for_sender ELSE m.deleted_for_receiver END)
     ORDER BY m.created_at DESC LIMIT 100`,
    [me, peer, MSG_TTL_HOURS, since]
  );
  // Rafraîchissement incrémental : le `since` ne renvoie que les nouveaux messages, on ajoute donc
  //  - `updates` : messages plus anciens modifiés / supprimés pour tous (ou dont la citation a changé)
  //  - `removedIds` : messages que j'ai supprimés « pour moi » (synchronisation entre mes appareils)
  let updates = [];
  let removedIds = [];
  if (since) {
    const changed = await pool.query(
      `${MESSAGE_SELECT}
       WHERE ((m.sender_id = $1 AND m.recipient_id = $2) OR (m.sender_id = $2 AND m.recipient_id = $1))
         AND m.created_at > NOW() - make_interval(hours => $3::int)
         AND m.created_at <= $4::timestamptz
         AND NOT (CASE WHEN m.sender_id = $1 THEN m.deleted_for_sender ELSE m.deleted_for_receiver END)
         AND (m.edited_at IS NOT NULL OR m.deleted_for_everyone OR r.edited_at IS NOT NULL OR r.deleted_for_everyone)
       ORDER BY m.created_at DESC LIMIT 100`,
      [me, peer, MSG_TTL_HOURS, since]
    );
    updates = changed.rows.reverse().map((row) => toMessage(row, me));
    const hidden = await pool.query(
      `SELECT m.id FROM messages m
       WHERE ((m.sender_id = $1 AND m.recipient_id = $2) OR (m.sender_id = $2 AND m.recipient_id = $1))
         AND m.created_at > NOW() - make_interval(hours => $3::int)
         AND (CASE WHEN m.sender_id = $1 THEN m.deleted_for_sender ELSE m.deleted_for_receiver END)
       ORDER BY m.created_at DESC LIMIT 100`,
      [me, peer, MSG_TTL_HOURS]
    );
    removedIds = hidden.rows.map((r) => String(r.id));
  }
  // Le destinataire consulte la discussion : ses messages reçus sont distribués et vus (✓✓ bleu chez l'expéditeur)
  await pool.query(
    `UPDATE messages SET delivered_at = COALESCE(delivered_at, NOW()), read_at = COALESCE(read_at, NOW())
     WHERE sender_id = $2 AND recipient_id = $1 AND read_at IS NULL`,
    [me, peer]
  );
  // État de mes messages envoyés dans cette discussion (le polling `since` ne renvoie que les nouveaux messages)
  const receiptRows = await pool.query(
    `SELECT id, delivered_at, read_at FROM messages
     WHERE sender_id = $1 AND recipient_id = $2 AND created_at > NOW() - make_interval(hours => $3::int)
     ORDER BY created_at DESC LIMIT 100`,
    [me, peer, MSG_TTL_HOURS]
  );
  const blockState = await readBlockState(me, peer);
  const tier = await getMemberTier(me);
  const encounter = await getEncounterState(pool, me, peer);
  res.json({
    success: true,
    blockedByMe: blockState.byMe,
    window24h: await readWindow(pool, me, peer),
    messages: result.rows.reverse().map((row) => toMessage(row, me)),
    updates,
    removedIds,
    receipts: receiptRows.rows.map((r) => ({ id: String(r.id), deliveredAt: r.delivered_at || null, readAt: r.read_at || null })),
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

  const blockState = await readBlockState(me, to);
  if (blockState.byMe) throw new HttpError(403, 'Vous avez bloqué ce membre. Débloquez-le pour lui écrire.', 'BLOCKED_BY_ME');
  if (blockState.byPeer) throw new HttpError(403, 'Ce membre ne peut pas recevoir vos messages.', 'BLOCKED');

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

    const windowInfo = await readWindow(client, me, to);
    if (windowInfo.active && windowInfo.expired) {
      throw new HttpError(
        403,
        windowInfo.meIsStandard
          ? 'La fenêtre de 24 h avec ce membre est terminée. Passez au niveau supérieur pour continuer à échanger.'
          : 'La fenêtre de 24 h de votre interlocuteur (niveau Standard) est expirée : il doit passer au niveau supérieur pour continuer à échanger.',
        'WINDOW_24H_EXPIRED',
        { window24h: windowInfo }
      );
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
    window24h: await readWindow(pool, me, to),
  });
}));

// Modifier le texte d'un de mes messages (expéditeur uniquement, kind = 'text', non supprimé)
app.patch('/api/messages/:id', authRequired, route(async (req, res) => {
  const me = String(req.auth.sub);
  const id = String(req.params.id ?? '').trim();
  if (!UUID_RE.test(id)) throw new HttpError(400, 'Message invalide.');
  const text = String((req.body || {}).body ?? '').trim();
  if (!text) throw new HttpError(400, 'Le message est vide.');
  if (text.length > 1000) throw new HttpError(400, 'Message trop long (1000 caractères maximum).');

  const found = await pool.query('SELECT sender_id, kind, deleted_for_everyone, deleted_for_sender FROM messages WHERE id = $1', [id]);
  const row = found.rows[0];
  if (!row || String(row.sender_id) !== me) throw new HttpError(404, 'Message introuvable.');
  if (row.kind !== 'text') throw new HttpError(400, 'Seuls les messages texte peuvent être modifiés.');
  if (row.deleted_for_everyone || row.deleted_for_sender) throw new HttpError(409, 'Ce message a été supprimé.', 'MESSAGE_DELETED');

  await pool.query('UPDATE messages SET body = $2, edited_at = NOW() WHERE id = $1 AND sender_id = $3', [id, text, me]);
  const saved = await pool.query(`${MESSAGE_SELECT} WHERE m.id = $1`, [id]);
  res.json({ success: true, message: toMessage(saved.rows[0], me) });
}));

// Supprimer un message : scope=me (pour moi seul) ou scope=everyone (expéditeur uniquement)
app.delete('/api/messages/:id', authRequired, route(async (req, res) => {
  const me = String(req.auth.sub);
  const id = String(req.params.id ?? '').trim();
  if (!UUID_RE.test(id)) throw new HttpError(400, 'Message invalide.');
  const scope = req.query.scope === 'everyone' ? 'everyone' : req.query.scope === 'me' ? 'me' : null;
  if (!scope) throw new HttpError(400, 'Paramètre scope invalide (me ou everyone).');

  const found = await pool.query('SELECT sender_id, recipient_id FROM messages WHERE id = $1 AND (sender_id = $2 OR recipient_id = $2)', [id, me]);
  const row = found.rows[0];
  if (!row) throw new HttpError(404, 'Message introuvable.');
  const isSender = String(row.sender_id) === me;

  if (scope === 'me') {
    const column = isSender ? 'deleted_for_sender' : 'deleted_for_receiver';
    await pool.query(`UPDATE messages SET ${column} = true WHERE id = $1`, [id]);
    return res.json({ success: true, scope, id });
  }
  if (!isSender) throw new HttpError(403, 'Seul l’expéditeur peut supprimer un message pour tous.', 'NOT_SENDER');
  // Contenu vidé en base ; les citations de ce message sont affichées « supprimé » via la jointure de MESSAGE_SELECT
  await pool.query(
    'UPDATE messages SET deleted_for_everyone = true, body = NULL, media = NULL, duration_ms = NULL WHERE id = $1',
    [id]
  );
  const saved = await pool.query(`${MESSAGE_SELECT} WHERE m.id = $1`, [id]);
  res.json({ success: true, scope, id, message: toMessage(saved.rows[0], me) });
}));

// Supprimer toute une conversation « pour moi » : tous les messages échangés avec ce membre disparaissent de mon côté
// (l'autre membre les conserve ; la demande de rencontre et les éventuels blocages ne changent pas)
app.delete('/api/conversations/:peerId', authRequired, route(async (req, res) => {
  const me = String(req.auth.sub);
  const peer = String(req.params.peerId ?? '').trim().slice(0, 64);
  if (!peer || peer === me) throw new HttpError(400, 'Conversation invalide.');
  const result = await pool.query(
    `UPDATE messages
     SET deleted_for_sender = deleted_for_sender OR (sender_id = $1),
         deleted_for_receiver = deleted_for_receiver OR (recipient_id = $1)
     WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)`,
    [me, peer]
  );
  res.json({ success: true, deleted: result.rowCount });
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

// Demande reçue / acceptée : ligne en base (table notifications) + Web Push vers les appareils du destinataire
async function notifyRequestEvent(kind, actorId, targetId, requestId) {
  try {
    await pool.query(
      'INSERT INTO notifications (member_id, kind, actor_id, request_id) VALUES ($1, $2, $3, $4)',
      [targetId, kind, actorId, requestId]
    );
  } catch (err) {
    console.warn('Notification en base ignorée :', err.message);
  }
  if (!pushEnabled) return;
  try {
    const subs = await pool.query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE member_id = $1', [targetId]);
    if (!subs.rows.length) return;
    const actor = await pool.query(`SELECT COALESCE(pseudonym, name, 'Un membre') AS name FROM members WHERE id::text = $1`, [actorId]);
    const name = actor.rows[0] ? actor.rows[0].name : 'Un membre';
    const received = kind === 'request_received';
    await deliverPush(subs.rows, {
      title: 'Cercle Élite',
      body: received ? `${name} vous propose une rencontre.` : `${name} a accepté votre demande. Vous pouvez discuter.`,
      // reçue → section Demandes du profil ; acceptée → conversation avec ce membre
      url: received ? '/#/niveau/standard/profil/demandes' : `/#/niveau/standard/messages/${encodeURIComponent(actorId)}`,
      tag: `req-${kind}-${actorId}`,
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
adminApi = require('./admin')(app, { pool, ensureSchema, route, HttpError, TIERS, UUID_RE, SUBSCRIPTION_DAYS, MEMBER_COLUMNS, toMember, readProfileFields, validateEmail, validatePassword, calculateAge, PAID_TIERS, readPricing, toUpgradeRequest, pushEnabled, VAPID_PUBLIC_KEY, notifyAdmins, signPhotoUrl });

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Serveur back-end démarré sur le port ${PORT}`);
  });
}

module.exports = app;