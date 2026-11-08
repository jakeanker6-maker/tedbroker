from fastapi import APIRouter, HTTPException, Depends
from typing import List
from bson import ObjectId
from datetime import datetime

from app.database import get_collection, TRADERS_COLLECTION, USERS_COLLECTION
from app.schemas import ExpertTraderResponse, Trade
from app.auth import get_current_user_token
from app.post_generator import post_generator
from app.trading.trader_stats import active_copiers, effective_stats

router = APIRouter(prefix="/api/traders", tags=["traders"])


MIN_COPY_FLOOR = 10.0   # server-side minimum allocation (copy_engine.create_link)


def copier_count(trader_id: str) -> int:
    """Real number of copies on this trader right now (active or paused links)."""
    return active_copiers(trader_id)


def trader_helper(trader, copiers: int = 0) -> dict:
    """Format a trader for the directory.

    Performance figures (return, win rate, drawdown, AUM) are returned when the trader has a live
    track record computed from its simulated account (stats_live, stats_source "live") or when the
    platform team entered them (stats_admin, stats_source "admin"). Other figures stored on seed
    documents are not shown: they were never measured or entered.
    """
    live = bool(trader.get("stats_live"))
    # Figures typed in by an admin (stats_admin) are shown too; stats_source says where they came from.
    source = "live" if live else ("admin" if trader.get("stats_admin") else None)
    shown = source is not None

    # Effective figures: admin override (live traders) or computed/stored values. See trader_stats.
    eff = effective_stats(trader, copiers)

    def measured(key):
        return eff[key] if shown else None

    return {
        "id": str(trader["_id"]),
        "full_name": trader["full_name"],
        "profile_photo": trader.get("profile_photo") or "",
        "description": trader.get("description") or "",
        "specialization": trader.get("specialization") or "",
        "ytd_return": measured("ytd_return"),
        "win_rate": measured("win_rate"),
        "copiers": eff["copiers"],
        "minimum_copy_amount": float(trader.get("minimum_copy_amount") or MIN_COPY_FLOOR),
        "assets_under_management": measured("assets_under_management"),
        "max_drawdown": measured("max_drawdown"),
        "risk_score": trader.get("risk_score"),
        "trades": trader.get("trades", []) if live else [],
        "recent_trades": trader.get("recent_trades", []) if live else [],
        # Seeded posts (March 2026 seed text with invented likes) are not shown. Only trades from the
        # simulated account are published until real trader posting exists.
        "posts": [],
        "strategy_label": trader.get("strategy_label"),
        "stats_live": live,
        "stats_source": source,
        "stats_since": trader["stats_since"].isoformat() + "Z" if trader.get("stats_since") else None,
        "closed_trades": trader.get("closed_trades", 0) if live else 0,
    }


@router.get("/posts")
async def get_all_posts(current_user: dict = Depends(get_current_user_token)):
    """Get dynamically generated posts from all traders with varied sentiments"""
    import sys
    try:
        print(f"=== /api/traders/posts called - generating fresh posts ===", file=sys.stderr, flush=True)
        
        all_posts = post_generator.generate_all_posts()
        
        print(f"Generated {len(all_posts)} fresh posts", file=sys.stderr, flush=True)
        
        return all_posts
    except Exception as e:
        import traceback
        print(f"ERROR: {traceback.format_exc()}", file=sys.stderr, flush=True)
        raise HTTPException(status_code=500, detail=f"Error retrieving posts: {str(e)}")


@router.post("/posts/{post_id}/like")
async def like_post(post_id: str, current_user: dict = Depends(get_current_user_token)):
    """Like or unlike a post"""
    try:
        traders_collection = get_collection(TRADERS_COLLECTION)
        user_id = current_user["user_id"]
        
        found = False
        for trader in traders_collection.find():
            posts = trader.get("posts", [])
            for i, post in enumerate(posts):
                if post.get("id") == post_id:
                    found = True
                    likes = post.get("likes", [])
                    
                    if user_id in likes:
                        likes.remove(user_id)
                        action = "unliked"
                    else:
                        likes.append(user_id)
                        action = "liked"
                    
                    traders_collection.update_one(
                        {"_id": trader["_id"], "posts.id": post_id},
                        {"$set": {"posts.$.likes": likes}}
                    )
                    
                    return {
                        "success": True,
                        "action": action,
                        "post_id": post_id,
                        "like_count": len(likes)
                    }
        
        if not found:
            raise HTTPException(status_code=404, detail="Post not found")
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error liking post: {str(e)}")


