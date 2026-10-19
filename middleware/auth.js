// middleware/auth.js — password hashing helpers.
//
// Every account in the users table is a member — there are no roles. The
// web app has no admin pages (administration lives in the admin console) —
// the JSON auth guards (signed-in check,
// session re-validation) live with the API in routes/api.js, because they
// answer 401 JSON rather than redirecting.
//
// The admin console's "reset password" hashes with the same bcrypt cost, so
// a password set in either place verifies in both.

const bcrypt = require('bcrypt');

// bcrypt cost factor 10 — the same as car_show_control_plane. Forward-
// compatible: the cost is stored inside the hash itself so you can raise this
// later without invalidating existing passwords.
async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

module.exports = {
  hashPassword,
  verifyPassword
};
