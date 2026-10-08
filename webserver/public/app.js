// app.js — Evitech APK Builder frontend
const $ = (s, r = document) => r.querySelector(s);
const API = {
  async req(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...opts
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  },
  get: p => API.req(p),
  post: (p, body) => API.req(p, { method: 'POST', body: JSON.stringify(body || {}) }),
  put: (p, body) => API.req(p, { method: 'PUT', body: JSON.stringify(body || {}) }),
  del: p => API.req(p, { method: 'DELETE' }),
};

let me = true; // identity is automatic — no login in this app
let project = null; // currently open project
let iconData = null; // data-url

const DEFAULT_HTML = `<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My App</title>
</head>
<body>

<h1>Hello World</h1>

<button onclick="sayHello()">
    Click Me
</button>

<script>
function sayHello() {
    alert("Hello from my Android app!");
}
</script>

</body>
</html>`;

const DEFAULT_CSS = `body {
    font-family: sans-serif;
    background: #0B0E11;
    color: #E8EAED;
    text-align: center;
    padding-top: 60px;
    margin: 0;
}
button {
    padding: 14px 28px;
    font-size: 18px;
    background: #008E11;
    color: #fff;
    border: none;
    border-radius: 12px;
}`;

const DEFAULT_JS = `function sayHello() {
    alert("Hello from my Android app!");
}`;

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', isErr);
  t.hidden = false;
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.hidden = true, 3500);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtSize(n) {
  if (!n) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/* identity is automatic — no login in this app */

/* ───────── router ───────── */
function route() {
  const hash = location.hash || '#/home';
  const view = hash.replace('#/', '').split('?')[0];
  document.querySelectorAll('[data-nav]').forEach(a =>
    a.classList.toggle('active', a.dataset.nav === view));
  if (view === 'home') renderHome();
  else if (view === 'build') renderBuilder();
  else if (view === 'dashboard') renderDashboard();
  else if (view === 'admin') renderAdmin();
  else if (view === 'result') renderResult();
  else renderHome();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ───────── home ───────── */
function renderHome() {
  $('#view').innerHTML = `
    <section class="hero">
      <h1>Turn your code into an <span class="grad">Android app</span>.</h1>
      <p>Paste your HTML, CSS and JavaScript, customize your app, and build a downloadable APK in a few clicks. No Android Studio, no Gradle, no coding for Android required.</p>
      <div class="hero-actions">
        <a href="#/build" class="btn btn-primary btn-xl">Start Building</a>
        <a href="#how" class="btn btn-ghost btn-xl" onclick="document.querySelector('.steps').scrollIntoView({behavior:'smooth'});return false;">How It Works</a>
      </div>
    </section>

    <section class="steps" id="how">
      <div class="card step"><div class="step-num">01</div><h3>Paste</h3><p>Paste your HTML, CSS and JavaScript into the built-in editor.</p></div>
      <div class="card step"><div class="step-num">02</div><h3>Customize</h3><p>Add your app name, icon and Android settings.</p></div>
      <div class="card step"><div class="step-num">03</div><h3>Build</h3><p>Generate and download your APK. Install it on any Android phone.</p></div>
    </section>

    <section class="features">
      <h2>Everything you need</h2>
      <div class="feature-grid">
        <div class="feature"><span class="tick">✓</span> HTML/CSS/JavaScript support</div>
        <div class="feature"><span class="tick">✓</span> Custom app icon</div>
        <div class="feature"><span class="tick">✓</span> Custom app name</div>
        <div class="feature"><span class="tick">✓</span> Package name</div>
        <div class="feature"><span class="tick">✓</span> Version control</div>
        <div class="feature"><span class="tick">✓</span> Android APK generation</div>
        <div class="feature"><span class="tick">✓</span> Downloadable APK</div>
        <div class="feature"><span class="tick">✓</span> Build history</div>
      </div>
    </section>`;
}

/* ───────── builder ───────── */
function newProject() {
  return {
    id: null, name: '', package_name: '', version_name: '1.0', version_code: 1,
    html: DEFAULT_HTML, css: DEFAULT_CSS, javascript: DEFAULT_JS,
    settings: { orientation: 'portrait', fullscreen: false, status_bar: true, nav_bar: true, internet: true }
  };
}

function renderBuilder() {
  if (!project) project = newProject();
  iconData = project.icon || null;
  $('#view').innerHTML = `
  <div class="builder-grid">
    <div>
      <div class="step-section card">
        <div class="step-tag"><span class="n">STEP 1</span> App information</div>
        <label class="field"><span>App Name</span>
          <input type="text" id="fName" placeholder="My Awesome App" maxlength="50" value="${esc(project.name)}" />
          <div class="hint">Shown under the icon on the phone.</div>
        </label>
        <label class="field"><span>Package Name</span>
          <input type="text" id="fPackage" placeholder="com.example.myapp" maxlength="120" value="${esc(project.package_name)}" autocapitalize="off" spellcheck="false" />
          <div class="hint">Unique app ID, like com.example.myapp. Lowercase only.</div>
        </label>
        <div style="display:flex; gap:12px;">
          <label class="field" style="flex:1"><span>Version Name</span>
            <input type="text" id="fVersionName" value="${esc(project.version_name)}" placeholder="1.0" />
          </label>
          <label class="field" style="flex:1"><span>Version Code</span>
            <input type="number" id="fVersionCode" value="${esc(project.version_code)}" min="1" />
          </label>
        </div>
      </div>

      <div class="step-section card">
        <div class="step-tag"><span class="n">STEP 2</span> App icon</div>
        <div class="icon-row">
          <img id="iconPreview" class="icon-preview" src="${iconData || defaultIconUrl()}" alt="App icon" />
          <div class="icon-actions">
            <label class="btn btn-ghost btn-sm" style="position:relative">Upload App Icon
              <input type="file" id="iconInput" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" hidden />
            </label>
            <button class="btn btn-danger btn-sm" id="iconRemove">Remove Icon</button>
          </div>
        </div>
        <div class="icon-note">PNG, JPG or WebP. Square images of 512×512 or larger look best. If you skip this, the default Evitech icon is used.</div>
      </div>

      <div class="step-section card">
        <div class="step-tag"><span class="n">STEP 3</span> Your code</div>
        <div class="editor-tabs">
          <button class="tab active" data-tab="html">HTML</button>
          <button class="tab" data-tab="css">CSS</button>
          <button class="tab" data-tab="javascript">JavaScript</button>
        </div>
        <textarea id="codeHtml" class="code-area" data-lang="html" spellcheck="false" autocapitalize="off" autocomplete="off">${esc(project.html)}</textarea>
        <textarea id="codeCss" class="code-area" data-lang="css" spellcheck="false" autocapitalize="off" autocomplete="off" hidden>${esc(project.css)}</textarea>
        <textarea id="codeJs" class="code-area" data-lang="javascript" spellcheck="false" autocapitalize="off" autocomplete="off" hidden>${esc(project.javascript)}</textarea>
      </div>

      <div class="step-section card">
        <div class="step-tag"><span class="n">STEP 4</span> Android settings</div>
        <label class="field"><span>Orientation</span>
          <select id="fOrientation">
            <option value="portrait">Portrait — app stays vertical</option>
            <option value="landscape">Landscape — app stays sideways</option>
            <option value="auto">Auto — rotates with the device</option>
          </select>
        </label>
        ${toggleRow('tFullscreen', 'Fullscreen', 'Hides the status bar and navigation bar for a full-screen experience.')}
        ${toggleRow('tStatusBar', 'Status Bar', 'Shows the time, battery and notifications at the top.')}
        ${toggleRow('tNavBar', 'Navigation Bar', 'Shows the Back / Home / Recents buttons at the bottom.')}
        ${toggleRow('tInternet', 'Internet Access', 'Lets your app load online content. Turn off for offline-only apps.')}
      </div>

      <div class="build-bar">
        <button class="btn btn-primary btn-xl btn-block" id="buildBtn">⚡ BUILD APK</button>
        <div class="build-status" id="buildStatus"></div>
      </div>
    </div>

    <aside class="preview-sticky">
      <div class="card">
        <div class="step-tag"><span class="n">LIVE</span> Preview</div>
        <div class="phone"><div class="notch"></div><iframe id="previewFrame" sandbox="allow-scripts allow-modals" title="App preview"></iframe></div>
        <div class="preview-actions">
          <button class="btn btn-ghost btn-sm" id="refreshPreview">↻ Refresh Preview</button>
        </div>
        <div class="icon-note" style="text-align:center">Live preview of how your app will look and behave.</div>
      </div>
    </aside>
  </div>`;

  // state
  $('#fOrientation').value = project.settings.orientation || 'portrait';
  $('#tFullscreen').checked = !!project.settings.fullscreen;
  $('#tStatusBar').checked = project.settings.status_bar !== false;
  $('#tNavBar').checked = project.settings.nav_bar !== false;
  $('#tInternet').checked = project.settings.internet !== false;

  // editor tabs
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    ['html', 'css', 'javascript'].forEach(l => {
      $(`#code${l === 'javascript' ? 'Js' : l.charAt(0).toUpperCase() + l.slice(1)}`).hidden = t.dataset.tab !== l;
    });
  }));

  // icon upload
  $('#iconInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) { toast('Please choose a PNG, JPG or WebP image.', true); return; }
    if (file.size > 5 * 1024 * 1024) { toast('Image is too large (max 5MB).', true); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      if (img.width < 48 || img.height < 48) { toast('Image is too small — at least 48×48 pixels required.', true); return; }
      // downscale/fit to 512 canvas
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const ctx = c.getContext('2d');
      const scale = Math.min(512 / img.width, 512 / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (512 - w) / 2, (512 - h) / 2, w, h);
      iconData = c.toDataURL('image/png');
      $('#iconPreview').src = iconData;
      URL.revokeObjectURL(url);
    };
    img.onerror = () => toast('That file could not be read as an image.', true);
    img.src = url;
  });
  $('#iconRemove').addEventListener('click', () => {
    iconData = null;
    $('#iconPreview').src = defaultIconUrl();
    toast('Icon removed — the default Evitech icon will be used.');
  });

  // preview
  const refresh = () => {
    collectProject();
    const doc = `<style>${project.css || ''}</style>` + project.html +
      `\n<script>${project.javascript || ''}<\/script>`;
    $('#previewFrame').srcdoc = doc;
  };
  let deb;
  const auto = () => { clearTimeout(deb); deb = setTimeout(refresh, 700); };
  ['codeHtml', 'codeCss', 'codeJs'].forEach(id => $('#' + id).addEventListener('input', auto));
  $('#refreshPreview').addEventListener('click', refresh);
  refresh();

  $('#buildBtn').addEventListener('click', doBuild);
}

