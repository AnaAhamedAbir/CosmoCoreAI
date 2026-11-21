from datetime import timedelta
from typing import Any, Optional
import logging
from fastapi import APIRouter, Depends, HTTPException, Header, Form, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.api import deps
from app.core import security
from app.core.config import settings
from app.core.rate_limiter import rate_limit_by_ip
from app.core.totp import (
    build_otpauth_uri,
    generate_numeric_otp,
    generate_totp_secret,
    verify_totp_code,
)
from app import utils, email_utils

router = APIRouter()
logger = logging.getLogger(__name__)


def _store_email_otp(email: str, otp_code: str, ttl_seconds: int = 900) -> None:
    try:
        r = utils.get_redis_client()
        r.set(f"email_otp:{email.strip().lower()}", otp_code, ex=ttl_seconds)
    except Exception as e:
        logger.debug(f"[Auth] Failed to store email OTP in Redis: {e}")


def _verify_and_consume_email_otp(email: str, otp_code: str) -> bool:
    try:
        r = utils.get_redis_client()
        key = f"email_otp:{email.strip().lower()}"
        stored = r.get(key)
        if stored is None:
            return False
        if isinstance(stored, bytes):
            stored = stored.decode("utf-8")
        if str(stored).strip() == str(otp_code).strip():
            r.delete(key)
            return True
        return False
    except Exception as e:
        logger.debug(f"[Auth] Failed to verify email OTP from Redis: {e}")
        return False


@router.post(
    "/register",
    response_model=schemas.UserResponse,
    dependencies=[Depends(rate_limit_by_ip("auth_register", max_requests=10, window_seconds=300))],
)
async def register_user(user: schemas.UserCreate, db: Session = Depends(deps.get_db)):
    normalized_email = user.email.strip().lower()
    db_user = crud.get_user_by_email(db, email=normalized_email)
    if db_user:
        raise HTTPException(
            status_code=400,
            detail="Email already registered",
        )
    user_payload = schemas.UserCreate(
        email=normalized_email,
        password=user.password,
        full_name=user.full_name,
    )
    created = crud.create_user(db=db, user=user_payload)

    otp_code = generate_numeric_otp(6)
    _store_email_otp(normalized_email, otp_code)
    try:
        await email_utils.send_verification_email(normalized_email, otp_code)
    except Exception as e:
        logger.warning(f"[Auth] Verification email dispatch failed (non-fatal): {e}")

    resp = schemas.UserResponse.model_validate(created)
    resp.email_verification_required = bool(settings.REQUIRE_EMAIL_VERIFICATION)
    return resp


@router.post(
    "/verify-email",
    dependencies=[Depends(rate_limit_by_ip("auth_verify_email", max_requests=15, window_seconds=300))],
)
def verify_email(request: schemas.VerifyEmailRequest, db: Session = Depends(deps.get_db)):
    normalized_email = request.email.strip().lower()
    user = crud.get_user_by_email(db, email=normalized_email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_email_verified:
        return {"message": "Email already verified"}

    if not _verify_and_consume_email_otp(normalized_email, request.code):
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")

    user.is_email_verified = True
    db.commit()
    return {"message": "Email verified successfully"}


@router.post(
    "/resend-verification",
    dependencies=[Depends(rate_limit_by_ip("auth_resend_otp", max_requests=5, window_seconds=300))],
)
async def resend_verification(request: schemas.ResendVerificationRequest, db: Session = Depends(deps.get_db)):
    normalized_email = request.email.strip().lower()
    user = crud.get_user_by_email(db, email=normalized_email)
    if not user or user.is_email_verified:
        return {"message": "If the account exists and is unverified, a verification code has been sent."}

    otp_code = generate_numeric_otp(6)
    _store_email_otp(normalized_email, otp_code)
    try:
        await email_utils.send_verification_email(normalized_email, otp_code)
    except Exception as e:
        logger.warning(f"[Auth] Resend verification email failed: {e}")
    return {"message": "If the account exists and is unverified, a verification code has been sent."}


@router.post(
    "/login",
    response_model=schemas.Token,
    dependencies=[Depends(rate_limit_by_ip("auth_login", max_requests=20, window_seconds=60))],
)
def login(
    user_credentials: OAuth2PasswordRequestForm = Depends(),
    x_2fa_code: Optional[str] = Header(default=None, alias="X-2FA-Code"),
    otp_code: Optional[str] = Form(default=None),
    db: Session = Depends(deps.get_db),
):
    # Swagger Form 'username' field maps to email
    user = crud.get_user_by_email(db, email=user_credentials.username.strip().lower())

    if not user or not security.verify_password(user_credentials.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid Credentials",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is suspended or inactive",
        )

    if settings.REQUIRE_EMAIL_VERIFICATION and not user.is_email_verified and not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="EMAIL_NOT_VERIFIED: Please verify your email address before logging in.",
        )

    if getattr(user, "is_2fa_enabled", False) and getattr(user, "totp_secret_encrypted", None):
        provided_code = (x_2fa_code or otp_code or "").strip()
        if not provided_code:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="2FA_REQUIRED",
            )
        try:
            secret = security.decrypt_key(user.totp_secret_encrypted)
        except Exception:
            raise HTTPException(status_code=500, detail="2FA configuration error")
        if not verify_totp_code(secret, provided_code):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="INVALID_2FA_CODE",
            )

    access_token = security.create_access_token(
        data={"sub": user.email, "user_id": user.id, "is_superuser": bool(user.is_superuser)}
    )
    refresh_token = security.create_refresh_token(data={"sub": user.email})

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
    }


