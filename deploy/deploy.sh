#!/usr/bin/env bash
# Run on the server (as the 'deploy' user) whenever you've pushed new
# changes to GitHub and want the live site to pick them up:
#   ssh deploy@YOUR_SERVER_IP 'bash -s' < deploy/deploy.sh
set -euo pipefail
cd /var/www/ezzohub
git pull origin main
sudo systemctl reload nginx
echo "Deployed latest main."
