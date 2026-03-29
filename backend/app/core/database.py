from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool, QueuePool

from app.core.config import settings

# Build engine kwargs based on DB backend
_engine_kwargs: dict = {
    "echo": settings.debug,
}

_is_sqlite = settings.database_url.startswith("sqlite")

if _is_sqlite:
    # SQLite: NullPool – every checkout creates a fresh connection and closes it
    # on return.  This avoids long-held file-locks when multiple Gunicorn workers
    # run against the same SQLite file.  A 30-second busy_timeout lets workers
    # wait for each other instead of failing immediately on write contention.
    _engine_kwargs.update(
        poolclass=NullPool,
        connect_args={
            "check_same_thread": False,
            "timeout": 30,  # SQLite busy_timeout in seconds
        },
    )
else:
    # MySQL / PostgreSQL: proper connection pooling
    _engine_kwargs.update(
        poolclass=QueuePool,
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
