'use strict';
/* =====================================================================
   sync.js - Google sign-in + Google Drive sync engine (shared by SBP and UBP)

   Keeps localStorage as the single source of truth that the rest of the
   app already reads/writes via loadState()/saveState() in script.js and
   ultimate-budget.js. This module's only job is to keep that local copy
   in sync with a JSON file in the signed-in user's own Google Drive:
   pull the Drive copy down before the app loads state, push the local
   copy up after the app saves state. Neither script.js nor
   ultimate-budget.js need to know Drive exists beyond calling the
   handful of functions below.

   No refresh tokens or access tokens are ever written to localStorage -
   only the chosen mode ('local' | 'google') and the last-seen email
   (cosmetic only) persist across page loads. A fresh short-lived access
   token is silently re-requested each time it's needed via Google
   Identity Services, which is the standard approach for browser-only
   (no backend) Google API access.
   ===================================================================== */

// Fill this in after creating an OAuth Client ID in Google Cloud Console
// (Web application type, http://localhost:8080 as an authorized origin).
const GOOGLE_CLIENT_ID = '1008129505128-4p0kobjks9gb8bloe1epis7ea7333kqd.apps.googleusercontent.com';

const SYNC_SCOPES = 'https://www.googleapis.com/auth/drive.file openid email profile';
const SYNC_FOLDER_NAME = 'Evo Budget';
const SYNC_FILE_NAMES = { sbp: 'evobudget-simple-data.json', ubp: 'evobudget-ultimate-data.json' };
const SYNC_STATE_KEYS = { sbp: 'evobudget_v1', ubp: 'evobudget_ubp_v1' };

function syncModeKey(tool)  { return `evobudget_${tool}_storage_mode`; }
function syncEmailKey(tool) { return `evobudget_${tool}_google_email`; }

function syncGetMode(tool)      { return localStorage.getItem(syncModeKey(tool)) || null; }
function syncSetMode(tool, m)   { localStorage.setItem(syncModeKey(tool), m); }
function syncGetEmail(tool)     { return localStorage.getItem(syncEmailKey(tool)) || ''; }
function syncSetEmail(tool, e)  { if (e) localStorage.setItem(syncEmailKey(tool), e); }

// ── Token acquisition (Google Identity Services) ───────────────────────
let _syncTokenClient = null;
let _syncAccessToken = null; // in-memory only, never persisted

function _syncGisReady() {
  return typeof google !== 'undefined' && google.accounts && google.accounts.oauth2;
}

// Google's own guidance for avoiding popup-blocker false positives: call
// initTokenClient() once, ahead of time (page load), so that the ONLY thing
// requestAccessToken() has to do at click-time is open the window - no
// client construction, no setup work competing with the browser's short
// window for "this popup came directly from a trusted user gesture."
// Safe to call repeatedly; a no-op once already warmed up.
function syncPrewarmTokenClient() {
  if (_syncTokenClient || !_syncGisReady()) return;
  _syncTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SYNC_SCOPES,
    callback: () => {} // overridden per-request below
  });
  console.log('[sync] token client warmed up at', new Date().toISOString(), '(gis ready:', _syncGisReady(), ')');
}
// Try immediately (covers the rare case GIS is already loaded by the time
// this script runs) and again once the page has fully loaded, as a fallback
// in case the <script onload> hook in the HTML fires before this file has
// finished parsing.
syncPrewarmTokenClient();
if (typeof window !== 'undefined') window.addEventListener('load', syncPrewarmTokenClient);

function _syncGetTokenClient(onToken) {
  const wasAlreadyWarm = !!_syncTokenClient;
  syncPrewarmTokenClient(); // no-op if already warm; safety net if it never fired
  if (!_syncTokenClient) { console.log('[sync] no token client available - GIS not loaded yet'); return null; }
  if (!wasAlreadyWarm) console.log('[sync] WARNING: token client was NOT pre-warmed, had to create it just now (this can make the popup more likely to be blocked)');
  _syncTokenClient.callback = onToken;
  return _syncTokenClient;
}

// Resolves an access token without ever showing a popup; resolves null if
// the browser has no existing Google session / prior consent to reuse.
function syncSilentToken() {
  return new Promise(resolve => {
    const client = _syncGetTokenClient(resp => {
      if (resp && resp.access_token) { _syncAccessToken = resp.access_token; resolve(resp.access_token); }
      else resolve(null);
    });
    if (!client) { resolve(null); return; }
    try { client.requestAccessToken({ prompt: 'none' }); }
    catch { resolve(null); }
  });
}

