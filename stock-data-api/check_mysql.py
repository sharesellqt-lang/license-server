
import os
import sys

try:
    import pymysql
except Exception as exc:
    print("MYSQL CHECK: PyMySQL import failed:", type(exc).__name__)
    sys.exit(1)


def main():
    required = ("DB_HOST", "DB_USER", "DB_PASS", "DB_NAME")
    missing = [name for name in required if not os.environ.get(name)]

    if missing:
        print("MYSQL CHECK: Missing environment variables:", ", ".join(missing))
        sys.exit(1)

    try:
        connection = pymysql.connect(
            host=os.environ["DB_HOST"].strip(),
            user=os.environ["DB_USER"],
            password=os.environ["DB_PASS"],
            database=os.environ["DB_NAME"],
            port=int(os.environ.get("DB_PORT", "3306")),
            connect_timeout=10,
            read_timeout=10,
            write_timeout=10,
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
            autocommit=True,
        )

        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1 AS ok")
                ping = cursor.fetchone()

                cursor.execute(
                    """
                    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = %s
                    ORDER BY ORDINAL_POSITION
                    """,
                    ("vnstock_device_state",),
                )
                columns = cursor.fetchall()

            if not ping or ping.get("ok") != 1:
                print("MYSQL CHECK: Connection opened, but SELECT 1 failed.")
                sys.exit(1)

            print("========== MYSQL CHECK ==========")
            print("Connection: OK")
            print("SELECT 1: OK")
            print("Table vnstock_device_state exists:", bool(columns))

            if columns:
                print("Table columns:")
                for column in columns:
                    print(
                        " -",
                        column["COLUMN_NAME"],
                        "|",
                        column["DATA_TYPE"],
                        "| nullable:",
                        column["IS_NULLABLE"],
                    )
            else:
                print("Table columns: none found")

            print("Database credentials printed: NO")
            print("Database records modified: NO")
            print("=================================")

            if not columns:
                sys.exit(2)

        finally:
            connection.close()

    except Exception as exc:
        print("MYSQL CHECK: FAILED")
        print("Error type:", type(exc).__name__)
        print("Error message:", str(exc)[:500])
        print("Credentials printed: NO")
        sys.exit(1)


if __name__ == "__main__":
    main()
