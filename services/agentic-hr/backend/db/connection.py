import psycopg2
from psycopg2 import pool as pg_pool

from config import settings
from logger import get_logger

log = get_logger(__name__)
_pool: pg_pool.ThreadedConnectionPool | None = None


def init_pool(minconn: int = 1, maxconn: int = 10) -> None:
    """Initialise the module-level PostgreSQL connection pool.

    Must be called once at application startup (e.g. in FastAPI lifespan)
    before any database operation is attempted.

    Args:
        minconn: Minimum number of connections kept alive in the pool.
        maxconn: Maximum number of connections allowed simultaneously.
    """
    global _pool
    log.info("Initialising PostgreSQL connection pool (min=%d, max=%d)", minconn, maxconn)
    _pool = pg_pool.ThreadedConnectionPool(
        minconn,
        maxconn,
        dsn=settings.postgres_dsn,
    )
    log.info("Connection pool ready")


def get_conn():
    """Borrow a connection from the pool.

    Returns:
        A psycopg2 connection object.

    Raises:
        RuntimeError: If init_pool() has not been called yet.
    """
    if _pool is None:
        raise RuntimeError("Connection pool not initialized. Call init_pool() first.")
    return _pool.getconn()


def put_conn(conn) -> None:
    """Return a connection to the pool.

    Safe to call even if the pool was closed (no-op in that case).

    Args:
        conn: The psycopg2 connection to return.
    """
    if _pool is not None:
        _pool.putconn(conn)


def close_pool() -> None:
    """Close all connections in the pool and release the pool object.

    Safe to call multiple times; subsequent calls are no-ops.
    Typically called in the FastAPI lifespan shutdown handler.
    """
    global _pool
    if _pool is not None:
        log.info("Closing PostgreSQL connection pool")
        _pool.closeall()
        _pool = None


class ManagedConn:
    """Context manager that borrows a connection from the pool.

    Automatically returns the connection on exit. Rolls back any open
    transaction if an exception occurred, preventing connection contamination.

    Usage:
        with ManagedConn() as conn:
            with conn.cursor() as cur:
                cur.execute(...)
    """

    def __enter__(self):
        self.conn = get_conn()
        return self.conn

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            log.warning("Rolling back transaction due to %s", exc_type.__name__)
            self.conn.rollback()
        put_conn(self.conn)
        return False
