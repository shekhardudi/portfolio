"""
Direct PostgreSQL data access for HR tables: employees, access_packages,
access_requests.  Replaces NocoDB REST calls in the provision / approval path.
"""
import json
from datetime import datetime, timezone

from logger import get_logger
from db.connection import ManagedConn

log = get_logger(__name__)


def _rows_to_dicts(cur) -> list[dict]:
    """Convert all rows from an open cursor to a list of column-keyed dicts.

    Args:
        cur: An executed psycopg2 cursor with results pending.

    Returns:
        List of dicts mapping column name → value for each row.
    """
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def _row_to_dict(cur) -> dict | None:
    """Fetch a single row from an open cursor as a column-keyed dict.

    Args:
        cur: An executed psycopg2 cursor with at most one row expected.

    Returns:
        Dict mapping column name → value, or None if no row was returned.
    """
    row = cur.fetchone()
    if row is None:
        return None
    cols = [d[0] for d in cur.description]
    return dict(zip(cols, row))


# ------------------------------------------------------------------
# Employee queries (READ-only)
# ------------------------------------------------------------------

def get_employee_profile(email: str) -> dict | None:
    """Fetch a single employee record by email address.

    Args:
        email: The employee's email address (case-sensitive match).

    Returns:
        Employee row as a dict, or None if no matching record exists.
    """
    log.info("Fetching employee profile | email=%s", email)
    with ManagedConn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM employees WHERE email = %s", (email,))
            result = _row_to_dict(cur)
    if result:
        log.info("Employee found | email=%s | id=%s", email, result.get("employee_id"))
    else:
        log.warning("Employee not found | email=%s", email)
    return result


def get_employee_by_id(employee_id: str) -> dict | None:
    """Fetch a single employee record by employee_id.

    Args:
        employee_id: The internal employee identifier (e.g. "EMP-001").

    Returns:
        Employee row as a dict, or None if no matching record exists.
    """
    log.info("Fetching employee profile | employee_id=%s", employee_id)
    with ManagedConn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM employees WHERE employee_id = %s", (employee_id,))
            result = _row_to_dict(cur)
    if result:
        log.info("Employee found | employee_id=%s | email=%s", employee_id, result.get("email"))
    else:
        log.warning("Employee not found | employee_id=%s", employee_id)
    return result


# ------------------------------------------------------------------
# Access package queries (READ-only)
# ------------------------------------------------------------------

def list_access_packages() -> list[dict]:
    """Return all rows from the access_packages table.

    Returns:
        List of access package dicts (package_id, package_name, target_system,
        payload).
    """
    log.debug("Listing all access packages")
    with ManagedConn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM access_packages")
            results = _rows_to_dicts(cur)
    log.debug("Access packages returned %d rows", len(results))
    return results


def get_access_package(package_id: str) -> dict | None:
    """Fetch a single access package by its identifier.

    Args:
        package_id: The package identifier (e.g. "PKG-GH-ENG-STD").

    Returns:
        Access package row as a dict, or None if not found.
    """
    log.debug("Fetching access package | package_id=%s", package_id)
    with ManagedConn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM access_packages WHERE package_id = %s", (package_id,))
            return _row_to_dict(cur)


# ------------------------------------------------------------------
# Access request queries (READ + WRITE)
# ------------------------------------------------------------------

def create_access_request(
    requester_id: str,
    requester_email: str,
    package_id: str,
    approver_id: str,
) -> dict:
    """Insert a new access request record with status 'pending_approval'.

    Generates a timestamp-based request_id (AR-YYYYMMDDHHMMSS).

    Args:
        requester_id: The employee_id of the person requesting access.
        requester_email: Email of the requesting employee (for notifications).
        package_id: The access package being requested.
        approver_id: The employee_id of the manager who must approve.

    Returns:
        The newly created access_requests row as a dict.
    """
    request_id = f"AR-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    now = datetime.now(timezone.utc)
    log.info("Creating access request | requester=%s | package=%s | id=%s", requester_email, package_id, request_id)
    sql = """
        INSERT INTO access_requests (request_id, requester_id, package_id, approver_id, status, created_ts)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING *
    """
    with ManagedConn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (request_id, requester_id, package_id, approver_id, "pending_approval", now))
            result = _row_to_dict(cur)
        conn.commit()
    log.info("Access request created | id=%s", request_id)
    return result


