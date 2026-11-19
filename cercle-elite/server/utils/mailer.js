// Envoi des e-mails (Nodemailer, compatible avec tout fournisseur SMTP :
// Brevo, Mailjet, Resend SMTP, Gmail avec mot de passe d'application, etc.)
const nodemailer = require('nodemailer');
const { OTP_TTL_MINUTES } = require('./otp');
let transporter = null;
function isMailConfigured() {
return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}
function getTransporter() {
if (!transporter) {
const port = Number(process.env.SMTP_PORT || 587);
transporter = nodemailer.createTransport({
host: process.env.SMTP_HOST,
port,
secure: port === 465, // 465 = TLS direct ; 587 = STARTTLS
auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
connectionTimeout: 10000,
socketTimeout: 15000,
});
}
return transporter;
}
function getPurposeLabel(purpose) {
if (purpose === 'login') return 'connexion';
if (purpose === 'reset-password') return 'réinitialisation de mot de passe';
return 'inscription';
}
async function sendOtpEmail(to, code, purpose) {
if (!isMailConfigured()) {
// En local uniquement : le code s'affiche dans la console du serveur.
if (process.env.NODE_ENV !== 'production') {
console.log([DEV] Code OTP (${purpose}) pour ${to} : ${code});
return;
}
const err = new Error('SMTP non configuré (SMTP_HOST, SMTP_USER, SMTP_PASS).');
err.code = 'MAIL_NOT_CONFIGURED';
throw err;
}
const reason = getPurposeLabel(purpose);
await getTransporter().sendMail({
from: process.env.MAIL_FROM || process.env.SMTP_USER,
to,
subject: Votre code Cercle Élite : ${code},
text:
Votre code de ${reason} Cercle Élite est : ${code}\n\n +
Il est valable ${OTP_TTL_MINUTES} minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.,
html:
<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1f2b3c"> +
<h2 style="margin:0 0 12px;color:#8e6a16">CERCLE ÉLITE</h2> +
<p>Votre code de ${reason} :</p> +
<p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:16px 0">${code}</p> +
<p style="font-size:13px;color:#687383">Valable ${OTP_TTL_MINUTES} minutes.  +
Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p></div>,
});
}
module.exports = { sendOtpEmail, isMailConfigured };
