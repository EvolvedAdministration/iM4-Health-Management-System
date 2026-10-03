// iM4 Health Management System (Smart Hub) - v2
// Full-replacement server. Roles: admin + steward (mutually exclusive).
// Password auth (bcrypt) + JWT sessions. Password resets via Resend.
// GitHub kanban mirror: board cards -> companies + implementations,
// issue comments <-> project messages, Claude summaries Sun-Thu nights.

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ---------------------------------------------------------------- config
const JWT_SECRET = process.env.JWT_SECRET || '';
const SYNC_SECRET = process.env.SYNC_SECRET || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_ORG = process.env.GITHUB_ORG || 'im4health-implementation';
const GITHUB_PROJECT = parseInt(process.env.GITHUB_PROJECT || '3', 10);
const GITHUB_REPO = process.env.GITHUB_REPO || 'im4health-implementation/Implementation';
const GITHUB_POST_AS = process.env.GITHUB_POST_AS || 'FTJ Solutions';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'no-reply@iam4.health';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const APP_URL = process.env.APP_URL || '';

// ---------------------------------------------------------------- database
let pool = null;
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

// Every schema change goes through ADD COLUMN IF NOT EXISTS so deploys
// never break against the live database.
async function migrate() {
  const db = getPool();
  await db.query('CREATE TABLE IF NOT EXISTS companies (' +
    'id SERIAL PRIMARY KEY, ' +
    'company_code TEXT UNIQUE NOT NULL, ' +
    'company_name TEXT NOT NULL, ' +
    'created_at TIMESTAMPTZ DEFAULT NOW())');
  await db.query('CREATE TABLE IF NOT EXISTS stewards (' +
    'id SERIAL PRIMARY KEY, ' +
    'email TEXT UNIQUE NOT NULL, ' +
    'name TEXT, ' +
    'created_at TIMESTAMPTZ DEFAULT NOW())');
  await db.query('CREATE TABLE IF NOT EXISTS assignments (' +
    'id SERIAL PRIMARY KEY, ' +
    'steward_id INT REFERENCES stewards(id) ON DELETE CASCADE, ' +
    'company_id INT REFERENCES companies(id) ON DELETE CASCADE, ' +
    'UNIQUE(steward_id, company_id))');
  await db.query('CREATE TABLE IF NOT EXISTS implementations (' +
    'id SERIAL PRIMARY KEY, ' +
    'company_id INT REFERENCES companies(id) ON DELETE CASCADE, ' +
    'stage TEXT, ' +
    'status TEXT, ' +
    'created_at TIMESTAMPTZ DEFAULT NOW(), ' +
    'updated_at TIMESTAMPTZ DEFAULT NOW())');
  await db.query('CREATE TABLE IF NOT EXISTS messages (' +
    'id SERIAL PRIMARY KEY, ' +
    'implementation_id INT REFERENCES implementations(id) ON DELETE CASCADE, ' +
    'github_comment_id BIGINT UNIQUE, ' +
    'author_name TEXT, ' +
    'author_login TEXT, ' +
    'body TEXT NOT NULL, ' +
    'direction TEXT NOT NULL DEFAULT ' + "'in', " +
    'steward_id INT REFERENCES stewards(id) ON DELETE SET NULL, ' +
    'github_created_at TIMESTAMPTZ, ' +
    'created_at TIMESTAMPTZ DEFAULT NOW())');
  await db.query('CREATE TABLE IF NOT EXISTS implementation_summaries (' +
    'id SERIAL PRIMARY KEY, ' +
    'implementation_id INT REFERENCES implementations(id) ON DELETE CASCADE, ' +
    'summary_date DATE NOT NULL, ' +
    'body TEXT NOT NULL, ' +
    'created_at TIMESTAMPTZ DEFAULT NOW(), ' +
    'UNIQUE(implementation_id, summary_date))');

  const cols = [
    ['stewards', 'role', "TEXT NOT NULL DEFAULT 'steward'"],
    ['stewards', 'password_hash', 'TEXT'],
    ['stewards', 'reset_token', 'TEXT'],
    ['stewards', 'reset_expires', 'TIMESTAMPTZ'],
    ['stewards', 'created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
    ['companies', 'created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
    ['companies', 'github_issue_number', 'INT'],
    ['companies', 'payroll_total', 'INT'],
    ['companies', 'payroll_ineligible', 'INT'],
    ['companies', 'payroll_opted_out', 'INT'],
    ['companies', 'payroll_enrolled', 'INT'],
    ['companies', 'payroll_not_enrolled', 'INT'],
    ['companies', 'payroll_new_qualified', 'INT'],
    ['companies', 'payroll_dataset_date', 'DATE'],
    ['implementations', 'github_item_id', 'TEXT UNIQUE'],
    ['implementations', 'created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
    ['implementations', 'updated_at', 'TIMESTAMPTZ DEFAULT NOW()'],
    ['implementations', 'github_issue_number', 'INT'],
    ['implementations', 'github_repo', 'TEXT'],
    ['implementations', 'card_title', 'TEXT'],
    ['implementations', 'payroll_provider', 'TEXT'],
    ['implementations', 'payroll_frequency', 'TEXT'],
    ['implementations', 'notes', 'TEXT']
  ];
  for (const [table, col, def] of cols) {
    await db.query('ALTER TABLE ' + table + ' ADD COLUMN IF NOT EXISTS ' + col + ' ' + def);
  }
  await db.query("UPDATE stewards SET role = 'steward' WHERE role IS NULL OR role = ''");
}

// First admin bootstrap: creates ADMIN_EMAIL as an admin on first run, or
// fills in a missing password. Never overwrites an existing password hash.
async function bootstrapAdmin() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
  const db = getPool();
  const found = await db.query('SELECT id, password_hash FROM stewards WHERE LOWER(email) = LOWER($1) LIMIT 1', [ADMIN_EMAIL]);
  if (found.rows.length === 0) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await db.query("INSERT INTO stewards (email, name, role, password_hash) VALUES ($1, $2, 'admin', $3)",
      [ADMIN_EMAIL, 'Administrator', hash]);
    console.log('Bootstrapped admin account: ' + ADMIN_EMAIL);
  } else if (!found.rows[0].password_hash) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await db.query("UPDATE stewards SET role = 'admin', password_hash = $1 WHERE id = $2", [hash, found.rows[0].id]);
    console.log('Set admin password for: ' + ADMIN_EMAIL);
  }
}

