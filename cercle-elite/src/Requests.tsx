import { useCallback, useEffect, useState } from 'react';
import { Check, MessageCircle, ShieldCheck, Sparkles, X } from 'lucide-react';

// Section « Demandes » du profil : chargée à l'ouverture seulement (import dynamique depuis App.tsx).
type Lang = 'fr' | 'en';
type Box = 'received' | 'sent';
type Status = 'pending' | 'accepted' | 'declined';
type RequestItem = {
  id: string;
  type: string;
  status: Status;
  createdAt: string;
  member: { id: string; name: string; age: number | null; city: string; tier: string; photo: string; isAvatar: boolean; verified: boolean };
};
type Props = {
  lang: Lang;
  api: (path: string, method?: string, body?: unknown) => Promise<any>;
  onChat: (peerId: string) => void;
  onChanged: () => void; // met à jour compteur et boutons du catalogue après une réponse
};

const TIER_NAMES: Record<string, string> = { standard: 'Standard', confirme: 'Confirmé', vip: 'VIP', elite: 'Élite' };

const TEXT = {
  fr: {
    received: 'Reçues', sent: 'Envoyées', loading: 'Chargement…', error: 'Impossible de charger les demandes. Réessayez.', retry: 'Réessayer',
    emptyReceived: 'Aucune demande reçue pour le moment.', emptySent: 'Vous n’avez envoyé aucune demande.',
    accept: 'Accepter', decline: 'Refuser', pending: 'En attente', accepted: 'Acceptée', declined: 'Refusée',
    chat: 'Discuter', years: 'ans', avatar: 'Avatar', verified: 'Vérifié', busy: '…',
    answerError: 'La réponse n’a pas pu être enregistrée. Réessayez.', acceptedHint: 'Demande acceptée. Les messages s’effacent après 72 h.',
  },
  en: {
    received: 'Received', sent: 'Sent', loading: 'Loading…', error: 'Could not load requests. Please try again.', retry: 'Retry',
    emptyReceived: 'No request received yet.', emptySent: 'You have not sent any request.',
    accept: 'Accept', decline: 'Decline', pending: 'Pending', accepted: 'Accepted', declined: 'Declined',
    chat: 'Chat', years: 'yrs', avatar: 'Avatar', verified: 'Verified', busy: '…',
    answerError: 'Your answer could not be saved. Please try again.', acceptedHint: 'Request accepted. Messages are erased after 72 h.',
  },
} as const;

export default function Requests({ lang, api, onChat, onChanged }: Props) {
  const t = TEXT[lang];
  const [box, setBox] = useState<Box>('received');
  const [items, setItems] = useState<Record<Box, RequestItem[] | null>>({ received: null, sent: null });
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async (which: Box) => {
    setFailed(false);
    try {
      const data = await api(`/api/requests?box=${which}`);
      setItems((current) => ({ ...current, [which]: data.requests || [] }));
    } catch {
      setFailed(true);
    }
  }, [api]);

  // Seul l'onglet affiché est chargé (« Envoyées » ne l'est qu'au clic)
  useEffect(() => { if (items[box] === null) void load(box); }, [box]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = async (item: RequestItem, status: 'accepted' | 'declined') => {
    setBusyId(item.id);
    setNotice('');
    try {
      await api(`/api/requests/${encodeURIComponent(item.id)}`, 'PATCH', { status });
      setItems((current) => ({ ...current, received: (current.received || []).map((r) => (r.id === item.id ? { ...r, status } : r)) }));
      if (status === 'accepted') setNotice(t.acceptedHint);
      onChanged();
    } catch {
      setNotice(t.answerError);
      void load('received'); // l'état a peut-être changé entre-temps
    } finally {
      setBusyId(null);
    }
  };

  const list = items[box];
  const statusLabel = (status: Status) => (status === 'accepted' ? t.accepted : status === 'declined' ? t.declined : t.pending);

  return (
    <div className="req-panel">
      <div className="req-tabs" role="tablist">
        {(['received', 'sent'] as Box[]).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={box === key} className={`req-tab ${box === key ? 'active' : ''}`} onClick={() => { setNotice(''); setBox(key); }}>
            {t[key]}{items[key] ? ` (${items[key]!.length})` : ''}
          </button>
        ))}
      </div>
      {notice && <p className="req-notice" role="status">{notice}</p>}
      {failed ? (
        <p className="req-empty">{t.error} <button type="button" className="link-button" onClick={() => void load(box)}>{t.retry}</button></p>
      ) : list === null ? (
        <p className="req-empty" role="status">{t.loading}</p>
      ) : list.length === 0 ? (
        <p className="req-empty">{box === 'received' ? t.emptyReceived : t.emptySent}</p>
      ) : (
        <ul className="req-list">
          {list.map((item) => {
            const m = item.member;
            const busy = busyId === item.id;
            return (
              <li key={item.id} className="req-item">
                <img className="req-photo" src={m.photo} alt="" width={56} height={56} loading="lazy" decoding="async" />
                <div className="req-body">
                  <div className="req-name">
                    <strong>{m.name}</strong>{m.age ? <span>{m.age} {t.years}</span> : null}
                  </div>
                  <div className="req-meta">
                    {[m.city, TIER_NAMES[m.tier] || m.tier].filter(Boolean).join(' · ')}
                    {' · '}
                    {m.isAvatar ? <span className="req-badge"><Sparkles size={10} /> {t.avatar}</span> : <span className="req-badge"><ShieldCheck size={10} /> {t.verified}</span>}
                  </div>
                  <div className="req-actions">
                    {box === 'received' && item.status === 'pending' ? (
                      <>
                        <button type="button" className="gold-button req-btn" disabled={busy} onClick={() => void answer(item, 'accepted')}><Check size={14} /> {busy ? t.busy : t.accept}</button>
                        <button type="button" className="outline-button req-btn" disabled={busy} onClick={() => void answer(item, 'declined')}><X size={14} /> {t.decline}</button>
                      </>
                    ) : (
                      <span className={`req-status ${item.status}`}>{statusLabel(item.status)}</span>
                    )}
                    {item.status === 'accepted' && (
                      <button type="button" className="outline-button req-btn" onClick={() => onChat(m.id)}><MessageCircle size={14} /> {t.chat}</button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
