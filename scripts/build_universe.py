"""Regenerate app/market_data/universe.json (tradable symbols for search & validation).

    venv/bin/python scripts/build_universe.py

Source: Finnhub /stock/symbol?exchange=US (needs FINNHUB_API_KEY). Keeps common
stocks, ADRs and ETPs listed on NYSE, Nasdaq, NYSE Arca, Cboe BZX and NYSE American.
Crypto pairs come from the curated CRYPTO list below. Popular symbols get a rank so
search shows the names people expect first.
"""
import json
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "app" / "market_data" / "universe.json"

POPULAR_STOCKS = """AAPL MSFT NVDA AMZN GOOGL META TSLA AVGO JPM V LLY UNH XOM MA COST HD PG JNJ NFLX AMD
ORCL CRM ADBE PEP KO WMT BAC DIS INTC CSCO QCOM T VZ PFE MRK ABBV CVX NKE MCD SBUX BA CAT GE IBM
UBER ABNB PYPL SHOP PLTR COIN HOOD SNOW MU AMAT TXN LOW GS MS C WFC SCHW BLK AXP F GM RIVN LCID
SOFI ARM SMCI DELL PANW CRWD NOW INTU ISRG AMGN GILD TMO DHR LMT RTX DE UPS FDX ROKU SPOT RBLX ZM
DKNG MSTR TSM BABA NIO GOOG XYZ""".split()

POPULAR_ETFS = """SPY QQQ VOO VTI IVV DIA IWM VT VXUS VEA VWO EFA EEM BND AGG TLT IEF SHY BNDX LQD HYG
GLD SLV USO DBC VNQ XLK XLF XLE XLV XLY XLP XLI XLU XLB XLRE XLC SMH SOXX VGT ARKK SCHD VYM VIG
JEPI TQQQ SQQQ IBIT""".split()

