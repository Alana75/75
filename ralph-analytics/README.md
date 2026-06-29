# Ralph Analytics — Web Platform

M&E SaaS platform deployed on **Alana server** (`ralph-analytics.com` / `45.55.60.132`).

## Structure

```
apps/ralph-analytics/
├── landing/         → Public marketing site        ( / )
├── client-portal/   → Client dashboard             ( /client )
├── admin-portal/    → Admin control panel          ( /admin )
├── api/server.js    → Express backend + API
├── shared/          → Shared CSS
└── .env.example     → Environment template
```

## Routes

| URL | Description |
|---|---|
| `/` | Landing page |
| `/client` | Client portal (login: client@demo.com / demo) |
| `/admin` | Admin portal (login: admin@ralph-analytics.com / RalphAdmin2026!) |
| `/api/health` | API health check |
| `/api/auth/login` | POST — get JWT token |
| `/api/apps/registry` | GET — list registered apps |
| `/api/agent-proxy/*` | Admin-only proxy to server-agents (:4010) |

## Cloudways Deployment

### First time on server

```bash
# SSH in
ssh master@45.55.60.132

# Create directory
mkdir -p $WEBROOT/ralph-analytics
cd $WEBROOT/ralph-analytics

# Create .env
cp .env.example .env
nano .env  # fill in JWT_SECRET, AGENT_API_KEY
```

### Manual deploy

```bash
cd apps/ralph-analytics
npm ci --omit=dev
# On server:
pm2 start api/server.js --name ralph-analytics --env production
pm2 save
```

### Nginx vhost (add to Cloudways custom nginx)

```nginx
location /client { try_files $uri /client/index.html; }
location /admin  { try_files $uri /admin/index.html;  }
location /api/   { proxy_pass http://localhost:3000;   }
```

Or run as full proxy:
```nginx
location / { proxy_pass http://localhost:3000; proxy_set_header Host $host; }
```

## App Registry

Apps from the monorepo register themselves via:

```bash
POST /api/apps/registry
{ "id":"my-app", "name":"My App", "pkg":"@ralph/my-app", "route":"/apps/my-app" }
```

Admin portal displays toggle switches to enable/disable each app.
Client portal shows only enabled apps.

## Environment Variables

```
PORT=3000
JWT_SECRET=<openssl rand -hex 32>
NODE_ENV=production
AGENT_API_URL=http://localhost:4010
AGENT_API_KEY=<same as RALPH_AGENT_API_KEY>
```
