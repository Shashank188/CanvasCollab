import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import eventStore from './eventStore.js';

class WebSocketManager {
  constructor() {
    this.wss = null;
    // Map of canvasId -> Set of WebSocket connections
    this.canvasRooms = new Map();
    // Map of WebSocket -> connection info
    this.connections = new Map();
  }

  initialize(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      const connectionId = uuidv4();
      const urlParams = new URL(req.url, 'http://localhost').searchParams;
      const userId = urlParams.get('userId') || uuidv4();
      
      console.log(`New connection: ${connectionId}, userId: ${userId}`);
      
      this.connections.set(ws, {
        id: connectionId,
        userId,
        canvasId: null,
        isAlive: true
      });

      ws.on('pong', () => {
        const connInfo = this.connections.get(ws);
        if (connInfo) {
          connInfo.isAlive = true;
        }
      });

      ws.on('message', async (data) => {
        let message;
        try {
          message = JSON.parse(data.toString());
        } catch (parseError) {
          console.error('Error parsing message:', parseError);
          this.sendError(ws, 'Invalid message format');
          return;
        }
        
        try {
          await this.handleMessage(ws, message);
        } catch (error) {
          console.error('Error handling message:', error);
          this.sendError(ws, `Error processing ${message.type}: ${error.message}`);
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.handleDisconnect(ws);
      });
    });

    // Heartbeat to keep connections alive
    setInterval(() => {
      this.wss.clients.forEach((ws) => {
        const connInfo = this.connections.get(ws);
        if (connInfo && !connInfo.isAlive) {
          return ws.terminate();
        }
        if (connInfo) {
          connInfo.isAlive = false;
        }
        ws.ping();
      });
    }, 30000);

