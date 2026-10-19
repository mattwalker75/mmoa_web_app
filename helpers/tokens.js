// helpers/tokens.js — crypto-strong random token generation.
// Used for email-verification and password-reset links. 32 bytes of randomness → 64 hex chars,
// effectively unguessable.

const crypto = require('crypto');

function newToken(bytes) {
  return crypto.randomBytes(bytes || 32).toString('hex');
}

module.exports = { newToken };
