"""
Sole Owner Bootstrap Module
===========================
Safely creates or promotes the single platform Owner (is_superuser=True, is_pro=True)
from environment configuration, while preventing accidental creation of multiple owners.
"""

import logging
from typing import Optional
from sqlalchemy.orm import Session

from app import models, crud
from app.core import security

logger = logging.getLogger(__name__)


def ensure_sole_owner(
    db: Session,
    email: str,
    password: Optional[str] = None,
    full_name: str = "Platform Owner",
    demote_others: bool = False,
) -> models.User:
    """
    Ensure a single designated Owner account exists with is_superuser=True & is_pro=True.

    - If another superuser already exists with a different email and `demote_others=False`,
      raises RuntimeError so a second owner is never silently created.
    - If `demote_others=True`, demotes all other superusers before promoting the target email.
    """
    normalized_email = (email or "").strip().lower()
    if not normalized_email:
        raise ValueError("Owner email must not be empty")

    existing_superusers = db.query(models.User).filter(models.User.is_superuser == True).all()
    other_superusers = [u for u in existing_superusers if (u.email or "").strip().lower() != normalized_email]

    if other_superusers and not demote_others:
        other_emails = ", ".join(u.email for u in other_superusers)
        raise RuntimeError(
            f"Another superuser already exists ({other_emails}). "
            "Pass demote_others=True to transfer sole ownership."
        )

    if demote_others:
        for other in other_superusers:
            other.is_superuser = False
            logger.warning(f"[OwnerBootstrap] Demoted previous superuser: {other.email}")

    owner = crud.get_user_by_email(db, email=normalized_email)
    if owner:
        owner.is_superuser = True
        owner.is_pro = True
        owner.plan_tier = "enterprise"
        owner.is_active = True
        owner.is_email_verified = True
        if password:
            owner.hashed_password = security.get_password_hash(password)
        if full_name and not owner.full_name:
            owner.full_name = full_name
        db.commit()
        db.refresh(owner)
        logger.info(f"[OwnerBootstrap] Verified sole owner account: {owner.email}")
        return owner

    if not password:
        raise ValueError("Password is required when creating a new owner account")

    owner = models.User(
        email=normalized_email,
        full_name=full_name,
        hashed_password=security.get_password_hash(password),
        is_active=True,
        is_pro=True,
        plan_tier="enterprise",
        is_superuser=True,
        is_email_verified=True,
    )
    db.add(owner)
    db.commit()
    db.refresh(owner)
    logger.info(f"[OwnerBootstrap] Created sole owner account: {owner.email}")
    return owner
