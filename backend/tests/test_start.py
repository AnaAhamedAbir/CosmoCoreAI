import asyncio
from app.db.session import SessionLocal
from app.services.bot_manager import bot_manager
from app.models import Bot

async def test_start():
    db = SessionLocal()
    res = await bot_manager.start_bot(1, db)
    print("Start Result:", res)
    db.close()

if __name__ == "__main__":
    asyncio.run(test_start())
