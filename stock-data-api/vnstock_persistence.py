
import os
import io
import stat
import shutil
import hashlib
import tempfile
import zipfile

from pathlib import Path, PurePosixPath

import pymysql
from cryptography.fernet import Fernet, InvalidToken


TABLE = "vnstock_device_state"
STATE_ID = 1
STATE_VERSION = "2"
REGISTERING_VERSION = "registering"

MAX_ARCHIVE_SIZE = 16 * 1024 * 1024
MAX_ENCRYPTED_SIZE = 24 * 1024 * 1024
MAX_EXTRACT_SIZE = 32 * 1024 * 1024
MAX_FILES = 500


class VnstockPersistenceError(Exception):
    pass


def get_vnstock_home():
    configured = os.getenv("VNSTOCK_HOME", "").strip()

    home = (
        Path(configured).expanduser()
        if configured
        else Path.home() / ".vnstock"
    )

    home = home.resolve()
    os.environ["VNSTOCK_HOME"] = str(home)

    return home


def get_state_cipher():
    key = os.getenv("VNSTOCK_STATE_ENCRYPTION_KEY", "").strip()

    if not key:
        raise VnstockPersistenceError(
            "Thiếu biến môi trường VNSTOCK_STATE_ENCRYPTION_KEY."
        )

    try:
        return Fernet(key.encode("ascii"))
    except Exception:
        raise VnstockPersistenceError(
            "VNSTOCK_STATE_ENCRYPTION_KEY không hợp lệ."
        ) from None


def connect_mysql():
    required = ["DB_HOST", "DB_USER", "DB_PASS", "DB_NAME"]

    missing = [
        key for key in required
        if not os.getenv(key)
    ]

    if missing:
        raise VnstockPersistenceError(
            "Thiếu biến môi trường MySQL: " + ", ".join(missing)
        )

    try:
        return pymysql.connect(
            host=os.environ["DB_HOST"].strip(),
            user=os.environ["DB_USER"],
            password=os.environ["DB_PASS"],
            database=os.environ["DB_NAME"],
            port=int(os.getenv("DB_PORT", "3306")),
            connect_timeout=10,
            read_timeout=20,
            write_timeout=20,
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
            autocommit=True
        )

    except Exception as exc:
        raise VnstockPersistenceError(
            f"MySQL connection failed: {type(exc).__name__}"
        ) from None


def has_local_state(home):
    auth_dir = home / "auth"

    if not auth_dir.is_dir() or auth_dir.is_symlink():
        return False

    return any(
        path.is_file() and not path.is_symlink()
        for path in auth_dir.rglob("*")
    )


def read_mysql_state():
    connection = connect_mysql()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT state_data, sha256, state_version
                FROM {TABLE}
                WHERE id = %s
                LIMIT 1
                """,
                (STATE_ID,)
            )

            return cursor.fetchone()

    except Exception as exc:
        raise VnstockPersistenceError(
            f"MySQL read failed: {type(exc).__name__}"
        ) from None

    finally:
        connection.close()


def create_registration_marker():
    empty_hash = hashlib.sha256(b"").hexdigest()

    connection = connect_mysql()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                INSERT IGNORE INTO {TABLE}
                    (id, state_data, sha256, state_version)
                VALUES (%s, %s, %s, %s)
                """,
                (
                    STATE_ID,
                    b"",
                    empty_hash,
                    REGISTERING_VERSION
                )
            )

            if cursor.rowcount != 1:
                raise VnstockPersistenceError(
                    "Registration marker already exists."
                )

    except VnstockPersistenceError:
        raise

    except Exception as exc:
        raise VnstockPersistenceError(
            f"Registration marker failed: {type(exc).__name__}"
        ) from None

    finally:
        connection.close()


