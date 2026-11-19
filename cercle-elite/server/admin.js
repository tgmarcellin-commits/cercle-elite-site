// ---------------------------------------------------------------------------
// Espace d'administration — routes /api/admin/*
// Monté depuis server/index.js : require('./admin')(app, deps)
//
// Sécurité :
//  - ADMIN_PASSWORD n'est lu que côté serveur (variable d'environnement Vercel).
//  - Comparaison à temps constant (SHA-256 + crypto.timingSafeEqual).
//  - Limitation des tentatives par IP, stockée en base (compatible serverless).
//  - Jeton JWT { role: 'admin', purpose: 'admin' } de 4 h, jamais accepté comme
//    session de membre (authRequired refuse tout jeton portant « purpose »).
//  - Toutes les requêtes SQL sont paramétrées ($1, $2, …).
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const ADMIN_TOKEN_TTL = '4h';
const LOGIN_MAX_FAILS = 5;     // échecs autorisés…
const LOGIN_WINDOW_MIN = 15;   // …dans cette fenêtre (minutes)
const LOGIN_BLOCK_MIN = 15;    // blocage de l'adresse IP (minutes)
const DEFAULT_PHOTO = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80';
const PAYMENT_TABLES = ['payments', 'payment_transactions', 'transactions', 'paiements'];
const PAID_STATUSES = ['paid', 'success', 'succeeded', 'completed', 'approved', 'accepted', 'done'];
const DAY_MS = 86400000;

