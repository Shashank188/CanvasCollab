import { openDB } from 'idb';

const DB_NAME = 'canvas-collab';
const DB_VERSION = 1;

class IndexedDbService {
  constructor() {
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Store for pending events (offline changes)
        if (!db.objectStoreNames.contains('pendingEvents')) {
          const pendingStore = db.createObjectStore('pendingEvents', {
            keyPath: 'localEventId'
          });
          pendingStore.createIndex('canvasId', 'canvasId');
          pendingStore.createIndex('timestamp', 'timestamp');
        }

        // Store for canvas state cache
        if (!db.objectStoreNames.contains('canvasCache')) {
          db.createObjectStore('canvasCache', { keyPath: 'canvasId' });
        }

        // Store for shapes cache per canvas
        if (!db.objectStoreNames.contains('shapesCache')) {
          const shapesStore = db.createObjectStore('shapesCache', {
            keyPath: ['canvasId', 'shapeId']
          });
          shapesStore.createIndex('canvasId', 'canvasId');
        }

        // Store for user preferences
        if (!db.objectStoreNames.contains('preferences')) {
          db.createObjectStore('preferences', { keyPath: 'key' });
        }
      }
    });

    return this.db;
  }

  // Pending Events Methods
  async addPendingEvent(event) {
    const db = await this.init();
    const eventWithTimestamp = {
      ...event,
      timestamp: Date.now()
    };
    await db.add('pendingEvents', eventWithTimestamp);
    return eventWithTimestamp;
  }

  async getPendingEvents(canvasId) {
    const db = await this.init();
    const events = await db.getAllFromIndex('pendingEvents', 'canvasId', canvasId);
    return events.sort((a, b) => a.timestamp - b.timestamp);
  }

  async getAllPendingEvents() {
    const db = await this.init();
    const events = await db.getAll('pendingEvents');
    return events.sort((a, b) => a.timestamp - b.timestamp);
  }

  async removePendingEvent(localEventId) {
    const db = await this.init();
    await db.delete('pendingEvents', localEventId);
  }

  async clearPendingEvents(canvasId) {
    const db = await this.init();
    const events = await this.getPendingEvents(canvasId);
    const tx = db.transaction('pendingEvents', 'readwrite');
    for (const event of events) {
      await tx.store.delete(event.localEventId);
    }
    await tx.done;
  }

  async hasPendingEvents(canvasId) {
    const db = await this.init();
    const count = await db.countFromIndex('pendingEvents', 'canvasId', canvasId);
    return count > 0;
  }

  // Canvas Cache Methods
  async cacheCanvasState(canvasId, state) {
    const db = await this.init();
    await db.put('canvasCache', {
      canvasId,
      ...state,
      cachedAt: Date.now()
    });
  }

  async getCachedCanvasState(canvasId) {
    const db = await this.init();
    return await db.get('canvasCache', canvasId);
  }

  async clearCanvasCache(canvasId) {
    const db = await this.init();
    await db.delete('canvasCache', canvasId);
    
    // Also clear shapes cache
    const shapes = await db.getAllFromIndex('shapesCache', 'canvasId', canvasId);
    const tx = db.transaction('shapesCache', 'readwrite');
    for (const shape of shapes) {
      await tx.store.delete([canvasId, shape.shapeId]);
    }
    await tx.done;
  }

  // Shapes Cache Methods
  async cacheShape(canvasId, shape) {
    const db = await this.init();
    await db.put('shapesCache', {
      canvasId,
      shapeId: shape.id,
      shape,
      cachedAt: Date.now()
    });
  }

  async getCachedShapes(canvasId) {
    const db = await this.init();
    const entries = await db.getAllFromIndex('shapesCache', 'canvasId', canvasId);
    return entries.map(e => e.shape);
  }

  async removeCachedShape(canvasId, shapeId) {
    const db = await this.init();
    await db.delete('shapesCache', [canvasId, shapeId]);
  }

  // Preferences Methods
  async setPreference(key, value) {
    const db = await this.init();
    await db.put('preferences', { key, value });
  }

  async getPreference(key, defaultValue = null) {
    const db = await this.init();
    const result = await db.get('preferences', key);
    return result ? result.value : defaultValue;
  }

  // Apply pending events to cached state
  applyPendingEventsToState(shapes, pendingEvents) {
    const shapesMap = new Map(shapes.map(s => [s.id, { ...s }]));

    for (const event of pendingEvents) {
      const { eventType, shapeId, payload } = event;

      switch (eventType) {
        case 'SHAPE_CREATED':
          // Handle both nested and flat property structures
          const properties = payload.properties || payload;
          shapesMap.set(shapeId, {
            id: shapeId,
            type: payload.type || properties.type,
            ...properties,
            zIndex: payload.zIndex || properties.zIndex || 0
          });
          break;

        case 'SHAPE_EDITED':
        case 'SHAPE_UPDATED':
          if (shapesMap.has(shapeId)) {
            const shape = shapesMap.get(shapeId);
            const props = payload.properties || payload;
            Object.assign(shape, props);
          }
          break;

        case 'SHAPE_MOVED':
          if (shapesMap.has(shapeId)) {
            const shape = shapesMap.get(shapeId);
            const position = payload.position || payload;
            shape.x = position.x;
            shape.y = position.y;
          }
          break;

        case 'DRAG_END':
          if (shapesMap.has(shapeId) && payload.endPosition) {
            const shape = shapesMap.get(shapeId);
            shape.x = payload.endPosition.x;
            shape.y = payload.endPosition.y;
          }
          break;

        case 'SHAPE_RESIZED':
          if (shapesMap.has(shapeId)) {
            const shape = shapesMap.get(shapeId);
            Object.assign(shape, payload);
          }
          break;

        case 'SHAPE_ROTATED':
          if (shapesMap.has(shapeId)) {
            const shape = shapesMap.get(shapeId);
            shape.rotation = payload.rotation;
          }
          break;

        case 'SHAPE_DELETED':
          shapesMap.delete(shapeId);
          break;

        case 'SHAPE_RESTORED':
          // Would need the full shape data to restore
          break;

        case 'Z_INDEX_CHANGED':
          if (shapesMap.has(shapeId)) {
            const shape = shapesMap.get(shapeId);
            shape.zIndex = payload.zIndex;
          }
          break;

        // Events that don't modify shapes directly
        case 'POINTER_DOWN':
        case 'DRAG_START':
        case 'USER_CONNECTED':
        case 'USER_DISCONNECTED':
          // No shape modifications needed
          break;
      }
    }

    return Array.from(shapesMap.values());
  }
}

export default new IndexedDbService();