// Resolves an access token, showing the Google consent popup if needed.
// If the browser silently blocks that popup, Google's callback may never
// fire at all - a timeout turns that into a clear, catchable error instead
// of leaving the caller waiting forever.
function syncInteractiveToken() {
  const clickedAt = performance.now();
  console.log('[sync] syncInteractiveToken() called at', new Date().toISOString(), '- was token client already warm?', !!_syncTokenClient);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.log('[sync] TIMED OUT after 20s with no callback from Google at all - this means the popup was almost certainly blocked before it could even open, or GIS itself never responded');
      reject(new Error('popup_blocked_or_timed_out'));
    }, 20000);
    const client = _syncGetTokenClient(resp => {
      const elapsed = Math.round(performance.now() - clickedAt);
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (resp && resp.access_token) { console.log('[sync] got access token after', elapsed, 'ms'); _syncAccessToken = resp.access_token; resolve(resp.access_token); }
      else { console.log('[sync] Google called back with an error after', elapsed, 'ms:', JSON.stringify(resp)); reject(new Error(resp && resp.error ? resp.error : 'sign_in_failed')); }
    });
    if (!client) { clearTimeout(timer); reject(new Error('google_identity_unavailable')); return; }
    const beforeCall = performance.now();
    try { client.requestAccessToken({ prompt: '' }); console.log('[sync] requestAccessToken() call itself returned normally after', Math.round(performance.now() - beforeCall), 'ms (this is just the call returning, not the popup outcome)'); }
    catch (e) { clearTimeout(timer); console.log('[sync] requestAccessToken() threw synchronously:', e); reject(e); }
  });
}

async function _syncFetchEmail(token) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return '';
  const j = await res.json();
  return j.email || '';
}