def list_access_requests(status: str | None = None) -> list[dict]:
    """List access requests, optionally filtered by status.

    Joins with the employees table to include requester_email and
    requester_name for display in the manager approval UI.

    Args:
        status: Optional status filter (e.g. "pending_approval", "fulfilled").
            If None, all requests are returned.

    Returns:
        List of access request dicts with joined employee fields, ordered by
        created_ts descending.
    """
    log.debug("Listing access requests | status=%s", status)
    sql = """
        SELECT r.*, e.email AS requester_email, e.full_name AS requester_name
        FROM access_requests r
        LEFT JOIN employees e ON e.employee_id = r.requester_id
    """
    with ManagedConn() as conn:
        with conn.cursor() as cur:
            if status:
                cur.execute(sql + " WHERE r.status = %s ORDER BY r.created_ts DESC", (status,))
            else:
                cur.execute(sql + " ORDER BY r.created_ts DESC")
            return _rows_to_dicts(cur)


def get_access_request(request_id: str) -> dict | None:
    """Fetch a single access request by its AR-* identifier.

    Args:
        request_id: The request identifier (e.g. "AR-20240101120000").

    Returns:
        Access request row as a dict, or None if not found.
    """
    log.debug("Fetching access request | id=%s", request_id)
    with ManagedConn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM access_requests WHERE request_id = %s", (request_id,))
            return _row_to_dict(cur)


def approve_or_deny_request(request_id: str, decision: str, approver_email: str) -> dict:
    """Update an access request status to the manager's decision.

    Sets the status and decided_ts timestamp on the record.

    Args:
        request_id: The AR-* identifier of the request to update.
        decision: Either "approved" or "denied".
        approver_email: Email of the approving/denying manager (for audit).

    Returns:
        The updated access_requests row as a dict.

    Raises:
        ValueError: If no request with the given request_id exists.
    """
    log.info("Decision on request %s: %s by %s", request_id, decision, approver_email)
    now = datetime.now(timezone.utc)
    sql = """
        UPDATE access_requests
        SET status = %s, decided_ts = %s
        WHERE request_id = %s
        RETURNING *
    """
    with ManagedConn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (decision, now, request_id))
            result = _row_to_dict(cur)
        conn.commit()
    if result is None:
        raise ValueError(f"Access request '{request_id}' not found.")
    return result


def get_access_requests_by_employee(
    employee_id: str,
    request_id: str | None = None,
    target_systems: list[str] | None = None,
) -> list[dict]:
    """Get access requests for an employee, joined with access_packages for names."""
    sql = """
        SELECT
            ar.request_id,
            ar.package_id,
            ap.package_name,
            ap.target_system,
            ar.status,
            ar.created_ts,
            ar.decided_ts,
            ar.fulfillment_result
        FROM access_requests ar
        LEFT JOIN access_packages ap ON ar.package_id = ap.package_id
        WHERE ar.requester_id = %s
    """
    params: list = [employee_id]

    if request_id:
        sql += " AND ar.request_id = %s"
        params.append(request_id)

    if target_systems:
        placeholders = ", ".join(["%s"] * len(target_systems))
        sql += f" AND LOWER(ap.target_system) IN ({placeholders})"
        params.extend([s.lower() for s in target_systems])

    sql += " ORDER BY ar.created_ts DESC"

    log.info("Fetching access requests | employee_id=%s | request_id=%s | systems=%s", employee_id, request_id, target_systems)
    with ManagedConn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            results = _rows_to_dicts(cur)
    log.info("Access requests returned %d rows | employee_id=%s", len(results), employee_id)
    return results


def update_request_fulfillment(request_id: str, result: dict) -> dict:
    """Mark an access request as fulfilled and store the fulfillment result.

    Sets status to "fulfilled" and serialises the result dict as JSON into
    the fulfillment_result column.

    Args:
        request_id: The AR-* identifier of the request to mark fulfilled.
        result: Dict containing provisioning system results (e.g. Gitea/
            Mattermost outcomes).

    Returns:
        The updated access_requests row as a dict.

    Raises:
        ValueError: If no request with the given request_id exists.
    """
    log.info("Updating fulfillment | request_id=%s", request_id)
    sql = """
        UPDATE access_requests
        SET status = %s, fulfillment_result = %s
        WHERE request_id = %s
        RETURNING *
    """
    with ManagedConn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, ("fulfilled", json.dumps(result), request_id))
            row = _row_to_dict(cur)
        conn.commit()
    if row is None:
        raise ValueError(f"Access request '{request_id}' not found.")
    return row