CRYPTO = [
    ("BTC", "Bitcoin"), ("ETH", "Ethereum"), ("SOL", "Solana"), ("XRP", "XRP"), ("DOGE", "Dogecoin"),
    ("ADA", "Cardano"), ("AVAX", "Avalanche"), ("LINK", "Chainlink"), ("DOT", "Polkadot"),
    ("LTC", "Litecoin"), ("BCH", "Bitcoin Cash"), ("XLM", "Stellar"), ("UNI", "Uniswap"),
    ("AAVE", "Aave"), ("ATOM", "Cosmos"), ("ETC", "Ethereum Classic"), ("FIL", "Filecoin"),
    ("NEAR", "NEAR Protocol"), ("APT", "Aptos"), ("ARB", "Arbitrum"), ("OP", "Optimism"),
    ("SHIB", "Shiba Inu"), ("ALGO", "Algorand"), ("HBAR", "Hedera"), ("ICP", "Internet Computer"),
    ("CRV", "Curve DAO"), ("SUI", "Sui"), ("PEPE", "Pepe"), ("POL", "Polygon"), ("USDC", "USD Coin"),
]
NAMES = {
    "AAPL": "Apple Inc.", "MSFT": "Microsoft Corporation", "NVDA": "NVIDIA Corporation", "AMZN": "Amazon.com, Inc.",
    "GOOGL": "Alphabet Inc. Class A", "GOOG": "Alphabet Inc. Class C", "META": "Meta Platforms, Inc.",
    "TSLA": "Tesla, Inc.", "AVGO": "Broadcom Inc.", "JPM": "JPMorgan Chase & Co.", "V": "Visa Inc.",
    "LLY": "Eli Lilly and Company", "UNH": "UnitedHealth Group Inc.", "XOM": "Exxon Mobil Corporation",
    "MA": "Mastercard Incorporated", "COST": "Costco Wholesale Corporation", "HD": "The Home Depot, Inc.",
    "PG": "Procter & Gamble Co.", "JNJ": "Johnson & Johnson", "NFLX": "Netflix, Inc.",
    "AMD": "Advanced Micro Devices, Inc.", "ORCL": "Oracle Corporation", "CRM": "Salesforce, Inc.",
    "ADBE": "Adobe Inc.", "PEP": "PepsiCo, Inc.", "KO": "The Coca-Cola Company", "WMT": "Walmart Inc.",
    "BAC": "Bank of America Corporation", "DIS": "The Walt Disney Company", "INTC": "Intel Corporation",
    "CSCO": "Cisco Systems, Inc.", "QCOM": "QUALCOMM Incorporated", "T": "AT&T Inc.",
    "VZ": "Verizon Communications Inc.", "PFE": "Pfizer Inc.", "MRK": "Merck & Co., Inc.", "ABBV": "AbbVie Inc.",
    "CVX": "Chevron Corporation", "NKE": "NIKE, Inc.", "MCD": "McDonald's Corporation", "SBUX": "Starbucks Corporation",
    "BA": "The Boeing Company", "CAT": "Caterpillar Inc.", "GE": "GE Aerospace", "IBM": "IBM",
    "UBER": "Uber Technologies, Inc.", "ABNB": "Airbnb, Inc.", "PYPL": "PayPal Holdings, Inc.",
    "SHOP": "Shopify Inc.", "PLTR": "Palantir Technologies Inc.", "COIN": "Coinbase Global, Inc.",
    "HOOD": "Robinhood Markets, Inc.", "SNOW": "Snowflake Inc.", "MU": "Micron Technology, Inc.",
    "AMAT": "Applied Materials, Inc.", "TXN": "Texas Instruments Incorporated", "LOW": "Lowe's Companies, Inc.",
    "GS": "The Goldman Sachs Group, Inc.", "MS": "Morgan Stanley", "C": "Citigroup Inc.",
    "WFC": "Wells Fargo & Company", "SCHW": "The Charles Schwab Corporation", "BLK": "BlackRock, Inc.",
    "AXP": "American Express Company", "F": "Ford Motor Company", "GM": "General Motors Company",
    "RIVN": "Rivian Automotive, Inc.", "LCID": "Lucid Group, Inc.", "SOFI": "SoFi Technologies, Inc.",
    "ARM": "Arm Holdings plc", "SMCI": "Super Micro Computer, Inc.", "DELL": "Dell Technologies Inc.",
    "PANW": "Palo Alto Networks, Inc.", "CRWD": "CrowdStrike Holdings, Inc.", "NOW": "ServiceNow, Inc.",
    "INTU": "Intuit Inc.", "ISRG": "Intuitive Surgical, Inc.", "AMGN": "Amgen Inc.", "GILD": "Gilead Sciences, Inc.",
    "TMO": "Thermo Fisher Scientific Inc.", "DHR": "Danaher Corporation", "LMT": "Lockheed Martin Corporation",
    "RTX": "RTX Corporation", "DE": "Deere & Company", "UPS": "United Parcel Service, Inc.", "FDX": "FedEx Corporation",
    "ROKU": "Roku, Inc.", "SPOT": "Spotify Technology S.A.", "RBLX": "Roblox Corporation",
    "ZM": "Zoom Communications, Inc.", "DKNG": "DraftKings Inc.", "MSTR": "Strategy Inc.",
    "TSM": "Taiwan Semiconductor Manufacturing (ADR)", "BABA": "Alibaba Group Holding (ADR)", "NIO": "NIO Inc. (ADR)",
    "XYZ": "Block, Inc.",
    "SPY": "SPDR S&P 500 ETF Trust", "QQQ": "Invesco QQQ Trust", "VOO": "Vanguard S&P 500 ETF",
    "VTI": "Vanguard Total Stock Market ETF", "IVV": "iShares Core S&P 500 ETF", "DIA": "SPDR Dow Jones Industrial Average ETF",
    "IWM": "iShares Russell 2000 ETF", "VT": "Vanguard Total World Stock ETF", "VXUS": "Vanguard Total International Stock ETF",
    "VEA": "Vanguard FTSE Developed Markets ETF", "VWO": "Vanguard FTSE Emerging Markets ETF", "EFA": "iShares MSCI EAFE ETF",
    "EEM": "iShares MSCI Emerging Markets ETF", "BND": "Vanguard Total Bond Market ETF", "AGG": "iShares Core U.S. Aggregate Bond ETF",
    "TLT": "iShares 20+ Year Treasury Bond ETF", "IEF": "iShares 7-10 Year Treasury Bond ETF", "SHY": "iShares 1-3 Year Treasury Bond ETF",
    "BNDX": "Vanguard Total International Bond ETF", "LQD": "iShares iBoxx $ Investment Grade Corporate Bond ETF",
    "HYG": "iShares iBoxx $ High Yield Corporate Bond ETF", "GLD": "SPDR Gold Shares", "SLV": "iShares Silver Trust",
    "USO": "United States Oil Fund", "DBC": "Invesco DB Commodity Index Tracking Fund", "VNQ": "Vanguard Real Estate ETF",
    "XLK": "Technology Select Sector SPDR Fund", "XLF": "Financial Select Sector SPDR Fund", "XLE": "Energy Select Sector SPDR Fund",
    "XLV": "Health Care Select Sector SPDR Fund", "XLY": "Consumer Discretionary Select Sector SPDR Fund",
    "XLP": "Consumer Staples Select Sector SPDR Fund", "XLI": "Industrial Select Sector SPDR Fund",
    "XLU": "Utilities Select Sector SPDR Fund", "XLB": "Materials Select Sector SPDR Fund",
    "XLRE": "Real Estate Select Sector SPDR Fund", "XLC": "Communication Services Select Sector SPDR Fund",
    "SMH": "VanEck Semiconductor ETF", "SOXX": "iShares Semiconductor ETF", "VGT": "Vanguard Information Technology ETF",
    "ARKK": "ARK Innovation ETF", "SCHD": "Schwab U.S. Dividend Equity ETF", "VYM": "Vanguard High Dividend Yield ETF",
    "VIG": "Vanguard Dividend Appreciation ETF", "JEPI": "JPMorgan Equity Premium Income ETF",
    "TQQQ": "ProShares UltraPro QQQ", "SQQQ": "ProShares UltraPro Short QQQ", "IBIT": "iShares Bitcoin Trust ETF",
}
UPPER_WORDS = {"ETF", "ETN", "S&P", "SPDR", "QQQ", "AT&T", "FTSE", "MSCI", "ESG", "USD", "US", "U.S.", "TIPS",
               "REIT", "ADR", "II", "III", "IV", "LLC", "LP", "PLC", "NV", "SA", "AG", "SE", "DB", "ARK", "AI", "ETFS"}
