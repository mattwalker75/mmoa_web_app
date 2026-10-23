// helpers/orgCache.js — a short-lived, in-process cache of the public
// directory's org list.
//
// Every /api/directory/search and /api/directory/orgs/:id call (and the Home
// page's nonprofit strip, which calls search) used to reload every verified +
// listed org with its contacts, images, categories and cities. The list
// changes rarely, so it is loaded once and reused for TTL_MS; concurrent
// requests share ONE in-flight load (the promise is what's cached). The
// loader itself stays in routes/public.js — this module only owns the timing.
//
// Invalidation: TTL, plus invalidate() after any portal write in this process
// (routes/portal.js). The admin console edits the same database from ANOTHER
// process (verifying, listing / unlisting, editing an org), so its changes
// show up on the public site within the TTL rather than instantly.

'use strict';

const TTL_MS = 20 * 1000;

let entry = null; // { promise, expiresAt } or null when empty / invalidated

/**
 * The cached list, or a fresh one from load() when empty or stale. load()
 * must return a promise for the shaped list; a rejected load is dropped so
 * the next call retries instead of serving an error for TTL_MS.
 */
function getPublicOrgs(load) {
  const now = Date.now();
  if (entry && entry.expiresAt > now) return entry.promise;
  const mine = { promise: load(), expiresAt: now + TTL_MS };
  entry = mine;
  mine.promise.catch(() => { if (entry === mine) entry = null; });
  return mine.promise;
}

/** Forget the cached list (next request reloads). */
function invalidate() { entry = null; }

module.exports = { getPublicOrgs, invalidate, TTL_MS };
