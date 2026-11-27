/* Vision Trainer — single-page UI (no build step). */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const COLORS = ['#F97316', '#38BDF8', '#FACC15', '#A78BFA', '#F472B6', '#34D399', '#FB7185', '#22D3EE', '#E879F9'];
const STEPS = [['project', 'โปรเจกต์'], ['capture', 'เก็บภาพ'], ['label', 'Label'], ['train', 'เทรน'], ['results', 'ผลลัพธ์'], ['deploy', 'Deploy']];
const STAGE_TH = {starting: 'กำลังเริ่ม', loading: 'กำลังเตรียมข้อมูล', training: 'กำลังเทรน', evaluating: 'กำลังวัดผล', exporting: 'กำลังแปลงไฟล์ ONNX', done: 'เสร็จแล้ว'};

const S = {projects: [], pid: Number(localStorage.getItem('vt_pid')) || null, project: null, status: null};
let cleanup = null;

async function api(path, opts = {}) {
  const o = {...opts};
  if (o.json !== undefined) { o.body = JSON.stringify(o.json); o.headers = {'Content-Type': 'application/json'}; delete o.json; }
  const r = await fetch(path, o);
  let data = null;
  try { data = await r.json(); } catch (e) { /* not json */ }
  if (!r.ok) throw new Error((data && (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail))) || r.statusText);
  return data;
}
function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; t.setAttribute('role', 'status');
  document.body.appendChild(t); setTimeout(() => t.remove(), err ? 5000 : 2200);
}
const fail = e => toast(e.message || String(e), true);
const fmtDate = ts => ts ? new Date(ts * 1000).toLocaleString(LOC(), {dateStyle: 'medium', timeStyle: 'short'}) : '—';
const fmtDur = s => s == null ? '—' : s < 60 ? `${Math.round(s)} วินาที` : s < 3600 ? `${Math.round(s / 60)} นาที` : `${(s / 3600).toFixed(1)} ชม.`;
const typing = e => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) && e.target.type !== 'checkbox' && e.target.type !== 'radio' && e.target.type !== 'range';
const clsName = i => S.project?.classes[i] ?? `class ${i}`;

/* ------------------------------------------------------------------ shell */
async function loadProjects() {
  S.projects = await api('/api/projects');
  if (!S.projects.find(p => p.id === S.pid)) S.pid = S.projects[0]?.id ?? null;
  const sel = $('#projSel');
  sel.innerHTML = S.projects.length ? S.projects.map(p => `<option value="${p.id}" ${p.id === S.pid ? 'selected' : ''}>${esc(p.name)}${p.station ? ' · ' + esc(p.station) : ''}</option>`).join('')
    : '<option>— ยังไม่มีโปรเจกต์ —</option>';
  await loadProject();
}
async function loadProject() {
  if (S.pid) localStorage.setItem('vt_pid', S.pid);
  S.project = S.pid ? await api(`/api/projects/${S.pid}`) : null;
}
$('#projSel').addEventListener('change', async e => { S.pid = Number(e.target.value); await loadProject(); route(); });

function renderSteps(cur) {
  $('#steps').innerHTML = STEPS.map(([k, t], i) => `<a class="step ${k === cur ? 'on' : ''}" href="#/${k}" ${k === cur ? 'aria-current="step"' : ''}><b>${i + 1}</b>${t}</a>`).join('')
    + `<a class="step monlink ${cur === 'monitor' ? 'on' : ''}" href="#/monitor"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>หน้าจอไลน์</a>`;
}
async function pollStatus() {
  try {
    S.status = await api('/api/status');
    const c = S.status.camera, p = S.status.plc, t = S.status.train;
    $('#dots').innerHTML = `<span title="${esc(c.error || c.info)}"><span class="dot ${c.running && !c.error ? 'ok' : 'bad'}"></span>กล้อง</span>
      <span title="${esc(p.error || p.listen)}"><span class="dot ${p.running && !p.error ? 'ok' : (p.enabled ? 'bad' : '')}"></span>PLC</span>
      ${t.running ? `<a href="#/train" style="color:#fff"><span class="dot ok"></span>เทรน v${t.version} ${t.pct}%</a>` : ''}`;
  } catch (e) { $('#dots').innerHTML = '<span><span class="dot bad"></span>เชื่อมต่อ server ไม่ได้</span>'; }
}
setInterval(pollStatus, 3000);

function parseHash() {
  const [path, qs] = (location.hash.replace(/^#\/?/, '') || 'capture').split('?');
  return {name: path || 'capture', params: Object.fromEntries(new URLSearchParams(qs || ''))};
}
async function route() {
  if (cleanup) { try { cleanup(); } catch (e) { /* */ } cleanup = null; }
  let {name, params} = parseHash();
  if (!S.project && name !== 'project') name = 'project';
  document.body.classList.toggle('kiosk', name === 'monitor' && params.kiosk === '1');
  document.body.classList.toggle('dark', name === 'monitor');
  renderSteps(name);
  const view = $('#view');
  view.innerHTML = '<div class="empty">กำลังโหลด…</div>';
  try { cleanup = await (VIEWS[name] || VIEWS.capture)(view, params); } catch (e) { view.innerHTML = `<div class="card warn"><h2>เกิดข้อผิดพลาด</h2><p>${esc(e.message)}</p></div>`; }
}
window.addEventListener('hashchange', route);

/* ------------------------------------------------------------------ 1. project */
async function viewProject(v) {
  const p = S.project;
  v.innerHTML = `
  <div class="head"><div><h1>โปรเจกต์</h1><p class="muted">1 โปรเจกต์ = 1 จุดตรวจ (สถานี + กล้อง + ชุด class) — ไม่ควรเกิน 3–5 class ต่อโมเดล</p></div></div>
  <div class="row">
    <section class="card grow"><h2>เลือกโปรเจกต์</h2>
      ${S.projects.length ? S.projects.map(x => `<div class="proj ${x.id === S.pid ? 'on' : ''}"><div><b>${esc(x.name)}</b> <span class="muted">${esc(x.station)}</span><br>
        <span class="muted" style="font-size:13px">${x.classes.map(esc).join(', ')} · ${x.n_images} ภาพ · ${x.live_version ? 'ใช้งานจริง v' + x.live_version : 'ยังไม่ deploy'}</span></div>
        ${x.id === S.pid ? '<span class="pill blue">กำลังใช้</span>' : `<button class="btn sm" data-pick="${x.id}">เลือก</button>`}</div>`).join('') : '<p class="empty">ยังไม่มีโปรเจกต์ — สร้างโปรเจกต์แรกทางขวา</p>'}
    </section>
    <section class="card side"><h2>สร้างโปรเจกต์ใหม่</h2>
      <form id="newP" style="display:flex;flex-direction:column;gap:10px">
        <label class="field"><span>ชื่อ</span><input type="text" name="name" required placeholder="เช่น ตรวจรอยแตก"></label>
        <label class="field"><span>สถานี / กล้อง</span><input type="text" name="station" placeholder="เช่น ST-07"></label>
        <label class="field"><span>ประเภทตำหนิ (1 บรรทัดต่อ 1 class, ใช้ชื่อเดียวกับใน settings.json → defect_codes)</span><textarea name="classes" required placeholder="crack&#10;hole_deform"></textarea></label>
        <button class="btn primary" type="submit">สร้างและเริ่มเก็บภาพ</button>
      </form>
    </section>
  </div>
  ${p ? `<section class="card"><h2>แก้ไขโปรเจกต์ปัจจุบัน</h2>
    <form id="editP" class="row" style="align-items:flex-end">
      <label class="field"><span>ชื่อ</span><input type="text" name="name" value="${esc(p.name)}"></label>
      <label class="field"><span>สถานี</span><input type="text" name="station" value="${esc(p.station)}"></label>
      <label class="field" style="flex:1 1 300px"><span>Class (เพิ่มต่อท้ายได้ ห้ามลบ/สลับเมื่อ label แล้ว)</span><input type="text" name="classes" value="${esc(p.classes.join(', '))}"></label>
      <button class="btn" type="submit">บันทึก</button>
    </form></section>` : ''}`;
  $$('[data-pick]', v).forEach(b => b.onclick = async () => { S.pid = Number(b.dataset.pick); await loadProjects(); route(); });
  $('#newP', v).onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    try {
      const np = await api('/api/projects', {method: 'POST', json: {name: f.get('name'), station: f.get('station'), classes: f.get('classes').split(/[\n,]/)}});
      S.pid = np.id; await loadProjects(); location.hash = '#/capture';
    } catch (er) { fail(er); }
  };
  const ed = $('#editP', v);
  if (ed) ed.onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    try { await api(`/api/projects/${S.pid}`, {method: 'PUT', json: {name: f.get('name'), station: f.get('station'), classes: f.get('classes').split(',')}}); await loadProjects(); toast('บันทึกแล้ว'); route(); } catch (er) { fail(er); }
  };
}

