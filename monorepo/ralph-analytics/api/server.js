/**
 * @ralph/analytics-app — Express API + Static file server
 * Sprint 1: PostgreSQL/MySQL DB, User management, Password reset, SMTP email
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express    = require('express');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const helmet     = require('helmet');
const cors       = require('cors');
const axios      = require('axios');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');
const mysql      = require('mysql2/promise');
const redis      = require('redis');


const app  = express();

// ── Redis client (session caching) ─────────────────────────────────────────
let redisClient = null;
(async () => {
  try {
    const client = redis.createClient({
      username: 'amxhnzbwdx',
      password: 'BECEuUev5w',
      socket: { host: '127.0.0.1', port: 6379, reconnectStrategy: r => Math.min(r * 50, 2000) }
    });
    client.on('error', err => console.warn('[Redis] ⚠️', err.message));
    await client.connect();
    redisClient = client;
    console.log('[Redis] ✅ Connected — session caching active');
  } catch (e) {
    console.warn('[Redis] Not connected:', e.message);
  }
})();

const PORT = process.env.PORT || 3000;

const JWT_SECRET  = process.env.JWT_SECRET  || 'dev-secret-change-in-production';
const AGENT_URL   = process.env.AGENT_API_URL        || 'http://localhost:4010';
const AGENT_KEY   = process.env.AGENT_API_KEY        || '';
const ORCH_URL    = process.env.ORCHESTRATOR_API_URL  || 'http://localhost:4020';
const ORCH_KEY    = process.env.ORCHESTRATOR_API_KEY  || '';
const BASE_URL    = process.env.BASE_URL || 'https://ralph-analytics.com';


// ── Audit trail helper (Sprint 5) ────────────────────────────────────
async function auditLog(adminEmail, action, targetId, targetEmail, detail, ip) {
  try {
    if (pool) {
      await pool.execute(
        'INSERT INTO audit_log (action,actor,target,details) VALUES (?,?,?,?)',
        [action||'UNKNOWN', adminEmail||'system', targetEmail||targetId||null, detail||null]
      );
    } else {
      log('info', '[AUDIT] ' + action + ' | ' + (targetEmail||targetId||'') + ' | ' + (detail||''));
    }
  } catch(e) { log('warn', 'audit log err: ' + e.message); }
}


// ── Middleware ───────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

function log(level, msg) {
  process.stdout.write(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}\n`);
}

// ── DB — JSON file store (works without MySQL creds) ─────────
// ── Database layer — auto-switches JSON → MySQL when DB_HOST is set ──
// To migrate: set DB_HOST, DB_USER, DB_PASS, DB_NAME in .env + restart
// MySQL migration script: node scripts/migrate-to-mysql.js
let pool = null;
const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

function loadJsonDb() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch(e) {}
  return { users: [], reset_tokens: [], support_tickets: [], audit_log: [], onboarding: {} };
}

function saveJsonDb(db) {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ── Init DB ──────────────────────────────────────────────────
async function initDb() {
  if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASS) {
    try {
      pool = await mysql.createPool({
        host:     process.env.DB_HOST,
        user:     process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME || 'ralph_analytics',
        waitForConnections: true,
        connectionLimit: 10,
      });
      // Create tables
      await pool.execute(`CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        org VARCHAR(255),
        role ENUM('admin','client') DEFAULT 'client',
        client_slug VARCHAR(100),
        packages JSON,
        status ENUM('active','inactive','pending') DEFAULT 'active',
        created_at DATETIME DEFAULT NOW(),
        updated_at DATETIME DEFAULT NOW() ON UPDATE NOW()
      )`);
      await pool.execute(`CREATE TABLE IF NOT EXISTS reset_tokens (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        token VARCHAR(255) UNIQUE NOT NULL,
        expires_at DATETIME NOT NULL,
        used TINYINT DEFAULT 0,
        created_at DATETIME DEFAULT NOW()
      )`);
      await pool.execute(`CREATE TABLE IF NOT EXISTS support_tickets (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36),
        user_email VARCHAR(255),
        subject VARCHAR(255),
        message TEXT,
        status ENUM('open','in_progress','resolved','closed') DEFAULT 'open',
        priority ENUM('low','medium','high','urgent') DEFAULT 'medium',
        created_at DATETIME DEFAULT NOW(),
        updated_at DATETIME DEFAULT NOW() ON UPDATE NOW()
      )`);
      log('info', 'MySQL connected ✅');
    } catch(e) {
      log('warn', `MySQL unavailable (${e.message}) — using JSON file store`);
      pool = null;
    }
  } else {
    log('info', 'No DB_HOST set — using JSON file store (set DB_HOST/DB_USER/DB_PASS to switch to MySQL)');
  }

  // Seed admin if no users exist
  const users = await dbGetAllUsers();
  if (users.length === 0) {
    const adminHash = await bcrypt.hash('RalphAdmin2026!', 10);
    const demoHash  = await bcrypt.hash('demo', 10);
    await dbCreateUser({ id: crypto.randomUUID(), email: 'admin@ralph-analytics.com', password_hash: adminHash,
      name: 'Admin', org: 'VECTRA International', role: 'admin', client_slug: 'admin',
      packages: JSON.stringify(['*']), status: 'active' });
    await dbCreateUser({ id: crypto.randomUUID(), email: 'client@demo.com', password_hash: demoHash,
      name: 'Alex Kamau', org: 'Demo Organisation', role: 'client', client_slug: 'demo-org',
      packages: JSON.stringify(['field-audit','standards','translation','reports']), status: 'active' });
    log('info', 'Seeded 2 default users');
  }
}

// ── DB helpers — works with both MySQL and JSON store ─────────
async function dbGetUserByEmail(email) {
  if (pool) {
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    return rows[0] || null;
  }
  const db = loadJsonDb();
  return db.users.find(u => u.email === email) || null;
}

async function dbGetUserById(id) {
  if (pool) {
    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
  }
  const db = loadJsonDb();
  return db.users.find(u => u.id === id) || null;
}

async function dbGetAllUsers() {
  if (pool) {
    const [rows] = await pool.execute('SELECT * FROM users ORDER BY created_at DESC');
    return rows;
  }
  return loadJsonDb().users;
}

async function dbCreateUser(user) {
  if (pool) {
    await pool.execute(
      'INSERT INTO users (id,email,password_hash,name,org,role,client_slug,packages,status) VALUES (?,?,?,?,?,?,?,?,?)',
      [user.id, user.email, user.password_hash, user.name, user.org||'', user.role||'client',
       user.client_slug||'', user.packages||'[]', user.status||'active']
    );
    return user;
  }
  const db = loadJsonDb();
  db.users.push({ ...user, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  saveJsonDb(db);
  return user;
}

async function dbUpdateUser(id, updates) {
  if (pool) {
    const fields = Object.keys(updates).map(k => `\`${k}\` = ?`).join(', ');
    const vals   = [...Object.values(updates), id];
    await pool.execute(`UPDATE users SET ${fields} WHERE id = ?`, vals);
    return dbGetUserById(id);
  }
  const db = loadJsonDb();
  const idx = db.users.findIndex(u => u.id === id);
  if (idx === -1) return null;
  db.users[idx] = { ...db.users[idx], ...updates, updated_at: new Date().toISOString() };
  saveJsonDb(db);
  return db.users[idx];
}

async function dbDeleteUser(id) {
  if (pool) {
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
    return true;
  }
  const db = loadJsonDb();
  const idx = db.users.findIndex(u => u.id === id);
  if (idx === -1) return false;
  db.users.splice(idx, 1);
  saveJsonDb(db);
  return true;
}

// Reset token helpers
async function dbCreateResetToken(userId, token, expiresAt) {
  if (pool) {
    await pool.execute(
      'INSERT INTO reset_tokens (id,user_id,token,expires_at) VALUES (?,?,?,?)',
      [crypto.randomUUID(), userId, token, expiresAt]
    );
    return;
  }
  const db = loadJsonDb();
  if (!db.reset_tokens) db.reset_tokens = [];
  db.reset_tokens.push({ id: crypto.randomUUID(), user_id: userId, token, expires_at: expiresAt.toISOString(), used: false, created_at: new Date().toISOString() });
  saveJsonDb(db);
}

async function dbGetResetToken(token) {
  if (pool) {
    const [rows] = await pool.execute('SELECT * FROM reset_tokens WHERE token = ? AND used = 0 AND expires_at > NOW() LIMIT 1', [token]);
    return rows[0] || null;
  }
  const db = loadJsonDb();
  return (db.reset_tokens||[]).find(t => t.token === token && !t.used && new Date(t.expires_at) > new Date()) || null;
}

async function dbMarkTokenUsed(token) {
  if (pool) {
    await pool.execute('UPDATE reset_tokens SET used = 1 WHERE token = ?', [token]);
    return;
  }
  const db = loadJsonDb();
  const idx = (db.reset_tokens||[]).findIndex(t => t.token === token);
  if (idx !== -1) { db.reset_tokens[idx].used = true; saveJsonDb(db); }
}

// Support ticket helpers
async function dbCreateTicket(ticket) {
  if (pool) {
    await pool.execute(
      'INSERT INTO support_tickets (id,user_id,user_email,subject,message,status,priority) VALUES (?,?,?,?,?,?,?)',
      [ticket.id, ticket.user_id||null, ticket.user_email, ticket.subject, ticket.message, 'open', ticket.priority||'medium']
    );
    return ticket;
  }
  const db = loadJsonDb();
  if (!db.support_tickets) db.support_tickets = [];
  db.support_tickets.push({ ...ticket, status: 'open', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  saveJsonDb(db);
  return ticket;
}

async function dbGetAllTickets() {
  if (pool) {
    const [rows] = await pool.execute('SELECT * FROM support_tickets ORDER BY created_at DESC');
    return rows;
  }
  return (loadJsonDb().support_tickets||[]).reverse();
}

async function dbUpdateTicket(id, updates) {
  if (pool) {
    const fields = Object.keys(updates).map(k => `\`${k}\` = ?`).join(', ');
    await pool.execute(`UPDATE support_tickets SET ${fields} WHERE id = ?`, [...Object.values(updates), id]);
    return;
  }
  const db = loadJsonDb();
  const idx = (db.support_tickets||[]).findIndex(t => t.id === id);
  if (idx !== -1) { db.support_tickets[idx] = { ...db.support_tickets[idx], ...updates, updated_at: new Date().toISOString() }; saveJsonDb(db); }
}

// ── Email transport ──────────────────────────────────────────
let mailer = null;
function getMailer() {
  if (mailer) return mailer;
  if (process.env.SMTP_HOST) {
    mailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT||'587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  } else {
    // Fallback: log emails to console
    mailer = { sendMail: async (opts) => { log('info', `[EMAIL] To:${opts.to} | Subject:${opts.subject}`); return { messageId: 'logged' }; } };
  }
  return mailer;
}


// ── Audit trail helper ────────────────────────────────────
function writeAudit(action, actorEmail, targetEmail, details = {}) {
  try {
    const db = loadJsonDb();
    if (!db.audit_log) db.audit_log = [];
    db.audit_log.unshift({
      id: require('crypto').randomUUID(),
      timestamp: new Date().toISOString(),
      action,
      actor: actorEmail,
      target: targetEmail,
      details,
    });
    // Keep last 1000 entries
    if (db.audit_log.length > 1000) db.audit_log = db.audit_log.slice(0, 1000);
    saveJsonDb(db);
  } catch(e) { console.error('[Audit] write failed:', e.message); }
}

// ── Auth middleware ──────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch(e) { res.status(401).json({ error: 'Invalid token' }); }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
    next();
  });
}

// ── Generic proxy helper ─────────────────────────────────────
async function proxyRequest({ req, res, targetUrl, apiKey }) {
  try {
    const response = await axios({ method: req.method, url: targetUrl,
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      data: ['POST','PUT','PATCH'].includes(req.method) ? req.body : undefined,
      params: req.query, timeout: 15000 });
    res.status(response.status).json(response.data);
  } catch(err) {
    res.status(err.response?.status ?? 502).json(err.response?.data ?? { error: err.message });
  }
}

// ════════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════════

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const user = await dbGetUserByEmail(email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.status === 'inactive') return res.status(403).json({ error: 'Account inactive. Contact support.' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const packages = typeof user.packages === 'string' ? JSON.parse(user.packages||'[]') : (user.packages||[]);
    const token = jwt.sign(
      { id:user.id, email:user.email, role:user.role, name:user.name, org:user.org, slug:user.client_slug, packages },
      JWT_SECRET, { expiresIn: '8h' }
    );
    log('info', `Login: ${email} (${user.role})`);
    res.json({ token, user: { id:user.id, email:user.email, name:user.name, role:user.role, org:user.org, slug:user.client_slug, packages } });
  } catch(e) { log('error', e.message); res.status(500).json({ error: 'Server error' }); }
});

// Me
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Forgot password — send reset link
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body ?? {};
    if (!email) return res.status(400).json({ error: 'email required' });
    const user = await dbGetUserByEmail(email.toLowerCase().trim());
    // Always return 200 to prevent email enumeration
    if (!user) return res.json({ message: 'If that email exists, a reset link has been sent.' });
    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await dbCreateResetToken(user.id, token, expiresAt);
    const resetUrl = `${BASE_URL}/reset-password?token=${token}`;
    await getMailer().sendMail({
      from: `"Ralph Analytics" <${process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@ralph-analytics.com'}>`,
      to:   user.email,
      subject: 'Reset your Ralph Analytics password',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <div style="background:#E8521A;width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:900;color:#fff;font-size:16px;margin-bottom:24px;">R</div>
        <h2 style="margin:0 0 12px;color:#111;">Reset your password</h2>
        <p style="color:#555;margin:0 0 24px;">Click the button below to set a new password. This link expires in 1 hour.</p>
        <a href="${resetUrl}" style="display:inline-block;background:#E8521A;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;">Reset Password</a>
        <p style="color:#999;font-size:12px;margin-top:24px;">If you didn't request this, you can safely ignore this email.</p>
      </div>`,
    });
    log('info', `Password reset sent to ${email}`);
    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch(e) { log('error', e.message); res.status(500).json({ error: 'Server error' }); }
});

// Reset password — apply new password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body ?? {};
    if (!token || !password) return res.status(400).json({ error: 'token and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const record = await dbGetResetToken(token);
    if (!record) return res.status(400).json({ error: 'Invalid or expired reset token' });
    const hash = await bcrypt.hash(password, 10);
    await dbUpdateUser(record.user_id, { password_hash: hash });
    await dbMarkTokenUsed(token);
    log('info', `Password reset complete for user ${record.user_id}`);
    res.json({ message: 'Password updated successfully. You can now log in.' });
  } catch(e) { log('error', e.message); res.status(500).json({ error: 'Server error' }); }
});


// Change password (authenticated user)
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const user = await dbGetUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await dbUpdateUser(req.user.id, { password_hash: hash });
    log('info', `Password changed for user ${req.user.email}`);
    res.json({ message: 'Password updated successfully' });
  } catch(e) { log('error', e.message); res.status(500).json({ error: 'Server error' }); }
});

// ════════════════════════════════════════════════════════════
// ADMIN — USER MANAGEMENT
// ════════════════════════════════════════════════════════════

// GET all users
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { search = '', page = 1, limit = 20, role = '' } = req.query;
    let allUsers = await dbGetAllUsers();
    if (search) {
      const q = search.toLowerCase();
      allUsers = allUsers.filter(function(u) {
        return (u.email||'').toLowerCase().includes(q) ||
               (u.name||'').toLowerCase().includes(q) ||
               (u.org||'').toLowerCase().includes(q);
      });
    }
    if (role) allUsers = allUsers.filter(function(u) { return u.role === role; });
    const total = allUsers.length;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const users = allUsers.slice(offset, offset + parseInt(limit));
    const safe  = users.map(u => ({ id:u.id, email:u.email, name:u.name, org:u.org, role:u.role,
      client_slug:u.client_slug, packages: typeof u.packages==='string'?JSON.parse(u.packages||'[]'):u.packages,
      status:u.status, created_at:u.created_at }));
    res.json({ users: safe, total: safe.length });
  } catch(e) { log('error', e.message); res.status(500).json({ error: 'Server error' }); }
});

// POST create user / invite client
app.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { email, name, org, role='client', client_slug, packages=[], send_invite=true } = req.body ?? {};
    if (!email || !name) return res.status(400).json({ error: 'email and name required' });
    const existing = await dbGetUserByEmail(email.toLowerCase().trim());
    if (existing) return res.status(409).json({ error: 'Email already exists' });
    // Generate temp password
    const tempPass = crypto.randomBytes(6).toString('hex');
    const hash     = await bcrypt.hash(tempPass, 10);
    const slug     = client_slug || email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g,'-');
    const newUser  = { id: crypto.randomUUID(), email: email.toLowerCase().trim(),
      password_hash: hash, name, org: org||'', role, client_slug: slug,
      packages: JSON.stringify(packages), status: 'active' };
    await dbCreateUser(newUser);
    // Send welcome email
    if (send_invite) {
      await getMailer().sendMail({
        from: `"Ralph Analytics" <${process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@ralph-analytics.com'}>`,
        to:   newUser.email,
        subject: 'Welcome to Ralph Analytics — Your Login Details',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
          <div style="background:#E8521A;width:36px;height:36px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-weight:900;color:#fff;font-size:16px;margin-bottom:24px;">R</div>
          <h2 style="margin:0 0 12px;color:#111;">Welcome to Ralph Analytics</h2>
          <p style="color:#555;margin:0 0 20px;">Your client account has been set up. Log in below with your temporary credentials.</p>
          <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin-bottom:24px;">
            <p style="margin:0 0 8px;color:#333;"><strong>Email:</strong> ${newUser.email}</p>
            <p style="margin:0;color:#333;"><strong>Temporary Password:</strong> ${tempPass}</p>
          </div>
          <a href="${BASE_URL}/client" style="display:inline-block;background:#E8521A;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;">Log In Now</a>
          <p style="color:#999;font-size:12px;margin-top:24px;">Please change your password after first login.</p>
        </div>`,
      });
    }
    log('info', `User created: ${newUser.email} (${role})`);
    await auditLog(req.user.email, 'CREATE_USER', newUser.id, newUser.email, 'Created: ' + newUser.name + ' (' + role + ')', req.ip);
    res.status(201).json({ user: { ...newUser, password_hash: undefined }, temp_password: send_invite ? undefined : tempPass });
  } catch(e) { log('error', e.message); res.status(500).json({ error: 'Server error' }); }
});


// POST resend invite email to existing client
app.post('/api/admin/users/:id/resend-invite', requireAdmin, async (req, res) => {
  try {
    const user = await dbGetUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const tempPass = crypto.randomBytes(6).toString('hex');
    const hash     = await bcrypt.hash(tempPass, 10);
    // Update password
    if (pool) {
      await pool.execute('UPDATE users SET password_hash=? WHERE id=?', [hash, user.id]);
    } else {
      const db = loadJsonDb(); const u2 = db.users.find(u => u.id === user.id); if (u2) { u2.password_hash = hash; saveJsonDb(db); }
    }
    // Send invite email
    await getMailer().sendMail({
      from: `"Ralph Analytics" <${process.env.SMTP_FROM || 'noreply@ralph-analytics.com'}>`,
      to:   user.email,
      subject: 'Your Ralph Analytics Login Details',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <div style="background:#E8521A;width:36px;height:36px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-weight:900;color:#fff;font-size:16px;margin-bottom:24px;">R</div>
        <h2 style="margin:0 0 12px;color:#111;">Your Ralph Analytics Access</h2>
        <p style="color:#555;margin:0 0 20px;">Your login credentials have been reset. Use the details below to access your dashboard.</p>
        <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin-bottom:24px;">
          <p style="margin:0 0 8px;color:#333;"><strong>Email:</strong> ${user.email}</p>
          <p style="margin:0;color:#333;"><strong>Temporary Password:</strong> ${tempPass}</p>
        </div>
        <a href="${process.env.BASE_URL || 'https://ralph-analytics.com'}/client"
           style="display:inline-block;background:#E8521A;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;">Log In Now</a>
        <p style="color:#999;font-size:12px;margin-top:24px;">Please change your password after logging in via Support > Change Password.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="color:#bbb;font-size:11px;">Ralph Analytics | ralph-analytics.com</p>
      </div>`,
    });
    await auditLog(req.user.email, 'RESEND_INVITE', user.id, user.email, 'Invite resent to: ' + user.email, req.ip);
    log('info', 'Invite resent to: ' + user.email);
    res.json({ success: true, message: 'Invite email sent to ' + user.email });
  } catch(e) { log('error', 'resend-invite: ' + e.message); res.status(500).json({ error: 'Server error' }); }
});

// PATCH update user
app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const { email, name, org, role, client_slug, packages, status } = req.body ?? {};
    const updates = {};
    if (email)       updates.email       = email.toLowerCase().trim();
    if (name)        updates.name        = name;
    if (org !== undefined) updates.org   = org;
    if (role)        updates.role        = role;
    if (client_slug) updates.client_slug = client_slug;
    if (packages)    updates.packages    = JSON.stringify(packages);
    if (status)      updates.status      = status;
    const updated = await dbUpdateUser(req.params.id, updates);
    if (!updated) return res.status(404).json({ error: 'User not found' });
    res.json({ user: updated });
  } catch(e) { log('error', e.message); res.status(500).json({ error: 'Server error' }); }
});

// DELETE user
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = await dbGetUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin') return res.status(403).json({ error: 'Cannot delete admin users' });
    await dbDeleteUser(req.params.id);
    log('info', `User deleted: ${req.params.id}`);
    res.json({ success: true });
  } catch(e) { log('error', e.message); res.status(500).json({ error: 'Server error' }); }
});

// ════════════════════════════════════════════════════════════
// SUPPORT TICKETS
// ════════════════════════════════════════════════════════════

app.post('/api/support/ticket', requireAuth, async (req, res) => {
  try {
    const { subject, message, priority='medium' } = req.body ?? {};
    if (!subject || !message) return res.status(400).json({ error: 'subject and message required' });
    const ticket = { id: crypto.randomUUID(), user_id: req.user.id,
      user_email: req.user.email, subject, message, priority, status: 'open' };
    await dbCreateTicket(ticket);
    // Notify admin
    await getMailer().sendMail({
      from: `"Ralph Analytics" <${process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@ralph-analytics.com'}>`,
      to:   'admin@ralph-analytics.com',
      subject: `[Support] ${subject} — from ${req.user.email}`,
      html: `<p><strong>From:</strong> ${req.user.email} (${req.user.org||''})</p>
             <p><strong>Priority:</strong> ${priority}</p>
             <p><strong>Message:</strong></p><p>${message.replace(/\n/g,'<br>')}</p>`,
    });
    log('info', `Support ticket from ${req.user.email}: ${subject}`);
    res.status(201).json({ ticket });
  } catch(e) { log('error', e.message); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/admin/tickets', requireAdmin, async (req, res) => {
  try {
    const tickets = await dbGetAllTickets();
    res.json({ tickets, total: tickets.length });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/admin/tickets/:id', requireAdmin, async (req, res) => {
  try {
    const { status, priority } = req.body ?? {};
    const updates = {};
    if (status)   updates.status   = status;
    if (priority) updates.priority = priority;
    await dbUpdateTicket(req.params.id, updates);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ════════════════════════════════════════════════════════════
// ENQUIRIES (existing)
// ════════════════════════════════════════════════════════════
app.post('/api/contact', async (req, res) => {
  const { name, organisation, email, phone, service, standard, message } = req.body || {};
  if (!name || !email || !service || !message) return res.status(400).json({ error: 'Required fields missing' });
  const file = path.join(__dirname, '..', 'data', 'enquiries.json');
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : [];
    existing.push({ id: Date.now(), name, organisation, email, phone, service, standard, message, createdAt: new Date().toISOString(), status: 'new' });
    fs.writeFileSync(file, JSON.stringify(existing, null, 2));
    await getMailer().sendMail({
      from: `"Ralph Analytics" <${process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@ralph-analytics.com'}>`,
      to:   'admin@ralph-analytics.com',
      subject: `New Enquiry: ${service} — from ${name}`,
      html: `<p><strong>Name:</strong> ${name}</p><p><strong>Org:</strong> ${organisation||'—'}</p>
             <p><strong>Email:</strong> ${email}</p><p><strong>Phone:</strong> ${phone||'—'}</p>
             <p><strong>Service:</strong> ${service}</p><p><strong>Standard:</strong> ${standard||'—'}</p>
             <p><strong>Message:</strong><br>${message.replace(/\n/g,'<br>')}</p>`,
    });
    log('info', `Contact: ${email} — ${service}`);
    res.json({ success: true, message: 'Enquiry received' });
  } catch(err) { res.status(500).json({ error: 'Failed to save enquiry' }); }
});

app.get('/api/admin/enquiries', requireAdmin, (req, res) => {
  const file = path.join(__dirname, '..', 'data', 'enquiries.json');
  try {
    const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : [];
    res.json({ enquiries: data.reverse(), total: data.length });
  } catch(err) { res.status(500).json({ error: 'Failed to read enquiries' }); }
});

app.patch('/api/admin/enquiries/:id', requireAdmin, (req, res) => {
  const file = path.join(__dirname, '..', 'data', 'enquiries.json');
  try {
    const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : [];
    const idx  = data.findIndex(e => String(e.id) === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    data[idx] = { ...data[idx], ...req.body, updatedAt: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    res.json({ success: true, enquiry: data[idx] });
  } catch(err) { res.status(500).json({ error: 'Failed to update enquiry' }); }
});

// ════════════════════════════════════════════════════════════
// PROXIES + STATIC
// ════════════════════════════════════════════════════════════
app.all('/api/agent-proxy/*', requireAdmin, async (req, res) => {
  await proxyRequest({ req, res, targetUrl: `${AGENT_URL}${req.path.replace('/api/agent-proxy','')}`, apiKey: AGENT_KEY });
});

app.get('/api/client-packages/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) return res.status(400).json({ error: 'Invalid slug' });
  try {
    const clientRes = await axios.get(`${ORCH_URL}/api/clients/${slug}`, { headers:{'X-Api-Key':ORCH_KEY}, timeout:5000 });
    const clientId  = clientRes.data?.data?.id;
    if (!clientId) return res.status(404).json({ error: 'Client not found' });
    const pkgRes = await axios.get(`${ORCH_URL}/api/clients/${clientId}/packages`, { headers:{'X-Api-Key':ORCH_KEY}, timeout:5000 });
    res.json(pkgRes.data);
  } catch(err) {
    res.status(err.response?.status ?? 502).json(err.response?.data ?? { error: err.message });
  }
});

app.all('/api/orchestrator/*', requireAuth, async (req, res) => {
  const orchPath = req.path.replace('/api/orchestrator', '/api');
  if (req.user.role !== 'admin') {
    const ok = /^\/api\/clients\/[^/]+\/packages(\/[^/]+\/access)?$/.test(orchPath);
    if (!ok) return res.status(403).json({ error: 'Admin required' });
  }
  await proxyRequest({ req, res, targetUrl: `${ORCH_URL}${orchPath}`, apiKey: ORCH_KEY });
});


// ── Audit trail endpoints (Sprint 5) ──────────────────────────────────────
app.get('/api/admin/audit-log', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pg = parseInt(page), lm = parseInt(limit);
    const db = loadJsonDb();
    const logs = (db.audit_log || []);
    const total = logs.length;
    const paged = logs.slice((pg-1)*lm, pg*lm);
    res.json({ logs: paged, total, page: pg, pages: Math.ceil(total/lm) });
  } catch(e) { console.error('[audit-log]', e); res.status(500).json({ error: 'Server error' }); }
});


app.delete('/api/admin/audit-log', requireAdmin, async (req, res) => {
  try {
    // Only allow clearing logs older than 90 days
    await db.query('DELETE FROM audit_log WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)');
    res.json({ success: true, message: 'Audit logs older than 90 days cleared' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── Client onboarding checklist (Sprint 5) ────────────────────────────────
app.get('/api/admin/onboarding/:clientId', requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const [users] = await db.query('SELECT * FROM users WHERE id = ? OR client_slug = ?', [clientId, clientId]);
    if (!users.length) return res.status(404).json({ error: 'Client not found' });
    const u = users[0];
    const pkgs = typeof u.packages === 'string' ? JSON.parse(u.packages||'[]') : u.packages||[];
    const checklist = [
      { id:'profile',   label:'Client profile created',         done: !!(u.name && u.org && u.email) },
      { id:'packages',  label:'Packages assigned',               done: pkgs.length > 0 },
      { id:'password',  label:'Password set (not temp)',         done: u.status === 'active' },
      { id:'welcome',   label:'Welcome email sent',              done: u.welcome_sent === 1 || u.welcome_sent === true },
      { id:'psa',       label:'PSA / contract signed',           done: u.psa_signed === 1 || u.psa_signed === true },
      { id:'login',     label:'First login completed',           done: u.first_login_at != null },
    ];
    const pct = Math.round(checklist.filter(c=>c.done).length / checklist.length * 100);
    res.json({ success: true, client: { id:u.id, name:u.name, email:u.email, org:u.org }, checklist, completion_pct: pct });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/onboarding/:clientId', requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { psa_signed, welcome_sent, first_login_at } = req.body;
    const updates = {}; const vals = [];
    if (psa_signed !== undefined) { updates.psa_signed = psa_signed ? 1 : 0; vals.push(psa_signed ? 1 : 0); }
    if (welcome_sent !== undefined) { updates.welcome_sent = welcome_sent ? 1 : 0; vals.push(welcome_sent ? 1 : 0); }
    if (first_login_at !== undefined) { updates.first_login_at = first_login_at; vals.push(first_login_at); }
    if (!vals.length) return res.status(400).json({ error: 'Nothing to update' });
    const setClauses = Object.keys(updates).map(k=>`${k}=?`).join(',');
    vals.push(clientId, clientId);
    await db.query(`UPDATE users SET ${setClauses} WHERE id=? OR client_slug=?`, vals);
    await auditLog(req.user.email, 'UPDATE_ONBOARDING', clientId, clientId, 'Updated onboarding: ' + Object.keys(updates).join(', '), req.ip);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/health', async (req, res) => {
  const services = {};
  for (const [name, url, key] of [['agent',`${AGENT_URL}/health`,AGENT_KEY],['orchestrator',`${ORCH_URL}/api/health`,ORCH_KEY]]) {
    try { const r = await axios.get(url,{headers:{'X-Api-Key':key},timeout:3000}); services[name]={status:'ok',data:r.data}; }
    catch(e) { services[name]={status:'unreachable',error:e.message}; }
  }
  const dbStatus = pool ? 'mysql' : 'json-file';
  res.json({ status:'ok', service:'@ralph/analytics-app', uptime:Math.floor(process.uptime()), db: dbStatus, services, timestamp:new Date().toISOString() });
});

// Static
const STATIC = path.join(__dirname, '..');


app.get('/',                (_req, res) => res.sendFile(path.join(STATIC,'landing/index.html')));
app.get('/client',          (_req, res) => {
  res.setHeader('Cache-Control','no-store,no-cache,must-revalidate');
  res.sendFile(path.join(STATIC,'client-portal/index.html'));
});
app.get('/client/',         (_req, res) => res.redirect('/client'));
app.get('/admin',           (_req, res) => {
  res.setHeader('Cache-Control','no-store,no-cache,must-revalidate');
  res.sendFile(path.join(STATIC,'admin-portal/index.html'));
});
app.get('/admin/',          (_req, res) => res.redirect('/admin'));
app.get('/reset-password',  (_req, res) => res.sendFile(path.join(STATIC,'landing/reset-password.html')));
app.get('/privacy', (_req, res) => res.sendFile(path.join(STATIC,'landing/privacy.html')));
app.get('/paia',    (_req, res) => res.sendFile(path.join(STATIC,'landing/paia.html')));

app.use('/shared',          express.static(path.join(STATIC,'shared')));
app.use('/public',          express.static(path.join(STATIC,'public')));
app.get('/manifest.json',   (_req, res) => { res.set('Content-Type','application/manifest+json'); res.sendFile(path.join(STATIC,'public','manifest.json')); });
app.get('/sw.js',           (_req, res) => { res.set('Service-Worker-Allowed','/'); res.set('Content-Type','application/javascript'); res.sendFile(path.join(STATIC,'public','sw.js')); });
app.get('/icons/:file',     (req, res) => res.sendFile(path.join(STATIC,'public','icons',req.params.file)));
app.get('/client/field-audit',  (_req, res) => { res.setHeader('Cache-Control','no-store,no-cache,must-revalidate'); res.sendFile(path.join(STATIC,'client-portal/field-audit.html')); });
app.get('/client/standards',    (_req, res) => res.sendFile(path.join(STATIC,'client-portal/standards.html')));
app.get('/client/translation',  (_req, res) => res.sendFile(path.join(STATIC,'client-portal/translation.html')));
app.get('/client/reports',      (_req, res) => res.sendFile(path.join(STATIC,'client-portal/reports.html')));


// ── RBA AIR Portal ─────────────────────────────────────────────
app.get('/rba',              (_req, res) => res.redirect('/rba/air'));
app.get('/rba/air',          (_req, res) => { res.setHeader('Cache-Control','no-store,no-cache,must-revalidate'); res.sendFile(path.join(STATIC,'rba-air/index.html')); });
app.get('/rba/air/',         (_req, res) => res.redirect('/rba/air'));
app.get('/rba/air/field-audit', (_req, res) => { res.setHeader('Cache-Control','no-store,no-cache,must-revalidate'); res.sendFile(path.join(STATIC,'client-portal/field-audit.html')); });
app.get('/rba/air/risk',     (_req, res) => { res.setHeader('Cache-Control','no-store,no-cache,must-revalidate'); res.sendFile(path.join(STATIC,'rba-air/risk.html')); });
app.get('/rba/air/inventory',(_req, res) => { res.setHeader('Cache-Control','no-store,no-cache,must-revalidate'); res.sendFile(path.join(STATIC,'rba-air/inventory.html')); });
app.get('/rba/air/suppliers',(_req, res) => { res.setHeader('Cache-Control','no-store,no-cache,must-revalidate'); res.sendFile(path.join(STATIC,'rba-air/suppliers.html')); });
app.get('/rba/air/training', (_req, res) => { res.setHeader('Cache-Control','no-store,no-cache,must-revalidate'); res.sendFile(path.join(STATIC,'rba-air/training.html')); });


// ── POPIA S72 / GDPR Art.44 — Prompt Hygiene ─────────────────
// Strip personally identifiable information before sending to AI service
function sanitiseForAI(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\b[A-Z][a-z]+\s[A-Z][a-z]+\b/g, '[NAME]')                    // Full names
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]') // Emails
    .replace(/\b(\+27|0)[6-8][0-9]{8}\b/g, '[PHONE]')                       // SA phone numbers
    .replace(/\b\d{13}\b/g, '[ID_NUMBER]')                                   // SA ID numbers
    .replace(/\b[0-9]{4}\s?[0-9]{4}\s?[0-9]{4}\s?[0-9]{4}\b/g, '[CARD]'); // Card numbers
}

// ── EU AI Act Art.25 / ISO 42001 Cl.8.5 — AI Output Logging ─
const AI_LOG_FILE = path.join(__dirname, '..', 'data', 'ai_log.jsonl');
function logAICall(userId, action, promptSummary, modelVersion) {
  const entry = {
    ts: new Date().toISOString(),
    user_id: userId || 'system',
    action,
    prompt_summary: promptSummary ? promptSummary.slice(0, 120) : '',
    model: modelVersion || 'gpt-4o',
    logged: true
  };
  try { fs.appendFileSync(AI_LOG_FILE, JSON.stringify(entry) + '\n'); }
  catch(e) { log('warn', `AI log write failed: ${e.message}`); }
}

// ── EU AI Act Art.14 / ISO 42001 Cl.8.6 — Human Review Flag ─
const REVIEW_FILE = path.join(__dirname, '..', 'data', 'ai_review_flags.jsonl');
app.post('/api/ai/flag-for-review', requireAuth, (req, res) => {
  const { ai_output_ref, reason, context } = req.body ?? {};
  if (!reason) return res.status(400).json({ error: 'reason required' });
  const entry = {
    id: require('crypto').randomUUID(),
    ts: new Date().toISOString(),
    flagged_by: req.user.id,
    ai_output_ref: ai_output_ref || 'unspecified',
    reason, context: context || '',
    status: 'pending_review',
    reviewed_by: null, reviewed_at: null
  };
  try {
    fs.appendFileSync(REVIEW_FILE, JSON.stringify(entry) + '\n');
    log('info', `AI output flagged for review by ${req.user.email}`);
    res.status(201).json({ message: 'Flagged for human review. Our team will review within 2 business days.', flag_id: entry.id });
  } catch(e) { res.status(500).json({ error: 'Failed to log flag' }); }
});

app.get('/api/admin/ai-review-flags', requireAdmin, (req, res) => {
  try {
    const flags = fs.existsSync(REVIEW_FILE)
      ? fs.readFileSync(REVIEW_FILE,'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).reverse()
      : [];
    res.json({ flags, total: flags.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/ai-review-flags/:id', requireAdmin, (req, res) => {
  try {
    if (!fs.existsSync(REVIEW_FILE)) return res.status(404).json({ error: 'No flags found' });
    const lines = fs.readFileSync(REVIEW_FILE,'utf8').trim().split('\n').filter(Boolean);
    const updated = lines.map(l => {
      const f = JSON.parse(l);
      if (f.id === req.params.id) return JSON.stringify({ ...f, ...req.body, reviewed_at: new Date().toISOString() });
      return l;
    });
    fs.writeFileSync(REVIEW_FILE, updated.join('\n') + '\n');
    res.json({ message: 'Flag updated' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── ISO 42001 Cl.10.1 / NIST MANAGE 3.0 — AI Incident Register ─
const INCIDENT_FILE = path.join(__dirname, '..', 'data', 'ai_incidents.jsonl');
app.post('/api/ai/report-incident', requireAuth, (req, res) => {
  const { type, description, severity, ai_action } = req.body ?? {};
  if (!description) return res.status(400).json({ error: 'description required' });
  const entry = {
    id: require('crypto').randomUUID(),
    ts: new Date().toISOString(),
    reported_by: req.user.id,
    type: type || 'quality_issue',  // hallucination | bias | accuracy | privacy | other
    severity: severity || 'medium',  // low | medium | high | critical
    description, ai_action: ai_action || '',
    status: 'open', resolved_at: null
  };
  try {
    fs.appendFileSync(INCIDENT_FILE, JSON.stringify(entry) + '\n');
    res.status(201).json({ message: 'AI incident reported. Reference: ' + entry.id, incident_id: entry.id });
  } catch(e) { res.status(500).json({ error: 'Failed to log incident' }); }
});

app.get('/api/admin/ai-incidents', requireAdmin, (req, res) => {
  try {
    const incidents = fs.existsSync(INCIDENT_FILE)
      ? fs.readFileSync(INCIDENT_FILE,'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).reverse()
      : [];
    res.json({ incidents, total: incidents.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// AI proxy

// ── AI Service Proxy Routes (/api/ai/*) ──────────────────────────────────
// These forward client requests to ralph-ai service on :4001

app.post('/api/ai/analyse-audit', requireAuth, async (req, res) => {
  try {
    const { findings, auditData, auditType, standard = 'ISO 9001', context } = req.body;
    const payload = {
      auditData: auditData || findings || context || 'No data provided',
      standard:  standard || auditType || 'Field Audit Standards'
    };
    const resp = await axios.post('http://localhost:4001/ai/analyse-audit', payload, {
      headers: { 'Content-Type': 'application/json' }, timeout: 45000
    });
    // Normalise response field
    const result = resp.data;
    res.json({ analysis: result.analysis || result.result || result.text || JSON.stringify(result), ...result });
  } catch(e) {
    const code = e.response?.status || 502;
    res.status(code).json({ error: e.response?.data?.error || e.message });
  }
});

app.post('/api/ai/generate-narrative', requireAuth, async (req, res) => {
  try {
    const { reportType, period, context, reportData, tone = 'professional', audience = 'donor' } = req.body;
    const payload = {
      reportData: reportData || `${reportType || 'M&E'} Report — ${period || 'current period'}. ${context || ''}`,
      tone, audience
    };
    const resp = await axios.post('http://localhost:4001/ai/generate-narrative', payload, {
      headers: { 'Content-Type': 'application/json' }, timeout: 45000
    });
    res.json(resp.data);
  } catch(e) {
    const code = e.response?.status || 502;
    res.status(code).json({ error: e.response?.data?.error || e.message });
  }
});

app.post('/api/ai/gap-analysis', requireAuth, async (req, res) => {
  try {
    const resp = await axios.post('http://localhost:4001/ai/gap-analysis', req.body, {
      headers: { 'Content-Type': 'application/json' }, timeout: 45000
    });
    res.json(resp.data);
  } catch(e) {
    const code = e.response?.status || 502;
    res.status(code).json({ error: e.response?.data?.error || e.message });
  }
});

app.use('/proxy/ai', requireAuth, (req, res) => {
  // Log the AI call for audit trail — EU AI Act Art.25 / ISO 42001 Cl.8.5
  const action = req.url || '/';
  logAICall(req.user?.id, action, req.body ? JSON.stringify(req.body).slice(0,100) : '', 'gpt-4o');
  const http = require('http');
  const pr = http.request({ hostname:'127.0.0.1', port:4001, path:req.url||'/', method:req.method, headers:{...req.headers, host:'localhost:4001'} }, up => {
    res.writeHead(up.statusCode, up.headers); up.pipe(res);
  });
  pr.on('error', () => res.status(503).json({ error:'AI service unavailable' }));
  req.pipe(pr);
});

const CORE_PKGS = { rcars:3040, scvms:3050, irmp:3060, iarfs:3070, capts:3080, dashboard:3090, reporting:3100, srm:3110 };
Object.keys(CORE_PKGS).forEach(slug => {
  app.get('/client/'+slug, (_req, res) => res.sendFile(path.join(STATIC,'client-portal/pkg-'+slug+'.html')));
  app.use('/proxy/'+slug, (req, res) => {
    const http = require('http'); const port = CORE_PKGS[slug];
    const pr = http.request({ hostname:'127.0.0.1', port, path:req.url||'/', method:req.method, headers:{...req.headers, host:'localhost:'+port} }, up => {
      res.writeHead(up.statusCode, up.headers); up.pipe(res);
    });
    pr.on('error', () => res.status(503).json({ error:'Service unavailable', port }));
    req.pipe(pr);
  });
});


app.get('/api/admin/ai-log-count', requireAdmin, (req, res) => {
  try {
    const logFile = path.join(__dirname, '..', 'data', 'ai_log.jsonl');
    const count = fs.existsSync(logFile)
      ? fs.readFileSync(logFile,'utf8').trim().split('\n').filter(Boolean).length
      : 0;
    res.json({ count });
  } catch(e) { res.json({ count: 0 }); }
});


// ── Start ─────────────────────────────────────────────────────
initDb().then(() => {
  

// ── Sprint 5: MySQL schema migration (runs after server starts) ────────────
setTimeout(async function() {
  if (!pool) { console.log('[Sprint5] JSON-file mode — skipping schema migration'); return; }
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS audit_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      admin_email VARCHAR(255) NOT NULL,
      action VARCHAR(100) NOT NULL,
      target_id VARCHAR(100),
      target_email VARCHAR(255),
      detail TEXT,
      ip_address VARCHAR(64),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, []);
    const cols = [
      'welcome_sent TINYINT(1) DEFAULT 0',
      'psa_signed TINYINT(1) DEFAULT 0',
      'first_login_at DATETIME DEFAULT NULL'
    ];
    for (const col of cols) {
      try { await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS ' + col); } catch(e) {}
    }
    console.log('[Sprint5] Schema migration complete');
  } catch(e) { console.error('[Sprint5] Migration warn:', e.message); }
}, 2000);

}).catch(e => { log('error', `DB init failed: ${e.message}`); process.exit(1); });
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
// ── Database status endpoint ──────────────────────────────────────────
app.get('/api/admin/db-status', requireAdmin, async (req, res) => {
  const dbMode = process.env.DB_HOST ? 'mysql' : 'json-file';
  const db = loadJsonDb();
  const stats = {
    mode: dbMode,
    host: process.env.DB_HOST || 'localhost (JSON)',
    users: (db.users || []).length,
    enquiries: (db.enquiries || []).length,
    tickets: (db.support_tickets || []).length,
    audit_entries: (db.audit_log || []).length,
    onboarding_clients: Object.keys(db.onboarding || {}).length,
  };
  res.json({ status: 'ok', db: stats, migration_ready: !!process.env.DB_HOST });
});



// ── Database status ───────────────────────────────────────────────────────────
app.get('/api/admin/db-status', requireAdmin, async (req, res) => {
  try {
    const db    = loadJsonDb();
    const users = await dbGetAllUsers();
    res.json({ status: 'ok', db: {
      mode:               pool ? 'mysql' : 'json-file',
      host:               process.env.DB_HOST || 'localhost (JSON)',
      users:              users.length,
      tickets:            (db.support_tickets||[]).length,
      audit_entries:      (db.audit_log||[]).length,
      onboarding_clients: Object.keys(db.onboarding||{}).length,
    }, migration_ready: !!pool });
  } catch(e) { log('error', e.message); res.status(500).json({ error: 'Server error' }); }
});

// ── Client Onboarding Checklist ──────────────────────────────────────────────
const ONBOARDING_STEPS = [
  { id: 'profile',     label: 'Profile & org details completed',      category: 'Setup'    },
  { id: 'packages',    label: 'Service packages assigned',            category: 'Setup'    },
  { id: 'invite_sent', label: 'Welcome invite email sent',            category: 'Setup'    },
  { id: 'first_login', label: 'First login completed',               category: 'Access'   },
  { id: 'pw_changed',  label: 'Password changed from temporary',     category: 'Access'   },
  { id: 'portal_tour', label: 'Client portal orientation done',      category: 'Access'   },
  { id: 'dpa_signed',  label: 'Data Processing Agreement signed',    category: 'Legal'    },
  { id: 'ai_ack',      label: 'AI transparency notice acknowledged', category: 'Legal'    },
  { id: 'first_audit', label: 'First field audit submitted',         category: 'Delivery' },
  { id: 'report_gen',  label: 'First report generated',              category: 'Delivery' },
];
app.get('/api/admin/onboarding', requireAdmin, async (req, res) => {
  try {
    const allUsers = await dbGetAllUsers();
    const clients  = allUsers.filter(u => u.role === 'client');
    const db       = loadJsonDb();
    const ob       = db.onboarding || {};
    const result   = clients.map(u => {
      const steps     = ob[u.id] || {};
      const completed = ONBOARDING_STEPS.filter(s => steps[s.id]).length;
      return { user_id: u.id, email: u.email, name: u.name, org: u.org,
        status: u.status, packages: u.packages,
        checklist: ONBOARDING_STEPS.map(s => ({ ...s, done: !!steps[s.id], done_at: steps[s.id]||null })),
        progress: Math.round((completed / ONBOARDING_STEPS.length) * 100),
        completed, total: ONBOARDING_STEPS.length,
      };
    });
    res.json({ clients: result, steps: ONBOARDING_STEPS });
  } catch(e) { log('error', e.message); res.status(500).json({ error: 'Server error' }); }
});
app.patch('/api/admin/onboarding/:userId/:stepId', requireAdmin, async (req, res) => {
  try {
    const { userId, stepId } = req.params;
    const { done } = req.body;
    const db = loadJsonDb();
    if (!db.onboarding) db.onboarding = {};
    if (!db.onboarding[userId]) db.onboarding[userId] = {};
    if (done) db.onboarding[userId][stepId] = new Date().toISOString();
    else delete db.onboarding[userId][stepId];
    saveJsonDb(db);
    writeAudit('ONBOARDING_STEP', req.user.email, userId, { stepId, done });
    res.json({ success: true });
  } catch(e) { log('error', e.message); res.status(500).json({ error: 'Server error' }); }
});

// ── Database status ───────────────────────────────────────────────────────────
app.get('/api/admin/db-status', requireAdmin, async (req, res) => {
  try {
    const allUsers = await dbGetAllUsers();
    const db       = loadJsonDb();
    res.json({ status: 'ok', db: {
      mode:               pool ? 'mysql' : 'json-file',
      host:               process.env.DB_HOST || 'localhost (JSON)',
      users:              allUsers.length,
      tickets:            (db.support_tickets||[]).length,
      audit_entries:      (db.audit_log||[]).length,
      onboarding_clients: Object.keys(db.onboarding||{}).length,
    }, migration_ready: !!pool });
  } catch(e) { log('error', e.message); res.status(500).json({ error: 'Server error' }); }
});

// ── 404 catch-all (must be last) ─────────────────────────────────────────────
app.use((req, res) => {
  // Redirect common typos gracefully
  if (req.path.startsWith('/client') && req.path !== '/client') return res.redirect('/client');
  if (req.path.startsWith('/admin')  && req.path !== '/admin')  return res.redirect('/admin');
  res.status(404).json({ error: 'Not found', path: req.path });
});


app.listen(PORT, () => {
    log('info', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log('info', ` @ralph/analytics-app`);
    log('info', `  Port:  ${PORT}  |  DB: ${pool?'MySQL':'JSON-file'}`);
    log('info', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  });


