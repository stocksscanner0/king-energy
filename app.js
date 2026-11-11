(() => {
'use strict';

/* ---------- small helpers ---------- */
const CFG = window.KE_CONFIG || {};
// Practice mode: when no storage is set up, or on this computer only with ?demo=1 (used for testing).
const DEMO = !CFG.supabaseUrl || !CFG.supabaseKey || (location.hostname === 'localhost' && /[?&]demo=1/.test(location.search));
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID();
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => ymd(new Date());
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const nowIso = () => new Date().toISOString();
const STATUS = { todo: 'Not started', working: 'Working', stuck: 'Stuck', done: 'Done' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDate = s => { const d = parseYmd(s); return MONTHS[d.getMonth()] + ' ' + d.getDate(); };
const niceTime = iso => { const d = new Date(iso); let h = d.getHours(); const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + h + ':' + pad(d.getMinutes()) + ' ' + ap; };
const EXTRA_IDEAS = ['Store brand', 'POS type', 'Pump brand', 'Number of pumps', 'Tank 1 (fuel + size)', 'Tank 2 (fuel + size)', 'Tank 3 (fuel + size)', 'Fuel types', 'Current supplier', 'Contract end date', 'Price notes', 'Best time to call'];

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ---------- data: practice mode (this device only) ---------- */
function demoDb() {
  const KEY = 'ke_demo_v1';
  const seed = () => {
    const t = new Date(), plus = n => { const d = new Date(t); d.setDate(d.getDate() + n); return ymd(d); };
    const a = uid(), b = uid(), c = uid();
    return {
      members: [{ email: 'you@demo', name: 'You' }, { email: 'sam@demo', name: 'Sam' }, { email: 'raj@demo', name: 'Raj' }],
      tasks: [
        { id: a, title: 'Send KY fuel license application', details: '', status: 'working', owner: 'sam@demo', due: plus(-2), created_by: 'you@demo', created_at: nowIso(), updated_at: nowIso() },
        { id: b, title: 'Get insurance quote for the truck', details: '', status: 'todo', owner: null, due: null, created_by: 'raj@demo', created_at: nowIso(), updated_at: nowIso() },
        { id: c, title: 'Open business bank account', details: '', status: 'todo', owner: 'you@demo', due: plus(3), created_by: 'you@demo', created_at: nowIso(), updated_at: nowIso() }
      ],
      events: [{ id: uid(), task_id: a, actor: 'sam@demo', kind: 'comment', body: 'Called the state office. Waiting on a call back.', created_at: nowIso() }],
      files: [],
      stores: [{ id: uid(), name: 'Sample Food Mart', owner_name: 'Store Owner', phone: '', email: '', address: 'Louisville, KY', notes: 'This is a sample. Delete it any time.', extra: [{ label: 'Pump brand', value: 'Gilbarco' }, { label: 'Tank 1 (fuel + size)', value: 'Regular, 10,000 gal' }], created_at: nowIso(), updated_at: nowIso() }]
    };
  };
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* storage blocked */ }
  if (!d) d = seed();
  d.store_files = d.store_files || []; d.activity = d.activity || [];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* ignore */ } };
  return {
    async init() {},
    async session() { try { return localStorage.getItem(KEY + '_me'); } catch (e) { return null; } },
    async signIn(email) { try { localStorage.setItem(KEY + '_me', email); } catch (e) { /* ignore */ } },
    async signOut() { try { localStorage.removeItem(KEY + '_me'); } catch (e) { /* ignore */ } },
    async loadAll() { return JSON.parse(JSON.stringify(d)); },
    async insert(t, row) { d[t].push({ ...row }); save(); },
    async update(t, id, patch) { const r = d[t].find(x => x.id === id); if (r) Object.assign(r, patch); save(); },
    async remove(t, id) {
      d[t] = d[t].filter(x => x.id !== id);
      if (t === 'tasks') { d.events = d.events.filter(e => e.task_id !== id); d.files = d.files.filter(f => f.task_id !== id); }
      if (t === 'stores') d.store_files = d.store_files.filter(f => f.store_id !== id);
      save();
    },
    async uploadFile(row, file, table = 'files') {
      if (file.size > 400000) throw new Error('Practice mode can only keep small files (under 400 KB). Real mode has no such limit.');
      row.data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
      d[table].push({ ...row }); save();
    },
    async fileUrl(row) { const f = d.files.concat(d.store_files).find(x => x.id === row.id); const blob = await (await fetch(f.data)).blob(); return URL.createObjectURL(blob); },
    async removeFile(row, table = 'files') { d[table] = d[table].filter(x => x.id !== row.id); save(); },
    async fn() { return {}; },
    reset() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } d = seed(); d.store_files = []; d.activity = []; }
  };
}

/* ---------- data: real mode (Supabase, shared by all partners) ---------- */
function supaDb() {
  let sb;
  const ok = r => { if (r.error) throw r.error; return r.data; };
  return {
    async init() {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
        s.onload = res; s.onerror = () => rej(new Error('Could not reach the internet.'));
        document.head.appendChild(s);
      });
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
    },
    async session() { const { data } = await sb.auth.getSession(); const e = data.session && data.session.user.email; return e ? e.toLowerCase() : null; },
    async signIn(email, pw) { ok(await sb.auth.signInWithPassword({ email, password: pw })); },
    async signOut() { await sb.auth.signOut(); },
    async setPassword(pw) { ok(await sb.auth.updateUser({ password: pw })); },
    async loadAll() {
      const names = ['members', 'tasks', 'events', 'files', 'stores', 'store_files', 'activity'];
      const rs = await Promise.all(names.map(n => n === 'activity' ? sb.from(n).select('*').order('created_at', { ascending: false }).limit(100) : sb.from(n).select('*')));
      const out = {}; rs.forEach((r, i) => { out[names[i]] = ok(r); }); return out;
    },
    async insert(t, row) { ok(await sb.from(t).insert(row)); },
    async update(t, id, patch) { ok(await sb.from(t).update(patch).eq('id', id)); },
    async remove(t, id) { ok(await sb.from(t).delete().eq('id', id)); },
    async uploadFile(row, file, table = 'files') { ok(await sb.storage.from('files').upload(row.path, file)); await this.insert(table, row); },
    async fileUrl(row) { return ok(await sb.storage.from('files').createSignedUrl(row.path, 3600)).signedUrl; },
    async removeFile(row, table = 'files') { await sb.storage.from('files').remove([row.path]); await this.remove(table, row.id); },
    async fn(op, payload) {
      const { data } = await sb.auth.getSession();
      const r = await fetch(CFG.supabaseUrl + '/functions/v1/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: 'Bearer ' + (data.session ? data.session.access_token : CFG.supabaseKey) },
        body: JSON.stringify({ op, ...(payload || {}) })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'The alert service did not answer.');
      return j;
    },
    async saveSub(sub, email) { ok(await sb.from('push_subs').upsert({ endpoint: sub.endpoint, email, sub })); },
    async dropSub(endpoint) { ok(await sb.from('push_subs').delete().eq('endpoint', endpoint)); }
  };
}

const db = DEMO ? demoDb() : supaDb();