/* ------------------------------------------------------------------ 2. capture */
async function viewCapture(v) {
  const pid = S.pid;
  v.innerHTML = `
  <div class="head"><div><h1>เก็บภาพจากไลน์</h1><p class="muted">ถ่ายเอง, ให้ระบบเก็บทุกครั้งที่ PLC ส่ง trigger, หรืออัปโหลดภาพที่มีอยู่แล้ว</p></div>
    <a class="btn primary" href="#/label" id="toLabel">ไป Label →</a></div>
  <div class="row">
    <section class="card grow" aria-label="กล้องสด">
      <div class="live" id="live"><img id="stream" alt="ภาพสดจากกล้อง"><span class="ov" id="camOv">กำลังเชื่อมต่อกล้อง…</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between">
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
          <button class="btn primary" id="snap">ถ่ายภาพ <span class="kbd">Space</span></button>
          <label class="chk"><input type="checkbox" id="auto"> เก็บอัตโนมัติทุก trigger จาก PLC</label>
        </div>
        <button class="btn sm" id="camRestart">เปิดกล้องใหม่</button>
      </div>
    </section>
    <aside class="side" style="display:flex;flex-direction:column;gap:18px">
      <section class="card" id="need"></section>
      <section class="card warn" id="warns" hidden></section>
      <section class="card"><h2>อัปโหลดภาพ</h2>
        <div class="drop" id="drop">ลากไฟล์ภาพมาวางที่นี่ หรือ <label style="color:var(--blue);cursor:pointer;text-decoration:underline">เลือกไฟล์<input type="file" id="files" multiple accept="image/*" hidden></label></div>
        <label class="chk"><input type="checkbox" id="dedupe" checked> ข้ามไฟล์ที่เคยอัปโหลดแล้ว</label>
      </section>
    </aside>
  </div>
  <section class="card"><div class="head"><h2>ภาพล่าสุด</h2><a href="#/label?filter=all">ดูทั้งหมด</a></div><div class="thumbs" id="recent"></div></section>`;

  $('#stream').src = '/api/camera/stream?t=' + Date.now();
  const refresh = async () => {
    try {
      const [p, rec] = await Promise.all([api(`/api/projects/${pid}`), api(`/api/projects/${pid}/images?order=desc&limit=16`)]);
      S.project = p; const s = p.summary;
      $('#toLabel').textContent = `ไป Label (${s.unlabeled} ภาพรอ) →`;
      $('#need').innerHTML = `<h2>ภาพที่ต้องเก็บ (label แล้ว)</h2>` + s.rows.map(r => {
        const pct = Math.min(100, Math.round(100 * r.n / r.target));
        return `<div style="display:flex;flex-direction:column;gap:5px"><div style="display:flex;justify-content:space-between"><b>${esc(r.name)}</b><span class="mono">${r.n} / ${r.target}</span></div>
          <div class="bar ${pct < 50 ? 'low' : ''}"><div style="width:${pct}%"></div></div></div>`;
      }).join('') + `<p class="muted" style="margin:0;font-size:13px">ทั้งหมด ${s.total} ภาพ · รอ label ${s.unlabeled} · รอตรวจจากไลน์ ${s.review}</p>`;
      const w = $('#warns'); w.hidden = !s.warnings.length;
      w.innerHTML = '<h2>ควรแก้ก่อนเทรน</h2>' + s.warnings.map(x => `<p style="margin:0;font-size:14px">• ${esc(x)}</p>`).join('');
      $('#recent').innerHTML = rec.items.length ? rec.items.map(it => `<a class="thumb" href="#/label?id=${it.id}"><div class="im"><img loading="lazy" src="/api/images/${it.id}/thumb" alt=""></div>
        <span style="color:${it.status === 'labeled' ? 'var(--muted)' : 'var(--blue)'};font-weight:600">${it.status === 'labeled' ? (it.n_boxes ? `label แล้ว · ${it.n_boxes} กรอบ` : 'label แล้ว · OK') : it.status === 'review' ? 'รอตรวจ' : 'ยังไม่ label'}</span></a>`).join('')
        : '<p class="empty">ยังไม่มีภาพ</p>';
    } catch (e) { fail(e); }
  };
  const camRefresh = () => {
    const st = S.status; if (!st) return;
    const c = st.camera;
    $('#camOv').textContent = c.running ? `● ${c.info} · ${c.fps} fps${c.error ? ' · ' + c.error : ''}` : `กล้องไม่ทำงาน: ${c.error || 'ยังไม่เปิด'}`;
    const ac = st.auto_capture || {};
    $('#auto').checked = !!(ac.enabled && ac.project_id === pid);
  };
  const snap = async () => {
    try { const r = await api(`/api/projects/${pid}/capture`, {method: 'POST'}); toast(r.duplicate ? 'เฟรมเดิม — ยังไม่ได้บันทึก' : 'บันทึกภาพแล้ว'); refresh(); } catch (e) { fail(e); }
  };
  $('#snap').onclick = snap;
  $('#auto').onchange = async e => { try { await api('/api/capture/auto', {method: 'PUT', json: {project_id: pid, enabled: e.target.checked}}); await pollStatus(); toast(e.target.checked ? 'เปิดเก็บอัตโนมัติแล้ว' : 'ปิดเก็บอัตโนมัติ'); } catch (er) { fail(er); } };
  $('#camRestart').onclick = async () => { try { await api('/api/camera/restart', {method: 'POST'}); await pollStatus(); camRefresh(); $('#stream').src = '/api/camera/stream?t=' + Date.now(); } catch (e) { fail(e); } };
  const upload = async files => {
    files = [...files].filter(f => f.type.startsWith('image/')); if (!files.length) return;
    let added = 0, dup = 0, bad = 0;
    for (let i = 0; i < files.length; i += 20) {
      const fd = new FormData(); files.slice(i, i + 20).forEach(f => fd.append('files', f));
      toast(`กำลังอัปโหลด ${Math.min(i + 20, files.length)} / ${files.length}`);
      try { const r = await api(`/api/projects/${pid}/images?dedupe=${$('#dedupe').checked}`, {method: 'POST', body: fd}); added += r.added; dup += r.duplicates; bad += r.unreadable; } catch (e) { fail(e); break; }
    }
    toast(`เพิ่ม ${added} ภาพ` + (dup ? ` · ข้ามไฟล์ซ้ำ ${dup}` : '') + (bad ? ` · อ่านไม่ได้ ${bad}` : '')); refresh();
  };
  $('#files').onchange = e => upload(e.target.files);
  const drop = $('#drop');
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files); };
  const key = e => { if (e.code === 'Space' && !typing(e)) { e.preventDefault(); snap(); } };
  document.addEventListener('keydown', key);
  await refresh(); camRefresh();
  const t1 = setInterval(refresh, 5000), t2 = setInterval(camRefresh, 1500);
  return () => { document.removeEventListener('keydown', key); clearInterval(t1); clearInterval(t2); const s = $('#stream'); if (s) s.src = ''; };
}

