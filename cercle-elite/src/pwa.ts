import { useEffect, useReducer, useState } from 'react';

export type Lang = 'fr' | 'en';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const INSTALLED_KEY = 'cercle_pwa_installed';
export const INSTALL_DISMISSED_KEY = 'cercle_install_dismissed_at';
export const PUSH_DISMISSED_KEY = 'cercle_push_dismissed_at';
const DAY_MS = 86400000;

const readKey = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const writeKey = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* stockage indisponible */ }
};
const removeKey = (key: string) => {
  try { localStorage.removeItem(key); } catch { /* stockage indisponible */ }
};

export const wasDismissedRecently = (key: string, days: number): boolean => {
  const raw = readKey(key);
  const at = raw ? Number(raw) : 0;
  return Boolean(at) && Date.now() - at < days * DAY_MS;
};
export const markDismissed = (key: string) => writeKey(key, String(Date.now()));

// ---------------------------------------------------------------------------
// Installation de l'application (PWA)
// L'événement `beforeinstallprompt` peut survenir avant l'affichage du bandeau
// (par exemple pendant l'écran des CGU) : on le capture dès le chargement du module.
// ---------------------------------------------------------------------------
let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notifyListeners = () => listeners.forEach((listener) => listener());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    removeKey(INSTALLED_KEY); // le navigateur propose l'installation : l'application n'est donc pas installée
    notifyListeners();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    writeKey(INSTALLED_KEY, '1');
    notifyListeners();
  });
}

export const isStandalone = (): boolean => {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    nav.standalone === true
  );
};

export const isIos = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

// Sur iOS, seul Safari permet « Ajouter à l'écran d'accueil »
const isIosSafari = (): boolean => isIos() && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/i.test(navigator.userAgent);

export function useInstallState() {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [relatedInstalled, setRelatedInstalled] = useState(false);

  useEffect(() => {
    listeners.add(rerender);
    return () => { listeners.delete(rerender); };
  }, []);

  useEffect(() => {
    const nav = navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> };
    if (typeof nav.getInstalledRelatedApps !== 'function') return;
    let alive = true;
    nav.getInstalledRelatedApps()
      .then((apps) => { if (alive && apps.length > 0) setRelatedInstalled(true); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const standalone = isStandalone();
  const flagged = readKey(INSTALLED_KEY) === '1';
  const installed = standalone || (!deferredPrompt && (relatedInstalled || flagged));
  const dismissed = wasDismissedRecently(INSTALL_DISMISSED_KEY, 7);

  const install = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferredPrompt) return 'unavailable';
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (choice.outcome === 'accepted') writeKey(INSTALLED_KEY, '1');
    notifyListeners();
    return choice.outcome;
  };
  const dismiss = () => {
    markDismissed(INSTALL_DISMISSED_KEY);
    rerender();
  };

  return {
    installed,
    dismissed,
    canPrompt: Boolean(deferredPrompt) && !installed,
    iosHint: !deferredPrompt && !installed && isIosSafari(),
    install,
    dismiss,
  };
}

// ---------------------------------------------------------------------------
// Service worker et notifications push
// ---------------------------------------------------------------------------
export const registerServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
};

export const pushSupported = (): boolean =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function fetchPushConfig(): Promise<{ enabled: boolean; publicKey: string | null }> {
  try {
    const response = await fetch('/api/push/config');
    const data = await response.json();
    return { enabled: Boolean(data.enabled), publicKey: data.publicKey || null };
  } catch {
    return { enabled: false, publicKey: null };
  }
}

const urlBase64ToUint8Array = (base64: string): Uint8Array => {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
};

const getRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  const created = await registerServiceWorker();
  if (!created) return null;
  await navigator.serviceWorker.ready;
  return created;
};

// Crée (ou retrouve) l'abonnement push de cet appareil et le rattache au membre connecté
export async function subscribePush(token: string, publicKey: string, path = '/api/push/subscribe'): Promise<boolean> {
  const registration = await getRegistration();
  if (!registration) return false;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  }
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  return response.ok;
}

// À la déconnexion : cet appareil ne doit plus recevoir les notifications du compte
export async function disablePush(token: string | null): Promise<void> {
  try {
    if (!pushSupported()) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    if (!subscription) return;
    if (token) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => undefined);
    }
    await subscription.unsubscribe();
  } catch { /* meilleur effort */ }
}