/* ---------- state ---------- */
const KINDS = [['contract', '📄 Contract'], ['site', '📷 Site picture'], ['screenshot', '📱 Screenshot'], ['offer_world_fuel', '💲 Offer from World Fuel'], ['est_keshav', '🧾 Estimate from Keshav'], ['est_jf', '🧾 Estimate from JF'], ['est_others', '🧾 Estimate from others'], ['other', '📎 Other']];
const KIND_COLOR = { contract: '#1d5fd1', site: '#12805c', screenshot: '#8b3fd1', offer_world_fuel: '#b4530a', est_keshav: '#0e7490', est_jf: '#be185d', est_others: '#4d7c0f', other: '#64748b' };
const kindLabel = k => { const f = KINDS.find(x => x[0] === k); return f ? f[1] : '🏷 ' + (k || 'Other'); };
const kindPlain = k => kindLabel(k).replace(/^\S+\s/, '');
const kindColor = k => KIND_COLOR[k] || '#7c3aed';
const STORE_FIELDS = [['name', 'Store name'], ['owner_name', 'Owner or contact'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address'], ['landlord_name', 'Landlord name'], ['landlord_phone', 'Landlord number'], ['landlord_email', 'Landlord email'], ['notes', 'Notes']];
const storeDraft = s => { const d = { extra: (s.extra || []).map(x => ({ label: x.label, value: x.value })), newFiles: [], removeFiles: [], kind: 'site', customKind: '' }; STORE_FIELDS.forEach(([k]) => { d[k] = s[k] || ''; }); return d; };
const ACT_ICON = { store: '🏪', task_new: '🆕', task_taken: '🙋' };
const isImage = n => /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(n || '');
const HUES = [210, 150, 28, 280, 345, 175, 50, 240];
const thumbUrls = new Map();
const S = { store_files: [], activity: [], me: null, members: [], tasks: [], events: [], files: [], stores: [], tab: 'tasks', filter: 'all', sheet: null, search: '', draftComment: '' };
const nameOf = email => { const m = S.members.find(x => x.email === email); return m ? m.name : (email || ''); };
const isLate = t => t.status !== 'done' && t.due && t.due < today();
const taskById = id => S.tasks.find(t => t.id === id);

function dueText(t) {
  const diff = Math.round((parseYmd(t.due) - parseYmd(today())) / 864e5);
  if (t.status !== 'done') {
    if (diff < 0) return (-diff) + (diff === -1 ? ' day late' : ' days late');
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
  }
  return niceDate(t.due);
}

async function safe(fn, failMsg) {
  try { return await fn(); }
  catch (e) { console.error(e); toast(failMsg || (e && e.message) || 'Could not save. Check your internet.'); refresh(); return undefined; }
}

async function refresh() {
  try {
    const d = await db.loadAll();
    S.members = d.members.sort((a, b) => a.name.localeCompare(b.name));
    S.tasks = d.tasks; S.events = d.events; S.files = d.files; S.stores = d.stores; S.store_files = d.store_files || [];
    S.activity = (d.activity || []).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  } catch (e) { console.error(e); toast('Could not load. Check your internet.'); return; }
  renderMain();
  const sheetEl = $('#sheet');
  if (S.sheet && S.sheet.type === 'task' && !sheetEl.contains(document.activeElement)) {
    if (taskById(S.sheet.id)) renderSheet(); else closeSheet();
  }
}

/* ---------- picture card for sharing ---------- */
function wrapLines(g, text, maxW, maxLines) {
  const words = String(text).split(/\s+/), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (!cur || g.measureText(t).width <= maxW) cur = t; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '…'); }
  return lines;
}
function taskCardBlob(t) {
  const W = 1080, P = 64, F = '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", sans-serif';
  const late = isLate(t), nobody = !t.owner && t.status !== 'done';
  const STC = { todo: '#64748b', working: '#1d5fd1', stuck: '#c77700', done: '#12805c' };
  const cv = document.createElement('canvas'); let g = cv.getContext('2d');
  g.font = 'bold 66px ' + F; const titleLines = wrapLines(g, t.title, W - 2 * P, 4);
  const last = S.events.filter(e => e.task_id === t.id && e.kind === 'comment').sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  g.font = '40px ' + F; const lastLines = last ? wrapLines(g, nameOf(last.actor) + ': ' + last.body, W - 2 * P - 56, 3) : [];
  const banner = late ? 'LATE  ·  ' + dueText(t).toUpperCase() : nobody ? 'NOBODY OWNS THIS YET' : '';
  const H = 180 + (banner ? 100 : 0) + 70 + titleLines.length * 82 + 30 + 3 * 100 + (lastLines.length ? 50 + lastLines.length * 54 + 50 : 0) + 120;
  cv.width = W; cv.height = H; g = cv.getContext('2d'); g.textBaseline = 'middle';
  const box = (x, y, w, h, r, color) => { g.fillStyle = color; g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); g.fill(); };
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  // header
  g.fillStyle = '#0f2742'; g.fillRect(0, 0, W, 180);
  box(P, 46, 88, 88, 20, '#f5a623'); g.fillStyle = '#0f2742'; g.font = 'bold 44px ' + F; g.textAlign = 'center'; g.fillText('KE', P + 44, 92);
  g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.font = 'bold 52px ' + F; g.fillText('King Energy', P + 116, 74);
  g.fillStyle = '#f5a623'; g.font = '32px ' + F; g.fillText('TASK', P + 118, 124);
  let y = 180;
  if (banner) { g.fillStyle = late ? '#d92d20' : '#f5a623'; g.fillRect(0, y, W, 100); g.fillStyle = late ? '#ffffff' : '#1b1300'; g.font = 'bold 44px ' + F; g.fillText((late ? '⚠  ' : '🚨  ') + banner, P, y + 52); y += 100; }
  // title
  y += 70; g.fillStyle = '#14202e'; g.font = 'bold 66px ' + F;
  for (const line of titleLines) { g.fillText(line, P, y + 30); y += 82; }
  y += 30;
  // rows
  const row = (label, value, color) => {
    g.fillStyle = '#64748b'; g.font = 'bold 30px ' + F; g.fillText(label, P, y + 50);
    if (color) { g.font = 'bold 40px ' + F; const w = g.measureText(value).width + 56; box(P + 250, y + 14, w, 72, 36, color); g.fillStyle = '#ffffff'; g.fillText(value, P + 278, y + 52); }
    else { g.fillStyle = '#14202e'; g.font = 'bold 46px ' + F; g.fillText(value, P + 250, y + 50); }
    g.fillStyle = '#e3e8ee'; g.fillRect(P, y + 99, W - 2 * P, 2); y += 100;
  };
  row('OWNER', t.owner ? nameOf(t.owner) : 'Nobody yet');
  row('DUE', t.due ? niceDate(t.due) + (t.status !== 'done' && !late && dueText(t) !== niceDate(t.due) ? '  (' + dueText(t) + ')' : '') : 'No date');
  row('STATUS', STATUS[t.status], STC[t.status]);
  if (lastLines.length) {
    y += 50; const h = lastLines.length * 54 + 40; box(P, y - 20, W - 2 * P, h, 22, '#eef3f9'); box(P, y - 20, 10, h, 5, '#1d5fd1');
    g.fillStyle = '#14202e'; g.font = '40px ' + F; let yy = y + 28; for (const line of lastLines) { g.fillText(line, P + 36, yy); yy += 54; }
    y += h + 10;
  }
  g.fillStyle = '#64748b'; g.font = '30px ' + F; g.fillText('Open the app to update:  ' + location.host + location.pathname.replace(/\/$/, ''), P, H - 56);
  // Made right away (no waiting), so the phone still treats the share as coming from the tap.
  const bin = atob(cv.toDataURL('image/png').split(',')[1]), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: 'image/png' });
}
window.KE_card = id => taskCardBlob(taskById(id));

