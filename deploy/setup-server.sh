#!/usr/bin/env bash
# Run ONCE on a fresh Hetzner CPX11 (Ubuntu 24.04), as root, over SSH:
#   ssh root@YOUR_SERVER_IP 'bash -s' < deploy/setup-server.sh
# or paste its contents directly into an SSH session.
set -euo pipefail

echo "== Updating system =="
apt-get update && apt-get -y upgrade

echo "== Creating non-root sudo user 'deploy' =="
if ! id -u deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" deploy
  usermod -aG sudo deploy
  mkdir -p /home/deploy/.ssh
  cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
  chown -R deploy:deploy /home/deploy/.ssh
  chmod 700 /home/deploy/.ssh
  chmod 600 /home/deploy/.ssh/authorized_keys
fi

echo "== Installing nginx, certbot, git, ufw =="
apt-get -y install nginx certbot python3-certbot-nginx git ufw

echo "== Configuring firewall (SSH + HTTP/HTTPS only) =="
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "== Cloning the site =="
mkdir -p /var/www
if [ ! -d /var/www/ezzohub ]; then
  git clone https://github.com/BraydonBudde/EvoBudget.git /var/www/ezzohub
fi
chown -R deploy:deploy /var/www/ezzohub

cat <<'EOF'

== Done. Remaining manual steps ==
1. Copy deploy/nginx-ezzohub.conf to /etc/nginx/sites-available/ezzohub.conf
   sudo ln -s /etc/nginx/sites-available/ezzohub.conf /etc/nginx/sites-enabled/
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo nginx -t && sudo systemctl reload nginx
2. Once ezzohub.com's DNS A record points at this server, run:
   sudo certbot --nginx -d ezzohub.com -d www.ezzohub.com
EOF