@router.post("/posts/{post_id}/dislike")
async def dislike_post(post_id: str, current_user: dict = Depends(get_current_user_token)):
    """Dislike or undislike a post"""
    try:
        traders_collection = get_collection(TRADERS_COLLECTION)
        user_id = current_user["user_id"]
        
        found = False
        for trader in traders_collection.find():
            posts = trader.get("posts", [])
            for i, post in enumerate(posts):
                if post.get("id") == post_id:
                    found = True
                    dislikes = post.get("dislikes", [])
                    
                    if user_id in dislikes:
                        dislikes.remove(user_id)
                        action = "undisliked"
                    else:
                        dislikes.append(user_id)
                        action = "disliked"
                    
                    traders_collection.update_one(
                        {"_id": trader["_id"], "posts.id": post_id},
                        {"$set": {"posts.$.dislikes": dislikes}}
                    )
                    
                    return {
                        "success": True,
                        "action": action,
                        "post_id": post_id,
                        "dislike_count": len(dislikes)
                    }
        
        if not found:
            raise HTTPException(status_code=404, detail="Post not found")
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error disliking post: {str(e)}")


@router.get("/", response_model=List[ExpertTraderResponse])
async def get_all_traders(current_user: dict = Depends(get_current_user_token)):
    """
    Get all expert traders
    Requires authentication
    """
    try:
        traders_collection = get_collection(TRADERS_COLLECTION)
        traders = []

        for trader in traders_collection.find():
            traders.append(trader_helper(trader, copier_count(trader["_id"])))

        return traders
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving traders: {str(e)}")


@router.get("/{trader_id}", response_model=ExpertTraderResponse)
async def get_trader_by_id(trader_id: str, current_user: dict = Depends(get_current_user_token)):
    """
    Get a specific expert trader by ID
    Requires authentication
    """
    try:
        traders_collection = get_collection(TRADERS_COLLECTION)
        trader = traders_collection.find_one({"_id": ObjectId(trader_id)})

        if not trader:
            raise HTTPException(status_code=404, detail="Trader not found")

        return trader_helper(trader, copier_count(trader["_id"]))
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Error retrieving trader: {str(e)}")


@router.post("/select/{trader_id}")
async def select_trader(trader_id: str, current_user: dict = Depends(get_current_user_token)):
    """Start copying a trader (compatibility wrapper over POST /api/copy/links).
    Allocates the trader's minimum copy amount from the user's available cash."""
    import asyncio
    from decimal import Decimal
    from app.trading import copy_engine
    try:
        t = await asyncio.to_thread(copy_engine.trader_doc, trader_id)
        amount = Decimal(str(t.get("minimum_copy_amount") or 100))
        link = await asyncio.to_thread(copy_engine.create_link, current_user["user_id"], trader_id, amount)
    except copy_engine.CopyError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))
    count = await asyncio.to_thread(copy_engine.links().count_documents,
                                    {"user_id": current_user["user_id"], "status": {"$in": ["active", "paused"]}})
    return {"message": f"You're now copying {t['full_name']} with ${amount:,.2f}",
            "trader_id": trader_id, "trader_name": t["full_name"], "selected_traders_count": count,
            "link_id": str(link["_id"]), "allocation": f"{amount:.2f}"}


@router.delete("/unselect/{trader_id}")
async def unselect_trader(trader_id: str, current_user: dict = Depends(get_current_user_token)):
    """Stop copying a trader (compatibility wrapper over DELETE /api/copy/links/{id}):
    copy positions are closed at market and the cash returns to the user."""
    import asyncio
    from app.trading import copy_engine
    uid = current_user["user_id"]
    link = await asyncio.to_thread(copy_engine.links().find_one,
                                   {"user_id": uid, "trader_id": trader_id, "status": {"$in": ["active", "paused"]}})
    if not link:
        raise HTTPException(status_code=400, detail="You are not copying this trader")
    await asyncio.to_thread(copy_engine.stop, uid, str(link["_id"]))
    count = await asyncio.to_thread(copy_engine.links().count_documents,
                                    {"user_id": uid, "status": {"$in": ["active", "paused"]}})
    return {"message": f"Stopped copying {link.get('trader_name')}. Copy positions are being closed.",
            "trader_id": trader_id, "selected_traders_count": count}


@router.get("/selected/list")
async def get_selected_traders(current_user: dict = Depends(get_current_user_token)):
    """Traders the user is copying (from copy links), with their copy allocation."""
    import asyncio
    from app.trading import copy_engine
    uid = current_user["user_id"]
    await asyncio.to_thread(copy_engine.migrate_selected, uid)
    traders_collection = get_collection(TRADERS_COLLECTION)
    out = []
    for link in await asyncio.to_thread(lambda: list(copy_engine.links().find(
            {"user_id": uid, "status": {"$in": ["active", "paused"]}}))):
        try:
            trader = traders_collection.find_one({"_id": ObjectId(link["trader_id"])})
        except Exception:
            trader = None
        if trader:
            out.append({**trader_helper(trader, copier_count(trader["_id"])), "copy": await asyncio.to_thread(copy_engine.serialize, link)})
    return {"selected_traders": out, "count": len(out)}
