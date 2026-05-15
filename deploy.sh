#!/bin/bash
# ══════════════════════════════════════════════════
# NutriPulse — EC2 Deployment Script
# Usage: bash deploy.sh your-domain.com
# ══════════════════════════════════════════════════

set -e  # Stop on any error

DOMAIN=$1
PROJECT_DIR="/home/ubuntu/calorie-pwa"

if [ -z "$DOMAIN" ]; then
    echo "❌ ERROR: Please provide your domain."
    echo "   Usage: bash deploy.sh your-domain.com"
    exit 1
fi

echo "🚀 Starting NutriPulse deployment for domain: $DOMAIN"

# ─── 1. System Update ─────────────────────────────
echo "📦 Updating system..."
sudo apt update -y && sudo apt upgrade -y

# ─── 2. Install Dependencies ──────────────────────
echo "📦 Installing Nginx, Python, MySQL, Certbot..."
sudo apt install -y python3 python3-pip python3-venv nginx mysql-server \
    certbot python3-certbot-nginx

# ─── 3. MySQL Setup ───────────────────────────────
echo "🗄️  Setting up MySQL..."

# Load password from .env if it exists
if [ -f "$PROJECT_DIR/.env" ]; then
    export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
else
    echo "❌ ERROR: .env file not found at $PROJECT_DIR/.env"
    echo "   Please create it first: cp .env.example .env && nano .env"
    exit 1
fi

sudo mysql -e "CREATE DATABASE IF NOT EXISTS $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';"
sudo mysql -e "GRANT ALL PRIVILEGES ON $DB_NAME.* TO '$DB_USER'@'localhost';"
sudo mysql -e "FLUSH PRIVILEGES;"

# Import schema
echo "📋 Importing database schema..."
mysql -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < "$PROJECT_DIR/schema.sql"

# ─── 4. Python Virtual Environment ────────────────
echo "🐍 Setting up Python environment..."
cd "$PROJECT_DIR"
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# ─── 5. Systemd Service ───────────────────────────
echo "⚙️  Creating systemd service..."
sudo tee /etc/systemd/system/nutripulse.service > /dev/null <<EOF
[Unit]
Description=NutriPulse Flask App
After=network.target mysql.service

[Service]
User=ubuntu
WorkingDirectory=$PROJECT_DIR
EnvironmentFile=$PROJECT_DIR/.env
ExecStart=$PROJECT_DIR/venv/bin/gunicorn \\
    --workers 2 \\
    --bind 127.0.0.1:5000 \\
    --timeout 120 \\
    app:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable nutripulse
sudo systemctl start nutripulse

# ─── 6. Nginx Config ──────────────────────────────
echo "🌐 Configuring Nginx..."

# Replace YOUR_DOMAIN_HERE placeholder with actual domain
sudo sed "s/YOUR_DOMAIN_HERE/$DOMAIN/g" "$PROJECT_DIR/nginx.conf" \
    > /tmp/nutripulse_nginx.conf
sudo mv /tmp/nutripulse_nginx.conf /etc/nginx/sites-available/nutripulse

sudo ln -sf /etc/nginx/sites-available/nutripulse /etc/nginx/sites-enabled/nutripulse
sudo rm -f /etc/nginx/sites-enabled/default

# Test nginx config before reloading
sudo nginx -t
sudo systemctl reload nginx

# ─── 7. SSL Certificate via Let's Encrypt ─────────
echo "🔒 Getting SSL certificate from Let's Encrypt..."
sudo certbot --nginx -d "$DOMAIN" \
    --non-interactive \
    --agree-tos \
    --email "admin@$DOMAIN" \
    --redirect

# ─── 8. Restart Everything ────────────────────────
echo "🔄 Restarting services..."
sudo systemctl restart nutripulse
sudo systemctl reload nginx

# ─── Done ─────────────────────────────────────────
echo ""
echo "✅ Deployment complete!"
echo "🌍 Your app is live at: https://$DOMAIN"
echo ""
echo "Useful commands:"
echo "  sudo systemctl status nutripulse   → check Flask"
echo "  sudo journalctl -u nutripulse -f   → Flask logs"
echo "  sudo systemctl status nginx        → check Nginx"
echo "  sudo tail -f /var/log/nginx/nutripulse_error.log → Nginx errors"