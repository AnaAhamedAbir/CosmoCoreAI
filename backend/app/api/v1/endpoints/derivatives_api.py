from fastapi import APIRouter, HTTPException
from app.services.derivatives_service import derivatives_service
from app.core.cache import cache

router = APIRouter()

@router.get("/funding-rate")
@cache(expire=60)
async def get_funding_rate(symbol: str = "BTC/USDT"):
    """
    Get the live funding rate for a given symbol.
    """
    try:
        return await derivatives_service.get_funding_rate(symbol)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/open-interest")
@cache(expire=60)
async def get_open_interest(symbol: str = "BTC/USDT"):
    """
    Get the live open interest for a given symbol.
    """
    try:
        return await derivatives_service.get_open_interest(symbol)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
