"""
Gitea MCP Client — wraps the Gitea REST API (v1).
Gitea's API structure mirrors GitHub's API, making it a drop-in simulator
for GitHub Enterprise provisioning flows.
"""
import requests

from logger import get_logger

_log = get_logger(__name__)


class GiteaMCPClient:
    def __init__(self, base_url: str, admin_token: str):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"token {admin_token}",
            "Content-Type": "application/json",
        })

    def _api(self, method: str, path: str, **kwargs) -> dict:
        """Make an authenticated request to the Gitea API v1.

        Args:
            method: HTTP method string ("GET", "POST", "PUT", etc.).
            path: API path starting with "/" (e.g. "/users/alice").
            **kwargs: Additional arguments passed to requests.Session.request().

        Returns:
            Parsed JSON response dict, or empty dict for empty responses.

        Raises:
            requests.HTTPError: On any non-2xx response.
        """
        url = f"{self.base_url}/api/v1{path}"
        _log.debug("Gitea %s %s", method.upper(), path)
        resp = self.session.request(method, url, **kwargs)
        resp.raise_for_status()
        if resp.content:
            return resp.json()
        return {}

    # ------------------------------------------------------------------
    # User management
    # ------------------------------------------------------------------

    def create_user_if_missing(self, username: str, email: str, full_name: str = "") -> dict:
        """Return the Gitea user, creating them if they don't exist.

        New users are created with a temporary password and must_change_password=True.

        Args:
            username: Gitea username.
            email: User's email address.
            full_name: Optional display name.

        Returns:
            Gitea user object dict.
        """
        try:
            return self._api("GET", f"/users/{username}")
        except requests.HTTPError as e:
            if e.response.status_code == 404:
                _log.info("Creating Gitea user | username=%s", username)
                return self._api("POST", "/admin/users", json={
                    "username": username,
                    "email": email,
                    "full_name": full_name,
                    "password": "Changeme1!",
                    "must_change_password": True,
                })
            raise

    # ------------------------------------------------------------------
    # Organization / team membership
    # ------------------------------------------------------------------

    def create_org_if_missing(self, org_name: str) -> dict:
        """Return the Gitea organisation, creating it as private if it doesn't exist.

        Args:
            org_name: The organisation username/slug.

        Returns:
            Gitea organisation object dict.
        """
        try:
            return self._api("GET", f"/orgs/{org_name}")
        except requests.HTTPError as e:
            if e.response.status_code == 404:
                return self._api("POST", "/orgs", json={
                    "username": org_name,
                    "visibility": "private",
                })
            raise

    def get_or_create_team(self, org_name: str, team_name: str) -> dict:
        """Return the named team within an org, creating it with write permission if missing.

        Args:
            org_name: The organisation slug.
            team_name: Team name to find or create.

        Returns:
            Gitea team object dict with at least "id" and "name".
        """
        teams = self._api("GET", f"/orgs/{org_name}/teams")
        for t in teams:
            if t["name"] == team_name:
                return t
        return self._api("POST", f"/orgs/{org_name}/teams", json={
            "name": team_name,
            "permission": "write",
            "units": ["repo.code", "repo.issues", "repo.pulls"],
        })

    def add_user_to_team(self, team_id: int, username: str) -> dict:
        """Add a user to a Gitea team.

        Args:
            team_id: Numeric ID of the team.
            username: Gitea username to add.

        Returns:
            Empty dict (Gitea returns 204 No Content on success).
        """
        return self._api("PUT", f"/teams/{team_id}/members/{username}")

    def is_user_in_team(self, team_id: int, username: str) -> bool:
        """Check whether a user is a member of a Gitea team.

        Args:
            team_id: Numeric ID of the team.
            username: Gitea username to check.

        Returns:
            True if the user is in the team, False if not found.
        """
        try:
            self._api("GET", f"/teams/{team_id}/members/{username}")
            return True
        except requests.HTTPError as e:
            if e.response.status_code == 404:
                return False
            raise

    # ------------------------------------------------------------------
    # Provisioning entry point
    # ------------------------------------------------------------------

    def provision(self, org: str, team: str, username: str, email: str = "", full_name: str = "") -> dict:
        """Idempotently provision a user into a Gitea organisation team.

        Creates the user, organisation, and team if they don't exist, then
        adds the user to the team. Returns immediately with an error dict if
        username is empty.

        Args:
            org: Organisation slug (e.g. "agentic-hr").
            team: Team name (e.g. "engineering").
            username: Gitea username of the employee.
            email: Optional email for user creation.
            full_name: Optional display name for user creation.

        Returns:
            Dict with system, org, team, username, and team_added (bool).
        """
        if not username:
            _log.error("Gitea provision skipped — empty username")
            return {"system": "gitea", "error": "No github_username on employee profile"}
        _log.info("Gitea provision | org=%s | team=%s | username=%s", org, team, username)
        if email:
            self.create_user_if_missing(username, email, full_name)
        self.create_org_if_missing(org)
        team_obj = self.get_or_create_team(org, team)
        self.add_user_to_team(team_obj["id"], username)
        verified = self.is_user_in_team(team_obj["id"], username)
        _log.info("Gitea provision complete | username=%s | team_added=%s", username, verified)
        return {
            "system": "gitea",
            "org": org,
            "team": team,
            "username": username,
            "team_added": verified,
        }

    def verify_access(self, org: str, team: str, username: str) -> bool:
        """Verify whether a user has team membership in a Gitea organisation.

        Args:
            org: Organisation slug.
            team: Team name to check.
            username: Gitea username to verify.

        Returns:
            True if the user is in the team, False on any error or if not found.
        """
        _log.debug("Gitea verify access | org=%s | team=%s | username=%s", org, team, username)
        try:
            teams = self._api("GET", f"/orgs/{org}/teams")
            for t in teams:
                if t["name"] == team:
                    result = self.is_user_in_team(t["id"], username)
                    _log.info("Gitea access verification | username=%s | verified=%s", username, result)
                    return result
            _log.warning("Gitea team not found | org=%s | team=%s", org, team)
            return False
        except Exception as e:
            _log.error("Gitea verify_access error: %s", e)
            return False
