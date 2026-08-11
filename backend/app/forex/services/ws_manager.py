import asyncio
import json
import logging
from typing import Dict, Set
from fastapi import WebSocket

from app.forex.services.data_adapters import DataAdapterFactory

logger = logging.getLogger(__name__)

class ForexWebSocketManager:
    def __init__(self):
        # Format: { "Exness": {websocket1, websocket2}, "OANDA": {websocket3} }
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        self.running_tasks: Dict[str, asyncio.Task] = {}
        
    async def connect(self, websocket: WebSocket, broker: str = "Exness"):
        await websocket.accept()
        
        if broker not in self.active_connections:
            self.active_connections[broker] = set()
            
        self.active_connections[broker].add(websocket)
        logger.info(f"Client connected to Forex WS for broker: {broker}. Total clients for broker: {len(self.active_connections[broker])}")
        
        # Start broadcast task for this broker if not already running
        if broker not in self.running_tasks or self.running_tasks[broker].done():
            self.running_tasks[broker] = asyncio.create_task(self._broadcast_loop(broker))

    def disconnect(self, websocket: WebSocket, broker: str):
        if broker in self.active_connections and websocket in self.active_connections[broker]:
            self.active_connections[broker].remove(websocket)
            logger.info(f"Client disconnected from Forex WS for broker: {broker}.")
            
            # Stop broadcast task if no clients left
            if not self.active_connections[broker]:
                if broker in self.running_tasks:
                    self.running_tasks[broker].cancel()
                    del self.running_tasks[broker]
                del self.active_connections[broker]

    async def _broadcast_loop(self, broker: str):
        """Background task that pushes ticks to all clients subscribed to a specific broker."""
        adapter = DataAdapterFactory.get_adapter(broker)
        try:
            while True:
                # Generate new ticks
                ticks = adapter.get_latest_ticks()
                
                # Broadcast to all clients for this broker
                if broker in self.active_connections:
                    disconnected = set()
                    for connection in self.active_connections[broker]:
                        try:
                            await connection.send_text(json.dumps({
                                "type": "tick_update",
                                "broker": broker,
                                "data": ticks
                            }))
                        except Exception:
                            disconnected.add(connection)
                            
                    # Remove disconnected clients
                    for conn in disconnected:
                        self.disconnect(conn, broker)
                
                # Update interval (high frequency)
                await asyncio.sleep(1.0)
                
        except asyncio.CancelledError:
            logger.info(f"Broadcast loop for {broker} cancelled.")

# Global instance
forex_ws_manager = ForexWebSocketManager()