module.exports = function mountAdmin(app, deps) {
  const {
    pool, ensureSchema, HttpError, TIERS, SUBSCRIPTION_DAYS,
    readProfileFields, validateEmail, validatePassword, calculateAge,
  } = deps;

  // -------------------------------------------------------------------------
  // Utilitaires
  // -------------------------------------------------------------------------
  const adminSecret = () => {
    const secret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;
    return secret && secret.length >= 16 ? secret : null;
  };

  const passwordMatches = (input, expected) => {
    const a = crypto.createHash('sha256').update(String(input)).digest();
    const b = crypto.createHash('sha256').update(String(expected)).digest();
    return crypto.timingSafeEqual(a, b);
  };

  const clientIp = (req) => {
    const h = req.headers;
    const raw = h['x-vercel-forwarded-for'] || h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0]
      || (req.socket && req.socket.remoteAddress) || 'unknown';
    return String(raw).trim().slice(0, 64) || 'unknown';
  };

  const escapeLike = (value) => String(value).replace(/[\\%_]/g, '\\$&');

  const parseId = (value) => {
    const id = String(value ?? '').trim();
    if (!/^[0-9a-zA-Z-]{1,64}$/.test(id)) throw new HttpError(400, 'Identifiant de membre invalide.');
    return id;
  };

  const strictBool = (value, label) => {
    if (typeof value !== 'boolean') throw new HttpError(400, `Valeur invalide pour ${label} (true ou false attendu).`);
    return value;
  };

  const safe = async (promise, fallback = null) => {
    try { return await promise; } catch (err) { console.warn('Admin (statistique ignorée) :', err.message); return fallback; }
  };

  // Même gestion d'erreurs que `route` de index.js, sans la purge automatique des
  // abonnements (pour que « Nettoyer les expirés » affiche un compte exact).
  const adminRoute = (handler) => async (req, res, next) => {
    try {
      await ensureSchema();
      await handler(req, res, next);
    } catch (err) {
      if (err instanceof HttpError) {
        return res.status(err.status).json({ success: false, error: err.message, code: err.code, ...err.extra });
      }
      if (err && err.code === '23505') {
        return res.status(409).json({ success: false, error: 'Cet e-mail est déjà inscrit.', code: 'EMAIL_EXISTS' });
      }
      console.error(err);
      res.status(500).json({ success: false, error: 'Erreur interne du serveur.' });
    }
  };

  let adminSchemaReady = null;
  const ensureAdminSchema = () => {
    if (!adminSchemaReady) {
      adminSchemaReady = pool.query(`
        CREATE TABLE IF NOT EXISTS admin_login_attempts (
          ip            TEXT PRIMARY KEY,
          fails         INTEGER NOT NULL DEFAULT 0,
          window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          blocked_until TIMESTAMPTZ
        )`).catch((err) => { adminSchemaReady = null; throw err; });
    }
    return adminSchemaReady;
  };

  const tableColumns = async (table) => {
    const r = await pool.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
      [table]
    );
    return new Set(r.rows.map((x) => x.column_name));
  };

  const findPaymentTable = async () => {
    const r = await pool.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1::text[])',
      [PAYMENT_TABLES]
    );
    const name = PAYMENT_TABLES.find((n) => r.rows.some((x) => x.table_name === n));
    return name ? { name, cols: await tableColumns(name) } : null;
  };

  // Colonnes renvoyées pour un membre (sans photo ni hash de mot de passe)
  const adminColumns = (cols) => {
    const list = ['id', 'email', 'pseudonym', 'name', 'age', 'birth_date', 'gender', 'sought', 'city', 'tier',
      'tier_expires_at', 'created_at', 'is_exempt', 'is_suspended'];
    if (cols.has('is_verified')) list.push('is_verified');
    return list.join(', ');
  };

  const toAdminMember = (row) => {
    const birth = row.birth_date ? new Date(row.birth_date).toISOString().slice(0, 10) : '';
    return {
      id: String(row.id),
      email: row.email || '',
      pseudonym: row.pseudonym || row.name || 'Membre',
      age: birth ? calculateAge(birth) : (row.age ?? null),
      gender: row.gender || '',
      sought: row.sought || '',
      city: row.city || '',
      tier: row.tier,
      tierExpiresAt: row.tier_expires_at || null,
      createdAt: row.created_at,
      isExempt: Boolean(row.is_exempt),
      isSuspended: Boolean(row.is_suspended),
      isVerified: row.is_verified === undefined ? null : Boolean(row.is_verified),
    };
  };

  // -------------------------------------------------------------------------
  // Authentification admin
  // -------------------------------------------------------------------------
  function requireAdmin(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentification administrateur requise.', code: 'ADMIN_UNAUTHENTICATED' });
    }
    const secret = adminSecret();
    if (!secret) {
      return res.status(503).json({ success: false, error: "Secret JWT non configuré sur le serveur.", code: 'ADMIN_NOT_CONFIGURED' });
    }
    try {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
      if (payload.role !== 'admin' || payload.purpose !== 'admin') throw new Error('jeton non administrateur');
      req.admin = payload;
      next();
    } catch {
      res.status(401).json({ success: false, error: 'Session administrateur expirée. Reconnectez-vous.', code: 'ADMIN_SESSION_EXPIRED' });
    }
  }

  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  router.post('/login', adminRoute(async (req, res) => {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) {
      throw new HttpError(503, "L'espace administrateur n'est pas configuré (ADMIN_PASSWORD manquant).", 'ADMIN_NOT_CONFIGURED');
    }
    const secret = adminSecret();
    if (!secret) {
      throw new HttpError(503, 'ADMIN_JWT_SECRET ou JWT_SECRET manquant (16 caractères minimum).', 'ADMIN_NOT_CONFIGURED');
    }

    await ensureAdminSchema();
    const ip = clientIp(req);
    await pool.query(
      `DELETE FROM admin_login_attempts
       WHERE window_start < NOW() - INTERVAL '1 day' AND (blocked_until IS NULL OR blocked_until < NOW())`
    );

    const state = await pool.query('SELECT blocked_until FROM admin_login_attempts WHERE ip = $1', [ip]);
    const blockedUntil = state.rows[0] && state.rows[0].blocked_until ? new Date(state.rows[0].blocked_until) : null;
    if (blockedUntil && blockedUntil > new Date()) {
      const retryAfter = Math.max(1, Math.ceil((blockedUntil.getTime() - Date.now()) / 1000));
      res.set('Retry-After', String(retryAfter));
      throw new HttpError(429, 'Trop de tentatives. Réessayez plus tard.', 'ADMIN_RATE_LIMITED', { retryAfter });
    }

    const password = String((req.body || {}).password ?? '');
    if (!password || !passwordMatches(password, expected)) {
      const counted = await pool.query(
        `INSERT INTO admin_login_attempts (ip, fails, window_start) VALUES ($1, 1, NOW())
         ON CONFLICT (ip) DO UPDATE SET
           fails = CASE WHEN admin_login_attempts.window_start <= NOW() - make_interval(mins => $2::int)
                        THEN 1 ELSE admin_login_attempts.fails + 1 END,
           window_start = CASE WHEN admin_login_attempts.window_start <= NOW() - make_interval(mins => $2::int)
                               THEN NOW() ELSE admin_login_attempts.window_start END
         RETURNING fails`,
        [ip, LOGIN_WINDOW_MIN]
      );
      if (counted.rows[0].fails >= LOGIN_MAX_FAILS) {
        await pool.query(
          'UPDATE admin_login_attempts SET blocked_until = NOW() + make_interval(mins => $2::int) WHERE ip = $1',
          [ip, LOGIN_BLOCK_MIN]
        );
      }
      throw new HttpError(401, 'Mot de passe administrateur invalide.', 'ADMIN_INVALID_PASSWORD');
    }

    await pool.query('DELETE FROM admin_login_attempts WHERE ip = $1', [ip]);
    const token = jwt.sign({ role: 'admin', purpose: 'admin' }, secret, { expiresIn: ADMIN_TOKEN_TTL, algorithm: 'HS256' });
    res.json({ success: true, token, expiresIn: ADMIN_TOKEN_TTL });
  }));

  // Toutes les routes ci-dessous exigent un jeton administrateur valide
  router.use(requireAdmin);

  // -------------------------------------------------------------------------
  // Statistiques
  // -------------------------------------------------------------------------
  router.get('/overview', adminRoute(async (req, res) => {
    const membersStats = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE is_exempt IS TRUE)::int AS exempt,
              COUNT(*) FILTER (WHERE is_suspended IS TRUE)::int AS suspended,
              COUNT(*) FILTER (WHERE gender = 'Homme')::int AS men,
              COUNT(*) FILTER (WHERE gender = 'Femme')::int AS women,
              COUNT(*) FILTER (WHERE tier = 'standard')::int AS standard,
              COUNT(*) FILTER (WHERE tier = 'confirme')::int AS confirme,
              COUNT(*) FILTER (WHERE tier = 'vip')::int AS vip,
              COUNT(*) FILTER (WHERE tier = 'elite')::int AS elite,
              COUNT(*) FILTER (WHERE tier <> 'standard' AND is_exempt IS NOT TRUE AND tier_expires_at IS NOT NULL
                               AND tier_expires_at > NOW() AND tier_expires_at <= NOW() + INTERVAL '7 days')::int AS expiring_soon,
              COUNT(*) FILTER (WHERE tier <> 'standard' AND is_exempt IS NOT TRUE AND tier_expires_at IS NOT NULL
                               AND tier_expires_at <= NOW())::int AS expired_pending
       FROM members`
    );
    const m = membersStats.rows[0];

    const cols = await tableColumns('members');
    const expiringRows = await safe(pool.query(
      `SELECT ${adminColumns(cols)} FROM members
       WHERE tier <> 'standard' AND is_exempt IS NOT TRUE AND tier_expires_at IS NOT NULL
         AND tier_expires_at > NOW() AND tier_expires_at <= NOW() + INTERVAL '7 days'
       ORDER BY tier_expires_at ASC LIMIT 50`
    ), { rows: [] });

    const encounters = await safe(pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
       FROM encounter_requests`
    ));
    const messages = await safe(pool.query('SELECT COUNT(*)::int AS total FROM messages'));

    let payments = { available: false };
    const payTable = await safe(findPaymentTable());
    if (payTable) {
      payments = { available: true, table: payTable.name, count: null, total: null };
      const where = payTable.cols.has('status') ? 'WHERE LOWER(status::text) = ANY($1::text[])' : '';
      const params = payTable.cols.has('status') ? [PAID_STATUSES] : [];
      const count = await safe(pool.query(`SELECT COUNT(*)::int AS n FROM "${payTable.name}" ${where}`, params));
      payments.count = count ? count.rows[0].n : null;
      if (payTable.cols.has('amount')) {
        const sum = await safe(pool.query(`SELECT COALESCE(SUM(amount::numeric), 0)::float8 AS total FROM "${payTable.name}" ${where}`, params));
        payments.total = sum ? sum.rows[0].total : null;
      }
    }

    res.json({
      success: true,
      stats: {
        totalMembers: m.total,
        byTier: { standard: m.standard, confirme: m.confirme, vip: m.vip, elite: m.elite },
        exemptCount: m.exempt,
        suspendedCount: m.suspended,
        byGender: { Homme: m.men, Femme: m.women },
        encounters: encounters ? encounters.rows[0] : null,
        messages: messages ? messages.rows[0].total : null,
        payments,
        expiringSoon: { count: m.expiring_soon, members: expiringRows.rows.map(toAdminMember) },
        expiredPending: m.expired_pending,
        generatedAt: new Date().toISOString(),
      },
    });
  }));

  // -------------------------------------------------------------------------
  // Membres
  // -------------------------------------------------------------------------
  router.get('/members', adminRoute(async (req, res) => {
    const cols = await tableColumns('members');
    const where = [];
    const params = [];
    const search = String(req.query.search ?? '').trim().slice(0, 80);
    if (search) {
      params.push(`%${escapeLike(search)}%`);
      const n = params.length;
      where.push(`(COALESCE(pseudonym, name, '') ILIKE $${n} ESCAPE '\\' OR COALESCE(email, '') ILIKE $${n} ESCAPE '\\' OR COALESCE(city, '') ILIKE $${n} ESCAPE '\\')`);
    }
    if (req.query.tier) {
      if (!TIERS.includes(String(req.query.tier))) throw new HttpError(400, 'Niveau invalide.');
      params.push(String(req.query.tier));
      where.push(`tier = $${params.length}`);
    }
    if (req.query.exempt === 'true') where.push('is_exempt IS TRUE');
    if (req.query.exempt === 'false') where.push('is_exempt IS NOT TRUE');
    if (req.query.suspended === 'true') where.push('is_suspended IS TRUE');
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const total = await pool.query(`SELECT COUNT(*)::int AS n FROM members ${clause}`, params);
    const rows = await pool.query(
      `SELECT ${adminColumns(cols)} FROM members ${clause}
       ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    res.json({ success: true, total: total.rows[0].n, count: rows.rows.length, members: rows.rows.map(toAdminMember) });
  }));

  router.patch('/members/:id', adminRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const body = req.body || {};
    const cols = await tableColumns('members');
    const supported = ['tier', 'tier_expires_at', 'extendDays', 'is_exempt', 'is_suspended', 'is_verified'];
    if (!supported.some((key) => body[key] !== undefined)) throw new HttpError(400, 'Aucune modification demandée.');
    if (body.is_verified !== undefined && !cols.has('is_verified')) {
      throw new HttpError(400, "Le statut « vérifié » n'existe pas dans la base de données.");
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const curRes = await client.query(
        `SELECT id, tier, tier_expires_at, is_exempt, is_suspended${cols.has('is_verified') ? ', is_verified' : ''}
         FROM members WHERE id::text = $1 FOR UPDATE`,
        [id]
      );
      const cur = curRes.rows[0];
      if (!cur) throw new HttpError(404, 'Membre introuvable.');

      const now = Date.now();
      const wasExempt = Boolean(cur.is_exempt);
      let tier = cur.tier;
      let exempt = wasExempt;
      let suspended = Boolean(cur.is_suspended);
      let verified = cols.has('is_verified') ? Boolean(cur.is_verified) : null;
      let expires = cur.tier_expires_at ? new Date(cur.tier_expires_at) : null;
      let tierChanged = false;
      let expiryTouched = false;
      let extend = 0;

      if (body.tier !== undefined) {
        if (!TIERS.includes(body.tier)) throw new HttpError(400, 'Niveau invalide.');
        tierChanged = body.tier !== tier;
        tier = body.tier;
      }
      if (body.is_exempt !== undefined) exempt = strictBool(body.is_exempt, 'is_exempt');
      if (body.is_suspended !== undefined) suspended = strictBool(body.is_suspended, 'is_suspended');
      if (body.is_verified !== undefined) verified = strictBool(body.is_verified, 'is_verified');
      if (body.tier_expires_at !== undefined) {
        expiryTouched = true;
        if (body.tier_expires_at === null) {
          expires = null;
        } else {
          const d = new Date(body.tier_expires_at);
          if (Number.isNaN(d.getTime())) throw new HttpError(400, "Date d'expiration invalide.");
          expires = d;
        }
      }
      if (body.extendDays !== undefined) {
        extend = Number(body.extendDays);
        if (!Number.isInteger(extend) || extend < 1 || extend > 3650) {
          throw new HttpError(400, 'La prolongation doit être un nombre entier de jours (1 à 3650).');
        }
      }

      // Exemption retirée sans nouveau niveau demandé : retour au niveau Standard
      if (wasExempt && !exempt && body.tier === undefined) tier = 'standard';

      if (exempt) {
        if (extend) throw new HttpError(400, "Un compte exempté n'a pas de date d'expiration.");
        expires = null;
      } else if (tier === 'standard') {
        if (extend) throw new HttpError(400, "Choisissez d'abord un niveau payant avant de prolonger l'abonnement.");
        expires = null;
      } else if (extend) {
        const base = expires && expires.getTime() > now ? expires.getTime() : now;
        expires = new Date(base + extend * DAY_MS);
      } else if (!expiryTouched && (tierChanged || wasExempt) && (!expires || expires.getTime() <= now)) {
        expires = new Date(now + SUBSCRIPTION_DAYS * DAY_MS);
      } else if (!expires) {
        expires = new Date(now + SUBSCRIPTION_DAYS * DAY_MS); // niveau payant : jamais sans échéance
      }

      const sets = ['tier = $2', 'tier_expires_at = $3', 'is_exempt = $4', 'is_suspended = $5'];
      const values = [id, tier, expires, exempt, suspended];
      if (cols.has('is_verified') && verified !== null) {
        values.push(verified);
        sets.push(`is_verified = $${values.length}`);
      }
      const updated = await client.query(
        `UPDATE members SET ${sets.join(', ')} WHERE id::text = $1 RETURNING ${adminColumns(cols)}`,
        values
      );
      await client.query('COMMIT');
      res.json({ success: true, member: toAdminMember(updated.rows[0]) });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }));

  router.delete('/members/:id', adminRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT email FROM members WHERE id::text = $1 FOR UPDATE', [id]);
      if (!found.rows[0]) throw new HttpError(404, 'Membre introuvable.');
      const email = found.rows[0].email ? String(found.rows[0].email).toLowerCase() : null;

      await client.query('DELETE FROM encounter_requests WHERE requester_id = $1 OR recipient_id = $1', [id]);
      await client.query('DELETE FROM messages WHERE sender_id = $1 OR recipient_id = $1', [id]);
      await client.query('DELETE FROM chat_quota WHERE member_id = $1', [id]);
      if (email) await client.query('DELETE FROM otp_codes WHERE LOWER(email) = $1', [email]);
      await client.query('DELETE FROM members WHERE id::text = $1', [id]);
      await client.query('COMMIT');
      res.json({ success: true, deleted: true });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }));

  // -------------------------------------------------------------------------
  // Comptes exemptés : création directe ou exemption d'un compte existant
  // -------------------------------------------------------------------------
  router.post('/exempt-accounts', adminRoute(async (req, res) => {
    const body = req.body || {};
    const email = validateEmail(body.email);
    const mode = body.mode === 'existing' || body.mode === 'create' ? body.mode : (body.password ? 'create' : 'existing');
    const cols = await tableColumns('members');

    let tier = null;
    if (body.tier !== undefined && body.tier !== null && body.tier !== '') {
      if (!TIERS.includes(body.tier)) throw new HttpError(400, 'Niveau invalide.');
      tier = body.tier;
    }

    if (mode === 'existing') {
      const updated = await pool.query(
        `UPDATE members SET is_exempt = TRUE, tier_expires_at = NULL, tier = COALESCE($2::text, tier)
         WHERE LOWER(email) = $1 RETURNING ${adminColumns(cols)}`,
        [email, tier]
      );
      if (!updated.rows[0]) {
        throw new HttpError(404, 'Aucun membre ne correspond à cet e-mail. Utilisez « Créer un compte exempté ».', 'NO_ACCOUNT');
      }
      return res.json({ success: true, created: false, member: toAdminMember(updated.rows[0]) });
    }

    const password = validatePassword(body.password);
    const f = readProfileFields(body, ['pseudonym', 'birth_date', 'gender', 'sought', 'city']);
    const exists = await pool.query('SELECT 1 FROM members WHERE LOWER(email) = $1', [email]);
    if (exists.rows.length) {
      throw new HttpError(409, 'Cet e-mail est déjà inscrit. Utilisez « Exempter un membre existant ».', 'EMAIL_EXISTS');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const inserted = await pool.query(
      `INSERT INTO members (email, password_hash, pseudonym, name, age, birth_date, gender, sought, city, bio, photo, tier, tier_expires_at, is_exempt)
       VALUES ($1::text, $2::text, $3::text, $3::text, $4::int, $5::date, $6::text, $7::text, $8::text, $9::text, $10::text, $11::text, NULL, TRUE)
       RETURNING ${adminColumns(cols)}`,
      [email, passwordHash, f.pseudonym, calculateAge(f.birth_date), f.birth_date, f.gender, f.sought, f.city,
        f.bio ?? '', f.photo || DEFAULT_PHOTO, tier || f.tier || 'standard']
    );
    res.status(201).json({ success: true, created: true, member: toAdminMember(inserted.rows[0]) });
  }));

  // -------------------------------------------------------------------------
  // Maintenance & paiements
  // -------------------------------------------------------------------------
  router.post('/maintenance/expire-tiers', adminRoute(async (req, res) => {
    const result = await pool.query(
      `UPDATE members SET tier = 'standard', tier_expires_at = NULL
       WHERE tier <> 'standard' AND is_exempt IS NOT TRUE
         AND tier_expires_at IS NOT NULL AND tier_expires_at <= NOW()
       RETURNING id`
    );
    res.json({ success: true, downgraded: result.rowCount });
  }));

  router.get('/payments', adminRoute(async (req, res) => {
    const payTable = await findPaymentTable();
    if (!payTable) return res.json({ success: true, available: false, transactions: [] });
    const orderCol = ['created_at', 'paid_at', 'date', 'id'].find((c) => payTable.cols.has(c));
    const rows = await pool.query(
      `SELECT * FROM "${payTable.name}" ${orderCol ? `ORDER BY "${orderCol}" DESC` : ''} LIMIT 50`
    );
    const hidden = /(token|secret|password|hash|card|iban)/i;
    const transactions = rows.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !hidden.test(key))));
    res.json({ success: true, available: true, table: payTable.name, transactions });
  }));

  app.use('/api/admin', router);
};
