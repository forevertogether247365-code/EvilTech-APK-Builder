// Evitech APK Builder — backend API + frontend host.
// Real APK builds run through tools/evitech/build-apk.sh (aapt2/d8/apksigner).

import express from 'express';
import pg from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.WEBSERVER_PORT ?? 3001);
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TEMPLATES = path.join(ROOT, 'tools', 'evitech', 'template');
const BUILD_SCRIPT = path.join(ROOT, 'tools', 'evitech', 'build-apk.sh');
const STORAGE_DIR = path.join(process.env.HOME || '/home/user', 'evitech-storage');
const BUILD_TMP = '/tmp/evitech-builds';

const db = new pg.Pool({ connectionString: process.env.EVITECH_DB_URL, max: 5 });
const app = express();
app.use(express.json({ limit: '8mb' })); // room for base64 icons

/* ────────────────────────── schema ────────────────────────── */
async function initDb() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      disabled BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      package_name TEXT NOT NULL,
      version_name TEXT DEFAULT '1.0',
      version_code INT DEFAULT 1,
      icon TEXT,
      html TEXT DEFAULT '',
      css TEXT DEFAULT '',
      javascript TEXT DEFAULT '',
      settings JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS builds (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'queued',
      apk_path TEXT,
      file_size BIGINT,
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      completed_at TIMESTAMPTZ
    );
  `);
}

/* ────────────────────────── auth ────────────────────────── */
const SECRET = crypto.randomBytes(32).toString('hex'); // per-process; sessions also live in db
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), test);
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
/* ────────────────────────── anonymous identity ──────────────────────────
   No login required: every browser gets its own anonymous user automatically,
   so projects/dashboard are per-browser but nobody ever signs up or in. */
async function getUser(req, res) {
  const token = parseCookies(req)['evitech_session'];
  if (token) {
    const r = await db.query(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`, [token]);
    const user = r.rows[0];
    if (user && !user.disabled) return { user, token };
  }
  // auto-create an anonymous user + session for this browser
  const id = crypto.randomUUID();
  const nu = await db.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, 'anon') RETURNING *`,
    [`anon-${id}@anonymous.local`]);
  const newToken = crypto.randomBytes(32).toString('hex');
  await db.query('INSERT INTO sessions (token, user_id) VALUES ($1,$2)', [newToken, nu.rows[0].id]);
  if (res) res.setHeader('Set-Cookie', `evitech_session=${newToken}; HttpOnly; Path=/; Max-Age=31536000; SameSite=Lax`);
  return { user: nu.rows[0], token: newToken };
}
function requireAuth(req, res, next) {
  getUser(req, res).then(({ user }) => {
    req.user = user;
    next();
  });
}
function requireAdmin(req, res, next) {
  getUser(req).then(({ user }) => {
    if (!user.is_admin) return res.status(403).json({ error: 'Admin access required.' });
    req.user = user;
    next();
  });
}

/* ────────────────────────── projects ────────────────────────── */
const PKG_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const RESERVED = ['abstract','assert','boolean','break','byte','case','catch','char','class','const','continue','default','do','double','else','enum','extends','final','finally','float','for','goto','if','implements','import','instanceof','int','interface','long','native','new','package','private','protected','public','return','short','static','strictfp','super','switch','synchronized','this','throw','throws','transient','try','void','volatile','while','true','false','null'];
function validateProject(p) {
  const name = (p.name || '').trim();
  if (!name) return 'Please give your app a name.';
  if (name.length > 50) return 'App name is too long (max 50 characters).';
  if (/[<>&"']/.test(name)) return 'App name contains characters that are not allowed.';
  const pkg = (p.package_name || '').trim();
  if (!pkg) return 'Please enter a package name, e.g. com.example.myapp';
  if (!PKG_RE.test(pkg)) return 'Your package name is invalid. Please use a format such as com.example.myapp (lowercase letters, numbers and dots, at least two parts).';
  if (pkg.length > 120) return 'Package name is too long.';
  for (const seg of pkg.split('.')) if (RESERVED.includes(seg)) return `"${seg}" is a reserved Java word and cannot be used in a package name.`;
  const vn = (p.version_name || '1.0').trim();
  if (!/^[0-9]+(\.[0-9]+){0,2}$/.test(vn)) return 'Version name should look like 1.0 or 2.1.3.';
  const vc = Number(p.version_code ?? 1);
  if (!Number.isInteger(vc) || vc < 1 || vc > 2100000000) return 'Version code must be a positive whole number.';
  const html = p.html || '';
  if (!html.trim()) return 'Your project has no HTML code yet. Paste some code first.';
  const total = html.length + (p.css || '').length + (p.javascript || '').length;
  if (total > 3_000_000) return 'Your project is too large (over ~3MB of code). Please split it down.';
  if (!/<!DOCTYPE html|<html/i.test(html)) return 'Your HTML should start with <!DOCTYPE html> or <html>.';
  return null;
}

/* ────────────────────────── projects ────────────────────────── */
app.get('/api/projects', requireAuth, async (req, res) => {
  const r = await db.query(
    `SELECT p.*, (SELECT json_build_object('status', b.status, 'created_at', b.created_at, 'id', b.id)
      FROM builds b WHERE b.project_id = p.id ORDER BY b.created_at DESC LIMIT 1) AS last_build
     FROM projects p WHERE p.user_id = $1 ORDER BY p.updated_at DESC`, [req.user.id]);
  res.json({ projects: r.rows });
});

app.post('/api/projects', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const err = validateProject(b);
    if (err) return res.status(400).json({ error: err });
    const dup = await db.query('SELECT id FROM projects WHERE user_id = $1 AND package_name = $2 AND id::text <> $3::text',
      [req.user.id, b.package_name.trim(), b.id || '']);
    if (dup.rows.length) return res.status(409).json({ error: 'You already have a project with this package name. Package names must be unique.' });
    const r = await db.query(
      `INSERT INTO projects (user_id, name, package_name, version_name, version_code, icon, html, css, javascript, settings)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.id, b.name.trim(), b.package_name.trim(), b.version_name || '1.0', Number(b.version_code ?? 1),
       b.icon || null, b.html || '', b.css || '', b.javascript || '',
       JSON.stringify(b.settings || {})]
    );
    res.json({ project: r.rows[0] });
  } catch (e) { console.error('create project', e); res.status(500).json({ error: 'Could not save the project.' }); }
});

