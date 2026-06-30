# Nginx Vhost — Deployment Instructions

## File: ralph_nginx.conf

This vhost replaces the PHP proxy currently handling Node.js routing on Cloudways.

## How to apply in Cloudways:

1. Log into Cloudways dashboard → Servers → Applications → ralph-analytics.com
2. Go to **Application Settings → Vhost**
3. Paste the contents of `ralph_nginx.conf` into the Vhost editor
4. Click **Save Changes** — Cloudways will reload Nginx automatically
5. Test: `curl -I https://ralph-analytics.com/api/health`

## What this replaces:
- The PHP `index.php` reverse proxy (still works as fallback)
- The `.htaccess` FallbackResource directive

## Benefits over PHP proxy:
- No PHP process overhead for every request
- Proper WebSocket support for future real-time features
- Cache-Control headers managed at Nginx level
- Security headers (CSP, HSTS, X-Frame) enforced at edge
- Gzip compression without PHP

## Important notes:
- SSL certificates are managed by Cloudways — do NOT modify ssl_certificate paths
- Keep `index.php` in webroot as fallback — Nginx `try_files` calls it if needed
- All PM2 services remain on their assigned ports (3000, 3040-3110)
- Varnish cache sits in front of Nginx on Cloudways — purge after applying

## Purge Varnish after applying:
```bash
curl -X PURGE -H "Host: ralph-analytics.com" http://127.0.0.1/
```

