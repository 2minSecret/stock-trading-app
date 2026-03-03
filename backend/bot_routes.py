"""
Bot Routes - FastAPI endpoints for trading bot control
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
import logging
import os

from bot_manager import bot_manager

logger = logging.getLogger(__name__)

router = APIRouter()


class BotStartRequest(BaseModel):
    """Request model for starting a bot"""
    accountId: str = Field(..., description="Trading account ID")
    username: Optional[str] = Field(None, description="Auth username")
    password: Optional[str] = Field(None, description="Auth password")
    sessionToken: Optional[str] = Field(None, description="Existing Liquid session token (preferred when available)")
    customConfig: Optional[Dict[str, Any]] = Field(None, description="Optional custom bot configuration")


class BotStopRequest(BaseModel):
    """Request model for stopping a bot"""
    accountId: str = Field(..., description="Trading account ID")


class BotStatusRequest(BaseModel):
    """Request model for checking bot status"""
    accountId: str = Field(..., description="Trading account ID")


@router.post("/bot/start")
async def start_bot(request: BotStartRequest):
    """
    Start automated trading bot for an account.
    
    The bot will:
    - Trade NAS100 during 09:25-10:00 window
    - Use $100 purchase amount
    - Apply 20% stop-loss
    - Use smart profit exit strategy (1-3 min patience, 2% decline trigger)
    - Implement 32-minute cooldown between trades
    """
    try:
        logger.info(f"📥 Start bot request for account: {request.accountId}")

        has_credentials = bool(request.username and request.password)
        has_session_token = bool(request.sessionToken)
        if not has_credentials and not has_session_token:
            raise HTTPException(
                status_code=400,
                detail="Provide either sessionToken or username/password to start bot",
            )
        
        result = await bot_manager.start_bot(
            account_id=request.accountId,
            username=request.username,
            password=request.password,
            session_token=request.sessionToken,
            api_base_url=os.getenv("API_BASE_URL", "http://localhost:8001"),
            custom_config=request.customConfig
        )
        
        if result['success']:
            return {
                "success": True,
                "message": result['message'],
                "data": result
            }
        else:
            raise HTTPException(status_code=400, detail=result['message'])

    except HTTPException:
        raise
            
    except Exception as e:
        logger.error(f"❌ Error in start_bot endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bot/stop")
async def stop_bot(request: BotStopRequest):
    """
    Stop automated trading bot for an account.
    
    This will:
    - Stop the monitoring loop
    - Close any open positions
    - Return final statistics
    """
    try:
        logger.info(f"📥 Stop bot request for account: {request.accountId}")
        
        result = await bot_manager.stop_bot(account_id=request.accountId)
        
        if result['success']:
            return {
                "success": True,
                "message": result['message'],
                "data": result.get('final_stats', {})
            }
        else:
            raise HTTPException(status_code=404, detail=result['message'])
            
    except Exception as e:
        logger.error(f"❌ Error in stop_bot endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bot/force-stop")
async def force_stop_bot(request: BotStopRequest):
    """Force stop automated trading bot for an account."""
    try:
        logger.warning(f"📥 Force-stop bot request for account: {request.accountId}")

        result = await bot_manager.force_stop_bot(account_id=request.accountId)

        if result['success']:
            return {
                "success": True,
                "message": result['message'],
                "data": {}
            }

        raise HTTPException(status_code=404, detail=result['message'])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error in force_stop_bot endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bot/status")
async def get_bot_status(request: BotStatusRequest):
    """
    Get current status of a trading bot.
    
    Returns:
    - Bot state (idle, monitoring, in_position, cooldown, etc.)
    - Current position details (if any)
    - Profit/loss statistics
    - Trading history
    """
    try:
        logger.debug(f"📥 Status request for account: {request.accountId}")
        
        status = bot_manager.get_bot_status(request.accountId)
        
        if status is None:
            return {
                "success": False,
                "message": f"No bot found for account {request.accountId}",
                "data": None
            }
        
        return {
            "success": True,
            "message": "Bot status retrieved",
            "data": status
        }
            
    except Exception as e:
        logger.error(f"❌ Error in get_bot_status endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/bot/all")
async def get_all_bots():
    """
    Get status of all running bots.
    
    Returns dictionary with account_id -> status mapping.
    """
    try:
        logger.debug("📥 All bots status request")
        
        all_statuses = bot_manager.get_all_statuses()
        
        return {
            "success": True,
            "message": f"Found {len(all_statuses)} active bot(s)",
            "data": all_statuses
        }
            
    except Exception as e:
        logger.error(f"❌ Error in get_all_bots endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
