from pydantic_settings import BaseSettings
from typing import List, Union, Optional
from pydantic import AnyHttpUrl, validator, field_validator
import os

_DEFAULT_SECRET_KEY = "super_secret_cosmo_quant_key_change_this_in_prod"
_DEFAULT_ENCRYPTION_KEY = "Jq-w5yXp3zQ4R1t2E8y9U0i7O6p5L4k3J2h1G0f9D8s="


class Settings(BaseSettings):
    PROJECT_NAME: str = "CosmoQuantAI"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"  # "development" | "staging" | "production"
    FRONTEND_URL: str = "http://localhost:2026"
    TRUST_PROXY_HEADERS: bool = True
    TRUST_CLOUDFLARE_HEADER: bool = False  # Enable ONLY after locking port 80/443 strictly to Cloudflare IPs
    REQUIRE_EMAIL_VERIFICATION: bool = False
    ENABLE_API_DOCS: bool = False  # Keep Swagger/OpenAPI disabled by default to hide endpoint map
    ENABLE_METRICS: bool = False   # Keep Prometheus /metrics disabled publicly by default

    # Sole Owner Bootstrap (set via .env in production)
    OWNER_EMAIL: Optional[str] = None
    OWNER_PASSWORD: Optional[str] = None
    OWNER_FULL_NAME: str = "Platform Owner"

    # Security
    SECRET_KEY: str = _DEFAULT_SECRET_KEY
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Database
    # Using 'db' as hostname for docker-compose, but fallback to localhost
    DATABASE_URL: str = "postgresql://postgres:password@localhost:5432/cosmoquant_db"

    # CORS
    BACKEND_CORS_ORIGINS: List[str] = [
        "http://localhost:2026",
        "http://127.0.0.1:2026",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> Union[List[str], str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",") if i.strip()]
        elif isinstance(v, (list, str)):
            return v
        raise ValueError(v)

    # Redis/Celery
    CELERY_BROKER_URL: str = "redis://redis:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://redis:6379/0"
    REDIS_URL: str = "redis://redis:6379/0" # Added for previous fix related request

    # Encryption
    ENCRYPTION_KEY: str = _DEFAULT_ENCRYPTION_KEY

    # SMTP / Transactional Email (configured via .env)
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM: Optional[str] = None
    SMTP_STARTTLS: bool = True
    SMTP_SSL_TLS: bool = False

    # External APIs
    CRYPTOPANIC_API_KEY: Optional[str] = None

    # Reddit API
    REDDIT_CLIENT_ID: Optional[str] = None
    REDDIT_CLIENT_SECRET: Optional[str] = None
    REDDIT_USER_AGENT: str = "CosmoQuantAI/1.0"
    
    # ✅ AI / LLM Configuration (NEW)
    # Options: "gemini", "openai", "deepseek", "groq"
    LLM_PROVIDER: str = "groq" 
    
    # API Keys
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_API_KEY_2: Optional[str] = None  # Backup key for quota rotation
    OPENAI_API_KEY: Optional[str] = None
    DEEPSEEK_API_KEY: Optional[str] = None
    GROQ_API_KEY: Optional[str] = None
    GROQ_API_KEY_2: Optional[str] = None
    
    # Exchange API Keys
    BINANCE_API_KEY: Optional[str] = None
    BINANCE_SECRET_KEY: Optional[str] = None
    
    # News API Key
    NEWS_API_KEY: Optional[str] = None

    # CoinGecko API Key
    COINGECKO_API_KEY: Optional[str] = None

    # Financial Modeling Prep API Key
    FMP_API_KEY: Optional[str] = None

    # Etherscan API
    ETHERSCAN_API_KEY: Optional[str] = None

    # GitHub API Token (avoids 60 req/hr anonymous limit -> 5000 req/hr authenticated)
    GITHUB_TOKEN: Optional[str] = None
    
    # Custom Base URLs (Optional, for local LLMs or proxies)
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com"

    # Enterprise Features
    ENABLE_FINBERT: bool = True

    # Network Timeouts (Seconds)
    DEFAULT_HTTP_TIMEOUT: int = 30
    TELEGRAM_TIMEOUT: int = 40
    
    # Telegram Master Bot
    TELEGRAM_MASTER_BOT_TOKEN: Optional[str] = None
    TELEGRAM_MASTER_BOT_USERNAME: Optional[str] = None

    # SaaS Billing Providers (Optional until merchant keys are added)
    STRIPE_SECRET_KEY: Optional[str] = None
    STRIPE_WEBHOOK_SECRET: Optional[str] = None
    STRIPE_PRICE_ID_PRO_MONTHLY: Optional[str] = None
    STRIPE_PRICE_ID_PRO_YEARLY: Optional[str] = None
    NOWPAYMENTS_API_KEY: Optional[str] = None
    NOWPAYMENTS_IPN_SECRET: Optional[str] = None

    def validate_production_secrets(self) -> None:
        """
        Enforce non-default cryptographic secrets in production environments.
        Logs warnings in development so local dev continues smoothly.
        """
        import logging
        log = logging.getLogger(__name__)
        is_prod = str(self.ENVIRONMENT or "").strip().lower() in ("production", "prod")
        insecure = []
        if self.SECRET_KEY == _DEFAULT_SECRET_KEY or len(self.SECRET_KEY) < 24:
            insecure.append("SECRET_KEY")
        if self.ENCRYPTION_KEY == _DEFAULT_ENCRYPTION_KEY:
            insecure.append("ENCRYPTION_KEY")
        if "*" in self.BACKEND_CORS_ORIGINS:
            insecure.append("BACKEND_CORS_ORIGINS (wildcard '*' not allowed)")

        if insecure:
            msg = f"Insecure configuration detected for: {', '.join(insecure)}."
            if is_prod:
                raise RuntimeError(f"CRITICAL PRODUCTION CONFIG ERROR: {msg}")
            log.warning(f"⚠️ [Security] {msg} Override these in .env before SaaS deployment.")

    class Config:
        case_sensitive = True
        env_file = (".env", ".env.local")
        extra = "ignore" 

settings = Settings()
