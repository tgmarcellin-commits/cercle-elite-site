import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Check, ChevronRight, LockKeyhole, Moon, ShieldCheck, Sparkles, Sun, X } from 'lucide-react';

type TierId = 'standard' | 'confirme' | 'vip' | 'elite';
type Profile = {
  id: string;
  name: string;
  age: number;
  city: string;
  gender: 'Homme' | 'Femme';
  sought: 'Homme' | 'Femme';
  tier: TierId;
  photo: string;
  bio: string;
  isMember?: boolean;
};
type Member = { email: string; pseudonym: string; gender: 'Homme' | 'Femme'; sought: 'Homme' | 'Femme'; city: string; photo: string; bio: string };
type Tier = { id: TierId; name: string; audience: string; price: number; note: string };

const tiers: Tier[] = [
  { id: 'standard', name: 'Standard', audience: 'Découverte', price: 7500, note: 'Une première rencontre avec le cercle.' },
  { id: 'confirme', name: 'Confirmé', audience: 'Professionnels', price: 15000, note: 'Des parcours établis, des intentions claires.' },
  { id: 'vip', name: 'VIP', audience: 'Cadres & Entrepreneurs', price: 25000, note: 'Des profils sélectionnés avec soin.' },
  { id: 'elite', name: 'Élite', audience: 'Prestige', price: 40000, note: 'Le cercle le plus confidentiel.' },
];

const FALLBACK_PHOTO = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80';
// Convertit une ligne de la base (API) en profil affichable
const mapMember = (m: any): Profile => ({
  id: String(m.id),
  name: m.name || m.pseudonym || 'Membre',
  age: m.age || 30,
  city: m.city || 'Lomé',
  gender: m.gender || 'Femme',
  sought: m.sought || 'Homme',
  tier: m.tier || 'standard',
  photo: m.photo || FALLBACK_PHOTO,
  bio: m.bio || 'Membre du Cercle Élite.',
  isMember: true,
});

const starterProfiles: Profile[] = [
  { id: 'a1', name: 'Amina', age: 31, city: 'Lomé', gender: 'Femme', sought: 'Homme', tier: 'standard', photo: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80', bio: 'Attachée aux conversations sincères et aux horizons ouverts.' },
  { id: 'k1', name: 'Kwame', age: 35, city: 'Lomé', gender: 'Homme', sought: 'Femme', tier: 'standard', photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=80', bio: 'Entrepreneur, amateur de jazz et de belles idées.' },
];

function loadLocal<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Fallback if storage fails
  }
}
function money(value: number) {
  return new Intl.NumberFormat('fr-FR').format(value);
}

