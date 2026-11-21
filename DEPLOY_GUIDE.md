# CosmoQuantAI প্রোডাকশন SaaS ডিপ্লয়মেন্ট গাইড

এই গাইডটি অনুসরণ করে আপনি যেকোনো Ubuntu/Debian VPS সার্ভারে আপনার প্রোজেক্টটি সম্পূর্ণ প্রোডাকশন SaaS হিসেবে লাইভ করতে পারবেন।

---

## ১. লঞ্চের আগে `.env` চেকলিস্ট (`ENVIRONMENT=production` করার আগে)

ডোমেইন কেনার পর আপনার সার্ভারের `.env` এবং `backend/.env` ফাইলে নিচের মানগুলো প্রোডাকশন অনুযায়ী আপডেট করুন:

- **প্রোডাকশন মোড ও সিক্রেট কী:**
  - `ENVIRONMENT=production`
  - `SECRET_KEY` — অন্তত ৩২+ অক্ষরের নতুন র‍্যান্ডম কী দিন (তৈরি করার কমান্ড: `openssl rand -hex 32`)
  - `ENCRYPTION_KEY` — নতুন Fernet কী দিন (তৈরি করার কমান্ড: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`)
- **ডোমেইন ও CORS:**
  - `FRONTEND_URL=https://yourdomain.com`
  - `BACKEND_CORS_ORIGINS=["https://yourdomain.com","https://www.yourdomain.com"]`
- **ইমেইল সার্ভার (OTP ও পাসওয়ার্ড রিসেটের জন্য):**
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` (যেমন Resend, Brevo, বা Gmail App Password)
- **পেমেন্ট গেটওয়ে (কার্ড ও ক্রিপ্টো সাবস্ক্রিপশনের জন্য):**
  - Stripe (Card): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PRO_MONTHLY`, `STRIPE_PRICE_ID_PRO_YEARLY`
  - NOWPayments (Crypto): `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`
  - Stripe Webhook URL: `https://yourdomain.com/api/v1/billing/webhook/stripe`
  - NOWPayments IPN Callback URL: `https://yourdomain.com/api/v1/billing/webhook/nowpayments`

---

## ২. VPS সার্ভারে Git থেকে ক্লোন করে প্রোডাকশন স্ট্যাক চালু করা

সার্ভারে Docker ও Docker Compose ইন্সটল থাকলে নিচের কমান্ডগুলো চালান:

```bash
git clone https://github.com/AnaAhamedAbir/CosmoCoreAI.git
cd CosmoCoreAI
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

> **নোট:** `docker-compose.prod.yml` ব্যবহার করলে `8000` (Backend) ও `2026` (Frontend) পোর্ট সরাসরি পাবলিক ইন্টারনেটে বন্ধ থাকে এবং সব ট্রাফিক নিরাপদভাবে `nginx` (`80`/`443`)-এর মাধ্যমে যায়।

---

## ৩. Sole-Owner (মালিক) হিসেবে অটো-লগইন ও অ্যাডমিন কন্ট্রোল

- সার্ভার প্রথমবার চালু হলেই ব্যাকএন্ড অটোমেটিক Alembic ডেটাবেস মাইগ্রেশন (`g7b8c9d0e1f2`) রান করবে এবং `.env`-এর `OWNER_EMAIL` ও `OWNER_PASSWORD` থেকে আপনার **Sole Owner (`is_superuser=True`)** অ্যাকাউন্ট তৈরি বা ভেরিফাই করে নেবে।
- কোনো আলাদা রেজিস্ট্রেশন ছাড়াই সরাসরি `https://yourdomain.com`-এর **Log In** বাটন থেকে আপনার ইমেইল ও পাসওয়ার্ড দিয়ে লগইন করতে পারবেন।
- লগইন করার পর সাইডবার (`Owner Command` -> **Owner Admin**) অথবা প্রোফাইল মেনু থেকে `/admin` (**Owner Admin Console**)-এ ঢুকে সব ইউজার, প্ল্যান, লাইভ বট, Kill Switch, Maintenance Mode ও Audit Log নিয়ন্ত্রণ করতে পারবেন।

---

## ৪. ডোমেইনে SSL / HTTPS চালু করা

### পদ্ধতি ক: Cloudflare ব্যবহার করলে (সবচেয়ে সহজ)
1. আপনার ডোমেইনের DNS-এ VPS-এর IP দিয়ে একটি `A` রেকর্ড যোগ করুন এবং Cloudflare Proxy (**Orange Cloud**) অন রাখুন।
2. Cloudflare Dashboard থেকে **SSL/TLS Mode** `Flexible` অথবা `Full` সিলেক্ট করুন।
3. `nginx/nginx.prod.conf` আগে থেকেই পোর্ট `80` এবং `X-Forwarded-Proto` প্রক্সি হেডারসহ প্রস্তুত আছে, তাই বাড়তি কনফিগ ছাড়াই `https://` চালু হয়ে যাবে।

### পদ্ধতি খ: সরাসরি Let's Encrypt SSL ব্যবহার করলে
1. সার্ভার থেকে ডোমেইনের জন্য সার্টিফিকেট ইস্যু করে `./certbot/conf` ফোল্ডারে রাখুন।
2. এরপর `nginx/nginx.prod.conf` ফাইলের নিচের দিকে থাকা পোর্ট `443 ssl http2` সার্ভার ব্লকটি আনকমেন্ট করে `docker compose -f docker-compose.yml -f docker-compose.prod.yml restart nginx` চালান।
