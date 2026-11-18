# Cercle Élite

Application de démonstration mobile-first pour découvrir des profils et simuler
un abonnement mensuel.

## Lancer dans le workspace

```bash
pnpm install
pnpm --filter @workspace/cercle-elite run dev
```

## Parcours de démonstration

- Inscription gratuite par e-mail : le code OTP affiché dans l’application est
  `482731`.
- Le catalogue démarre avec huit profils fictifs, répartis entre les quatre
  niveaux.
- Les prix sont indicatifs et exprimés en FCFA par mois. Le parcours CinetPay
  est une simulation : aucun e-mail ni paiement réel n’est envoyé.
- Le profil créé, les niveaux débloqués et les demandes de rencontre sont
  conservés dans le stockage local du navigateur.

## Contenu

- `src/` : application React et styles.
- `public/` : manifest PWA, service worker, icônes et portraits fictifs.
