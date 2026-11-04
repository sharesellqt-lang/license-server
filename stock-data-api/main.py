import json
import os
import time
import threading

from collections import deque
from datetime import date
from typing import Optional

import vnstock
from vnstock import Market, Reference, Fundamental

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

# =========================================
# VNSTOCK AUTHENTICATION
# =========================================

api_key = os.environ.get("VNSTOCK_API_KEY")
VNSTOCK_AUTHENTICATED = False

if api_key:
    try:
        vnstock.login(api_key)
        status = vnstock.status()

        VNSTOCK_AUTHENTICATED = bool(
            status.get("authenticated") and status.get("active")
        )

        print("VNSTOCK:", status)

    except Exception as e:
        print(
            f"VNSTOCK AUTH FAILED: {type(e).__name__}: {e}"
        )
else:
    print("VNSTOCK API KEY: NOT CONFIGURED")
# =========================================
# FASTAPI
# =========================================

app = FastAPI(
    title="Stock Analysis Data API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://sharesell.net"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"]
)


# =====================================================
# CONFIG
# =====================================================

CACHE_TTL = {
    "quote": 60,
    "overview": 86400,
    "financial": 86400,
    "history": 1800,
    "benchmark": 1800
}

MAX_CALLS_PER_MINUTE = 8

# Tài khoản hiện tại chưa có quyền báo cáo tài chính.
# Chỉ bật true khi đã được vnstock cấp quyền.
ENABLE_FINANCIALS = (
    os.getenv("STOCK_ENABLE_FINANCIALS", "false").lower() == "true"
)


# =====================================================
# CACHE
# =====================================================

_CACHE = {}
_CACHE_LOCK = threading.RLock()
_KEY_LOCKS = {}

_CALL_TIMES = deque()
_RATE_LOCK = threading.Lock()


def get_key_lock(key):
    with _CACHE_LOCK:
        if key not in _KEY_LOCKS:
            _KEY_LOCKS[key] = threading.Lock()

        return _KEY_LOCKS[key]


def get_cached(key):
    with _CACHE_LOCK:
        return _CACHE.get(key)


def save_cache(key, records):
    with _CACHE_LOCK:
        _CACHE[key] = {
            "records": records,
            "saved_at": time.time()
        }


# =====================================================
# RATE LIMITER
# =====================================================

def reserve_vnstock_call():
    now = time.time()

    with _RATE_LOCK:
        while _CALL_TIMES and now - _CALL_TIMES[0] >= 60:
            _CALL_TIMES.popleft()

        if len(_CALL_TIMES) >= MAX_CALLS_PER_MINUTE:
            return False

        _CALL_TIMES.append(now)
        return True


def vnstock_usage():
    now = time.time()

    with _RATE_LOCK:
        while _CALL_TIMES and now - _CALL_TIMES[0] >= 60:
            _CALL_TIMES.popleft()

        return len(_CALL_TIMES)


# =====================================================
# DATAFRAME
# =====================================================

def dataframe_records(df):
    if df is None:
        return []

    if not hasattr(df, "to_json"):
        return []

    raw = df.to_json(
        orient="records",
        date_format="iso",
        force_ascii=False
    )

    return json.loads(raw)


# =====================================================
# CACHED FETCH
# =====================================================

def fetch_cached_records(key, ttl, callback):
    now = time.time()
    cached = get_cached(key)

    # Fresh cache
    if cached and now - cached["saved_at"] < ttl:
        return cached["records"], None, "cache"

    # Only one request per cache key at a time
    with get_key_lock(key):

        now = time.time()
        cached = get_cached(key)

        if cached and now - cached["saved_at"] < ttl:
            return cached["records"], None, "cache"

        # Keep stale data as fallback
        stale_records = cached["records"] if cached else None

        # Internal rate limit
        if not reserve_vnstock_call():
            error = (
                "Đã đạt giới hạn gọi API nội bộ "
                f"({MAX_CALLS_PER_MINUTE} lượt/60 giây)."
            )

            if stale_records is not None:
                return stale_records, error, "stale"

            return [], error, "error"

        try:
            records = dataframe_records(callback())

            if not records:
                raise ValueError("Vnstock không trả về dữ liệu.")

            save_cache(key, records)

            return records, None, "live"

        except Exception as error:
            message = str(error)

            # Return stale data when provider fails
            if stale_records is not None:
                return (
                    stale_records,
                    f"{message} (Đang sử dụng dữ liệu cache cũ.)",
                    "stale"
                )

            return [], message, "error"


# =====================================================
# VALIDATION
# =====================================================

def validate_symbol(symbol):
    symbol = str(symbol or "").strip().upper()

    if not symbol or not symbol.isalnum() or len(symbol) > 10:
        raise HTTPException(
            status_code=400,
            detail="Mã chứng khoán không hợp lệ."
        )

    return symbol


def success(data):
    return {
        "success": True,
        "data": data
    }


def history_cache_key(prefix, symbol, length, start, end, interval):
    return (
        f"{prefix}:{symbol}:"
        f"{length}:{start or ''}:{end or ''}:{interval}"
    )


# =====================================================
# HEALTH
# =====================================================

