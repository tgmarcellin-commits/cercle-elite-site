import { useEffect, useState } from 'react';

export type LegalDoc = 'cgu' | 'privacy';
export type LegalLang = 'fr' | 'en';

const CONTACT = { fr: 'cercleelite7@gmail.com', en: 'cercleelite7@gmail.com' };
const UPDATED = { fr: '18 novembre 2026', en: 'November 18, 2026' };

type Article = { title: string; paragraphs?: string[]; commitment?: string[] };
type DocSet = Record<LegalDoc, { title: string; articles: Article[] }>;

const DOCS: Record<LegalLang, DocSet> = {
  fr: {
    cgu: {
      title: 'Conditions Générales d’Utilisation',
      articles: [
        { title: 'Article 1 — Objet', paragraphs: ['Les présentes Conditions Générales d’Utilisation (CGU) encadrent l’accès et l’utilisation de Cercle Élite, plateforme de rencontres en ligne (le « Service »). En utilisant le Service, vous acceptez les CGU sans réserve.'] },
        { title: 'Article 2 — Accès réservé aux personnes majeures', paragraphs: [
          'Le Service est strictement réservé aux personnes âgées d’au moins 18 ans. En accédant au Service et en créant un compte, vous certifiez être majeur(e). Votre date de naissance est demandée à l’inscription.',
          'Cette certification est déclarative. Cercle Élite se réserve le droit de demander toute preuve utile et de suspendre ou supprimer sans préavis tout compte dont le titulaire serait mineur ou dont l’âge serait mensonger.'] },
        { title: 'Article 3 — Compte et sécurité', paragraphs: [
          'L’inscription nécessite une adresse e-mail valide, un mot de passe et la saisie d’un code de vérification envoyé par e-mail. Chaque connexion est confirmée par un nouveau code.',
          'Vous êtes responsable de la confidentialité de vos identifiants. Les informations fournies doivent être exactes ; la photo de profil doit vous représenter. L’usurpation d’identité est interdite.'] },
        { title: 'Article 4 — Niveaux d’accès', paragraphs: ['Le Service propose plusieurs niveaux (Standard, Confirmé, VIP, Élite) donnant accès à des catalogues de profils différents. Les tarifs et conditions de chaque niveau vous sont présentés avant toute souscription.'] },
        { title: 'Article 5 — Messagerie privée', paragraphs: [
          'Les membres peuvent échanger des messages écrits, des photos, des messages audio (15 secondes maximum) et des vidéos (5 secondes maximum).',
          'Le niveau Standard est limité à 5 messages. Une fois cette limite atteinte, l’envoi est suspendu pendant 5 heures, puis le quota est automatiquement réinitialisé. Les niveaux supérieurs ne sont pas soumis à cette limite.',
          'Par mesure de confidentialité, tous les messages (texte, photos, audio, vidéo) sont supprimés automatiquement et définitivement 72 heures après leur envoi. Ils ne peuvent pas être récupérés.'] },
        { title: 'Article 6 — Règles de conduite', paragraphs: [
          'Il est interdit de : harceler, menacer ou insulter un membre ; publier ou envoyer des contenus illicites, violents, haineux ou à caractère pornographique ; demander ou proposer de l’argent, des cadeaux ou des investissements ; collecter, diffuser ou capturer les photos et messages d’autres membres sans leur accord ; utiliser le Service à des fins commerciales ou frauduleuses.',
          'Vous restez seul(e) responsable des contenus que vous publiez ou envoyez.'] },
        { title: 'Article 7 — Modération et suspension', paragraphs: ['En cas de manquement aux CGU, Cercle Élite peut supprimer un contenu, suspendre ou supprimer un compte, sans remboursement des sommes éventuellement versées pour la période en cours.'] },
        { title: 'Article 8 — Responsabilité', paragraphs: [
          'Cercle Élite met à disposition un outil de mise en relation et ne garantit ni la sincérité des membres, ni l’issue des échanges. Soyez prudent(e) : ne communiquez jamais d’informations bancaires et donnez vos premiers rendez-vous dans un lieu public.',
          'Le Service est fourni « en l’état » ; nous ne garantissons pas une disponibilité ininterrompue.'] },
        { title: 'Article 9 — Données personnelles', paragraphs: ['Le traitement de vos données est décrit dans la Politique de Confidentialité, qui fait partie intégrante des CGU.'] },
        { title: 'Article 10 — Modification des CGU et droit applicable', paragraphs: [
          'Les CGU peuvent évoluer ; la version en vigueur est celle publiée sur le Service. Vous serez invité(e) à les accepter de nouveau en cas de changement important.',
          '[Droit applicable et juridiction compétente à compléter.]', `Contact : ${CONTACT.fr}`] },
      ],
    },
    privacy: {
      title: 'Politique de Confidentialité',
      articles: [
        { title: 'Article 1 — Responsable du traitement', paragraphs: [`Cercle Élite est responsable du traitement de vos données personnelles. Contact : ${CONTACT.fr}`] },
        { title: 'Article 2 — Données collectées', paragraphs: [
          'Données de compte : adresse e-mail, mot de passe (conservé uniquement sous forme chiffrée irréversible).',
          'Données de profil : pseudonyme, date de naissance, genre, genre recherché, ville, biographie, photo de profil, niveau choisi.',
          'Contenus de conversation : messages écrits, photos, audio et vidéos envoyés dans la messagerie privée.',
          'Données techniques strictement nécessaires : jeton de session, date d’acceptation des CGU, journaux techniques de sécurité.'] },
        { title: 'Article 3 — Finalités', paragraphs: ['Vos données servent uniquement à : créer et sécuriser votre compte, afficher votre profil aux autres membres selon les niveaux d’accès, permettre la messagerie privée, vérifier votre majorité, et assurer le bon fonctionnement et la sécurité du Service.'] },
        { title: 'Article 4 — Engagement de stricte confidentialité et de non-divulgation',
          commitment: ['Les informations personnelles, les données d’identification, les profils ainsi que toutes les photos (partagées dans les profils ou envoyées dans les conversations privées) sont strictement confidentielles. Elles ne seront en aucun cas vendues, cédées, louées ou partagées avec des tiers, des annonceurs ou qui que ce soit d’autre, sous aucune circonstance.'],
          paragraphs: ['Aucune de vos données n’est utilisée à des fins publicitaires ou de prospection par des tiers.'] },
        { title: 'Article 5 — Accès limité aux nécessités techniques', paragraphs: ['L’accès aux données est strictement limité aux nécessités techniques du fonctionnement de la plateforme sécurisée Cercle-Elite.'] },
        { title: 'Article 6 — Prestataires techniques et obligations légales', paragraphs: [
          'Pour fonctionner, Cercle Élite s’appuie sur des prestataires techniques (hébergement de l’application, base de données, envoi des e-mails de vérification). Ils n’agissent que pour faire fonctionner le Service, selon nos instructions, et n’ont pas le droit d’utiliser vos données pour leur propre compte : ils ne sont pas des « tiers » au sens de l’article 4.',
          'Seule une obligation légale impérative (réquisition d’une autorité judiciaire compétente) pourrait nous contraindre à communiquer des données ; nous vous en informerions dans la mesure permise par la loi.'] },
        { title: 'Article 7 — Durée de conservation', paragraphs: [
          'Les messages (texte, photos, audio, vidéos) sont supprimés automatiquement et définitivement de nos serveurs 72 heures après leur envoi.',
          'Les données de compte et de profil sont conservées tant que votre compte est actif, puis supprimées à votre demande.'] },
        { title: 'Article 8 — Sécurité', paragraphs: ['Mots de passe chiffrés de manière irréversible, vérification par code à usage unique envoyé par e-mail, connexions chiffrées (HTTPS), accès aux données limité aux seules opérations techniques nécessaires.'] },
        { title: 'Article 9 — Vos droits', paragraphs: ['Vous pouvez à tout moment demander l’accès à vos données, leur rectification ou la suppression de votre compte et de vos données, en nous écrivant à l’adresse de contact ci-dessus. Vous pouvez modifier votre photo, votre pseudonyme et votre biographie depuis votre espace Profil.'] },
        { title: 'Article 10 — Mineurs', paragraphs: ['Le Service est interdit aux moins de 18 ans. Tout compte de mineur identifié sera supprimé.'] },
      ],
    },
  },
  en: {
    cgu: {
      title: 'Terms of Use',
      articles: [
        { title: 'Article 1 — Purpose', paragraphs: ['These Terms of Use govern access to and use of Cercle Élite, an online dating platform (the “Service”). By using the Service you accept these Terms without reservation.'] },
        { title: 'Article 2 — Adults only', paragraphs: [
          'The Service is strictly reserved for people aged 18 or over. By accessing the Service and creating an account, you certify that you are an adult. Your date of birth is requested at registration.',
          'This certification is declarative. Cercle Élite may request any appropriate proof and may suspend or delete without notice any account held by a minor or whose stated age is false.'] },
        { title: 'Article 3 — Account and security', paragraphs: [
          'Registration requires a valid e-mail address, a password and a verification code sent by e-mail. Each sign-in is confirmed with a new code.',
          'You are responsible for keeping your credentials confidential. Information you provide must be accurate and your profile photo must show you. Impersonation is prohibited.'] },
        { title: 'Article 4 — Access tiers', paragraphs: ['The Service offers several tiers (Standard, Confirmed, VIP, Elite) giving access to different catalogues of profiles. Prices and conditions for each tier are shown before any subscription.'] },
        { title: 'Article 5 — Private messaging', paragraphs: [
          'Members may exchange written messages, photos, voice messages (15 seconds maximum) and videos (5 seconds maximum).',
          'The Standard tier is limited to 5 messages. Once this limit is reached, sending is suspended for 5 hours, after which the quota is reset automatically. Higher tiers are not subject to this limit.',
          'For privacy reasons, all messages (text, photos, audio, video) are automatically and permanently deleted 72 hours after being sent. They cannot be recovered.'] },
        { title: 'Article 6 — Rules of conduct', paragraphs: [
          'You must not: harass, threaten or insult a member; post or send illegal, violent, hateful or pornographic content; ask for or offer money, gifts or investments; collect, share or capture other members’ photos and messages without their consent; use the Service for commercial or fraudulent purposes.',
          'You remain solely responsible for the content you post or send.'] },
        { title: 'Article 7 — Moderation and suspension', paragraphs: ['In case of breach of these Terms, Cercle Élite may remove content and suspend or delete an account, without refund of any amount paid for the current period.'] },
        { title: 'Article 8 — Liability', paragraphs: [
          'Cercle Élite provides a matchmaking tool and does not guarantee the sincerity of members or the outcome of any exchange. Be careful: never share banking information and meet in a public place first.',
          'The Service is provided “as is”; uninterrupted availability is not guaranteed.'] },
        { title: 'Article 9 — Personal data', paragraphs: ['The processing of your data is described in the Privacy Policy, which forms an integral part of these Terms.'] },
        { title: 'Article 10 — Changes and governing law', paragraphs: [
          'These Terms may change; the version in force is the one published on the Service. You will be asked to accept them again in case of significant changes.',
          '[Governing law and competent jurisdiction to be completed.]', `Contact: ${CONTACT.en}`] },
      ],
    },
    privacy: {
      title: 'Privacy Policy',
      articles: [
        { title: 'Article 1 — Data controller', paragraphs: [`Cercle Élite is the controller of your personal data. Contact: ${CONTACT.en}`] },
        { title: 'Article 2 — Data collected', paragraphs: [
          'Account data: e-mail address, password (stored only in an irreversibly encrypted form).',
          'Profile data: pseudonym, date of birth, gender, gender sought, city, biography, profile photo, chosen tier.',
          'Conversation content: written messages, photos, audio and videos sent through private messaging.',
          'Strictly necessary technical data: session token, date of acceptance of the Terms, technical security logs.'] },
        { title: 'Article 3 — Purposes', paragraphs: ['Your data is used only to: create and secure your account, show your profile to other members according to access tiers, enable private messaging, verify that you are an adult, and ensure the proper functioning and security of the Service.'] },
        { title: 'Article 4 — Commitment to strict confidentiality and non-disclosure',
          commitment: ['Personal information, identification data, profiles and all photos (shared in profiles or sent in private conversations) are strictly confidential. They will in no case be sold, transferred, rented or shared with third parties, advertisers or anyone else, under any circumstances.'],
          paragraphs: ['None of your data is used for advertising or prospecting by third parties.'] },
        { title: 'Article 5 — Access limited to technical needs', paragraphs: ['Access to data is strictly limited to the technical needs of operating the secure Cercle-Elite platform.'] },
        { title: 'Article 6 — Technical providers and legal obligations', paragraphs: [
          'To operate, Cercle Élite relies on technical providers (application hosting, database, sending of verification e-mails). They act only to run the Service, on our instructions, and may not use your data for their own purposes: they are not “third parties” within the meaning of Article 4.',
          'Only a mandatory legal obligation (an order from a competent judicial authority) could compel us to disclose data; we would inform you to the extent permitted by law.'] },
        { title: 'Article 7 — Retention', paragraphs: [
          'Messages (text, photos, audio, videos) are automatically and permanently deleted from our servers 72 hours after being sent.',
          'Account and profile data are kept while your account is active, then deleted on your request.'] },
        { title: 'Article 8 — Security', paragraphs: ['Irreversibly encrypted passwords, one-time code verification sent by e-mail, encrypted connections (HTTPS), data access limited to necessary technical operations.'] },
        { title: 'Article 9 — Your rights', paragraphs: ['You may at any time request access to your data, its correction, or deletion of your account and data by writing to the contact address above. You can change your photo, pseudonym and biography from your Profile area.'] },
        { title: 'Article 10 — Minors', paragraphs: ['The Service is prohibited for people under 18. Any minor’s account identified will be deleted.'] },
      ],
    },
  },
};

