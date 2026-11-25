import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import PushPrompt from './PushPrompt';

type Lang = 'fr' | 'en';
type Kind = 'text' | 'photo' | 'audio' | 'video';
type ChatReply = { id: string; kind: Kind; body: string; fromMe: boolean; deleted?: boolean };
type ChatMessage = {
  id: string;
  fromMe: boolean;
  kind: Kind;
  body: string;
  media: string | null;
  durationMs: number | null;
  createdAt: string;
  deliveredAt?: string | null;
  readAt?: string | null;
  reply: ChatReply | null;
};
type MessageStatus = 'sent' | 'delivered' | 'read';
// Fenêtre d'échange de 24 h (discussion entre un membre Standard et un membre de niveau supérieur)
type Window24h = { active: boolean; expiresAt: string | null; expired: boolean; peerIsStandard: boolean; meIsStandard: boolean };
type Receipt = { id: string; deliveredAt: string | null; readAt: string | null };
type Quota = { limited: boolean; limit: number | null; remaining: number | null; blockedUntil: string | null };
type EncounterState = {
  status: 'none' | 'pending' | 'accepted' | 'declined';
  direction: 'outgoing' | 'incoming' | null;
  requestId: string | null;
  mySentMessages: number;
  canSendMessage: boolean;
};
type Conversation = { peerId: string; kind: Kind; body: string; fromMe: boolean; createdAt: string; status?: MessageStatus | null; blockedByMe?: boolean };
type Pending = { kind: 'photo' | 'audio' | 'video'; media: string; durationMs?: number };
type ChatProfile = { id: string; name: string; photo: string };

type Props = {
  token: string;
  profiles: ChatProfile[];
  initialPeerId: string | null;
  onPeerChange?: (peerId: string | null) => void;
  lang: Lang;
  onClose: () => void;
  onBackToProfile?: () => void; // flèche ← de la liste des messages : retour à « Mon espace »
  onRead?: () => void; // une discussion vient d'être ouverte (messages marqués lus côté serveur)
  onUpgrade: () => void;
  onSessionExpired: () => void;
};

const TTL_MS = 72 * 3600 * 1000;
const AUDIO_MAX_MS = 15000;
const VIDEO_MAX_MS = 5000;
const PHOTO_MAX_BYTES = 1800000;
const SWIPE_TRIGGER = 56;

