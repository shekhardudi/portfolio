"""
Mattermost MCP Client — wraps the Mattermost REST API (v4).
Used to provision team/channel membership for new employees.
"""
import requests
import secrets
import string

from logger import get_logger

_log = get_logger(__name__)


class MattermostMCPClient:
    def __init__(self, base_url: str, admin_token: str):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {admin_token}",
            "Content-Type": "application/json",
        })

    def _api(self, method: str, path: str, **kwargs) -> dict | list:
        """Make an authenticated request to the Mattermost API v4.

        Args:
            method: HTTP method string ("GET", "POST", etc.).
            path: API path starting with "/" (e.g. "/users/email/alice@example.com").
            **kwargs: Additional arguments passed to requests.Session.request().

        Returns:
            Parsed JSON response (dict or list), or empty dict for empty responses.

        Raises:
            requests.HTTPError: On any non-2xx response (logs the body first).
        """
        url = f"{self.base_url}/api/v4{path}"
        _log.debug("Mattermost %s %s", method.upper(), path)
        resp = self.session.request(method, url, **kwargs)
        if not resp.ok:
            body = resp.text[:500] if resp.text else "(empty)"
            _log.error("Mattermost %s %s → %s | %s", method.upper(), path, resp.status_code, body)
            resp.raise_for_status()
        if resp.content:
            return resp.json()
        return {}

    # ------------------------------------------------------------------
    # User lookup / creation
    # ------------------------------------------------------------------

    def get_user_by_email(self, email: str) -> dict | None:
        """Look up a Mattermost user by email address.

        Args:
            email: The user's email address.

        Returns:
            Mattermost user object dict, or None if not found.
        """
        try:
            return self._api("GET", f"/users/email/{email}")
        except requests.HTTPError as e:
            if e.response.status_code == 404:
                return None
            raise

    def get_user_by_username(self, username: str) -> dict | None:
        """Look up a Mattermost user by username.

        Args:
            username: The Mattermost username (login name).

        Returns:
            Mattermost user object dict, or None if not found.
        """
        try:
            return self._api("GET", f"/users/username/{username}")
        except requests.HTTPError as e:
            if e.response.status_code == 404:
                return None
            raise

    def create_user(self, email: str, username: str) -> dict:
        """Create a new Mattermost user with a random password (force reset on login)."""
        password = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(16))
        _log.info("Creating Mattermost user | email=%s | username=%s", email, username)
        return self._api("POST", "/users", json={
            "email": email,
            "username": username,
            "password": password,
        })

    # ------------------------------------------------------------------
    # Team operations
    # ------------------------------------------------------------------

    def get_team_by_name(self, team_name: str) -> dict | None:
        """Look up a Mattermost team by its URL-safe name.

        Args:
            team_name: The team's name slug (e.g. "engineering").

        Returns:
            Mattermost team object dict, or None if not found.
        """
        try:
            return self._api("GET", f"/teams/name/{team_name}")
        except requests.HTTPError as e:
            if e.response.status_code == 404:
                return None
            raise

    def create_team(self, team_name: str) -> dict:
        """Create an open Mattermost team.

        Args:
            team_name: URL-safe team name slug.

        Returns:
            Created Mattermost team object dict.
        """
        _log.info("Creating Mattermost team | team=%s", team_name)
        return self._api("POST", "/teams", json={
            "name": team_name,
            "display_name": team_name.replace("-", " ").replace("_", " ").title(),
            "type": "O",
        })

    def add_user_to_team(self, team_id: str, user_id: str) -> dict:
        """Add a user to a Mattermost team.

        Args:
            team_id: Mattermost team ID string.
            user_id: Mattermost user ID string.

        Returns:
            Team member object dict.
        """
        return self._api("POST", f"/teams/{team_id}/members", json={
            "team_id": team_id,
            "user_id": user_id,
        })

    def is_user_in_team(self, team_id: str, user_id: str) -> bool:
        """Check whether a user is a member of a Mattermost team.

        Args:
            team_id: Mattermost team ID string.
            user_id: Mattermost user ID string.

        Returns:
            True if the user is a team member, False if not found.
        """
        try:
            self._api("GET", f"/teams/{team_id}/members/{user_id}")
            return True
        except requests.HTTPError as e:
            if e.response.status_code == 404:
                return False
            raise

    # ------------------------------------------------------------------
    # Channel operations
    # ------------------------------------------------------------------

    def get_channel_by_name(self, team_id: str, channel_name: str) -> dict | None:
        """Look up a Mattermost channel by name within a team.

        Args:
            team_id: Mattermost team ID string.
            channel_name: Channel name slug (e.g. "general").

        Returns:
            Mattermost channel object dict, or None if not found.
        """
        try:
            return self._api("GET", f"/teams/{team_id}/channels/name/{channel_name}")
        except requests.HTTPError as e:
            if e.response.status_code == 404:
                return None
            raise

    def create_channel(self, team_id: str, channel_name: str) -> dict:
        """Create an open Mattermost channel in the specified team.

        Args:
            team_id: Mattermost team ID string.
            channel_name: URL-safe channel name slug.

        Returns:
            Created Mattermost channel object dict.
        """
        _log.info("Creating Mattermost channel | team_id=%s | channel=%s", team_id, channel_name)
        return self._api("POST", "/channels", json={
            "team_id": team_id,
            "name": channel_name,
            "display_name": channel_name.replace("-", " ").replace("_", " ").title(),
            "type": "O",
        })

    def add_user_to_channel(self, channel_id: str, user_id: str) -> dict:
        """Add a user to a Mattermost channel.

        Args:
            channel_id: Mattermost channel ID string.
            user_id: Mattermost user ID string.

        Returns:
            Channel member object dict.
        """
        return self._api("POST", f"/channels/{channel_id}/members", json={
            "user_id": user_id,
        })

    # ------------------------------------------------------------------
    # Provisioning entry point
    # ------------------------------------------------------------------

    def provision(self, team_name: str, channels: list[str], user_email: str) -> dict:
        """Idempotently provision a user into a Mattermost team and channels.

        Looks up or creates the user (deriving username from email), looks up or
        creates the team, adds the user to the team, then adds them to each
        listed channel (creating channels that don't exist).

        Args:
            team_name: URL-safe team name slug.
            channels: List of channel name slugs to join.
            user_email: Employee email address.

        Returns:
            Dict with system, team, channels_joined, user_id, and team_added.
        """
        _log.info("Mattermost provision | team=%s | channels=%s | user=%s", team_name, channels, user_email)
        user = self.get_user_by_email(user_email)
        if user is None:
            _log.info("Mattermost user not found — creating | email=%s", user_email)
            username = user_email.split("@")[0].replace(".", "_")
            try:
                user = self.create_user(user_email, username)
            except requests.HTTPError:
                # Username may already exist — try lookup by username
                user = self.get_user_by_username(username)
                if user is None:
                    raise  # genuinely can't create or find the user

        user_id = user["id"]
        team = self.get_team_by_name(team_name)
        if team is None:
            _log.info("Team not found — creating | team=%s", team_name)
            team = self.create_team(team_name)

        team_id = team["id"]
        self.add_user_to_team(team_id, user_id)

        channel_results = []
        for ch_name in channels:
            ch = self.get_channel_by_name(team_id, ch_name)
            if ch is None:
                _log.info("Channel not found — creating | team=%s | channel=%s", team_name, ch_name)
                ch = self.create_channel(team_id, ch_name)
            self.add_user_to_channel(ch["id"], user_id)
            channel_results.append(ch_name)
            _log.debug("Mattermost: added user to channel #%s", ch_name)

        team_added = self.is_user_in_team(team_id, user_id)
        _log.info(
            "Mattermost provision complete | user=%s | channels_joined=%s | team_added=%s",
            user_email, channel_results, team_added,
        )
        return {
            "system": "mattermost",
            "team": team_name,
            "channels_joined": channel_results,
            "user_id": user_id,
            "team_added": team_added,
        }

    def verify_access(self, team_name: str, user_email: str) -> bool:
        """Verify whether a user is a member of a Mattermost team.

        Args:
            team_name: URL-safe team name slug.
            user_email: Employee email address to look up.

        Returns:
            True if the user is a team member, False on any error or if not found.
        """
        _log.debug("Mattermost verify access | team=%s | user=%s", team_name, user_email)
        try:
            user = self.get_user_by_email(user_email)
            if not user:
                _log.warning("Mattermost verify: user not found | email=%s", user_email)
                return False
            team = self.get_team_by_name(team_name)
            if not team:
                _log.warning("Mattermost verify: team not found | team=%s", team_name)
                return False
            result = self.is_user_in_team(team["id"], user["id"])
            _log.info("Mattermost access verification | user=%s | verified=%s", user_email, result)
            return result
        except Exception as e:
            _log.error("Mattermost verify_access error: %s", e)
            return False