@app.get("/api/stock-data/health")
def health():
    return success({
        "service": "vnstock",
        "status": "online",
        "date": date.today().isoformat(),
        "cacheEntries": len(_CACHE),
        "vnstockCallsLastMinute": vnstock_usage(),
        "vnstockCallLimit": MAX_CALLS_PER_MINUTE,
        "financialsEnabled": ENABLE_FINANCIALS
    })


# =====================================================
# STOCK INFORMATION
# =====================================================

@app.get("/api/stock-data/stock/{symbol}")
def get_stock(symbol: str):
    symbol = validate_symbol(symbol)

    # Quote: 60 seconds
    quote, quote_error, quote_source = fetch_cached_records(
        f"quote:{symbol}",
        CACHE_TTL["quote"],
        lambda: Market().equity(symbol).quote()
    )

    # Company overview: 24 hours
    overview, overview_error, overview_source = fetch_cached_records(
        f"overview:{symbol}",
        CACHE_TTL["overview"],
        lambda: Reference().company(symbol).overview()
    )

    income = []
    balance = []
    cashflow = []

    errors = {}

    if quote_error:
        errors["quote"] = quote_error

    if overview_error:
        errors["overview"] = overview_error

    # Financial statements
    if ENABLE_FINANCIALS:

        fundamental = Fundamental().equity(symbol)

        income, income_error, _ = fetch_cached_records(
            f"income:{symbol}",
            CACHE_TTL["financial"],
            lambda: fundamental.income_statement(
                period="year",
                format="long"
            )
        )

        balance, balance_error, _ = fetch_cached_records(
            f"balance:{symbol}",
            CACHE_TTL["financial"],
            lambda: fundamental.balance_sheet(
                period="year",
                format="long"
            )
        )

        cashflow, cashflow_error, _ = fetch_cached_records(
            f"cashflow:{symbol}",
            CACHE_TTL["financial"],
            lambda: fundamental.cash_flow(
                period="year",
                format="long"
            )
        )

        if income_error:
            errors["incomeStatement"] = income_error

        if balance_error:
            errors["balanceSheet"] = balance_error

        if cashflow_error:
            errors["cashFlow"] = cashflow_error

    else:
        disabled_message = (
            "Đã tạm tắt truy vấn báo cáo tài chính. "
            "Tài khoản vnstock hiện chưa có quyền truy cập."
        )

        errors.update({
            "incomeStatement": disabled_message,
            "balanceSheet": disabled_message,
            "cashFlow": disabled_message
        })

    if quote_error and overview_error:
        if not quote and not overview:
            raise HTTPException(
                status_code=502,
                detail={
                    "message": "Không lấy được dữ liệu cổ phiếu từ Vnstock.",
                    "errors": errors
                }
            )

    return success({
        "symbol": symbol,

        "company": overview[0] if overview else {},
        "quote": quote[0] if quote else {},

        "financials": {
            "incomeStatement": income,
            "balanceSheet": balance,
            "cashFlow": cashflow
        },

        "metadata": {
            "source": "vnstock",
            "fetchedAt": date.today().isoformat(),
            "cache": {
                "quote": quote_source,
                "overview": overview_source
            },
            "errors": errors
        }
    })


# =====================================================
# HISTORICAL STOCK PRICES
# =====================================================

@app.get("/api/stock-data/history/{symbol}")
def get_history(
    symbol: str,
    length: str = Query("5Y"),
    start: Optional[str] = None,
    end: Optional[str] = None,
    interval: str = Query("1D")
):
    symbol = validate_symbol(symbol)

    kwargs = {
        "interval": interval
    }

    if start:
        kwargs["start"] = start

    if end:
        kwargs["end"] = end

    if not start:
        kwargs["length"] = length

    key = history_cache_key(
        "history",
        symbol,
        length,
        start,
        end,
        interval
    )

    bars, error, source = fetch_cached_records(
        key,
        CACHE_TTL["history"],
        lambda: Market().equity(symbol).ohlcv(**kwargs)
    )

    if not bars:
        raise HTTPException(
            status_code=502 if error else 404,
            detail=error or f"Không có dữ liệu lịch sử cho {symbol}."
        )

    return success({
        "symbol": symbol,
        "bars": bars,
        "count": len(bars),
        "interval": interval,
        "metadata": {
            "cache": source,
            "warning": error
        }
    })


# =====================================================
# MARKET BENCHMARK
# =====================================================

@app.get("/api/stock-data/benchmark")
def get_benchmark(
    symbol: str = Query("VNINDEX"),
    length: str = Query("5Y"),
    start: Optional[str] = None,
    end: Optional[str] = None,
    interval: str = Query("1D")
):
    symbol = validate_symbol(symbol)

    kwargs = {
        "interval": interval
    }

    if start:
        kwargs["start"] = start

    if end:
        kwargs["end"] = end

    if not start:
        kwargs["length"] = length

    key = history_cache_key(
        "benchmark",
        symbol,
        length,
        start,
        end,
        interval
    )

    bars, error, source = fetch_cached_records(
        key,
        CACHE_TTL["benchmark"],
        lambda: Market().index(symbol).ohlcv(**kwargs)
    )

    if not bars:
        raise HTTPException(
            status_code=502 if error else 404,
            detail=error or f"Không có dữ liệu benchmark {symbol}."
        )

    return success({
        "symbol": symbol,
        "bars": bars,
        "count": len(bars),
        "interval": interval,
        "metadata": {
            "cache": source,
            "warning": error
        }
    })