function toggleRow(id, label, desc) {
  return `<div class="toggle-row">
    <div><div class="lbl">${label}</div><div class="desc">${desc}</div></div>
    <label class="switch"><input type="checkbox" id="${id}" /><span class="track"></span></label>
  </div>`;
}

function defaultIconUrl() {
  return 'eviltech-icon.svg';
}

function collectProject() {
  project.name = $('#fName').value.trim();
  project.package_name = $('#fPackage').value.trim().toLowerCase();
  project.version_name = $('#fVersionName').value.trim() || '1.0';
  project.version_code = parseInt($('#fVersionCode').value, 10) || 1;
  project.html = $('#codeHtml').value;
  project.css = $('#codeCss').value;
  project.javascript = $('#codeJs').value;
  project.icon = iconData;
  project.settings = {
    orientation: $('#fOrientation').value,
    fullscreen: $('#tFullscreen').checked,
    status_bar: $('#tStatusBar').checked,
    nav_bar: $('#tNavBar').checked,
    internet: $('#tInternet').checked
  };
  return project;
}

function clientValidate(p) {
  if (!p.name) return 'Please give your app a name.';
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(p.package_name))
    return 'Your package name is invalid. Use a format like com.example.myapp (lowercase, at least two parts separated by dots).';
  if (!p.html.trim()) return 'Paste some HTML code for your app first.';
  return null;
}