BRANDS = {"Ishares": "iShares", "Proshares": "ProShares", "Vaneck": "VanEck", "Wisdomtree": "WisdomTree",
          "Ss": "SPDR", "Jpmorgan": "JPMorgan", "Blackrock": "BlackRock", "Paypal": "PayPal"}


def clean_name(raw: str) -> str:
    import re
    s = raw.strip()
    s = re.sub(r"\s*-\s*(Cl(ass)?\.?)\s*([A-Z])\b", r" Class \3", s, flags=re.I)
    s = re.sub(r"\s+-\s+([A-Z])$", r" Class \1", s)
    s = re.sub(r"-(Us|Usd|Ui)$", "", s, flags=re.I)
    if s.isupper() or s == s.title():
        words = []
        for w in s.split():
            up = w.upper()
            if up in UPPER_WORDS:
                words.append(up)
            else:
                t = w.capitalize() if not any(c.isdigit() for c in w) else w
                words.append(BRANDS.get(t, t))
        s = " ".join(words)
    s = re.sub(r"'S\b", "'s", s)
    return s.strip()


EXCHANGES = {"XNYS": "NYSE", "XNAS": "NASDAQ", "ARCX": "NYSE Arca", "BATS": "Cboe BZX", "XASE": "NYSE American"}
TYPES = {"Common Stock": "stock", "ADR": "stock", "ETP": "etf"}


def main() -> int:
    load_dotenv(ROOT / ".env")
    key = os.getenv("FINNHUB_API_KEY")
    if not key:
        print("FINNHUB_API_KEY is not set")
        return 1
    res = httpx.get("https://finnhub.io/api/v1/stock/symbol", params={"exchange": "US", "token": key},
                    timeout=120, follow_redirects=True)
    res.raise_for_status()
    rank = {s: i + 1 for i, s in enumerate(POPULAR_STOCKS + POPULAR_ETFS)}
    rows = []
    for x in res.json():
        cls = TYPES.get(x.get("type"))
        mic = x.get("mic")
        sym = x.get("symbol", "")
        if not cls or mic not in EXCHANGES or not sym or "." in sym or " " in sym:
            continue
        name = NAMES.get(sym) or clean_name(x.get("description") or sym)
        rows.append([sym, name, cls, EXCHANGES[mic], rank.get(sym, 0)])
    for i, (base, name) in enumerate(CRYPTO):
        rows.append([f"{base}-USD", name, "crypto", "Crypto", 1000 + i])
    rows.sort(key=lambda r: r[0])
    OUT.write_text(json.dumps({"columns": ["symbol", "name", "asset_class", "exchange", "rank"], "rows": rows},
                              separators=(",", ":")))
    missing = [s for s in rank if s not in {r[0] for r in rows}]
    print(f"Wrote {len(rows)} symbols to {OUT.relative_to(ROOT)}. Popular symbols not found: {missing}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
