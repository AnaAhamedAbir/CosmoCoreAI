import os
import json
import asyncio
import tempfile
import urllib.parse
import re
from bs4 import BeautifulSoup
import httpx
import uuid

from app.core.config import settings
from app.services.ai_service import ai_service
import logging

logger = logging.getLogger(__name__)

class TelegramAIAgent:
    """
    Dedicated AI Agent for processing High Impact Telegram News Alerts.
    Features: Article Scraping, Gemini Generative Summaries, Smart Tagging, Audio Generation.
    """

    async def fetch_article_text(self, url: str) -> str:
        """Lightweight scrape to get article body or fallback to snippet"""
        try:
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True, headers=headers) as client:
                res = await client.get(url)
                if res.status_code == 200:
                    soup = BeautifulSoup(res.text, 'lxml')
                    # Just grab paragraphs to pass to LLM
                    paragraphs = []
                    for p in soup.find_all('p', limit=10):
                        text = p.get_text(strip=True)
                        if len(text) > 40:
                            paragraphs.append(text)
                    return " ".join(paragraphs)
        except Exception as e:
            logger.warning(f"Failed to scrape {url} (fallback to headline): {e}")
        return ""

    async def get_ai_insights(self, title: str, url: str) -> dict:
        """
        Uses Gemini to generate Bengali Summary, Trading Verdict, and Hashtags.
        """
        article_text = await self.fetch_article_text(url)
        content_to_analyze = f"Headline: {title}\nArticle Snippet: {article_text[:1500]}"
        
        system_prompt = """
        You are an elite Crypto AI Assistant. 
        Analyze the provided news headline and snippet.
        Provide your response strictly in the following JSON format ONLY:
        {
            "bengali_summary": "2 bullet points in Bengali summarizing the core event, strictly start each with '• '",
            "trading_verdict": "A 1-sentence tip in Bengali about its market impact (e.g., Bullish, Bearish, or Neutral warning)",
            "hashtags": "List of 2-4 exact ticker/coin hashtags related to this news (e.g., #BTC #SOL)"
        }
        Return ONLY valid JSON.
        """
        
        try:
            # Re-using the private _route_request method from ai_service safely
            raw_response = await ai_service._route_request(system_prompt, content_to_analyze, provider=None)
            parsed = ai_service._clean_and_parse_json(raw_response)
            
            # Basic validation
            if "bengali_summary" in parsed and "trading_verdict" in parsed:
                return parsed
                
        except Exception as e:
            logger.error(f"Gemini Insight Generation failed: {e}")
            
        return {
            "bengali_summary": f"• {title}",
            "trading_verdict": "মার্কেট ইমপ্যাক্ট বিশ্লেষণ করা সম্ভব হয়নি।",
            "hashtags": "#CryptoNews"
        }

    def _clean_tts_text(self, text: str) -> str:
        """Strip HTML tags, markdown, bullet markers, URLs, and excess symbols for speech synthesis."""
        if not text:
            return ""
        if isinstance(text, list):
            text = " ".join([str(t) for t in text])
        elif not isinstance(text, str):
            text = str(text)

        # Remove HTML tags
        clean = re.sub(r'<[^>]+>', ' ', text)
        # Remove URLs
        clean = re.sub(r'https?://\S+', '', clean)
        # Remove markdown bold/italics/backticks/hashtags
        clean = re.sub(r'[*_`#~]', ' ', clean)
        # Remove bullet symbols like • or - or numbered bullets
        clean = re.sub(r'^[•\-\*\d+\.]+\s*', ' ', clean, flags=re.MULTILINE)
        # Replace multiple whitespace / newlines with single space
        clean = re.sub(r'\s+', ' ', clean).strip()
        return clean

    async def generate_voice_note(self, text: str) -> str:
        """
        Converts text to speech using Microsoft Edge Neural TTS with retries and voice fallback.
        Returns the path to the temporary mp3 file or None if synthesis fails.
        """
        cleaned_text = self._clean_tts_text(text)
        # Must have at least some spoken word characters
        if not cleaned_text or not re.search(r'[\w\u0980-\u09FF]', cleaned_text):
            logger.debug("TTS skipped: text is empty or contains no speakable characters.")
            return None

        # Truncate to maximum 800 characters to avoid socket timeout
        if len(cleaned_text) > 800:
            cleaned_text = cleaned_text[:800]

        # Determine language & candidate voices
        has_bengali = bool(re.search(r'[\u0980-\u09FF]', cleaned_text))
        if has_bengali:
            candidate_voices = [
                "bn-BD-NabanitaNeural",
                "bn-BD-PradeepNeural",
                "bn-IN-BashkarNeural",
                "bn-IN-TanishaaNeural",
            ]
        else:
            candidate_voices = [
                "en-US-ChristopherNeural",
                "en-US-JennyNeural",
                "en-US-GuyNeural",
                "bn-BD-NabanitaNeural",
            ]

        try:
            import edge_tts
        except ImportError:
            logger.warning("edge-tts is not installed. Skipping audio generation.")
            return None

        filename = os.path.join(tempfile.gettempdir(), f"{uuid.uuid4()}_news.mp3")

        for attempt, voice in enumerate(candidate_voices):
            try:
                communicate = edge_tts.Communicate(cleaned_text, voice)
                await communicate.save(filename)

                # Verify file was written and is non-empty
                if os.path.exists(filename) and os.path.getsize(filename) > 0:
                    return filename
                else:
                    if os.path.exists(filename):
                        os.remove(filename)
            except Exception as e:
                err_msg = str(e)
                logger.debug(f"Neural Audio attempt {attempt + 1} with voice '{voice}' failed: {err_msg}")
                if attempt < len(candidate_voices) - 1:
                    await asyncio.sleep(0.5 * (attempt + 1))
                continue

        logger.warning(f"Neural Audio Generation skipped: all {len(candidate_voices)} candidate voices failed.")
        return None

telegram_ai_agent = TelegramAIAgent()
