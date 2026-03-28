from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

# Build engine kwargs based on DB backend
_engine_kwargs: dict = {
    "echo": settings.debug,
}

_is_sqlite = settings.database_url.startswith("sqlite")

if _is_sqlite:
    # SQLite: use StaticPool for aiosqlite (single connection, thread-safe)
    from sqlalchemy.pool import StaticPool

    _engine_kwargs.update(
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
else:
    # MySQL / PostgreSQL: proper connection pooling
    _engine_kwargs.update(
        pool_size=10,
        max_overflow=20,
        pool_recycle=3600,
        pool_pre_ping=True,
    )

engine = create_async_engine(settings.database_url, **_engine_kwargs)

async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncSession:
    async with async_session_maker() as session:
        yield session
