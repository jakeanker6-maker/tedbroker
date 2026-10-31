from fastapi import APIRouter, HTTPException
from typing import List, Optional
import httpx
import os
from datetime import datetime, timedelta
import logging

from app.routes.market import classify_article

router = APIRouter(prefix="/api/news", tags=["news"])
logger = logging.getLogger(__name__)

# Cache for news articles (simple in-memory cache)
news_cache = {
    'data': None,
    'timestamp': None,
    'cache_duration': 300  # 5 minutes cache
}


def is_cache_valid():
    """Check if cache is still valid"""
    if news_cache['data'] is None or news_cache['timestamp'] is None:
        return False
    return (datetime.now() - news_cache['timestamp']).seconds < news_cache['cache_duration']


async def fetch_from_newsapi(category: str = 'all'):
    """Fetch news from NewsAPI.org (free tier)"""
    api_key = os.getenv('NEWSAPI_KEY')
    if not api_key:
        return []

    try:
        # Map categories to NewsAPI queries
        query_map = {
            'all': 'trading OR investing OR stocks OR forex OR crypto',
            'markets': 'stock market OR financial markets',
            'crypto': 'cryptocurrency OR bitcoin OR ethereum',
            'stocks': 'stock market OR stocks OR shares',
            'forex': 'forex OR currency trading',
            'commodities': 'gold OR oil OR commodities'
        }

        query = query_map.get(category, query_map['all'])
        url = 'https://newsapi.org/v2/everything'
        params = {
            'q': query,
            'language': 'en',
            'sortBy': 'publishedAt',
            'pageSize': 20,
            'apiKey': api_key
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params)
            if response.status_code != 200:
                logger.error(f"NewsAPI HTTP {response.status_code}: {response.text[:200]}")
            if response.status_code == 200:
                data = response.json()
                articles = []
                for article in data.get('articles', []):
                    articles.append({
                        'title': article.get('title', ''),
                        'description': article.get('description', ''),
                        'url': article.get('url', ''),
                        'imageUrl': article.get('urlToImage', 'https://via.placeholder.com/400x200?text=News'),
                        'source': article.get('source', {}).get('name', 'Unknown'),
                        'publishedAt': article.get('publishedAt', ''),
                        'category': classify_article(article.get('title'), article.get('description')) if category == 'all' else category,
                        'featured': False
                    })
                return articles
    except Exception as e:
        logger.error(f"NewsAPI error: {e}")
    return []


async def fetch_from_cryptocompare():
    """Fetch crypto news from CryptoCompare (free, no key required)"""
    try:
        url = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN'
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
            if response.status_code == 200:
                data = response.json()
                articles = []
                for article in data.get('Data', [])[:15]:
                    articles.append({
                        'title': article.get('title', ''),
                        'description': article.get('body', '')[:200] + '...',
                        'url': article.get('url', ''),
                        'imageUrl': article.get('imageurl', 'https://via.placeholder.com/400x200?text=Crypto+News'),
                        'source': article.get('source', 'CryptoCompare'),
                        'publishedAt': datetime.fromtimestamp(article.get('published_on', 0)).isoformat(),
                        'category': 'crypto',
                        'featured': False
                    })
                return articles
    except Exception as e:
        logger.error(f"CryptoCompare error: {e}")
    return []


async def fetch_from_finnhub(category: str = 'general'):
    """Fetch news from Finnhub (free tier)"""
    api_key = os.getenv('FINNHUB_API_KEY')
    if not api_key:
        return []

    try:
        url = 'https://finnhub.io/api/v1/news'
        params = {
            'category': category,
            'token': api_key
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params)
            if response.status_code == 200:
                data = response.json()
                articles = []
                for article in data[:15]:
                    articles.append({
                        'title': article.get('headline', ''),
                        'description': article.get('summary', ''),
                        'url': article.get('url', ''),
                        'imageUrl': article.get('image', 'https://via.placeholder.com/400x200?text=Market+News'),
                        'source': article.get('source', 'Finnhub'),
                        'publishedAt': datetime.fromtimestamp(article.get('datetime', 0)).isoformat(),
                        'category': 'markets',
                        'featured': False
                    })
                return articles
    except Exception as e:
        logger.error(f"Finnhub error: {e}")
    return []


async def fetch_from_alphavantage():
    """Fetch news from Alpha Vantage (free tier)"""
    api_key = os.getenv('ALPHAVANTAGE_API_KEY')
    if not api_key:
        return []

    try:
        url = 'https://www.alphavantage.co/query'
        params = {
            'function': 'NEWS_SENTIMENT',
            'topics': 'financial_markets,technology',
            'apikey': api_key,
            'limit': 20
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params)
            if response.status_code == 200:
                data = response.json()
                articles = []
                for article in data.get('feed', []):
                    articles.append({
                        'title': article.get('title', ''),
                        'description': article.get('summary', '')[:200] + '...',
                        'url': article.get('url', ''),
                        'imageUrl': article.get('banner_image', 'https://via.placeholder.com/400x200?text=Financial+News'),
                        'source': article.get('source', 'Alpha Vantage'),
                        'publishedAt': article.get('time_published', ''),
                        'category': 'stocks',
                        'featured': False
                    })
                return articles
    except Exception as e:
        logger.error(f"Alpha Vantage error: {e}")
    return []


