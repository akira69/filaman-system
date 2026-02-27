import pytest
from httpx import AsyncClient

from app.core.security import hash_password, hash_token, generate_token_secret
from app.models import User, UserSession


class TestAuthLogin:
    @pytest.mark.asyncio
    async def test_login_success(self, client: AsyncClient, admin_user):
        response = await client.post("/auth/login", json={
            "email": "test-admin@example.com",
            "password": "testpassword",
        })
        
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "test-admin@example.com"
        assert "session_id" in response.cookies
        assert "csrf_token" in response.cookies

    @pytest.mark.asyncio
    async def test_login_invalid_password(self, client: AsyncClient, admin_user):
        response = await client.post("/auth/login", json={
            "email": "test-admin@example.com",
            "password": "wrongpassword",
        })
        
        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "invalid_credentials"

    @pytest.mark.asyncio
    async def test_login_invalid_email(self, client: AsyncClient):
        response = await client.post("/auth/login", json={
            "email": "nonexistent@example.com",
            "password": "testpassword",
        })
        
        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "invalid_credentials"

    @pytest.mark.asyncio
    async def test_login_disabled_user(self, client: AsyncClient, db_session):
        user = User(
            email="disabled@example.com",
            password_hash=hash_password("testpassword"),
            is_active=False,
        )
        db_session.add(user)
        await db_session.commit()
        
        response = await client.post("/auth/login", json={
            "email": "disabled@example.com",
            "password": "testpassword",
        })
        
        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "account_disabled"


class TestAuthMe:
    @pytest.mark.asyncio
    async def test_me_authenticated(self, auth_client):
        client, _ = auth_client
        
        response = await client.get("/auth/me")
        
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "test-admin@example.com"
        assert data["is_superadmin"] is True
        assert "permissions" in data

    @pytest.mark.asyncio
    async def test_me_unauthenticated(self, client: AsyncClient):
        response = await client.get("/auth/me")
        
        assert response.status_code == 401


class TestAuthLogout:
    @pytest.mark.asyncio
    async def test_logout_success(self, auth_client, db_session):
        client, csrf_token = auth_client
        
        response = await client.post(
            "/auth/logout",
            headers={"X-CSRF-Token": csrf_token},
        )
        
        assert response.status_code == 200
        
        # httpx does not automatically remove expired cookies from the jar,
        # so check the response Set-Cookie header instead.
        set_cookie_headers = response.headers.get_list("set-cookie")
        session_deleted = any(
            "session_id" in h and ('max-age=0' in h.lower() or 'expires=thu, 01 jan 1970' in h.lower())
            for h in set_cookie_headers
        )
        assert session_deleted, f"Expected session_id cookie to be deleted. Set-Cookie headers: {set_cookie_headers}"


class TestCSRF:
    @pytest.mark.asyncio
    async def test_csrf_required_for_mutating_requests(self, auth_client):
        client, _ = auth_client
        
        response = await client.post("/api/v1/locations", json={
            "name": "Test Location",
        })
        
        assert response.status_code == 403
        assert response.json()["code"] == "csrf_failed"

    @pytest.mark.asyncio
    async def test_csrf_valid_token_accepted(self, auth_client):
        client, csrf_token = auth_client
        
        response = await client.post(
            "/api/v1/locations",
            json={"name": "Test Location"},
            headers={"X-CSRF-Token": csrf_token},
        )
        
        assert response.status_code == 201

    @pytest.mark.asyncio
    async def test_csrf_mismatch_rejected(self, auth_client):
        client, _ = auth_client
        
        response = await client.post(
            "/api/v1/locations",
            json={"name": "Test Location"},
            headers={"X-CSRF-Token": "wrong-token"},
        )
        
        assert response.status_code == 403
        assert response.json()["code"] == "csrf_failed"

    @pytest.mark.asyncio
    async def test_csrf_not_required_for_get(self, auth_client):
        client, _ = auth_client
        
        response = await client.get("/api/v1/locations")
        
        assert response.status_code == 200


class TestAuthMiddleware:
    @pytest.mark.asyncio
    async def test_session_auth(self, auth_client):
        client, _ = auth_client
        
        response = await client.get("/api/v1/me")
        
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_api_key_auth(self, client: AsyncClient, admin_user, db_session):
        from app.models import UserApiKey
        
        secret = generate_token_secret()
        api_key = UserApiKey(
            user_id=admin_user.id,
            name="Test Key",
            key_hash=hash_token(secret),
        )
        db_session.add(api_key)
        await db_session.commit()
        await db_session.refresh(api_key)
        
        token = f"uak.{api_key.id}.{secret}"
        response = await client.get(
            "/api/v1/me",
            headers={"Authorization": f"ApiKey {token}"},
        )
        
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_device_auth(self, client: AsyncClient, db_session):
        from app.models import Device
        
        secret = generate_token_secret()
        device = Device(
            name="Test Device",
            device_type="scale",
            token_hash=hash_token(secret),
            scopes=["spool_events:create_measurement"],
        )
        db_session.add(device)
        await db_session.commit()
        await db_session.refresh(device)
        
        token = f"dev.{device.id}.{secret}"
        response = await client.get(
            "/api/v1/spools",
            headers={"Authorization": f"Device {token}"},
        )
        
        assert response.status_code == 200