const UI = {
  fr: {
    kicker: 'Cadre légal', close: 'Fermer', readClose: 'J’ai lu, fermer', read: 'Lire : ',
    updated: 'Dernière mise à jour : ',
    welcome: 'Bienvenue sur Cercle Élite', before: 'Avant d’entrer.',
    adultsOnly: 'Cercle Élite est réservé aux adultes. Pour accéder au site, confirmez les deux points ci-dessous.',
    adult: 'Je certifie être âgé(e) d’au moins 18 ans.',
    accept1: 'J’ai lu et j’accepte les', cguLink: 'Conditions Générales d’Utilisation (CGU)', and: 'et la', privLink: 'Politique de Confidentialité',
    accept2: '(incluant l’engagement de stricte confidentialité de mes données et photos).',
    promise: 'Vos données, vos profils et vos photos ne sont jamais vendus, cédés, loués ni partagés.',
    enter: 'Entrer sur Cercle Élite',
    recapTerms: 'J’ai lu et j’accepte les CGU et la Politique de Confidentialité (incluant l’engagement de stricte confidentialité de mes données et photos).',
    reread: 'Relire les CGU', rereadPrivacy: 'Relire la Politique de Confidentialité',
  },
  en: {
    kicker: 'Legal framework', close: 'Close', readClose: 'I have read it, close', read: 'Read: ',
    updated: 'Last updated: ',
    welcome: 'Welcome to Cercle Élite', before: 'Before you enter.',
    adultsOnly: 'Cercle Élite is for adults only. To access the site, please confirm the two points below.',
    adult: 'I certify that I am at least 18 years old.',
    accept1: 'I have read and accept the', cguLink: 'Terms of Use', and: 'and the', privLink: 'Privacy Policy',
    accept2: '(including the commitment to strict confidentiality of my data and photos).',
    promise: 'Your data, profiles and photos are never sold, transferred, rented or shared.',
    enter: 'Enter Cercle Élite',
    recapTerms: 'I have read and accept the Terms of Use and the Privacy Policy (including the commitment to strict confidentiality of my data and photos).',
    reread: 'Re-read the Terms of Use', rereadPrivacy: 'Re-read the Privacy Policy',
  },
} as const;