function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const savedTheme = loadLocal<'dark' | 'light'>('cercle-theme', 'dark');
    return savedTheme === 'light' ? 'light' : 'dark';
  });
  const [member, setMember] = useState<Member | null>(() => loadLocal<Member | null>('cercle-member', null));
  const [profiles, setProfiles] = useState<Profile[]>(starterProfiles);
  const [unlocked, setUnlocked] = useState<TierId[]>(() => loadLocal<TierId[]>('cercle-unlocked', []));
  const [matches, setMatches] = useState<string[]>(() => loadLocal<string[]>('cercle-matches', []));
  const [tierId, setTierId] = useState<TierId>('standard');
  const [modal, setModal] = useState<'register' | 'unlock' | null>(null);
  const [registerStep, setRegisterStep] = useState(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [demoCodeSent, setDemoCodeSent] = useState(false);
  const [pseudonym, setPseudonym] = useState('');
  const [gender, setGender] = useState<'Homme' | 'Femme'>('Femme');
  const [sought, setSought] = useState<'Homme' | 'Femme'>('Homme');
  const [city, setCity] = useState('Lomé');
  const [bio, setBio] = useState('');
  const [photo, setPhoto] = useState('');
  const [error, setError] = useState('');
  const [pendingTier, setPendingTier] = useState<TierId>('standard');
  const [paymentDone, setPaymentDone] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const activeTier = tiers.find((tier) => tier.id === tierId) ?? tiers[0];
  const selectedTier = tiers.find((tier) => tier.id === pendingTier) ?? tiers[0];
  const visibleProfiles = useMemo(() => profiles.filter((profile) => profile.tier === tierId), [profiles, tierId]);

  // Chargement dynamique des membres depuis l'API Neon / Vercel
  useEffect(() => {
    let cancelled = false;
    fetch('/api/members')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        // Base vide : on garde les profils de démonstration
        if (!cancelled && data.success && Array.isArray(data.members) && data.members.length > 0) {
          setProfiles(data.members.map(mapMember));
        }
      })
      .catch((err) => console.error('Erreur lors du chargement des membres :', err))
      .finally(() => { if (!cancelled) setLoadingMembers(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    saveLocal('cercle-theme', theme);
  }, [theme]);
  useEffect(() => saveLocal('cercle-member', member), [member]);
  useEffect(() => saveLocal('cercle-unlocked', unlocked), [unlocked]);
  useEffect(() => saveLocal('cercle-matches', matches), [matches]);

  const openRegister = () => {
    setError('');
    setModal('register');
    setRegisterStep(1);
  };
  const requestUnlock = (id: TierId) => {
    setPendingTier(id);
    setPaymentDone(false);
    setModal('unlock');
  };
  const sendCode = (event: FormEvent) => {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Saisissez une adresse e-mail valide pour continuer.');
      return;
    }
    setError('');
    setDemoCodeSent(true);
  };
  const verifyCode = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim() !== '482731') {
      setError('Le code ne correspond pas. Utilisez le code de démonstration affiché.');
      return;
    }
    setError('');
    setRegisterStep(2);
  };
  const proceedProfile = (event: FormEvent) => {
    event.preventDefault();
    if (pseudonym.trim().length < 2) {
      setError('Choisissez un pseudonyme de deux caractères minimum.');
      return;
    }
    if (city.trim().length < 2) {
      setError('Indiquez votre ville, par exemple Lomé ou Aného.');
      return;
    }
    setError('');
    setRegisterStep(3);
  };
  const photoSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choisissez un fichier image.');
      return;
    }
    if (file.size > 1800000) {
      setError('La photo doit faire moins de 1,8 Mo.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhoto(String(reader.result ?? ''));
    reader.onerror = () => setError('La photo n’a pas pu être lue.');
    reader.readAsDataURL(file);
  };
  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!photo) {
      setError('Ajoutez une photo de profil pour terminer votre inscription.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: pseudonym.trim(),
          email: email.trim(),
          gender,
          sought,
          city: city.trim(),
          bio: bio.trim(),
          photo,
          tier: 'standard',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'L’inscription a échoué. Réessayez dans un instant.');
      }
      const profileMember: Member = { email: email.trim(), pseudonym: pseudonym.trim(), gender, sought, city: city.trim(), photo, bio: bio.trim() };
      setMember(profileMember);
      setProfiles((current) => [mapMember(data.member), ...current.filter((p) => !p.isMember || p.id !== String(data.member.id))]);
      setTierId('standard');
      setModal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau. Vérifiez votre connexion.');
    } finally {
      setSaving(false);
    }
  };
  const finishUnlock = () => {
    setUnlocked((current) => current.includes(pendingTier) ? current : [...current, pendingTier]);
    setPaymentDone(true);
  };
  const toggleMatch = (id: string) => {
    if (!member) {
      openRegister();
      return;
    }
    setMatches((current) => current.includes(id) ? current : [...current, id]);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#accueil" aria-label="Cercle Élite, accueil">
          <span className="brand-mark">C</span><span className="brand-name">CERCLE ÉLITE<span className="brand-caption">Rencontres avec intention</span></span>
        </a>
        <nav className="top-actions" aria-label="Navigation principale">
          <button
            className="theme-toggle"
            type="button"
            onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
            aria-label={`Thème actuel : ${theme === 'dark' ? 'sombre' : 'clair'}.`}
            title={`Passer au mode ${theme === 'dark' ? 'clair' : 'sombre'}`}
          >
            {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            <span className="theme-toggle-label">{theme === 'dark' ? 'Clair' : 'Sombre'}</span>
          </button>
          <button className="text-button" onClick={() => document.getElementById('catalogue')?.scrollIntoView({ behavior: 'smooth' })}>Le catalogue</button>
          {member ? <span className="member-badge">MEMBRE · {member.pseudonym.toUpperCase()}</span> : <button className="text-button" onClick={openRegister}>Connexion</button>}
          {member ? <div className="profile-ready"><img src={member.photo} alt="" /> Profil complet</div> : <button className="gold-button" onClick={openRegister}>Créer mon profil</button>}
        </nav>
      </header>

      <main id="accueil">
        <section className="hero">
          <div>
            <div className="eyebrow">Afrique · Europe · Au-delà</div>
            <h1>Les belles histoires<br />commencent <em>en cercle.</em></h1>
            <p className="hero-copy">Un espace privé pour celles et ceux qui souhaitent construire une relation sincère. Découvrez des profils vérifiés, à votre rythme et selon vos affinités.</p>
            <div className="hero-cta">
              <button className="gold-button" onClick={() => member ? document.getElementById('catalogue')?.scrollIntoView({ behavior: 'smooth' }) : openRegister()}>{member ? 'Découvrir le cercle' : 'Rejoindre le cercle'} <ChevronRight size={15} style={{ verticalAlign: 'middle', marginLeft: 7 }} /></button>
              <button className="outline-button" onClick={() => document.getElementById('catalogue')?.scrollIntoView({ behavior: 'smooth' })}>Explorer les profils</button>
            </div>
          </div>
          <aside className="hero-aside" aria-label="Le cercle en chiffres">
            <div className="ornament" aria-hidden="true" />
            <div><div className="aside-number">{profiles.length.toString().padStart(2, '0')}</div><div className="aside-label">profils dans le cercle aujourd’hui</div></div>
            <div><div className="eyebrow">Un espace choisi</div><p className="aside-label">Des échanges respectueux, des intentions assumées.</p></div>
          </aside>
        </section>

        <section className="section" id="catalogue">
          <div className="section-heading">
            <div><div className="eyebrow">Le catalogue privé</div><h2>Une rencontre à votre mesure.</h2></div>
            <p>Choisissez le niveau qui vous ressemble. Les portraits se dévoilent au sein d’un cercle pensé pour la confiance.</p>
          </div>
          <div className="tier-tabs" role="tablist" aria-label="Niveaux de membres">
            {tiers.map((tier) => {
              const count = profiles.filter((profile) => profile.tier === tier.id).length;
              return <button key={tier.id} role="tab" aria-selected={tierId === tier.id} className={`tier-tab ${tierId === tier.id ? 'active' : ''}`} onClick={() => setTierId(tier.id)}>
                {tier.name}<span>{count.toString().padStart(2, '0')}</span>{unlocked.includes(tier.id) && <span aria-label="Débloqué">✓</span>}
              </button>;
            })}
          </div>
          <div className="catalogue-bar">
            <div><strong>{activeTier.name}</strong><small> · {activeTier.audience}</small></div>
            <small>{visibleProfiles.length} {visibleProfiles.length > 1 ? 'profils' : 'profil'} dans ce niveau</small>
          </div>
          <div className="profile-grid">
            {loadingMembers ? <p role="status" aria-live="polite">Chargement des profils…</p> : visibleProfiles.length ? visibleProfiles.map((profile) => {
              const locked = !unlocked.includes(profile.tier);
              const requested = matches.includes(profile.id);
              return <article className={`profile-card ${locked ? 'locked' : ''}`} key={profile.id}>
                <div className="profile-photo-wrap">
                  <img className="profile-photo" src={profile.photo} alt={locked ? 'Portrait confidentiel' : `Portrait de ${profile.name}`} />
                  <span className="verified"><ShieldCheck size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Vérifié</span>
                  {locked && <div className="lock-overlay"><span className="lock-glyph"><LockKeyhole size={17} /></span><span>PORTRAIT CONFIDENTIEL</span></div>}
                </div>
                <div className="profile-info">
                  <div className="profile-name">{locked ? 'Profil privé' : profile.name}<span>{profile.age} ans</span></div>
                  <div className="profile-meta">{profile.city} · {profile.gender}</div>
                  <div className="profile-bio">{locked ? 'Débloquez ce niveau pour découvrir ce profil et ses intentions.' : profile.bio}</div>
                  {locked
                    ? <button className="gold-button locked-action" onClick={() => requestUnlock(profile.tier)}>Débloquer ce niveau via CinetPay</button>
                    : <button className={`match-button ${requested ? 'sent' : ''}`} onClick={() => toggleMatch(profile.id)} disabled={requested}>{requested ? 'Demande envoyée' : 'Proposer une rencontre'}</button>}
                </div>
              </article>;
            }) : <div className="empty-card"><strong>Le cercle s’agrandit.</strong>Il n’y a pas encore de profil dans ce niveau. Revenez bientôt ou créez le vôtre.</div>}
          </div>
        </section>
      </main>
      <footer className="footer"><span>CERCLE ÉLITE · LOMÉ, TOGO</span><span>Application en ligne · 2026</span></footer>

      {modal === 'register' && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="register-title">
          <button className="modal-close" onClick={() => setModal(null)} aria-label="Fermer"><X size={18} /></button>
          <div className="modal-kicker">Votre espace, en trois étapes</div>
          <h2 id="register-title">{registerStep === 1 ? 'Commençons par vous.' : registerStep === 2 ? 'Quelques repères.' : 'Votre profil prend forme.'}</h2>
          <div className="stepper" aria-label={`Étape ${registerStep} sur 3`}>{[1, 2, 3].map((step) => <span key={step} className={`step-dot ${registerStep >= step ? 'active' : ''}`} />)}</div>
          {registerStep === 1 && <form onSubmit={demoCodeSent ? verifyCode : sendCode} noValidate>
            <p className="modal-subtitle">Votre profil est gratuit. Nous simulons l’envoi d’un code de vérification.</p>
            <div className="form-field"><label htmlFor="email">Adresse e-mail</label><input id="email" type="email" autoComplete="email" placeholder="vous@exemple.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
            {demoCodeSent && <><div className="payment-note">Code de démonstration : <span className="otp-code">482731</span><br />Saisissez-le ci-dessous pour continuer.</div><div className="form-field"><label htmlFor="otp">Code à six chiffres</label><input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required /></div></>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions"><span className="modal-subtitle" style={{ margin: 0 }}>Création gratuite.</span><button className="gold-button" type="submit">{demoCodeSent ? 'Vérifier le code' : 'Recevoir mon code'}</button></div>
          </form>}
          {registerStep === 2 && <form onSubmit={proceedProfile} noValidate>
            <p className="modal-subtitle">Quelques détails pour proposer des rencontres qui vous ressemblent.</p>
            <div className="form-field"><label htmlFor="pseudonym">Pseudonyme</label><input id="pseudonym" value={pseudonym} onChange={(event) => setPseudonym(event.target.value)} placeholder="Ex. Afi" required maxLength={28} /></div>
            <div className="form-row">
              <div className="form-field"><label htmlFor="gender">Je suis</label><select id="gender" value={gender} onChange={(event) => setGender(event.target.value as 'Homme' | 'Femme')}><option>Femme</option><option>Homme</option></select></div>
              <div className="form-field"><label htmlFor="sought">Je recherche</label><select id="sought" value={sought} onChange={(event) => setSought(event.target.value as 'Homme' | 'Femme')}><option>Homme</option><option>Femme</option></select></div>
            </div>
            <div className="form-field"><label htmlFor="city">Ma ville</label><input id="city" list="city-options" value={city} onChange={(event) => setCity(event.target.value)} placeholder="Lomé ou Aného" required /><datalist id="city-options"><option value="Lomé" /><option value="Aného" /><option value="Kpalimé" /><option value="Accra" /></datalist></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions"><button type="button" className="text-button" onClick={() => { setRegisterStep(1); setError(''); }}>Retour</button><button className="gold-button" type="submit">Continuer</button></div>
          </form>}
          {registerStep === 3 && <form onSubmit={saveProfile} noValidate>
            <p className="modal-subtitle">Une photo et quelques mots pour votre profil.</p>
            <label className="photo-picker" htmlFor="profile-photo">
              {photo ? <img className="photo-preview" src={photo} alt="Aperçu de votre photo" /> : <span className="photo-preview" aria-hidden="true" style={{ display: 'grid', placeItems: 'center', border: '1px solid #536074', color: '#d4af37' }}><Sparkles size={19} /></span>}
              <span>{photo ? 'Changer la photo' : 'Ajouter une photo de profil'}<br /><small>JPG ou PNG · 1,8 Mo maximum</small></span>
            </label>
            <input id="profile-photo" className="visually-hidden" type="file" accept="image/*" onChange={photoSelected} />
            <div className="form-field"><label htmlFor="bio">Ce que vous souhaitez partager</label><textarea id="bio" value={bio} onChange={(event) => setBio(event.target.value)} placeholder="Vos centres d’intérêt..." maxLength={260} /><small style={{ color: '#7f8a99' }}>{bio.length}/260 caractères</small></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions"><button type="button" className="text-button" onClick={() => { setRegisterStep(2); setError(''); }}>Retour</button><button className="gold-button" type="submit" disabled={saving}>{saving ? 'Création…' : 'Créer mon profil'}</button></div>
          </form>}
        </section>
      </div>}

      {modal === 'unlock' && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
          <button className="modal-close" onClick={() => setModal(null)} aria-label="Fermer"><X size={18} /></button>
          {paymentDone ? <>
            <div className="success-mark"><Check size={25} /></div><div className="modal-kicker">Accès activé</div><h2 id="unlock-title">Le cercle s’ouvre à vous.</h2>
            <p className="modal-subtitle">Le niveau {selectedTier.name} est maintenant débloqué sur cet appareil.</p>
            <div className="payment-note">Simulation terminée : aucun paiement réel n’a été effectué.</div>
            <div className="modal-actions"><span /><button className="gold-button" onClick={() => setModal(null)}>Découvrir les profils</button></div>
          </> : <>
            <div className="modal-kicker">Accès mensuel · simulation</div><h2 id="unlock-title">Débloquer {selectedTier.name}.</h2>
            <p className="modal-subtitle">{selectedTier.note} Confirmez pour révéler les profils de ce niveau.</p>
            <div className="price-line"><strong>{money(selectedTier.price)}</strong><span>FCFA / mois · prix illustratif</span></div>
            <div className="payment-note">Cette démonstration reproduit un parcours CinetPay.</div>
            <div className="modal-actions"><button className="text-button" onClick={() => setModal(null)}>Annuler</button><button className="gold-button" onClick={finishUnlock}>Confirmer l’accès simulé</button></div>
          </>}
        </section>
      </div>}
    </div>
  );
}

export default App;