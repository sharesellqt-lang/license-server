
import re
import vnstock
from vnstock import Fundamental

print("VNSTOCK VERSION:", vnstock.__version__)

fin = Fundamental().equity("VCB")

KEYWORDS = re.compile(
    r"npl|non.?perform|bad debt|nợ xấu|provision|dự phòng|bao phủ|"
    r"capital adequacy|capital ratio|car|vốn tự có|rủi ro có trọng số|"
    r"risk.?weighted|casa|current account|không kỳ hạn|"
    r"net interest margin|\bnim\b|earning assets|tài sản sinh lãi|"
    r"interest income|thu nhập lãi thuần",
    re.I
)

def inspect(label, loader):
    print("\n" + "=" * 70)
    print(label)

    try:
        df = loader()

        if df is None:
            print("EMPTY: None")
            return

        print("SHAPE:", getattr(df, "shape", None))
        print("COLUMNS:", list(getattr(df, "columns", [])))
        print("ATTRS:", getattr(df, "attrs", {}))

        if hasattr(df, "to_dict"):
            rows = df.to_dict(orient="records")
        else:
            rows = list(df)

        print("TOTAL ROWS:", len(rows))

        matched = [
            row for row in rows
            if KEYWORDS.search(" ".join(str(v) for v in row.values()))
        ]

        print("MATCHED ROWS:", len(matched))

        for row in matched:
            print(row)

        if "level" in getattr(df, "columns", []):
            print("LEVEL COUNTS:")
            print(df["level"].value_counts(dropna=False).to_dict())

    except Exception as e:
        print("ERROR:", type(e).__name__, str(e))


# 1. Balance Sheet - VCI, ép loại hình ngân hàng
inspect(
    "BALANCE SHEET VCI BANK YEAR",
    lambda: fin.balance_sheet(
        com_type="bank",
        period="year",
        format="long",
        source="vci"
    )
)

# 2. Balance Sheet - KBS, ép loại hình ngân hàng
inspect(
    "BALANCE SHEET KBS BANK YEAR",
    lambda: fin.balance_sheet(
        com_type="bank",
        period="year",
        format="long",
        source="kbs"
    )
)

# 3. Financial Health - bộ chỉ tiêu ngân hàng
inspect(
    "FINANCIAL HEALTH BANK YEAR",
    lambda: fin.financial_health(
        com_type="bank",
        period="year",
        format="wide",
        limit=0
    )
)

# 4. Ratio - VCI
inspect(
    "RATIO BANK VCI YEAR",
    lambda: fin.ratio(
        com_type="bank",
        period="year",
        format="long",
        source="vci"
    )
)

# 5. Ratio - KBS
inspect(
    "RATIO BANK KBS YEAR",
    lambda: fin.ratio(
        com_type="bank",
        period="year",
        format="long",
        source="kbs"
    )
)

# 6. Note - thuyết minh báo cáo tài chính
inspect(
    "NOTE BANK VCI YEAR",
    lambda: fin.note(
        com_type="bank",
        period="year",
        format="long",
        source="vci"
    )
)