@router.post("/2fa/setup", response_model=schemas.TwoFactorSetupResponse)
def setup_2fa(
    current_user: models.User = Depends(deps.get_current_user),
):
    """Generate a new TOTP secret and otpauth URI (stored temporarily in Redis until verified)."""
    secret = generate_totp_secret()
    encrypted_pending = security.encrypt_key(secret)
    try:
        r = utils.get_redis_client()
        r.set(f"pending_2fa:{current_user.id}", encrypted_pending, ex=600)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Redis required for 2FA setup: {e}")

    return {
        "secret": secret,
        "otpauth_uri": build_otpauth_uri(current_user.email, secret, issuer=settings.PROJECT_NAME),
    }


@router.post("/2fa/enable")
def enable_2fa(
    payload: schemas.TwoFactorVerifyRequest,
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user),
):
    """Verify the authenticator 6-digit code and permanently activate 2FA for the user."""
    try:
        r = utils.get_redis_client()
        pending_key = f"pending_2fa:{current_user.id}"
        encrypted_pending = r.get(pending_key)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"2FA verification unavailable: {e}")

    if not encrypted_pending:
        raise HTTPException(status_code=400, detail="2FA setup session expired. Please restart setup.")

    if isinstance(encrypted_pending, bytes):
        encrypted_pending = encrypted_pending.decode("utf-8")

    secret = security.decrypt_key(encrypted_pending)
    if not verify_totp_code(secret, payload.code):
        raise HTTPException(status_code=400, detail="Invalid 6-digit authenticator code")

    current_user.totp_secret_encrypted = encrypted_pending
    current_user.is_2fa_enabled = True
    db.commit()
    try:
        r.delete(pending_key)
    except Exception:
        pass
    return {"message": "Two-Factor Authentication enabled successfully", "is_2fa_enabled": True}


@router.post("/2fa/disable")
def disable_2fa(
    payload: schemas.TwoFactorDisableRequest,
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user),
):
    """Disable 2FA after verifying both account password and current TOTP code."""
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=403, detail="Invalid password")

    if current_user.is_2fa_enabled and current_user.totp_secret_encrypted:
        secret = security.decrypt_key(current_user.totp_secret_encrypted)
        if not verify_totp_code(secret, payload.code):
            raise HTTPException(status_code=403, detail="Invalid 2FA code")

    current_user.is_2fa_enabled = False
    current_user.totp_secret_encrypted = None
    db.commit()
    return {"message": "Two-Factor Authentication disabled", "is_2fa_enabled": False}


@router.post("/refresh-token", response_model=schemas.Token)
def refresh_access_token(token_data: dict, db: Session = Depends(deps.get_db)):
    refresh_token = token_data.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=400, detail="Refresh token missing")

    payload = security.verify_token(refresh_token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    email = payload.get("sub")
    user = crud.get_user_by_email(db, email=email)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    new_access_token = security.create_access_token(
        data={"sub": user.email, "user_id": user.id, "is_superuser": bool(user.is_superuser)}
    )

    return {
        "access_token": new_access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
    }


@router.post(
    "/forgot-password",
    dependencies=[Depends(rate_limit_by_ip("auth_forgot_password", max_requests=5, window_seconds=300))],
)
async def forgot_password(request: schemas.ForgotPasswordRequest, db: Session = Depends(deps.get_db)):
    user = crud.get_user_by_email(db, email=request.email.strip().lower())
    if not user:
        return {"message": "If the email exists, a reset link has been sent."}

    reset_token = security.create_token(
        data={"sub": user.email, "type": "reset"},
        expires_delta=timedelta(minutes=15),
    )

    await email_utils.send_reset_email(request.email, reset_token)

    return {"message": "If the email exists, a reset link has been sent."}


@router.post("/reset-password")
def reset_password(request: schemas.ResetPasswordRequest, db: Session = Depends(deps.get_db)):
    payload = security.verify_token(request.token)
    if not payload or payload.get("type") != "reset":
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    email = payload.get("sub")
    user = crud.update_user_password(db, email, request.new_password)

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {"message": "Password has been reset successfully. Please login with new password."}
