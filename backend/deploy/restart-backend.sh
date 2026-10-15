#!/bin/sh
# Certbot deploy hook: runs automatically after every successful cert renewal (certbot calls
# every script in /etc/letsencrypt/renewal-hooks/deploy/). The backend only reads
# SSL_KEY_PATH/SSL_CERT_PATH at startup, so it has to restart to pick up a renewed cert.
#
# Install:
#   sudo cp restart-backend.sh /etc/letsencrypt/renewal-hooks/deploy/
#   sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/restart-backend.sh

systemctl restart optician-backend
