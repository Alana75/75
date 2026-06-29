#!/usr/bin/env node
/**
 * Ralph Analytics — JSON → MySQL Migration Script
 * Usage: node scripts/migrate-to-mysql.js
 * Requires: DB_HOST, DB_USER, DB_PASS, DB_NAME in environment
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql2/promise');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

async function migrate() {
  if (!process.env.DB_HOST) { console.error('DB_HOST not set — aborting'); process.exit(1); }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER, password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  console.log('Connected to MySQL:', process.env.DB_HOST);

  // Create tables
  await conn.execute(`CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255), org VARCHAR(255), role ENUM('admin','client') DEFAULT 'client',
    client_slug VARCHAR(100), password VARCHAR(255),
    packages JSON, status ENUM('active','inactive','pending') DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

  await conn.execute(`CREATE TABLE IF NOT EXISTS audit_log (
    id VARCHAR(36) PRIMARY KEY, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    action VARCHAR(100), actor VARCHAR(255), target VARCHAR(255), details JSON
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

  await conn.execute(`CREATE TABLE IF NOT EXISTS support_tickets (
    id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36), subject VARCHAR(500),
    message TEXT, priority ENUM('low','medium','high','critical') DEFAULT 'medium',
    status ENUM('open','in_progress','resolved','closed') DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

  await conn.execute(`CREATE TABLE IF NOT EXISTS onboarding (
    user_id VARCHAR(36), step_id VARCHAR(100), done_at DATETIME,
    PRIMARY KEY (user_id, step_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

  // Load JSON data
  if (!fs.existsSync(DB_FILE)) { console.log('No JSON DB found — creating empty tables'); await conn.end(); return; }
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

  // Migrate users
  const users = db.users || [];
  let userCount = 0;
  for (const u of users) {
    try {
      await conn.execute(
        'INSERT IGNORE INTO users (id,email,name,org,role,client_slug,password,packages,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [u.id, u.email, u.name||null, u.org||null, u.role||'client', u.client_slug||null, u.password||null, JSON.stringify(u.packages||[]), u.status||'active', u.created_at||new Date()]
      );
      userCount++;
    } catch(e) { console.warn('Skip user', u.email, e.message); }
  }
  console.log(`Migrated ${userCount} users`);

  // Migrate audit log
  const audit = db.audit_log || [];
  let auditCount = 0;
  for (const a of audit.slice(0, 500)) {
    try {
      await conn.execute('INSERT IGNORE INTO audit_log (id,timestamp,action,actor,target,details) VALUES (?,?,?,?,?,?)',
        [a.id, a.timestamp||new Date(), a.action||'', a.actor||'', a.target||'', JSON.stringify(a.details||{})]);
      auditCount++;
    } catch(e) {}
  }
  console.log(`Migrated ${auditCount} audit entries`);

  await conn.end();
  console.log('\n✅ Migration complete! Now set DB_HOST in .env and restart PM2.');
}

migrate().catch(e => { console.error('Migration failed:', e); process.exit(1); });
