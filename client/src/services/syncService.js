import { v4 as uuidv4 } from 'uuid';
import indexedDb from './indexedDb.js';
import websocket from './websocket.js';
import { throttle, debounce } from '@/utils/throttle.js';
import { 
  ConflictResolver, 
  STORED_EVENT_TYPES, 
  shouldStoreEvent,
  mergeShapeProperties 
} from '@/utils/conflictResolution.js';

// Throttle intervals in milliseconds
const THROTTLE_INTERVALS = {
  CURSOR_MOVE: 50,      // 20 updates per second max
  DRAG_MOVE: 100,       // 10 updates per second during drag
  SHAPE_EDIT: 300,      // Debounce edits
  POINTER_DOWN: 0       // No throttle for pointer down
};

class SyncService {
  constructor() {
    this.isOnline = navigator.onLine;
    this.isSyncing = false;
    this.canvasId = null;
    this.lastKnownVersion = 0;
    this.eventHandlers = new Map();
    this.conflictResolver = null;
    this.userId = null;
    this._listenersSetup = false;
    
    // Throttled/debounced event senders
    this._throttledSenders = new Map();
    
    // Pending batched updates (for combining rapid changes)
    this._pendingUpdates = new Map();
    
    // Set up online/offline listeners immediately
    this._setupNetworkListeners();
  }
  
  _setupNetworkListeners() {
    if (this._listenersSetup) return;
    this._listenersSetup = true;
    
    // Bind handlers so we can reference them later
    this._onlineHandler = () => this.handleOnline();
    this._offlineHandler = () => this.handleOffline();
    
    window.addEventListener('online', this._onlineHandler);
    window.addEventListener('offline', this._offlineHandler);
    
    // Also update immediately based on current state
    this.isOnline = navigator.onLine;
    console.log('SyncService: Network listeners setup, online:', this.isOnline);
  }

  async init(canvasId, userId) {
    this.canvasId = canvasId;
    this.userId = userId || uuidv4();
    this.conflictResolver = new ConflictResolver(this.userId);
    
    await indexedDb.init();

    // Ensure network listeners are set up (in case constructor didn't run)
    this._setupNetworkListeners();

    // Get cached version
    const cached = await indexedDb.getCachedCanvasState(canvasId);
    if (cached) {
      this.lastKnownVersion = cached.version || 0;
    }

    // Set up throttled senders
    this._setupThrottledSenders();
    
    // Update online status from navigator
    this.isOnline = navigator.onLine;

    return this;
  }

  _setupThrottledSenders() {
    // Throttled cursor move (only when online)
    this._throttledSenders.set('CURSOR_MOVE', throttle((x, y) => {
      if (websocket.isReady()) {
        websocket.sendCursorMove(x, y);
      }
    }, THROTTLE_INTERVALS.CURSOR_MOVE));

    // Debounced shape edit (combines rapid edits)
    // Uses _sendEvent which handles online/offline automatically
    this._throttledSenders.set('SHAPE_EDIT', debounce(async (shapeId) => {
      const pendingUpdate = this._pendingUpdates.get(shapeId);
      if (pendingUpdate) {
        await this._sendEvent(STORED_EVENT_TYPES.SHAPE_EDITED, shapeId, pendingUpdate);
        this._pendingUpdates.delete(shapeId);
      }
    }, THROTTLE_INTERVALS.SHAPE_EDIT));
  }

  handleOnline() {
    console.log('SyncService: Network status changed to Online');
    this.isOnline = true;
    this.emit('online');
    
    // Slight delay to ensure WebSocket has time to reconnect
    setTimeout(() => {
      if (this._canSendOnline()) {
        this.syncPendingEvents();
      }
    }, 1000);
  }

  handleOffline() {
    console.log('SyncService: Network status changed to Offline');
    this.isOnline = false;
    this.emit('offline');
    
    // Flush any pending debounced updates to IndexedDB immediately
    this._flushPendingUpdatesToStorage();
  }
  
  // Flush pending debounced updates directly to IndexedDB when going offline
  async _flushPendingUpdatesToStorage() {
    for (const [shapeId, update] of this._pendingUpdates) {
      const event = {
        localEventId: uuidv4(),
        canvasId: this.canvasId,
        eventType: STORED_EVENT_TYPES.SHAPE_EDITED,
        shapeId,
        payload: update,
        timestamp: Date.now(),
        userId: this.userId
      };
      await indexedDb.addPendingEvent(event);
      this.emit('eventQueued', event);
    }
    this._pendingUpdates.clear();
    console.log('SyncService: Flushed pending updates to IndexedDB');
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    this.eventHandlers.get(event)?.delete(handler);
  }