app.get('/api/projects/:id', requireAuth, async (req, res) => {
  const r = await db.query('SELECT * FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Project not found.' });
  res.json({ project: r.rows[0] });
});

app.put('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const own = await db.query('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!own.rows.length) return res.status(404).json({ error: 'Project not found.' });
    const b = req.body || {};
    const err = validateProject(b);
    if (err) return res.status(400).json({ error: err });
    const dup = await db.query('SELECT id FROM projects WHERE user_id = $1 AND package_name = $2 AND id <> $3',
      [req.user.id, b.package_name.trim(), req.params.id]);
    if (dup.rows.length) return res.status(409).json({ error: 'You already have a project with this package name.' });
    const r = await db.query(
      `UPDATE projects SET name=$1, package_name=$2, version_name=$3, version_code=$4,
        icon=COALESCE($5, icon), html=$6, css=$7, javascript=$8, settings=$9, updated_at=now()
       WHERE id=$10 AND user_id=$11 RETURNING *`,
      [b.name.trim(), b.package_name.trim(), b.version_name || '1.0', Number(b.version_code ?? 1),
       b.icon || null, b.html || '', b.css || '', b.javascript || '',
       JSON.stringify(b.settings || {}), req.params.id, req.user.id]
    );
    res.json({ project: r.rows[0] });
  } catch (e) { console.error('update project', e); res.status(500).json({ error: 'Could not save the project.' }); }
});

app.delete('/api/projects/:id', requireAuth, async (req, res) => {
  const r = await db.query('DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Project not found.' });
  res.json({ ok: true });
});

/* ────────────────────────── build queue ────────────────────────── */
const queue = [];
let working = false;

