import { useCallback, useEffect, useState, type FormEvent } from 'react';
import AdminPush from './AdminPush';
import './admin.css';

type TierId = 'standard' | 'confirme' | 'vip' | 'elite';
type AdminMember = {
  id: string;
  email: string;
  pseudonym: string;
  age: number | null;
  gender: string;
  city: string;
  tier: TierId;
  tierExpiresAt: string | null;
  createdAt: string;
  isExempt: boolean;
  isSuspended: boolean;
  isVerified: boolean | null;
};
type Stats = {
  totalMembers: number;
  byTier: Record<TierId, number>;
  exemptCount: number;
  suspendedCount: number;
  byGender: { Homme: number; Femme: number };
  encounters: { total: number; accepted: number; pending: number } | null;
  messages: number | null;
  payments: { available: boolean; table?: string; count?: number | null; total?: number | null };
  expiringSoon: { count: number; members: AdminMember[] };
  expiredPending: number;
  pendingRequests: number;
};
type UpgradeRequest = {
  id: string;
  memberId: string;
  memberEmail: string;
  pseudonym: string;
  requestedTier: TierId;
  amountFcfa: number;
  paymentMethod: string;
  whatsappPhone: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  processedAt: string | null;
};
type Tab = 'overview' | 'requests' | 'pricing' | 'exempt' | 'members' | 'actions';

const TIERS: { id: TierId; label: string }[] = [
  { id: 'standard', label: 'Standard' },
  { id: 'confirme', label: 'Confirmé' },
  { id: 'vip', label: 'VIP' },
  { id: 'elite', label: 'Élite' },
];
const tierLabel = (id: string) => TIERS.find((t) => t.id === id)?.label ?? id;
const TOKEN_KEY = 'cercle-admin-token';

class AdminApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function adminApi(path: string, method = 'GET', body?: unknown, token?: string | null): Promise<any> {
  const response = await fetch(`/api/admin${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new AdminApiError(data.error || 'Une erreur est survenue. Réessayez dans un instant.', response.status, data.code);
  }
  return data;
}

const readStoredToken = () => {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
};
const storeToken = (token: string | null) => {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* stockage indisponible : le jeton reste en mémoire */ }
};
const fmtDate = (value: string | null) => (value ? new Date(value).toLocaleDateString('fr-FR') : '—');
const fmtDateTime = (value: string | null) => (value ? new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const fmtMoney = (value: number) => value.toLocaleString('fr-FR');
const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'Erreur inattendue.');

type CallFn = (path: string, method?: string, body?: unknown) => Promise<any>;

function Admin() {
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [notice, setNotice] = useState('');

  useEffect(() => {
    document.title = 'Administration — Cercle Élite';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);

  const logout = useCallback((message = '') => {
    storeToken(null);
    setToken(null);
    setNotice(message);
  }, []);

  if (!token) {
    return <LoginScreen notice={notice} onLogin={(t) => { storeToken(t); setToken(t); setNotice(''); }} />;
  }
  return <Dashboard token={token} onLogout={logout} />;
}

function LoginScreen({ onLogin, notice }: { onLogin: (token: string) => void; notice: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await adminApi('/login', 'POST', { password });
      setPassword('');
      onLogin(data.token);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="adm-login">
      <form className="adm-card adm-login-card" onSubmit={submit}>
        <h1>Administration</h1>
        <p className="adm-muted">Cercle Élite — accès réservé</p>
        {notice && <p className="adm-info" role="status">{notice}</p>}
        <label htmlFor="adm-password">Mot de passe administrateur</label>
        <input id="adm-password" type="password" autoComplete="current-password" value={password}
          onChange={(e) => setPassword(e.target.value)} required autoFocus />
        {error && <p className="adm-error" role="alert">{error}</p>}
        <button className="adm-btn adm-btn-gold" type="submit" disabled={busy || !password}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </main>
  );
}

function Dashboard({ token, onLogout }: { token: string; onLogout: (message?: string) => void }) {
  const [tab, setTab] = useState<Tab>(() => {
    const fromUrl = window.location.hash.replace(/^#\/?/, '');
    return (['overview', 'requests', 'pricing', 'exempt', 'members', 'actions'] as string[]).includes(fromUrl) ? (fromUrl as Tab) : 'overview';
  });
  useEffect(() => {
    const hash = tab === 'overview' ? '' : `#/${tab}`;
    if (window.location.hash !== hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
  }, [tab]);
  const [requests, setRequests] = useState<UpgradeRequest[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  const call: CallFn = useCallback(async (path: string, method = 'GET', body?: unknown) => {
    try {
      return await adminApi(path, method, body, token);
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) onLogout('Session expirée. Reconnectez-vous.');
      throw err;
    }
  }, [token, onLogout]);