  emit(event, data) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  // Send cursor position (throttled, not stored)
  sendCursorMove(x, y) {
    const sender = this._throttledSenders.get('CURSOR_MOVE');
    if (sender) {
      sender(x, y);
    }
  }

  // Queue pointer down event
  async queuePointerDown(x, y, shapeId = null) {
    return this.queueEvent(STORED_EVENT_TYPES.POINTER_DOWN, shapeId, { x, y });
  }

  // Queue drag start event
  async queueDragStart(shapeId, startPosition) {
    return this.queueEvent(STORED_EVENT_TYPES.DRAG_START, shapeId, { 
      startPosition,
      timestamp: Date.now()
    });
  }

  // Queue drag end event (stores final position)
  async queueDragEnd(shapeId, startPosition, endPosition) {
    return this.queueEvent(STORED_EVENT_TYPES.DRAG_END, shapeId, { 
      startPosition,
      endPosition,
      timestamp: Date.now()
    });
  }

  // Queue shape created event
  async queueShapeCreated(shapeId, shapeType, properties) {
    const clockInfo = this.conflictResolver.recordLocalOperation(shapeId, properties);
    return this.queueEvent(STORED_EVENT_TYPES.SHAPE_CREATED, shapeId, { 
      type: shapeType,
      properties,
      ...clockInfo
    });
  }

  // Queue shape edited event (debounced)
  async queueShapeEdited(shapeId, properties) {
    // Record conflict resolution info
    const clockInfo = this.conflictResolver.recordLocalOperation(shapeId, properties);
    
    // Merge with any pending updates for this shape
    const existingUpdate = this._pendingUpdates.get(shapeId) || { properties: {} };
    this._pendingUpdates.set(shapeId, {
      properties: { ...existingUpdate.properties, ...properties },
      ...clockInfo
    });
    
    // Trigger debounced send
    const sender = this._throttledSenders.get('SHAPE_EDIT');
    if (sender) {
      sender(shapeId);
    }
    
    return { shapeId, properties, debounced: true };
  }

  // Queue shape moved event (only stores start and end)
  async queueShapeMoved(shapeId, newPosition) {
    const clockInfo = this.conflictResolver.recordLocalOperation(shapeId, newPosition);
    return this.queueEvent(STORED_EVENT_TYPES.SHAPE_MOVED, shapeId, { 
      position: newPosition,
      ...clockInfo
    });
  }

  // Queue shape deleted event
  async queueShapeDeleted(shapeId) {
    return this.queueEvent(STORED_EVENT_TYPES.SHAPE_DELETED, shapeId, {
      timestamp: Date.now()
    });
  }

  // Check if we can send events over the network
  _canSendOnline() {
    // Check both navigator.onLine and actual WebSocket state
    return navigator.onLine && this.isOnline && websocket.isReady();
  }

  // Internal method to send events
  async _sendEvent(eventType, shapeId, payload) {
    const localEventId = uuidv4();
    
    const event = {
      localEventId,
      canvasId: this.canvasId,
      eventType,
      shapeId,
      payload,
      timestamp: Date.now(),
      userId: this.userId
    };

    // Only try to send if we're truly online and connected
    if (this._canSendOnline()) {
      try {
        const ack = await websocket.sendShapeEvent(eventType, shapeId, payload);
        this.lastKnownVersion = ack.version;
        return { ...event, synced: true, version: ack.version };
      } catch (error) {
        console.warn('Failed to send event, storing offline:', error.message);
        // Falls through to IndexedDB storage
      }
    } else {
      console.log('Offline: storing event locally for later sync');
    }

    // Store in IndexedDB for later sync (only storable events)
    if (shouldStoreEvent(eventType)) {
      await indexedDb.addPendingEvent(event);
      this.emit('eventQueued', event);
    }
    
    return { ...event, synced: false };
  }

  // Queue an event for processing (generic method)
  async queueEvent(eventType, shapeId, payload) {
    // Only store specific event types
    if (!shouldStoreEvent(eventType)) {
      console.warn(`Event type ${eventType} is not stored`);
      return null;
    }

    return this._sendEvent(eventType, shapeId, payload);
  }

  // Handle incoming remote event with conflict resolution
  handleRemoteEvent(event, localShape) {
    if (!localShape || !event.payload) {
      return { action: 'APPLY_REMOTE', shape: event.payload?.properties };
    }

    // Use conflict resolver
    const resolution = this.conflictResolver.resolveConflict(
      event.shapeId,
      localShape,
      event
    );

    // Update vector clock from remote
    if (event.vectorClock) {
      this.conflictResolver.updateFromRemote(event.vectorClock);
    }

    return resolution;
  }

