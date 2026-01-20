/**
 * Conflict Resolution Strategy
 * 
 * Uses vector clocks for causality tracking and property-level merging
 * for concurrent edits to the same shape.
 */

/**
 * Vector Clock implementation for tracking causality
 */
export class VectorClock {
  constructor(clock = {}) {
    this.clock = { ...clock };
  }

  /**
   * Increment the clock for a given node/user
   */
  increment(nodeId) {
    this.clock[nodeId] = (this.clock[nodeId] || 0) + 1;
    return this;
  }

  /**
   * Get the current value for a node
   */
  get(nodeId) {
    return this.clock[nodeId] || 0;
  }

  /**
   * Merge with another vector clock (takes max of each)
   */
  merge(other) {
    const otherClock = other instanceof VectorClock ? other.clock : other;
    const allNodes = new Set([...Object.keys(this.clock), ...Object.keys(otherClock)]);
    
    for (const nodeId of allNodes) {
      this.clock[nodeId] = Math.max(this.clock[nodeId] || 0, otherClock[nodeId] || 0);
    }
    return this;
  }

  /**
   * Check if this clock happened before another
   */
  happenedBefore(other) {
    const otherClock = other instanceof VectorClock ? other.clock : other;
    let atLeastOneLess = false;
    
    const allNodes = new Set([...Object.keys(this.clock), ...Object.keys(otherClock)]);
    
    for (const nodeId of allNodes) {
      const thisVal = this.clock[nodeId] || 0;
      const otherVal = otherClock[nodeId] || 0;
      
      if (thisVal > otherVal) {
        return false; // This didn't happen before
      }
      if (thisVal < otherVal) {
        atLeastOneLess = true;
      }
    }
    
    return atLeastOneLess;
  }

  /**
   * Check if two clocks are concurrent (neither happened before the other)
   */
  isConcurrent(other) {
    return !this.happenedBefore(other) && !other.happenedBefore(this);
  }

  /**
   * Clone this vector clock
   */
  clone() {
    return new VectorClock({ ...this.clock });
  }

  /**
   * Serialize to JSON
   */
  toJSON() {
    return { ...this.clock };
  }
}

/**
 * Property-level merge for shape properties
 * Merges two versions of shape properties, preferring newer changes per-property
 */
export function mergeShapeProperties(baseProps, localProps, remoteProps, localTimestamps = {}, remoteTimestamps = {}) {
  const merged = { ...baseProps };
  const allKeys = new Set([
    ...Object.keys(localProps || {}),
    ...Object.keys(remoteProps || {})
  ]);

  for (const key of allKeys) {
    const localVal = localProps?.[key];
    const remoteVal = remoteProps?.[key];
    const localTime = localTimestamps[key] || 0;
    const remoteTime = remoteTimestamps[key] || 0;

    // If only one side changed, use that value
    if (localVal !== undefined && remoteVal === undefined) {
      merged[key] = localVal;
    } else if (remoteVal !== undefined && localVal === undefined) {
      merged[key] = remoteVal;
    } else if (localVal !== undefined && remoteVal !== undefined) {
      // Both sides changed - use timestamp to decide, prefer remote on tie (server authority)
      if (localTime > remoteTime) {
        merged[key] = localVal;
      } else {
        merged[key] = remoteVal;
      }
    }
  }

  return merged;
}

/**
 * Conflict Resolution for concurrent shape operations
 */
export class ConflictResolver {
  constructor(userId) {
    this.userId = userId;
    this.vectorClock = new VectorClock();
    this.propertyTimestamps = new Map(); // shapeId -> { property: timestamp }
  }

  /**
   * Record a local operation
   */
  recordLocalOperation(shapeId, properties) {
    this.vectorClock.increment(this.userId);
    
    if (!this.propertyTimestamps.has(shapeId)) {
      this.propertyTimestamps.set(shapeId, {});
    }
    
    const timestamps = this.propertyTimestamps.get(shapeId);
    const now = Date.now();
    
    for (const key of Object.keys(properties)) {
      timestamps[key] = now;
    }
    
    return {
      vectorClock: this.vectorClock.toJSON(),
      propertyTimestamps: { ...timestamps }
    };
  }

  /**
   * Resolve conflict between local and remote operations
   */
  resolveConflict(shapeId, localShape, remoteEvent) {
    const remoteClock = new VectorClock(remoteEvent.vectorClock || {});
    
    // Check causality
    if (remoteClock.happenedBefore(this.vectorClock)) {
      // Remote event is outdated, keep local
      return { action: 'KEEP_LOCAL', shape: localShape };
    }
    
    if (this.vectorClock.happenedBefore(remoteClock)) {
      // Local is outdated, apply remote
      return { action: 'APPLY_REMOTE', shape: remoteEvent.payload.properties };
    }
    
    // Concurrent edits - merge at property level
    const localTimestamps = this.propertyTimestamps.get(shapeId) || {};
    const remoteTimestamps = remoteEvent.propertyTimestamps || {};
    
    const merged = mergeShapeProperties(
      localShape,
      localShape,
      remoteEvent.payload.properties,
      localTimestamps,
      remoteTimestamps
    );
    
    // Merge vector clocks
    this.vectorClock.merge(remoteClock);
    
    return { action: 'MERGE', shape: merged };
  }

  /**
   * Get current vector clock state
   */
  getVectorClock() {
    return this.vectorClock.toJSON();
  }

  /**
   * Update vector clock from remote event
   */
  updateFromRemote(remoteClock) {
    this.vectorClock.merge(remoteClock);
  }
}

/**
 * Event Types that are stored
 */
export const STORED_EVENT_TYPES = {
  // User events
  USER_CONNECTED: 'USER_CONNECTED',
  USER_DISCONNECTED: 'USER_DISCONNECTED',
  
  // Pointer events
  POINTER_DOWN: 'POINTER_DOWN',
  
  // Drag events
  DRAG_START: 'DRAG_START',
  DRAG_END: 'DRAG_END',
  
  // Shape lifecycle events
  SHAPE_CREATED: 'SHAPE_CREATED',
  SHAPE_EDITED: 'SHAPE_EDITED',
  SHAPE_MOVED: 'SHAPE_MOVED',
  SHAPE_DELETED: 'SHAPE_DELETED'
};

/**
 * Check if an event type should be stored
 */
export function shouldStoreEvent(eventType) {
  return Object.values(STORED_EVENT_TYPES).includes(eventType);
}
