# CosmoQuantAI Production SaaS Deployment Guide

## 1. Pre-Launch `.env` Checklist (Before Switching to `ENVIRONMENT=production`)
Update your VPS `.env` and `backend/.env` with strong production credentials:
- `ENVIRONMENT=production`
- `SECRET_KEY` (at least 32+ random characters: `openssl rand -hex 32`)
- `ENCRYPTION_KEY` (valid Fernet key: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`)
- `FRONTEND_URL=https://yourdomain.com`
- `BACKEND_CORS_ORIGINS=["https://yourdomain.com","https://www.yourdomain.com"]`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` (for Email Verification OTP & Password Reset)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PRO_MONTHLY`, `STRIPE_PRICE_ID_PRO_YEARLY`
- `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`

## 2. Clone & Boot Production Stack on VPS (Ubuntu/Debian)
```bash
git clone https://github.com/AnaAhamedAbir/CosmoCoreAI.git
cd CosmoCoreAI
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## 3. Sole-Owner Access
On first startup, the backend runs Alembic migrations to the single unified head (`g7b8c9d0e1f2`) and automatically provisions your Sole Owner account from `OWNER_EMAIL` and `OWNER_PASSWORD`.
Log in directly at `https://yourdomain.com` and access `/admin` (**Owner Admin Console**) from the sidebar or profile menu.

## 4. SSL / HTTPS Setup
- If using **Cloudflare Proxy (Orange Cloud)**: Point DNS A record to your VPS IP with SSL/TLS set to **Flexible** or **Full** — Nginx listens on port `80` out of the box with `X-Forwarded-Proto` proxy trust enabled.
- If using **Let's Encrypt directly**: Issue certificates into `./certbot/conf` and uncomment the port `443` server block in `nginx/nginx.prod.conf`.