  // Sync pending events when coming back online
  async syncPendingEvents() {
    if (this.isSyncing || !this._canSendOnline()) {
      return;
    }

    // First, flush any pending debounced updates
    for (const [shapeId, update] of this._pendingUpdates) {
      await this._sendEvent(STORED_EVENT_TYPES.SHAPE_EDITED, shapeId, update);
    }
    this._pendingUpdates.clear();

    const pendingEvents = await indexedDb.getPendingEvents(this.canvasId);
    if (pendingEvents.length === 0) {
      return;
    }

    this.isSyncing = true;
    this.emit('syncStart', { count: pendingEvents.length });

    try {
      // Send batch sync request with conflict resolution metadata
      const result = await websocket.batchSync(
        pendingEvents.map(e => ({
          localEventId: e.localEventId,
          eventType: e.eventType,
          shapeId: e.shapeId,
          payload: e.payload,
          vectorClock: this.conflictResolver.getVectorClock(),
          timestamp: e.timestamp
        })),
        this.lastKnownVersion
      );

      // Process any conflicts from the sync
      if (result.conflicts && result.conflicts.length > 0) {
        await this._resolveServerConflicts(result.conflicts);
      }

      // Clear synced events from IndexedDB
      await indexedDb.clearPendingEvents(this.canvasId);

      // Update version
      if (result.currentState) {
        this.lastKnownVersion = result.currentState.version;
        await this.cacheState(result.currentState);
      }

      this.emit('syncComplete', result);
      console.log(`Synced ${pendingEvents.length} pending events`);

    } catch (error) {
      console.error('Sync failed:', error);
      this.emit('syncError', error);
    } finally {
      this.isSyncing = false;
    }
  }

  // Resolve conflicts returned from server
  async _resolveServerConflicts(conflicts) {
    const resolutions = [];
    
    for (const conflict of conflicts) {
      const { shapeId, localVersion, serverVersion, serverTimestamps } = conflict;
      
      // Get local shape state
      const cached = await indexedDb.getCachedCanvasState(this.canvasId);
      const localShape = cached?.shapes?.find(s => s.id === shapeId);
      
      if (localShape) {
        // Merge properties using timestamps
        const merged = mergeShapeProperties(
          {},
          localVersion,
          serverVersion,
          this.conflictResolver.propertyTimestamps.get(shapeId) || {},
          serverTimestamps || {}
        );
        
        resolutions.push({
          shapeId,
          mergedProperties: merged
        });
      }
    }
    
    // Emit conflict resolution for UI to handle
    if (resolutions.length > 0) {
      this.emit('conflictsResolved', resolutions);
    }
    
    return resolutions;
  }

  // Cache the current state
  async cacheState(state) {
    await indexedDb.cacheCanvasState(this.canvasId, {
      shapes: state.shapes,
      version: state.version
    });
    this.lastKnownVersion = state.version;
  }

  // Get the state, either from server or cache
  async getState() {
    // Try to get from server first
    if (this.isOnline && websocket.isConnected) {
      return new Promise((resolve) => {
        const handler = async (message) => {
          websocket.off('CANVAS_STATE', handler);
          
          // Cache the state
          await this.cacheState({
            shapes: message.shapes,
            version: message.version
          });

          // Apply any pending events
          const pending = await indexedDb.getPendingEvents(this.canvasId);
          const shapes = indexedDb.applyPendingEventsToState(message.shapes, pending);

          resolve({
            shapes,
            version: message.version,
            users: message.users,
            hasPending: pending.length > 0
          });
        };

        websocket.on('CANVAS_STATE', handler);
        websocket.getState();

        // Timeout - fall back to cache
        setTimeout(async () => {
          websocket.off('CANVAS_STATE', handler);
          resolve(await this.getStateFromCache());
        }, 5000);
      });
    }

    // Fall back to cached state
    return await this.getStateFromCache();
  }

  async getStateFromCache() {
    const cached = await indexedDb.getCachedCanvasState(this.canvasId);
    if (!cached) {
      return { shapes: [], version: 0, users: [], fromCache: true };
    }

    // Apply pending events
    const pending = await indexedDb.getPendingEvents(this.canvasId);
    const shapes = indexedDb.applyPendingEventsToState(cached.shapes || [], pending);

    return {
      shapes,
      version: cached.version || 0,
      users: [],
      fromCache: true,
      hasPending: pending.length > 0
    };
  }

  async hasPendingChanges() {
    return await indexedDb.hasPendingEvents(this.canvasId);
  }

  async getPendingCount() {
    const pending = await indexedDb.getPendingEvents(this.canvasId);
    return pending.length + this._pendingUpdates.size;
  }

  updateVersion(version) {
    if (version > this.lastKnownVersion) {
      this.lastKnownVersion = version;
    }
  }

  // Get stored event types
  getStoredEventTypes() {
    return STORED_EVENT_TYPES;
  }
}

export default new SyncService();
