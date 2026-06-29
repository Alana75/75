module.exports = {
  apps: [
    { name: 'ralph-analytics',   script: './api/server.js',           cwd: '/home/1638322.cloudwaysapps.com/amxhnzbwdx/public_html/monorepo/ralph-analytics', env: { PORT: 3000, NODE_ENV: 'production' }, max_restarts: 10, restart_delay: 3000 },
    { name: 'ralph-orchestrator',script: './apps/ralph-orchestrator/src/index.js', cwd: '/home/1638322.cloudwaysapps.com/amxhnzbwdx/public_html/monorepo', env: { PORT: 4020, NODE_ENV: 'production' }, max_restarts: 10, restart_delay: 3000 },
    { name: 'ralph-ai',          script: './apps/ai-service/src/index.js',         cwd: '/home/1638322.cloudwaysapps.com/amxhnzbwdx/public_html/monorepo', env: { PORT: 4001, NODE_ENV: 'production' }, max_restarts: 10, restart_delay: 3000 },
    { name: 'ralph-messaging',   script: './apps/messaging-service/src/index.js',  cwd: '/home/1638322.cloudwaysapps.com/amxhnzbwdx/public_html/monorepo', env: { PORT: 4002, NODE_ENV: 'production' }, max_restarts: 10, restart_delay: 3000 },
    { name: 'ralph-irmp',        script: './ralph-analytics/packages/irmp/index.js', cwd: '/home/1638322.cloudwaysapps.com/amxhnzbwdx/public_html/monorepo', env: { PORT: 3040, NODE_ENV: 'production' }, max_restarts: 5 },
    { name: 'ralph-scvms',       script: './ralph-analytics/packages/scvms/index.js', cwd: '/home/1638322.cloudwaysapps.com/amxhnzbwdx/public_html/monorepo', env: { PORT: 3050, NODE_ENV: 'production' }, max_restarts: 5 },
    { name: 'ralph-rcars',       script: './ralph-analytics/packages/rcars/index.js', cwd: '/home/1638322.cloudwaysapps.com/amxhnzbwdx/public_html/monorepo', env: { PORT: 3060, NODE_ENV: 'production' }, max_restarts: 5 },
    { name: 'ralph-capts',       script: './ralph-analytics/packages/capts/index.js', cwd: '/home/1638322.cloudwaysapps.com/amxhnzbwdx/public_html/monorepo', env: { PORT: 3070, NODE_ENV: 'production' }, max_restarts: 5 },
    { name: 'ralph-iarfs',       script: './ralph-analytics/packages/iarfs/index.js', cwd: '/home/1638322.cloudwaysapps.com/amxhnzbwdx/public_html/monorepo', env: { PORT: 3080, NODE_ENV: 'production' }, max_restarts: 5 },
    { name: 'ralph-cid',         script: './ralph-analytics/packages/cid/index.js',   cwd: '/home/1638322.cloudwaysapps.com/amxhnzbwdx/public_html/monorepo', env: { PORT: 3090, NODE_ENV: 'production' }, max_restarts: 5 },
    { name: 'ralph-gres',        script: './ralph-analytics/packages/gres/index.js',  cwd: '/home/1638322.cloudwaysapps.com/amxhnzbwdx/public_html/monorepo', env: { PORT: 3100, NODE_ENV: 'production' }, max_restarts: 5 },
    { name: 'ralph-srm',         script: './ralph-analytics/packages/site-report-monitor/index.js', cwd: '/home/1638322.cloudwaysapps.com/amxhnzbwdx/public_html/monorepo', env: { PORT: 3110, NODE_ENV: 'production' }, max_restarts: 5 },
  ]
};
