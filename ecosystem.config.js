/**
 * PM2 Ecosystem Config — Ralph Analytics Platform
 * Server: 45.55.60.132 (Cloudways DigitalOcean)
 * Usage: pm2 start ecosystem.config.js --env production
 *        pm2 save && pm2 startup
 */
const BASE = '/home/1638322.cloudwaysapps.com/amxhnzbwdx/public_html/monorepo';
const RA   = BASE + '/ralph-analytics';
const ENV  = 'production';

module.exports = {
  apps: [
    // ── Main app ─────────────────────────────────────────────
    {
      name: 'ralph-analytics',
      script: `${RA}/api/server.js`,
      cwd: `${RA}/api`,
      env_production: { NODE_ENV: ENV, PORT: 3000 },
      restart_delay: 3000, max_restarts: 10, min_uptime: '10s',
    },
    // ── Microservices ─────────────────────────────────────────
    {
      name: 'ralph-ai',
      script: `${BASE}/apps/ai-service/src/index.js`,
      cwd: `${BASE}/apps/ai-service`,
      env_production: { NODE_ENV: ENV, PORT: 4001 },
      restart_delay: 3000, max_restarts: 10, min_uptime: '10s',
    },
    {
      name: 'ralph-messaging',
      script: `${BASE}/apps/messaging-service/src/index.js`,
      cwd: `${BASE}/apps/messaging-service`,
      env_production: { NODE_ENV: ENV, PORT: 4002 },
      restart_delay: 3000, max_restarts: 10, min_uptime: '10s',
    },
    {
      name: 'ralph-orchestrator',
      script: `${BASE}/orchestrator/dist/index.js`,
      cwd: `${BASE}/orchestrator`,
      env_production: { NODE_ENV: ENV, PORT: 4020 },
      restart_delay: 3000, max_restarts: 10, min_uptime: '10s',
    },
    // ── Enterprise packages ───────────────────────────────────
    { name: 'ralph-rcars',  script: `${BASE}/packages/regulatory-compliance-audit-readiness-system/dist/index.js`,  cwd: `${BASE}/packages/regulatory-compliance-audit-readiness-system`,  env_production: { NODE_ENV: ENV, PORT: 3040 }, restart_delay: 3000, max_restarts: 10 },
    { name: 'ralph-scvms',  script: `${BASE}/packages/supply-chain-vetting-monitoring-system/dist/index.js`,        cwd: `${BASE}/packages/supply-chain-vetting-monitoring-system`,        env_production: { NODE_ENV: ENV, PORT: 3050 }, restart_delay: 3000, max_restarts: 10 },
    { name: 'ralph-irmp',   script: `${BASE}/packages/intelligent-risk-management-platform/dist/index.js`,          cwd: `${BASE}/packages/intelligent-risk-management-platform`,          env_production: { NODE_ENV: ENV, PORT: 3060 }, restart_delay: 3000, max_restarts: 10 },
    { name: 'ralph-iarfs',  script: `${BASE}/packages/impact-assessment-results-framework-system/dist/index.js`,    cwd: `${BASE}/packages/impact-assessment-results-framework-system`,    env_production: { NODE_ENV: ENV, PORT: 3070 }, restart_delay: 3000, max_restarts: 10 },
    { name: 'ralph-capts',  script: `${BASE}/packages/corrective-action-plan-tracker-system/dist/index.js`,         cwd: `${BASE}/packages/corrective-action-plan-tracker-system`,         env_production: { NODE_ENV: ENV, PORT: 3080 }, restart_delay: 3000, max_restarts: 10 },
    { name: 'ralph-cid',    script: `${BASE}/packages/compliance-intelligence-dashboard/dist/index.js`,             cwd: `${BASE}/packages/compliance-intelligence-dashboard`,             env_production: { NODE_ENV: ENV, PORT: 3090 }, restart_delay: 3000, max_restarts: 10 },
    { name: 'ralph-gres',   script: `${BASE}/packages/governance-reporting-export-system/dist/index.js`,            cwd: `${BASE}/packages/governance-reporting-export-system`,            env_production: { NODE_ENV: ENV, PORT: 3100 }, restart_delay: 3000, max_restarts: 10 },
  ],
};