    console.log('WebSocket server initialized');
  }

  async handleMessage(ws, message) {
    const connInfo = this.connections.get(ws);
    if (!connInfo) return;

    switch (message.type) {
      case 'JOIN_CANVAS':
        await this.handleJoinCanvas(ws, connInfo, message);
        break;

      case 'LEAVE_CANVAS':
        this.handleLeaveCanvas(ws, connInfo);
        break;

      case 'SHAPE_EVENT':
        await this.handleShapeEvent(ws, connInfo, message);
        break;

      case 'BATCH_SYNC':
        await this.handleBatchSync(ws, connInfo, message);
        break;

      case 'GET_STATE':
        await this.handleGetState(ws, connInfo, message);
        break;

      case 'CURSOR_MOVE':
        this.handleCursorMove(ws, connInfo, message);
        break;

      default:
        this.sendError(ws, `Unknown message type: ${message.type}`);
    }
  }

  async handleJoinCanvas(ws, connInfo, message) {
    const { canvasId, username } = message;
    
    if (!canvasId) {
      this.sendError(ws, 'Canvas ID is required');
      return;
    }
    
    try {
      // Leave previous canvas if any
      if (connInfo.canvasId) {
        this.handleLeaveCanvas(ws, connInfo);
      }

      // Ensure canvas exists
      await eventStore.getOrCreateCanvas(canvasId);

      // Join the canvas room
      connInfo.canvasId = canvasId;
      connInfo.username = username || `User-${connInfo.userId.slice(0, 4)}`;

      if (!this.canvasRooms.has(canvasId)) {
        this.canvasRooms.set(canvasId, new Set());
      }
      this.canvasRooms.get(canvasId).add(ws);

      // Get current canvas state
      const state = await eventStore.getCanvasState(canvasId);

      // Send JOIN_SUCCESS first so client knows they're joined
      this.send(ws, {
        type: 'JOIN_SUCCESS',
        canvasId,
        userId: connInfo.userId,
        username: connInfo.username
      });

      // Then send current canvas state
      this.send(ws, {
        type: 'CANVAS_STATE',
        canvasId,
        shapes: state.shapes,
        version: state.version,
        users: this.getCanvasUsers(canvasId)
      });

      // Notify other users about the new user
      this.broadcastToCanvas(canvasId, {
        type: 'USER_JOINED',
        userId: connInfo.userId,
        username: connInfo.username
      }, ws);

      console.log(`User ${connInfo.userId} joined canvas ${canvasId}`);
    } catch (error) {
      console.error('Error joining canvas:', error);
      this.send(ws, {
        type: 'JOIN_ERROR',
        canvasId,
        error: error.message
      });
    }
  }

  handleLeaveCanvas(ws, connInfo) {
    if (!connInfo.canvasId) return;

    const canvasId = connInfo.canvasId;
    const room = this.canvasRooms.get(canvasId);
    
    if (room) {
      room.delete(ws);
      if (room.size === 0) {
        this.canvasRooms.delete(canvasId);
      }
    }

    // Notify other users
    this.broadcastToCanvas(canvasId, {
      type: 'USER_LEFT',
      userId: connInfo.userId
    });

    connInfo.canvasId = null;
    console.log(`User ${connInfo.userId} left canvas ${canvasId}`);
  }

  async handleShapeEvent(ws, connInfo, message) {
    if (!connInfo.canvasId) {
      console.log(`Shape event rejected: user ${connInfo.userId} not joined to any canvas`);
      this.sendError(ws, 'Not joined to any canvas');
      return;
    }

    const { eventType, shapeId, payload, localEventId } = message;
    console.log(`Shape event: ${eventType} for shape ${shapeId} from user ${connInfo.userId} on canvas ${connInfo.canvasId}`);
    
    try {
      // Store event in database (if it's a storable event type)
      const storedEvent = await eventStore.storeEvent(
        connInfo.canvasId,
        connInfo.userId,
        eventType,
        shapeId,
        payload
      );

      // Send acknowledgment to sender
      this.send(ws, {
        type: 'EVENT_ACK',
        localEventId,
        eventId: storedEvent.eventId,
        version: storedEvent.version,
        stored: storedEvent.stored,
        hadConflict: storedEvent.hadConflict
      });

      // Get number of users in the room for logging
      const room = this.canvasRooms.get(connInfo.canvasId);
      const userCount = room ? room.size : 0;
      console.log(`Broadcasting ${eventType} to ${userCount - 1} other users in canvas ${connInfo.canvasId}`);

      // Always broadcast events to other users for real-time sync
      // Even non-stored events (like intermediate updates) should be broadcast
      this.broadcastToCanvas(connInfo.canvasId, {
        type: 'SHAPE_EVENT',
        eventId: storedEvent.eventId,
        eventType,
        shapeId,
        payload: storedEvent.payload || payload, // Use resolved payload if available
        userId: connInfo.userId,
        username: connInfo.username,
        version: storedEvent.version,
        stored: storedEvent.stored,
        vectorClock: payload?.vectorClock,
        propertyTimestamps: payload?.propertyTimestamps
      }, ws);

    } catch (error) {
      console.error('Error handling shape event:', error);
      this.sendError(ws, 'Failed to process event');
    }
  }

  async handleBatchSync(ws, connInfo, message) {
    if (!connInfo.canvasId) {
      this.sendError(ws, 'Not joined to any canvas');
      return;
    }

    const { events, lastKnownVersion } = message;
    
    try {
      // Get any events that happened while offline
      const missedEvents = await eventStore.getEventsSinceVersion(
        connInfo.canvasId,
        lastKnownVersion
      );

      // Store the batch of offline events (returns { storedEvents, conflicts })
      const result = await eventStore.storeBatchEvents(
        connInfo.canvasId,
        events.map(e => ({
          ...e,
          userId: connInfo.userId
        }))
      );

      const { storedEvents, conflicts } = result;

      // Get new state
      const state = await eventStore.getCanvasState(connInfo.canvasId);

      // Send sync result to the user, including any conflicts that were resolved
      this.send(ws, {
        type: 'BATCH_SYNC_RESULT',
        success: true,
        storedEvents: storedEvents.map(e => ({
          localEventId: events.find(le => le.shapeId === e.shapeId && le.eventType === e.eventType)?.localEventId,
          eventId: e.eventId,
          version: e.version,
          hadConflict: e.hadConflict
        })),
        missedEvents,
        currentState: state,
        conflicts: conflicts || []
      });

      // Broadcast all new events to other users
      for (const event of storedEvents) {
        this.broadcastToCanvas(connInfo.canvasId, {
          type: 'SHAPE_EVENT',
          eventId: event.eventId,
          eventType: event.eventType,
          shapeId: event.shapeId,
          payload: event.payload,
          userId: connInfo.userId,
          username: connInfo.username,
          version: event.version,
          vectorClock: event.payload?.vectorClock,
          propertyTimestamps: event.payload?.propertyTimestamps
        }, ws);
      }

    } catch (error) {
      console.error('Error handling batch sync:', error);
      this.send(ws, {
        type: 'BATCH_SYNC_RESULT',
        success: false,
        error: 'Failed to sync events'
      });
    }
  }

  async handleGetState(ws, connInfo, message) {
    if (!connInfo.canvasId) {
      this.sendError(ws, 'Not joined to any canvas');
      return;
    }

    const { sinceVersion } = message;

    try {
      if (sinceVersion !== undefined) {
        // Get incremental updates
        const events = await eventStore.getEventsSinceVersion(
          connInfo.canvasId,
          sinceVersion
        );
        this.send(ws, {
          type: 'INCREMENTAL_UPDATE',
          events
        });
      } else {
        // Get full state
        const state = await eventStore.getCanvasState(connInfo.canvasId);
        this.send(ws, {
          type: 'CANVAS_STATE',
          canvasId: connInfo.canvasId,
          shapes: state.shapes,
          version: state.version,
          users: this.getCanvasUsers(connInfo.canvasId)
        });
      }
    } catch (error) {
      console.error('Error getting state:', error);
      this.sendError(ws, 'Failed to get canvas state');
    }
  }

  handleCursorMove(ws, connInfo, message) {
    if (!connInfo.canvasId) return;

    // Broadcast cursor position to other users (no storage needed)
    this.broadcastToCanvas(connInfo.canvasId, {
      type: 'CURSOR_MOVE',
      userId: connInfo.userId,
      username: connInfo.username,
      x: message.x,
      y: message.y
    }, ws);
  }

  handleDisconnect(ws) {
    const connInfo = this.connections.get(ws);
    if (connInfo) {
      if (connInfo.canvasId) {
        this.handleLeaveCanvas(ws, connInfo);
      }
      this.connections.delete(ws);
      console.log(`Connection ${connInfo.id} disconnected`);
    }
  }

  getCanvasUsers(canvasId) {
    const room = this.canvasRooms.get(canvasId);
    if (!room) return [];

    const users = [];
    for (const ws of room) {
      const connInfo = this.connections.get(ws);
      if (connInfo) {
        users.push({
          userId: connInfo.userId,
          username: connInfo.username
        });
      }
    }
    return users;
  }

  send(ws, message) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  sendError(ws, error) {
    this.send(ws, {
      type: 'ERROR',
      error
    });
  }

  broadcastToCanvas(canvasId, message, excludeWs = null) {
    const room = this.canvasRooms.get(canvasId);
    if (!room) return;

    for (const ws of room) {
      if (ws !== excludeWs) {
        this.send(ws, message);
      }
    }
  }

  broadcastToAll(message) {
    this.wss.clients.forEach((ws) => {
      this.send(ws, message);
    });
  }
}

export default new WebSocketManager();
