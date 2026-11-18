// Génération et vérification de codes OTP à 6 chiffres.
// Les codes ne sont jamais stockés en clair : seul un HMAC-SHA256 est enregistré.
const crypto = require('crypto');

const OTP_TTL_MINUTES = 10;          // durée de validité d'un code
const OTP_MAX_ATTEMPTS = 5;          // essais autorisés avant blocage du code
const OTP_RESEND_COOLDOWN_SEC = 60;  // délai minimum entre deux envois

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET manquant ou trop court (16 caractères minimum).');
  }
  return secret;
}

// Code aléatoire cryptographiquement sûr : "004217", "958302", …
function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashOtp(email, purpose, code) {
  return crypto.createHmac('sha256', getSecret()).update(`${email}|${purpose}|${code}`).digest('hex');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
  OTP_TTL_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SEC,
  getSecret,
  generateOtp,
  hashOtp,
  safeEqual,
};
