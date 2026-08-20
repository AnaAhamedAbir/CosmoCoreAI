from fastapi import APIRouter, HTTPException
from app.services.nlp_sentiment_service import nlp_sentiment_service
from app.core.cache import cache

router = APIRouter()

@router.get("/live-score")
@cache(expire=30)
async def get_live_nlp_score(symbol: str = "BTC"):
    """
    Get the live NLP sentiment score for a given asset.
    Combines Social (Twitter) and News sources.
    """
    try:
        return await nlp_sentiment_service.get_live_score(symbol)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