async function doBuild() {
  const p = collectProject();
  const err = clientValidate(p);
  if (err) { toast(err, true); return; }

  const btn = $('#buildBtn');
  btn.disabled = true;
  const status = $('#buildStatus');
  status.innerHTML = `
    <div class="card">
      <div class="spinner"></div>
      <p style="text-align:center;font-weight:600;margin-bottom:6px">Building your Android app...</p>
      <ul class="build-log" id="buildLog">
        <li data-step="save"><span class="mark">○</span> Saving project</li>
        <li data-step="validate"><span class="mark">○</span> Validating project</li>
        <li data-step="prepare"><span class="mark">○</span> Preparing Android project</li>
        <li data-step="icon"><span class="mark">○</span> Processing app icon</li>
        <li data-step="package"><span class="mark">○</span> Packaging source files</li>
        <li data-step="compile"><span class="mark">○</span> Compiling APK</li>
        <li data-step="finalize"><span class="mark">○</span> Finalizing APK</li>
      </ul>
    </div>`;
  const setStep = (name, state) => {
    const li = $(`#buildLog li[data-step="${name}"]`);
    if (!li) return;
    li.classList.remove('active', 'done');
    if (state) li.classList.add(state);
    li.querySelector('.mark').textContent = state === 'done' ? '✓' : state === 'active' ? '●' : '○';
  };
  const only = active => {
    document.querySelectorAll('#buildLog li').forEach(li => {
      const order = ['save','validate','prepare','icon','package','compile','finalize'];
      const idx = order.indexOf(li.dataset.step);
      const aIdx = order.indexOf(active);
      if (idx < aIdx) setStep(li.dataset.step, 'done');
      else if (idx === aIdx) setStep(li.dataset.step, 'active');
    });
  };

  try {
    only('save');
    // save or create the project
    if (p.id) await API.put(`/api/projects/${p.id}`, p);
    else { const r = await API.post('/api/projects', p); project = r.project; }

    only('validate');
    const rb = await API.post(`/api/projects/${project.id}/build`);
    const buildId = rb.build.id;

    only('icon');
    await pollBuild(buildId, ['prepare', 'icon', 'package', 'compile', 'finalize']);
    only('finalize');

    const fin = await API.get(`/api/builds/${buildId}`);
    if (fin.build.status === 'success') {
      sessionStorage.setItem('evitech_result', JSON.stringify(fin.build));
      location.hash = '#/result';
      return;
    }
    throw new Error(fin.build.error_message || 'The build failed. Please try again.');
  } catch (e) {
    status.innerHTML = `
      <div class="card result" style="margin:0">
        <div class="big">⚠️</div>
        <h2>Build Failed</h2>
        <div class="fail-reason"><strong>Reason:</strong> ${esc(e.message)}</div>
        <button class="btn btn-ghost" onclick="document.getElementById('buildBtn').disabled=false;document.getElementById('buildStatus').innerHTML=''">Try Again</button>
      </div>`;
    btn.disabled = false;
    return;
  }
}