const L = {
  fr: {
    title: 'Messages', back: 'Retour', backToProfile: 'Retour au profil', close: 'Fermer', loading: 'Chargement…',
    noConv: 'Aucune conversation pour le moment.',
    noConvHint: 'Ouvrez un profil du catalogue et appuyez sur « Discuter ».',
    ttl: 'Par confidentialité, tous les messages sont supprimés automatiquement après 72 h.',
    quota: (r: number, l: number) => `Niveau Standard : ${r}/${l} messages restants`,
    quotaReached: 'Limite de 5 messages atteinte (niveau Standard).',
    nextIn: 'Prochains messages dans',
    upgrade: 'Passer au niveau supérieur',
    placeholder: 'Écrire un message…', send: 'Envoyer', sending: 'Envoi…', cancel: 'Annuler', stop: 'Arrêter',
    photo: 'Photo', audio: 'Message vocal', video: 'Vidéo',
    recording: 'Enregistrement', preview: 'Aperçu avant envoi',
    replyTo: 'Répondre', replyingTo: 'Réponse à', you: 'vous', deleted: 'Message supprimé',
    statusSent: 'Envoyé', statusDelivered: 'Distribué', statusRead: 'Vu',
    block: 'Bloquer ce membre', unblock: 'Débloquer', blockedTag: 'Bloqué',
    windowMine: (left: string) => `Fenêtre d’échange de 24 h avec ce membre : il vous reste ${left}. Le quota Standard (5 messages toutes les 5 h) s’applique.`,
    windowMineNotStarted: 'Votre échange avec ce membre est limité à 24 h à partir de l’acceptation ou du premier message. Le quota Standard (5 messages toutes les 5 h) s’applique.',
    windowPeer: (left: string) => `Ce membre est au niveau Standard : il dispose de 24 h pour échanger dans cette discussion. Temps restant : ${left}.`,
    windowPeerNotStarted: 'Ce membre est au niveau Standard : il ne disposera que de 24 h pour échanger, à partir de l’acceptation ou du premier message.',
    windowEndedMine: 'La fenêtre de 24 h avec ce membre est terminée. Passez au niveau supérieur pour continuer à échanger.',
    windowEndedPeer: 'La fenêtre de 24 h de votre interlocuteur (niveau Standard) est expirée : vous ne pouvez plus échanger ici tant qu’il n’est pas passé au niveau supérieur.',
    blockConfirm: 'Bloquer ce membre ? Vous ne recevrez plus ses messages ni ses demandes de rencontre. Vous pourrez le débloquer à tout moment.',
    blockedNotice: 'Vous avez bloqué ce membre : vous ne recevez plus ses messages. Débloquez-le pour reprendre la conversation.',
    swipeHint: 'Glissez un message vers la droite pour y répondre.',
    tooShort: 'Enregistrement trop court.', micDenied: 'Autorisez l’accès au micro / à la caméra pour enregistrer.',
    unsupported: 'Votre navigateur ne permet pas cet enregistrement.',
    photoBig: 'La photo doit faire moins de 1,8 Mo.', notImage: 'Choisissez un fichier image.',
    network: 'Erreur réseau. Vérifiez votre connexion.',
    singleMsgNotice: 'Demande en attente : vous pouvez envoyer un seul message avant acceptation.',
    singleMsgUsed: 'Votre message unique en attente a déjà été envoyé. La discussion complète s’ouvrira dès que ce membre accepte votre demande.',
    acceptIncomingNotice: 'Ce membre vous a envoyé une demande de rencontre. Acceptez-la pour échanger librement.',
    acceptBtn: 'Accepter la demande',
    accepting: 'Acceptation…',
    noRequestNotice: 'Envoyez d’abord une demande de rencontre depuis le profil de ce membre pour discuter.',
  },
  en: {
    title: 'Messages', back: 'Back', backToProfile: 'Back to profile', close: 'Close', loading: 'Loading…',
    noConv: 'No conversations yet.',
    noConvHint: 'Open a profile in the catalogue and tap “Chat”.',
    ttl: 'For privacy, all messages are automatically deleted after 72 h.',
    quota: (r: number, l: number) => `Standard tier: ${r}/${l} messages left`,
    quotaReached: 'You have reached the 5-message limit (Standard tier).',
    nextIn: 'You can write again in',
    upgrade: 'Upgrade to the next tier',
    placeholder: 'Write a message…', send: 'Send', sending: 'Sending…', cancel: 'Cancel', stop: 'Stop',
    photo: 'Photo', audio: 'Voice message', video: 'Video',
    recording: 'Recording', preview: 'Preview before sending',
    replyTo: 'Reply', replyingTo: 'Replying to', you: 'you', deleted: 'Deleted message',
    statusSent: 'Sent', statusDelivered: 'Delivered', statusRead: 'Seen',
    block: 'Block this member', unblock: 'Unblock', blockedTag: 'Blocked',
    windowMine: (left: string) => `24-hour window with this member: ${left} left. The Standard quota (5 messages every 5 hours) applies.`,
    windowMineNotStarted: 'Your conversation with this member is limited to 24 hours from acceptance or the first message. The Standard quota (5 messages every 5 hours) applies.',
    windowPeer: (left: string) => `This member is on the Standard tier: they have 24 hours to chat in this conversation. Time left: ${left}.`,
    windowPeerNotStarted: 'This member is on the Standard tier: they only have 24 hours to chat, starting from acceptance or the first message.',
    windowEndedMine: 'The 24-hour window with this member has ended. Upgrade to the next tier to keep chatting.',
    windowEndedPeer: 'The 24-hour window of your correspondent (Standard tier) has expired: you cannot chat here until they upgrade to the next tier.',
    blockConfirm: 'Block this member? You will no longer receive their messages or encounter requests. You can unblock them at any time.',
    blockedNotice: 'You blocked this member: you no longer receive their messages. Unblock them to resume the conversation.',
    swipeHint: 'Swipe a message to the right to reply to it.',
    tooShort: 'Recording too short.', micDenied: 'Allow microphone / camera access to record.',
    unsupported: 'Your browser does not support this recording.',
    photoBig: 'The photo must be smaller than 1.8 MB.', notImage: 'Please choose an image file.',
    network: 'Network error. Check your connection.',
    singleMsgNotice: 'Request pending: you can send a single message before acceptance.',
    singleMsgUsed: 'Your single pre-acceptance message has already been sent. Full chat unlocks once this member accepts your request.',
    acceptIncomingNotice: 'This member sent you an encounter request. Accept it to chat freely.',
    acceptBtn: 'Accept request',
    accepting: 'Accepting…',
    noRequestNotice: 'Send an encounter request from this member’s profile first to start chatting.',
  },
} as const;

class ChatApiError extends Error {
  status: number;
  code?: string;
  blockedUntil?: string;
  constructor(message: string, status: number, code?: string, blockedUntil?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.blockedUntil = blockedUntil;
  }
}

async function chatApi(path: string, method: string, body: unknown, token: string): Promise<any> {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new ChatApiError(data.error || 'Erreur', response.status, data.code, data.blockedUntil);
  }
  return data;
}

