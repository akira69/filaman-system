"""Tests for CLI password reset functionality."""

import pytest
from datetime import datetime, UTC

from app.cli import reset_password_core
from app.core.security import hash_password, verify_password_async
from app.models.user import User


class TestResetPasswordCore:
    """Test suite for reset_password_core() function."""

    @pytest.mark.asyncio
    async def test_reset_password_success(self, db_session):
        """Test successful password reset with verification."""
        # Create user with old password
        user = User(
            email="reset-success@test.com",
            password_hash=hash_password("oldpassword123"),
            is_active=True,
            deleted_at=None,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        old_hash = user.password_hash

        # Reset password
        result = await reset_password_core(
            "reset-success@test.com", "newpassword123", db_session
        )

        # Verify result message
        assert "successfully" in result.lower()
        assert "reset-success@test.com" in result

        # Verify new hash is different
        await db_session.refresh(user)
        assert user.password_hash != old_hash

        # Verify new password works
        is_valid = await verify_password_async("newpassword123", user.password_hash)
        assert is_valid

        # Verify old password doesn't work
        is_invalid = await verify_password_async("oldpassword123", user.password_hash)
        assert not is_invalid

    @pytest.mark.asyncio
    async def test_reset_password_user_not_found(self, db_session):
        """Test reset with non-existent user email raises ValueError."""
        with pytest.raises(ValueError, match="not found"):
            await reset_password_core(
                "nonexistent@test.com", "newpassword123", db_session
            )

    @pytest.mark.asyncio
    async def test_reset_password_deleted_user_ignored(self, db_session):
        """Test reset with deleted user (deleted_at != None) raises ValueError."""
        # Create deleted user
        user = User(
            email="deleted@test.com",
            password_hash=hash_password("oldpassword"),
            is_active=True,
            deleted_at=datetime.now(UTC),
        )
        db_session.add(user)
        await db_session.commit()

        # Try to reset deleted user's password
        with pytest.raises(ValueError, match="not found"):
            await reset_password_core("deleted@test.com", "newpassword123", db_session)

    @pytest.mark.asyncio
    async def test_reset_password_oidc_only_user(self, db_session):
        """Test reset works for OIDC-only user (password_hash=None)."""
        # Create OIDC-only user (no password hash)
        user = User(
            email="oidc-user@test.com",
            password_hash=None,
            is_active=True,
            deleted_at=None,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        # Reset password should work
        result = await reset_password_core(
            "oidc-user@test.com", "newpassword123", db_session
        )

        # Verify result
        assert "successfully" in result.lower()
        assert "oidc-user@test.com" in result

        # Verify new hash is set
        await db_session.refresh(user)
        assert user.password_hash is not None

        # Verify new password works
        is_valid = await verify_password_async("newpassword123", user.password_hash)
        assert is_valid

    @pytest.mark.asyncio
    async def test_reset_password_deactivated_user(self, db_session):
        """Test reset works for deactivated user (is_active=False)."""
        # Create deactivated user
        user = User(
            email="deactivated@test.com",
            password_hash=hash_password("oldpassword"),
            is_active=False,
            deleted_at=None,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        # Reset password should work even if deactivated
        result = await reset_password_core(
            "deactivated@test.com", "newpassword123", db_session
        )

        # Verify result
        assert "successfully" in result.lower()
        assert "deactivated@test.com" in result

        # Verify new password works
        await db_session.refresh(user)
        is_valid = await verify_password_async("newpassword123", user.password_hash)
        assert is_valid