  const loadRequests = useCallback(async () => {
    try {
      const d = await call('/upgrade-requests');
      setRequests(d.requests);
      setPendingCount(d.pendingCount);
    } catch { /* l'onglet affichera l'erreur au rechargement */ }
  }, [call]);
  useEffect(() => {
    void loadRequests();
    const timer = setInterval(() => { void loadRequests(); }, 60000);
    return () => clearInterval(timer);
  }, [loadRequests]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Aperçu' },
    { id: 'requests', label: pendingCount > 0 ? `Demandes d’abonnement (${pendingCount})` : 'Demandes d’abonnement' },
    { id: 'pricing', label: 'Personnalisation des tarifs' },
    { id: 'exempt', label: 'Comptes exemptés' },
    { id: 'members', label: 'Membres' },
    { id: 'actions', label: 'Actions & paiements' },
  ];

  return (
    <div className="adm-shell">
      <header className="adm-header">
        <h1>Administration · Cercle Élite</h1>
        <button className="adm-btn" onClick={() => onLogout()}>Déconnexion</button>
      </header>
      <nav className="adm-tabs" aria-label="Sections">
        {tabs.map((t) => (
          <button key={t.id} className={`adm-tab${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </nav>
      <main className="adm-main">
        {tab === 'overview' && <OverviewTab call={call} />}
        {tab === 'requests' && <RequestsTab token={token} call={call} requests={requests} pendingCount={pendingCount} reload={loadRequests} />}
        {tab === 'pricing' && <PricingTab call={call} />}
        {tab === 'exempt' && <ExemptTab call={call} />}
        {tab === 'members' && <MembersTab call={call} />}
        {tab === 'actions' && <ActionsTab call={call} />}
      </main>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="adm-card adm-stat">
      <span className="adm-muted">{label}</span>
      <strong>{value}</strong>
      {hint && <small className="adm-muted">{hint}</small>}
    </div>
  );
}

function OverviewTab({ call }: { call: CallFn }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    call('/overview').then((d) => { if (alive) setStats(d.stats); }).catch((e) => { if (alive) setError(errMsg(e)); });
    return () => { alive = false; };
  }, [call]);

  if (error) return <p className="adm-error" role="alert">{error}</p>;
  if (!stats) return <p className="adm-muted">Chargement…</p>;
  const pay = stats.payments;
  return (
    <>
      <div className="adm-grid">
        <Stat label="Membres" value={stats.totalMembers} hint={stats.suspendedCount ? `${stats.suspendedCount} suspendu(s)` : undefined} />
        {TIERS.map((t) => <Stat key={t.id} label={t.label} value={stats.byTier[t.id] ?? 0} />)}
        <Stat label="Comptes exemptés" value={stats.exemptCount} />
        <Stat label="Hommes / Femmes" value={`${stats.byGender.Homme} / ${stats.byGender.Femme}`} />
        <Stat label="Rencontres" value={stats.encounters ? stats.encounters.total : '—'}
          hint={stats.encounters ? `${stats.encounters.accepted} acceptée(s), ${stats.encounters.pending} en attente` : undefined} />
        <Stat label="Messages conservés" value={stats.messages ?? '—'} />
        <Stat label="Transactions" value={pay.available ? (pay.count ?? '—') : 'Aucune table'}
          hint={pay.available && pay.total != null ? `Total : ${pay.total.toLocaleString('fr-FR')}` : undefined} />
        <Stat label="Expirent sous 7 jours" value={stats.expiringSoon.count} />
        <Stat label="Demandes en attente" value={stats.pendingRequests} />
      </div>
      {stats.expiringSoon.members.length > 0 && (
        <section className="adm-card">
          <h2>Abonnements expirant dans les 7 jours</h2>
          <div className="adm-scroll">
            <table className="adm-table">
              <thead><tr><th>Pseudonyme</th><th>E-mail</th><th>Niveau</th><th>Expire le</th></tr></thead>
              <tbody>
                {stats.expiringSoon.members.map((m) => (
                  <tr key={m.id}><td>{m.pseudonym}</td><td>{m.email}</td><td>{tierLabel(m.tier)}</td><td>{fmtDate(m.tierExpiresAt)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

const statusLabel: Record<UpgradeRequest['status'], string> = { pending: 'En attente', approved: 'Activée', rejected: 'Refusée' };
const waDigits = (phone: string) => phone.replace(/\D/g, '').replace(/^00/, '');

function RequestsTab({ token, call, requests, pendingCount, reload }: { token: string; call: CallFn; requests: UpgradeRequest[]; pendingCount: number; reload: () => Promise<void> }) {
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => { void reload(); }, [reload]);

  const act = async (r: UpgradeRequest, action: 'approve' | 'reject') => {
    const message = action === 'approve'
      ? `Activer le niveau ${tierLabel(r.requestedTier)} pour ${r.pseudonym} pendant 30 jours ?`
      : `Refuser la demande de ${r.pseudonym} (${tierLabel(r.requestedTier)}) ?`;
    if (!window.confirm(message)) return;
    setBusyId(r.id);
    setError('');
    setInfo('');
    try {
      await call(`/upgrade-requests/${r.id}/${action}`, 'POST', {});
      setInfo(action === 'approve' ? `Niveau ${tierLabel(r.requestedTier)} activé pour ${r.pseudonym}.` : 'Demande refusée.');
      await reload();
    } catch (e) {
      setError(errMsg(e));
      await reload();
    } finally {
      setBusyId('');
    }
  };

  return (
    <>
    <AdminPush token={token} call={call} />
    <section className="adm-card">
      <h2>Demandes d’abonnement · {pendingCount} en attente</h2>
      {error && <p className="adm-error" role="alert">{error}</p>}
      {info && <p className="adm-info" role="status">{info}</p>}
      {requests.length === 0 ? <p className="adm-muted">Aucune demande pour le moment.</p> : (
        <div className="adm-scroll">
          <table className="adm-table">
            <thead>
              <tr><th>Date</th><th>Membre</th><th>Niveau</th><th>Montant</th><th>Paiement</th><th>WhatsApp</th><th>Note</th><th>Statut</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDateTime(r.createdAt)}</td>
                  <td><strong>{r.pseudonym}</strong><br /><small className="adm-muted">{r.memberEmail}</small></td>
                  <td>{tierLabel(r.requestedTier)}</td>
                  <td>{fmtMoney(r.amountFcfa)} FCFA</td>
                  <td>{r.paymentMethod}</td>
                  <td>{r.whatsappPhone ? <a className="adm-link" href={`https://wa.me/${waDigits(r.whatsappPhone)}`} target="_blank" rel="noopener noreferrer">{r.whatsappPhone}</a> : '—'}</td>
                  <td style={{ maxWidth: 220, whiteSpace: 'pre-wrap' }}>{r.note || '—'}</td>
                  <td>
                    <span className={`adm-badge${r.status === 'rejected' ? ' adm-badge-red' : ''}`}>{statusLabel[r.status]}</span>
                    {r.processedAt && <><br /><small className="adm-muted">{fmtDateTime(r.processedAt)}</small></>}
                  </td>
                  <td className="adm-actions">
                    {r.status === 'pending' && <>
                      <button className="adm-btn adm-btn-gold" disabled={busyId === r.id} onClick={() => act(r, 'approve')}>Activer 30 jours</button>
                      <button className="adm-btn adm-btn-danger" disabled={busyId === r.id} onClick={() => act(r, 'reject')}>Refuser</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
    </>
  );
}

function PricingTab({ call }: { call: CallFn }) {
  const keys = ['confirme', 'vip', 'elite'] as const;
  const [values, setValues] = useState<Record<(typeof keys)[number], string>>({ confirme: '', vip: '', elite: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/pricing')
      .then((response) => response.json())
      .then((d) => {
        if (!alive || !d.pricing) return;
        setValues({ confirme: String(d.pricing.confirme), vip: String(d.pricing.vip), elite: String(d.pricing.elite) });
      })
      .catch(() => { if (alive) setError('Impossible de charger les tarifs actuels.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setInfo('');
    const body: Record<string, number> = {};
    for (const key of keys) {
      const n = Number(values[key]);
      if (values[key].trim() === '' || !Number.isInteger(n) || n < 0 || n > 10000000) {
        setError(`Tarif invalide pour ${tierLabel(key)} : entier entre 0 et 10 000 000 FCFA.`);
        return;
      }
      body[key] = n;
    }
    setBusy(true);
    try {
      const d = await call('/pricing', 'PUT', body);
      setValues({ confirme: String(d.pricing.confirme), vip: String(d.pricing.vip), elite: String(d.pricing.elite) });
      setInfo('Tarifs enregistrés. Ils s’affichent immédiatement sur le site.');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="adm-card">
      <h2>Personnalisation des tarifs</h2>
      <p className="adm-muted">Montants en FCFA par mois. Le niveau Standard reste gratuit.</p>
      {loading ? <p className="adm-muted">Chargement…</p> : (
        <form className="adm-form" onSubmit={save}>
          {keys.map((key) => (
            <div className="adm-field" key={key}>
              <label htmlFor={`price-${key}`}>{tierLabel(key)} (FCFA / mois)</label>
              <input id={`price-${key}`} type="number" inputMode="numeric" min={0} max={10000000} step={100}
                value={values[key]} onChange={(e) => setValues((current) => ({ ...current, [key]: e.target.value }))} required />
            </div>
          ))}
          {error && <p className="adm-error" role="alert">{error}</p>}
          {info && <p className="adm-info" role="status">{info}</p>}
          <button className="adm-btn adm-btn-gold" type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer les tarifs'}</button>
        </form>
      )}
    </section>
  );
}

const emptyForm = { email: '', password: '', pseudonym: '', birth_date: '', city: '', gender: 'Femme', sought: 'Homme', tier: 'standard' as TierId };

function ExemptTab({ call }: { call: CallFn }) {
  const [mode, setMode] = useState<'create' | 'existing'>('create');
  const [form, setForm] = useState(emptyForm);
  const [existingEmail, setExistingEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [list, setList] = useState<AdminMember[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await call('/members?exempt=true&limit=200');
      setList(d.members);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [call]);
  useEffect(() => { void load(); }, [load]);

  const set = (key: keyof typeof emptyForm, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const maxBirth = new Date(Date.now() - 18 * 365.25 * 86400000).toISOString().slice(0, 10);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'create') {
        const d = await call('/exempt-accounts', 'POST', { mode: 'create', ...form });
        setInfo(`Compte exempté créé : ${d.member.email}`);
        setForm(emptyForm);
      } else {
        const d = await call('/exempt-accounts', 'POST', { mode: 'existing', email: existingEmail });
        setInfo(`${d.member.email} est maintenant exempté.`);
        setExistingEmail('');
      }
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (m: AdminMember) => {
    if (!window.confirm(`Retirer l’exemption de ${m.pseudonym} ? Le compte repassera au niveau Standard.`)) return;
    setError('');
    setInfo('');
    try {
      await call(`/members/${m.id}`, 'PATCH', { is_exempt: false });
      setInfo(`Exemption retirée pour ${m.email}.`);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <>
      <section className="adm-card">
        <h2>Ajouter un compte exempté</h2>
        <p className="adm-muted">Accès à tous les niveaux, sans paiement ni expiration.</p>
        <div className="adm-seg" role="tablist">
          <button type="button" className={`adm-tab${mode === 'create' ? ' is-active' : ''}`} onClick={() => setMode('create')}>Créer un compte</button>
          <button type="button" className={`adm-tab${mode === 'existing' ? ' is-active' : ''}`} onClick={() => setMode('existing')}>Exempter un membre existant</button>
        </div>
        <form className="adm-form" onSubmit={submit}>
          {mode === 'existing' ? (
            <div className="adm-field">
              <label htmlFor="ex-email">E-mail du membre</label>
              <input id="ex-email" type="email" value={existingEmail} onChange={(e) => setExistingEmail(e.target.value)} required />
            </div>
          ) : (
            <>
              <div className="adm-field"><label htmlFor="cr-email">E-mail</label><input id="cr-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required /></div>
              <div className="adm-field"><label htmlFor="cr-pass">Mot de passe (8 caractères min.)</label><input id="cr-pass" type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={(e) => set('password', e.target.value)} required /></div>
              <div className="adm-field"><label htmlFor="cr-pseudo">Pseudonyme</label><input id="cr-pseudo" value={form.pseudonym} onChange={(e) => set('pseudonym', e.target.value)} maxLength={40} required /></div>
              <div className="adm-field"><label htmlFor="cr-birth">Date de naissance (18 ans min.)</label><input id="cr-birth" type="date" max={maxBirth} value={form.birth_date} onChange={(e) => set('birth_date', e.target.value)} required /></div>
              <div className="adm-field"><label htmlFor="cr-city">Ville</label><input id="cr-city" value={form.city} onChange={(e) => set('city', e.target.value)} maxLength={60} required /></div>
              <div className="adm-field"><label htmlFor="cr-gender">Genre</label>
                <select id="cr-gender" value={form.gender} onChange={(e) => set('gender', e.target.value)}><option>Femme</option><option>Homme</option></select></div>
              <div className="adm-field"><label htmlFor="cr-sought">Recherche</label>
                <select id="cr-sought" value={form.sought} onChange={(e) => set('sought', e.target.value)}><option>Homme</option><option>Femme</option></select></div>
              <div className="adm-field"><label htmlFor="cr-tier">Niveau affiché</label>
                <select id="cr-tier" value={form.tier} onChange={(e) => set('tier', e.target.value)}>{TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
            </>
          )}
          {error && <p className="adm-error" role="alert">{error}</p>}
          {info && <p className="adm-info" role="status">{info}</p>}
          <button className="adm-btn adm-btn-gold" type="submit" disabled={busy}>
            {busy ? 'Enregistrement…' : mode === 'create' ? 'Créer le compte exempté' : 'Exempter ce membre'}
          </button>
        </form>
      </section>

      <section className="adm-card">
        <h2>Comptes actuellement exemptés ({list.length})</h2>
        {loading ? <p className="adm-muted">Chargement…</p> : list.length === 0 ? <p className="adm-muted">Aucun compte exempté.</p> : (
          <div className="adm-scroll">
            <table className="adm-table">
              <thead><tr><th>Pseudonyme</th><th>E-mail</th><th>Niveau affiché</th><th>Créé le</th><th /></tr></thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id}>
                    <td>{m.pseudonym} <span className="adm-badge">Exempté</span></td><td>{m.email}</td><td>{tierLabel(m.tier)}</td><td>{fmtDate(m.createdAt)}</td>
                    <td><button className="adm-btn adm-btn-danger" onClick={() => revoke(m)}>Révoquer</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function MembersTab({ call }: { call: CallFn }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState('');
  const [exempt, setExempt] = useState('');
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: '100' });
    if (query) params.set('search', query);
    if (tier) params.set('tier', tier);
    if (exempt) params.set('exempt', exempt);
    try {
      const d = await call(`/members?${params.toString()}`);
      setMembers(d.members);
      setTotal(d.total);
      setError('');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [call, query, tier, exempt]);
  useEffect(() => { void load(); }, [load]);

  const patch = async (m: AdminMember, body: Record<string, unknown>) => {
    setError('');
    try {
      const d = await call(`/members/${m.id}`, 'PATCH', body);
      setMembers((current) => current.map((x) => (x.id === m.id ? d.member : x)));
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const remove = async (m: AdminMember) => {
    if (!window.confirm(`Supprimer définitivement le compte « ${m.pseudonym} » (${m.email}) ? Ses messages et demandes de rencontre seront supprimés.`)) return;
    setError('');
    try {
      await call(`/members/${m.id}`, 'DELETE');
      setMembers((current) => current.filter((x) => x.id !== m.id));
      setTotal((n) => Math.max(0, n - 1));
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <section className="adm-card">
      <h2>Membres ({total})</h2>
      <div className="adm-filters">
        <input type="search" placeholder="Rechercher : pseudonyme, e-mail, ville" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Recherche" />
        <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Filtrer par niveau">
          <option value="">Tous les niveaux</option>
          {TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <select value={exempt} onChange={(e) => setExempt(e.target.value)} aria-label="Filtrer par statut">
          <option value="">Tous les statuts</option>
          <option value="true">Exemptés</option>
          <option value="false">Non exemptés</option>
        </select>
      </div>
      {error && <p className="adm-error" role="alert">{error}</p>}
      {loading ? <p className="adm-muted">Chargement…</p> : members.length === 0 ? <p className="adm-muted">Aucun membre trouvé.</p> : (
        <div className="adm-scroll">
          <table className="adm-table">
            <thead><tr><th>Membre</th><th>Niveau</th><th>Expiration</th><th>Actions</th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className={m.isSuspended ? 'is-suspended' : ''}>
                  <td>
                    <strong>{m.pseudonym}</strong> {m.isExempt && <span className="adm-badge">Exempté</span>} {m.isSuspended && <span className="adm-badge adm-badge-red">Suspendu</span>}
                    <br /><small className="adm-muted">{m.email} · {m.city || '—'} · inscrit le {fmtDate(m.createdAt)}</small>
                  </td>
                  <td>
                    <select value={m.tier} onChange={(e) => patch(m, { tier: e.target.value })} aria-label={`Niveau de ${m.pseudonym}`}>
                      {TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </td>
                  <td>{m.isExempt ? 'Jamais' : m.tier === 'standard' ? '—' : fmtDate(m.tierExpiresAt)}</td>
                  <td className="adm-actions">
                    <button className="adm-btn" disabled={m.isExempt || m.tier === 'standard'} onClick={() => patch(m, { extendDays: 30 })}>+30j</button>
                    <button className="adm-btn" onClick={() => patch(m, { is_exempt: !m.isExempt })}>{m.isExempt ? 'Retirer l’exemption' : 'Exempter'}</button>
                    <button className="adm-btn" onClick={() => patch(m, { is_suspended: !m.isSuspended })}>{m.isSuspended ? 'Réactiver' : 'Suspendre'}</button>
                    <button className="adm-btn adm-btn-danger" onClick={() => remove(m)}>Supprimer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ActionsTab({ call }: { call: CallFn }) {
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [payments, setPayments] = useState<{ available: boolean; table?: string; transactions: Record<string, unknown>[] } | null>(null);

  const loadPending = useCallback(async () => {
    try {
      const d = await call('/overview');
      setPending(d.stats.expiredPending);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [call]);

  useEffect(() => {
    void loadPending();
    call('/payments').then((d) => setPayments(d)).catch((e) => setError(errMsg(e)));
  }, [call, loadPending]);

  const run = async () => {
    if (!window.confirm('Repasser au niveau Standard tous les membres non exemptés dont l’abonnement est expiré ?')) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const d = await call('/maintenance/expire-tiers', 'POST', {});
      setInfo(`${d.downgraded} abonnement(s) expiré(s) repassé(s) au niveau Standard.`);
      await loadPending();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const columns = payments && payments.transactions.length ? Object.keys(payments.transactions[0]) : [];
  const show = (value: unknown) => (value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value));

  return (
    <>
      <section className="adm-card">
        <h2>Abonnements expirés</h2>
        <p className="adm-muted">
          Membres non exemptés dont l’abonnement est échu et non encore traité : <strong>{pending ?? '…'}</strong>. Les comptes exemptés ne sont jamais rétrogradés.
        </p>
        {error && <p className="adm-error" role="alert">{error}</p>}
        {info && <p className="adm-info" role="status">{info}</p>}
        <button className="adm-btn adm-btn-gold" onClick={run} disabled={busy}>{busy ? 'Nettoyage…' : 'Nettoyer les abonnements expirés'}</button>
      </section>
      <section className="adm-card">
        <h2>Transactions récentes</h2>
        {!payments ? <p className="adm-muted">Chargement…</p> : !payments.available ? (
          <p className="adm-muted">Aucune table de paiements dans la base de données.</p>
        ) : payments.transactions.length === 0 ? <p className="adm-muted">Aucune transaction.</p> : (
          <div className="adm-scroll">
            <table className="adm-table">
              <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>{payments.transactions.map((row, i) => <tr key={i}>{columns.map((c) => <td key={c}>{show(row[c])}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export default Admin;