app.post('/api/projects/:id/build', requireAuth, async (req, res) => {
  try {
    const pr = await db.query('SELECT * FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    const project = pr.rows[0];
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const err = validateProject({ ...project, settings: project.settings || {} });
    if (err) return res.status(400).json({ error: err });

    const active = await db.query(
      `SELECT id FROM builds WHERE project_id = $1 AND status IN ('queued','running')`, [project.id]);
    if (active.rows.length) return res.status(409).json({ error: 'A build for this app is already in progress.' });

    const r = await db.query(
      `INSERT INTO builds (project_id, user_id, status) VALUES ($1,$2,'queued') RETURNING *`, [project.id, req.user.id]);
    queue.push(r.rows[0].id);
    pump();
    res.json({ build: r.rows[0] });
  } catch (e) { console.error('build start', e); res.status(500).json({ error: 'Could not start the build.' }); }
});

app.get('/api/builds/:id', requireAuth, async (req, res) => {
  const r = await db.query(
    `SELECT b.*, p.name AS app_name, p.package_name, p.version_name, p.icon
     FROM builds b JOIN projects p ON p.id = b.project_id
     WHERE b.id = $1 AND b.user_id = $2`, [req.params.id, req.user.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Build not found.' });
  res.json({ build: r.rows[0] });
});

app.get('/api/builds/:id/apk', requireAuth, async (req, res) => {
  const r = await db.query(
    `SELECT b.*, p.package_name, p.version_name FROM builds b JOIN projects p ON p.id = b.project_id
     WHERE b.id = $1 AND b.user_id = $2`, [req.params.id, req.user.id]);
  const build = r.rows[0];
  if (!build) return res.status(404).json({ error: 'Build not found.' });
  if (build.status !== 'success' || !build.apk_path || !fs.existsSync(build.apk_path))
    return res.status(404).json({ error: 'This APK is no longer available. Builds are kept for a limited time — rebuild to get a fresh APK.' });
  const safeName = `${build.package_name}-${build.version_name}.apk`;
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  fs.createReadStream(build.apk_path).pipe(res);
});

app.get('/api/projects/:id/builds', requireAuth, async (req, res) => {
  const r = await db.query(
    `SELECT id, status, file_size, error_message, created_at, completed_at
     FROM builds WHERE project_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 10`,
    [req.params.id, req.user.id]);
  res.json({ builds: r.rows });
});

/* the worker: one build at a time, isolated temp dir, hard timeout */
function pump() {
  if (working || queue.length === 0) return;
  working = true;
  const buildId = queue.shift();
  runBuild(buildId).catch(e => console.error('worker crash', e)).finally(() => { working = false; pump(); });
}

function sh(cmd, args, opts) {
  return new Promise(resolve => {
    execFile(cmd, args, opts, (err, stdout, stderr) => resolve({ err, stdout, stderr }));
  });
}

async function runBuild(buildId) {
  const workDir = path.join(BUILD_TMP, buildId);
  try {
    const br = await db.query(
      `SELECT b.*, p.* FROM builds b JOIN projects p ON p.id = b.project_id WHERE b.id = $1`, [buildId]);
    const build = br.rows[0];
    if (!build) return;

    await db.query(`UPDATE builds SET status='running' WHERE id=$1`, [buildId]);
    fs.mkdirSync(path.join(workDir, 'user'), { recursive: true });
    fs.mkdirSync(STORAGE_DIR, { recursive: true });

    const s = build.settings || {};
    const proj = {
      name: build.name,
      package: build.package_name,
      versionName: build.version_name,
      versionCode: build.version_code,
      orientation: s.orientation || 'portrait',
      fullscreen: !!s.fullscreen,
      statusBar: s.status_bar !== false,
      navBar: s.nav_bar !== false,
      internet: s.internet !== false,
      iconPath: ''
    };

    // icon: decode stored data-url, sanitize to 512px PNG
    if (build.icon && build.icon.startsWith('data:image/')) {
      const b64 = build.icon.split(',')[1];
      if (b64 && b64.length < 4_000_000) {
        const raw = path.join(workDir, 'icon-raw');
        fs.writeFileSync(raw, Buffer.from(b64, 'base64'));
        const out = path.join(workDir, 'icon.png');
        const conv = await sh('convert', [raw, '-resize', '512x512', '-background', 'none', '-gravity', 'center', '-extent', '512x512', 'PNG32:' + out], { timeout: 20000 });
        if (!conv.err && fs.existsSync(out)) proj.iconPath = out;
      }
    }

    fs.writeFileSync(path.join(workDir, 'project.json'), JSON.stringify(proj));
    fs.writeFileSync(path.join(workDir, 'user', 'index.html'), build.html || '');
    if ((build.css || '').trim()) fs.writeFileSync(path.join(workDir, 'user', 'style.css'), build.css);
    if ((build.javascript || '').trim()) fs.writeFileSync(path.join(workDir, 'user', 'script.js'), build.javascript);

    const result = await sh('bash', [BUILD_SCRIPT, workDir], {
      timeout: 180000, // hard 3-minute limit
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, EVITECH_TEMPLATES: TEMPLATES }
    });

    const apk = path.join(workDir, 'app.apk');
    if (result.err && !fs.existsSync(apk)) {
      const raw = ((result.stderr || '') + (result.stdout || '')).trim();
      const msg = raw.includes('BUILD_ERROR:') ? raw.split('BUILD_ERROR:')[1].split('\n')[0].trim() : 'The build could not complete. Please try again.';
      throw new Error(msg);
    }
    if (!fs.existsSync(apk)) throw new Error('The build produced no APK. Please try again.');

    const dest = path.join(STORAGE_DIR, `${buildId}.apk`);
    fs.copyFileSync(apk, dest);
    const size = fs.statSync(dest).size;
    await db.query(`UPDATE builds SET status='success', apk_path=$2, file_size=$3, completed_at=now() WHERE id=$1`,
      [buildId, dest, size]);
  } catch (e) {
    const friendly = (e.message || '').includes('ETIMEOUT')
      ? 'The build took too long and was stopped. Please try again.'
      : e.message || 'The build failed unexpectedly.';
    console.error(`build ${buildId} failed:`, friendly);
    await db.query(`UPDATE builds SET status='failed', error_message=$2, completed_at=now() WHERE id=$1`,
      [buildId, friendly.slice(0, 500)]).catch(() => {});
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}

/* cleanup: remove APKs older than 24h, run on boot and hourly */
async function cleanupOld() {
  try {
    const r = await db.query(`SELECT id, apk_path FROM builds WHERE status='success' AND completed_at < now() - interval '24 hours'`);
    for (const b of r.rows) {
      try { fs.rmSync(b.apk_path, { force: true }); } catch {}
      await db.query(`UPDATE builds SET apk_path=NULL, status='expired' WHERE id=$1`, [b.id]);
    }
  } catch (e) { console.error('cleanup', e); }
}
setInterval(cleanupOld, 60 * 60 * 1000).unref();

/* ────────────────────────── admin ────────────────────────── */
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const [users, projects, builds, okBuilds, failedBuilds, queued] = await Promise.all([
    db.query('SELECT count(*)::int n FROM users'),
    db.query('SELECT count(*)::int n FROM projects'),
    db.query('SELECT count(*)::int n FROM builds'),
    db.query(`SELECT count(*)::int n FROM builds WHERE status='success'`),
    db.query(`SELECT count(*)::int n FROM builds WHERE status='failed'`),
    db.query(`SELECT count(*)::int n FROM builds WHERE status IN ('queued','running')`),
  ]);
  const storage = fs.existsSync(STORAGE_DIR)
    ? fs.readdirSync(STORAGE_DIR).reduce((a, f) => a + (fs.statSync(path.join(STORAGE_DIR, f)).size || 0), 0)
    : 0;
  res.json({
    total_users: users.rows[0].n, total_projects: projects.rows[0].n, total_builds: builds.rows[0].n,
    successful_builds: okBuilds.rows[0].n, failed_builds: failedBuilds.rows[0].n,
    queue_length: queued.rows[0].n + queue.length, storage_bytes: storage
  });
});
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const r = await db.query(`SELECT id, email, is_admin, disabled, created_at,
    (SELECT count(*)::int FROM projects p WHERE p.user_id = users.id) AS project_count FROM users ORDER BY created_at DESC`);
  res.json({ users: r.rows });
});
app.post('/api/admin/users/:id/disable', requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot disable your own account.' });
  const r = await db.query('UPDATE users SET disabled = NOT disabled WHERE id=$1 RETURNING disabled', [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'User not found.' });
  await db.query('DELETE FROM sessions WHERE user_id=$1', [req.params.id]);
  res.json({ disabled: r.rows[0].disabled });
});
app.get('/api/admin/projects', requireAdmin, async (req, res) => {
  const r = await db.query(`SELECT p.id, p.name, p.package_name, p.version_name, p.created_at, u.email AS owner
    FROM projects p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 100`);
  res.json({ projects: r.rows });
});
app.delete('/api/admin/projects/:id', requireAdmin, async (req, res) => {
  const r = await db.query('DELETE FROM projects WHERE id=$1 RETURNING id', [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Project not found.' });
  res.json({ ok: true });
});
app.get('/api/admin/builds', requireAdmin, async (req, res) => {
  const r = await db.query(`SELECT b.id, b.status, b.error_message, b.file_size, b.created_at, b.completed_at,
    p.name AS app_name, u.email AS owner FROM builds b
    JOIN projects p ON p.id = b.project_id JOIN users u ON u.id = b.user_id
    ORDER BY b.created_at DESC LIMIT 100`);
  res.json({ builds: r.rows });
});

/* ────────────────────────── static frontend ────────────────────────── */
app.get('/health', (req, res) => res.json({ ok: true, service: 'evitech' }));
app.use(express.static(PUBLIC_DIR));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

/* ────────────────────────── boot ────────────────────────── */
initDb().then(() => { cleanupOld(); pump(); console.log('[evitech] db ready, build worker armed'); })
  .catch(e => { console.error('[evitech] db init failed:', e.message); process.exit(1); });

app.listen(PORT, '0.0.0.0', () => console.log(`[evitech] listening on :${PORT}`));
