
"""
STOCK DATA API
Vnstock 5 adapter for Stock Analysis
"""

import os
import json
import secrets

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
    version="1.0.0"
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://sharesell.net"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"]
)


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


def safe_fetch(callback):
    try:
        return dataframe_records(callback()), None
    except Exception as error:
        return [], str(error)


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


# =========================================
# HEALTH CHECK
# Public endpoint for Render monitoring
# =========================================

@app.get("/api/stock-data/health")
def health():
    return success({
        "service": "vnstock",
        "status": "online",
        "date": date.today().isoformat()
    })


# =========================================
# STOCK INFORMATION
# =========================================

@app.get(
    "/api/stock-data/stock/{symbol}",
    dependencies=[Depends(verify_api_key)]
)
def get_stock(symbol: str):
    symbol = validate_symbol(symbol)

    quote, quote_error = safe_fetch(
        lambda: Market().equity(symbol).quote()
    )

    overview, overview_error = safe_fetch(
        lambda: Reference().company(symbol).overview()
    )

    fundamental = Fundamental().equity(symbol)

    income, income_error = safe_fetch(
        lambda: fundamental.income_statement(
            period="year",
            format="long"
        )
    )

    balance, balance_error = safe_fetch(
        lambda: fundamental.balance_sheet(
            period="year",
            format="long"
        )
    )

    cashflow, cashflow_error = safe_fetch(
        lambda: fundamental.cash_flow(
            period="year",
            format="long"
        )
    )

    if (
        quote_error
        and overview_error
        and income_error
        and balance_error
    ):
        raise HTTPException(
            status_code=502,
            detail="Không lấy được dữ liệu cổ phiếu từ Vnstock."
        )

    errors = {
        key: value
        for key, value in {
            "quote": quote_error,
            "overview": overview_error,
            "incomeStatement": income_error,
            "balanceSheet": balance_error,
            "cashFlow": cashflow_error
        }.items()
        if value
    }

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
            "errors": errors
        }
    })


# =========================================
# HISTORICAL STOCK PRICES
# =========================================

@app.get(
    "/api/stock-data/history/{symbol}",
    dependencies=[Depends(verify_api_key)]
)
def get_history(
    symbol: str,
    length: str = Query("5Y"),
    start: Optional[str] = None,
    end: Optional[str] = None,
    interval: str = Query("1D")
):
    symbol = validate_symbol(symbol)

    try:
        kwargs = {
            "interval": interval
        }

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

    try:
        kwargs = {
            "interval": interval
        }

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