/* ------------------------------------------------------------------ 3. label */
async function viewLabel(v, params) {
  const pid = S.pid, classes = S.project.classes;
  const models = await api(`/api/projects/${pid}/models`);
  const done = models.filter(m => m.status === 'done');
  const savedHelper = Number(localStorage.getItem('vt_helper_' + pid));
  let helper = done.find(m => m.id === savedHelper) || done.find(m => m.stage === 'live') || done[0];
  let sugConf = Number(localStorage.getItem('vt_sugconf')) || 0.25;
  const L = {filter: params.id ? 'all' : (params.filter || 'unlabeled'), ids: [], idx: 0, img: null, boxes: [], ok: false, cls: 0, tool: 'box', sel: -1,
    undo: [], drag: null, auto: localStorage.getItem('vt_auto') !== '0', saveT: null, el: null, scale: 1};
  v.innerHTML = `
  <div class="banner" id="banner"></div>
  <div class="lab">
    <aside class="left">
      <section class="card" style="padding:14px"><h2>Class</h2><div id="classes" style="display:flex;flex-direction:column;gap:6px"></div></section>
      <section class="card" style="padding:14px"><h2>เครื่องมือ</h2>
        <button class="tool" data-tool="box">ลากกรอบเอง<span class="kbd">B</span></button>
        <button class="tool" data-tool="sam">คลิกจุดเดียว (AI ตีกรอบ)<span class="kbd">S</span></button>
        <button class="tool" id="copyPrev">คัดลอกกรอบจากภาพก่อน<span class="kbd">C</span></button>
        <button class="tool" id="markOk">ภาพนี้ไม่มีตำหนิ (OK)<span class="kbd">0</span></button>
        <button class="tool" id="delImg" style="color:var(--ng)">ลบภาพนี้</button>
      </section>
    </aside>
    <section class="card center" aria-label="ภาพที่กำลัง label">
      <div class="head" style="align-items:center">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b id="pos"></b><span class="pill" id="imgState"></span>
          <label class="muted" style="font-size:13px">แสดง <select id="filter"><option value="unlabeled">ยังไม่ label</option><option value="all">ทั้งหมด</option><option value="labeled">label แล้ว</option></select></label></div>
        <div style="display:flex;gap:8px"><button class="btn" id="prev" aria-label="ภาพก่อนหน้า">← <span class="kbd">A</span></button><button class="btn" id="next" aria-label="ภาพถัดไป"><span class="kbd">D</span> →</button></div>
      </div>
      <div class="canvas-wrap" id="wrap"><canvas id="cv" width="960" height="600"></canvas></div>
      <p class="muted" style="margin:0;font-size:13px">แก้กรอบ: คลิกกรอบเพื่อเลือก · ลากเพื่อย้าย · ลากมุมสีขาวเพื่อปรับขนาด · เปลี่ยน class จากรายการทางขวาหรือกด 1–9 · Del ลบ</p>
      <div><div style="display:flex;justify-content:space-between;font-size:14px"><span class="muted">label แล้วทั้งโปรเจกต์</span><span class="mono" id="progTxt"></span></div><div class="bar"><div id="progBar"></div></div></div>
    </section>
    <aside class="right">
      <section class="card" style="padding:14px"><h2>กรอบในภาพนี้</h2><div id="boxList"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm primary" id="accAll">ยอมรับทั้งหมด</button><button class="btn sm" id="suggest">ให้ AI เสนอกรอบ</button></div></section>
      <section class="card" style="padding:14px;font-size:14px"><h2>คีย์ลัด</h2>
        <div class="kv"><span>เปลี่ยน class / class ของกรอบที่เลือก</span><span class="kbd">1–9</span></div>
        <div class="kv"><span>ยอมรับกรอบ AI</span><span class="kbd">Enter</span></div>
        <div class="kv"><span>ยอมรับกรอบ AI ทั้งหมด</span><span class="kbd">Shift+Enter</span></div>
        <div class="kv"><span>ปฏิเสธกรอบ AI</span><span class="kbd">X</span></div>
        <div class="kv"><span>ลบกรอบที่เลือก</span><span class="kbd">Del</span></div>
        <div class="kv"><span>ย้อนกลับ</span><span class="kbd">Ctrl+Z</span></div>
        <div class="kv"><span>ภาพก่อน / ถัดไป</span><span class="kbd">A / D</span></div>
      </section>
      <a class="btn primary" href="#/train">ไปเทรน →</a>
    </aside>
  </div>`;
  const cv = $('#cv'), ctx = cv.getContext('2d');
  $('#filter').value = L.filter;
  const stageTxt = m => m.stage === 'live' ? ' · ใช้งานจริง' : m.stage === 'shadow' ? ' · shadow' : '';
  $('#banner').innerHTML = helper
    ? `<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center"><b>AI ช่วย label</b>
        <label class="chk">โมเดล <select id="helperSel">${done.map(m => `<option value="${m.id}" ${m.id === helper.id ? 'selected' : ''}>v${m.version} (${m.preset === 'fast' ? 'เร็ว' : m.preset === 'accurate' ? 'แม่นยำ' : esc(m.preset)})${stageTxt(m)}</option>`).join('')}</select></label>
        <label class="chk">ความมั่นใจขั้นต่ำ <input type="number" id="sugConf" min="0.05" max="0.9" step="0.05" value="${sugConf}" style="width:80px"></label>
        <span class="muted" style="font-size:13px">กรอบที่ AI เสนอเป็นเส้นประ — ยอมรับ แก้ หรือลบได้</span></div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><label class="chk"><input type="checkbox" id="autoSug" ${L.auto ? 'checked' : ''}> เสนอกรอบอัตโนมัติเมื่อเปิดภาพที่ยังไม่มีกรอบ</label>
        <button class="btn sm" id="suggestTop">ให้ AI เสนอกรอบภาพนี้ใหม่</button></div>`
    : `<span><b>ยังไม่มีโมเดลช่วย label</b> — label ประมาณ 30 ภาพแล้ว <a href="#/train">เทรนโหมดเร็ว</a> ระบบจะเริ่มเสนอกรอบให้ภาพที่เหลือ</span>`;
  const as = $('#autoSug'); if (as) as.onchange = e => { L.auto = e.target.checked; localStorage.setItem('vt_auto', L.auto ? '1' : '0'); };
  const hs = $('#helperSel'); if (hs) hs.onchange = e => { helper = done.find(m => m.id === Number(e.target.value)); localStorage.setItem('vt_helper_' + pid, helper.id); suggest(false); };
  const sc = $('#sugConf'); if (sc) sc.onchange = e => { sugConf = Math.min(0.9, Math.max(0.05, Number(e.target.value) || 0.25)); e.target.value = sugConf; localStorage.setItem('vt_sugconf', sugConf); suggest(false); };
  const st2 = $('#suggestTop'); if (st2) st2.onclick = () => suggest(false);
  $('#classes').innerHTML = classes.map((c, i) => `<button class="tool" data-cls="${i}"><span><span class="sw" style="background:${COLORS[i]}"></span>${esc(c)}</span><span class="kbd">${i + 1}</span></button>`).join('');
  const paintTools = () => {
    $$('[data-cls]').forEach(b => b.classList.toggle('on', Number(b.dataset.cls) === L.cls));
    $$('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === L.tool));
  };
  $$('[data-cls]').forEach(b => b.onclick = () => setCls(Number(b.dataset.cls)));
  $$('[data-tool]').forEach(b => b.onclick = () => { L.tool = b.dataset.tool; paintTools(); });

  const pushUndo = () => { L.undo.push(JSON.stringify({b: L.boxes, ok: L.ok})); if (L.undo.length > 50) L.undo.shift(); };
  const save = () => {
    clearTimeout(L.saveT);
    const id = L.img?.id; if (!id) return;
    const body = {boxes: L.boxes, ok: L.ok};
    L.saveT = setTimeout(async () => {
      try { const r = await api(`/api/images/${id}/annotation`, {method: 'PUT', json: body}); if (L.img && L.img.id === id) { L.img.status = r.status; paintSide(); } progress(); } catch (e) { fail(e); }
    }, 250);
  };
  const changed = () => { L.ok = L.ok && L.boxes.length === 0; draw(); paintSide(); save(); };
  function setCls(i) {
    if (i >= classes.length) return;
    L.cls = i;
    if (L.sel >= 0) { pushUndo(); L.boxes[L.sel].cls = i; L.boxes[L.sel].confirmed = true; L.boxes[L.sel].origin = 'human'; changed(); }
    paintTools();
  }
  async function progress() {
    try { const p = await api(`/api/projects/${pid}`); const s = p.summary; $('#progTxt').textContent = `${s.labeled} / ${s.total}`; $('#progBar').style.width = (s.total ? 100 * s.labeled / s.total : 0) + '%'; } catch (e) { /* */ }
  }
  async function loadList(keepId) {
    const r = await api(`/api/projects/${pid}/images?limit=100000${L.filter === 'all' ? '' : '&status=' + L.filter}`);
    L.ids = r.items.map(x => x.id);
    L.idx = keepId && L.ids.includes(keepId) ? L.ids.indexOf(keepId) : 0;
  }
  async function open(i) {
    if (L.saveT) { clearTimeout(L.saveT); L.saveT = null; if (L.img) await api(`/api/images/${L.img.id}/annotation`, {method: 'PUT', json: {boxes: L.boxes, ok: L.ok}}).catch(fail); }
    if (!L.ids.length) {
      L.img = null; L.boxes = []; ctx.clearRect(0, 0, cv.width, cv.height);
      $('#pos').textContent = 'ไม่มีภาพในรายการนี้'; $('#imgState').textContent = ''; $('#boxList').innerHTML = L.filter === 'unlabeled' ? '<p class="muted">label ครบแล้ว 🎉 — ไปเทรนได้เลย</p>' : '';
      return;
    }
    L.idx = Math.max(0, Math.min(i, L.ids.length - 1));
    const img = await api(`/api/images/${L.ids[L.idx]}`);
    L.img = img; L.boxes = img.boxes.map(b => ({cls: b.cls, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, origin: b.origin, conf: b.conf, confirmed: !!b.confirmed}));
    L.ok = img.status === 'labeled' && !L.boxes.length; L.sel = -1; L.undo = [];
    $('#pos').textContent = `ภาพ ${L.idx + 1} / ${L.ids.length}`;
    const el = new Image(); el.src = `/api/images/${img.id}/file`;
    await el.decode().catch(() => {});
    if (L.img !== img) return;
    L.el = el;
    const wrapW = $('#wrap').clientWidth, maxH = window.innerHeight * 0.68;
    L.scale = Math.min(wrapW / el.naturalWidth, maxH / el.naturalHeight);
    cv.width = Math.round(el.naturalWidth * L.scale); cv.height = Math.round(el.naturalHeight * L.scale);
    draw(); paintSide();
    if (helper && L.auto && !L.boxes.length && img.status === 'unlabeled') suggest(true);
  }
  async function suggest(silent) {
    if (!L.img) return;
    const id = L.img.id;
    try {
      const r = await api(`/api/images/${id}/prelabel`, {method: 'POST', json: {model_id: helper?.id ?? null, conf: sugConf}});
      if (!L.img || L.img.id !== id) return;
      const fresh = r.boxes.filter(b => b.cls < classes.length);
      const hadPending = L.boxes.some(b => !b.confirmed);
      if (!fresh.length && !hadPending) { if (!silent) toast('AI ไม่พบตำหนิในภาพนี้'); return; }
      // new suggestions replace old unconfirmed ones; boxes the user confirmed or drew stay
      pushUndo(); L.boxes = L.boxes.filter(b => b.confirmed).concat(fresh); L.sel = -1; L.ok = false; changed();
      if (!fresh.length && !silent) toast('AI ไม่พบตำหนิในภาพนี้');
    } catch (e) { if (!silent) fail(e); }
  }
  function paintSide() {
    const st = $('#imgState');
    const pending = L.boxes.filter(b => !b.confirmed).length;
    st.textContent = L.ok ? 'OK — ไม่มีตำหนิ' : pending ? `รอยืนยัน ${pending} กรอบ` : L.boxes.length ? `label แล้ว · ${L.boxes.length} กรอบ` : 'ยังไม่ label';
    st.className = 'pill ' + (L.ok || (L.boxes.length && !pending) ? 'blue' : pending ? 'ng' : '');
    $('#boxList').innerHTML = L.boxes.length ? L.boxes.map((b, i) => `<div class="boxitem ${i === L.sel ? 'sel' : ''}" data-i="${i}">
      <span class="sw" style="flex:none;background:${b.confirmed ? COLORS[b.cls] : 'transparent'};border:2px ${b.confirmed ? 'solid' : 'dashed'} ${COLORS[b.cls]}"></span>
      <select data-cls-of="${i}" aria-label="class ของกรอบที่ ${i + 1}">${classes.map((c, k) => `<option value="${k}" ${k === b.cls ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      ${b.confirmed ? '<span class="bstate">ยืนยันแล้ว</span>' : `<span class="bstate pend">AI ${b.conf != null ? b.conf.toFixed(2) : ''}</span><button class="ibtn ok" data-acc="${i}" title="ยอมรับกรอบนี้" aria-label="ยอมรับกรอบนี้">✓</button>`}
      <button class="ibtn" data-del="${i}" title="ลบกรอบนี้" aria-label="ลบกรอบนี้">✕</button></div>`).join('')
      : `<p class="muted" style="margin:0;font-size:14px">${L.ok ? 'ภาพนี้ถูกบันทึกเป็นชิ้นงานดี' : 'ยังไม่มีกรอบ — ลากกรอบ หรือกด 0 ถ้าไม่มีตำหนิ'}</p>`;
    $$('.boxitem').forEach(el => el.onclick = e => { if (e.target.closest('select,button')) return; L.sel = Number(el.dataset.i); draw(); paintSide(); });
    $$('[data-cls-of]').forEach(el => el.onchange = e => { const i = Number(el.dataset.clsOf); pushUndo(); Object.assign(L.boxes[i], {cls: Number(e.target.value), confirmed: true, origin: 'human'}); L.sel = i; changed(); });
    $$('[data-acc]').forEach(el => el.onclick = () => { const i = Number(el.dataset.acc); pushUndo(); L.boxes[i].confirmed = true; L.sel = i; changed(); });
    $$('[data-del]').forEach(el => el.onclick = () => { pushUndo(); L.boxes.splice(Number(el.dataset.del), 1); L.sel = -1; changed(); });
  }
  function draw() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (L.el) ctx.drawImage(L.el, 0, 0, cv.width, cv.height);
    const W = cv.width, H = cv.height;
    ctx.font = '600 13px "IBM Plex Sans Thai", Tahoma, sans-serif';
    L.boxes.forEach((b, i) => {
      const x = b.x1 * W, y = b.y1 * H, w = (b.x2 - b.x1) * W, h = (b.y2 - b.y1) * H, c = COLORS[b.cls] || '#fff';
      ctx.lineWidth = i === L.sel ? 3 : 2; ctx.strokeStyle = c; ctx.setLineDash(b.confirmed ? [] : [7, 5]);
      ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
      const t = clsName(b.cls) + (b.confirmed ? '' : ` AI ${b.conf != null ? b.conf.toFixed(2) : ''}`);
      const tw = ctx.measureText(t).width + 10, ty = y > 20 ? y - 20 : y + h;
      ctx.fillStyle = b.confirmed ? c : '#14181F'; ctx.fillRect(x - 1, ty, tw, 20);
      ctx.fillStyle = b.confirmed ? '#14181F' : '#fff'; ctx.fillText(t, x + 4, ty + 15);
      if (i === L.sel) { ctx.fillStyle = '#fff'; corners(b).forEach(([cx, cy]) => { ctx.fillRect(cx * W - 5, cy * H - 5, 10, 10); ctx.strokeRect(cx * W - 5, cy * H - 5, 10, 10); }); }
    });
    if (L.drag && L.drag.mode === 'new') {
      const d = L.drag; ctx.strokeStyle = COLORS[L.cls]; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      ctx.strokeRect(d.x0 * W, d.y0 * H, (d.x - d.x0) * W, (d.y - d.y0) * H); ctx.setLineDash([]);
    }
    if (L.ok) { ctx.fillStyle = 'rgba(31,95,209,.9)'; ctx.fillRect(10, 10, LANG() === 'en' ? 140 : 150, 32); ctx.fillStyle = '#fff'; ctx.font = '700 16px "IBM Plex Sans Thai", Tahoma'; ctx.fillText(tr('OK ไม่มีตำหนิ'), 22, 32); }
  }
  const corners = b => [[b.x1, b.y1], [b.x2, b.y1], [b.x1, b.y2], [b.x2, b.y2]];
  const pt = e => { const r = cv.getBoundingClientRect(); return {x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))}; };
  const hitBox = p => { for (let i = L.boxes.length - 1; i >= 0; i--) { const b = L.boxes[i]; if (p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2) return i; } return -1; };
  const hitCorner = p => { if (L.sel < 0) return -1; const tol = 8 / cv.width; return corners(L.boxes[L.sel]).findIndex(([x, y]) => Math.abs(p.x - x) < tol && Math.abs(p.y - y) < tol * cv.width / cv.height); };
  cv.addEventListener('mousedown', async e => {
    if (!L.img) return;
    const p = pt(e);
    const ci = hitCorner(p);
    if (ci >= 0) { pushUndo(); L.drag = {mode: 'resize', corner: ci}; return; }
    const hi = hitBox(p);
    if (hi >= 0) { L.sel = hi; pushUndo(); const b = L.boxes[hi]; L.drag = {mode: 'move', dx: p.x - b.x1, dy: p.y - b.y1, moved: false}; draw(); paintSide(); return; }
    L.sel = -1;
    if (L.tool === 'sam') {
      try {
        toast('AI กำลังหาขอบเขต…');
        const r = await api(`/api/images/${L.img.id}/sam`, {method: 'POST', json: {x: p.x, y: p.y}});
        if (!r.box) { toast('หาขอบเขตไม่เจอ — ลองคลิกกลางรอย หรือใช้ลากกรอบ', true); return; }
        pushUndo(); L.boxes.push({cls: L.cls, ...r.box, origin: 'human', confirmed: true}); L.sel = L.boxes.length - 1; L.ok = false; changed();
      } catch (er) { fail(er); }
      return;
    }
    L.drag = {mode: 'new', x0: p.x, y0: p.y, x: p.x, y: p.y}; draw(); paintSide();
  });
  cv.addEventListener('mousemove', e => {
    if (L.drag || !L.img) return;
    const p = pt(e), ci = hitCorner(p);
    cv.style.cursor = ci === 0 || ci === 3 ? 'nwse-resize' : ci === 1 || ci === 2 ? 'nesw-resize' : hitBox(p) >= 0 ? 'move' : 'crosshair';
  });
  const onMove = e => {
    if (!L.drag) return;
    const p = pt(e), d = L.drag;
    if (d.mode === 'new') { d.x = p.x; d.y = p.y; }
    else if (d.mode === 'move') {
      const b = L.boxes[L.sel], w = b.x2 - b.x1, h = b.y2 - b.y1;
      const nx = Math.min(1 - w, Math.max(0, p.x - d.dx)), ny = Math.min(1 - h, Math.max(0, p.y - d.dy));
      if (Math.abs(nx - b.x1) + Math.abs(ny - b.y1) > 0.0005) d.moved = true;
      Object.assign(b, {x1: nx, y1: ny, x2: nx + w, y2: ny + h});
    } else if (d.mode === 'resize') {
      const b = L.boxes[L.sel];
      if (d.corner === 0 || d.corner === 2) b.x1 = p.x; else b.x2 = p.x;
      if (d.corner === 0 || d.corner === 1) b.y1 = p.y; else b.y2 = p.y;
    }
    draw();
  };
  const onUp = () => {
    const d = L.drag; if (!d) return; L.drag = null;
    if (d.mode === 'new') {
      const w = Math.abs(d.x - d.x0) * cv.width, h = Math.abs(d.y - d.y0) * cv.height;
      if (w > 4 && h > 4) { pushUndo(); L.boxes.push({cls: L.cls, x1: Math.min(d.x0, d.x), y1: Math.min(d.y0, d.y), x2: Math.max(d.x0, d.x), y2: Math.max(d.y0, d.y), origin: 'human', confirmed: true}); L.sel = L.boxes.length - 1; L.ok = false; changed(); }
      else draw();
    } else if (d.mode === 'resize' || d.moved) {
      const b = L.boxes[L.sel]; [b.x1, b.x2] = [Math.min(b.x1, b.x2), Math.max(b.x1, b.x2)]; [b.y1, b.y2] = [Math.min(b.y1, b.y2), Math.max(b.y1, b.y2)];
      b.confirmed = true; b.origin = 'human'; changed();
    } else { L.undo.pop(); }
  };
  window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);

  const acceptOne = () => { const i = L.sel >= 0 && !L.boxes[L.sel].confirmed ? L.sel : L.boxes.findIndex(b => !b.confirmed); if (i < 0) return false; pushUndo(); L.boxes[i].confirmed = true; L.sel = i; changed(); return true; };
  const acceptAll = () => { if (!L.boxes.some(b => !b.confirmed)) return; pushUndo(); L.boxes.forEach(b => b.confirmed = true); changed(); };
  const rejectOne = () => { const i = L.sel >= 0 && !L.boxes[L.sel].confirmed ? L.sel : L.boxes.findIndex(b => !b.confirmed); if (i < 0) return; pushUndo(); L.boxes.splice(i, 1); L.sel = -1; changed(); };
  const delSel = () => { if (L.sel < 0) return; pushUndo(); L.boxes.splice(L.sel, 1); L.sel = -1; changed(); };
  const markOk = async () => { pushUndo(); L.boxes = []; L.ok = true; L.sel = -1; changed(); setTimeout(() => open(L.idx + 1), 150); };
  const copyPrev = async () => {
    if (L.idx === 0) return toast('ไม่มีภาพก่อนหน้า');
    const prev = await api(`/api/images/${L.ids[L.idx - 1]}`);
    const bx = prev.boxes.filter(b => b.confirmed).map(b => ({cls: b.cls, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, origin: 'human', confirmed: true}));
    if (!bx.length) return toast('ภาพก่อนหน้าไม่มีกรอบ');
    pushUndo(); L.boxes = L.boxes.concat(bx); L.ok = false; changed();
  };
  const undo = () => { const s = L.undo.pop(); if (!s) return; const o = JSON.parse(s); L.boxes = o.b; L.ok = o.ok; L.sel = -1; draw(); paintSide(); save(); };
  $('#prev').onclick = () => open(L.idx - 1);
  $('#next').onclick = () => open(L.idx + 1);
  $('#accAll').onclick = acceptAll;
  $('#suggest').onclick = () => suggest(false);
  $('#markOk').onclick = markOk;
  $('#copyPrev').onclick = copyPrev;
  $('#delImg').onclick = async () => { if (!L.img || !confirm('ลบภาพนี้ออกจากโปรเจกต์?')) return; await api(`/api/images/${L.img.id}`, {method: 'DELETE'}); L.ids.splice(L.idx, 1); open(L.idx); progress(); };
  $('#filter').onchange = async e => { L.filter = e.target.value; await loadList(L.img?.id); open(L.idx); };
  const key = e => {
    if (typing(e)) return;
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[1-9]$/.test(k)) { setCls(Number(k) - 1); return; }
    if (k === '0') { markOk(); return; }
    if (k === 'Enter') { e.preventDefault(); if (e.shiftKey) acceptAll(); else if (!acceptOne()) open(L.idx + 1); return; }
    const m = {a: () => open(L.idx - 1), arrowleft: () => open(L.idx - 1), d: () => open(L.idx + 1), arrowright: () => open(L.idx + 1),
      x: rejectOne, delete: delSel, backspace: delSel, c: copyPrev, s: () => { L.tool = 'sam'; paintTools(); }, b: () => { L.tool = 'box'; paintTools(); },
      escape: () => { L.sel = -1; draw(); paintSide(); }}[k.toLowerCase()];
    if (m) { e.preventDefault(); m(); }
  };
  document.addEventListener('keydown', key);
  const onResize = () => L.img && open(L.idx);
  paintTools();
  await loadList(params.id ? Number(params.id) : null);
  await open(L.idx); progress();
  return () => {
    document.removeEventListener('keydown', key); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
    if (L.saveT && L.img) { clearTimeout(L.saveT); fetch(`/api/images/${L.img.id}/annotation`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({boxes: L.boxes, ok: L.ok}), keepalive: true}); }
  };
}

/* ------------------------------------------------------------------ 4. train */
async function viewTrain(v) {
  const pid = S.pid;
  const presets = S.status?.config?.presets || {fast: {}, accurate: {}};
  let preset = S.project.last_preset in presets ? S.project.last_preset : 'fast';
  v.innerHTML = `
  <div class="head"><div><h1>เทรนโมเดล</h1><p class="muted">เลือกแค่ว่าต้องการเร็วหรือแม่น — ที่เหลือระบบตั้งให้</p></div></div>
  <div class="row">
    <div class="grow" style="display:flex;flex-direction:column;gap:18px">
      <fieldset class="card" style="margin:0"><legend style="font-weight:700;padding:0 6px">โหมดการเทรน</legend>
        <div class="presets">
          <label class="preset" data-p="fast"><input type="radio" name="preset" value="fast"><span><b>เร็ว</b><br><span class="muted" style="font-size:14px">${esc(presets.fast?.model)} · ${presets.fast?.imgsz}px · เหมาะลองดูว่าภาพพอไหม / ใช้เป็นโมเดลช่วย label</span></span></label>
          <label class="preset" data-p="accurate"><input type="radio" name="preset" value="accurate"><span><b>แม่นยำ</b><br><span class="muted" style="font-size:14px">${esc(presets.accurate?.model)} · ${presets.accurate?.imgsz}px · ใช้จริงหน้าไลน์</span></span></label>
        </div>
        <details><summary>ตั้งค่าขั้นสูง (สำหรับวิศวกร)</summary>
          <div class="row" style="gap:10px">
            <label class="field"><span>base model</span><input type="text" id="o_model" list="baseModels"><datalist id="baseModels">${['n', 's', 'm', 'l', 'x'].map(k => `<option value="yolo26${k}.pt"></option>`).join('')}${['n', 's', 'm', 'l', 'x'].map(k => `<option value="yolo11${k}.pt"></option>`).join('')}</datalist></label>
            <label class="field"><span>epochs</span><input type="number" id="o_epochs" min="1"></label>
            <label class="field"><span>imgsz</span><input type="number" id="o_imgsz" min="64" step="32"></label>
            <label class="field"><span>batch</span><input type="number" id="o_batch" min="1"></label>
            <label class="field"><span>patience (early stop)</span><input type="number" id="o_patience" min="1"></label>
          </div>
          <h3 style="margin:10px 0 0;font-size:15px">Augmentation <span class="muted" style="font-weight:400;font-size:13px">— สุ่มดัดแปลงภาพตอนเทรน ให้โมเดลทนแสง/ตำแหน่งที่เปลี่ยน (ไม่ได้สร้างตำหนิแบบใหม่)</span></h3>
          <div class="row" style="gap:10px">
            <label class="field"><span>ย่อ/ขยาย ± (scale)</span><input type="number" data-aug="scale" min="0" step="0.05"></label>
            <label class="field"><span>เลื่อนภาพ ± (translate)</span><input type="number" data-aug="translate" min="0" step="0.05"></label>
            <label class="field"><span>หมุน ± องศา (degrees)</span><input type="number" data-aug="degrees" min="0" step="1"></label>
            <label class="field"><span>พลิกซ้าย-ขวา (fliplr)</span><input type="number" data-aug="fliplr" min="0" step="0.1"></label>
            <label class="field"><span>พลิกบน-ล่าง (flipud)</span><input type="number" data-aug="flipud" min="0" step="0.1"></label>
            <label class="field"><span>ความสว่าง ± (hsv_v)</span><input type="number" data-aug="hsv_v" min="0" step="0.05"></label>
            <label class="field"><span>mosaic (mosaic)</span><input type="number" data-aug="mosaic" min="0" step="0.1"></label>
            <label class="field"><span>mixup (mixup)</span><input type="number" data-aug="mixup" min="0" step="0.1"></label>
            <label class="field"><span>ความอิ่มสี ± (hsv_s)</span><input type="number" data-aug="hsv_s" min="0" step="0.1"></label>
            <label class="field"><span>โทนสี ± (hsv_h)</span><input type="number" data-aug="hsv_h" min="0" step="0.005"></label>
          </div><p class="muted" style="font-size:13px;margin:0">เว้นว่าง = ใช้ค่าของ preset · base model ที่วางไว้ในโฟลเดอร์ models/ จะใช้แทนการดาวน์โหลด · ค่าเริ่มต้น augmentation อยู่ใน settings.json → training.augment</p>
        </details>
      </fieldset>
      <section class="card"><h2>ตรวจก่อนเทรน</h2><div id="checks"></div>
        <button class="btn primary" id="start" style="align-self:flex-start">เริ่มเทรน</button></section>
    </div>
    <section class="card side" id="job"></section>
  </div>
  <section class="card"><h2>ประวัติการเทรน</h2><div class="scroll" id="hist"></div></section>`;
  const paintPreset = () => { $$('.preset').forEach(l => { l.classList.toggle('on', l.dataset.p === preset); $('input', l).checked = l.dataset.p === preset; }); };
  $$('input[name=preset]').forEach(r => r.onchange = () => { preset = r.value; paintPreset(); checks(); });
  paintPreset();
  let canTrain = false;
  async function checks() {
    try {
      const pf = await api(`/api/projects/${pid}/preflight?preset=${preset}`);
      $('#checks').innerHTML = pf.checks.map(c => `<div class="chkrow"><span class="ic ${c.level}">${c.level === 'ok' ? '✓' : '!'}</span><span>${esc(c.text)}</span></div>`).join('');
      ['model', 'epochs', 'imgsz', 'batch', 'patience'].forEach(k => $('#o_' + k).placeholder = pf.params[k]);
      $$('[data-aug]').forEach(el => el.placeholder = pf.params.augment?.[el.dataset.aug] ?? '');
      canTrain = pf.can_train;
      $('#start').disabled = !canTrain || !!S.status?.train?.running;
    } catch (e) { fail(e); }
  }
  $('#start').onclick = async () => {
    const ov = {}; ['model', 'epochs', 'imgsz', 'batch', 'patience'].forEach(k => { const x = $('#o_' + k).value.trim(); if (x) ov[k] = x; });
    const aug = {}; $$('[data-aug]').forEach(el => { const x = el.value.trim(); if (x !== '') aug[el.dataset.aug] = Number(x); });
    if (Object.keys(aug).length) ov.augment = aug;
    try { $('#start').disabled = true; await api(`/api/projects/${pid}/train`, {method: 'POST', json: {preset, overrides: ov}}); toast('เริ่มเทรนแล้ว'); poll(); } catch (e) { fail(e); $('#start').disabled = false; }
  };
  let lastRunning = false;
  async function poll() {
    let st;
    try { st = await api('/api/train/status'); } catch (e) { return; }
    const job = $('#job');
    if (st.running && st.project_id === pid) {
      lastRunning = true;
      job.innerHTML = `<div class="head" style="align-items:center"><h2>กำลังเทรน v${st.version}</h2><span class="pill blue">${st.preset === 'fast' ? 'โหมดเร็ว' : 'โหมดแม่นยำ'}</span></div>
        <div class="bar" style="height:14px"><div style="width:${st.pct}%"></div></div>
        <div style="display:flex;justify-content:space-between"><span>${STAGE_TH[st.stage] || st.stage} · รอบ ${st.epoch}/${st.epochs}${st.attempt > 1 ? ` · <b style="color:var(--ng)">ลองใหม่ครั้งที่ ${st.attempt}</b> (${st.cudnn === false ? 'ปิด cuDNN' : 'fp32'})` : ''}</span><span>เหลือประมาณ <b>${fmtDur(st.eta_s)}</b></span></div>
        <span class="muted" style="font-size:14px">ความแม่น (mAP50) บนชุดทดสอบ — ยิ่งสูงยิ่งดี</span><canvas id="chart" width="560" height="200" style="width:100%;background:#F8F9FB;border-radius:8px" role="img" aria-label="กราฟความแม่นต่อรอบ"></canvas>
        <p style="margin:0;font-size:14px;background:var(--bg);padding:10px;border-radius:8px">ระบบจะ<b>หยุดเอง</b>เมื่อความแม่นไม่ดีขึ้นแล้ว — ปิดหน้านี้ได้ งานยังเดินต่อ</p>
        <details><summary>log</summary><pre class="log">${esc(st.log_tail)}</pre></details>
        <button class="btn" id="cancel">ยกเลิก</button>`;
      chart($('#chart'), st.history);
      $('#cancel').onclick = async () => { if (confirm('ยกเลิกการเทรนนี้?')) { await api('/api/train/cancel', {method: 'POST'}); toast('ยกเลิกแล้ว'); } };
    } else if (st.running) {
      job.innerHTML = `<h2>เครื่องกำลังเทรนโปรเจกต์อื่น</h2><p class="muted">v${st.version} · ${st.pct}% — รอให้เสร็จก่อน</p>`;
    } else {
      if (lastRunning) { lastRunning = false; toast('เทรนเสร็จแล้ว'); }
      const ms = await api(`/api/projects/${pid}/models`);
      const m = ms[0];
      job.innerHTML = !m ? '<h2>ยังไม่เคยเทรน</h2><p class="muted">กดเริ่มเทรนเมื่อพร้อม</p>'
        : m.status === 'done' ? `<h2>ล่าสุด: v${m.version} เสร็จแล้ว</h2>${evalLine(m)}<canvas id="chart" width="560" height="200" style="width:100%;background:#F8F9FB;border-radius:8px" role="img" aria-label="กราฟความแม่นต่อรอบ"></canvas><a class="btn primary" href="#/results?m=${m.id}">ดูผลลัพธ์ →</a>`
        : `<h2>ล่าสุด: v${m.version} ${m.status === 'cancelled' ? 'ถูกยกเลิก' : 'ไม่สำเร็จ'}</h2>${m.error ? `<pre class="log">${esc(m.error)}</pre>` : ''}`;
      if (m && m.status === 'done' && $('#chart')) chart($('#chart'), m.metrics?.history || []);
      $('#hist').innerHTML = ms.length ? `<table><thead><tr><th>เวอร์ชัน</th><th>เมื่อ</th><th>โหมด</th><th>ภาพ</th><th>สถานะ</th><th>หลุด / แจ้งผิด</th><th>mAP50</th><th></th></tr></thead><tbody>${ms.map(x => `<tr>
        <td><b>v${x.version}</b></td><td>${fmtDate(x.created)}</td><td>${x.preset === 'fast' ? 'เร็ว' : x.preset === 'accurate' ? 'แม่นยำ' : esc(x.preset)}</td><td class="mono">${x.n_images ?? ''}</td>
        <td>${{done: 'เสร็จ', failed: 'ไม่สำเร็จ', cancelled: 'ยกเลิก', training: 'กำลังเทรน'}[x.status] || x.status}</td>
        <td class="mono">${x.eval_summary ? `${x.eval_summary.missed} / ${x.eval_summary.false_alarm} จาก ${x.eval_summary.n}` : '—'}</td><td class="mono">${x.metrics?.map50 ?? '—'}</td>
        <td>${x.status === 'done' ? `<a href="#/results?m=${x.id}">ดูผล</a>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">—</p>';
    }
    $('#start').disabled = !!st.running || !canTrain;
  }
  await checks(); await poll();
  const t = setInterval(poll, 2000);
  return () => clearInterval(t);
}
function evalLine(m) {
  const e = m.eval_summary; if (!e) return '';
  return `<p style="margin:0">ทดสอบ ${e.n} ชิ้น ที่ threshold ${thrText(m)}: <b style="color:var(--ng)">หลุด ${e.missed}</b> · แจ้งผิด ${e.false_alarm}</p>`;
}
function chart(cv, hist) {
  const c = cv.getContext('2d'), W = cv.width, H = cv.height, P = 28;
  c.clearRect(0, 0, W, H);
  c.strokeStyle = '#C5CBD3'; c.lineWidth = 1; c.beginPath(); c.moveTo(P, 8); c.lineTo(P, H - P); c.lineTo(W - 8, H - P); c.stroke();
  c.fillStyle = '#5A6372'; c.font = '18px Tahoma'; c.fillText('1.0', 2, 14); c.fillText('0', 14, H - P); c.fillText(tr('รอบ'), W - (LANG() === 'en' ? 60 : 34), H - 8);
  if (!hist.length) return;
  const n = Math.max(hist.length, 2), x = i => P + (W - P - 12) * i / (n - 1), y = vv => (H - P) - (H - P - 10) * vv;
  c.strokeStyle = '#1F5FD1'; c.lineWidth = 3; c.lineJoin = 'round'; c.beginPath();
  hist.forEach((h, i) => i ? c.lineTo(x(i), y(h.map50)) : c.moveTo(x(i), y(h.map50))); c.stroke();
  const last = hist[hist.length - 1]; c.fillStyle = '#1F5FD1'; c.beginPath(); c.arc(x(hist.length - 1), y(last.map50), 5, 0, 7); c.fill();
  c.fillText(last.map50.toFixed(2), Math.min(W - 40, x(hist.length - 1) + 8), y(last.map50) - 8);
}

/* ------------------------------------------------------------------ 5. results */
async function viewResults(v, params) {
  const pid = S.pid, classes = S.project.classes;
  const ms = (await api(`/api/projects/${pid}/models`)).filter(m => m.status === 'done');
  if (!ms.length) { v.innerHTML = '<div class="card empty">ยังไม่มีโมเดลที่เทรนเสร็จ — <a href="#/train">ไปเทรน</a></div>'; return; }
  const mid = Number(params.m) || ms[0].id;
  const m = await api(`/api/models/${mid}`);
  const ev = m.eval?.images || [];
  const sc = (i, k) => Number(i.scores[k] ?? i.scores[String(k)] ?? 0);
  const items = ev.map(im => ({...im, score: Math.max(0, ...Object.values(im.scores).map(Number)), ng: im.gt.length > 0}));
  const nNg = items.filter(i => i.ng).length, nOk = items.length - nNg;
  // thresholds: one global value + optional per-class overrides
  let t = m.threshold ?? 0.5;
  let per = Object.fromEntries(Object.entries(m.class_thresholds || {}).map(([k, x]) => [Number(k), Number(x)]));
  let perMode = Object.keys(per).length > 0;
  const thr = k => perMode && per[k] != null ? per[k] : t;
  const stateKey = () => JSON.stringify([t, perMode ? classes.map((_, k) => thr(k)) : null]);
  let saved = stateKey();
  v.innerHTML = `
  <div class="head"><div><h1>ผลลัพธ์ <select id="msel" aria-label="เลือกเวอร์ชัน">${ms.map(x => `<option value="${x.id}" ${x.id === mid ? 'selected' : ''}>v${x.version}</option>`).join('')}</select></h1>
    <p class="muted">ทดสอบกับภาพที่โมเดลไม่เคยเห็น ${items.length} ภาพ (มีตำหนิ ${nNg} · ชิ้นดี ${nOk})${items.length < 30 ? ' — ภาพทดสอบน้อย ตัวเลขยังแกว่งได้มาก' : ''}</p></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn" href="#/train">เทรนใหม่ด้วยภาพที่แก้</a><a class="btn primary" href="#/deploy">ไป Deploy →</a></div></div>
  <div class="kpis">
    <div class="card kpi missed"><span class="muted">หลุด (มีตำหนิแต่ปล่อยผ่าน)</span><div class="n" id="kMiss"></div></div>
    <div class="card kpi"><span class="muted">แจ้งผิด (ชิ้นดีแต่ถูก reject)</span><div class="n" id="kFa"></div></div>
    <div class="card kpi good"><span class="muted">ตัดสินถูก</span><div class="n" id="kOk"></div></div>
  </div>
  <div class="row">
    <section class="card grow"><div class="head" style="align-items:center"><h2>ปรับความเข้มงวด</h2>
        <label class="muted" style="font-size:14px">histogram ของ <select id="histCls"><option value="-1">ทุก class (คะแนนสูงสุด)</option>${classes.map((c, k) => `<option value="${k}">${esc(c)}</option>`).join('')}</select></label></div>
      <canvas id="hist" width="900" height="200" style="width:100%" role="img" aria-label="histogram คะแนนตำหนิของชิ้นดีและชิ้นมีตำหนิ"></canvas>
      <div style="display:flex;justify-content:space-between;font-size:13px" class="muted"><span>คะแนนตำหนิต่ำ</span><span>คะแนนตำหนิสูง</span></div>
      <div style="display:flex;gap:16px;font-size:14px" id="legend"></div>
      <label for="th" style="font-weight:600"><span id="thLbl"></span> · เลื่อนซ้าย = เข้มงวด (หลุดน้อย แจ้งผิดมาก) · เลื่อนขวา = ผ่อน</label>
      <div style="display:flex;gap:12px;align-items:center"><input id="th" type="range" min="0.05" max="0.95" step="0.01" style="flex:1"><b class="mono" id="thVal" style="min-width:44px"></b></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between">
        <span class="mono muted" id="tLbl"></span>
        <button class="btn primary" id="saveT">ใช้ threshold นี้กับ v${m.version}</button></div>
    </section>
    <section class="card side"><div class="head" style="align-items:center"><h2>แยกตามประเภทตำหนิ</h2>
        <label class="chk" style="font-size:14px"><input type="checkbox" id="perMode"> ปรับ threshold แยกตาม class</label></div>
      <div id="perCls"></div>
      <details><summary>ตัวเลขสำหรับวิศวกร</summary><div class="mono" style="font-size:13px;display:grid;gap:4px">
        <span>mAP50 ${m.metrics?.map50} · mAP50-95 ${m.metrics?.map}</span><span>precision ${m.metrics?.precision} · recall ${m.metrics?.recall}</span>
        <span>inference ${m.metrics?.inference_ms} ms/ภาพ · train ${m.metrics?.n_train} / val ${m.metrics?.n_val}</span>
        <span>${esc(m.params.model)} · imgsz ${m.params.imgsz} · epochs ${m.params.epochs}</span>
        <span>augment: ${m.params.augment ? Object.entries(m.params.augment).map(([k, x]) => `${k} ${x}`).join(' · ') : 'ค่า default ของ Ultralytics'}</span>
        <span><a href="/api/models/${m.id}/download?fmt=pt">ดาวน์โหลด .pt</a>${m.onnx ? ` · <a href="/api/models/${m.id}/download?fmt=onnx">.onnx</a>` : ''}</span></div></details>
    </section>
  </div>
  <section class="card"><div class="head"><h2>ภาพที่โมเดลตัดสินผิด — กดเพื่อแก้ label</h2><span class="muted" style="font-size:14px">label ผิดก็แก้ได้ แล้วกด "เทรนใหม่"</span></div><div class="thumbs" id="errs"></div></section>`;
  $('#msel').onchange = e => location.hash = `#/results?m=${e.target.value}`;
  const th = $('#th'), hc = $('#histCls'), pm = $('#perMode');
  pm.checked = perMode;
  const predNg = i => classes.some((_, k) => sc(i, k) >= thr(k));
  // the main slider edits the class picked for the histogram (per-class mode) or the global value
  const editing = () => perMode && Number(hc.value) >= 0 ? Number(hc.value) : -1;
  function syncSlider() {
    const k = editing(), val = k >= 0 ? thr(k) : t;
    th.value = val; $('#thVal').textContent = val.toFixed(2);
    $('#thLbl').textContent = k >= 0 ? `threshold ของ ${classes[k]}` : (perMode ? 'threshold ทุก class (ปรับพร้อมกัน)' : 'threshold ทุก class');
  }
  function paint() {
    let miss = 0, fa = 0; const errs = [];
    items.forEach(i => { const p = predNg(i); if (i.ng && !p) { miss++; errs.push([i, 'หลุด']); } else if (!i.ng && p) { fa++; errs.push([i, 'แจ้งผิด']); } });
    $('#kMiss').innerHTML = `${miss} <small>/ ${nNg} ชิ้น</small>`; $('#kFa').innerHTML = `${fa} <small>/ ${nOk} ชิ้น</small>`;
    $('#kOk').innerHTML = `${items.length - miss - fa} <small>/ ${items.length}</small>`;
    const same = stateKey() === saved;
    $('#tLbl').textContent = (perMode ? classes.map((c, k) => `${c} ${thr(k).toFixed(2)}`).join(' · ') : `threshold ${t.toFixed(2)}`) + (same ? ' (ใช้อยู่)' : '');
    $('#saveT').disabled = same;
    $('#perCls').innerHTML = classes.map((c, k) => {
      const gt = items.filter(i => i.gt.includes(k)), hit = gt.filter(i => sc(i, k) >= thr(k)).length;
      const faK = items.filter(i => !i.ng && sc(i, k) >= thr(k)).length;
      return `<div class="pcls"><div class="kv" style="border:0;padding:0"><span><span class="sw" style="background:${COLORS[k]}"></span><b>${esc(c)}</b>${gt.length && gt.length < 5 ? ' <span class="pill ng">ภาพทดสอบน้อย</span>' : ''}</span>
          <span class="mono" style="font-size:13px">${gt.length ? `จับได้ ${hit} / ${gt.length}` : 'ไม่มีภาพทดสอบ'} · แจ้งผิด ${faK}</span></div>
        ${perMode ? `<div style="display:flex;gap:10px;align-items:center"><input type="range" min="0.05" max="0.95" step="0.01" value="${thr(k)}" data-pk="${k}" aria-label="threshold ของ ${esc(c)}" style="flex:1"><b class="mono" style="min-width:40px">${thr(k).toFixed(2)}</b></div>` : ''}</div>`;
    }).join('');
    $$('[data-pk]').forEach(r => r.oninput = () => { const k = Number(r.dataset.pk); per[k] = Number(r.value); r.nextElementSibling.textContent = per[k].toFixed(2); if (editing() === k) syncSlider(); paintNoSide(); });
    paintErrs(errs); hist();
  }
  function paintNoSide() {   // while dragging a per-class slider: don't rebuild the slider itself
    let miss = 0, fa = 0; const errs = [];
    items.forEach(i => { const p = predNg(i); if (i.ng && !p) { miss++; errs.push([i, 'หลุด']); } else if (!i.ng && p) { fa++; errs.push([i, 'แจ้งผิด']); } });
    $('#kMiss').innerHTML = `${miss} <small>/ ${nNg} ชิ้น</small>`; $('#kFa').innerHTML = `${fa} <small>/ ${nOk} ชิ้น</small>`;
    $('#kOk').innerHTML = `${items.length - miss - fa} <small>/ ${items.length}</small>`;
    const same = stateKey() === saved;
    $('#tLbl').textContent = classes.map((c, k) => `${c} ${thr(k).toFixed(2)}`).join(' · ') + (same ? ' (ใช้อยู่)' : '');
    $('#saveT').disabled = same;
    $$('.pcls').forEach((el, k) => {
      const gt = items.filter(i => i.gt.includes(k)), hit = gt.filter(i => sc(i, k) >= thr(k)).length, faK = items.filter(i => !i.ng && sc(i, k) >= thr(k)).length;
      el.querySelector('.mono').textContent = `${gt.length ? `จับได้ ${hit} / ${gt.length}` : 'ไม่มีภาพทดสอบ'} · แจ้งผิด ${faK}`;
    });
    paintErrs(errs); hist();
  }
  function paintErrs(errs) {
    $('#errs').innerHTML = errs.length ? errs.slice(0, 48).map(([i, k]) => `<a class="thumb" href="#/label?id=${i.id}"><div class="im"><img loading="lazy" src="/api/images/${i.id}/thumb" alt=""><span class="tag pill ${k === 'หลุด' ? 'ng' : 'dark'}">${k}</span></div>
      <span>คะแนน ${i.score.toFixed(2)}${i.gt.length ? ' · ' + i.gt.map(clsName).map(esc).join(', ') : ''}</span></a>`).join('') : '<p class="empty">ไม่มีภาพที่ตัดสินผิดที่ threshold นี้</p>';
  }
  function hist() {
    const k = Number(hc.value);
    // all classes: image max score, good vs defective images; one class: that class's score, images with vs without it
    const val = i => k >= 0 ? sc(i, k) : i.score, pos = i => k >= 0 ? i.gt.includes(k) : i.ng, line = k >= 0 ? thr(k) : (perMode ? null : t);
    $('#legend').innerHTML = k >= 0
      ? `<span><span class="sw" style="background:#1F5FD1"></span>ภาพที่ไม่มี ${esc(classes[k])}</span><span><span class="sw" style="background:#F97316"></span>ภาพที่มี ${esc(classes[k])}</span>`
      : '<span><span class="sw" style="background:#1F5FD1"></span>ชิ้นดี</span><span><span class="sw" style="background:#F97316"></span>มีตำหนิ</span>';
    const cv = $('#hist'), c = cv.getContext('2d'), W = cv.width, H = cv.height, B = 20;
    const okb = Array(B).fill(0), ngb = Array(B).fill(0);
    items.forEach(i => { const b = Math.min(B - 1, Math.floor(val(i) * B)); (pos(i) ? ngb : okb)[b]++; });
    const mx = Math.max(1, ...okb, ...ngb), bw = W / B;
    c.clearRect(0, 0, W, H);
    for (let b = 0; b < B; b++) {
      const h1 = (H - 20) * okb[b] / mx, h2 = (H - 20) * ngb[b] / mx;
      c.fillStyle = '#1F5FD1'; c.fillRect(b * bw + 3, H - h1, bw / 2 - 4, h1);
      c.fillStyle = '#F97316'; c.fillRect(b * bw + bw / 2 + 1, H - h2, bw / 2 - 4, h2);
    }
    if (line != null) { c.strokeStyle = '#14181F'; c.lineWidth = 3; c.setLineDash([6, 5]); c.beginPath(); c.moveTo(line * W, 0); c.lineTo(line * W, H); c.stroke(); c.setLineDash([]); }
  }
  th.oninput = () => {
    const k = editing(), x = Number(th.value);
    $('#thVal').textContent = x.toFixed(2);
    if (!perMode) { t = x; paint(); return; }
    if (k >= 0) {          // one class
      per[k] = x; paintNoSide();
      const r = $(`[data-pk="${k}"]`); if (r) { r.value = x; r.nextElementSibling.textContent = x.toFixed(2); }
    } else {               // "all classes" picked while in per-class mode: move every class together
      t = x; classes.forEach((_, j) => per[j] = x); paint();
    }
  };
  hc.onchange = () => { syncSlider(); hist(); };
  pm.onchange = () => {
    perMode = pm.checked;
    if (perMode) classes.forEach((_, k) => { if (per[k] == null) per[k] = t; });
    if (perMode && Number(hc.value) < 0) hc.value = '0';
    syncSlider(); paint();
  };
  $('#saveT').onclick = async () => {
    const body = {threshold: t, class_thresholds: perMode ? Object.fromEntries(classes.map((_, k) => [k, thr(k)])) : {}};
    try {
      await api(`/api/models/${m.id}/threshold`, {method: 'PUT', json: body}); saved = stateKey(); paint();
      toast((perMode ? `v${m.version} ใช้ threshold แยกตาม class แล้ว` : `v${m.version} ใช้ threshold ${t.toFixed(2)} แล้ว`) + (m.stage === 'live' ? ' (มีผลกับไลน์ทันที)' : ''));
    } catch (e) { fail(e); }
  };
  syncSlider(); paint();
}

/* ------------------------------------------------------------------ 6. deploy */
async function viewDeploy(v) {
  const pid = S.pid;
  v.innerHTML = `<div class="head"><div><h1>Deploy และดูแลต่อเนื่อง</h1><p class="muted">ทดลองคู่ของเดิมก่อน (shadow) อนุมัติเมื่อมั่นใจ ย้อนกลับได้ในคลิกเดียว</p></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><label class="chk card" style="padding:8px 14px;flex-direction:row"><input type="checkbox" id="rtOn"> ให้ไลน์ใช้โปรเจกต์นี้ (รับ trigger จาก PLC)</label>
    <a class="btn primary" href="#/monitor?kiosk=1">เปิดหน้าจอไลน์ →</a></div></div>
    <div class="row"><section class="card grow" id="shadow"></section><section class="card side" id="conn"></section></div>
    <section class="card" id="diffs" hidden></section>
    <section class="card"><h2>เวอร์ชันโมเดล</h2><div class="scroll" id="vers"></div></section>
    <section class="card" id="queue"></section>`;
  let showDiff = false;
  const refresh = async () => {
    let rt, ms, st, rv;
    try { [rt, ms, st, rv] = await Promise.all([api(`/api/projects/${pid}/runtime`), api(`/api/projects/${pid}/models`), api('/api/status'), api(`/api/projects/${pid}/images?status=review&order=desc&limit=20`)]); S.status = st; }
    catch (e) { return fail(e); }
    const p = await api(`/api/projects/${pid}`); S.project = p;
    $('#rtOn').checked = st.runtime_project === pid;
    const sh = ms.find(m => m.id === rt.shadow?.id), lv = ms.find(m => m.id === rt.live?.id);
    $('#shadow').className = 'card grow' + (sh ? ' accent' : '');
    if (sh) {
      const s = rt.shadow_stats;
      $('#shadow').innerHTML = `<div class="head" style="align-items:center"><h2>Shadow: v${sh.version} รันคู่ ${lv ? 'v' + lv.version : '(ยังไม่มีตัวใช้งานจริง)'}</h2><span class="pill blue">ยังไม่สั่ง reject จริง</span></div>
        <div class="stats"><div class="stat"><span class="muted">ระยะเวลา</span><div class="n">${fmtDur(s.hours * 3600)}</div></div><div class="stat"><span class="muted">ชิ้นที่ผ่าน</span><div class="n mono">${s.n.toLocaleString()}</div></div>
          <div class="stat ng"><span>ผลไม่ตรงกัน</span><div class="n mono">${s.diff}</div></div></div>
        <p style="margin:0">${lv ? `v${sh.version} จับ NG มากกว่า v${lv.version} <b>${s.more_ng}</b> ชิ้น · ปล่อยผ่านมากกว่า <b>${s.less_ng}</b> ชิ้น${s.diff ? ` — ควรดู ${s.diff} ชิ้นนี้ก่อนอนุมัติ` : ''}` : 'ยังไม่มีตัวใช้งานจริงให้เทียบ — ผลของ shadow ถูกบันทึกอย่างเดียว PLC จะไม่ได้รับผล'}</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" id="seeDiff" ${s.diff ? '' : 'disabled'}>ดู ${s.diff} ชิ้นที่ผลต่างกัน</button>
          <button class="btn primary" id="promote">อนุมัติให้ v${sh.version} สั่ง reject ผ่าน PLC</button><button class="btn" id="stopShadow">หยุด shadow</button></div>`;
      $('#seeDiff').onclick = () => { showDiff = !showDiff; diffs(); };
      $('#promote').onclick = () => stage(sh, 'live');
      $('#stopShadow').onclick = () => stage(sh, 'archived');
    } else {
      $('#shadow').innerHTML = `<h2>${lv ? `ใช้งานจริง: v${lv.version}` : 'ยังไม่ได้ deploy'}</h2>
        <p class="muted" style="margin:0">${lv ? `threshold ${thrText(lv)} · deploy เมื่อ ${fmtDate(lv.deployed)}` : 'เลือกเวอร์ชันด้านล่าง'} — เวอร์ชันใหม่ให้กด <b>ทดสอบคู่ (shadow)</b> ก่อน เพื่อรันคู่โดยยังไม่สั่ง reject</p>
        ${rt.today.n ? `<div class="stats"><div class="stat"><span class="muted">ตรวจ 24 ชม.</span><div class="n mono">${rt.today.n}</div></div><div class="stat ng"><span>NG</span><div class="n mono">${rt.today.ng}</div></div><div class="stat"><span class="muted">เวลาเฉลี่ย</span><div class="n mono">${rt.today.ms} ms</div></div></div>` : ''}`;
    }
    const pl = st.plc, cam = st.camera;
    $('#conn').innerHTML = `<h2>เชื่อมต่อไลน์</h2>
      <div class="kv"><span>กล้อง</span><span style="text-align:right">${cam.running ? esc(cam.info) : `<span style="color:var(--ng)">${esc(cam.error || 'ไม่ทำงาน')}</span>`}</span></div>
      <div class="kv"><span>รับ trigger</span><span class="mono">${esc(pl.trigger_command)} @ ${esc(pl.listen)}</span></div>
      <div class="kv"><span>ส่งผลไป PLC</span><span class="mono">${esc(pl.plc)}</span></div>
      <div class="kv"><span>รหัส NG</span><span class="mono" style="white-space:normal;text-align:right">${Object.entries(pl.defect_codes).map(([k, c]) => `${esc(k)}=${esc(c)}`).join(' ') || '—'} +AL01</span></div>
      <div class="kv"><span>trigger ที่ได้รับ</span><span class="mono">${pl.triggers}</span></div>
      <div class="kv"><span>ส่งล่าสุด</span><span class="mono">${pl.last_codes.join(',') || '—'}${rt.last ? ` · ${rt.last.ms} ms` : ''}</span></div>
      ${pl.error ? `<p style="margin:0;color:var(--ng);font-size:14px">${esc(pl.error)}</p>` : ''}
      <button class="btn" id="testTrig" title="ทำงานเหมือน PLC ส่ง ${esc(pl.trigger_command)}">ทดสอบ trigger</button>`;
    $('#testTrig').onclick = async () => { try { const r = await api('/api/plc/test-trigger', {method: 'POST'}); const x = r.result; toast(!x ? 'ไม่มีโมเดล deploy หรือไลน์ไม่ได้ใช้โปรเจกต์นี้' : x.error ? 'กล้องไม่ส่งภาพ — ส่ง ER01' : `ผล: ${x.live_verdict || '-'}${x.shadow_verdict ? ' · shadow ' + x.shadow_verdict : ''} · ${JSON.parse(x.codes || '[]').join(',') || 'ไม่ส่ง PLC'}`); refresh(); } catch (e) { fail(e); } };
    $('#vers').innerHTML = ms.length ? `<table><thead><tr><th>เวอร์ชัน</th><th>เทรนเมื่อ</th><th>หลุด / แจ้งผิด (ทดสอบ)</th><th>threshold</th><th>สถานะ</th><th>การทำงาน</th></tr></thead><tbody>${ms.map(m => {
      const e = m.eval_summary, stg = {live: '<span class="pill dark">ใช้งานจริง</span>', shadow: '<span class="pill blue">Shadow</span>', archived: '<span class="pill">เก็บไว้</span>', none: '<span class="pill">ยังไม่ใช้</span>'}[m.stage];
      const acts = m.status !== 'done' ? `<span class="muted">${{failed: 'ไม่สำเร็จ', cancelled: 'ยกเลิก', training: 'กำลังเทรน'}[m.status] || m.status}</span>` : [
        m.stage !== 'shadow' && m.stage !== 'live' ? `<button class="btn sm" data-stage="shadow" data-id="${m.id}">ทดสอบคู่ (shadow)</button>` : '',
        m.stage !== 'live' ? `<button class="btn sm" data-stage="live" data-id="${m.id}">${m.stage === 'archived' && lv && lv.version > m.version ? 'Rollback ไปเวอร์ชันนี้' : 'ใช้งานจริงทันที'}</button>` : '',
        `<a href="#/results?m=${m.id}">ดูผล</a>`, `<a href="/api/models/${m.id}/download?fmt=pt">.pt</a>`, m.onnx ? `<a href="/api/models/${m.id}/download?fmt=onnx">.onnx</a>` : ''].filter(Boolean).join(' ');
      return `<tr><td><b>v${m.version}</b></td><td>${fmtDate(m.created)}</td><td class="mono">${e ? `${e.missed} / ${e.false_alarm} จาก ${e.n}` : '—'}</td><td class="mono" style="white-space:normal">${thrText(m)}</td><td>${stg || ''}</td><td style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${acts}</td></tr>`;
    }).join('')}</tbody></table>` : '<p class="muted">ยังไม่มีโมเดล — <a href="#/train">ไปเทรน</a></p>';
    $$('[data-stage]').forEach(b => b.onclick = () => stage(ms.find(m => m.id === Number(b.dataset.id)), b.dataset.stage));
    const every = st.config.runtime.auto_retrain_every, rr = st.config.runtime;
    $('#queue').innerHTML = `<div class="head" style="align-items:center"><div><h2>คิวรอตรวจจากไลน์จริง · ${rv.total} ภาพ</h2>
      <p class="muted" style="margin:2px 0 0;font-size:14px">ภาพที่โมเดลไม่แน่ใจ (คะแนน ${rr.review_low}–${rr.review_high}) · กด OK = ชิ้นดี, NG = ส่งไป label · ตรวจแล้ว ${p.reviewed_since_train} ภาพตั้งแต่เทรนครั้งล่าสุด</p></div>
      <label class="chk"><input type="checkbox" id="autoRt" ${p.auto_retrain ? 'checked' : ''}> ตรวจครบ ${every} ภาพ เทรนรอบใหม่อัตโนมัติ (ใช้เฉพาะภาพที่ label แล้ว)</label></div>
      <div class="thumbs">${rv.items.map(it => `<div class="card" style="padding:10px;gap:8px"><div class="thumb"><div class="im"><img loading="lazy" src="/api/images/${it.id}/thumb" alt=""><span class="tag pill dark mono">${(it.score ?? 0).toFixed(2)}</span></div></div>
        <span class="muted" style="font-size:12px">${fmtDate(it.created)}</span><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn sm" data-rv="ok" data-id="${it.id}">OK</button><button class="btn sm ng" data-rv="ng" data-id="${it.id}">NG</button></div></div>`).join('') || '<p class="empty" style="grid-column:1/-1">ไม่มีภาพรอตรวจ</p>'}</div>`;
    $('#autoRt').onchange = e => api(`/api/projects/${pid}/auto-retrain`, {method: 'PUT', json: {enabled: e.target.checked}}).catch(fail);
    $$('[data-rv]').forEach(b => b.onclick = async () => {
      try { const r = await api(`/api/images/${b.dataset.id}/review`, {method: 'POST', json: {verdict: b.dataset.rv}}); toast(b.dataset.rv === 'ng' ? 'ส่งไปหน้า Label แล้ว' : 'บันทึกเป็นชิ้นดี'); if (r.auto_retrain_started) toast('ครบตามกำหนด — เริ่มเทรนรอบใหม่อัตโนมัติ'); refresh(); } catch (e) { fail(e); }
    });
    if (showDiff) diffs();
  };
  async function diffs() {
    const d = $('#diffs'); d.hidden = !showDiff; if (!showDiff) return;
    const rows = await api(`/api/projects/${pid}/inspections?disagree=true&limit=60`);
    d.innerHTML = `<div class="head"><h2>ชิ้นที่ live กับ shadow ตัดสินต่างกัน</h2><button class="btn sm" id="closeDiff">ปิด</button></div><div class="thumbs">${rows.map(r => `<div class="thumb"><div class="im">${r.image_path ? `<img loading="lazy" src="/api/inspections/${r.id}/image" alt="">` : ''}</div>
      <span>${fmtDate(r.ts)}<br>live <b>${r.live_verdict}</b> ${(r.live_score ?? 0).toFixed(2)} · shadow <b>${r.shadow_verdict}</b> ${(r.shadow_score ?? 0).toFixed(2)}</span></div>`).join('') || '<p class="empty">—</p>'}</div>`;
    $('#closeDiff').onclick = () => { showDiff = false; d.hidden = true; };
  }
  async function stage(m, s) {
    const msg = {live: `ให้ v${m.version} สั่ง OK/NG ไปที่ PLC จริง?`, shadow: `เริ่มรัน v${m.version} คู่กับตัวปัจจุบัน (ยังไม่สั่ง reject)?`, archived: `หยุด shadow v${m.version}?`}[s];
    if (!confirm(msg)) return;
    try { await api(`/api/models/${m.id}/stage`, {method: 'POST', json: {stage: s}}); toast('อัปเดตแล้ว'); refresh(); } catch (e) { fail(e); }
  }
  $('#rtOn').onchange = async e => { try { await api('/api/runtime/project', {method: 'PUT', json: {project_id: e.target.checked ? pid : null}}); toast(e.target.checked ? 'ไลน์ใช้โปรเจกต์นี้แล้ว' : 'หยุดตรวจบนไลน์'); refresh(); } catch (er) { fail(er); } };
  await refresh();
  const t = setInterval(refresh, 5000);
  return () => clearInterval(t);
}

/* ------------------------------------------------------------------ line monitor (operator screen) */
async function viewMonitor(v, params) {
  const pid = S.pid;
  let infer = localStorage.getItem('vt_mon_infer') === '1', sound = localStorage.getItem('vt_mon_sound') !== '0', seq = null, actx = null;
  v.innerHTML = `
  <div class="mon">
    <div class="mon-top">
      <div><b id="mName"></b> <span class="dim" id="mModel"></span></div>
      <div class="mon-top-r">
        <button class="btn trig" id="mTrig" title="ทำงานเหมือน PLC ส่ง COMMAND1 — ผลถูกส่งไป PLC ด้วย">Trigger <span class="kbd">Space</span></button>
        <span id="mDots"></span><span class="mono" id="clock"></span>
        <label class="chk"><input type="checkbox" id="mInfer"> AI บนภาพสด</label>
        <label class="chk"><input type="checkbox" id="mSound"> เสียงเตือน NG</label>
        <button class="btn sm" id="mFull">เต็มจอ <span class="kbd">F</span></button>
        ${langToggleHtml()}
        ${params.kiosk === '1' ? '<a class="btn sm" href="#/deploy">ออก</a>' : '<a class="btn sm" href="#/monitor?kiosk=1">โหมดจอไลน์</a>'}
      </div>
    </div>
    <div class="mon-warn" id="mWarn" hidden></div>
    <div class="mon-alarm" id="mAlarm" hidden role="alert"><span id="mAlarmTxt">NG — เสียงเตือนดังอยู่</span>
      <button class="btn" id="mReset">รับทราบ / หยุดเสียง <span class="kbd">R</span></button></div>
    <div class="mon-note" id="mAudioNote" hidden>คลิกที่หน้าจอ 1 ครั้งเพื่อเปิดเสียงเตือน (เบราว์เซอร์ไม่ให้เล่นเสียงก่อนผู้ใช้กด)</div>
    <div class="mon-main">
      <section class="mon-result">
        <div class="verdict" id="verdict"><span class="big">รอ trigger…</span></div>
        <div class="mon-img" id="mImgBox"><div class="mon-frame"><img id="mImg" alt="" hidden><div id="mBoxes" class="mboxes"></div></div><div class="mon-noimg" id="mNo">ยังไม่มีภาพ — รอ trigger จาก PLC</div></div>
        <div class="mon-meta" id="mMeta"></div>
      </section>
      <aside class="mon-side">
        <div class="panel"><div class="ph">ภาพสด <span class="dim" id="liveInfo"></span></div><img id="mLive" alt="ภาพสดจากกล้อง" style="width:100%;display:block;border-radius:8px;background:#000"></div>
        <div class="counts">
          <div class="cnt"><span>ตรวจวันนี้</span><b class="mono" id="cN">0</b></div>
          <div class="cnt ok"><span>OK</span><b class="mono" id="cOk">0</b></div>
          <div class="cnt ng"><span>NG</span><b class="mono" id="cNg">0</b></div>
          <div class="cnt"><span>% NG</span><b class="mono" id="cPct">0</b></div>
        </div>
        <div class="panel"><div class="ph">ผลล่าสุด</div><div id="mRecent"></div></div>
      </aside>
    </div>
  </div>`;
  const setLive = () => { $('#mLive').src = `/api/camera/stream?infer=${infer ? 1 : 0}&pid=${pid}&t=${Date.now()}`; };
  $('#mInfer').checked = infer; $('#mSound').checked = sound;
  $('#mInfer').onchange = e => { infer = e.target.checked; localStorage.setItem('vt_mon_infer', infer ? '1' : '0'); setLive(); };
  $('#mSound').onchange = e => { sound = e.target.checked; localStorage.setItem('vt_mon_sound', sound ? '1' : '0'); if (sound) audio(); noteAudio(); };
  const full = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
  $('#mFull').onclick = full;
  // ---- NG alarm: beeps in a rhythm until the operator resets it
  let alarm = null, ngCount = 0, lastNg = null;
  const audio = () => { try { actx = actx || new AudioContext(); if (actx.state === 'suspended') actx.resume(); } catch (e) { /* */ } return actx; };
  const tone = (at, f, d) => { const o = actx.createOscillator(), g = actx.createGain(); o.type = 'square'; o.frequency.value = f; g.gain.value = 0.15; o.connect(g); g.connect(actx.destination); o.start(at); o.stop(at + d); };
  const pattern = () => { if (!sound || !audio() || actx.state !== 'running') return; const t = actx.currentTime; tone(t, 1000, 0.18); tone(t + 0.28, 1000, 0.18); tone(t + 0.56, 750, 0.3); };
  const noteAudio = () => { $('#mAudioNote').hidden = !(sound && alarm && (!actx || actx.state !== 'running')); };
  const startAlarm = (names, n = 1) => {
    ngCount += n;
    $('#mAlarmTxt').textContent = `NG${names ? ' — ' + names : ''}${ngCount > 1 ? ` (${ngCount} ชิ้นตั้งแต่กดรับทราบครั้งล่าสุด)` : ''}`;
    $('#mAlarm').hidden = false;
    if (!alarm) { pattern(); alarm = setInterval(() => { pattern(); noteAudio(); }, 1500); }
    noteAudio();
  };
  const resetAlarm = () => { clearInterval(alarm); alarm = null; ngCount = 0; $('#mAlarm').hidden = true; $('#mAudioNote').hidden = true; };
  $('#mReset').onclick = resetAlarm;
  const unlock = () => { audio(); noteAudio(); };
  document.addEventListener('pointerdown', unlock);
  // ---- manual trigger (button / Space / T)
  let busy = false;
  const trigger = async () => {
    if (busy) return; busy = true; $('#mTrig').disabled = true;
    try {
      const r = await api('/api/plc/test-trigger', {method: 'POST'});
      if (!r.result) toast('ได้รับ trigger แต่ไม่ได้ตรวจ — ไลน์ไม่ได้ใช้โปรเจกต์นี้หรือยังไม่มีโมเดล', true);
      await poll();
    } catch (e) { fail(e); } finally { setTimeout(() => { busy = false; const b = $('#mTrig'); if (b) b.disabled = false; }, 300); }
  };
  $('#mTrig').onclick = trigger;
  const clsNames = (j, classes) => { try { return JSON.parse(j || '[]'); } catch (e) { return []; } };
  async function poll() {
    let m; try { m = await api(`/api/monitor?pid=${pid}`); } catch (e) { $('#verdict').className = 'verdict err'; $('#verdict').innerHTML = '<span class="big">เชื่อมต่อ server ไม่ได้</span>'; return; }
    const classes = m.project.classes;
    $('#mName').textContent = `${m.project.name}${m.project.station ? ' · ' + m.project.station : ''}`;
    $('#mModel').textContent = m.live ? `โมเดล v${m.live.version} · threshold ${thrText(m.live)}${m.shadow ? ` · shadow v${m.shadow.version}` : ''}` : 'ยังไม่มีโมเดลใช้งานจริง';
    const c = m.camera, p = m.plc;
    $('#mDots').innerHTML = `<span title="${esc(c.error || c.info)}"><span class="dot ${c.running && !c.error ? 'ok' : 'bad'}"></span>กล้อง ${c.fps || 0} fps</span> <span title="${esc(p.error || p.listen)}"><span class="dot ${p.running && !p.error ? 'ok' : 'bad'}"></span>PLC</span>`;
    $('#liveInfo').textContent = c.running ? (infer ? '· AI ตรวจทุกเฟรม' : '') : `· ${c.error || 'กล้องไม่ทำงาน'}`;
    const w = $('#mWarn');
    if (!m.enabled) {
      w.hidden = false;
      if (!$('#mUse')) {
        w.innerHTML = `ไลน์ไม่ได้ใช้โปรเจกต์นี้ — trigger จาก PLC จะไม่ถูกตรวจและไม่มีการตอบกลับ <button class="btn sm" id="mUse" style="margin-left:12px">ให้ไลน์ใช้ ${esc(m.project.name)}</button>`;
        $('#mUse').onclick = async () => { try { await api('/api/runtime/project', {method: 'PUT', json: {project_id: pid}}); toast('ไลน์ใช้โปรเจกต์นี้แล้ว'); poll(); } catch (e) { fail(e); } };
      }
    } else if (!m.live) {
      w.hidden = false;
      w.textContent = m.auto_capture?.enabled ? 'โหมดเก็บภาพ — ยังไม่มีโมเดลใช้งานจริง ไม่ส่งผลไป PLC' : 'ยังไม่มีโมเดลใช้งานจริง — PLC จะไม่ได้รับผล (deploy ที่หน้า Deploy)';
    } else { w.hidden = true; w.textContent = ''; }
    const t = m.today;
    // alarm on every new NG counted by the server (does not miss parts when several arrive between polls)
    if (lastNg !== null && t.ng > lastNg) {
      const newNg = m.recent.filter(r => r.live_verdict === 'NG').slice(0, t.ng - lastNg);
      const names = [...new Set(newNg.flatMap(r => clsNames(r.live_classes)))].join(', ');
      startAlarm(names, t.ng - lastNg);
    }
    lastNg = t.ng;
    $('#cN').textContent = t.n; $('#cOk').textContent = t.ok; $('#cNg').textContent = t.ng;
    $('#cPct').textContent = t.n ? (100 * t.ng / t.n).toFixed(1) : '0';
    $('#mRecent').innerHTML = m.recent.map(r => `<div class="rrow"><span class="mono dim">${new Date(r.ts * 1000).toLocaleTimeString(LOC())}</span>
      <span class="vpill ${(r.live_verdict || '').toLowerCase()}">${r.live_verdict || (r.shadow_verdict ? 'S:' + r.shadow_verdict : '—')}</span>
      <span class="rcls">${clsNames(r.live_classes).map(esc).join(', ')}</span><span class="mono dim">${r.ms != null ? r.ms + ' ms' : ''}</span></div>`).join('') || '<p class="dim">ยังไม่มีผล</p>';
    const L = m.last;
    if (!L || L.seq === seq) return;
    const first = seq === null; seq = L.seq;
    const vd = $('#verdict');
    if (L.mode === 'capture') { vd.className = 'verdict cap'; vd.innerHTML = '<span class="big">เก็บภาพแล้ว</span><span class="sub">ยังไม่มีโมเดลบนไลน์</span>'; }
    else if (L.error) { vd.className = 'verdict err'; vd.innerHTML = '<span class="big">ERROR</span><span class="sub">กล้องไม่ส่งภาพ — ส่ง ER01</span>'; }
    else if (L.live_verdict) {
      const names = clsNames(L.live_classes);
      vd.className = 'verdict ' + L.live_verdict.toLowerCase();
      vd.innerHTML = `<span class="big">${L.live_verdict}</span><span class="sub">${L.live_verdict === 'NG' ? names.map(esc).join(', ') : 'ไม่พบตำหนิ'}</span>${L.shadow_verdict ? `<span class="shadow">shadow v${L.shadow_version}: ${L.shadow_verdict}${L.disagree ? ' ≠' : ''}</span>` : ''}`;

    } else { vd.className = 'verdict cap'; vd.innerHTML = `<span class="big">Shadow: ${L.shadow_verdict}</span><span class="sub">ยังไม่ส่งผลไป PLC</span>`; }
    if (!first) { vd.classList.add('flash'); setTimeout(() => vd.classList.remove('flash'), 400); }
    const dets = L.live_dets?.length || !L.shadow_dets ? (L.live_dets || []) : L.shadow_dets;
    $('#mNo').hidden = !L.error; $('#mImg').hidden = !!L.error; $('#mImg').alt = 'ภาพชิ้นงานล่าสุดที่ตรวจ';
    if (!L.error) $('#mImg').src = `/api/monitor/last.jpg?seq=${L.seq}`;
    $('#mBoxes').innerHTML = dets.map(d => `<div class="mbox" style="left:${d.x1 * 100}%;top:${d.y1 * 100}%;width:${(d.x2 - d.x1) * 100}%;height:${(d.y2 - d.y1) * 100}%"><span>${esc(classes[d.cls] ?? d.cls)} ${d.conf.toFixed(2)}</span></div>`).join('');
    $('#mMeta').innerHTML = `<span class="mono">${new Date(L.ts * 1000).toLocaleTimeString(LOC())}</span>${L.ms != null ? ` · ตรวจ ${L.ms} ms` : ''}${L.codes ? ` · ส่ง PLC: <b class="mono">${clsNames(L.codes).join(', ') || '—'}</b>` : ''}${L.live_score != null ? ` · คะแนนสูงสุด ${L.live_score.toFixed(2)}` : ''}`;
  }
  // scale the last image to fill its box (boxes are positioned in % of the frame, so frame = image size)
  const fit = () => {
    const img = $('#mImg'), box = $('#mImgBox'), fr = $('.mon-frame');
    if (!img || !img.naturalWidth) return;
    const bw = box.clientWidth, bh = Math.max(200, window.innerHeight - box.getBoundingClientRect().top - 50);
    const k = Math.min(bw / img.naturalWidth, bh / img.naturalHeight);
    fr.style.width = Math.floor(img.naturalWidth * k) + 'px'; fr.style.height = Math.floor(img.naturalHeight * k) + 'px';
  };
  $('#mImg').onload = fit; window.addEventListener('resize', fit);
  const tick = () => { $('#clock').textContent = new Date().toLocaleTimeString(LOC()); };
  const key = e => {
    if (typing(e) || e.ctrlKey || e.altKey || e.metaKey) return;
    unlock();
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 't') { e.preventDefault(); if (!e.repeat) trigger(); }
    else if (k === 'r' || k === 'escape') { if (alarm) { e.preventDefault(); resetAlarm(); } }
    else if (k === 'f') full();
  };
  document.addEventListener('keydown', key);
  setLive(); tick(); await poll();
  const t1 = setInterval(poll, 400), t2 = setInterval(tick, 1000);
  return () => { clearInterval(t1); clearInterval(t2); clearInterval(alarm); document.removeEventListener('pointerdown', unlock); document.removeEventListener('keydown', key); window.removeEventListener('resize', fit); const l = $('#mLive'); if (l) l.src = ''; document.body.classList.remove('kiosk', 'dark'); };
}

function thrText(m) {   // "0.50" or "crack 0.40 · wrinkle 0.60"
  const per = m?.class_thresholds || {};
  if (!Object.keys(per).length) return String(m?.threshold ?? '');
  return Object.entries(per).map(([k, x]) => `${clsName(Number(k))} ${Number(x).toFixed(2)}`).join(' · ');
}

const VIEWS = {monitor: viewMonitor, project: viewProject, capture: viewCapture, label: viewLabel, train: viewTrain, results: viewResults, deploy: viewDeploy};
startI18n();
$('#langSlot').innerHTML = langToggleHtml();
(async () => { await pollStatus(); try { await loadProjects(); } catch (e) { fail(e); } route(); })();
