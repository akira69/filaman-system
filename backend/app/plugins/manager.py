import importlib
import logging
from typing import Any, Callable

from sqlalchemy import select

from app.core.database import async_session_maker
from app.models import Printer
from app.plugins.base import BaseDriver

logger = logging.getLogger(__name__)


class EventEmitter:
    def __init__(self, printer_id: int, handler: Callable[[dict], None]):
        self.printer_id = printer_id
        self.handler = handler

    def emit(self, event_dict: dict[str, Any]) -> None:
        event_dict["printer_id"] = self.printer_id
        try:
            self.handler(event_dict)
        except Exception as e:
            logger.error(f"Error handling event for printer {self.printer_id}: {e}")

class PluginManager:
    def __init__(self):
        self.drivers: dict[int, BaseDriver] = {}
        self.health_status: dict[int, dict[str, Any]] = {}

    def _create_event_handler(self, printer_id: int) -> Callable[[dict], None]:
        def handler(event: dict) -> None:
            import asyncio

            asyncio.create_task(self._handle_event(printer_id, event))

        return handler

    async def _handle_event(self, printer_id: int, event: dict) -> None:
        event_type = event.get("event_type")
        logger.info(f"Received event {event_type} for printer {printer_id}")
    def load_driver(self, driver_key: str) -> type[BaseDriver] | None:
        try:
            module = importlib.import_module(f"app.plugins.{driver_key}.driver")
            driver_class = getattr(module, "Driver", None)
            if driver_class and issubclass(driver_class, BaseDriver):
                return driver_class
        except ImportError as e:
            logger.warning(f"Could not load plugin {driver_key}: {e}")
        return None

    async def start_printer(self, printer: Printer) -> bool:
        if printer.id in self.drivers:
            return True

        driver_class = self.load_driver(printer.driver_key)
        if not driver_class:
            logger.error(f"Driver not found: {printer.driver_key}")
            self.health_status[printer.id] = {
                "status": "error",
                "message": f"Driver not found: {printer.driver_key}",
            }
            return False

        emitter = EventEmitter(printer.id, self._create_event_handler(printer.id))
        config = printer.driver_config or {}

        try:
            driver = driver_class(
                printer_id=printer.id,
                config=config,
                emitter=emitter.emit,
            )
            driver.validate_config()
            await driver.start()
            self.drivers[printer.id] = driver
            self.health_status[printer.id] = driver.health()
            logger.info(f"Started driver {printer.driver_key} for printer {printer.id}")
            return True
        except Exception as e:
            logger.error(f"Error starting driver for printer {printer.id}: {e}")
            self.health_status[printer.id] = {
                "status": "error",
                "message": str(e),
            }
            return False

    async def stop_printer(self, printer_id: int) -> None:
        driver = self.drivers.pop(printer_id, None)
        if driver:
            try:
                await driver.stop()
                logger.info(f"Stopped driver for printer {printer_id}")
            except Exception as e:
                logger.error(f"Error stopping driver for printer {printer_id}: {e}")

    async def start_all(self) -> None:
        async with async_session_maker() as db:
            result = await db.execute(
                select(Printer).where(
                    Printer.is_active == True,
                    Printer.deleted_at.is_(None),
                )
            )
            printers = result.scalars().all()

            for printer in printers:
                await self.start_printer(printer)

    async def stop_all(self) -> None:
        for printer_id in list(self.drivers.keys()):
            await self.stop_printer(printer_id)

    def get_health(self) -> dict[int, dict[str, Any]]:
        for printer_id, driver in self.drivers.items():
            self.health_status[printer_id] = driver.health()
        return self.health_status


plugin_manager = PluginManager()