/* ---------- phone alerts ---------- */
const PUSH_OK = !DEMO && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let alertsOn = false;
const b64ToBytes = s => { const p = (s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(p), c => c.charCodeAt(0)); };
const ping = (op, payload) => { db.fn(op, payload).catch(e => console.warn('alert not sent', e)); };
async function checkAlerts() {
  if (!PUSH_OK) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    const sub = await reg.pushManager.getSubscription();
    alertsOn = !!sub && Notification.permission === 'granted';
    if (alertsOn) db.saveSub(sub.toJSON(), S.me).catch(() => {});
  } catch (e) { console.warn(e); }
}
async function enableAlerts() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Alerts are blocked. Allow notifications for this app in your phone settings.'); return; }
    await navigator.serviceWorker.register('sw.js');
    const reg = await navigator.serviceWorker.ready;
    const { key } = await db.fn('key');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    await db.saveSub(sub.toJSON(), S.me);
    alertsOn = true; toast('Alerts are on for this phone.');
  } catch (e) { console.error(e); toast('Could not turn on alerts: ' + ((e && e.message) || 'unknown problem')); }
  renderMain(); if (S.sheet && S.sheet.type === 'settings') renderSheet();
}
async function disableAlerts(quiet) {
  if (!PUSH_OK) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) { await db.dropSub(sub.endpoint).catch(() => {}); await sub.unsubscribe(); }
  } catch (e) { console.warn(e); }
  alertsOn = false;
  if (!quiet) { toast('Alerts are off for this phone.'); renderMain(); if (S.sheet && S.sheet.type === 'settings') renderSheet(); }
}

/* ---------- task actions ---------- */
async function addEvent(taskId, kind, body) {
  const ev = { id: uid(), task_id: taskId, actor: S.me, kind, body, created_at: nowIso() };
  S.events.push(ev);
  await db.insert('events', ev);
}
// One line in the bell list. It also asks the server to send the phone alert and the email.
async function logActivity(kind, title, body) {
  const a = { id: uid(), actor: S.me, kind, title, body: body || '', created_at: nowIso() };
  S.activity.unshift(a);
  await db.insert('activity', a);
  ping('notify', { activity_id: a.id });
}
const seenKey = () => 'ke_seen_' + S.me;
const lastSeen = () => { try { return localStorage.getItem(seenKey()) || ''; } catch (e) { return ''; } };
const unseenCount = () => { const s = lastSeen(); return S.activity.filter(a => a.actor !== S.me && (a.created_at || '') > s).length; };
const taskFacts = t => 'Owner: ' + (t.owner ? nameOf(t.owner) : 'Nobody yet') + '\nDue: ' + (t.due ? niceDate(t.due) : 'No date');

function storeChanges(old, fields, extra, newFiles, removed) {
  const lines = [], o = old || {};
  STORE_FIELDS.forEach(([k, label]) => {
    const a = String(o[k] || '').trim(), b = fields[k] || ''; if (a === b) return;
    lines.push(!a ? label + ': ' + b : !b ? label + ': removed (was ' + a + ')' : label + ': ' + a + ' → ' + b);
  });
  const oe = o.extra || [], used = new Set();
  extra.forEach(x => {
    const i = oe.findIndex((y, j) => !used.has(j) && y.label === x.label);
    if (i < 0) { lines.push('Added detail: ' + x.label + ' = ' + x.value); return; }
    used.add(i); if ((oe[i].value || '') !== x.value) lines.push(x.label + ': ' + (oe[i].value || '(empty)') + ' → ' + (x.value || '(empty)'));
  });
  oe.forEach((y, j) => { if (!used.has(j)) lines.push('Removed detail: ' + y.label + (y.value ? ' (was ' + y.value + ')' : '')); });
  newFiles.forEach(f => lines.push('Added file: ' + kindPlain(f.kind) + ' – ' + f.name));
  removed.forEach(f => lines.push('Removed file: ' + kindPlain(f.kind || 'other') + ' – ' + f.name));
  return lines;
}

async function patchTask(id, patch, note, quiet) {
  const t = taskById(id); if (!t) return;
  patch.updated_at = nowIso();
  Object.assign(t, patch);
  renderMain(); if (!quiet) renderSheet();
  await safe(async () => {
    await db.update('tasks', id, patch);
    if (note) { await addEvent(id, 'history', note); if (!quiet) renderSheet(); }
  });
}
function setOwner(id, email) {
  const t = taskById(id); if (!t || (t.owner || null) === (email || null)) return;
  const note = !email ? 'removed the owner. Nobody owns this now.' : email === S.me ? 'took this task.' : 'gave this task to ' + nameOf(email) + '.';
  return patchTask(id, { owner: email || null }, note).then(() => {
    if (email && email !== S.me) ping('assigned', { task_id: id });
    else if (email === S.me) logActivity('task_taken', nameOf(S.me) + ' picked up: ' + t.title, taskFacts(t)).catch(e => console.warn(e));
  });
}

/* ---------- screens ---------- */
function renderLogin(msg) {
  $('#sheet').hidden = true;
  if (DEMO) {
    $('#app').innerHTML = `<div class="login"><h1>King Energy</h1><p class="muted">Practice mode. Who are you?</p>
      ${S.members.map(m => `<button class="btn wide" data-act="demo-login" data-v="${esc(m.email)}">${esc(m.name)}</button>`).join('')}</div>`;
  } else {
    $('#app').innerHTML = `<div class="login"><h1>King Energy</h1><p class="muted">Sign in</p>
      ${msg ? `<div class="banner">${esc(msg)}</div>` : ''}
      <form id="loginForm"><label class="f">Email</label><input class="in" type="email" name="email" autocomplete="username" required>
      <label class="f">Password</label><input class="in" type="password" name="pw" autocomplete="current-password" required>
      <button class="btn primary wide" type="submit">Sign in</button></form></div>`;
  }
}

