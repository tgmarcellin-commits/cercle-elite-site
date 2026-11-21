import { useEffect, useState } from 'react';
import {
  PUSH_DISMISSED_KEY, fetchPushConfig, isIos, isStandalone, markDismissed, pushSupported, subscribePush,
  wasDismissedRecently, type Lang,
} from './pwa';

type Status = 'hidden' | 'prompt' | 'ios-install' | 'working' | 'done';

const copy = {
  fr: {
    prompt: 'Activez les notifications pour ne manquer aucun message.',
    enable: 'Activer',
    later: 'Plus tard',
    ios: 'Sur iPhone, ajoutez d’abord Cercle Élite à l’écran d’accueil (Partager → Sur l’écran d’accueil), puis activez les notifications ici.',
    done: 'Notifications activées ✓',
    error: 'Activation impossible pour le moment. Réessayez.',
  },
  en: {
    prompt: 'Turn on notifications so you never miss a message.',
    enable: 'Enable',
    later: 'Later',
    ios: 'On iPhone, first add Cercle Élite to your Home Screen (Share → Add to Home Screen), then enable notifications here.',
    done: 'Notifications enabled ✓',
    error: 'Could not enable notifications right now. Please try again.',
  },
} as const;

// Invitation à activer les notifications push, affichée dans la section de discussion.
// Elle vérifie d'abord l'état réel : déjà activées → aucune invitation (l'appareil est
// simplement rattaché au compte) ; refusées par le navigateur → rien n'est affiché.
export default function PushPrompt({ token, lang }: { token: string; lang: Lang }) {
  const [status, setStatus] = useState<Status>('hidden');
  const [publicKey, setPublicKey] = useState('');
  const [error, setError] = useState('');
  const t = copy[lang];

  useEffect(() => {
    let alive = true;
    (async () => {
      const config = await fetchPushConfig();
      if (!alive || !config.enabled || !config.publicKey) return;
      setPublicKey(config.publicKey);
      if (!pushSupported()) {
        if (isIos() && !isStandalone() && !wasDismissedRecently(PUSH_DISMISSED_KEY, 3)) setStatus('ios-install');
        return;
      }
      if (Notification.permission === 'granted') {
        await subscribePush(token, config.publicKey).catch(() => false);
        return;
      }
      if (Notification.permission === 'default' && !wasDismissedRecently(PUSH_DISMISSED_KEY, 3)) setStatus('prompt');
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [token]);

  useEffect(() => {
    if (status !== 'done') return;
    const timer = setTimeout(() => setStatus('hidden'), 4000);
    return () => clearTimeout(timer);
  }, [status]);

  const enable = async () => {
    setStatus('working');
    setError('');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setStatus('hidden'); return; }
      const ok = await subscribePush(token, publicKey);
      if (ok) setStatus('done');
      else { setStatus('prompt'); setError(t.error); }
    } catch {
      setStatus('prompt');
      setError(t.error);
    }
  };
  const later = () => { markDismissed(PUSH_DISMISSED_KEY); setStatus('hidden'); };

  if (status === 'hidden') return null;
  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap',
        margin: '8px 12px 0', padding: '8px 12px', borderRadius: 10, fontSize: '0.8rem',
        border: '1px solid rgba(212, 175, 55, 0.4)', background: 'rgba(212, 175, 55, 0.1)',
      }}
    >
      <span style={{ flex: '1 1 200px' }}>
        🔔 {status === 'done' ? t.done : status === 'ios-install' ? t.ios : t.prompt}
        {error && <span style={{ color: '#ff8b8b' }}> {error}</span>}
      </span>
      {(status === 'prompt' || status === 'working') && (
        <span style={{ display: 'inline-flex', gap: 8 }}>
          <button type="button" className="gold-button" style={{ padding: '6px 12px', fontSize: '0.78rem' }} onClick={enable} disabled={status === 'working'}>{t.enable}</button>
          <button type="button" className="text-button" onClick={later}>{t.later}</button>
        </span>
      )}
      {status === 'ios-install' && <button type="button" className="text-button" onClick={later}>{t.later}</button>}
    </div>
  );
}