// ── Drive file helpers (drive.file scope: this app can only see files it
//    created/opened, so files.list here only ever finds our own file) ──
async function _driveFindFolder(token) {
  const q = encodeURIComponent(`name='${SYNC_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const j = await res.json();
  return (j.files && j.files[0]) ? j.files[0].id : null;
}

async function _driveCreateFolder(token) {
  const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: SYNC_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
  });
  const j = await res.json();
  return j.id;
}

async function _driveFindFile(token, folderId, fileName) {
  const q = encodeURIComponent(`name='${fileName}' and '${folderId}' in parents and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const j = await res.json();
  return (j.files && j.files[0]) ? j.files[0].id : null;
}

async function _driveCreateFile(token, folderId, fileName, data) {
  const boundary = 'evobudgetsync';
  const metadata = { name: fileName, parents: [folderId], mimeType: 'application/json' };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
  const j = await res.json();
  return j.id;
}

async function _driveReadFile(token, fileId) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

async function _driveWriteFile(token, fileId, data) {
  await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

// Turns a raw sign-in error into copy a non-technical user can act on.
function syncFriendlyError(err) {
  const msg = err && err.message;
  if (msg === 'popup_blocked_or_timed_out') return "Your browser blocked the Google sign-in window. Please allow pop-ups for this site (check your address bar for a blocked pop-up icon) and try again.";
  if (msg === 'access_denied' || msg === 'sign_in_failed') return 'Sign-in was cancelled. Please try again.';
  return "Sign-in didn't go through. Please try again.";
}

// Guards against ever adopting/seeding a placeholder blob that's missing
// the shape the rest of the app expects (e.g. a tool that has never been
// opened on this device yet has no real state to upload).
function _looksLikeValidState(d) { return !!(d && typeof d === 'object' && d.settings && typeof d.settings === 'object'); }

// Finds (or creates) this tool's Drive file, returning { fileId, data, created }.
// If there's no file yet AND nothing valid to seed it with, returns data:null
// rather than creating a placeholder - the caller should leave localStorage
// untouched so the app's own defaultState() runs normally, and the real
// Drive file gets created the first time saveState() actually has something.
async function _driveFindOrCreateFile(token, tool, fallbackData) {
  let folderId = await _driveFindFolder(token);
  if (!folderId) folderId = await _driveCreateFolder(token);
  const fileName = SYNC_FILE_NAMES[tool];
  let fileId = await _driveFindFile(token, folderId, fileName);
  if (fileId) {
    const data = await _driveReadFile(token, fileId);
    return { fileId, data: _looksLikeValidState(data) ? data : fallbackData, created: false };
  }
  if (!_looksLikeValidState(fallbackData)) return { fileId: null, data: null, created: false };
  const stamped = { ...fallbackData, _syncMeta: { unlocked: true, updatedAt: new Date().toISOString() } };
  fileId = await _driveCreateFile(token, folderId, fileName, stamped);
  return { fileId, data: stamped, created: true };
}

// ── High-level API used by script.js / ultimate-budget.js ─────────────

// Reads the tool's current localStorage state blob (raw JSON string or null).
function _localRaw(tool) { return localStorage.getItem(SYNC_STATE_KEYS[tool]); }
function _localData(tool) { const r = _localRaw(tool); try { return r ? JSON.parse(r) : null; } catch { return null; } }
function _writeLocal(tool, data) { localStorage.setItem(SYNC_STATE_KEYS[tool], JSON.stringify(data)); }

// Interactive sign-in used the first time a device switches into Google
// mode (fresh code entry, or later via Settings). Uploads current local
// state if Drive has nothing yet; otherwise adopts whatever Drive has.
async function syncSignInAndAdopt(tool) {
  const token = await syncInteractiveToken();
  const email = await _syncFetchEmail(token);
  const local = _localData(tool);
  const { fileId, data } = await _driveFindOrCreateFile(token, tool, local || {});
  syncSetEmail(tool, email);
  if (_looksLikeValidState(data)) _writeLocal(tool, data); // no valid data yet on either side - leave local untouched, app's own defaultState() will run
  return { email, fileId, data };
}

// Silent (no popup) resync for a device already in 'google' mode, e.g. on
// every app load. Resolves {authOk:false} if silent auth isn't possible, so
// the caller can fall back to prompting for interactive sign-in - distinct
// from {authOk:true, data:null}, which just means nothing to sync yet.
async function syncSilentResync(tool) {
  const token = await syncSilentToken();
  if (!token) return { authOk: false, data: null };
  const local = _localData(tool);
  const { data } = await _driveFindOrCreateFile(token, tool, local || {});
  if (_looksLikeValidState(data)) _writeLocal(tool, data);
  return { authOk: true, data };
}

// Settings-panel action: switch this device from local storage to Google,
// uploading whatever is currently on this device (local wins).
async function syncSwitchToGoogle(tool) {
  const token = await syncInteractiveToken();
  const email = await _syncFetchEmail(token);
  const local = _localData(tool);
  if (!_looksLikeValidState(local)) throw new Error('nothing_to_sync_yet');
  let folderId = await _driveFindFolder(token);
  if (!folderId) folderId = await _driveCreateFolder(token);
  const fileName = SYNC_FILE_NAMES[tool];
  let fileId = await _driveFindFile(token, folderId, fileName);
  const stamped = { ...local, _syncMeta: { unlocked: true, updatedAt: new Date().toISOString() } };
  if (fileId) await _driveWriteFile(token, fileId, stamped);
  else fileId = await _driveCreateFile(token, folderId, fileName, stamped);
  syncSetEmail(tool, email);
  syncSetMode(tool, 'google');
  _writeLocal(tool, stamped);
  return { email };
}

// Settings-panel action: switch this device from Google back to local
// storage, pulling down whatever Drive currently has (Drive wins).
async function syncSwitchToLocal(tool) {
  let token = await syncSilentToken();
  if (!token) token = await syncInteractiveToken();
  const local = _localData(tool);
  const { data } = await _driveFindOrCreateFile(token, tool, local || {});
  if (_looksLikeValidState(data)) _writeLocal(tool, data);
  syncSetMode(tool, 'local');
}

// Debounced push used by the saveState() hooks - avoids hammering the
// Drive API on every keystroke while still saving shortly after the user
// stops typing.
const _syncPushTimers = {};
function syncPushDebounced(tool) {
  if (syncGetMode(tool) !== 'google') return;
  clearTimeout(_syncPushTimers[tool]);
  _syncPushTimers[tool] = setTimeout(async () => {
    try {
      let token = _syncAccessToken || await syncSilentToken();
      if (!token) return; // offline / session lost - local copy is still safe, will resync on next load
      const local = _localData(tool);
      if (!_looksLikeValidState(local)) return; // nothing real to push yet
      let folderId = await _driveFindFolder(token);
      if (!folderId) folderId = await _driveCreateFolder(token);
      const fileName = SYNC_FILE_NAMES[tool];
      let fileId = await _driveFindFile(token, folderId, fileName);
      const stamped = { ...local, _syncMeta: { unlocked: true, updatedAt: new Date().toISOString() } };
      if (fileId) await _driveWriteFile(token, fileId, stamped);
      else await _driveCreateFile(token, folderId, fileName, stamped);
    } catch { /* best-effort - local storage already has the latest data */ }
  }, 1500);
}