function pickMime(kind: 'audio' | 'video'): string | undefined {
  const candidates = kind === 'audio'
    ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    : ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

const pad = (n: number) => String(n).padStart(2, '0');
function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 3600)} h ${pad(Math.floor((total % 3600) / 60))} min ${pad(total % 60)} s`;
}

// Coches façon WhatsApp : ✓ envoyé · ✓✓ distribué · ✓✓ bleu = vu
function StatusTicks({ status, lang }: { status: MessageStatus; lang: Lang }) {
  const label = status === 'read' ? L[lang].statusRead : status === 'delivered' ? L[lang].statusDelivered : L[lang].statusSent;
  return (
    <svg
      role="img"
      aria-label={label}
      width="16"
      height="11"
      viewBox="0 0 17 11"
      fill="none"
      stroke={status === 'read' ? '#53bdeb' : 'currentColor'}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ opacity: status === 'read' ? 1 : 0.7, flexShrink: 0, marginRight: 4 }}
    >
      <title>{label}</title>
      {status !== 'sent' && <polyline points="1,6 4.5,9.5 11,1.5" />}
      <polyline points="6,6 9.5,9.5 16,1.5" />
    </svg>
  );
}

// Temps restant de la fenêtre de 24 h : « 5 h 07 min » ou « 42 min »
function formatWindow(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${String(minutes).padStart(2, '0')} min` : `${minutes} min`;
}

// Messages d'erreur du serveur affichés dans la langue de l'interface (le serveur renvoie un code et un texte français par défaut)
const ERROR_TEXTS: Record<string, { fr: string; en: string }> = {
  BLOCKED: { fr: 'Ce membre ne peut pas recevoir vos messages.', en: 'This member cannot receive your messages.' },
  BLOCKED_BY_ME: { fr: 'Vous avez bloqué ce membre. Débloquez-le pour lui écrire.', en: 'You blocked this member. Unblock them to write to them.' },
  QUOTA_REACHED: { fr: 'Vous avez atteint la limite de 5 messages du niveau Standard.', en: 'You have reached the 5-message limit of the Standard tier.' },
  SINGLE_MESSAGE_LIMIT: {
    fr: 'Votre premier message a déjà été envoyé. Attendez que ce membre accepte votre demande pour poursuivre la discussion.',
    en: 'Your first message has already been sent. Wait for this member to accept your request to continue the conversation.',
  },
  REQUEST_REQUIRED: { fr: 'Envoyez d’abord une demande de rencontre avant de démarrer une discussion.', en: 'Send a meeting request first before starting a conversation.' },
  REQUEST_DECLINED: { fr: 'Cette demande de rencontre a été déclinée.', en: 'This meeting request was declined.' },
};

function describe(kind: Kind, body: string, lang: Lang) {
  if (kind === 'photo') return `📷 ${L[lang].photo}`;
  if (kind === 'audio') return `🎤 ${L[lang].audio}`;
  if (kind === 'video') return `🎥 ${L[lang].video}`;
  return body;
}

