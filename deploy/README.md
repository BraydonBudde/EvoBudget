# Deploying ezzohub.com on Hetzner

This site is fully static (no backend, no build step), so hosting it is
just: serve the files with nginx, point DNS at the server, add HTTPS.

## 1. Create the server
Hetzner Cloud Console -> New Server -> Ubuntu 24.04 -> CPX11 -> add your
SSH key -> Create.

## 2. Point DNS at it
At your domain registrar, add:
- `A` record, host `@`, value = server's public IPv4
- `A` record, host `www`, value = server's public IPv4
(add AAAA records too if you want IPv6, using the server's IPv6 address)

## 3. Bootstrap the server (one time)
```
ssh root@YOUR_SERVER_IP 'bash -s' < deploy/setup-server.sh
```

## 4. Wire up nginx
```
ssh root@YOUR_SERVER_IP
cp /var/www/ezzohub/deploy/nginx-ezzohub.conf /etc/nginx/sites-available/ezzohub.conf
ln -s /etc/nginx/sites-available/ezzohub.conf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

## 5. HTTPS (once DNS has propagated)
```
certbot --nginx -d ezzohub.com -d www.ezzohub.com
```
Certbot edits the nginx config in place to add the HTTPS server block and
HTTP->HTTPS redirect, and sets up auto-renewal (`systemctl status
certbot.timer` to confirm).

## 6. Google OAuth - required for Sign-In to work on the live domain
Google Cloud Console -> APIs & Services -> Credentials -> the OAuth 2.0
Client ID used in `sync.js`/`admin.js` -> Authorized JavaScript origins ->
add `https://ezzohub.com` and `https://www.ezzohub.com`. Without this,
Google Sign-In (Drive sync, and the admin dashboard) fails on the live
site even though it works fine locally.

## Redeploying after future changes
```
ssh deploy@YOUR_SERVER_IP 'bash -s' < deploy/deploy.sh
```
This just does `git pull` + reloads nginx. No build step needed.
