import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Check, ChevronRight, Eye, EyeOff, LockKeyhole, Moon, ShieldCheck, Sparkles, Sun, X } from 'lucide-react';
import Chat from './Chat';
import { LegalConsentRecap, LegalGate, LegalViewer, type LegalDoc } from './legal';
import './extras.css';

type TierId = 'standard' | 'confirme' | 'vip' | 'elite';
type Lang = 'fr' | 'en';
type Profile = {
  id: string;
  name: string;
  age: number;
  birth_date?: string;
  city: string;
  gender: 'Homme' | 'Femme';
  sought: 'Homme' | 'Femme';
  tier: TierId;
  photo: string;
  bio: string;
  isMember?: boolean;
};
type Member = {
  id: string;
  email: string;
  pseudonym: string;
  age?: number;
  birth_date?: string;
  gender: 'Homme' | 'Femme';
  sought: 'Homme' | 'Femme';
  city: string;
  photo: string;
  bio: string;
  tier: TierId;
  tierExpiresAt: string | null;
};
type EncounterInfo = {
  id: string;
  peerId: string;
  direction: 'outgoing' | 'incoming';
  status: 'pending' | 'accepted' | 'declined';
  mySentMessages: number;
};
type Tier = { id: TierId; name: string; audience: string; price: number; note: string };

const tiers: Tier[] = [
  { id: 'standard', name: 'Standard', audience: 'Découverte', price: 0, note: 'Une première rencontre avec le cercle.' },
  { id: 'confirme', name: 'Confirmé', audience: 'Professionnels', price: 7000, note: 'Des parcours établis, des intentions claires.' },
  { id: 'vip', name: 'VIP', audience: 'Cadres & Entrepreneurs', price: 15000, note: 'Des profils sélectionnés avec soin.' },
  { id: 'elite', name: 'Élite', audience: 'Prestige', price: 25000, note: 'Le cercle le plus confidentiel.' },
];

const dict = {
  fr: {
    brandCaption: 'Rencontres avec intention',
    catalogue: 'Le catalogue',
    login: 'Connexion',
    createProfile: 'Créer mon profil',
    logout: 'Se déconnecter',
    eyebrow: 'Afrique · Europe · Au-delà',
    heroTitle1: 'Les belles histoires',
    heroTitle2: 'commencent ',
    heroTitleEm: 'en cercle.',
    heroCopy: 'Un espace privé pour celles et ceux qui souhaitent construire une relation sincère. Découvrez des profils vérifiés, à votre rythme et selon vos affinités.',
    discoverCircle: 'Découvrir le cercle',
    joinCircle: 'Rejoindre le cercle',
    exploreProfiles: 'Explorer les profils',
    profilesToday: 'profils dans le cercle aujourd’hui',
    chosenSpace: 'Un espace choisi',
    chosenSpaceCopy: 'Des échanges respectueux, des intentions assumées.',
    privateCatalogue: 'Le catalogue privé',
    measureEncounter: 'Une rencontre à votre mesure.',
    catalogueCopy: 'Choisissez le niveau qui vous ressemble. Les portraits se dévoilent au sein d’un cercle pensé pour la confiance.',
    loadingProfiles: 'Chargement des profils…',
    verified: 'Vérifié',
    confidentialPortrait: 'PORTRAIT CONFIDENTIEL',
    privateProfile: 'Profil privé',
    unlockBio: 'Débloquez ce niveau pour découvrir ce profil et ses intentions.',
    unlockBtn: 'Débloquer ce niveau via CinetPay',
    requestSent: 'Demande envoyée',
    requestAccepted: 'Demande acceptée',
    acceptRequest: 'Accepter la demande',
    proposeEncounter: 'Proposer une rencontre',
    emptyCircleTitle: 'Le cercle s’agrandit.',
    emptyCircleCopy: 'Il n’y a pas encore de profil dans ce niveau. Revenez bientôt ou créez le vôtre.',
    mySpace: 'Mon espace',
    editProfileTitle: 'Modifier mon profil.',
    changePhoto: 'Changer la photo',
    photoHint: 'JPG ou PNG · 1,8 Mo maximum',
    pseudonymLabel: 'Pseudonyme',
    birthDateLabel: 'Date de naissance',
    shareLabel: 'Ce que vous souhaitez partager',
    cancel: 'Annuler',
    save: 'Enregistrer',
    saving: 'Enregistrement…',
    memberSpace: 'Espace membre',
    welcomeBack: 'Bon retour parmi nous.',
    lastCheck: 'Dernière vérification.',
    emailLabel: 'Adresse e-mail',
    passwordLabel: 'Mot de passe',
    signIn: 'Se connecter',
    verifying: 'Vérification…',
    yearsOld: 'ans',
    messages: 'Messages',
    chatBtn: 'Discuter',
    chatFirstMsgBtn: 'Discuter (1 message)',
    chatPendingHint: '1er message envoyé · En attente d’acceptation',
    myMessages: 'Mes conversations',
  },
  en: {
    brandCaption: 'Intentional dating',
    catalogue: 'Catalogue',
    login: 'Sign in',
    createProfile: 'Create profile',
    logout: 'Log out',
    eyebrow: 'Africa · Europe · Beyond',
    heroTitle1: 'Great stories',
    heroTitle2: 'begin ',
    heroTitleEm: 'in the circle.',
    heroCopy: 'A private space for those seeking a sincere relationship. Discover verified profiles at your own pace and according to your affinities.',
    discoverCircle: 'Discover the circle',
    joinCircle: 'Join the circle',
    exploreProfiles: 'Explore profiles',
    profilesToday: 'profiles in the circle today',
    chosenSpace: 'A curated space',
    chosenSpaceCopy: 'Respectful exchanges, clear intentions.',
    privateCatalogue: 'Private catalogue',
    measureEncounter: 'An encounter tailored to you.',
    catalogueCopy: 'Choose the tier that reflects you. Portraits are revealed within a circle designed for trust.',
    loadingProfiles: 'Loading profiles…',
    verified: 'Verified',
    confidentialPortrait: 'CONFIDENTIAL PORTRAIT',
    privateProfile: 'Private profile',
    unlockBio: 'Unlock this tier to discover this profile and their intentions.',
    unlockBtn: 'Unlock this tier via CinetPay',
    requestSent: 'Request sent',
    requestAccepted: 'Request accepted',
    acceptRequest: 'Accept request',
    proposeEncounter: 'Propose an encounter',
    emptyCircleTitle: 'The circle is growing.',
    emptyCircleCopy: 'There are no profiles in this tier yet. Check back soon or create yours.',
    mySpace: 'My space',
    editProfileTitle: 'Edit my profile.',
    changePhoto: 'Change photo',
    photoHint: 'JPG or PNG · 1.8 MB max',
    pseudonymLabel: 'Pseudonym',
    birthDateLabel: 'Date of birth',
    shareLabel: 'What you wish to share',
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving…',
    memberSpace: 'Member space',
    welcomeBack: 'Welcome back.',
    lastCheck: 'Final verification.',
    emailLabel: 'Email address',
    passwordLabel: 'Password',
    signIn: 'Sign in',
    verifying: 'Verifying…',
    yearsOld: 'y/o',
    messages: 'Messages',
    chatBtn: 'Chat',
    chatFirstMsgBtn: 'Chat (1 message)',
    chatPendingHint: 'First message sent · Awaiting acceptance',
    myMessages: 'My conversations',
  }
};

