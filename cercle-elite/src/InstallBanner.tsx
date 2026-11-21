import { useState } from 'react';
import { useInstallState, type Lang } from './pwa';

const copy = {
  fr: {
    text: 'Installez Cercle Élite sur votre téléphone pour y accéder en un geste.',
    install: 'Installer l’application',
    ios: 'Pour installer l’application : touchez le bouton Partager de Safari, puis « Sur l’écran d’accueil ».',
    later: 'Fermer',
  },
  en: {
    text: 'Install Cercle Élite on your phone for one-tap access.',
    install: 'Install the app',
    ios: 'To install the app: tap Safari’s Share button, then “Add to Home Screen”.',
    later: 'Close',
  },
} as const;

// Bandeau affiché en haut de l'intérieur de l'application, après l'écran des CGU.
// Il n'apparaît jamais si l'application est déjà installée (mode autonome, événement
// appinstalled, application détectée) ou si le navigateur ne permet pas l'installation.
export default function InstallBanner({ lang }: { lang: Lang }) {
  const { installed, dismissed, canPrompt, iosHint, install, dismiss } = useInstallState();
  const [busy, setBusy] = useState(false);
  const t = copy[lang];

  if (installed || dismissed || (!canPrompt && !iosHint)) return null;

  const onInstall = async () => {
    setBusy(true);
    try { await install(); } finally { setBusy(false); }
  };

  return (
    <div
      role="region"
      aria-label={t.install}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
        padding: '10px 16px', background: 'rgba(212, 175, 55, 0.12)', borderBottom: '1px solid rgba(212, 175, 55, 0.4)',
        fontSize: '0.85rem',
      }}
    >
      <span style={{ flex: '1 1 220px' }}>📲 {canPrompt ? t.text : t.ios}</span>
      <span style={{ display: 'inline-flex', gap: 8 }}>
        {canPrompt && <button type="button" className="gold-button" style={{ padding: '8px 14px', fontSize: '0.8rem' }} onClick={onInstall} disabled={busy}>{t.install}</button>}
        <button type="button" className="text-button" onClick={dismiss}>{t.later}</button>
      </span>
    </div>
  );
}
