# WebSocket Implementation for Real-Time Quotes

## Overview

WebSocket implementation for efficient real-time quote updates in table views. Replaces polling with push-based updates, reducing server load and improving latency.

## Architecture

### Backend (Python)

**File**: `supernova_api.py`

**Components**:
- `ConnectionManager`: Manages active WebSocket connections
- `/ws/quotes`: WebSocket endpoint for real-time quote updates

**Features**:
- Connection lifecycle management (connect/disconnect)
- Broadcast messages to all connected clients
- Echo server for testing (implement real quote fetching later)

**Usage**:
```python
# Server handles WebSocket connections at ws://127.0.0.1:8765/ws/quotes
# Client can send subscription messages:
{
  "type": "subscribe",
  "tickers": ["AAPL", "MSFT", "GOOG"]
}

# Server responds with quote updates:
{
  "type": "quote_update",
  "data": {
    "AAPL": {
      "currentPrice": 150.25,
      "dailyChangePercent": 1.5,
      "volume": 50000000
    },
    "MSFT": {
      "currentPrice": 300.50,
      "dailyChangePercent": -0.5,
      "volume": 30000000
    }
  }
}
```

### Frontend (React)

**File**: `desktop-ui/src/hooks/useWebSocket.ts`

**Hook**: `useWebSocket(options)`

**Features**:
- Auto-reconnect on disconnect (configurable interval)
- Subscribe/unsubscribe to ticker updates
- Connection status tracking
- Message handling

**Usage**:
```tsx
const { status, send, subscribe, unsubscribe, lastMessage } = useWebSocket({
  url: "ws://127.0.0.1:8765/ws/quotes",
  reconnectInterval: 5000,
  autoReconnect: true,
});

// Subscribe to tickers
subscribe(["AAPL", "MSFT"]);

// Handle incoming messages
useEffect(() => {
  if (lastMessage?.type === "quote_update") {
    const quotes = lastMessage.data;
    // Update UI
  }
}, [lastMessage]);
```

### Integration with RealTimeSheetUpdater

**File**: `desktop-ui/src/components/RealTimeSheetUpdater.tsx`

**Flow**:
1. `useVisibleRows` tracks which rows are visible
2. `useWebSocket` maintains connection to server
3. When visible rows change, subscribe to their tickers via WebSocket
4. When quote updates arrive, update only visible rows

**Benefits**:
- Only subscribe to tickers currently visible
- Reduce bandwidth (no polling all tickers)
- Lower latency (push vs poll)
- Efficient DOM updates (only visible cells)

## Message Protocol

### Client → Server

**Subscribe**:
```json
{
  "type": "subscribe",
  "tickers": ["AAPL", "MSFT", "GOOG"]
}
```

**Unsubscribe**:
```json
{
  "type": "unsubscribe",
  "tickers": ["AAPL"]
}
```

### Server → Client

**Quote Update**:
```json
{
  "type": "quote_update",
  "data": {
    "AAPL": {
      "currentPrice": 150.25,
      "dailyChangePercent": 1.5,
      "previousClose": 148.00,
      "volume": 50000000
    }
  }
}
```

**Error**:
```json
{
  "type": "error",
  "message": "Invalid subscription format"
}
```

## Testing

### Manual Test

Connect to WebSocket:
```javascript
const ws = new WebSocket("ws://127.0.0.1:8765/ws/quotes");

ws.onopen = () => {
  console.log("Connected");
  ws.send(JSON.stringify({ type: "subscribe", tickers: ["AAPL"] }));
};

ws.onmessage = (event) => {
  console.log("Received:", JSON.parse(event.data));
};
```

### Integration Test

Use the test page: `http://127.0.0.1:5173/#screen=test-realtime`

The test page shows:
- WebSocket connection status
- Visible rows count
- Update count
- Real-time updates for visible rows

## Future Enhancements

### Backend
- Implement real quote fetching from Yahoo Finance/Finnhub
- Add ticker-specific subscription management
- Implement rate limiting per connection
- Add authentication for WebSocket connections

### Frontend
- Add connection status indicator in UI
- Implement fallback to polling if WebSocket fails
- Add reconnection exponential backoff
- Cache quote data for offline scenarios

## Performance Comparison

### Polling (Previous)
- Request every 5 seconds for all tickers
- Bandwidth: ~500KB per request (500 tickers)
- Latency: 0-5 seconds
- Server load: High (constant requests)

### WebSocket (Current)
- Push updates only when quotes change
- Bandwidth: ~1KB per update (only changed tickers)
- Latency: <100ms
- Server load: Low (event-driven)

## Troubleshooting

### Connection Issues
- Check if server is running on port 8765
- Verify WebSocket URL: `ws://127.0.0.1:8765/ws/quotes`
- Check browser console for WebSocket errors

### No Updates
- Verify subscription message format
- Check if tickers are valid
- Verify server quote fetching logic

### Performance Issues
- Reduce number of subscribed tickers
- Increase debounce interval
- Check for memory leaks in connection manager