function calculateAge(birthDateStr?: string): number | null {
  if (!birthDateStr) return null;
  const dob = new Date(birthDateStr);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

const FALLBACK_PHOTO = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80';
const mapMember = (m: any): Profile => {
  const computedAge = m.birth_date ? calculateAge(m.birth_date) : null;
  return {
    id: String(m.id),
    name: m.name || m.pseudonym || 'Membre',
    age: computedAge ?? m.age ?? 30,
    birth_date: m.birth_date ? String(m.birth_date).slice(0, 10) : '',
    city: m.city || 'Lomé',
    gender: m.gender || 'Femme',
    sought: m.sought || 'Homme',
    tier: m.tier || 'standard',
    photo: m.photo || FALLBACK_PHOTO,
    bio: m.bio || 'Membre du Cercle Élite.',
    isMember: true,
  };
};

const toMember = (m: any): Member => {
  const birthDate = m.birth_date ? String(m.birth_date).slice(0, 10) : '';
  const computedAge = birthDate ? calculateAge(birthDate) : null;
  return {
    id: String(m.id),
    email: m.email || '',
    pseudonym: m.pseudonym || m.name || 'Membre',
    age: computedAge ?? m.age ?? 30,
    birth_date: birthDate,
    gender: m.gender || 'Femme',
    sought: m.sought || 'Homme',
    city: m.city || '',
    photo: m.photo || FALLBACK_PHOTO,
    bio: m.bio || '',
    tier: m.tier || 'standard',
    tierExpiresAt: m.tierExpiresAt || null,
  };
};

class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api(path: string, method = 'GET', body?: unknown, token?: string | null): Promise<any> {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new ApiError(data.error || 'Une erreur est survenue. Réessayez dans un instant.', response.status, data.code);
  }
  return data;
}

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
function removeLocal(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignoré
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
  const [lang, setLang] = useState<Lang>(() => {
    const savedLang = loadLocal<Lang>('cercle-lang', 'fr');
    return savedLang === 'en' ? 'en' : 'fr';
  });
  const t = dict[lang];

  const [token, setToken] = useState<string | null>(() => loadLocal<string | null>('cercle-token', null));
  const [member, setMember] = useState<Member | null>(() => {
    const saved = loadLocal<Member | null>('cercle-member', null);
    return loadLocal<string | null>('cercle-token', null) && saved?.id ? saved : null;
  });
  const [profiles, setProfiles] = useState<Profile[]>(starterProfiles);
  const [unlocked, setUnlocked] = useState<TierId[]>(() => loadLocal<string | null>('cercle-token', null) ? loadLocal<TierId[]>('cercle-unlocked', []) : []);
  const [matches, setMatches] = useState<string[]>(() => loadLocal<string[]>('cercle-matches', []));
  const [encounters, setEncounters] = useState<Record<string, EncounterInfo>>({});
  const [tierId, setTierId] = useState<TierId>('standard');
  const [modal, setModal] = useState<'register' | 'login' | 'profile' | 'unlock' | null>(null);
  const [registerStep, setRegisterStep] = useState(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [registrationToken, setRegistrationToken] = useState('');
  const [registerTier, setRegisterTier] = useState<TierId>('standard');
  const [loginStep, setLoginStep] = useState<'credentials' | 'otp' | 'forgot-email' | 'forgot-otp' | 'forgot-password'>('credentials');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [noAccount, setNoAccount] = useState(false);
  const [info, setInfo] = useState('');
  const [editPseudonym, setEditPseudonym] = useState('');
  const [editBirthDate, setEditBirthDate] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editPhoto, setEditPhoto] = useState('');
  const [pseudonym, setPseudonym] = useState('');
  const [birthDate, setBirthDate] = useState('');
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
  const [cguAccepted, setCguAccepted] = useState<boolean>(() => loadLocal<boolean>('cercle_cgu_accepted', false) === true);
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPeerId, setChatPeerId] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  
  const activeTier = tiers.find((tier) => tier.id === tierId) ?? tiers[0];
  const selectedTier = tiers.find((tier) => tier.id === pendingTier) ?? tiers[0];
  const visibleProfiles = useMemo(() => profiles.filter((profile) => profile.tier === tierId), [profiles, tierId]);

  const maxBirthDate = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 18);
    return d.toISOString().split('T')[0];
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/members')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled && data.success && Array.isArray(data.members) && data.members.length > 0) {
          setProfiles(data.members.map(mapMember));
        }
      })
      .catch((err) => console.error('Erreur lors du chargement des membres :', err))
      .finally(() => { if (!cancelled) setLoadingMembers(false); });
    return () => { cancelled = true; };
  }, []);

  const refreshEncounters = async (authToken: string | null = token) => {
    if (!authToken) {
      setEncounters({});
      return;
    }
    try {
      const data = await api('/api/encounters', 'GET', undefined, authToken);
      const map: Record<string, EncounterInfo> = {};
      for (const e of data.encounters || []) {
        const existing = map[e.peerId];
        if (!existing || e.status === 'accepted') {
          map[e.peerId] = {
            id: String(e.id),
            peerId: String(e.peerId),
            direction: e.direction,
            status: e.status,
            mySentMessages: Number(e.mySentMessages ?? 0),
          };
        }
      }
      setEncounters(map);
      setMatches(Object.keys(map));
    } catch (err) {
      console.error('Erreur lors du chargement des demandes :', err);
    }
  };

  useEffect(() => {
    if (token && member) {
      void refreshEncounters(token);
    } else {
      setEncounters({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, member?.id]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    saveLocal('cercle-theme', theme);
  }, [theme]);
  useEffect(() => { saveLocal('cercle-lang', lang); }, [lang]);
  useEffect(() => { if (member) saveLocal('cercle-member', member); else removeLocal('cercle-member'); }, [member]);
  useEffect(() => { if (token) saveLocal('cercle-token', token); else removeLocal('cercle-token'); }, [token]);
  useEffect(() => saveLocal('cercle-unlocked', unlocked), [unlocked]);
  useEffect(() => saveLocal('cercle-matches', matches), [matches]);

  const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  const errorMessage = (err: unknown) => err instanceof Error ? err.message : 'Erreur réseau. Vérifiez votre connexion.';
  const resetAuthForm = () => {
    setPassword('');
    setShowPassword(false);
    setCode('');
    setInfo('');
    setError('');
    setNoAccount(false);
    setRegistrationToken('');
    setResetToken('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const startSession = (newToken: string, m: Member) => {
    setToken(newToken);
    setMember(m);
    setUnlocked((current) => {
      const allowed = current.filter((id) => tierRank(id) <= tierRank(m.tier));
      return allowed.includes(m.tier) ? allowed : [...allowed, m.tier];
    });
    setTierId(m.tier);
    void refreshEncounters(newToken);
  };
  const syncMember = (raw: any) => {
    const m = toMember(raw);
    setMember(m);
    setUnlocked((current) => current.filter((id) => tierRank(id) <= tierRank(m.tier)));
    setProfiles((current) => current.map((p) => p.id === m.id ? { ...p, tier: m.tier } : p));
  };
  const logout = () => {
    setToken(null);
    setMember(null);
    setUnlocked([]);
    setMatches([]);
    setEncounters({});
    setChatOpen(false);
    setChatPeerId(null);
    resetAuthForm();
    setModal(null);
  };
  useEffect(() => {
    if (!token) return;
    api('/api/auth/me', 'GET', undefined, token)
      .then((data) => syncMember(data.member))
      .catch((err) => { if (err instanceof ApiError && err.status === 401) logout(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!token || !member?.tierExpiresAt) return;
    const expiry = new Date(member.tierExpiresAt).getTime();
    const check = () => {
      if (Date.now() >= expiry + 1000) {
        api('/api/auth/me', 'GET', undefined, token).then((data) => syncMember(data.member)).catch(() => undefined);
      }
    };
    check();
    const timer = setInterval(check, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, member?.tierExpiresAt]);

  const openRegister = () => {
    resetAuthForm();
    setRegisterStep(1);
    setModal('register');
  };
  const openLogin = () => {
    resetAuthForm();
    setLoginStep('credentials');
    setModal('login');
  };
  const openProfile = () => {
    if (!member) return;
    setError('');
    setEditPseudonym(member.pseudonym);
    setEditBirthDate(member.birth_date || '');
    setEditBio(member.bio);
    setEditPhoto(member.photo);
    setShowUpgrade(false);
    setModal('profile');
  };
  const requestUnlock = (id: TierId) => {
    if (!member) {
      setRegisterTier(id);
      openLogin();
      setInfo(lang === 'fr' ? 'Connectez-vous (ou créez votre compte) pour débloquer un niveau.' : 'Sign in (or create your account) to unlock a tier.');
      return;
    }
    setPendingTier(id);
    setPaymentDone(false);
    setModal('unlock');
  };

  const requestRegisterCode = async (goNext: boolean) => {
    setSaving(true);
    setError('');
    try {
      await api('/api/auth/request-otp', 'POST', { email: email.trim() });
      setCode('');
      setInfo(goNext ? `Un code à six chiffres a été envoyé à ${email.trim()}.` : 'Un nouveau code vient d’être envoyé.');
      if (goNext) setRegisterStep(2);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const sendRegisterCode = (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!validEmail(email)) {
      setError('Saisissez une adresse e-mail valide pour continuer.');
      return;
    }
    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    void requestRegisterCode(true);
  };
  const verifyRegisterCode = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Saisissez le code à six chiffres reçu par e-mail.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const data = await api('/api/auth/verify-otp', 'POST', { email: email.trim(), code: code.trim(), purpose: 'register' });
      setRegistrationToken(data.registrationToken);
      setInfo('');
      setRegisterStep(3);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const photoSelected = (event: ChangeEvent<HTMLInputElement>, setter: (value: string) => void = setPhoto) => {
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
    reader.onload = () => setter(String(reader.result ?? ''));
    reader.onerror = () => setError('La photo n’a pas pu être lue.');
    reader.readAsDataURL(file);
  };
  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (pseudonym.trim().length < 2) {
      setError('Choisissez un pseudonyme de deux caractères minimum.');
      return;
    }
    if (!birthDate) {
      setError('Indiquez votre date de naissance.');
      return;
    }
    const age = calculateAge(birthDate);
    if (age === null || age < 18) {
      setError('Vous devez avoir au moins 18 ans pour rejoindre Cercle Élite.');
      return;
    }
    if (city.trim().length < 2) {
      setError('Indiquez votre ville, par exemple Lomé ou Aného.');
      return;
    }
    if (!photo) {
      setError('Ajoutez une photo de profil pour terminer votre inscription.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const data = await api('/api/auth/register', 'POST', {
        registrationToken,
        password,
        pseudonym: pseudonym.trim(),
        birth_date: birthDate,
        gender,
        sought,
        city: city.trim(),
        bio: bio.trim(),
        photo,
        tier: registerTier,
        ageConfirmed: true,
        acceptedTerms: true,
      });
      const created = toMember(data.member);
      startSession(data.token, created);
      setProfiles((current) => [mapMember(data.member), ...current.filter((p) => p.id !== created.id)]);
      setPseudonym('');
      setBirthDate('');
      setBio('');
      setPhoto('');
      resetAuthForm();
      setModal(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!validEmail(email) || !password) {
      setError('Saisissez votre e-mail et votre mot de passe.');
      return;
    }
    setSaving(true);
    setError('');
    setNoAccount(false);
    try {
      await api('/api/auth/login', 'POST', { email: email.trim(), password });
      setCode('');
      setInfo(`Un code à six chiffres a été envoyé à ${email.trim()}.`);
      setLoginStep('otp');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'OTP_COOLDOWN') {
        setInfo('Un code vous a déjà été envoyé il y a un instant. Saisissez-le ci-dessous.');
        setLoginStep('otp');
      } else {
        if (err instanceof ApiError && err.code === 'NO_ACCOUNT') setNoAccount(true);
        setError(errorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };
  const submitLoginOtp = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Saisissez le code à six chiffres reçu par e-mail.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const data = await api('/api/auth/verify-otp', 'POST', { email: email.trim(), code: code.trim(), purpose: 'login' });
      startSession(data.token, toMember(data.member));
      resetAuthForm();
      setModal(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const openForgotPassword = () => {
    setError('');
    setInfo('');
    setCode('');
    setResetToken('');
    setNewPassword('');
    setConfirmPassword('');
    setNoAccount(false);
    setLoginStep('forgot-email');
  };

  const requestForgotOtp = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!validEmail(email)) {
      setError('Saisissez l’adresse e-mail associée à votre compte.');
      return;
    }
    setSaving(true);
    setError('');
    setNoAccount(false);
    try {
      await api('/api/auth/forgot-password', 'POST', { email: email.trim() });
      setCode('');
      setInfo(`Un code de vérification à six chiffres a été envoyé à ${email.trim()}.`);
      setLoginStep('forgot-otp');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'OTP_COOLDOWN') {
        setInfo('Un code vous a déjà été envoyé il y a un instant. Saisissez-le ci-dessous.');
        setLoginStep('forgot-otp');
      } else {
        if (err instanceof ApiError && err.code === 'NO_ACCOUNT') setNoAccount(true);
        setError(errorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const verifyForgotOtp = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Saisissez le code à six chiffres reçu par e-mail.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const data = await api('/api/auth/verify-otp', 'POST', {
        email: email.trim(),
        code: code.trim(),
        purpose: 'reset-password',
      });
      setResetToken(data.resetToken);
      setInfo('');
      setLoginStep('forgot-password');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const submitNewPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (newPassword.length < 8) {
      setError('Le nouveau mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const data = await api('/api/auth/reset-password', 'POST', {
        resetToken,
        newPassword,
      });
      startSession(data.token, toMember(data.member));
      resetAuthForm();
      setModal(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const saveProfileEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !member) return;
    if (editPseudonym.trim().length < 2) {
      setError('Choisissez un pseudonyme de deux caractères minimum.');
      return;
    }
    if (editBirthDate) {
      const age = calculateAge(editBirthDate);
      if (age === null || age < 18) {
        setError('Vous devez avoir au moins 18 ans.');
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      const data = await api(
        `/api/members/${member.id}`,
        'PUT',
        {
          pseudonym: editPseudonym.trim(),
          ...(editBirthDate ? { birth_date: editBirthDate } : {}),
          bio: editBio.trim(),
          photo: editPhoto,
        },
        token
      );
      const updated = toMember(data.member);
      setMember(updated);
      setProfiles((current) => current.map((p) => p.id === updated.id ? mapMember(data.member) : p));
      setModal(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        setModal('login');
        setLoginStep('credentials');
        setError('Votre session a expiré. Reconnectez-vous.');
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };
  const priceText = (value: number) => value === 0 ? (lang === 'fr' ? 'Gratuit' : 'Free') : `${money(value)} FCFA${lang === 'fr' ? '/mois' : '/month'}`;
  const tierRank = (id: TierId) => tiers.findIndex((tier) => tier.id === id);
  const finishUnlock = async () => {
    if (!member || !token) return;
    setUnlocked((current) => current.includes(pendingTier) ? current : [...current, pendingTier]);
    if (member && token && (tierRank(pendingTier) > tierRank(member.tier) || (pendingTier === member.tier && selectedTier.price > 0))) {
      try {
        const data = await api(`/api/members/${member.id}`, 'PUT', { tier: pendingTier }, token);
        syncMember(data.member);
      } catch (err) {
        console.error('Mise à jour du niveau impossible :', err);
      }
    }
    setPaymentDone(true);
  };
  const toggleMatch = async (id: string) => {
    if (!member || !token) {
      openLogin();
      return;
    }
    try {
      const existing = encounters[id];
      if (existing && existing.direction === 'incoming' && existing.status === 'pending') {
        await api(`/api/encounters/${existing.id}/accept`, 'POST', {}, token);
      } else {
        await api('/api/encounters', 'POST', { recipientId: id }, token);
      }
      await refreshEncounters(token);
      setMatches((current) => current.includes(id) ? current : [...current, id]);
    } catch (err) {
      console.error('Erreur demande de rencontre :', err);
    }
  };

  const acceptGate = () => {
    saveLocal('cercle_cgu_accepted', true);
    saveLocal('cercle_cgu_accepted_at', new Date().toISOString());
    setCguAccepted(true);
  };
  const openChat = (peerId: string | null) => {
    if (!member) { openLogin(); return; }
    setModal(null);
    setChatPeerId(peerId);
    setChatOpen(true);
  };
  const handleChatClose = () => {
    setChatOpen(false);
    void refreshEncounters(token);
  };
  const upgradeFromChat = () => {
    setChatOpen(false);
    const next = tiers[Math.min(tierRank(member?.tier ?? 'standard') + 1, tiers.length - 1)];
    requestUnlock(next.id);
  };

  const upgradeOptions = member ? tiers.filter((tier) => tier.price > 0 && tierRank(tier.id) >= tierRank(member.tier)) : [];
  const previewAge = calculateAge(birthDate);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#accueil" aria-label="Cercle Élite, accueil">
          <span className="brand-mark">C</span>
          <span className="brand-name">CERCLE ÉLITE<span className="brand-caption">{t.brandCaption}</span></span>
        </a>
        <nav className="top-actions" aria-label="Navigation principale" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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

          <button
            type="button"
            onClick={() => setLang((current) => current === 'fr' ? 'en' : 'fr')}
            aria-label="Changer la langue"
            title={lang === 'fr' ? 'Switch to English' : 'Passer en Français'}
            style={{
              background: 'transparent',
              border: '1px solid rgba(212, 175, 55, 0.35)',
              color: 'inherit',
              borderRadius: '999px',
              padding: '4px 10px',
              fontSize: '0.75rem',
              fontWeight: 600,
              letterSpacing: '0.06em',
              cursor: 'pointer',
              height: '32px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {lang === 'fr' ? 'EN' : 'FR'}
          </button>

          <button className="text-button" onClick={() => document.getElementById('catalogue')?.scrollIntoView({ behavior: 'smooth' })}>{t.catalogue}</button>

          {member && <button className="text-button" onClick={() => openChat(null)}>{t.messages}</button>}

          {member ? (
            <button
              type="button"
              onClick={openProfile}
              title={`${member.pseudonym} · Modifier mon profil`}
              aria-label="Ouvrir mon profil"
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                padding: 0,
                border: '2px solid #d4af37',
                overflow: 'hidden',
                background: '#161b26',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <img
                src={member.photo || FALLBACK_PHOTO}
                alt={member.pseudonym}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </button>
          ) : (
            <>
              <button className="text-button" onClick={openLogin}>{t.login}</button>
              <button className="gold-button" onClick={openRegister}>{t.createProfile}</button>
            </>
          )}
        </nav>
      </header>

      <main id="accueil">
        <section className="hero">
          <div>
            <div className="eyebrow">{t.eyebrow}</div>
            <h1>{t.heroTitle1}<br />{t.heroTitle2}<em>{t.heroTitleEm}</em></h1>
            <p className="hero-copy">{t.heroCopy}</p>
            <div className="hero-cta">
              <button className="gold-button" onClick={() => member ? document.getElementById('catalogue')?.scrollIntoView({ behavior: 'smooth' }) : openRegister()}>{member ? t.discoverCircle : t.joinCircle} <ChevronRight size={15} style={{ verticalAlign: 'middle', marginLeft: 7 }} /></button>
              <button className="outline-button" onClick={() => document.getElementById('catalogue')?.scrollIntoView({ behavior: 'smooth' })}>{t.exploreProfiles}</button>
            </div>
          </div>
          <aside className="hero-aside" aria-label="Le cercle en chiffres">
            <div className="ornament" aria-hidden="true" />
            <div><div className="aside-number">{profiles.length.toString().padStart(2, '0')}</div><div className="aside-label">{t.profilesToday}</div></div>
            <div><div className="eyebrow">{t.chosenSpace}</div><p className="aside-label">{t.chosenSpaceCopy}</p></div>
          </aside>
        </section>

        <section className="section" id="catalogue">
          <div className="section-heading">
            <div><div className="eyebrow">{t.privateCatalogue}</div><h2>{t.measureEncounter}</h2></div>
            <p>{t.catalogueCopy}</p>
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
            {loadingMembers ? <p role="status" aria-live="polite">{t.loadingProfiles}</p> : visibleProfiles.length ? visibleProfiles.map((profile) => {
              const locked = !unlocked.includes(profile.tier);
              const enc = encounters[profile.id];
              const isAccepted = enc?.status === 'accepted';
              const isIncomingPending = enc?.direction === 'incoming' && enc?.status === 'pending';
              const isOutgoingPending = enc?.direction === 'outgoing' && enc?.status === 'pending';
              const requested = isAccepted || isOutgoingPending || matches.includes(profile.id);
              const singleMsgAlreadyUsed = isOutgoingPending && (enc?.mySentMessages ?? 0) >= 1;

              let matchBtnLabel = t.proposeEncounter;
              if (isAccepted) matchBtnLabel = t.requestAccepted;
              else if (isIncomingPending) matchBtnLabel = t.acceptRequest;
              else if (requested) matchBtnLabel = t.requestSent;

              const canOpenChat = Boolean(profile.isMember && member && profile.id !== member.id && (isAccepted || isIncomingPending || isOutgoingPending));
              const chatDisabled = singleMsgAlreadyUsed && !isAccepted;
              const chatLabel = isAccepted
                ? `💬 ${t.chatBtn}`
                : singleMsgAlreadyUsed
                  ? `⏳ ${t.chatPendingHint}`
                  : `💬 ${t.chatFirstMsgBtn}`;

              return <article className={`profile-card ${locked ? 'locked' : ''}`} key={profile.id}>
                <div className="profile-photo-wrap">
                  <img className="profile-photo" src={profile.photo} alt={locked ? 'Portrait confidentiel' : `Portrait de ${profile.name}`} />
                  <span className="verified"><ShieldCheck size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t.verified}</span>
                  {locked && <div className="lock-overlay"><span className="lock-glyph"><LockKeyhole size={17} /></span><span>{t.confidentialPortrait}</span></div>}
                </div>
                <div className="profile-info">
                  <div className="profile-name">{locked ? t.privateProfile : profile.name}<span>{profile.age} {t.yearsOld}</span></div>
                  <div className="profile-meta">{profile.city} · {profile.gender}</div>
                  <div className="profile-bio">{locked ? t.unlockBio : profile.bio}</div>
                  {locked
                    ? <button className="gold-button locked-action" onClick={() => requestUnlock(profile.tier)}>{t.unlockBtn}</button>
                    : <>
                      <button
                        className={`match-button ${requested && !isIncomingPending ? 'sent' : ''}`}
                        onClick={() => void toggleMatch(profile.id)}
                        disabled={requested && !isIncomingPending}
                      >
                        {matchBtnLabel}
                      </button>
                      {canOpenChat && (
                        <button
                          className="outline-button"
                          style={{ width: '100%', marginTop: 8, opacity: chatDisabled ? 0.65 : 1 }}
                          onClick={() => openChat(profile.id)}
                          disabled={chatDisabled}
                        >
                          {chatLabel}
                        </button>
                      )}
                    </>}
                </div>
              </article>;
            }) : <div className="empty-card"><strong>{t.emptyCircleTitle}</strong>{t.emptyCircleCopy}</div>}
          </div>
        </section>
      </main>
      <footer className="footer"><span>CERCLE ÉLITE · AFRIQUE · EUROPE · AU-DELÀ</span><span>Application en ligne · 2026 · <button type="button" className="link-button" onClick={() => setLegalDoc('cgu')}>{lang === 'fr' ? 'CGU' : 'Terms'}</button> · <button type="button" className="link-button" onClick={() => setLegalDoc('privacy')}>{lang === 'fr' ? 'Confidentialité' : 'Privacy'}</button></span></footer>

      {modal === 'register' && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="register-title">
          <button className="modal-close" onClick={() => setModal(null)} aria-label="Fermer"><X size={18} /></button>
          <div className="modal-kicker">Votre espace, en trois étapes</div>
          <h2 id="register-title">{registerStep === 1 ? 'Commençons par vous.' : registerStep === 2 ? 'Vérifions votre e-mail.' : 'Votre profil prend forme.'}</h2>
          <div className="stepper" aria-label={`Étape ${registerStep} sur 3`}>{[1, 2, 3].map((step) => <span key={step} className={`step-dot ${registerStep >= step ? 'active' : ''}`} />)}</div>
          {registerStep === 1 && <form onSubmit={sendRegisterCode} noValidate>
            <p className="modal-subtitle">Créez votre accès. Nous vous envoyons un code de vérification par e-mail.</p>
            {info && <div className="payment-note">{info}</div>}
            <div className="form-field"><label htmlFor="email">{t.emailLabel}</label><input id="email" type="email" autoComplete="email" placeholder="vous@exemple.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
            <div className="form-field">
              <label htmlFor="password">{t.passwordLabel}</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="8 caractères minimum"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  style={{ width: '100%', paddingRight: '40px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#9ca3af',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '4px',
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions"><button type="button" className="text-button" onClick={openLogin}>Déjà membre ? Se connecter</button><button className="gold-button" type="submit" disabled={saving}>{saving ? 'Envoi…' : 'Recevoir mon code'}</button></div>
          </form>}
          {registerStep === 2 && <form onSubmit={verifyRegisterCode} noValidate>
            {info && <div className="payment-note">{info}</div>}
            <div className="form-field"><label htmlFor="otp">Code à six chiffres</label><input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required /></div>
            <button type="button" className="text-button" onClick={() => void requestRegisterCode(false)} disabled={saving}>Renvoyer le code</button>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions"><button type="button" className="text-button" onClick={() => { setRegisterStep(1); setError(''); setInfo(''); }}>Retour</button><button className="gold-button" type="submit" disabled={saving}>{saving ? t.verifying : 'Vérifier le code'}</button></div>
          </form>}
          {registerStep === 3 && <form onSubmit={saveProfile} noValidate>
            <p className="modal-subtitle">Quelques détails pour proposer des rencontres qui vous ressemblent.</p>
            <div className="form-field"><label htmlFor="pseudonym">{t.pseudonymLabel}</label><input id="pseudonym" value={pseudonym} onChange={(event) => setPseudonym(event.target.value)} placeholder="Ex. Afi" required maxLength={28} /></div>
            <div className="form-field">
              <label htmlFor="birthDate">{t.birthDateLabel}</label>
              <input
                id="birthDate"
                type="date"
                max={maxBirthDate}
                value={birthDate}
                onChange={(event) => setBirthDate(event.target.value)}
                required
              />
              {previewAge !== null && previewAge >= 0 && (
                <small style={{ color: previewAge >= 18 ? '#d4af37' : '#ef4444' }}>
                  {previewAge >= 18 ? `Âge calculé : ${previewAge} ${t.yearsOld}` : 'Vous devez avoir au moins 18 ans.'}
                </small>
              )}
            </div>
            <div className="form-row">
              <div className="form-field"><label htmlFor="gender">Je suis</label><select id="gender" value={gender} onChange={(event) => setGender(event.target.value as 'Homme' | 'Femme')}><option>Femme</option><option>Homme</option></select></div>
              <div className="form-field"><label htmlFor="sought">Je recherche</label><select id="sought" value={sought} onChange={(event) => setSought(event.target.value as 'Homme' | 'Femme')}><option>Homme</option><option>Femme</option></select></div>
            </div>
            <div className="form-field"><label htmlFor="city">Ma ville</label><input id="city" list="city-options" value={city} onChange={(event) => setCity(event.target.value)} placeholder="Lomé ou Aného" required /><datalist id="city-options"><option value="Lomé" /><option value="Aného" /><option value="Kpalimé" /><option value="Accra" /></datalist></div>
            <div className="form-field"><label htmlFor="tier">Mon niveau</label><select id="tier" value={registerTier} onChange={(event) => setRegisterTier(event.target.value as TierId)}>{tiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.name} · {tier.audience} · {priceText(tier.price)}</option>)}</select><small style={{ color: '#7f8a99' }}>{(tiers.find((tier) => tier.id === registerTier) ?? tiers[0]).note} Paiement simulé.</small></div>
            <label className="photo-picker" htmlFor="profile-photo">
              {photo ? <img className="photo-preview" src={photo} alt="Aperçu de votre photo" /> : <span className="photo-preview" aria-hidden="true" style={{ display: 'grid', placeItems: 'center', border: '1px solid #536074', color: '#d4af37' }}><Sparkles size={19} /></span>}
              <span>{photo ? t.changePhoto : 'Ajouter une photo de profil'}<br /><small>{t.photoHint}</small></span>
            </label>
            <input id="profile-photo" className="visually-hidden" type="file" accept="image/*" onChange={(event) => photoSelected(event)} />
            <div className="form-field"><label htmlFor="bio">{t.shareLabel}</label><textarea id="bio" value={bio} onChange={(event) => setBio(event.target.value)} placeholder="Vos centres d’intérêt..." maxLength={260} /><small style={{ color: '#7f8a99' }}>{bio.length}/260 caractères</small></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions"><span /><button className="gold-button" type="submit" disabled={saving}>{saving ? 'Création…' : t.createProfile}</button></div>
          </form>}
        </section>
      </div>}

      {modal === 'login' && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="login-title">
          <button className="modal-close" onClick={() => setModal(null)} aria-label="Fermer"><X size={18} /></button>
          <div className="modal-kicker">{t.memberSpace}</div>
          <h2 id="login-title">
            {loginStep === 'credentials'
              ? t.welcomeBack
              : loginStep === 'otp' || loginStep === 'forgot-otp'
                ? t.lastCheck
                : loginStep === 'forgot-email'
                  ? 'Mot de passe oublié.'
                  : 'Nouveau mot de passe.'}
          </h2>
          {loginStep === 'credentials' && <form onSubmit={submitLogin} noValidate>
            <p className="modal-subtitle">Connectez-vous avec votre e-mail et votre mot de passe. Un code de sécurité vous sera envoyé par e-mail.</p>
            {info && <div className="payment-note">{info}</div>}
            <div className="form-field"><label htmlFor="login-email">{t.emailLabel}</label><input id="login-email" type="email" autoComplete="email" placeholder="vous@exemple.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
            <div className="form-field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <label htmlFor="login-password" style={{ margin: 0 }}>{t.passwordLabel}</label>
                <button type="button" className="text-button" style={{ padding: 0, fontSize: '0.8rem' }} onClick={openForgotPassword}>
                  Mot de passe oublié ?
                </button>
              </div>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginTop: 6 }}>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  style={{ width: '100%', paddingRight: '40px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#9ca3af',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '4px',
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            {noAccount && <div className="payment-note">Vous n’avez pas encore de compte ? <button type="button" className="text-button" onClick={openRegister}>{t.createProfile}</button></div>}
            <div className="modal-actions"><button type="button" className="text-button" onClick={openRegister}>Vous n’avez pas de compte ? Inscription</button><button className="gold-button" type="submit" disabled={saving}>{saving ? t.verifying : t.signIn}</button></div>
          </form>}
          {loginStep === 'otp' && <form onSubmit={submitLoginOtp} noValidate>
            {info && <div className="payment-note">{info}</div>}
            <div className="form-field"><label htmlFor="login-otp">Code à six chiffres</label><input id="login-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required /></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions"><button type="button" className="text-button" onClick={() => { setLoginStep('credentials'); setError(''); setInfo(''); }}>Retour</button><button className="gold-button" type="submit" disabled={saving}>{saving ? t.verifying : 'Valider le code'}</button></div>
          </form>}
          {loginStep === 'forgot-email' && <form onSubmit={requestForgotOtp} noValidate>
            <p className="modal-subtitle">Saisissez l’adresse e-mail de votre compte pour recevoir un code de vérification.</p>
            <div className="form-field"><label htmlFor="forgot-email">{t.emailLabel}</label><input id="forgot-email" type="email" autoComplete="email" placeholder="vous@exemple.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            {noAccount && <div className="payment-note">Aucun compte trouvé avec cet e-mail. <button type="button" className="text-button" onClick={openRegister}>{t.createProfile}</button></div>}
            <div className="modal-actions"><button type="button" className="text-button" onClick={() => { setLoginStep('credentials'); setError(''); setInfo(''); }}>Retour à la connexion</button><button className="gold-button" type="submit" disabled={saving}>{saving ? 'Envoi…' : 'Envoyer le code'}</button></div>
          </form>}
          {loginStep === 'forgot-otp' && <form onSubmit={verifyForgotOtp} noValidate>
            {info && <div className="payment-note">{info}</div>}
            <div className="form-field"><label htmlFor="forgot-otp">Code à six chiffres</label><input id="forgot-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required /></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions"><button type="button" className="text-button" onClick={() => { setLoginStep('forgot-email'); setError(''); setInfo(''); }}>Retour</button><button className="gold-button" type="submit" disabled={saving}>{saving ? t.verifying : 'Vérifier le code'}</button></div>
          </form>}
          {loginStep === 'forgot-password' && <form onSubmit={submitNewPassword} noValidate>
            <p className="modal-subtitle">Choisissez votre nouveau mot de passe (8 caractères minimum).</p>
            <div className="form-field">
              <label htmlFor="new-password">Nouveau mot de passe</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="8 caractères minimum"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  style={{ width: '100%', paddingRight: '40px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#9ca3af',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '4px',
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="confirm-password">Confirmer le nouveau mot de passe</label>
              <input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Répétez le mot de passe"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions"><button type="button" className="text-button" onClick={() => { setLoginStep('credentials'); setError(''); setInfo(''); }}>Annuler</button><button className="gold-button" type="submit" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer le mot de passe'}</button></div>
          </form>}
        </section>
      </div>}

      {modal === 'profile' && member && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
          <button className="modal-close" onClick={() => setModal(null)} aria-label="Fermer"><X size={18} /></button>
          <div className="modal-kicker">{t.mySpace}</div>
          <h2 id="profile-title">{t.editProfileTitle}</h2>
          <form onSubmit={saveProfileEdit} noValidate>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              <p className="modal-subtitle" style={{ margin: 0 }}>{member.email} · {lang === 'fr' ? 'niveau' : 'tier'} {(tiers.find((tier) => tier.id === member.tier) ?? tiers[0]).name}</p>
              {upgradeOptions.length > 0 && <button type="button" className="gold-button" style={{ padding: '8px 14px', fontSize: '0.8rem' }} onClick={() => setShowUpgrade((current) => !current)}>
                {member.tier === 'standard' ? (lang === 'fr' ? 'Passer au niveau supérieur' : 'Upgrade') : (lang === 'fr' ? 'Prolonger / changer' : 'Renew / change')}
              </button>}
            </div>
            {member.tier !== 'standard' && member.tierExpiresAt && <p style={{ margin: '0 0 8px', fontSize: '0.8rem', color: '#9aa5b5' }}>
              {lang === 'fr' ? 'Abonnement actif jusqu’au' : 'Subscription active until'} {new Date(member.tierExpiresAt).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB')}. {lang === 'fr' ? 'Sans renouvellement, retour automatique au niveau Standard.' : 'Without renewal, you automatically return to the Standard tier.'}
            </p>}
            {showUpgrade && <div style={{ display: 'grid', gap: 8, margin: '4px 0 14px' }}>
              {upgradeOptions.map((tier) => <button type="button" key={tier.id} className="outline-button" style={{ width: '100%' }} onClick={() => requestUnlock(tier.id)}>
                {tier.name} · {priceText(tier.price)}{tier.id === member.tier ? (lang === 'fr' ? ' · renouveler' : ' · renew') : ''}
              </button>)}
            </div>}
            <label className="photo-picker" htmlFor="edit-photo">
              {editPhoto ? <img className="photo-preview" src={editPhoto} alt="Aperçu de votre photo" /> : <span className="photo-preview" aria-hidden="true" style={{ display: 'grid', placeItems: 'center', border: '1px solid #536074', color: '#d4af37' }}><Sparkles size={19} /></span>}
              <span>{t.changePhoto}<br /><small>{t.photoHint}</small></span>
            </label>
            <input id="edit-photo" className="visually-hidden" type="file" accept="image/*" onChange={(event) => photoSelected(event, setEditPhoto)} />
            <div className="form-field"><label htmlFor="edit-pseudonym">{t.pseudonymLabel}</label><input id="edit-pseudonym" value={editPseudonym} onChange={(event) => setEditPseudonym(event.target.value)} required maxLength={28} /></div>
            <div className="form-field">
              <label htmlFor="edit-birthDate">{t.birthDateLabel}</label>
              <input
                id="edit-birthDate"
                type="date"
                max={maxBirthDate}
                value={editBirthDate}
                onChange={(event) => setEditBirthDate(event.target.value)}
              />
            </div>
            <div className="form-field"><label htmlFor="edit-bio">{t.shareLabel}</label><textarea id="edit-bio" value={editBio} onChange={(event) => setEditBio(event.target.value)} maxLength={260} /><small style={{ color: '#7f8a99' }}>{editBio.length}/260 caractères</small></div>
            <LegalConsentRecap lang={lang} onOpenDoc={setLegalDoc} />
            <button type="button" className="outline-button" style={{ width: '100%', margin: '8px 0 4px' }} onClick={() => openChat(null)}>💬 {t.myMessages}</button>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="text-button" onClick={() => setModal(null)}>{t.cancel}</button>
              <button className="gold-button" type="submit" disabled={saving}>{saving ? t.saving : t.save}</button>
            </div>
            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'center' }}>
              <button type="button" className="gold-button" style={{ width: '100%' }} onClick={logout}>{t.logout}</button>
            </div>
          </form>
        </section>
      </div>}

      {modal === 'unlock' && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
          <button className="modal-close" onClick={() => setModal(null)} aria-label="Fermer"><X size={18} /></button>
          {paymentDone ? <>
            <div className="success-mark"><Check size={25} /></div><div className="modal-kicker">Accès activé</div><h2 id="unlock-title">Le cercle s’ouvre à vous.</h2>
            <p className="modal-subtitle">Le niveau {selectedTier.name} est maintenant débloqué sur cet appareil.</p>
            {selectedTier.price > 0 && <div className="payment-note">Simulation terminée : aucun paiement réel n’a été effectué.</div>}
            <div className="modal-actions"><span /><button className="gold-button" onClick={() => setModal(null)}>Découvrir les profils</button></div>
          </> : <>
            <div className="modal-kicker">{selectedTier.price === 0 ? 'Accès gratuit' : 'Accès mensuel · simulation'}</div><h2 id="unlock-title">Débloquer {selectedTier.name}.</h2>
            <p className="modal-subtitle">{selectedTier.note} Confirmez pour révéler les profils de ce niveau.</p>
            <div className="price-line">{selectedTier.price === 0 ? <><strong>Gratuit</strong><span>Aucun paiement requis</span></> : <><strong>{money(selectedTier.price)}</strong><span>FCFA / mois · prix illustratif</span></>}</div>
            {selectedTier.price > 0 && <div className="payment-note">Cette démonstration reproduit un parcours CinetPay. Abonnement de {30} jours : sans renouvellement, retour automatique au niveau Standard.</div>}
            <div className="modal-actions"><button className="text-button" onClick={() => setModal(null)}>{t.cancel}</button><button className="gold-button" onClick={finishUnlock}>{selectedTier.price === 0 ? 'Confirmer l’accès' : 'Confirmer l’accès simulé'}</button></div>
          </>}
        </section>
      </div>}

      {chatOpen && member && token && <Chat
        key={chatPeerId ?? 'list'}
        token={token}
        profiles={profiles}
        initialPeerId={chatPeerId}
        lang={lang}
        onClose={handleChatClose}
        onUpgrade={upgradeFromChat}
        onSessionExpired={() => { logout(); setModal('login'); setLoginStep('credentials'); setError('Votre session a expiré. Reconnectez-vous.'); }}
      />}

      {!cguAccepted && <LegalGate lang={lang} onToggleLang={() => setLang((current) => current === 'fr' ? 'en' : 'fr')} onAccept={acceptGate} onOpenDoc={setLegalDoc} />}
      {legalDoc && <LegalViewer doc={legalDoc} lang={lang} onClose={() => setLegalDoc(null)} onSwitch={setLegalDoc} />}
    </div>
  );
}

export default App;