def create_archive(home):
    if not has_local_state(home):
        raise VnstockPersistenceError(
            "VNSTOCK_HOME không có file xác thực."
        )

    output = io.BytesIO()
    count = 0
    total_size = 0

    with zipfile.ZipFile(
        output,
        "w",
        compression=zipfile.ZIP_DEFLATED
    ) as archive:

        for path in sorted(home.rglob("*")):

            if path.is_symlink() or not path.is_file():
                continue

            resolved = path.resolve()

            if not resolved.is_relative_to(home):
                raise VnstockPersistenceError(
                    "File nằm ngoài VNSTOCK_HOME."
                )

            file_size = path.stat().st_size
            count += 1
            total_size += file_size

            if count > MAX_FILES:
                raise VnstockPersistenceError(
                    "VNSTOCK_HOME có quá nhiều file."
                )

            if total_size > MAX_EXTRACT_SIZE:
                raise VnstockPersistenceError(
                    "VNSTOCK_HOME vượt giới hạn dung lượng."
                )

            relative = path.relative_to(home).as_posix()

            info = zipfile.ZipInfo(relative)
            info.compress_type = zipfile.ZIP_DEFLATED

            mode = stat.S_IMODE(path.stat().st_mode)
            info.external_attr = (stat.S_IFREG | mode) << 16

            with path.open("rb") as source:
                archive.writestr(info, source.read())

            if output.tell() > MAX_ARCHIVE_SIZE:
                raise VnstockPersistenceError(
                    "Archive vượt giới hạn kích thước."
                )

    data = output.getvalue()

    if not data or len(data) > MAX_ARCHIVE_SIZE:
        raise VnstockPersistenceError(
            "Archive không hợp lệ hoặc vượt giới hạn."
        )

    return data


def extract_archive(data, destination):
    if not data or len(data) > MAX_ARCHIVE_SIZE:
        raise VnstockPersistenceError(
            "Archive không hợp lệ."
        )

    total_size = 0
    count = 0
    seen_paths = set()

    with zipfile.ZipFile(io.BytesIO(data), "r") as archive:

        members = archive.infolist()

        for info in members:
            name = info.filename

            if not name or "\\" in name or "\x00" in name:
                raise VnstockPersistenceError(
                    "Đường dẫn archive không hợp lệ."
                )

            relative = PurePosixPath(name)

            if (
                relative.is_absolute()
                or any(
                    part in ("", ".", "..")
                    or ":" in part
                    for part in relative.parts
                )
            ):
                raise VnstockPersistenceError(
                    "Archive chứa đường dẫn không an toàn."
                )

            normalized = relative.as_posix()

            if normalized in seen_paths:
                raise VnstockPersistenceError(
                    "Archive chứa đường dẫn trùng lặp."
                )

            seen_paths.add(normalized)

            mode = (info.external_attr >> 16) & 0xFFFF
            file_type = stat.S_IFMT(mode)

            if file_type not in (
                0,
                stat.S_IFREG,
                stat.S_IFDIR
            ):
                raise VnstockPersistenceError(
                    "Archive chứa loại file không được phép."
                )

            if stat.S_ISLNK(mode):
                raise VnstockPersistenceError(
                    "Archive chứa symbolic link."
                )

            if info.is_dir():
                continue

            count += 1
            total_size += info.file_size

            if count > MAX_FILES:
                raise VnstockPersistenceError(
                    "Archive có quá nhiều file."
                )

            if total_size > MAX_EXTRACT_SIZE:
                raise VnstockPersistenceError(
                    "Archive vượt giới hạn giải nén."
                )

        destination.mkdir(parents=True, exist_ok=True)

        for info in members:

            if info.is_dir():
                continue

            relative = PurePosixPath(info.filename)
            target = destination.joinpath(*relative.parts)

            target.parent.mkdir(parents=True, exist_ok=True)

            with archive.open(info, "r") as source:
                with target.open("xb") as output:
                    shutil.copyfileobj(source, output)

            mode = (info.external_attr >> 16) & 0o777
            os.chmod(target, mode or 0o600)


def restore_archive(home, data):
    home.parent.mkdir(parents=True, exist_ok=True)

    temp_dir = Path(
        tempfile.mkdtemp(
            prefix=".vnstock-restore-",
            dir=str(home.parent)
        )
    )

    backup_dir = home.with_name(home.name + ".previous")
    moved_old = False

    try:
        extract_archive(data, temp_dir)

        if not has_local_state(temp_dir):
            raise VnstockPersistenceError(
                "Archive không chứa trạng thái xác thực."
            )

        if backup_dir.exists():
            shutil.rmtree(backup_dir)

        if home.exists():
            os.replace(home, backup_dir)
            moved_old = True

        os.replace(temp_dir, home)

        if moved_old and backup_dir.exists():
            shutil.rmtree(backup_dir)

    except Exception:
        if moved_old and backup_dir.exists() and not home.exists():
            os.replace(backup_dir, home)

        raise

    finally:
        if temp_dir.exists():
            shutil.rmtree(temp_dir, ignore_errors=True)


