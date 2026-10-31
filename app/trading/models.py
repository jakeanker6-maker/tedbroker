"""Order request models and constants."""
from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

ORDER_TYPES = ("market", "limit", "stop", "stop_limit", "trailing_stop")
TIFS = ("day", "gtc", "ioc", "fok")
BUY_SIDES = ("buy", "buy_to_open", "buy_to_cover", "buy_to_close")
SELL_SIDES = ("sell", "sell_to_close", "sell_short", "sell_to_open")
SIDES = BUY_SIDES + SELL_SIDES
# Sides that open short exposure. Enabled in Phase 2B (margin accounts / options level 1+).
SHORT_SIDES = ("sell_short", "sell_to_open", "buy_to_cover", "buy_to_close")

OPEN_STATUSES = ("new", "accepted", "triggered", "partially_filled")
FINAL_STATUSES = ("filled", "canceled", "expired", "rejected")


def is_buy(side: str) -> bool:
    return side in BUY_SIDES


class OrderRequest(BaseModel):
    client_order_id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=8, max_length=64)
    symbol: str = Field(..., min_length=1, max_length=32)
    asset_class: Optional[str] = Field(None, pattern="^(stock|etf|crypto|option)$")
    side: str
    qty: Optional[Decimal] = Field(None, gt=0)
    notional: Optional[Decimal] = Field(None, gt=0, description="Dollar amount (fractional market orders)")
    type: str = "market"
    limit_price: Optional[Decimal] = Field(None, gt=0)
    stop_price: Optional[Decimal] = Field(None, gt=0)
    trail_percent: Optional[Decimal] = Field(None, gt=0, le=50)
    trail_amount: Optional[Decimal] = Field(None, gt=0)
    tif: str = "day"
    extended_hours: bool = False

    @field_validator("side")
    @classmethod
    def _side(cls, v: str) -> str:
        v = v.lower()
        if v not in SIDES:
            raise ValueError(f"side must be one of {', '.join(SIDES)}")
        return v

    @field_validator("type")
    @classmethod
    def _type(cls, v: str) -> str:
        v = v.lower()
        if v not in ORDER_TYPES:
            raise ValueError(f"type must be one of {', '.join(ORDER_TYPES)}")
        return v

    @field_validator("tif")
    @classmethod
    def _tif(cls, v: str) -> str:
        v = v.lower()
        if v not in TIFS:
            raise ValueError(f"tif must be one of {', '.join(TIFS)}")
        return v

    @model_validator(mode="after")
    def _consistency(self):
        if (self.qty is None) == (self.notional is None):
            raise ValueError("Provide exactly one of qty or notional")
        if self.notional is not None and self.type != "market":
            raise ValueError("Dollar-amount orders must be market orders")
        if self.type in ("limit", "stop_limit") and self.limit_price is None:
            raise ValueError("limit_price is required for limit and stop-limit orders")
        if self.type in ("stop", "stop_limit") and self.stop_price is None:
            raise ValueError("stop_price is required for stop and stop-limit orders")
        if self.type == "trailing_stop" and (self.trail_percent is None) == (self.trail_amount is None):
            raise ValueError("Trailing stops need exactly one of trail_percent or trail_amount")
        if self.type not in ("limit", "stop_limit") and self.limit_price is not None:
            raise ValueError("limit_price only applies to limit and stop-limit orders")
        if self.extended_hours and self.type != "limit":
            raise ValueError("Extended-hours orders must be limit orders")
        return self


class ReplaceRequest(BaseModel):
    qty: Optional[Decimal] = Field(None, gt=0)
    limit_price: Optional[Decimal] = Field(None, gt=0)
    stop_price: Optional[Decimal] = Field(None, gt=0)
    tif: Optional[str] = None


class WatchlistCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)
    symbols: list = Field(default_factory=list, max_length=100)
