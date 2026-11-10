(() => {
'use strict';

/* ---------- small helpers ---------- */
const CFG = window.KE_CONFIG || {};
const DEMO = !CFG.supabaseUrl || !CFG.supabaseKey;
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
      save();
    },
    async uploadFile(row, file) {
      if (file.size > 400000) throw new Error('Practice mode can only keep small files (under 400 KB). Real mode has no such limit.');
      row.data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
      d.files.push({ ...row }); save();
    },
    async fileUrl(row) { const f = d.files.find(x => x.id === row.id); const blob = await (await fetch(f.data)).blob(); return URL.createObjectURL(blob); },
    async removeFile(row) { d.files = d.files.filter(x => x.id !== row.id); save(); },
    async fn() { return {}; },
    reset() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } d = seed(); }
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
      const names = ['members', 'tasks', 'events', 'files', 'stores'];
      const rs = await Promise.all(names.map(n => sb.from(n).select('*')));
      const out = {}; rs.forEach((r, i) => { out[names[i]] = ok(r); }); return out;
    },
    async insert(t, row) { ok(await sb.from(t).insert(row)); },
    async update(t, id, patch) { ok(await sb.from(t).update(patch).eq('id', id)); },
    async remove(t, id) { ok(await sb.from(t).delete().eq('id', id)); },
    async uploadFile(row, file) { ok(await sb.storage.from('files').upload(row.path, file)); await this.insert('files', row); },
    async fileUrl(row) { return ok(await sb.storage.from('files').createSignedUrl(row.path, 3600)).signedUrl; },
    async removeFile(row) { await sb.storage.from('files').remove([row.path]); await this.remove('files', row.id); },
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
const S = { me: null, members: [], tasks: [], events: [], files: [], stores: [], tab: 'tasks', filter: 'all', sheet: null, search: '', draftComment: '' };
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
    S.tasks = d.tasks; S.events = d.events; S.files = d.files; S.stores = d.stores;
  } catch (e) { console.error(e); toast('Could not load. Check your internet.'); return; }
  renderMain();
  const sheetEl = $('#sheet');
  if (S.sheet && S.sheet.type === 'task' && !sheetEl.contains(document.activeElement)) {
    if (taskById(S.sheet.id)) renderSheet(); else closeSheet();
  }
}

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
  return patchTask(id, { owner: email || null }, note).then(() => { if (email && email !== S.me) ping('assigned', { task_id: id }); });
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
  return list.map(s => `<div class="card" data-act="open-store" data-id="${s.id}">
    <div class="card-title">${esc(s.name || 'No name')}</div>
    <div class="card-meta">${s.owner_name ? `<span>👤 ${esc(s.owner_name)}</span>` : ''}${s.phone ? `<span>📞 ${esc(s.phone)}</span>` : ''}${s.address ? `<span>📍 ${esc(s.address)}</span>` : ''}</div>
  </div>`).join('');
}

