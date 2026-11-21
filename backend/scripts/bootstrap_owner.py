"""
CLI Script to Bootstrap the Sole Platform Owner
===============================================
Usage:
    python -m scripts.bootstrap_owner --email owner@yourdomain.com --password "StrongPassword!"
Or via environment variables:
    OWNER_EMAIL=... OWNER_PASSWORD=... python -m scripts.bootstrap_owner
"""

import argparse
import sys
from app.core.config import settings
from app.core.owner_bootstrap import ensure_sole_owner
from app.db.session import SessionLocal


def main():
    parser = argparse.ArgumentParser(description="Create or verify the sole CosmoQuantAI platform owner.")
    parser.add_argument("--email", default=settings.OWNER_EMAIL, help="Owner email address")
    parser.add_argument("--password", default=settings.OWNER_PASSWORD, help="Owner password")
    parser.add_argument("--name", default=settings.OWNER_FULL_NAME, help="Owner display name")
    parser.add_argument(
        "--transfer-ownership",
        action="store_true",
        help="Demote any existing superuser(s) and transfer sole ownership to this email.",
    )
    args = parser.parse_args()

    if not args.email:
        print("Error: --email or OWNER_EMAIL env var is required.", file=sys.stderr)
        sys.exit(1)

    db = SessionLocal()
    try:
        owner = ensure_sole_owner(
            db=db,
            email=args.email,
            password=args.password,
            full_name=args.name,
            demote_others=args.transfer_ownership,
        )
        print(f"Sole owner ready: id={owner.id}, email={owner.email}, is_superuser={owner.is_superuser}, is_pro={owner.is_pro}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