async function pollBuild(buildId) {
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const r = await API.get(`/api/builds/${buildId}`);
      const st = r.build.status;
      if (st === 'running') { only('compile'); }
      if (st === 'success' || st === 'failed' || st === 'expired') return;
    } catch { /* transient */ }
  }
  throw new Error('The build is taking unusually long. Check your build history in a minute.');
}

/* ───────── result ───────── */
function renderResult() {
  const data = JSON.parse(sessionStorage.getItem('evitech_result') || 'null');
  if (!data) { location.hash = '#/dashboard'; return; }
  $('#view').innerHTML = `
    <div class="result">
      <div class="big">🎉</div>
      <h2>APK BUILD SUCCESSFUL</h2>
      <p class="muted">Your Android app is ready to download and install.</p>
      <div class="card meta-card">
        <div class="meta-row"><img src="${data.icon || defaultIconUrl()}" alt="" /><div><strong>${esc(data.app_name)}</strong><div class="pkg">${esc(data.package_name)}</div></div></div>
        <div class="meta-row"><span class="k">Version</span><span>${esc(data.version_name)}</span></div>
        <div class="meta-row"><span class="k">File size</span><span>${fmtSize(data.file_size)}</span></div>
        <div class="meta-row"><span class="k">Built</span><span>${fmtDate(data.completed_at)}</span></div>
      </div>
      <div class="result-actions">
        <a class="btn btn-lime btn-xl btn-block" href="/api/builds/${data.id}/apk">⬇ DOWNLOAD APK</a>
        <a class="btn btn-ghost" href="#/build" onclick="sessionStorage.removeItem('evitech_result');project=null">Build Another App</a>
        <a class="btn btn-ghost" href="#/dashboard" onclick="sessionStorage.removeItem('evitech_result')">Back to Dashboard</a>
      </div>
      <p class="icon-note" style="margin-top:14px">You may need to allow "Install from unknown sources" on your phone to install the APK.</p>
    </div>`;
}