function card(t) {
  const nc = S.events.filter(e => e.task_id === t.id && e.kind === 'comment').length;
  const nf = S.files.filter(f => f.task_id === t.id).length;
  const late = isLate(t);
  return `<div class="card st-${t.status}${late ? ' late' : ''}" data-act="open-task" data-id="${t.id}">
    <div class="card-top"><span class="pill s-${t.status}">${STATUS[t.status]}</span>${late ? '<span class="pill s-late">LATE</span>' : ''}</div>
    <div class="card-title">${esc(t.title)}</div>
    <div class="card-meta"><span>👤 ${t.owner ? esc(nameOf(t.owner)) : 'Nobody'}</span>
      <span>📅 ${t.due ? esc(dueText(t)) : 'No date'}</span>${nc ? `<span>💬 ${nc}</span>` : ''}${nf ? `<span>📎 ${nf}</span>` : ''}</div>
    ${!t.owner && t.status !== 'done' ? `<button class="btn go take" data-act="take" data-id="${t.id}">I'll take it</button>` : ''}
  </div>`;
}

function tasksView() {
  const open = S.tasks.filter(t => t.status !== 'done');
  const nobody = open.filter(t => !t.owner);
  const mineCount = open.filter(t => t.owner === S.me).length;
  let owned = open.filter(t => t.owner);
  if (S.filter === 'mine') owned = owned.filter(t => t.owner === S.me);
  const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (b.created_at || '').localeCompare(a.created_at || '');
  const late = owned.filter(isLate).sort(byDue);
  const rest = owned.filter(t => !isLate(t)).sort(byDue);
  let done = S.tasks.filter(t => t.status === 'done');
  if (S.filter === 'mine') done = done.filter(t => t.owner === S.me);
  done.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  return `
    <div class="chips">
      <button class="chip${S.filter === 'all' ? ' on' : ''}" data-act="filter" data-v="all">Everyone (${open.length})</button>
      <button class="chip${S.filter === 'mine' ? ' on' : ''}" data-act="filter" data-v="mine">Mine (${mineCount})</button>
    </div>
    ${nobody.length ? `<div class="nobody"><h2>🚨 Nobody owns this yet (${nobody.length})</h2><p>These will not get done until one person takes them.</p>${nobody.sort(byDue).map(card).join('')}</div>` : ''}
    ${late.length ? `<h2 class="sec">Late (${late.length})</h2>${late.map(card).join('')}` : ''}
    ${rest.length ? `<h2 class="sec">To do (${rest.length})</h2>${rest.map(card).join('')}` : ''}
    ${!nobody.length && !late.length && !rest.length ? `<p class="empty">Nothing open here. Tap “+ New task” to add one.</p>` : ''}
    ${done.length ? `<details class="done"><summary>Done (${done.length})</summary>${done.map(card).join('')}</details>` : ''}`;
}

function storeCards() {
  const q = S.search.trim().toLowerCase();
  const list = S.stores.filter(s => !q || JSON.stringify([s.name, s.owner_name, s.phone, s.address, s.notes, s.extra]).toLowerCase().includes(q))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (!list.length) return `<p class="empty">${S.stores.length ? 'No store matches.' : 'No stores yet. Tap “+ New store” to add one.'}</p>`;
  return list.map((s, i) => {
    const nf = S.store_files.filter(f => f.store_id === s.id).length;
    const tags = (s.extra || []).filter(x => x.label && x.value).slice(0, 3);
    return `<div class="card store-card" style="--h:${HUES[i % HUES.length]}" data-act="open-store" data-id="${s.id}">
    <div class="store-top"><span class="avatar">${esc((s.name || '?').trim().charAt(0).toUpperCase())}</span><div class="card-title">${esc(s.name || 'No name')}</div></div>
    <div class="card-meta">${s.owner_name ? `<span>👤 ${esc(s.owner_name)}</span>` : ''}${s.phone ? `<span>📞 ${esc(s.phone)}</span>` : ''}${s.address ? `<span>📍 ${esc(s.address)}</span>` : ''}${nf ? `<span>📎 ${nf}</span>` : ''}</div>
    ${tags.length ? `<div class="tags">${tags.map(x => `<span class="tag">${esc(x.label)}: ${esc(x.value)}</span>`).join('')}</div>` : ''}
  </div>`; }).join('');
}

function renderMain() {
  if (!S.me) return;
  const open = S.tasks.filter(t => t.status !== 'done');
  const nLate = open.filter(isLate).length, nNobody = open.filter(t => !t.owner).length;
  const sub = [nLate ? nLate + ' late' : '', nNobody ? nNobody + ' with no owner' : ''].filter(Boolean).join(' · ') || 'All tasks have an owner and are on time';
  $('#app').innerHTML = `
    <header class="top"><h1>King Energy<small>${esc(sub)}</small></h1><button data-act="refresh" aria-label="Refresh">↻</button><button data-act="bell" class="bell" aria-label="Recent changes">🔔${unseenCount() ? `<b class="badge">${unseenCount()}</b>` : ''}</button><button data-act="settings">${esc(nameOf(S.me))} ⚙</button></header>
    <main>
      ${DEMO ? '<div class="banner">Practice mode: saved on this device only. Your partners cannot see it yet.</div>' : ''}
      ${PUSH_OK && !alertsOn ? '<div class="banner">🔔 Alerts are off on this phone. <button class="btn" data-act="alert-on">Turn on</button></div>' : ''}
      ${S.tab === 'tasks' ? tasksView() : `<input class="in" id="search" type="search" placeholder="Search stores…" value="${esc(S.search)}" style="margin-bottom:12px"><div id="storeList">${storeCards()}</div>`}
    </main>
    <button class="fab" data-act="${S.tab === 'tasks' ? 'new-task' : 'new-store'}">+ New ${S.tab === 'tasks' ? 'task' : 'store'}</button>
    <nav class="tabs"><button class="${S.tab === 'tasks' ? 'on' : ''}" data-act="tab" data-v="tasks">✅ Tasks</button><button class="${S.tab === 'stores' ? 'on' : ''}" data-act="tab" data-v="stores">🏪 Stores</button></nav>`;
}

/* ---------- sheets (full-screen pages) ---------- */
function openSheet(sheet) { S.sheet = sheet; S.draftComment = ''; renderSheet(); $('#sheet').scrollTop = 0; }
function closeSheet() { S.sheet = null; $('#sheet').hidden = true; $('#sheet').innerHTML = ''; }
const ownerButtons = (current, act) => S.members.map(m => `<button type="button" class="btn${current === m.email ? ' on' : ''}" data-act="${act}" data-v="${esc(m.email)}">${esc(m.name)}${m.email === S.me ? ' (me)' : ''}</button>`).join('') +
  `<button type="button" class="btn${!current ? ' on' : ''}" data-act="${act}" data-v="">Nobody yet</button>`;

function renderSheet() {
  const el = $('#sheet'), sh = S.sheet; if (!sh) return;
  el.hidden = false;
  if (sh.type === 'task') el.innerHTML = taskSheet(taskById(sh.id));
  else if (sh.type === 'new-task') el.innerHTML = newTaskSheet(sh.draft);
  else if (sh.type === 'store') { el.innerHTML = storeSheet(sh); loadThumbs(); }
  else if (sh.type === 'settings') el.innerHTML = settingsSheet();
  else if (sh.type === 'activity') el.innerHTML = activitySheet();
}

function activitySheet() {
  return `<div class="sheet-head"><button data-act="close">← Back</button><span>Recent changes</span><span></span></div>
  <div class="sheet-body">${S.activity.length ? S.activity.slice(0, 60).map(a => `<div class="act">
    <div class="act-t">${ACT_ICON[a.kind] || '•'} ${esc(a.title)}</div>
    <div class="when">${esc(nameOf(a.actor))} · ${esc(niceTime(a.created_at))}</div>
    ${a.body ? `<div class="act-b">${esc(a.body)}</div>` : ''}</div>`).join('') : '<p class="empty">Nothing yet. New tasks, picked-up tasks and store changes will show here.</p>'}</div>`;
}

function newTaskSheet(d) {
  return `<div class="sheet-head"><button data-act="close">✕ Cancel</button><span>New task</span><span></span></div>
  <form class="sheet-body" id="newTaskForm">
    <label class="f">What needs to be done?</label><input class="in title-in" name="title" value="${esc(d.title)}" placeholder="Example: Send fuel license application" required>
    <label class="f">Who owns it?</label><div class="row">${ownerButtons(d.owner, 'new-owner')}</div>
    <label class="f">Due date</label><input class="in" type="date" name="due" value="${esc(d.due || '')}">
    <label class="f">Details (optional)</label><textarea class="in" name="details">${esc(d.details)}</textarea>
    <p></p><button class="btn go wide" type="submit">Save task</button>
  </form>`;
}

function taskSheet(t) {
  if (!t) return '';
  const evs = S.events.filter(e => e.task_id === t.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const files = S.files.filter(f => f.task_id === t.id);
  return `<div class="sheet-head"><button data-act="close">← Back</button><button data-act="share" data-id="${t.id}">Share to WhatsApp</button></div>
  <div class="sheet-body">
    ${isLate(t) ? `<div class="banner" style="background:var(--red-bg);border-color:var(--red)">This task is ${esc(dueText(t))}.</div>` : ''}
    ${!t.owner && t.status !== 'done' ? '<div class="banner">🚨 Nobody owns this yet. Pick one person below.</div>' : ''}
    <input class="in title-in" data-field="title" value="${esc(t.title)}">
    <label class="f">Status</label><div class="row">${Object.keys(STATUS).map(k => `<button class="btn${t.status === k ? ' on' : ''}" data-act="status" data-v="${k}">${STATUS[k]}</button>`).join('')}</div>
    <label class="f">Who owns it?</label><div class="row">${ownerButtons(t.owner, 'owner')}</div>
    <label class="f">Due date</label><input class="in" type="date" data-field="due" value="${esc(t.due || '')}">
    <label class="f">Details</label><textarea class="in" data-field="details" placeholder="Extra notes about this task">${esc(t.details || '')}</textarea>
    <label class="f">Files and photos (${files.length})</label>
    ${files.map(f => `<div class="file"><button class="link" data-act="open-file" data-id="${f.id}">📎 ${esc(f.name)}</button><button class="x" data-act="del-file" data-id="${f.id}" aria-label="Remove file">✕</button></div>`).join('')}
    <p><label class="btn">+ Add file or photo<input type="file" id="fileIn" multiple hidden></label></p>
    <label class="f">Talk and history</label>
    ${evs.length ? evs.map(e => e.kind === 'comment'
      ? `<div class="ev"><span class="who">${esc(nameOf(e.actor))}</span><span class="when">${esc(niceTime(e.created_at))}</span><div class="body">${esc(e.body)}</div></div>`
      : `<div class="ev h">${esc(nameOf(e.actor))} ${esc(e.body)} <span class="when">${esc(niceTime(e.created_at))}</span></div>`).join('') : '<p class="muted">Nothing said yet.</p>'}
    <div class="say"><textarea class="in" id="comment" placeholder="Write an update…">${esc(S.draftComment)}</textarea><button class="btn primary" data-act="send">Send</button></div>
    <p style="margin-top:32px"><button class="btn danger" data-act="del-task">Delete this task</button></p>
  </div>`;
}

/* ---------- file viewer: shows the file inside the app, so the phone never lands on a blank page ---------- */
let viewing = null;
function closeViewer() { const v = $('#viewer'); if (v) v.remove(); viewing = null; }
async function saveViewing(el) {
  // Never send the app itself to a download link: on a phone's home-screen app that can leave a stuck black screen.
  const cur = viewing; if (!cur) return;
  if (!cur.file) { toast(cur.failed ? 'Could not get the file. Tap Open file.' : 'Still getting the file. Tap again in a moment.'); return; }
  try {
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [cur.file] })) await navigator.share({ files: [cur.file] });
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(cur.file); a.download = cur.file.name; a.click(); toast('Saved to your downloads.'); }
  } catch (e) { if (!e || e.name !== 'AbortError') { console.warn(e); toast('Could not save it. Tap Open file.'); } }
}
async function openViewer(f) {
  closeViewer();
  const v = document.createElement('div'); v.id = 'viewer';
  v.innerHTML = `<div class="sheet-head"><button type="button" data-act="viewer-close">← Back</button><span class="vname">${esc(f.name)}</span><span></span></div><div class="viewer-body"><p class="muted">Opening…</p></div>`;
  document.body.appendChild(v);
  const url = await safe(() => db.fileUrl(f), 'Could not open the file.');
  if (!v.isConnected) return;
  if (!url) { closeViewer(); return; }
  const cur = viewing = { id: f.id, file: null, failed: false };
  fetch(url).then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.blob(); })
    .then(b => { cur.file = new File([b], f.name, { type: b.type || 'application/octet-stream' }); })
    .catch(e => { cur.failed = true; console.warn(e); });
  const pic = isImage(f.name), body = $('.viewer-body', v);
  body.innerHTML = (pic ? `<img src="${esc(url)}" alt="${esc(f.name)}">`
    : `<div class="bigdoc">📄</div><p><b>${esc(f.name)}</b></p><p class="muted">Tap Open file to read it.</p>`)
    + `<p class="row vbtns"><a class="btn go" href="${esc(url)}" target="_blank" rel="noopener">Open file</a><button type="button" class="btn" data-act="viewer-save">Save or share</button></p>`;
  const img = $('img', body);
  if (img) img.addEventListener('error', () => { img.outerHTML = '<div class="bigdoc">🖼️</div><p class="muted">This picture cannot be shown here. Tap Open file.</p>'; });
}

function loadThumbs() {
  document.querySelectorAll('#sheet img[data-thumb]').forEach(async img => {
    const id = img.dataset.thumb, f = S.store_files.find(x => x.id === id); if (!f) return;
    try { if (!thumbUrls.has(id)) thumbUrls.set(id, await db.fileUrl(f)); img.src = thumbUrls.get(id); } catch (e) { console.warn(e); }
  });
}
function storeFilesBlock(sh) {
  const d = sh.draft;
  const kept = sh.id ? S.store_files.filter(f => f.store_id === sh.id && !d.removeFiles.includes(f.id)) : [];
  const all = kept.map(f => ({ ...f, pending: false })).concat(d.newFiles.map(f => ({ ...f, pending: true })));
  const kinds = [...new Set(KINDS.map(k => k[0]).concat(all.map(f => f.kind || 'other')))];
  const groups = kinds.map(k => {
    const fs = all.filter(f => (f.kind || 'other') === k); if (!fs.length) return '';
    return `<div class="sf-head" style="background:${kindColor(k)}">${esc(kindLabel(k))} (${fs.length})</div><div class="tiles">${fs.map(f => `<div class="tile${f.pending ? ' pending' : ''}">
      ${isImage(f.name) ? (f.pending ? `<img src="${esc(f.preview)}" alt="${esc(f.name)}">` : `<img data-thumb="${f.id}" data-act="sf-open" data-id="${f.id}" alt="${esc(f.name)}">`) : `<button type="button" class="doc"${f.pending ? '' : ` data-act="sf-open" data-id="${f.id}"`}>📄</button>`}
      <button type="button" class="x" data-act="sf-del" data-id="${f.id}" aria-label="Remove">✕</button><span class="nm">${f.pending ? 'Not saved yet · ' : ''}${esc(f.name)}</span></div>`).join('')}</div>`;
  }).join('');
  const kind = d.kind || 'site', custom = kind === '__custom';
  return `<label class="f">Documents &amp; photos (${all.length})</label>
    <p class="muted" style="margin:0 0 6px">What is this file? Pick it, then tap Add. Files are kept when you tap Save store.</p>
    <select class="in" id="sfKind">${KINDS.map(([k, l]) => `<option value="${k}"${kind === k ? ' selected' : ''}>${l}</option>`).join('')}<option value="__custom"${custom ? ' selected' : ''}>✏️ Custom (type your own)</option></select>
    ${custom ? `<input class="in" id="sfCustom" placeholder="Type a name, like Tank test report" value="${esc(d.customKind || '')}" style="margin-top:6px">` : ''}
    <p><label class="btn go">+ Add a file<input type="file" id="storeFileIn" multiple hidden></label></p>
    ${groups}`;
}
const xrowHtml = (x, i) => {
  const custom = x.custom || (!!x.label && !EXTRA_IDEAS.includes(x.label));
  return `<div class="xrow"><select class="in" data-x="pick"><option value="">Pick a detail…</option>${EXTRA_IDEAS.map(v => `<option${!custom && x.label === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}<option value="__custom"${custom ? ' selected' : ''}>✏️ Custom (type your own)</option></select>
    <button type="button" data-act="x-del" data-i="${i}" aria-label="Remove detail">✕</button>
    ${custom ? `<input class="in" data-x="label" placeholder="Name of the detail" value="${esc(x.label)}">` : ''}
    <input class="in" data-x="value" placeholder="Answer" value="${esc(x.value)}"></div>`;
};

function storeSheet(sh) {
  const d = sh.draft;
  const digits = (d.phone || '').replace(/[^\d+]/g, '');
  return `<div class="sheet-head"><button data-act="close">← Back</button><span>${sh.id ? 'Store' : 'New store'}</span><span></span></div>
  <form class="sheet-body" id="storeForm">
    <label class="f">Store name</label><input class="in title-in" name="name" value="${esc(d.name)}" required>
    ${sh.id && (digits || d.address) ? `<p class="row">${digits ? `<a class="btn" href="tel:${esc(digits)}">📞 Call</a>` : ''}${d.address ? `<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.address)}">📍 Map</a>` : ''}</p>` : ''}
    <label class="f">Owner or contact name</label><input class="in" name="owner_name" value="${esc(d.owner_name)}">
    <label class="f">Phone</label><input class="in" type="tel" name="phone" value="${esc(d.phone)}">
    <label class="f">Email</label><input class="in" type="email" name="email" value="${esc(d.email)}">
    <label class="f">Address</label><input class="in" name="address" value="${esc(d.address)}">
    <div class="group"><div class="group-t">🏠 Landlord</div>
    <label class="f">Landlord name</label><input class="in" name="landlord_name" value="${esc(d.landlord_name)}">
    <label class="f">Landlord number</label><input class="in" type="tel" name="landlord_phone" value="${esc(d.landlord_phone)}">
    ${sh.id && (d.landlord_phone || '').replace(/[^\d+]/g, '') ? `<p><a class="btn" href="tel:${esc(d.landlord_phone.replace(/[^\d+]/g, ''))}">📞 Call landlord</a></p>` : ''}
    <label class="f">Landlord email</label><input class="in" type="email" name="landlord_email" value="${esc(d.landlord_email)}"></div>
    <label class="f">Store details (tanks, pumps, POS, anything)</label>
    <div id="xrows">${d.extra.map(xrowHtml).join('')}</div>
    <button type="button" class="btn" data-act="x-add">+ Add a detail</button>
    <label class="f">Notes</label><textarea class="in" name="notes">${esc(d.notes)}</textarea>
    ${storeFilesBlock(sh)}
    <p></p><button class="btn go wide" type="submit">Save store</button>
    ${sh.id ? '<p style="margin-top:32px"><button type="button" class="btn danger" data-act="del-store">Delete this store</button></p>' : ''}
  </form>`;
}

function settingsSheet() {
  return `<div class="sheet-head"><button data-act="close">← Back</button><span>Settings</span><span></span></div>
  <div class="sheet-body">
    <p>Signed in as <b>${esc(nameOf(S.me))}</b>${DEMO ? ' (practice mode)' : ' · ' + esc(S.me)}</p>
    ${DEMO ? '' : `<label class="f">Alerts on this phone</label>
    ${!PUSH_OK ? '<p class="muted">This browser cannot show alerts yet. On iPhone: add the app to your Home Screen first, open it from there, then come back here.</p>'
      : alertsOn ? '<p>🔔 Alerts are ON. You get one when a task is created, picked up, or given to you, when a store is changed, and each morning if something is due, late, or has no owner.</p><div class="row"><button class="btn" data-act="alert-test">Send me a test alert</button><button class="btn" data-act="alert-off">Turn off</button></div>'
      : '<button class="btn go wide" data-act="alert-on">🔔 Turn on alerts</button>'}`}
    <label class="f">Put the app on your phone</label>
    <p><b>iPhone:</b> open this page in Safari, tap the Share button, then “Add to Home Screen”.</p>
    <p><b>Android:</b> open this page in Chrome, tap the ⋮ menu, then “Add to Home screen”.</p>
    ${DEMO ? '' : `<label class="f">Change my password</label><form id="pwForm" class="row"><input class="in" type="password" name="pw" minlength="8" placeholder="New password (8 or more letters)" autocomplete="new-password" required style="flex:1;min-width:180px"><button class="btn" type="submit">Change</button></form>`}
    <p class="muted" style="margin-top:20px">App version ${esc(window.KE_VERSION || 1)} <button class="btn" data-act="reload">Get the newest version</button></p>
    <p style="margin-top:28px"><button class="btn wide" data-act="signout">${DEMO ? 'Switch person' : 'Sign out'}</button></p>
    ${DEMO ? '<p><button class="btn danger wide" data-act="demo-reset">Wipe practice data</button></p>' : ''}
  </div>`;
}

function readStoreForm() {
  const f = $('#storeForm'), d = S.sheet.draft; if (!f) return d;
  STORE_FIELDS.forEach(([k]) => { d[k] = f.elements[k].value.trim(); });
  d.extra = [...f.querySelectorAll('.xrow')].map(r => {
    const pick = $('[data-x=pick]', r).value, custom = pick === '__custom', li = $('[data-x=label]', r);
    return { label: custom ? (li ? li.value.trim() : '') : pick, value: $('[data-x=value]', r).value.trim(), custom };
  });
  const ks = $('#sfKind'); if (ks) d.kind = ks.value;
  const kc = $('#sfCustom'); if (kc) d.customKind = kc.value.trim();
  return d;
}

/* ---------- clicks ---------- */
const ACT = {
  'demo-login': async el => { await db.signIn(el.dataset.v); await start(); },
  tab: el => { S.tab = el.dataset.v; renderMain(); window.scrollTo(0, 0); },
  filter: el => { S.filter = el.dataset.v; renderMain(); },
  settings: () => openSheet({ type: 'settings' }),
  close: () => {
    if (S.sheet && S.sheet.type === 'store' && S.sheet.draft.newFiles.length && !confirm('You added files but did not tap Save store. Leave without saving them?')) return;
    closeSheet();
  },
  refresh: async () => { await refresh(); checkVersion(); toast('Up to date.'); },
  bell: () => { openSheet({ type: 'activity' }); try { localStorage.setItem(seenKey(), nowIso()); } catch (e) { /* ignore */ } renderMain(); },
  'open-task': el => openSheet({ type: 'task', id: el.dataset.id }),
  take: el => { const id = el.dataset.id; const t = taskById(id); if (!t) return; setOwnerQuiet(id); },
  'new-task': () => openSheet({ type: 'new-task', draft: { title: '', owner: null, due: '', details: '' } }),
  'new-owner': el => { const f = $('#newTaskForm'), d = S.sheet.draft; d.title = f.elements.title.value; d.due = f.elements.due.value; d.details = f.elements.details.value; d.owner = el.dataset.v || null; renderSheet(); },
  status: el => { const t = taskById(S.sheet.id); if (t.status !== el.dataset.v) patchTask(t.id, { status: el.dataset.v }, 'set the status to ' + STATUS[el.dataset.v] + '.'); },
  owner: el => setOwner(S.sheet.id, el.dataset.v || null),
  send: async () => {
    const box = $('#comment'), text = box.value.trim(); if (!text) return;
    S.draftComment = '';
    await safe(() => addEvent(S.sheet.id, 'comment', text));
    renderSheet(); renderMain();
  },
  share: el => {
    const t = taskById(el.dataset.id);
    const text = `King Energy task\n*${t.title}*\nOwner: ${t.owner ? nameOf(t.owner) : 'NOBODY YET'}\nDue: ${t.due ? niceDate(t.due) : 'no date'}\nStatus: ${STATUS[t.status]}${isLate(t) ? ' (LATE)' : ''}\n${location.origin + location.pathname}`;
    let file = null;
    try { file = new File([taskCardBlob(t)], 'king-energy-task.png', { type: 'image/png' }); } catch (e) { console.warn(e); }
    if (navigator.share) {
      // Phones: use the phone's own share menu. The app itself never leaves this page.
      const withPic = file && navigator.canShare && navigator.canShare({ files: [file] });
      navigator.share(withPic ? { files: [file], text } : { text })
        .catch(e => { if (!e || e.name !== 'AbortError') { console.warn(e); toast('Sharing did not work on this phone.'); } });
      return;
    }
    // Computers: save the picture, then open WhatsApp in a new tab.
    if (file) { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); toast('Picture saved. Attach it in WhatsApp.'); }
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  },
  'del-task': async () => {
    const t = taskById(S.sheet.id);
    if (!confirm('Delete “' + t.title + '” for everyone? This cannot be undone.')) return;
    const files = S.files.filter(f => f.task_id === t.id);
    closeSheet();
    await safe(async () => { for (const f of files) await db.removeFile(f); await db.remove('tasks', t.id); });
    refresh();
  },
  'open-file': el => { const f = S.files.find(x => x.id === el.dataset.id); if (f) openViewer(f); },
  'viewer-close': () => closeViewer(),
  'viewer-save': el => saveViewing(el),
  'del-file': async el => {
    const f = S.files.find(x => x.id === el.dataset.id);
    if (!confirm('Remove the file “' + f.name + '”?')) return;
    S.files = S.files.filter(x => x.id !== f.id); renderSheet(); renderMain();
    await safe(async () => { await db.removeFile(f); await addEvent(f.task_id, 'history', 'removed the file ' + f.name + '.'); renderSheet(); });
  },
  'new-store': () => openSheet({ type: 'store', id: null, draft: storeDraft({}) }),
  'open-store': el => { const s = S.stores.find(x => x.id === el.dataset.id); openSheet({ type: 'store', id: s.id, draft: storeDraft(s) }); },
  'x-add': () => { readStoreForm().extra.push({ label: '', value: '' }); renderSheet(); },
  'x-del': el => { readStoreForm().extra.splice(+el.dataset.i, 1); renderSheet(); },
  'del-store': async () => {
    const id = S.sheet.id, s = S.stores.find(x => x.id === id);
    if (!confirm('Delete “' + s.name + '” and its files for everyone? This cannot be undone.')) return;
    const files = S.store_files.filter(f => f.store_id === id);
    closeSheet();
    await safe(async () => { for (const f of files) await db.removeFile(f, 'store_files'); await db.remove('stores', id); await logActivity('store', 'Store deleted: ' + s.name, 'The store and its ' + files.length + ' file(s) were removed.'); });
    refresh();
  },
  'sf-open': el => { const f = S.store_files.find(x => x.id === el.dataset.id); if (f) openViewer(f); },
  'sf-del': el => {
    const d = readStoreForm(), id = el.dataset.id, i = d.newFiles.findIndex(x => x.id === id);
    if (i >= 0) { if (d.newFiles[i].preview) URL.revokeObjectURL(d.newFiles[i].preview); d.newFiles.splice(i, 1); }
    else { d.removeFiles.push(id); toast('It will be removed when you tap Save store.'); }
    renderSheet();
  },
  reload: () => { location.href = location.pathname + '?r=' + Date.now(); },
  'alert-on': () => enableAlerts(),
  'alert-off': () => disableAlerts(),
  'alert-test': async () => {
    const r = await safe(() => db.fn('test'), 'The test alert could not be sent.');
    if (r) toast(r.sent ? 'Test alert sent. It should pop up in a few seconds.' : 'No alert went out. Turn alerts off and on again.');
  },
  signout: async () => { await disableAlerts(true); await db.signOut(); S.me = null; closeSheet(); renderLogin(); },
  'demo-reset': async () => { if (!confirm('Wipe all practice data on this device?')) return; db.reset(); closeSheet(); await refresh(); }
};
function setOwnerQuiet(id) {
  const t = taskById(id); t.owner = S.me; t.updated_at = nowIso(); renderMain(); toast('It is yours now.');
  safe(async () => { await db.update('tasks', id, { owner: S.me, updated_at: t.updated_at }); await addEvent(id, 'history', 'took this task.'); await logActivity('task_taken', nameOf(S.me) + ' picked up: ' + t.title, taskFacts(t)); });
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = ACT[el.dataset.act]; if (!fn) return;
  if (el.tagName === 'BUTTON' && el.type !== 'submit') e.preventDefault();
  fn(el);
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'loginForm') {
    try { await db.signIn(f.elements.email.value.trim().toLowerCase(), f.elements.pw.value); await start(); }
    catch (err) { renderLogin('That email or password did not work.'); }
  } else if (f.id === 'newTaskForm') {
    const title = f.elements.title.value.trim(); if (!title) return;
    const owner = S.sheet.draft.owner, due = f.elements.due.value || null;
    const t = { id: uid(), title, details: f.elements.details.value.trim(), status: 'todo', owner, due, created_by: S.me, created_at: nowIso(), updated_at: nowIso() };
    S.tasks.push(t); closeSheet(); S.tab = 'tasks'; renderMain();
    await safe(async () => {
      await db.insert('tasks', t);
      await addEvent(t.id, 'history', 'created this task' + (owner ? (owner === S.me ? ' and took it.' : ' and gave it to ' + nameOf(owner) + '.') : ' with no owner.'));
      await logActivity('task_new', 'New task: ' + t.title, taskFacts(t) + (t.details ? '\nDetails: ' + t.details : ''));
    });
    if (!owner) toast('Saved. Nobody owns it yet.');
  } else if (f.id === 'storeForm') {
    const d = readStoreForm();
    const extra = d.extra.filter(x => x.label || x.value).map(x => ({ label: x.label || 'Note', value: x.value }));
    const isNew = !S.sheet.id, id = S.sheet.id || uid(), stamp = nowIso();
    const old = isNew ? null : S.stores.find(x => x.id === id);
    const fields = {}; STORE_FIELDS.forEach(([k]) => { fields[k] = d[k]; });
    const removed = S.store_files.filter(x => d.removeFiles.includes(x.id));
    const newFiles = d.newFiles.slice();
    const lines = storeChanges(old, fields, extra, newFiles, removed);
    closeSheet();
    if (!isNew && !lines.length) { toast('Nothing changed.'); return; }
    toast('Saving…');
    const saved = await safe(async () => {
      if (isNew) await db.insert('stores', { id, ...fields, extra, created_by: S.me, updated_by: S.me, created_at: stamp, updated_at: stamp });
      else await db.update('stores', id, { ...fields, extra, updated_by: S.me, updated_at: stamp });
      for (const nf of newFiles) {
        const row = { id: nf.id, store_id: id, kind: nf.kind, name: nf.name, size: nf.size, path: 'stores/' + id + '/' + nf.id + '-' + nf.name.replace(/[^\w.\-]+/g, '_'), uploaded_by: S.me, created_at: stamp };
        await db.uploadFile(row, nf.file, 'store_files');
      }
      for (const f of removed) await db.removeFile(f, 'store_files');
      await logActivity('store', (isNew ? 'New store: ' : 'Store updated: ') + fields.name, lines.join('\n'));
      return true;
    });
    await refresh(); if (saved) toast('Store saved. Your partners are being told.');
  } else if (f.id === 'pwForm') {
    await safe(async () => { await db.setPassword(f.elements.pw.value); f.reset(); toast('Password changed.'); }, 'Could not change the password.');
  }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.id === 'fileIn') {
    const taskId = S.sheet.id, picked = [...el.files];
    for (const file of picked) {
      toast('Adding ' + file.name + '…');
      const fid = uid();
      const row = { id: fid, task_id: taskId, name: file.name, size: file.size, path: taskId + '/' + fid + '-' + file.name.replace(/[^\w.\-]+/g, '_'), uploaded_by: S.me, created_at: nowIso() };
      await safe(async () => { await db.uploadFile(row, file); S.files.push(row); await addEvent(taskId, 'history', 'added the file ' + file.name + '.'); toast('File added.'); });
    }
    if (S.sheet && S.sheet.id === taskId) renderSheet();
    renderMain();
  } else if (el.id === 'storeFileIn') {
    const d = readStoreForm(), picked = [...el.files]; let kind = d.kind || 'site';
    if (kind === '__custom') { kind = d.customKind; if (!kind) { el.value = ''; toast('Type a name for it first, then tap Add.'); return; } }
    for (const file of picked) d.newFiles.push({ id: uid(), kind, name: file.name, size: file.size, file, preview: isImage(file.name) ? URL.createObjectURL(file) : '' });
    renderSheet(); toast('Added. Tap Save store to keep it.');
  } else if (el.id === 'sfKind' || el.dataset.x === 'pick') {
    readStoreForm(); renderSheet();
    if (el.id === 'sfKind' && el.value === '__custom') { const c = $('#sfCustom'); if (c) c.focus(); }
  } else if (el.dataset.field && S.sheet && S.sheet.type === 'task') {
    const t = taskById(S.sheet.id), k = el.dataset.field; let v = el.value.trim();
    if (k === 'title') { if (!v) { el.value = t.title; return; } if (v !== t.title) patchTask(t.id, { title: v }, 'renamed this task.', true); }
    else if (k === 'details') { if (v !== (t.details || '')) patchTask(t.id, { details: v }, 'changed the details.', true); }
    else if (k === 'due') { v = v || null; if (v !== (t.due || null)) patchTask(t.id, { due: v }, v ? 'set the due date to ' + niceDate(v) + '.' : 'removed the due date.', true); }
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'comment') S.draftComment = e.target.value;
  else if (e.target.id === 'search') { S.search = e.target.value; $('#storeList').innerHTML = storeCards(); }
});