def prepare_vnstock_home(allow_registration=False):
    """
    Phải gọi trước import vnstock.

    Kết quả:
      restored
      local_unbacked
      registration_pending
      register_once
      missing
      blocked
    """

    home = get_vnstock_home()

    try:
        row = read_mysql_state()

    except VnstockPersistenceError as exc:

        if has_local_state(home):
            print(
                "VNSTOCK STORAGE: MySQL unavailable; "
                "using existing local state."
            )
            return "local_unbacked"

        print(
            "VNSTOCK STORAGE BLOCKED:",
            str(exc)
        )
        return "blocked"

    if row:

        version = str(row.get("state_version") or "")

        if version == REGISTERING_VERSION:

            if has_local_state(home):
                print(
                    "VNSTOCK STORAGE: registration pending; "
                    "using local state without login."
                )
                return "registration_pending"

            print(
                "VNSTOCK STORAGE BLOCKED: "
                "registration marker exists but local state is missing."
            )
            return "blocked"

        if version != STATE_VERSION:
            print(
                "VNSTOCK STORAGE BLOCKED: unsupported state version."
            )
            return "blocked"

        data = bytes(row.get("state_data") or b"")

        expected = str(
            row.get("sha256") or ""
        ).strip().lower()

        actual = hashlib.sha256(data).hexdigest()

        if not data or actual != expected:
            print(
                "VNSTOCK STORAGE BLOCKED: checksum mismatch."
            )
            return "blocked"

        if len(data) > MAX_ENCRYPTED_SIZE:
            print(
                "VNSTOCK STORAGE BLOCKED: encrypted snapshot too large."
            )
            return "blocked"

        try:
            archive_data = get_state_cipher().decrypt(data)

            restore_archive(home, archive_data)

            print(
                "VNSTOCK STORAGE: encrypted snapshot restored from MySQL."
            )

            return "restored"

        except InvalidToken:
            print(
                "VNSTOCK STORAGE BLOCKED: decryption failed."
            )
            return "blocked"

        except Exception as exc:
            print(
                "VNSTOCK STORAGE BLOCKED:",
                type(exc).__name__
            )
            return "blocked"

    if has_local_state(home):
        print(
            "VNSTOCK STORAGE: local state exists, "
            "but no MySQL snapshot."
        )
        return "local_unbacked"

    if not allow_registration:
        print(
            "VNSTOCK STORAGE: registration disabled."
        )
        return "missing"

    try:
        create_registration_marker()

        print(
            "VNSTOCK STORAGE: registration marker created."
        )

        return "register_once"

    except Exception as exc:
        print(
            "VNSTOCK STORAGE BLOCKED:",
            type(exc).__name__
        )
        return "blocked"


def save_vnstock_home():
    home = get_vnstock_home()

    archive_data = create_archive(home)
    data = get_state_cipher().encrypt(archive_data)

    if len(data) > MAX_ENCRYPTED_SIZE:
        raise VnstockPersistenceError(
            "Archive mã hóa vượt giới hạn kích thước."
        )

    digest = hashlib.sha256(data).hexdigest()

    connection = connect_mysql()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                INSERT INTO {TABLE}
                    (id, state_data, sha256, state_version)
                VALUES (%s, %s, %s, %s)

                ON DUPLICATE KEY UPDATE
                    state_data = %s,
                    sha256 = %s,
                    state_version = %s
                """,
                (
                    STATE_ID,
                    data,
                    digest,
                    STATE_VERSION,
                    data,
                    digest,
                    STATE_VERSION
                )
            )

        print(
            "VNSTOCK STORAGE: encrypted snapshot saved to MySQL."
        )

    except Exception as exc:
        raise VnstockPersistenceError(
            f"MySQL save failed: {type(exc).__name__}"
        ) from None

    finally:
        connection.close()