/* ───────── dashboard ───────── */
async function renderDashboard() {
  const r = await API.get('/api/projects').catch(() => ({ projects: [] }));
  const projects = r.projects || [];
  $('#view').innerHTML = `
    <div class="dash-head">
      <h2>My Apps</h2>
      <a href="#/build" class="btn btn-primary" onclick="sessionStorage.removeItem('evitech_result');project=null">+ New Android App</a>
    </div>
    ${projects.length === 0 ? `
      <div class="empty">
        <div class="big">📦</div>
        <h3>No apps yet</h3>
        <p>Create your first app and build an APK in minutes.</p>
        <br/>
        <a href="#/build" class="btn btn-primary" onclick="project=null">Start Building</a>
      </div>` : `
      <div class="apps-grid">
        ${projects.map(p => appCard(p)).join('')}
      </div>`}
  `;
  bindDashboardActions(projects);
}

function statusOf(p) {
  const b = p.last_build;
  if (!b) return { cls: 'status-none', label: 'NOT BUILT', id: null };
  const map = { success: 'READY', failed: 'FAILED', running: 'BUILDING', queued: 'QUEUED', expired: 'EXPIRED' };
  return { cls: `status-${b.status}`, label: map[b.status] || b.status.toUpperCase(), id: b.id };
}

function appCard(p) {
  const st = statusOf(p);
  return `<div class="card app-card" data-id="${p.id}">
    <div class="app-card-top">
      <img src="${p.icon || defaultIconUrl()}" alt="" />
      <div style="min-width:0">
        <h3>${esc(p.name)}</h3>
        <div class="pkg">${esc(p.package_name)} · v${esc(p.version_name)}</div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted)">
      <span>Last build: ${p.last_build ? fmtDate(p.last_build.created_at) : 'never'}</span>
      <span class="status-pill ${st.cls}">${st.label}</span>
    </div>
    <div class="app-actions">
      <button class="btn btn-ghost btn-sm" data-act="open">Open</button>
      <button class="btn btn-primary btn-sm" data-act="build">Build</button>
      <button class="btn btn-lime btn-sm" data-act="download" ${st.id && p.last_build.status === 'success' ? '' : 'disabled'}>Download</button>
      <button class="btn btn-danger btn-sm" data-act="delete">Delete</button>
    </div>
  </div>`;
}

function bindDashboardActions(projects) {
  document.querySelectorAll('.app-card').forEach(card => {
    const p = projects.find(x => x.id === card.dataset.id);
    card.querySelector('[data-act="open"]').addEventListener('click', async () => {
      const r = await API.get(`/api/projects/${p.id}`);
      project = r.project;
      location.hash = '#/build';
    });
    card.querySelector('[data-act="build"]').addEventListener('click', async () => {
      const r = await API.get(`/api/projects/${p.id}`);
      project = r.project;
      location.hash = '#/build';
    });
    card.querySelector('[data-act="download"]').addEventListener('click', async () => {
      if (!p.last_build || p.last_build.status !== 'success') return;
      location.href = `/api/builds/${p.last_build.id}/apk`;
    });
    card.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      if (!confirm(`Delete "${p.name}"? This removes the project and its build history.`)) return;
      try { await API.del(`/api/projects/${p.id}`); toast('Project deleted.'); renderDashboard(); }
      catch (e) { toast(e.message, true); }
    });
  });
}