async def get_fallback_news():
    """Generate fallback news when APIs are unavailable"""
    return [
        {
            'title': 'Global Markets Show Mixed Performance Amid Economic Data',
            'description': 'Major stock indices displayed varied results as investors digest recent economic indicators and corporate earnings reports.',
            'url': '#',
            'imageUrl': 'https://via.placeholder.com/400x200?text=Market+Update',
            'source': 'Market News',
            'publishedAt': datetime.now().isoformat(),
            'category': 'markets',
            'featured': True
        },
        {
            'title': 'Cryptocurrency Market Sees Increased Volatility',
            'description': 'Bitcoin and major altcoins experience significant price movements as regulatory discussions continue globally.',
            'url': '#',
            'imageUrl': 'https://via.placeholder.com/400x200?text=Crypto+Markets',
            'source': 'Crypto News',
            'publishedAt': (datetime.now() - timedelta(hours=2)).isoformat(),
            'category': 'crypto',
            'featured': False
        },
        {
            'title': 'Forex Trading Strategies for Volatile Markets',
            'description': 'Expert traders share insights on navigating currency markets during periods of high volatility and uncertainty.',
            'url': '#',
            'imageUrl': 'https://via.placeholder.com/400x200?text=Forex+Trading',
            'source': 'Trading Insights',
            'publishedAt': (datetime.now() - timedelta(hours=5)).isoformat(),
            'category': 'forex',
            'featured': False
        },
        {
            'title': 'Tech Stocks Lead Market Rally Amid Positive Sentiment',
            'description': 'Technology sector shows strong performance with several major companies reporting better-than-expected earnings.',
            'url': '#',
            'imageUrl': 'https://via.placeholder.com/400x200?text=Tech+Stocks',
            'source': 'Stock Market News',
            'publishedAt': (datetime.now() - timedelta(hours=8)).isoformat(),
            'category': 'stocks',
            'featured': False
        },
        {
            'title': 'Gold Prices Surge on Economic Uncertainty',
            'description': 'Precious metals see increased demand as investors seek safe-haven assets amid global economic concerns.',
            'url': '#',
            'imageUrl': 'https://via.placeholder.com/400x200?text=Gold+Prices',
            'source': 'Commodities Today',
            'publishedAt': (datetime.now() - timedelta(hours=12)).isoformat(),
            'category': 'commodities',
            'featured': False
        }
    ]


@router.get("/articles")
async def get_news_articles(category: Optional[str] = 'all'):
    """
    Get news articles, optionally filtered by category

    Categories: all, markets, crypto, stocks, forex, commodities
    """
    try:
        # Check cache first
        if is_cache_valid() and news_cache['data']:
            all_articles = news_cache['data']
        else:
            # Fetch from multiple sources
            all_articles = []

            # Try CryptoCompare first (no API key needed)
            crypto_articles = await fetch_from_cryptocompare()
            all_articles.extend(crypto_articles)

            # Try NewsAPI if key is available
            newsapi_articles = await fetch_from_newsapi()
            all_articles.extend(newsapi_articles)

            # Try Finnhub if key is available
            finnhub_articles = await fetch_from_finnhub()
            all_articles.extend(finnhub_articles)

            # Try Alpha Vantage if key is available
            alphavantage_articles = await fetch_from_alphavantage()
            all_articles.extend(alphavantage_articles)

            if all_articles:
                news_cache['last_good'] = all_articles
            elif news_cache.get('last_good'):
                # Providers failed this round: keep serving the last real headlines.
                all_articles = list(news_cache['last_good'])
            else:
                # Nothing real has ever been fetched: no sample headlines. Empty list; re-check soon.
                all_articles = []

            # Mark first article as featured if none are featured
            if all_articles and not any(a.get('featured') for a in all_articles):
                all_articles[0]['featured'] = True

            # Update cache (samples expire after 60 seconds, real headlines after the normal window)
            news_cache['data'] = all_articles
            news_cache['timestamp'] = datetime.now()
            news_cache['cache_duration'] = 60 if not all_articles else 300

        # Filter by category if specified
        if category and category != 'all':
            filtered_articles = [a for a in all_articles if a.get('category') == category]
            return {'success': True, 'articles': filtered_articles, 'count': len(filtered_articles)}

        return {'success': True, 'articles': all_articles, 'count': len(all_articles)}

    except Exception as e:
        logger.error(f"Error fetching news: {e}")
        # Never substitute sample headlines: report the failure so the page says so.
        raise HTTPException(status_code=503, detail="News is unavailable right now.")


@router.get("/featured")
async def get_featured_news():
    """Get featured news articles"""
    try:
        result = await get_news_articles()
        featured = [a for a in result['articles'] if a.get('featured')]
        return {'success': True, 'articles': featured, 'count': len(featured)}
    except Exception as e:
        logger.error(f"Error fetching featured news: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch featured news")