/* ---------- keep the app itself up to date ---------- */
async function checkVersion() {
  if (S.sheet) return; // never reload while someone is typing in a page
  try {
    const r = await fetch('version.json?x=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return;
    const v = Number((await r.json()).v);
    if (!(v > Number(window.KE_VERSION || 0))) return;
    let tried = null; try { tried = sessionStorage.getItem('ke_tried'); } catch (e) { /* ignore */ }
    if (tried === String(v)) return;
    try { sessionStorage.setItem('ke_tried', String(v)); } catch (e) { /* ignore */ }
    location.replace(location.pathname + '?v=' + v);
  } catch (e) { /* offline: try again next time */ }
}

/* ---------- start ---------- */
async function start() {
  S.me = await db.session();
  if (DEMO) { const d = await db.loadAll(); S.members = d.members; }
  if (!S.me) { renderLogin(); return; }
  await refresh();
  if (!S.members.some(m => m.email === S.me)) {
    const who = S.me; await db.signOut(); S.me = null;
    renderLogin(who + ' is not on the King Energy list.'); return;
  }
  await checkAlerts();
  renderMain();
}

(async () => {
  try { await db.init(); await start(); }
  catch (e) { console.error(e); $('#app').innerHTML = '<p class="loading">Could not start. Check your internet and reload.</p>'; }
  checkVersion();
  let lastWake = 0;
  const wake = () => { if (document.hidden || Date.now() - lastWake < 3000) return; lastWake = Date.now(); checkVersion(); if (S.me) refresh(); };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('pageshow', wake);
  window.addEventListener('focus', wake);
  setInterval(() => { if (!document.hidden && S.me && !['INPUT', 'TEXTAREA'].includes((document.activeElement || {}).tagName)) refresh(); }, 60000);
})();
})();