// Bulle de message avec « glisser vers la droite pour répondre »
function Bubble({ msg, lang, onReply, onJump }: { msg: ChatMessage; lang: Lang; onReply: (m: ChatMessage) => void; onJump: (id: string) => void }) {
  const [dx, setDx] = useState(0);
  const dxRef = useRef(0);
  const start = useRef<{ x: number; y: number; active: boolean } | null>(null);

  const setOffset = (value: number) => { dxRef.current = value; setDx(value); };
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    start.current = { x: event.clientX, y: event.clientY, active: false };
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const mx = event.clientX - s.x;
    const my = event.clientY - s.y;
    if (!s.active) {
      if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { start.current = null; return; } // défilement vertical
      if (mx > 8 && mx > Math.abs(my)) {
        s.active = true;
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* ignoré */ }
      } else return;
    }
    setOffset(Math.max(0, Math.min(mx, 72)));
  };
  const end = () => {
    const s = start.current;
    start.current = null;
    if (s?.active && dxRef.current >= SWIPE_TRIGGER) onReply(msg);
    setOffset(0);
  };

  const time = new Date(msg.createdAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  const status: MessageStatus = msg.readAt ? 'read' : msg.deliveredAt ? 'delivered' : 'sent';
  return (
    <div className={`chat-row ${msg.fromMe ? 'mine' : 'theirs'}`} data-mid={msg.id}>
      <span className="chat-swipe-icon" style={{ opacity: Math.min(1, dx / SWIPE_TRIGGER) }} aria-hidden="true">↩</span>
      <div
        className="chat-bubble"
        style={{ transform: `translateX(${dx}px)`, transition: dx === 0 ? 'transform .18s ease' : 'none' }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {msg.reply && (
          <button type="button" className="chat-quote" onClick={() => !msg.reply?.deleted && onJump(msg.reply!.id)}>
            <strong>{msg.reply.fromMe ? L[lang].you : '…'}</strong>
            <span>{msg.reply.deleted ? L[lang].deleted : describe(msg.reply.kind, msg.reply.body, lang)}</span>
          </button>
        )}
        {msg.kind === 'photo' && msg.media && <img className="chat-photo" src={msg.media} alt={L[lang].photo} loading="lazy" />}
        {msg.kind === 'audio' && msg.media && <audio controls preload="metadata" src={msg.media} />}
        {msg.kind === 'video' && msg.media && <video className="chat-video" controls playsInline preload="metadata" src={msg.media} />}
        {msg.body && <p className="chat-text">{msg.body}</p>}
        <span className="chat-meta">
          {time}
          {msg.fromMe && <StatusTicks status={status} lang={lang} />}
          <button type="button" className="chat-reply-btn" onClick={() => onReply(msg)} aria-label={L[lang].replyTo} title={L[lang].replyTo}>↩</button>
        </span>
      </div>
    </div>
  );
}

export default function Chat({ token, profiles, initialPeerId, onPeerChange, lang, onClose, onBackToProfile, onRead, onUpgrade, onSessionExpired }: Props) {
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const onSessionExpiredRef = useRef(onSessionExpired);
  onSessionExpiredRef.current = onSessionExpired;
  const langRef = useRef(lang);
  langRef.current = lang;

  const t = L[lang];
  const [peerId, setPeerId] = useState<string | null>(initialPeerId);
  useEffect(() => { onPeerChange?.(peerId); }, [peerId, onPeerChange]); // garde la discussion ouverte dans l'adresse de la page
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [encounter, setEncounter] = useState<EncounterState | null>(null);
  const [acceptingReq, setAcceptingReq] = useState(false);
  const [peerBlocked, setPeerBlocked] = useState(false); // j'ai bloqué ce correspondant
  const [blockBusy, setBlockBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [windowInfo, setWindowInfo] = useState<Window24h | null>(null);
  const [winNow, setWinNow] = useState(() => Date.now());
  const [recording, setRecording] = useState<null | { kind: 'audio' | 'video'; elapsed: number; max: number }>(null);
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);

  const sinceRef = useRef<string | null>(null);
  const loadedPeerRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const recRef = useRef<{ recorder: MediaRecorder; stream: MediaStream; timer: ReturnType<typeof setInterval>; stopTimer: ReturnType<typeof setTimeout>; startedAt: number; cancelled: boolean; chunks: Blob[] } | null>(null);

  const peer = profiles.find((p) => p.id === peerId) || null;
  const blockedMs = quota?.limited && quota.blockedUntil ? new Date(quota.blockedUntil).getTime() - now : 0;
  const blocked = blockedMs > 0;
  // Fenêtre de 24 h : temps restant, état « en cours » ou « terminée » (le serveur reste l'autorité)
  const winRemainingMs = windowInfo?.active && windowInfo.expiresAt ? new Date(windowInfo.expiresAt).getTime() - winNow : null;
  const windowExpired = Boolean(windowInfo?.active && (windowInfo.expired || (winRemainingMs !== null && winRemainingMs <= 0)));
  const windowRunning = Boolean(windowInfo?.active) && !windowExpired;

  const isOutgoingPending = encounter?.status === 'pending' && encounter?.direction === 'outgoing';
  const isIncomingPending = encounter?.status === 'pending' && encounter?.direction === 'incoming';
  const isNoRequest = encounter?.status === 'none' || encounter?.status === 'declined';
  const singleMessageLocked = Boolean(isOutgoingPending && (encounter?.mySentMessages ?? 0) >= 1);

  // Référence stable pour ne pas déclencher de re-fetch en boucle dans les useEffect
  const handleError = useCallback((err: unknown) => {
    const currentLang = langRef.current;
    if (err instanceof ChatApiError) {
      if (err.status === 401) { onSessionExpiredRef.current(); return; }
      if (err.code === 'QUOTA_REACHED') {
        setQuota({ limited: true, limit: 5, remaining: 0, blockedUntil: err.blockedUntil || null });
      }
      if (err.code === 'BLOCKED_BY_ME') setPeerBlocked(true);
      if (err.code === 'WINDOW_24H_EXPIRED') {
        setWindowInfo((prev) => ({ active: true, expiresAt: prev?.expiresAt ?? null, expired: true, peerIsStandard: prev?.peerIsStandard ?? false, meIsStandard: prev?.meIsStandard ?? false }));
        return; // le compositeur est remplacé par le message explicite de fin de fenêtre
      }
      if (err.code === 'SINGLE_MESSAGE_LIMIT') {
        setEncounter((prev) => prev ? { ...prev, mySentMessages: Math.max(1, prev.mySentMessages), canSendMessage: false } : prev);
      }
      const known = err.code ? ERROR_TEXTS[err.code] : undefined;
      setError(known ? known[currentLang] : err.message);
    } else {
      setError(L[currentLang].network);
    }
  }, []);

  const handleReply = useCallback((msg: ChatMessage) => {
    setReplyTo(msg);
  }, []);

  // --- Liste des conversations --------------------------------------------
  useEffect(() => {
    if (peerId) return;
    loadedPeerRef.current = null;
    let cancelled = false;
    const load = async () => {
      try {
        const data = await chatApi('/api/messages', 'GET', undefined, token);
        if (cancelled) return;
        setConversations(data.conversations);
        setQuota(data.quota);
      } catch (err) {
        if (!cancelled) handleError(err);
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 8000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [peerId, token, handleError]);

  // --- Fil de discussion (actualisation toutes les 4 s) -------------------
  const merge = useCallback((incoming: ChatMessage[], replace: boolean) => {
    setMessages((current) => {
      const map = new Map<string, ChatMessage>((replace ? [] : current).map((m) => [m.id, m]));
      incoming.forEach((m) => map.set(m.id, m));
      const cutoff = Date.now() - TTL_MS;
      const next = [...map.values()]
        .filter((m) => new Date(m.createdAt).getTime() > cutoff)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (
        !replace &&
        next.length === current.length &&
        next.every((item, idx) => item.id === current[idx]?.id && item.body === current[idx]?.body && item.deliveredAt === current[idx]?.deliveredAt && item.readAt === current[idx]?.readAt)
      ) {
        return current;
      }
      return next;
    });
    const latest = incoming.reduce<string | null>((acc, m) => (!acc || m.createdAt > acc ? m.createdAt : acc), sinceRef.current);
    sinceRef.current = latest;
  }, []);

  // Met à jour les coches (distribué / vu) des messages que j'ai envoyés
  const applyReceipts = useCallback((receipts: Receipt[]) => {
    if (!receipts.length) return;
    const byId = new Map(receipts.map((r) => [r.id, r]));
    setMessages((current) => {
      let changed = false;
      const next = current.map((m) => {
        const r = byId.get(m.id);
        if (!r || (m.deliveredAt === r.deliveredAt && m.readAt === r.readAt)) return m;
        changed = true;
        return { ...m, deliveredAt: r.deliveredAt, readAt: r.readAt };
      });
      return changed ? next : current;
    });
  }, []);

  useEffect(() => {
    if (!peerId) return;
    let cancelled = false;
    const isNewPeer = loadedPeerRef.current !== peerId;
    if (isNewPeer) {
      loadedPeerRef.current = peerId;
      setMessages([]);
      setPeerBlocked(false);
      setWindowInfo(null);
      setEncounter(null);
      setReplyTo(null);
      setPending(null);
      setError('');
      sinceRef.current = null;
    }

    const load = async (initial: boolean) => {
      try {
        const query = !initial && sinceRef.current ? `?since=${encodeURIComponent(sinceRef.current)}` : '';
        const data = await chatApi(`/api/messages/${encodeURIComponent(peerId)}${query}`, 'GET', undefined, token);
        if (cancelled) return;
        merge(data.messages || [], initial);
        applyReceipts(data.receipts || []);
        if (typeof data.blockedByMe === 'boolean') setPeerBlocked(data.blockedByMe);
        if (data.quota) setQuota(data.quota);
        if (data.encounter) setEncounter(data.encounter);
        if (data.window24h) setWindowInfo(data.window24h);
        if (initial) onReadRef.current?.(); // le compteur de messages non lus se met à jour tout de suite
      } catch (err) {
        if (!cancelled) handleError(err);
      }
    };
    void load(isNewPeer);
    const timer = setInterval(() => { if (!document.hidden) void load(false); }, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [peerId, token, merge, applyReceipts, handleError]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length, peerId]);

  // --- Compte à rebours de la fenêtre de 24 h (mise à jour toutes les 15 s) ---
  useEffect(() => {
    if (!windowInfo?.active || !windowInfo.expiresAt || windowInfo.expired) return;
    setWinNow(Date.now());
    const timer = setInterval(() => setWinNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [windowInfo?.active, windowInfo?.expiresAt, windowInfo?.expired]);

  // --- Compte à rebours du quota ------------------------------------------
  useEffect(() => {
    if (!quota?.blockedUntil) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [quota?.blockedUntil]);
  useEffect(() => {
    if (quota?.blockedUntil && now >= new Date(quota.blockedUntil).getTime()) {
      // Délai écoulé : le serveur réinitialise le quota, on le relit
      chatApi('/api/chat/quota', 'GET', undefined, token).then((data) => setQuota(data.quota)).catch(handleError);
    }
  }, [now, quota?.blockedUntil, token, handleError]);

  // --- Accepter une demande reçue depuis la discussion ------------------
  const handleAcceptRequest = async () => {
    if (!encounter?.requestId || acceptingReq) return;
    setAcceptingReq(true);
    setError('');
    try {
      await chatApi(`/api/encounters/${encodeURIComponent(encounter.requestId)}/accept`, 'POST', {}, token);
      setEncounter((prev) => prev ? { ...prev, status: 'accepted', canSendMessage: true } : prev);
    } catch (err) {
      handleError(err);
    } finally {
      setAcceptingReq(false);
    }
  };

  // --- Envoi ----------------------------------------------------------------
  const toggleBlock = async () => {
    if (!peerId || blockBusy) return;
    const willBlock = !peerBlocked;
    if (willBlock && !window.confirm(t.blockConfirm)) return;
    setBlockBusy(true);
    setError('');
    try {
      if (willBlock) await chatApi('/api/blocks', 'POST', { memberId: peerId }, token);
      else await chatApi(`/api/blocks/${encodeURIComponent(peerId)}`, 'DELETE', undefined, token);
      setPeerBlocked(willBlock);
      if (willBlock) { stopRecording(true); setReplyTo(null); setPending(null); }
    } catch (err) {
      handleError(err);
    } finally {
      setBlockBusy(false);
    }
  };

  const send = async (kind: Kind, extra: { body?: string; media?: string; durationMs?: number }) => {
    if (!peerId || sending || singleMessageLocked || isNoRequest || windowExpired) return;
    setSending(true);
    setError('');
    try {
      const data = await chatApi('/api/messages', 'POST', { to: peerId, kind, ...extra, replyTo: replyTo?.id }, token);
      merge([data.message], false);
      setQuota(data.quota);
      if (data.encounter) setEncounter(data.encounter);
      if (data.window24h) setWindowInfo(data.window24h);
      setReplyTo(null);
      setNow(Date.now());
      if (kind === 'text') setDraft('');
      else setPending(null);
    } catch (err) {
      handleError(err);
    } finally {
      setSending(false);
    }
  };
  const submitText = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || blocked || singleMessageLocked || isNoRequest) return;
    void send('text', { body: draft.trim() });
  };

  // --- Photos ---------------------------------------------------------------
  const onPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError(t.notImage); return; }
    if (file.size > PHOTO_MAX_BYTES) { setError(t.photoBig); return; }
    const reader = new FileReader();
    reader.onload = () => { setError(''); setPending({ kind: 'photo', media: String(reader.result ?? '') }); };
    reader.readAsDataURL(file);
  };

  // --- Audio (15 s max) et vidéo (5 s max) ------------------------------------
  const stopRecording = useCallback((cancel = false) => {
    const rec = recRef.current;
    if (!rec) return;
    rec.cancelled = cancel;
    if (rec.recorder.state !== 'inactive') rec.recorder.stop();
  }, []);

  const startRecording = async (kind: 'audio' | 'video') => {
    setError('');
    if (singleMessageLocked || isNoRequest) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError(t.unsupported); return; }
    const max = kind === 'audio' ? AUDIO_MAX_MS : VIDEO_MAX_MS;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(
        kind === 'audio' ? { audio: true } : { audio: true, video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } } }
      );
    } catch {
      setError(t.micDenied);
      return;
    }
    const mimeType = pickMime(kind);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 32000,
        ...(kind === 'video' ? { videoBitsPerSecond: 500000 } : {}),
      });
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      setError(t.unsupported);
      return;
    }
    const startedAt = Date.now();
    const chunks: Blob[] = [];
    const timer = setInterval(() => setRecording({ kind, elapsed: Math.min(Date.now() - startedAt, max), max }), 200);
    const stopTimer = setTimeout(() => stopRecording(false), max);
    recRef.current = { recorder, stream, timer, stopTimer, startedAt, cancelled: false, chunks };

    recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
    recorder.onstop = () => {
      const rec = recRef.current;
      clearInterval(timer);
      clearTimeout(stopTimer);
      stream.getTracks().forEach((track) => track.stop());
      recRef.current = null;
      setRecording(null);
      setLiveStream(null);
      if (!rec || rec.cancelled) return;
      const durationMs = Math.min(Date.now() - startedAt, max);
      if (durationMs < 500 || !chunks.length) { setError(t.tooShort); return; }
      // On retire les paramètres de codec : « video/webm », « audio/mp4 », …
      const baseType = (recorder.mimeType || mimeType || (kind === 'audio' ? 'audio/webm' : 'video/webm')).split(';')[0];
      const blob = new Blob(chunks, { type: baseType });
      const reader = new FileReader();
      reader.onload = () => setPending({ kind, media: String(reader.result ?? ''), durationMs });
      reader.readAsDataURL(blob);
    };
    recorder.start();
    setRecording({ kind, elapsed: 0, max });
    if (kind === 'video') setLiveStream(stream);
  };

  useEffect(() => { if (videoRef.current) videoRef.current.srcObject = liveStream; }, [liveStream, recording]);
  useEffect(() => () => stopRecording(true), [stopRecording]);

  const jumpTo = (id: string) => {
    const el = listRef.current?.querySelector(`[data-mid="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1200);
    }
  };

  // --- Rendu ------------------------------------------------------------------
  const quotaLine = quota?.limited && !blocked && quota.remaining !== null && quota.limit !== null
    ? t.quota(quota.remaining, quota.limit) : null;

  return (
    <div className="chat-overlay" role="dialog" aria-modal="true" aria-label={t.title}>
      <section className="chat-panel">
        <header className="chat-header">
          {peerId
            ? <button type="button" className="chat-icon-btn" onClick={() => { stopRecording(true); setPeerId(null); setLoadingList(true); }} aria-label={t.back}>←</button>
            : onBackToProfile
              ? <button type="button" className="chat-icon-btn" onClick={onBackToProfile} aria-label={t.backToProfile}>←</button>
              : <span className="chat-icon-btn" aria-hidden="true" />}
          {peerId && peer?.photo && <img className="chat-avatar" src={peer.photo} alt="" />}
          <strong className="chat-title">{peerId ? (peer?.name || '—') : t.title}</strong>
          {peerId && (
            <button type="button" className="chat-icon-btn" onClick={() => void toggleBlock()} disabled={blockBusy} aria-label={peerBlocked ? t.unblock : t.block} title={peerBlocked ? t.unblock : t.block}>
              {peerBlocked ? '🔓' : '🚫'}
            </button>
          )}
          <button type="button" className="chat-icon-btn" onClick={onClose} aria-label={t.close}>✕</button>
        </header>
        <p className="chat-notice">{t.ttl}</p>
        <PushPrompt token={token} lang={lang} />

        {!peerId && (
          <div className="chat-list">
            {quotaLine && <p className="chat-quota">{quotaLine}</p>}
            {blocked && <p className="chat-quota warn">{t.quotaReached} {t.nextIn} {formatCountdown(blockedMs)}</p>}
            {loadingList ? <p className="chat-empty">{t.loading}</p> : conversations.length === 0
              ? <div className="chat-empty"><strong>{t.noConv}</strong><br />{t.noConvHint}</div>
              : conversations.map((c) => {
                const p = profiles.find((x) => x.id === c.peerId);
                return (
                  <button type="button" key={c.peerId} className="chat-conv" onClick={() => setPeerId(c.peerId)}>
                    {p?.photo ? <img className="chat-avatar" src={p.photo} alt="" /> : <span className="chat-avatar" />}
                    <span className="chat-conv-text">
                      <strong>{p?.name || '—'}{c.blockedByMe ? ` · ${t.blockedTag}` : ''}</strong>
                      <small>{c.fromMe && c.status && <StatusTicks status={c.status} lang={lang} />}{c.fromMe ? `${t.you} : ` : ''}{describe(c.kind, c.body, lang)}</small>
                    </span>
                  </button>
                );
              })}
            {error && <p className="chat-error" role="alert">{error}</p>}
          </div>
        )}

        {peerId && (
          <>
            {windowRunning && windowInfo && (
              <div className="chat-quota" role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span>
                  {windowInfo.meIsStandard
                    ? (winRemainingMs !== null ? t.windowMine(formatWindow(winRemainingMs)) : t.windowMineNotStarted)
                    : (winRemainingMs !== null ? t.windowPeer(formatWindow(winRemainingMs)) : t.windowPeerNotStarted)}
                </span>
                {windowInfo.meIsStandard && (
                  <button type="button" className="gold-button" style={{ padding: '6px 12px', fontSize: '0.78rem' }} onClick={onUpgrade}>{t.upgrade}</button>
                )}
              </div>
            )}
            <div className="chat-messages" ref={listRef}>
              <p className="chat-hint">{t.swipeHint}</p>
              {isOutgoingPending && !singleMessageLocked && !peerBlocked && (
                <p className="chat-quota">{t.singleMsgNotice}</p>
              )}
              {isIncomingPending && !peerBlocked && (
                <div className="chat-quota" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <span>{t.acceptIncomingNotice}</span>
                  <button type="button" className="gold-button" style={{ padding: '6px 12px', fontSize: '0.78rem' }} disabled={acceptingReq} onClick={() => void handleAcceptRequest()}>
                    {acceptingReq ? t.accepting : t.acceptBtn}
                  </button>
                </div>
              )}
              {messages.map((m) => <Bubble key={m.id} msg={m} lang={lang} onReply={handleReply} onJump={jumpTo} />)}
              <div ref={endRef} />
            </div>

            {error && <p className="chat-error" role="alert">{error}</p>}
            {quotaLine && <p className="chat-quota">{quotaLine}</p>}

            {peerBlocked ? (
              <div className="chat-blocked">
                <p><strong>{t.blockedNotice}</strong></p>
                <button type="button" className="gold-button" disabled={blockBusy} onClick={() => void toggleBlock()}>{t.unblock}</button>
              </div>
            ) : windowExpired && windowInfo ? (
              <div className="chat-blocked">
                <p><strong>{windowInfo.meIsStandard ? t.windowEndedMine : t.windowEndedPeer}</strong></p>
                {windowInfo.meIsStandard && <button type="button" className="gold-button" onClick={onUpgrade}>{t.upgrade}</button>}
              </div>
            ) : blocked ? (
              <div className="chat-blocked">
                <p><strong>{t.quotaReached}</strong></p>
                <p>{t.nextIn} <span className="chat-countdown">{formatCountdown(blockedMs)}</span></p>
                <button type="button" className="gold-button" onClick={onUpgrade}>{t.upgrade}</button>
              </div>
            ) : isNoRequest ? (
              <div className="chat-blocked">
                <p><strong>{t.noRequestNotice}</strong></p>
              </div>
            ) : singleMessageLocked ? (
              <div className="chat-blocked">
                <p><strong>{t.singleMsgUsed}</strong></p>
              </div>
            ) : (
              <div className="chat-composer">
                {replyTo && (
                  <div className="chat-replybar">
                    <span><strong>{t.replyingTo} {replyTo.fromMe ? t.you : (peer?.name || '')}</strong><br />{describe(replyTo.kind, replyTo.body, lang).slice(0, 90)}</span>
                    <button type="button" className="chat-icon-btn" onClick={() => setReplyTo(null)} aria-label={t.cancel}>✕</button>
                  </div>
                )}

                {recording && (
                  <div className="chat-recording">
                    {recording.kind === 'video' && <video ref={videoRef} className="chat-video live" muted autoPlay playsInline />}
                    <span><span className="rec-dot" /> {t.recording} {Math.ceil(recording.elapsed / 1000)}s / {recording.max / 1000}s</span>
                    <div className="chat-row-actions">
                      <button type="button" className="text-button" onClick={() => stopRecording(true)}>{t.cancel}</button>
                      <button type="button" className="gold-button" onClick={() => stopRecording(false)}>{t.stop}</button>
                    </div>
                  </div>
                )}

                {pending && !recording && (
                  <div className="chat-pending">
                    <small>{t.preview}</small>
                    {pending.kind === 'photo' && <img className="chat-photo" src={pending.media} alt="" />}
                    {pending.kind === 'audio' && <audio controls src={pending.media} />}
                    {pending.kind === 'video' && <video className="chat-video" controls playsInline src={pending.media} />}
                    <div className="chat-row-actions">
                      <button type="button" className="text-button" onClick={() => setPending(null)}>{t.cancel}</button>
                      <button type="button" className="gold-button" disabled={sending} onClick={() => void send(pending.kind, { media: pending.media, durationMs: pending.durationMs })}>{sending ? t.sending : t.send}</button>
                    </div>
                  </div>
                )}

                {!recording && !pending && (
                  <form className="chat-form" onSubmit={submitText}>
                    <button type="button" className="chat-icon-btn" onClick={() => photoInput.current?.click()} aria-label={t.photo} title={t.photo}>📷</button>
                    <button type="button" className="chat-icon-btn" onClick={() => void startRecording('audio')} aria-label={t.audio} title={`${t.audio} (15 s)`}>🎤</button>
                    <button type="button" className="chat-icon-btn" onClick={() => void startRecording('video')} aria-label={t.video} title={`${t.video} (5 s)`}>🎥</button>
                    <input className="chat-input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t.placeholder} maxLength={1000} />
                    <button type="submit" className="chat-send" disabled={sending || !draft.trim()} aria-label={t.send}>➤</button>
                  </form>
                )}
                <input ref={photoInput} className="visually-hidden" type="file" accept="image/*" onChange={onPhoto} />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}