// ---------------------------------------------------------------- auth
function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
}

async function requireAuth(req, res, next) {
  try {
    if (!JWT_SECRET) return res.status(500).json({ error: 'Server auth is not configured' });
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not signed in' });
    const payload = jwt.verify(token, JWT_SECRET);
    const r = await getPool().query('SELECT id, email, name, role FROM stewards WHERE id = $1 LIMIT 1', [payload.id]);
    if (r.rows.length === 0) return res.status(401).json({ error: 'Account no longer exists' });
    req.user = r.rows[0];
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired, please sign in again' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, function () {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}

function checkSyncSecret(req, res) {
  if (!SYNC_SECRET || req.headers['x-sync-secret'] !== SYNC_SECRET) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

// ---------------------------------------------------------------- public
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (!JWT_SECRET) return res.status(500).json({ error: 'Server auth is not configured (JWT_SECRET)' });
    const r = await getPool().query('SELECT * FROM stewards WHERE LOWER(email) = LOWER($1) LIMIT 1', [String(email).trim()]);
    if (r.rows.length === 0 || !r.rows[0].password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const ok = await bcrypt.compare(String(password), r.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
    res.json({ success: true, token: signToken(r.rows[0]), user: publicUser(r.rows[0]) });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function baseUrl(req) {
  if (APP_URL) return APP_URL.replace(/[/]+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  return proto + '://' + req.get('host');
}

app.post('/api/auth/forgot', async (req, res) => {
  try {
    const { email } = req.body || {};
    // Always respond the same way so accounts cannot be enumerated.
    const done = () => res.json({ success: true, message: 'If that email has an account, a reset link is on its way.' });
    if (!email) return done();
    const r = await getPool().query('SELECT id, email FROM stewards WHERE LOWER(email) = LOWER($1) LIMIT 1', [String(email).trim()]);
    if (r.rows.length === 0) return done();
    if (!RESEND_API_KEY) {
      console.error('Password reset requested but RESEND_API_KEY is not set');
      return done();
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await getPool().query('UPDATE stewards SET reset_token = $1, reset_expires = $2 WHERE id = $3', [token, expires.toISOString(), r.rows[0].id]);
    const link = baseUrl(req) + '/#reset?token=' + token;
    const resend = new Resend(RESEND_API_KEY);
    await resend.emails.send({
      from: EMAIL_FROM,
      to: r.rows[0].email,
      subject: 'Reset your iM4 Health password',
      html: '<p>Someone requested a password reset for your iM4 Health account.</p>' +
        '<p><a href="' + link + '">Set a new password</a></p>' +
        '<p>This link expires in one hour. If you did not request this, you can ignore it.</p>'
    });
    return done();
  } catch (error) {
    console.error('Forgot-password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/reset', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password || String(password).length < 8) {
      return res.status(400).json({ error: 'A valid token and a password of at least 8 characters are required' });
    }
    const r = await getPool().query(
      'SELECT id FROM stewards WHERE reset_token = $1 AND reset_expires > NOW() LIMIT 1', [String(token)]);
    if (r.rows.length === 0) return res.status(400).json({ error: 'This reset link is invalid or has expired' });
    const hash = await bcrypt.hash(String(password), 10);
    await getPool().query('UPDATE stewards SET password_hash = $1, reset_token = NULL, reset_expires = NULL WHERE id = $2',
      [hash, r.rows[0].id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Reset error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

// ---------------------------------------------------------------- github
function ghHeaders() {
  return {
    'Authorization': 'Bearer ' + GITHUB_TOKEN,
    'Content-Type': 'application/json',
    'User-Agent': 'im4-sync'
  };
}

async function fetchProjectItems() {
  const query = 'query($after: String) { organization(login: "' + GITHUB_ORG + '") { projectV2(number: ' + GITHUB_PROJECT + ') { items(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { id content { __typename ... on DraftIssue { title } ... on Issue { title number repository { nameWithOwner } } ... on PullRequest { title } } fieldValues(first: 25) { nodes { __typename ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { name } } } ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2Field { name } } } } } } } } } } }';
  const all = [];
  let after = null;
  for (;;) {
    const resp = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: ghHeaders(),
      body: JSON.stringify({ query: query, variables: { after: after } })
    });
    if (!resp.ok) throw new Error('GitHub API returned ' + resp.status);
    const data = await resp.json();
    if (data.errors) throw new Error('GitHub API: ' + data.errors[0].message);
    const items = data.data.organization.projectV2.items;
    for (const n of items.nodes) all.push(n);
    if (!items.pageInfo.hasNextPage) break;
    after = items.pageInfo.endCursor;
  }
  return all;
}

function slugify(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return s || 'company';
}

async function fetchIssueComments(repo, issueNumber) {
  const comments = [];
  let page = 1;
  for (;;) {
    const resp = await fetch('https://api.github.com/repos/' + repo + '/issues/' + issueNumber + '/comments?per_page=100&page=' + page, { headers: ghHeaders() });
    if (!resp.ok) throw new Error('GitHub comments API returned ' + resp.status);
    const batch = await resp.json();
    for (const c of batch) comments.push(c);
    if (batch.length < 100) break;
    page++;
  }
  return comments;
}

async function postIssueComment(repo, issueNumber, body) {
  const resp = await fetch('https://api.github.com/repos/' + repo + '/issues/' + issueNumber + '/comments', {
    method: 'POST',
    headers: ghHeaders(),
    body: JSON.stringify({ body: body })
  });
  if (!resp.ok) throw new Error('GitHub comment post returned ' + resp.status);
  return resp.json();
}

// Companies visible to the caller: stewards see only assigned companies.
async function visibleCompanyIds(user) {
  if (user.role === 'admin') return null;
  const r = await getPool().query('SELECT company_id FROM assignments WHERE steward_id = $1', [user.id]);
  return r.rows.map(x => x.company_id);
}

function numericCodeSort() {
  return "ORDER BY CASE WHEN company_code ~ '^[0-9]+$' THEN 0 ELSE 1 END, " +
    "CASE WHEN company_code ~ '^[0-9]+$' THEN company_code::int END NULLS LAST, company_code";
}

// ---------------------------------------------------------------- steward: clients
app.get('/api/clients', requireAuth, async (req, res) => {
  try {
    const ids = await visibleCompanyIds(req.user);
    let where = '';
    const params = [];
    if (ids) {
      if (ids.length === 0) return res.json([]);
      where = 'WHERE c.id = ANY($1)';
      params.push(ids);
    }
    const r = await getPool().query(
      'SELECT c.*, i.stage, i.status, i.id AS implementation_id, ' +
      '(SELECT COUNT(*)::int FROM assignments a WHERE a.company_id = c.id) AS steward_count, ' +
      '(SELECT COUNT(*)::int FROM implementations x WHERE x.company_id = c.id) AS implementation_count ' +
      'FROM companies c LEFT JOIN LATERAL ' +
      '(SELECT * FROM implementations WHERE company_id = c.id ORDER BY updated_at DESC LIMIT 1) i ON true ' +
      where + ' ' + numericCodeSort(), params);
    res.json(r.rows);
  } catch (error) {
    console.error('Load clients error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/clients/:id', requireAuth, async (req, res) => {
  try {
    const ids = await visibleCompanyIds(req.user);
    if (ids && ids.indexOf(parseInt(req.params.id, 10)) === -1) {
      return res.status(403).json({ error: 'Not assigned to this client' });
    }
    const c = await getPool().query('SELECT * FROM companies WHERE id = $1', [req.params.id]);
    if (c.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    const impls = await getPool().query(
      'SELECT i.*, (SELECT COUNT(*)::int FROM messages m WHERE m.implementation_id = i.id) AS message_count ' +
      'FROM implementations i WHERE i.company_id = $1 ORDER BY i.id', [req.params.id]);
    const stewards = await getPool().query(
      'SELECT s.id, s.name, s.email FROM stewards s JOIN assignments a ON a.steward_id = s.id WHERE a.company_id = $1 ORDER BY s.name',
      [req.params.id]);
    res.json({ company: c.rows[0], implementations: impls.rows, stewards: stewards.rows });
  } catch (error) {
    console.error('Load client error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------- steward: implementations
app.get('/api/implementations', requireAuth, async (req, res) => {
  try {
    const ids = await visibleCompanyIds(req.user);
    let where = '';
    const params = [];
    if (ids) {
      if (ids.length === 0) return res.json([]);
      where = 'WHERE i.company_id = ANY($1)';
      params.push(ids);
    }
    const r = await getPool().query(
      'SELECT i.*, c.company_code, c.company_name, ' +
      'EXTRACT(DAY FROM (NOW() - i.updated_at))::int AS days_in_stage, ' +
      '(SELECT body FROM implementation_summaries s WHERE s.implementation_id = i.id ORDER BY s.summary_date DESC LIMIT 1) AS latest_summary ' +
      'FROM implementations i JOIN companies c ON c.id = i.company_id ' +
      where + ' ORDER BY i.status, c.company_name', params);
    res.json(r.rows);
  } catch (error) {
    console.error('Load implementations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/implementations/:id', requireAuth, async (req, res) => {
  try {
    const ids = await visibleCompanyIds(req.user);
    const r = await getPool().query(
      'SELECT i.*, c.company_code, c.company_name, c.payroll_total, c.payroll_ineligible, c.payroll_opted_out, ' +
      'c.payroll_enrolled, c.payroll_not_enrolled, c.payroll_new_qualified, c.payroll_dataset_date, ' +
      'EXTRACT(DAY FROM (NOW() - i.updated_at))::int AS days_in_stage ' +
      'FROM implementations i JOIN companies c ON c.id = i.company_id WHERE i.id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (ids && ids.indexOf(r.rows[0].company_id) === -1) {
      return res.status(403).json({ error: 'Not assigned to this client' });
    }
    const msgs = await getPool().query(
      'SELECT m.*, s.name AS steward_name FROM messages m LEFT JOIN stewards s ON s.id = m.steward_id ' +
      'WHERE m.implementation_id = $1 ORDER BY COALESCE(m.github_created_at, m.created_at)',
      [req.params.id]);
    const sums = await getPool().query(
      'SELECT summary_date, body, created_at FROM implementation_summaries WHERE implementation_id = $1 ORDER BY summary_date DESC LIMIT 5',
      [req.params.id]);
    res.json({ implementation: r.rows[0], messages: msgs.rows, summaries: sums.rows });
  } catch (error) {
    console.error('Load project error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Steward posts a message: goes to the GitHub issue card AND into the app.
app.post('/api/implementations/:id/messages', requireAuth, async (req, res) => {
  try {
    const { body } = req.body || {};
    if (!body || !String(body).trim()) return res.status(400).json({ error: 'Message text is required' });
    const r = await getPool().query('SELECT * FROM implementations WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const impl = r.rows[0];
    const ids = await visibleCompanyIds(req.user);
    if (ids && ids.indexOf(impl.company_id) === -1) {
      return res.status(403).json({ error: 'Not assigned to this client' });
    }
    const stewardName = req.user.name || req.user.email;
    const ghBody = ['**' + stewardName + '** (via ' + GITHUB_POST_AS + ')', '', String(body).trim()].join(String.fromCharCode(10, 10));
    let ghComment = null;
    if (GITHUB_TOKEN && impl.github_repo && impl.github_issue_number) {
      ghComment = await postIssueComment(impl.github_repo, impl.github_issue_number, ghBody);
    }
    const m = await getPool().query(
      'INSERT INTO messages (implementation_id, github_comment_id, author_name, author_login, body, direction, steward_id, github_created_at) ' +
      'VALUES ($1, $2, $3, $4, $5, ' + "'out'" + ', $6, NOW()) RETURNING *',
      [impl.id, ghComment ? ghComment.id : null, stewardName, GITHUB_POST_AS, String(body).trim(), req.user.id]);
    res.status(201).json({ success: true, message: m.rows[0], posted_to_github: !!ghComment });
  } catch (error) {
    console.error('Post message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------- admin: stewards
app.get('/api/admin/stewards', requireAdmin, async (req, res) => {
  try {
    const r = await getPool().query(
      "SELECT id, email, name, role, created_at FROM stewards ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, name");
    res.json(r.rows);
  } catch (error) {
    console.error('Admin stewards error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/stewards', requireAdmin, async (req, res) => {
  try {
    const { email, name, password, role } = req.body || {};
    if (!email || !String(email).includes('@')) return res.status(400).json({ error: 'A valid email is required' });
    if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const rRole = role === 'admin' ? 'admin' : 'steward';
    const hash = await bcrypt.hash(String(password), 10);
    const r = await getPool().query(
      'INSERT INTO stewards (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
      [String(email).trim().toLowerCase(), name || null, rRole, hash]);
    res.status(201).json(r.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That email is already in use' });
    console.error('Admin create steward error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/admin/stewards/:id', requireAdmin, async (req, res) => {
  try {
    const { name, email, role, password } = req.body || {};
    const cur = await getPool().query('SELECT * FROM stewards WHERE id = $1', [req.params.id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (String(cur.rows[0].id) === String(req.user.id) && role && role !== 'admin') {
      return res.status(400).json({ error: 'You cannot remove your own admin role' });
    }
    const updates = [];
    const params = [];
    if (name !== undefined) { params.push(name || null); updates.push('name = $' + params.length); }
    if (email && String(email).includes('@')) { params.push(String(email).trim().toLowerCase()); updates.push('email = $' + params.length); }
    if (role === 'admin' || role === 'steward') { params.push(role); updates.push('role = $' + params.length); }
    if (password) {
      if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      params.push(await bcrypt.hash(String(password), 10));
      updates.push('password_hash = $' + params.length);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.params.id);
    const r = await getPool().query(
      'UPDATE stewards SET ' + updates.join(', ') + ' WHERE id = $' + params.length + ' RETURNING id, email, name, role',
      params);
    res.json(r.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That email is already in use' });
    console.error('Admin update steward error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/admin/stewards/:id', requireAdmin, async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user.id)) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    const linked = await getPool().query('SELECT COUNT(*)::int AS c FROM assignments WHERE steward_id = $1', [req.params.id]);
    if (linked.rows[0].c > 0) {
      return res.status(409).json({ error: 'Cannot delete: this person is assigned to ' + linked.rows[0].c + ' companie(s). Remove the assignments first.' });
    }
    const r = await getPool().query('DELETE FROM stewards WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Admin delete steward error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------- admin: companies
app.get('/api/admin/companies', requireAdmin, async (req, res) => {
  try {
    const r = await getPool().query(
      'SELECT c.*, (SELECT COUNT(*)::int FROM assignments a WHERE a.company_id = c.id) AS steward_count, ' +
      '(SELECT COUNT(*)::int FROM implementations i WHERE i.company_id = c.id) AS implementation_count ' +
      'FROM companies c ' + numericCodeSort());
    res.json(r.rows);
  } catch (error) {
    console.error('Admin companies error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/companies', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.company_code || !b.company_name) return res.status(400).json({ error: 'company_code and company_name are required' });
    const r = await getPool().query(
      'INSERT INTO companies (company_code, company_name, payroll_total, payroll_ineligible, payroll_opted_out, payroll_enrolled, payroll_not_enrolled, payroll_new_qualified, payroll_dataset_date) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [String(b.company_code).trim(), String(b.company_name).trim(), num(b.payroll_total), num(b.payroll_ineligible),
        num(b.payroll_opted_out), num(b.payroll_enrolled), num(b.payroll_not_enrolled), num(b.payroll_new_qualified),
        b.payroll_dataset_date || null]);
    res.status(201).json(r.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That company code is already in use' });
    console.error('Admin create company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

app.put('/api/admin/companies/:id', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const r = await getPool().query(
      'UPDATE companies SET company_code = COALESCE($1, company_code), company_name = COALESCE($2, company_name), ' +
      'payroll_total = $3, payroll_ineligible = $4, payroll_opted_out = $5, payroll_enrolled = $6, ' +
      'payroll_not_enrolled = $7, payroll_new_qualified = $8, payroll_dataset_date = $9 WHERE id = $10 RETURNING *',
      [b.company_code ? String(b.company_code).trim() : null, b.company_name ? String(b.company_name).trim() : null,
        num(b.payroll_total), num(b.payroll_ineligible), num(b.payroll_opted_out), num(b.payroll_enrolled),
        num(b.payroll_not_enrolled), num(b.payroll_new_qualified), b.payroll_dataset_date || null, req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That company code is already in use' });
    console.error('Admin update company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/admin/companies/:id', requireAdmin, async (req, res) => {
  try {
    const a = await getPool().query('SELECT COUNT(*)::int AS c FROM assignments WHERE company_id = $1', [req.params.id]);
    const i = await getPool().query('SELECT COUNT(*)::int AS c FROM implementations WHERE company_id = $1', [req.params.id]);
    if (a.rows[0].c > 0 || i.rows[0].c > 0) {
      return res.status(409).json({ error: 'Cannot delete: this company has linked assignments/implementations. Remove them first.' });
    }
    const r = await getPool().query('DELETE FROM companies WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Admin delete company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------- admin: assignments
app.get('/api/admin/assignments', requireAdmin, async (req, res) => {
  try {
    const r = await getPool().query(
      'SELECT a.id, a.steward_id, a.company_id, s.email AS steward_email, s.name AS steward_name, ' +
      'c.company_code, c.company_name FROM assignments a ' +
      'JOIN stewards s ON s.id = a.steward_id JOIN companies c ON c.id = a.company_id ' +
      'ORDER BY c.company_name, s.email');
    res.json(r.rows);
  } catch (error) {
    console.error('Admin assignments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/assignments', requireAdmin, async (req, res) => {
  try {
    const { steward_id, company_id } = req.body || {};
    if (!steward_id || !company_id) return res.status(400).json({ error: 'steward_id and company_id are required' });
    const r = await getPool().query(
      'INSERT INTO assignments (steward_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
      [steward_id, company_id]);
    res.status(201).json(r.rows[0] || { success: true, note: 'already assigned' });
  } catch (error) {
    console.error('Admin create assignment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/admin/assignments/:id', requireAdmin, async (req, res) => {
  try {
    await getPool().query('DELETE FROM assignments WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin delete assignment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------- admin: imports (two-step)
function validateImport(type, rows) {
  const errors = [];
  const valid = [];
  const seen = {};
  rows.forEach(function (row, idx) {
    const line = idx + 2;
    const e = function (msg) { errors.push('Row ' + line + ': ' + msg); };
    if (type === 'stewards') {
      if (!row.email || !String(row.email).includes('@')) { e('email is required'); return; }
      const key = String(row.email).trim().toLowerCase();
      if (seen[key]) { e('duplicate email in file'); return; }
      seen[key] = true;
      valid.push({ email: key, name: row.name || null });
    } else if (type === 'companies') {
      if (!row.company_code) { e('company_code is required'); return; }
      if (!row.company_name) { e('company_name is required'); return; }
      const key = String(row.company_code).trim();
      if (seen[key]) { e('duplicate company_code in file'); return; }
      seen[key] = true;
      valid.push({
        company_code: key, company_name: String(row.company_name).trim(),
        payroll_total: num(row.payroll_total), payroll_ineligible: num(row.payroll_ineligible),
        payroll_opted_out: num(row.payroll_opted_out), payroll_enrolled: num(row.payroll_enrolled),
        payroll_not_enrolled: num(row.payroll_not_enrolled), payroll_new_qualified: num(row.payroll_new_qualified),
        payroll_dataset_date: row.payroll_dataset_date || null
      });
    } else if (type === 'assignments') {
      if (!row.steward_email || !row.company_code) { e('steward_email and company_code are required'); return; }
      const key = String(row.steward_email).trim().toLowerCase() + '|' + String(row.company_code).trim();
      if (seen[key]) { e('duplicate assignment in file'); return; }
      seen[key] = true;
      valid.push({ steward_email: String(row.steward_email).trim().toLowerCase(), company_code: String(row.company_code).trim() });
    } else {
      e('unknown import type');
    }
  });
  return { valid: valid, errors: errors };
}

app.post('/api/admin/import', requireAdmin, async (req, res) => {
  try {
    const { type, rows, dry_run } = req.body || {};
    if (['stewards', 'companies', 'assignments'].indexOf(type) === -1) {
      return res.status(400).json({ error: "type must be stewards, companies, or assignments" });
    }
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'rows array is required' });
    const v = validateImport(type, rows);
    if (dry_run !== false) {
      return res.json({ success: true, dry_run: true, valid_count: v.valid.length, errors: v.errors, preview: v.valid.slice(0, 10) });
    }
    const db = getPool();
    let imported = 0;
    const commitErrors = v.errors.slice();
    if (type === 'stewards') {
      for (const s of v.valid) {
        try {
          await db.query("INSERT INTO stewards (email, name, role) VALUES ($1, $2, 'steward') ON CONFLICT (email) DO NOTHING", [s.email, s.name]);
          imported++;
        } catch (e) { commitErrors.push(s.email + ': ' + e.message); }
      }
    } else if (type === 'companies') {
      for (const c of v.valid) {
        try {
          await db.query('INSERT INTO companies (company_code, company_name, payroll_total, payroll_ineligible, payroll_opted_out, payroll_enrolled, payroll_not_enrolled, payroll_new_qualified, payroll_dataset_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (company_code) DO UPDATE SET company_name = EXCLUDED.company_name, payroll_total = EXCLUDED.payroll_total, payroll_ineligible = EXCLUDED.payroll_ineligible, payroll_opted_out = EXCLUDED.payroll_opted_out, payroll_enrolled = EXCLUDED.payroll_enrolled, payroll_not_enrolled = EXCLUDED.payroll_not_enrolled, payroll_new_qualified = EXCLUDED.payroll_new_qualified, payroll_dataset_date = EXCLUDED.payroll_dataset_date',
            [c.company_code, c.company_name, c.payroll_total, c.payroll_ineligible, c.payroll_opted_out, c.payroll_enrolled, c.payroll_not_enrolled, c.payroll_new_qualified, c.payroll_dataset_date]);
          imported++;
        } catch (e) { commitErrors.push(c.company_code + ': ' + e.message); }
      }
    } else {
      const sMap = {};
      const cMap = {};
      (await db.query('SELECT id, LOWER(email) AS email FROM stewards')).rows.forEach(x => { sMap[x.email] = x.id; });
      (await db.query('SELECT id, company_code FROM companies')).rows.forEach(x => { cMap[x.company_code] = x.id; });
      for (const a of v.valid) {
        const sid = sMap[a.steward_email];
        const cid = cMap[a.company_code];
        if (!sid) { commitErrors.push(a.steward_email + ': steward not found'); continue; }
        if (!cid) { commitErrors.push(a.company_code + ': company not found'); continue; }
        await db.query('INSERT INTO assignments (steward_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [sid, cid]);
        imported++;
      }
    }
    res.json({ success: true, dry_run: false, imported: imported, errors: commitErrors });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------- github mirror sync
// Board cards -> companies + implementations. Hold/Dead skipped.
// Then pulls each linked issue's comments into messages.
// Protected by x-sync-secret. Keeps the 6-hour cron contract:
// { success, synced, skipped_hold_dead, companies }.
app.post('/api/admin/sync-github', async (req, res) => {
  if (!checkSyncSecret(req, res)) return;
  if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN is not set' });
  try {
    const db = getPool();
    const items = await fetchProjectItems();
    let synced = 0;
    let skipped = 0;
    let commentsPulled = 0;
    const activeIds = [];
    for (const item of items) {
      const fields = {};
      for (const v of item.fieldValues.nodes) {
        if (v.__typename === 'ProjectV2ItemFieldSingleSelectValue') fields[v.field.name] = v.name;
        else if (v.__typename === 'ProjectV2ItemFieldNumberValue') fields[v.field.name] = v.number;
      }
      const status = fields['Status'] || '';
      if (status === 'Hold' || status === 'Dead') { skipped++; continue; }
      const fullTitle = (item.content && item.content.title) ? item.content.title : 'Untitled';
      const companyName = fullTitle.split(';')[0].trim() || 'Unnamed Company';
      // Company code: the board's "Company Code" number field wins; slug fallback.
      const boardCode = (fields['Company Code'] !== undefined && fields['Company Code'] !== null)
        ? String(Math.trunc(fields['Company Code'])) : null;
      const code = boardCode || slugify(companyName);
      // Find the company: by code first, then migrate a slug row by name match.
      let comp = await db.query('SELECT id FROM companies WHERE company_code = $1', [code]);
      if (comp.rows.length === 0 && boardCode) {
        comp = await db.query('SELECT id FROM companies WHERE LOWER(company_name) = LOWER($1)', [companyName]);
        if (comp.rows.length > 0) {
          await db.query('UPDATE companies SET company_code = $1 WHERE id = $2', [code, comp.rows[0].id]);
        }
      }
      let companyId;
      if (comp.rows.length > 0) {
        companyId = comp.rows[0].id;
        await db.query('UPDATE companies SET company_name = $1 WHERE id = $2', [companyName, companyId]);
      } else {
        const ins = await db.query('INSERT INTO companies (company_code, company_name) VALUES ($1, $2) RETURNING id', [code, companyName]);
        companyId = ins.rows[0].id;
      }
      const issueNumber = (item.content && item.content.__typename === 'Issue') ? item.content.number : null;
      const repo = (item.content && item.content.repository) ? item.content.repository.nameWithOwner : null;
      await db.query(
        'INSERT INTO implementations (company_id, stage, status, github_item_id, github_issue_number, github_repo, card_title, payroll_provider, payroll_frequency, updated_at) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) ' +
        'ON CONFLICT (github_item_id) DO UPDATE SET company_id = EXCLUDED.company_id, stage = EXCLUDED.stage, ' +
        'status = EXCLUDED.status, github_issue_number = EXCLUDED.github_issue_number, github_repo = EXCLUDED.github_repo, ' +
        'card_title = EXCLUDED.card_title, payroll_provider = EXCLUDED.payroll_provider, ' +
        'payroll_frequency = EXCLUDED.payroll_frequency, updated_at = NOW()',
        [companyId, status || 'No Status', fields['Priority'] || 'NORMAL', item.id, issueNumber, repo,
          fullTitle, fields['Payroll Provider'] || null, fields['Payroll Frequency'] || null]);
      activeIds.push(item.id);
      synced++;
      // Pull comments for this issue into messages.
      if (issueNumber && repo) {
        try {
          const impl = await db.query('SELECT id FROM implementations WHERE github_item_id = $1', [item.id]);
          const implId = impl.rows[0].id;
          const comments = await fetchIssueComments(repo, issueNumber);
          for (const c of comments) {
            const login = (c.user && c.user.login) ? c.user.login : 'github';
            await db.query(
              'INSERT INTO messages (implementation_id, github_comment_id, author_name, author_login, body, direction, github_created_at) ' +
              'VALUES ($1, $2, $3, $4, $5, ' + "'in'" + ', $6) ON CONFLICT (github_comment_id) DO NOTHING',
              [implId, c.id, login, login, c.body || '', c.created_at]);
            commentsPulled++;
          }
        } catch (ce) {
          console.error('Comment pull failed for issue ' + issueNumber + ':', ce.message);
        }
      }
    }
    if (activeIds.length > 0) {
      await db.query('DELETE FROM implementations WHERE github_item_id IS NOT NULL AND NOT (github_item_id = ANY($1))', [activeIds]);
    }
    const compCount = await db.query('SELECT COUNT(*)::int AS c FROM companies');
    res.json({ success: true, synced: synced, skipped_hold_dead: skipped, companies: compCount.rows[0].c, comments_pulled: commentsPulled });
  } catch (error) {
    console.error('GitHub sync error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------- claude summaries (Sun-Thu nights)
async function claudeSummarize(impl, company, recentMessages) {
  const nl = String.fromCharCode(10);
  const msgText = recentMessages.slice(-15).map(m => '- ' + (m.author_name || 'unknown') + ': ' + String(m.body || '').slice(0, 400)).join(nl);
  const prompt = 'You are a project manager writing a brief nightly update for the project owner. ' +
    'Project: ' + company.company_name + ' (company code ' + company.company_code + '). ' +
    'Current stage: ' + (impl.stage || 'unknown') + '. Status: ' + (impl.status || 'unknown') + '. ' +
    'Card: ' + (impl.card_title || '') + '. ' +
    'Recent messages:' + nl + (msgText || '(none)') + nl + nl +
    'Write a short update with: 1) one-paragraph summary of where the project stands, ' +
    '2) current to-dos, 3) any obstacles or roadblocks and who is working on them. ' +
    'Keep it tight and plain-spoken.';
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!resp.ok) throw new Error('Anthropic API returned ' + resp.status);
  const data = await resp.json();
  const parts = (data.content || []).filter(p => p.type === 'text').map(p => p.text);
  return parts.join(nl).trim();
}

app.post('/api/admin/run-summaries', async (req, res) => {
  if (!checkSyncSecret(req, res)) return;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' });
  try {
    const db = getPool();
    const impls = await db.query(
      'SELECT i.*, c.company_name, c.company_code FROM implementations i JOIN companies c ON c.id = i.company_id ' +
      "WHERE COALESCE(i.stage, '') <> 'Complete' ORDER BY i.id");
    const today = new Date().toISOString().slice(0, 10);
    let done = 0;
    const errors = [];
    for (const impl of impls.rows) {
      try {
        const msgs = await db.query(
          'SELECT author_name, body FROM messages WHERE implementation_id = $1 ORDER BY COALESCE(github_created_at, created_at) DESC LIMIT 15',
          [impl.id]);
        const body = await claudeSummarize(impl, impl, msgs.rows.reverse());
        await db.query(
          'INSERT INTO implementation_summaries (implementation_id, summary_date, body) VALUES ($1, $2, $3) ' +
          'ON CONFLICT (implementation_id, summary_date) DO UPDATE SET body = EXCLUDED.body',
          [impl.id, today, body]);
        done++;
      } catch (e) {
        errors.push('impl ' + impl.id + ': ' + e.message);
      }
    }
    res.json({ success: true, summarized: done, of: impls.rows.length, errors: errors });
  } catch (error) {
    console.error('Summaries error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------- static + startup
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

let started = false;
async function startup() {
  if (started) return;
  started = true;
  await migrate();
  await bootstrapAdmin();
}
startup().catch(e => console.error('Startup error:', e));

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log('iM4 Health Management System listening on port ' + port);
  });
}

module.exports = app;
