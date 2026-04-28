"""
NocoDB MCP Client — wraps the NocoDB REST API (v2).
NocoDB provides a REST API that mirrors a no-code database over PostgreSQL.
Table IDs are resolved lazily on first use via the meta API.
"""
import requests

from logger import get_logger


class NocoDBMCPClient:
    def __init__(self, base_url: str, api_token: str, base_id: str = ""):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({
            "xc-token": api_token,
            "Content-Type": "application/json",
        })
        self._base_id: str = base_id
        self._table_ids: dict[str, str] = {}
        self._log = get_logger(__name__)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _resolve_base_id(self) -> str:
        """Return the NocoDB base_id, resolving it from the API if not configured.

        Returns:
            The base_id string for all subsequent table-level API calls.

        Raises:
            RuntimeError: If no bases are found in NocoDB.
        """
        if self._base_id:
            return self._base_id
        resp = self.session.get(f"{self.base_url}/api/v2/meta/bases/")
        resp.raise_for_status()
        bases = resp.json().get("list", [])
        if not bases:
            raise RuntimeError("No NocoDB bases found. Set NOCODB_BASE_ID in .env")
        self._base_id = bases[0]["id"]
        self._log.info("Resolved NocoDB base_id=%s", self._base_id)
        return self._base_id

    def _get_table_id(self, table_name: str) -> str:
        """Return the NocoDB table_id for the given table name, with caching.

        Fetches all tables for the base on first call and caches their IDs
        to avoid repeated meta API calls.

        Args:
            table_name: The display name of the table (e.g. "employees").

        Returns:
            The NocoDB table identifier string.

        Raises:
            ValueError: If the table is not found in the base.
        """
        if table_name in self._table_ids:
            return self._table_ids[table_name]
        base_id = self._resolve_base_id()
        resp = self.session.get(f"{self.base_url}/api/v2/meta/bases/{base_id}/tables")
        resp.raise_for_status()
        for t in resp.json().get("list", []):
            self._table_ids[t["title"]] = t["id"]
        if table_name not in self._table_ids:
            raise ValueError(f"Table '{table_name}' not found in NocoDB.")
        return self._table_ids[table_name]

    def _list(self, table_name: str, where: str = "", limit: int = 100) -> list[dict]:
        """Fetch rows from a NocoDB table with an optional filter expression.

        Args:
            table_name: Display name of the NocoDB table.
            where: NocoDB filter string (e.g. "(email,eq,alice@example.com)").
            limit: Maximum number of rows to return.

        Returns:
            List of row dicts as returned by the NocoDB API.
        """
        table_id = self._get_table_id(table_name)
        base_id = self._resolve_base_id()
        params = {"limit": limit}
        if where:
            params["where"] = where
        self._log.debug("NocoDB LIST %s | where=%r", table_name, where)
        resp = self.session.get(f"{self.base_url}/api/v1/db/data/noco/{base_id}/{table_id}", params=params)
        resp.raise_for_status()
        rows = resp.json().get("list", [])
        self._log.debug("NocoDB LIST %s returned %d rows", table_name, len(rows))
        return rows

    def _create(self, table_name: str, data: dict) -> dict:
        """Insert a new row into a NocoDB table.

        Args:
            table_name: Display name of the NocoDB table.
            data: Dict of field values for the new row.

        Returns:
            The created row dict as returned by the NocoDB API.
        """
        table_id = self._get_table_id(table_name)
        base_id = self._resolve_base_id()
        self._log.debug("NocoDB CREATE %s", table_name)
        resp = self.session.post(
            f"{self.base_url}/api/v1/db/data/noco/{base_id}/{table_id}",
            json=data,
        )
        resp.raise_for_status()
        return resp.json()

    def _update(self, table_name: str, row_id: str, data: dict) -> dict:
        """Patch an existing row in a NocoDB table.

        Args:
            table_name: Display name of the NocoDB table.
            row_id: The NocoDB row identifier (numeric "Id" or row PK).
            data: Dict of fields to update on the row.

        Returns:
            The updated row dict as returned by the NocoDB API.
        """
        table_id = self._get_table_id(table_name)
        base_id = self._resolve_base_id()
        self._log.debug("NocoDB PATCH %s | row_id=%s", table_name, row_id)
        resp = self.session.patch(
            f"{self.base_url}/api/v1/db/data/noco/{base_id}/{table_id}/{row_id}",
            json=data,
        )
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------
    # Employee operations
    # ------------------------------------------------------------------

    def get_employee_profile(self, email: str) -> dict | None:
        """Look up an employee by email address.

        Args:
            email: The employee's email address.

        Returns:
            Employee row dict, or None if not found.
        """
        self._log.info("Fetching employee profile | email=%s", email)
        results = self._list("employees", where=f"(email,eq,{email})")
        if results:
            self._log.info("Employee found | email=%s | id=%s", email, results[0].get("employee_id"))
        else:
            self._log.warning("Employee not found | email=%s", email)
        return results[0] if results else None

    def get_employee_by_id(self, employee_id: str) -> dict | None:
        """Look up an employee by internal employee_id.

        Args:
            employee_id: The internal employee identifier (e.g. "EMP-001").

        Returns:
            Employee row dict, or None if not found.
        """
        self._log.info("Fetching employee profile | employee_id=%s", employee_id)
        results = self._list("employees", where=f"(employee_id,eq,{employee_id})")
        if results:
            self._log.info("Employee found | employee_id=%s | email=%s", employee_id, results[0].get("email"))
        else:
            self._log.warning("Employee not found | employee_id=%s", employee_id)
        return results[0] if results else None

    # ------------------------------------------------------------------
    # Leave balance operations
    # ------------------------------------------------------------------

    def get_leave_balance(self, employee_id: str, leave_type: str | None = None) -> list[dict]:
        """Fetch leave balance records for an employee.

        Args:
            employee_id: The employee's internal identifier.
            leave_type: Optional leave type filter (e.g. "annual", "sick").
                When None, all leave types are returned.

        Returns:
            List of leave_balances row dicts with balance_hours, used_ytd_hours,
            and accrued_ytd_hours.
        """
        self._log.info("Fetching leave balance | employee_id=%s | type=%s", employee_id, leave_type)
        where = f"(employee_id,eq,{employee_id})"
        if leave_type:
            where += f"~and(leave_type,eq,{leave_type})"
        rows = self._list("leave_balances", where=where)
        self._log.info("Leave balance records: %d | employee_id=%s", len(rows), employee_id)
        return rows

    def update_leave_balance(
        self,
        employee_id: str,
        leave_type: str,
        new_balance_hours: float,
        new_used_hours: float,
    ) -> dict:
        """Update leave balance after leave application."""
        where = f"(employee_id,eq,{employee_id})~and(leave_type,eq,{leave_type})"
        rows = self._list("leave_balances", where=where)
        if not rows:
            self._log.warning("No leave balance row to update | employee_id=%s | type=%s", employee_id, leave_type)
            return {}
        row = rows[0]
        row_id = row.get("Id") or row.get("id")
        self._log.info("Updating leave balance | employee_id=%s | type=%s | new_balance=%.1f", employee_id, leave_type, new_balance_hours)
        return self._update("leave_balances", str(row_id), {
            "balance_hours": new_balance_hours,
            "used_ytd_hours": new_used_hours,
        })

    # ------------------------------------------------------------------
    # Access package operations
    # ------------------------------------------------------------------

    def list_access_packages(self) -> list[dict]:
        """Return all access package records from NocoDB.

        Returns:
            List of access_packages row dicts.
        """
        return self._list("access_packages")

    def get_access_package(self, package_id: str) -> dict | None:
        """Fetch a single access package by its package_id.

        Args:
            package_id: Package identifier (e.g. "PKG-GH-ENG-STD").

        Returns:
            Access package row dict, or None if not found.
        """
        results = self._list("access_packages", where=f"(package_id,eq,{package_id})")
        return results[0] if results else None

    # ------------------------------------------------------------------
    # Access request operations
    # ------------------------------------------------------------------

    def create_access_request(
        self,
        requester_id: str,
        requester_email: str,
        package_id: str,
        approver_id: str,
    ) -> dict:
        """Create a new access request in NocoDB with status 'pending_approval'.

        Args:
            requester_id: Employee ID of the person requesting access.
            requester_email: Email of the requesting employee.
            package_id: ID of the access package being requested.
            approver_id: Employee ID of the approving manager.

        Returns:
            The created access_requests row dict.
        """
        from datetime import datetime, timezone
        data = {
            "request_id": f"AR-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
            "requester_id": requester_id,
            "requester_email": requester_email,
            "package_id": package_id,
            "approver_id": approver_id,
            "status": "pending_approval",
            "created_ts": datetime.now(timezone.utc).isoformat(),
        }
        req_id = data["request_id"]
        self._log.info("Creating access request | requester=%s | package=%s | id=%s", requester_email, package_id, req_id)
        result = self._create("access_requests", data)
        self._log.info("Access request created | id=%s", req_id)
        return result

    def list_access_requests(self, status: str | None = None) -> list[dict]:
        """List access requests from NocoDB, optionally filtered by status.

        Args:
            status: Optional status filter (e.g. "pending_approval").

        Returns:
            List of access_requests row dicts.
        """
        self._log.debug("Listing access requests | status=%s", status)
        where = f"(status,eq,{status})" if status else ""
        return self._list("access_requests", where=where)

    def get_access_request(self, request_id: str) -> dict | None:
        """Fetch a single access request by its AR-* identifier.

        Args:
            request_id: The request identifier string.

        Returns:
            Access request row dict, or None if not found.
        """
        self._log.debug("Fetching access request | id=%s", request_id)
        results = self._list("access_requests", where=f"(request_id,eq,{request_id})")
        return results[0] if results else None

    def approve_or_deny_request(
        self, request_id: str, decision: str, approver_email: str
    ) -> dict:
        """Update an access request with the manager's approval or denial.

        Args:
            request_id: The AR-* identifier of the request to update.
            decision: Either "approved" or "denied".
            approver_email: Email of the manager making the decision.

        Returns:
            The updated access_requests row dict.

        Raises:
            ValueError: If the request_id is not found.
        """
        from datetime import datetime, timezone
        self._log.info("Decision on request %s: %s by %s", request_id, decision, approver_email)
        req = self.get_access_request(request_id)
        if req is None:
            raise ValueError(f"Access request '{request_id}' not found.")
        row_id = req.get("Id") or req.get("id") or req.get("request_id")
        data = {
            "status": decision,
            "decided_ts": datetime.now(timezone.utc).isoformat(),
        }
        return self._update("access_requests", str(row_id), data)

    def update_request_fulfillment(self, request_id: str, result: dict) -> dict:
        """Mark an access request as fulfilled and store the provisioning result.

        Args:
            request_id: The AR-* identifier of the fulfilled request.
            result: Provisioning outcome dict to store as JSON.

        Returns:
            The updated access_requests row dict.

        Raises:
            ValueError: If the request_id is not found.
        """
        import json
        self._log.info("Updating fulfillment result for request %s", request_id)
        req = self.get_access_request(request_id)
        if req is None:
            raise ValueError(f"Access request '{request_id}' not found.")
        row_id = req.get("Id") or req.get("id") or req.get("request_id")
        return self._update(
            "access_requests",
            str(row_id),
            {"status": "fulfilled", "fulfillment_result": json.dumps(result)},
        )
