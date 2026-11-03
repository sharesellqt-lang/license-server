
"""
STOCK DATA API
Vnstock 5 adapter for Stock Analysis
With TTL Cache, Single-flight and Rate Limiter
"""

import os
import json
<<<<<<< Updated upstream
import secrets

=======
import os
import time
import threading

from collections import deque
>>>>>>> Stashed changes
from datetime import date
from typing import Optional

from fastapi import (
    FastAPI,
    HTTPException,
    Query,
    Header,
    Depends
)

from fastapi.middleware.cors import CORSMiddleware

from vnstock import Market, Reference, Fundamental


app = FastAPI(
    title="Stock Analysis Data API",
    version="1.1.0"
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://sharesell.net"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"]
)


<<<<<<< Updated upstream
# =========================================
# API KEY AUTHENTICATION
# =========================================

def verify_api_key(
    x_api_key: Optional[str] = Header(
        default=None,
        alias="X-API-Key"
    )
):
    expected_key = os.getenv("STOCK_DATA_API_KEY")

    if not expected_key:
        raise HTTPException(
            status_code=500,
            detail="API Key chưa được cấu hình."
        )

    if (
        not x_api_key
        or not secrets.compare_digest(x_api_key, expected_key)
    ):
        raise HTTPException(
            status_code=401,
            detail="API Key không hợp lệ."
        )


# =========================================
# DATA HELPERS
# =========================================
=======
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
>>>>>>> Stashed changes

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


<<<<<<< Updated upstream
# =========================================
# HEALTH CHECK
# Public endpoint for Render monitoring
# =========================================
=======
def history_cache_key(prefix, symbol, length, start, end, interval):
    return (
        f"{prefix}:{symbol}:"
        f"{length}:{start or ''}:{end or ''}:{interval}"
    )


# =====================================================
# HEALTH
# =====================================================
>>>>>>> Stashed changes

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


<<<<<<< Updated upstream
# =========================================
# STOCK INFORMATION
# =========================================

@app.get(
    "/api/stock-data/stock/{symbol}",
    dependencies=[Depends(verify_api_key)]
)
=======
# =====================================================
# STOCK INFORMATION
# =====================================================

@app.get("/api/stock-data/stock/{symbol}")
>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
    if (
        quote_error
        and overview_error
        and income_error
        and balance_error
    ):
        raise HTTPException(
            status_code=502,
            detail="Không lấy được dữ liệu cổ phiếu từ Vnstock."
=======
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
>>>>>>> Stashed changes
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


<<<<<<< Updated upstream
# =========================================
# HISTORICAL STOCK PRICES
# =========================================

@app.get(
    "/api/stock-data/history/{symbol}",
    dependencies=[Depends(verify_api_key)]
)
=======
# =====================================================
# HISTORICAL STOCK PRICES
# =====================================================

@app.get("/api/stock-data/history/{symbol}")
>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
        if start:
            kwargs["start"] = start

        if end:
            kwargs["end"] = end

        if not start:
            kwargs["length"] = length

        df = Market().equity(symbol).ohlcv(**kwargs)

        bars = dataframe_records(df)

        if not bars:
            raise HTTPException(
                status_code=404,
                detail=f"Không có dữ liệu lịch sử cho {symbol}."
            )

        return success({
            "symbol": symbol,
            "bars": bars,
            "count": len(bars),
            "interval": interval
        })

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=str(error)
        )
=======
>>>>>>> Stashed changes

# =====================================================
# MARKET BENCHMARK
# =====================================================

# =========================================
# MARKET BENCHMARK
# =========================================

@app.get(
    "/api/stock-data/benchmark",
    dependencies=[Depends(verify_api_key)]
)
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
<<<<<<< Updated upstream

        if start:
            kwargs["start"] = start

        if end:
            kwargs["end"] = end

        if not start:
            kwargs["length"] = length

        df = Market().index(symbol).ohlcv(**kwargs)

        bars = dataframe_records(df)

        if not bars:
            raise HTTPException(
                status_code=404,
                detail=f"Không có dữ liệu benchmark {symbol}."
            )

        return success({
            "symbol": symbol,
            "bars": bars,
            "count": len(bars),
            "interval": interval
        })

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=str(error)
        )
=======
    })
>>>>>>> Stashed changes
