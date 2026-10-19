// helpers/uploads.js — the uploaded-image store (<appDir>/uploads/).
//
// Layout (shared contract with mmoa_admin_console, which writes the events /
// raffles / board files remotely):
//   uploads/<kind>/<16 random hex>.<jpg|png|webp>
//   kind ∈ events | raffles | orgs | board
// The DB stores the path RELATIVE to uploads/ ('orgs/3f9c0a1b2c3d4e5f.jpg');
// app.js serves the directory read-only at /uploads (no index, no dotfiles).
//
// Only JPEG / PNG / WebP are accepted, identified by their magic bytes (the
// client-supplied filename and Content-Type are ignored), up to
// uploads.maxMb (default 8 MB). Browsers resize before uploading (canvas →
// ≤1600 px, JPEG q≈0.82), so real files are far smaller.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
const KINDS = ['events', 'raffles', 'orgs', 'board'];
// What a stored relative path must look like — anything else is refused, so a
// DB value can never point the app outside uploads/.
const REL_PATH_RE = /^(events|raffles|orgs|board)\/[0-9a-f]{16}\.(jpg|png|webp)$/;

/** Detect the image type from its first bytes → 'jpg' | 'png' | 'webp' | null. */
function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function maxBytes(appConfig) {
  const mb = Number(appConfig && appConfig.uploads && appConfig.uploads.maxMb);
  return (Number.isFinite(mb) && mb > 0 ? mb : 8) * 1024 * 1024;
}

function isValidRelPath(rel) {
  return typeof rel === 'string' && REL_PATH_RE.test(rel);
}

/** Public URL for a stored relative path (null when empty / invalid). */
function uploadUrl(rel) {
  return isValidRelPath(rel) ? '/uploads/' + rel : null;
}

/**
 * Validate and store an image buffer. Returns { path } (relative) on success
 * or throws an Error with .status = 400 and a user-facing message.
 */
async function saveImage(kind, buf, appConfig) {
  if (!KINDS.includes(kind)) throw Object.assign(new Error('Bad upload kind'), { status: 500 });
  if (!buf || !buf.length) throw Object.assign(new Error('No image was uploaded.'), { status: 400 });
  if (buf.length > maxBytes(appConfig)) {
    throw Object.assign(new Error(`That image is too large (max ${maxBytes(appConfig) / 1024 / 1024} MB).`), { status: 400 });
  }
  const ext = sniffImageType(buf);
  if (!ext) throw Object.assign(new Error('Please upload a JPEG, PNG or WebP image.'), { status: 400 });

  const dir = path.join(UPLOAD_ROOT, kind);
  await fs.promises.mkdir(dir, { recursive: true });
  const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
  // Write to a temp name, then rename: a half-written file is never served.
  const tmp = path.join(dir, '.' + name + '.tmp');
  await fs.promises.writeFile(tmp, buf, { flag: 'wx' });
  await fs.promises.rename(tmp, path.join(dir, name));
  return { path: kind + '/' + name };
}

/** Delete a stored image (best effort — a missing file is not an error). */
async function deleteImage(rel) {
  if (!isValidRelPath(rel)) return false;
  try {
    await fs.promises.unlink(path.join(UPLOAD_ROOT, rel));
    return true;
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[uploads] could not delete', rel, '-', e.message);
    return false;
  }
}

module.exports = { UPLOAD_ROOT, KINDS, sniffImageType, maxBytes, isValidRelPath, uploadUrl, saveImage, deleteImage };
