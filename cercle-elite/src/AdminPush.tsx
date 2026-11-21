import { useCallback, useEffect, useState } from 'react';
import { isIos, isStandalone, pushSupported, subscribePush } from './pwa';

type CallFn = (path: string, method?: string, body?: unknown) => Promise<any>;
type State = 'loading' | 'disabled' | 'unsupported' | 'ios-install' | 'denied' | 'inactive' | 'active';

const SUBSCRIBE_PATH = '/api/admin/push/subscribe';
const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'Erreur inattendue.');

// Activation des notifications push de l'administrateur sur cet appareil :
// chaque nouvelle demande d'abonnement déclenche une notification qui ouvre /admin.
export default function AdminPush({ token, call }: { token: string; call: CallFn }) {
  const [state, setState] = useState<State>('loading');
  const [publicKey, setPublicKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const config = await call('/push/config');
      if (!config.enabled || !config.publicKey) { setState('disabled'); return; }
      setPublicKey(config.publicKey);
      if (!pushSupported()) { setState(isIos() && !isStandalone() ? 'ios-install' : 'unsupported'); return; }
      if (Notification.permission === 'denied') { setState('denied'); return; }
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (Notification.permission === 'granted' && subscription) {
        const status = await call('/push/status', 'POST', { endpoint: subscription.endpoint });
        setState(status.subscribed ? 'active' : 'inactive');
        return;
      }
      setState('inactive');
    } catch (e) {
      setError(errMsg(e));
      setState('unsupported');
    }
  }, [call]);
  useEffect(() => { void refresh(); }, [refresh]);

  const enable = async () => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') { setState(permission === 'denied' ? 'denied' : 'inactive'); return; }
      const ok = await subscribePush(token, publicKey, SUBSCRIBE_PATH);
      if (!ok) throw new Error('Activation impossible pour le moment. Réessayez.');
      setState('active');
      setInfo('Notifications activées sur cet appareil.');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  // Retire seulement cet appareil des notifications admin (l'abonnement du navigateur est conservé)
  const disable = async () => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription) await call('/push/unsubscribe', 'POST', { endpoint: subscription.endpoint });
      setState('inactive');
      setInfo('Notifications désactivées sur cet appareil.');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const d = await call('/push/test', 'POST', {});
      setInfo(d.sent > 0 ? `Notification de test envoyée (${d.sent} appareil${d.sent > 1 ? 's' : ''}).` : 'Aucun appareil abonné : activez d’abord les notifications.');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') return null;
  return (
    <section className="adm-card">
      <h2>Notifications sur cet appareil</h2>
      {state === 'disabled' && <p className="adm-muted">Les notifications ne sont pas configurées sur le serveur (variables VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY manquantes).</p>}
      {state === 'unsupported' && <p className="adm-muted">Ce navigateur ne prend pas en charge les notifications push.</p>}
      {state === 'ios-install' && <p className="adm-muted">Sur iPhone, installez d’abord Cercle Élite sur l’écran d’accueil (Partager → Sur l’écran d’accueil), ouvrez l’application, puis revenez sur /admin pour activer les notifications.</p>}
      {state === 'denied' && <p className="adm-muted">Les notifications sont bloquées pour ce site : autorisez-les dans les réglages du navigateur, puis rechargez cette page.</p>}
      {state === 'inactive' && <>
        <p className="adm-muted">Recevez une notification à chaque nouvelle demande d’abonnement.</p>
        <button className="adm-btn adm-btn-gold" onClick={enable} disabled={busy}>{busy ? 'Activation…' : 'Activer les notifications'}</button>
      </>}
      {state === 'active' && <>
        <p className="adm-info">Notifications actives sur cet appareil ✓</p>
        <div className="adm-actions">
          <button className="adm-btn" onClick={sendTest} disabled={busy}>Envoyer un test</button>
          <button className="adm-btn adm-btn-danger" onClick={disable} disabled={busy}>Désactiver</button>
        </div>
      </>}
      {error && <p className="adm-error" role="alert">{error}</p>}
      {info && <p className="adm-info" role="status">{info}</p>}
    </section>
  );
}