/* ───────── admin ───────── */
async function renderAdmin() {
  location.hash = '#/home';
  return;
  // admin requires an account; disabled while the platform is login-free
  let s;
  try { s = await API.get('/api/admin/stats'); } catch { location.hash = '#/home'; return; }
  const kb = n => (n / 1024 / 1024).toFixed(1) + ' MB';
  $('#view').innerHTML = `
    <h2 style="margin-bottom:16px">Admin</h2>
    <div class="stats-grid">
      <div class="card stat"><div class="v">${s.total_users}</div><div class="k">Total users</div></div>
      <div class="card stat"><div class="v">${s.total_projects}</div><div class="k">Projects</div></div>
      <div class="card stat"><div class="v">${s.total_builds}</div><div class="k">Total builds</div></div>
      <div class="card stat"><div class="v">${s.successful_builds}</div><div class="k">Successful</div></div>
      <div class="card stat"><div class="v">${s.failed_builds}</div><div class="k">Failed</div></div>
      <div class="card stat"><div class="v">${s.queue_length}</div><div class="k">In queue</div></div>
      <div class="card stat"><div class="v">${kb(s.storage_bytes)}</div><div class="k">Storage used</div></div>
    </div>
    <div class="card" style="margin-bottom:18px"><h3 style="margin-bottom:10px">Users</h3><div class="table-wrap" id="adminUsers">Loading…</div></div>
    <div class="card" style="margin-bottom:18px"><h3 style="margin-bottom:10px">Projects</h3><div class="table-wrap" id="adminProjects">Loading…</div></div>
    <div class="card"><h3 style="margin-bottom:10px">Builds</h3><div class="table-wrap" id="adminBuilds">Loading…</div></div>`;

  const [u, p, b] = await Promise.all([
    API.get('/api/admin/users'), API.get('/api/admin/projects'), API.get('/api/admin/builds')
  ]);
  $('#adminUsers').innerHTML = `<table><tr><th>Email</th><th>Projects</th><th>Joined</th><th>Status</th><th></th></tr>
    ${u.users.map(x => `<tr>
      <td>${esc(x.email)}${x.is_admin ? ' <span class="status-pill status-queued">ADMIN</span>' : ''}</td>
      <td>${x.project_count}</td><td>${fmtDate(x.created_at)}</td>
      <td>${x.disabled ? '<span class="status-pill status-failed">DISABLED</span>' : '<span class="status-pill status-success">ACTIVE</span>'}</td>
      <td><button class="btn btn-sm ${x.disabled ? 'btn-ghost' : 'btn-danger'}" data-uid="${x.id}">${x.disabled ? 'Enable' : 'Disable'}</button></td>
    </tr>`).join('')}</table>`;
  $('#adminUsers').querySelectorAll('button').forEach(btn => btn.addEventListener('click', async () => {
    try { await API.post(`/api/admin/users/${btn.dataset.uid}/disable`); renderAdmin(); }
    catch (e) { toast(e.message, true); }
  }));
  $('#adminProjects').innerHTML = `<table><tr><th>App</th><th>Package</th><th>Owner</th><th>Created</th><th></th></tr>
    ${p.projects.map(x => `<tr><td>${esc(x.name)}</td><td class="pkg">${esc(x.package_name)}</td><td>${esc(x.owner)}</td><td>${fmtDate(x.created_at)}</td>
    <td><button class="btn btn-danger btn-sm" data-pid="${x.id}">Delete</button></td></tr>`).join('')}</table>`;
  $('#adminProjects').querySelectorAll('button').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Delete this project?')) return;
    try { await API.del(`/api/admin/projects/${btn.dataset.pid}`); renderAdmin(); }
    catch (e) { toast(e.message, true); }
  }));
  $('#adminBuilds').innerHTML = `<table><tr><th>App</th><th>Owner</th><th>Status</th><th>Size</th><th>Started</th><th>Error</th></tr>
    ${b.builds.map(x => `<tr><td>${esc(x.app_name)}</td><td>${esc(x.owner)}</td>
    <td><span class="status-pill status-${x.status}">${x.status.toUpperCase()}</span></td>
    <td>${fmtSize(x.file_size)}</td><td>${fmtDate(x.created_at)}</td>
    <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(x.error_message || '')}">${esc(x.error_message || '—')}</td></tr>`).join('')}</table>`;
}

/* ───────── boot ───────── */
route();
