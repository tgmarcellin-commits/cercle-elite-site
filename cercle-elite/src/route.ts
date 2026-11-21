// Adresse de la page : le « #/niveau/<niveau>/<écran>/<détail> » garde l'écran courant au rechargement.
// Exemples : #/niveau/vip · #/niveau/vip/messages/12 · #/niveau/standard/profil · #/niveau/elite/debloquer/elite
export type RouteLayer = 'messages' | 'profil' | 'connexion' | 'inscription' | 'debloquer' | 'cgu' | 'confidentialite';
export type AppRoute = { tier: string | null; layer: RouteLayer | null; arg: string | null };

const LAYERS: string[] = ['messages', 'profil', 'connexion', 'inscription', 'debloquer', 'cgu', 'confidentialite'];

const safeDecode = (value: string) => {
  try { return decodeURIComponent(value); } catch { return value; }
};

export function parseRoute(hash: string = typeof window === 'undefined' ? '' : window.location.hash): AppRoute {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(safeDecode);
  if (parts[0] !== 'niveau') return { tier: null, layer: null, arg: null };
  const layer = LAYERS.includes(parts[2]) ? (parts[2] as RouteLayer) : null;
  return { tier: parts[1] ?? null, layer, arg: layer ? (parts[3] ?? null) : null };
}

// Met à jour l'adresse sans recharger ni ajouter d'entrée à l'historique (le bouton retour garde son comportement).
export function writeRoute(route: { tier: string; layer: RouteLayer | null; arg?: string | null }): void {
  if (typeof window === 'undefined') return;
  let hash = '';
  if (!(route.tier === 'standard' && !route.layer)) {
    hash = `#/niveau/${encodeURIComponent(route.tier)}`;
    if (route.layer) {
      hash += `/${route.layer}`;
      if (route.arg) hash += `/${encodeURIComponent(route.arg)}`;
    }
  }
  if (window.location.hash === hash) return;
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hash}`);
}