function LegalArticles({ doc, lang }: { doc: LegalDoc; lang: LegalLang }) {
  return (
    <div className="legal-text">
      <p className="legal-updated">{UI[lang].updated}{UPDATED[lang]}</p>
      {DOCS[lang][doc].articles.map((article) => (
        <section key={article.title} className={article.commitment ? 'legal-article legal-highlight' : 'legal-article'}>
          <h3>{article.title}</h3>
          {article.commitment?.map((text) => <p key={text} className="legal-commit"><u><strong>{text}</strong></u></p>)}
          {article.paragraphs?.map((text) => <p key={text}>{text}</p>)}
        </section>
      ))}
    </div>
  );
}

// Lecture intégrale d'un document (au-dessus de tout, y compris du modal bloquant)
export function LegalViewer({ doc, lang, onClose, onSwitch }: { doc: LegalDoc; lang: LegalLang; onClose: () => void; onSwitch: (doc: LegalDoc) => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const other: LegalDoc = doc === 'cgu' ? 'privacy' : 'cgu';
  return (
    <div className="legal-viewer" role="dialog" aria-modal="true" aria-labelledby="legal-title">
      <section className="modal legal-viewer-card">
        <button className="modal-close" onClick={onClose} aria-label={UI[lang].close}>✕</button>
        <div className="modal-kicker">{UI[lang].kicker}</div>
        <h2 id="legal-title">{DOCS[lang][doc].title}</h2>
        <LegalArticles doc={doc} lang={lang} />
        <div className="modal-actions">
          <button type="button" className="text-button" onClick={() => onSwitch(other)}>{UI[lang].read}{DOCS[lang][other].title}</button>
          <button type="button" className="gold-button" onClick={onClose}>{UI[lang].readClose}</button>
        </div>
      </section>
    </div>
  );
}

// Modal bloquant à la première visite
export function LegalGate({ lang, onToggleLang, onAccept, onOpenDoc }: { lang: LegalLang; onToggleLang: () => void; onAccept: () => void; onOpenDoc: (doc: LegalDoc) => void }) {
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const ui = UI[lang];
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);
  return (
    <div className="legal-gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <section className="modal legal-gate-card">
        <button type="button" className="link-button legal-lang" onClick={onToggleLang} aria-label="Language">{lang === 'fr' ? 'EN' : 'FR'}</button>
        <div className="modal-kicker">{ui.welcome}</div>
        <h2 id="gate-title">{ui.before}</h2>
        <p className="modal-subtitle">{ui.adultsOnly}</p>
        <label className="check-row">
          <input type="checkbox" checked={adult} onChange={(event) => setAdult(event.target.checked)} />
          <span>{ui.adult}</span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} />
          <span>
            {ui.accept1}{' '}
            <button type="button" className="link-button" onClick={() => onOpenDoc('cgu')}>{ui.cguLink}</button>{' '}
            {ui.and}{' '}
            <button type="button" className="link-button" onClick={() => onOpenDoc('privacy')}>{ui.privLink}</button>{' '}
            {ui.accept2}
          </span>
        </label>
        <p className="legal-commit-note"><u><strong>{ui.promise}</strong></u></p>
        <div className="modal-actions">
          <span />
          <button type="button" className="gold-button" disabled={!(adult && terms)} onClick={onAccept}>{ui.enter}</button>
        </div>
      </section>
    </div>
  );
}

// Rappel permanent dans l'espace Profil : cases cochées + liens de relecture
export function LegalConsentRecap({ lang, onOpenDoc }: { lang: LegalLang; onOpenDoc: (doc: LegalDoc) => void }) {
  const ui = UI[lang];
  return (
    <div className="legal-recap">
      <label className="check-row">
        <input type="checkbox" checked disabled readOnly onChange={() => undefined} />
        <span>{ui.adult}</span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked disabled readOnly onChange={() => undefined} />
        <span>{ui.recapTerms}</span>
      </label>
      <div className="legal-recap-links">
        <button type="button" className="link-button" onClick={() => onOpenDoc('cgu')}>{ui.reread}</button>
        <button type="button" className="link-button" onClick={() => onOpenDoc('privacy')}>{ui.rereadPrivacy}</button>
      </div>
    </div>
  );
}
