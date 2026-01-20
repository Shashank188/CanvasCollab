import pool from '../db/pool.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Event types that are stored in the database
 */
const STORED_EVENT_TYPES = [
  'USER_CONNECTED',
  'USER_DISCONNECTED',
  'POINTER_DOWN',
  'DRAG_START',
  'DRAG_END',
  'SHAPE_CREATED',
  'SHAPE_EDITED',
  'SHAPE_MOVED',
  'SHAPE_DELETED'
];

/**
 * Check if an event type should be stored
 */
function shouldStoreEvent(eventType) {
  return STORED_EVENT_TYPES.includes(eventType);
}

/**
 * Merge shape properties at property level using timestamps
 */
function mergeProperties(serverProps, clientProps, serverTimestamps = {}, clientTimestamps = {}) {
  const merged = { ...serverProps };
  
  for (const [key, value] of Object.entries(clientProps)) {
    const serverTime = serverTimestamps[key] || 0;
    const clientTime = clientTimestamps[key] || 0;
    
    // Client wins if its timestamp is newer
    if (clientTime > serverTime) {
      merged[key] = value;
    }
  }
  
  return merged;
}

class EventStore {
  /**
   * Get current version for a canvas
   */
  async getCurrentVersion(canvasId) {
    const result = await pool.query(
      `SELECT COALESCE(MAX(version), 0) as version FROM events WHERE canvas_id = $1`,
      [canvasId]
    );
    return result.rows[0].version;
  }

