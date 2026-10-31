"""Simulated fee schedule (shown in the order ticket and on confirmations).

    Stocks / ETFs  $0 commission. Sells pay pass-through regulatory fees:
                   SEC Section 31 fee on proceeds and FINRA Trading Activity Fee per share.
    Options        $0.65 per contract.
    Crypto         0.50% of notional (in line with retail crypto spreads/fees).
Rates are configuration, not live regulatory values.
"""
from __future__ import annotations

from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
from typing import Dict

D = Decimal
SCHEDULE = {
    "equity_commission": D("0"),
    "sec_fee_rate": D("0.0000278"),          # per $ of sale proceeds
    "finra_taf_per_share": D("0.000166"),
    "finra_taf_max": D("8.30"),
    "option_per_contract": D("0.65"),
    "crypto_rate": D("0.005"),
}


def _ceil_cents(x: Decimal) -> Decimal:
    return x.quantize(D("0.01"), rounding=ROUND_CEILING)


def compute(asset_class: str, is_sell: bool, qty: Decimal, gross: Decimal) -> Dict[str, Decimal]:
    """Itemised fees for one fill. `gross` = qty * price * multiplier (dollars)."""
    items: Dict[str, Decimal] = {}
    if asset_class in ("stock", "etf"):
        if is_sell and gross > 0:
            items["sec_fee"] = _ceil_cents(gross * SCHEDULE["sec_fee_rate"])
            items["finra_taf"] = min(SCHEDULE["finra_taf_max"], _ceil_cents(qty * SCHEDULE["finra_taf_per_share"]))
    elif asset_class == "option":
        items["commission"] = (qty * SCHEDULE["option_per_contract"]).quantize(D("0.01"))
    elif asset_class == "crypto":
        items["crypto_fee"] = max(D("0.01"), (gross * SCHEDULE["crypto_rate"]).quantize(D("0.01"), rounding=ROUND_HALF_UP))
    items = {k: v for k, v in items.items() if v > 0}
    items["total"] = sum(items.values(), D("0"))
    return items


def estimate_total(asset_class: str, is_sell: bool, qty: Decimal, price: Decimal, multiplier: int) -> Decimal:
    return compute(asset_class, is_sell, qty, qty * price * multiplier)["total"]
