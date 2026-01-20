import express from 'express';
import cors from 'cors';
import http from 'http';
import dotenv from 'dotenv';
import websocketManager from './services/websocketManager.js';
import eventStore from './services/eventStore.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// REST API Routes

// Get canvas info
app.get('/api/canvas/:canvasId', async (req, res) => {
  try {
    const canvas = await eventStore.getCanvas(req.params.canvasId);
    if (!canvas) {
      return res.status(404).json({ error: 'Canvas not found' });
    }
    res.json(canvas);
  } catch (error) {
    console.error('Error getting canvas:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get canvas state (all shapes)
app.get('/api/canvas/:canvasId/state', async (req, res) => {
  try {
    const state = await eventStore.getCanvasState(req.params.canvasId);
    res.json(state);
  } catch (error) {
    console.error('Error getting canvas state:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get events since version (for sync)
app.get('/api/canvas/:canvasId/events', async (req, res) => {
  try {
    const sinceVersion = parseInt(req.query.since) || 0;
    const events = await eventStore.getEventsSinceVersion(
      req.params.canvasId,
      sinceVersion
    );
    res.json({ events });
  } catch (error) {
    console.error('Error getting events:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create or ensure canvas exists
app.post('/api/canvas', async (req, res) => {
  try {
    const { canvasId, name } = req.body;
    const canvas = await eventStore.getOrCreateCanvas(canvasId, name);
    res.json(canvas);
  } catch (error) {
    console.error('Error creating canvas:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Batch sync endpoint for offline events
app.post('/api/canvas/:canvasId/sync', async (req, res) => {
  try {
    const { events, lastKnownVersion, userId } = req.body;
    const canvasId = req.params.canvasId;

    // Get missed events
    const missedEvents = await eventStore.getEventsSinceVersion(
      canvasId,
      lastKnownVersion
    );

    // Store batch events
    const storedEvents = await eventStore.storeBatchEvents(
      canvasId,
      events.map(e => ({ ...e, userId }))
    );

    // Get current state
    const state = await eventStore.getCanvasState(canvasId);

    res.json({
      success: true,
      storedEvents,
      missedEvents,
      currentState: state
    });
  } catch (error) {
    console.error('Error syncing events:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Initialize WebSocket
websocketManager.initialize(server);

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}`);
});