  /**
   * Store an event and apply it to the shapes table
   */
  async storeEvent(canvasId, userId, eventType, shapeId, payload) {
    // Only store specific event types
    if (!shouldStoreEvent(eventType)) {
      // Still get the current version for response
      const version = await this.getCurrentVersion(canvasId);
      console.log(`Event type ${eventType} is not stored, broadcasting only`);
      return { eventId: null, version, canvasId, userId, eventType, shapeId, payload, stored: false };
    }

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Check for conflicts before applying
      const conflict = await this.detectConflict(client, canvasId, shapeId, payload);
      let resolvedPayload = payload;
      
      if (conflict) {
        resolvedPayload = await this.resolveConflict(client, conflict, payload);
      }
      
      // Get next version number for this canvas
      const versionResult = await client.query(
        `SELECT COALESCE(MAX(version), 0) + 1 as next_version 
         FROM events WHERE canvas_id = $1`,
        [canvasId]
      );
      const version = versionResult.rows[0].next_version;
      
      // Store the event
      const eventId = uuidv4();
      await client.query(
        `INSERT INTO events (id, canvas_id, shape_id, user_id, event_type, payload, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [eventId, canvasId, shapeId, userId, eventType, JSON.stringify(resolvedPayload), version]
      );
      
      // Apply event to shapes table
      await this.applyEvent(client, canvasId, eventType, shapeId, resolvedPayload);
      
      // Update canvas timestamp
      await client.query(
        `UPDATE canvases SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [canvasId]
      );
      
      await client.query('COMMIT');
      
      return { 
        eventId, 
        version, 
        canvasId, 
        userId, 
        eventType, 
        shapeId, 
        payload: resolvedPayload,
        stored: true,
        hadConflict: !!conflict
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Detect if there's a conflict with the current shape state
   */
  async detectConflict(client, canvasId, shapeId, payload) {
    if (!shapeId) return null;
    
    // Get current shape state
    const result = await client.query(
      `SELECT properties, updated_at FROM shapes WHERE id = $1 AND canvas_id = $2`,
      [shapeId, canvasId]
    );
    
    if (result.rows.length === 0) return null;
    
    const serverShape = result.rows[0];
    const clientTimestamp = payload.timestamp || payload.propertyTimestamps?.timestamp || 0;
    const serverTimestamp = new Date(serverShape.updated_at).getTime();
    
    // Check if there's a potential conflict (server was updated after client's base)
    if (payload.vectorClock && serverTimestamp > clientTimestamp - 1000) {
      return {
        shapeId,
        serverProperties: serverShape.properties,
        serverTimestamp
      };
    }
    
    return null;
  }

  /**
   * Resolve a conflict between server and client state
   */
  async resolveConflict(client, conflict, clientPayload) {
    const { serverProperties } = conflict;
    const clientProperties = clientPayload.properties || clientPayload.position || clientPayload;
    
    // Use property-level merge with timestamps
    const serverTimestamps = {}; // Server doesn't track per-property timestamps yet
    const clientTimestamps = clientPayload.propertyTimestamps || {};
    
    const mergedProperties = mergeProperties(
      serverProperties,
      clientProperties,
      serverTimestamps,
      clientTimestamps
    );
    
    return {
      ...clientPayload,
      properties: mergedProperties,
      conflictResolved: true
    };
  }

  /**
   * Store multiple events in a batch (for offline sync)
   * Handles conflict resolution for concurrent edits
   */
  async storeBatchEvents(canvasId, events) {
    const client = await pool.connect();
    const storedEvents = [];
    const conflicts = [];
    
    try {
      await client.query('BEGIN');
      
      for (const event of events) {
        const { userId, eventType, shapeId, payload } = event;
        
        // Skip non-storable events
        if (!shouldStoreEvent(eventType)) {
          continue;
        }
        
        // Check for conflicts
        const conflict = await this.detectConflict(client, canvasId, shapeId, payload);
        let resolvedPayload = payload;
        
        if (conflict) {
          resolvedPayload = await this.resolveConflict(client, conflict, payload);
          conflicts.push({
            shapeId,
            localVersion: payload.properties || payload,
            serverVersion: conflict.serverProperties,
            serverTimestamps: {}
          });
        }
        
        // Get next version number
        const versionResult = await client.query(
          `SELECT COALESCE(MAX(version), 0) + 1 as next_version 
           FROM events WHERE canvas_id = $1`,
          [canvasId]
        );
        const version = versionResult.rows[0].next_version;
        
        // Store the event
        const eventId = uuidv4();
        await client.query(
          `INSERT INTO events (id, canvas_id, shape_id, user_id, event_type, payload, version)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [eventId, canvasId, shapeId, userId, eventType, JSON.stringify(resolvedPayload), version]
        );
        
        // Apply event to shapes table
        await this.applyEvent(client, canvasId, eventType, shapeId, resolvedPayload);
        
        storedEvents.push({ 
          eventId, 
          version, 
          canvasId, 
          userId, 
          eventType, 
          shapeId, 
          payload: resolvedPayload,
          hadConflict: !!conflict
        });
      }
      
      // Update canvas timestamp
      await client.query(
        `UPDATE canvases SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [canvasId]
      );
      
      await client.query('COMMIT');
      
      return { storedEvents, conflicts };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Apply an event to update the shapes table
   */
  async applyEvent(client, canvasId, eventType, shapeId, payload) {
    switch (eventType) {
      case 'SHAPE_CREATED':
        // Extract properties - handle both nested and flat structures
        const properties = payload.properties || payload;
        const shapeType = payload.type || properties.type;
        const zIndex = payload.zIndex || properties.zIndex || 0;
        
        await client.query(
          `INSERT INTO shapes (id, canvas_id, type, properties, z_index)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             properties = $4,
             z_index = $5,
             updated_at = CURRENT_TIMESTAMP,
             deleted_at = NULL`,
          [shapeId, canvasId, shapeType, JSON.stringify(properties), zIndex]
        );
        break;
      
      case 'SHAPE_EDITED':
        // Property-level update (merge with existing)
        const editProps = payload.properties || payload;
        await client.query(
          `UPDATE shapes SET 
             properties = properties || $1,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND canvas_id = $3`,
          [JSON.stringify(editProps), shapeId, canvasId]
        );
        break;
        
      case 'SHAPE_MOVED':
        // Update position from position object or direct x/y
        const position = payload.position || payload;
        await client.query(
          `UPDATE shapes SET 
             properties = jsonb_set(jsonb_set(properties, '{x}', $1::jsonb), '{y}', $2::jsonb),
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $3 AND canvas_id = $4`,
          [JSON.stringify(position.x), JSON.stringify(position.y), shapeId, canvasId]
        );
        break;

      case 'DRAG_END':
        // Update position from endPosition
        if (payload.endPosition) {
          await client.query(
            `UPDATE shapes SET 
               properties = jsonb_set(jsonb_set(properties, '{x}', $1::jsonb), '{y}', $2::jsonb),
               updated_at = CURRENT_TIMESTAMP
             WHERE id = $3 AND canvas_id = $4`,
            [JSON.stringify(payload.endPosition.x), JSON.stringify(payload.endPosition.y), shapeId, canvasId]
          );
        }
        break;
        
      case 'SHAPE_DELETED':
        await client.query(
          `UPDATE shapes SET 
             deleted_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND canvas_id = $2`,
          [shapeId, canvasId]
        );
        break;
      
      // Events that are stored but don't modify shapes
      case 'POINTER_DOWN':
      case 'DRAG_START':
      case 'USER_CONNECTED':
      case 'USER_DISCONNECTED':
        // These events are stored for audit/activity tracking but don't modify shapes
        break;
        
      // Legacy event types for backward compatibility
      case 'SHAPE_UPDATED':
        await client.query(
          `UPDATE shapes SET 
             properties = properties || $1,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND canvas_id = $3`,
          [JSON.stringify(payload.properties), shapeId, canvasId]
        );
        break;
        
      case 'SHAPE_RESIZED':
        await client.query(
          `UPDATE shapes SET 
             properties = properties || $1,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND canvas_id = $3`,
          [JSON.stringify(payload), shapeId, canvasId]
        );
        break;
        
      case 'SHAPE_ROTATED':
        await client.query(
          `UPDATE shapes SET 
             properties = jsonb_set(properties, '{rotation}', $1::jsonb),
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND canvas_id = $3`,
          [JSON.stringify(payload.rotation), shapeId, canvasId]
        );
        break;
        
      case 'SHAPE_RESTORED':
        await client.query(
          `UPDATE shapes SET 
             deleted_at = NULL,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND canvas_id = $2`,
          [shapeId, canvasId]
        );
        break;
        
      case 'Z_INDEX_CHANGED':
        await client.query(
          `UPDATE shapes SET 
             z_index = $1,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND canvas_id = $3`,
          [payload.zIndex, shapeId, canvasId]
        );
        break;
    }
  }

  /**
   * Get all events for a canvas since a specific version
   */
  async getEventsSinceVersion(canvasId, sinceVersion = 0) {
    const result = await pool.query(
      `SELECT id, canvas_id, shape_id, user_id, event_type, payload, version, created_at
       FROM events 
       WHERE canvas_id = $1 AND version > $2
       ORDER BY version ASC`,
      [canvasId, sinceVersion]
    );
    return result.rows;
  }

  /**
   * Get current state of all shapes on a canvas
   */
  async getCanvasState(canvasId) {
    const result = await pool.query(
      `SELECT id, type, properties, z_index, created_at, updated_at
       FROM shapes 
       WHERE canvas_id = $1 AND deleted_at IS NULL
       ORDER BY z_index ASC`,
      [canvasId]
    );
    
    // Get latest version
    const versionResult = await pool.query(
      `SELECT COALESCE(MAX(version), 0) as version FROM events WHERE canvas_id = $1`,
      [canvasId]
    );
    
    return {
      shapes: result.rows.map(row => ({
        id: row.id,
        type: row.type,
        ...row.properties,
        zIndex: row.z_index
      })),
      version: versionResult.rows[0].version
    };
  }

  /**
   * Get or create a canvas
   */
  async getOrCreateCanvas(canvasId, name = 'Untitled Canvas') {
    const result = await pool.query(
      `INSERT INTO canvases (id, name)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [canvasId, name]
    );
    return result.rows[0];
  }

  /**
   * Get canvas metadata
   */
  async getCanvas(canvasId) {
    const result = await pool.query(
      `SELECT * FROM canvases WHERE id = $1`,
      [canvasId]
    );
    return result.rows[0];
  }
}

export default new EventStore();