function renderMain() {
  if (!S.me) return;
  const open = S.tasks.filter(t => t.status !== 'done');
  const nLate = open.filter(isLate).length, nNobody = open.filter(t => !t.owner).length;
  const sub = [nLate ? nLate + ' late' : '', nNobody ? nNobody + ' with no owner' : ''].filter(Boolean).join(' · ') || 'All tasks have an owner and are on time';
  $('#app').innerHTML = `
    <header class="top"><h1>King Energy<small>${esc(sub)}</small></h1><button data-act="settings">${esc(nameOf(S.me))} ⚙</button></header>
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
  else if (sh.type === 'store') el.innerHTML = storeSheet(sh);
  else if (sh.type === 'settings') el.innerHTML = settingsSheet();
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
    <label class="f">More boxes (tanks, pumps, POS, anything)</label>
    <div id="xrows">${d.extra.map((x, i) => `<div class="xrow"><input class="in" list="ideas" data-x="label" placeholder="What" value="${esc(x.label)}"><input class="in" data-x="value" placeholder="Answer" value="${esc(x.value)}"><button type="button" data-act="x-del" data-i="${i}" aria-label="Remove box">✕</button></div>`).join('')}</div>
    <datalist id="ideas">${EXTRA_IDEAS.map(v => `<option value="${esc(v)}">`).join('')}</datalist>
    <button type="button" class="btn" data-act="x-add">+ Add a box</button>
    <label class="f">Notes</label><textarea class="in" name="notes">${esc(d.notes)}</textarea>
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
      : alertsOn ? '<p>🔔 Alerts are ON. You get one when a task is given to you, when a new task has no owner, and each morning if something is due, late, or has no owner.</p><div class="row"><button class="btn" data-act="alert-test">Send me a test alert</button><button class="btn" data-act="alert-off">Turn off</button></div>'
      : '<button class="btn go wide" data-act="alert-on">🔔 Turn on alerts</button>'}`}
    <label class="f">Put the app on your phone</label>
    <p><b>iPhone:</b> open this page in Safari, tap the Share button, then “Add to Home Screen”.</p>
    <p><b>Android:</b> open this page in Chrome, tap the ⋮ menu, then “Add to Home screen”.</p>
    ${DEMO ? '' : `<label class="f">Change my password</label><form id="pwForm" class="row"><input class="in" type="password" name="pw" minlength="8" placeholder="New password (8 or more letters)" autocomplete="new-password" required style="flex:1;min-width:180px"><button class="btn" type="submit">Change</button></form>`}
    <p style="margin-top:28px"><button class="btn wide" data-act="signout">${DEMO ? 'Switch person' : 'Sign out'}</button></p>
    ${DEMO ? '<p><button class="btn danger wide" data-act="demo-reset">Wipe practice data</button></p>' : ''}
  </div>`;
}

function readStoreForm() {
  const f = $('#storeForm'), d = S.sheet.draft; if (!f) return d;
  ['name', 'owner_name', 'phone', 'email', 'address', 'notes'].forEach(k => { d[k] = f.elements[k].value.trim(); });
  d.extra = [...f.querySelectorAll('.xrow')].map(r => ({ label: $('[data-x=label]', r).value.trim(), value: $('[data-x=value]', r).value.trim() }));
  return d;
}

/* ---------- clicks ---------- */
const ACT = {
  'demo-login': async el => { await db.signIn(el.dataset.v); await start(); },
  tab: el => { S.tab = el.dataset.v; renderMain(); window.scrollTo(0, 0); },
  filter: el => { S.filter = el.dataset.v; renderMain(); },
  settings: () => openSheet({ type: 'settings' }),
  close: () => closeSheet(),
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
  'open-file': async el => {
    const f = S.files.find(x => x.id === el.dataset.id); const w = window.open('', '_blank');
    const url = await safe(() => db.fileUrl(f), 'Could not open the file.');
    if (!url) { if (w) w.close(); return; }
    if (w) w.location = url; else location.href = url;
  },
  'del-file': async el => {
    const f = S.files.find(x => x.id === el.dataset.id);
    if (!confirm('Remove the file “' + f.name + '”?')) return;
    S.files = S.files.filter(x => x.id !== f.id); renderSheet(); renderMain();
    await safe(async () => { await db.removeFile(f); await addEvent(f.task_id, 'history', 'removed the file ' + f.name + '.'); renderSheet(); });
  },
  'new-store': () => openSheet({ type: 'store', id: null, draft: { name: '', owner_name: '', phone: '', email: '', address: '', notes: '', extra: [] } }),
  'open-store': el => { const s = S.stores.find(x => x.id === el.dataset.id); openSheet({ type: 'store', id: s.id, draft: { name: s.name || '', owner_name: s.owner_name || '', phone: s.phone || '', email: s.email || '', address: s.address || '', notes: s.notes || '', extra: (s.extra || []).map(x => ({ ...x })) } }); },
  'x-add': () => { readStoreForm().extra.push({ label: '', value: '' }); renderSheet(); const rows = document.querySelectorAll('.xrow'); if (rows.length) $('input', rows[rows.length - 1]).focus(); },
  'x-del': el => { readStoreForm().extra.splice(+el.dataset.i, 1); renderSheet(); },
  'del-store': async () => {
    const id = S.sheet.id, s = S.stores.find(x => x.id === id);
    if (!confirm('Delete “' + s.name + '” for everyone? This cannot be undone.')) return;
    closeSheet(); await safe(() => db.remove('stores', id)); refresh();
  },
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
  safe(async () => { await db.update('tasks', id, { owner: S.me, updated_at: t.updated_at }); await addEvent(id, 'history', 'took this task.'); });
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
      if (!owner) ping('unowned', { task_id: t.id }); else if (owner !== S.me) ping('assigned', { task_id: t.id });
    });
    if (!owner) toast('Saved. Nobody owns it yet.');
  } else if (f.id === 'storeForm') {
    const d = readStoreForm(); d.extra = d.extra.filter(x => x.label || x.value);
    const id = S.sheet.id, stamp = nowIso();
    closeSheet();
    await safe(async () => {
      if (id) await db.update('stores', id, { ...d, updated_by: S.me, updated_at: stamp });
      else await db.insert('stores', { id: uid(), ...d, created_by: S.me, updated_by: S.me, created_at: stamp, updated_at: stamp });
    });
    await refresh(); toast('Store saved.');
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
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me) refresh(); });
  setInterval(() => { if (!document.hidden && S.me && !['INPUT', 'TEXTAREA'].includes((document.activeElement || {}).tagName)) refresh(); }, 60000);
})();
})();
