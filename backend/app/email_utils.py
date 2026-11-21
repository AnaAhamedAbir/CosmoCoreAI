import logging
from typing import Optional
from fastapi_mail import FastMail, MessageSchema, ConnectionConfig, MessageType
from pydantic import EmailStr
from app.core.config import settings

logger = logging.getLogger(__name__)


def _get_mail_config() -> Optional[ConnectionConfig]:
    """Build SMTP ConnectionConfig strictly from environment settings (no hardcoded credentials)."""
    if not (settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASSWORD):
        return None

    return ConnectionConfig(
        MAIL_USERNAME=settings.SMTP_USER,
        MAIL_PASSWORD=settings.SMTP_PASSWORD,
        MAIL_FROM=settings.SMTP_FROM or settings.SMTP_USER,
        MAIL_PORT=settings.SMTP_PORT,
        MAIL_SERVER=settings.SMTP_HOST,
        MAIL_STARTTLS=settings.SMTP_STARTTLS,
        MAIL_SSL_TLS=settings.SMTP_SSL_TLS,
        USE_CREDENTIALS=True,
        VALIDATE_CERTS=True,
    )


async def send_reset_email(email: EmailStr, token: str) -> bool:
    """Send a password reset email using configured SMTP settings."""
    conf = _get_mail_config()
    if conf is None:
        logger.warning(
            "[EmailUtils] SMTP credentials are not configured (SMTP_HOST/SMTP_USER/SMTP_PASSWORD). "
            "Skipping password reset email dispatch."
        )
        return False

    base_url = (settings.FRONTEND_URL or "http://localhost:2026").rstrip("/")
    reset_link = f"{base_url}/reset-password?token={token}"

    html = f"""
    <h3>Password Reset Request</h3>
    <p>Hello,</p>
    <p>We received a request to reset your password for {settings.PROJECT_NAME}.</p>
    <p>Click the link below to reset it (valid for 15 minutes):</p>
    <br>
    <a href="{reset_link}" style="padding: 10px 20px; background-color: #6366F1; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a>
    <br><br>
    <p>If you did not request this, please ignore this email.</p>
    """

    message = MessageSchema(
        subject=f"Reset Your {settings.PROJECT_NAME} Password",
        recipients=[email],
        body=html,
        subtype=MessageType.html,
    )

    fm = FastMail(conf)
    await fm.send_message(message)
    return True


async def send_verification_email(email: EmailStr, otp_code: str) -> bool:
    """Send a 6-digit email verification code using configured SMTP settings."""
    conf = _get_mail_config()
    if conf is None:
        logger.info(
            f"[EmailUtils] SMTP not configured. Dev verification OTP for {email}: {otp_code}"
        )
        return False

    html = f"""
    <h3>Verify Your {settings.PROJECT_NAME} Email</h3>
    <p>Hello,</p>
    <p>Use the verification code below to activate your account (valid for 15 minutes):</p>
    <div style="font-size: 24px; font-weight: bold; letter-spacing: 6px; padding: 12px 18px; background: #111827; color: #22d3ee; display: inline-block; border-radius: 8px;">
        {otp_code}
    </div>
    <br><br>
    <p>If you did not create this account, please ignore this email.</p>
    """

    message = MessageSchema(
        subject=f"{settings.PROJECT_NAME} Verification Code: {otp_code}",
        recipients=[email],
        body=html,
        subtype=MessageType.html,
    )

    fm = FastMail(conf)
    await fm.send_message(message)
    return True
