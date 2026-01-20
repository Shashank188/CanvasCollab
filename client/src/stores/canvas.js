import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { v4 as uuidv4 } from 'uuid';
import websocket from '@/services/websocket.js';
import syncService from '@/services/syncService.js';
import { TOOLS, createShape, getShapeProperties } from '@/utils/shapes.js';

export const useCanvasStore = defineStore('canvas', () => {
  // State
  const canvasId = ref(null);
  const shapes = ref([]);
  const selectedShapeIds = ref([]);
  const currentTool = ref(TOOLS.SELECT);
  const isConnected = ref(false);
  const isOnline = ref(navigator.onLine);
  const isSyncing = ref(false);
  const pendingChangesCount = ref(0);
  const version = ref(0);
  const users = ref([]);
  const remoteCursors = ref({});
  const clipboard = ref(null);
  
  // Drag tracking for start/end events
  const dragState = ref({
    isDragging: false,
    shapeId: null,
    startPosition: null
  });
  
  // Default style options
  const defaultStyles = ref({
    strokeColor: '#000000',
    strokeWidth: 2,
    fillColor: 'transparent',
    fontSize: 16,
    fontFamily: 'Arial'
  });

  // Computed
  const selectedShapes = computed(() => {
    return shapes.value.filter(s => selectedShapeIds.value.includes(s.id));
  });

  const sortedShapes = computed(() => {
    return [...shapes.value].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  });

  const hasSelection = computed(() => selectedShapeIds.value.length > 0);

  // Actions
  async function initCanvas(id) {
    canvasId.value = id;
    
    // Initialize sync service with user ID
    const userId = websocket.getUserId();
    await syncService.init(id, userId);
    
    // Set up sync service listeners
    syncService.on('online', () => {
      isOnline.value = true;
    });
    
    syncService.on('offline', () => {
      isOnline.value = false;
    });
    
    syncService.on('syncStart', () => {
      isSyncing.value = true;
    });
    
    syncService.on('syncComplete', async (result) => {
      isSyncing.value = false;
      pendingChangesCount.value = 0;
      if (result.currentState) {
        shapes.value = result.currentState.shapes;
        version.value = result.currentState.version;
      }
    });
    
    syncService.on('syncError', () => {
      isSyncing.value = false;
    });
    
    syncService.on('eventQueued', async () => {
      pendingChangesCount.value = await syncService.getPendingCount();
    });
    
    // Handle conflict resolutions
    syncService.on('conflictsResolved', (resolutions) => {
      for (const { shapeId, mergedProperties } of resolutions) {
        const shape = shapes.value.find(s => s.id === shapeId);
        if (shape) {
          Object.assign(shape, mergedProperties);
        }
      }
    });

    // Connect websocket
    try {
      await websocket.connect();
      setupWebSocketListeners();
      
      // Wait for join confirmation before allowing events
      await websocket.joinCanvas(id);
      isConnected.value = true;
      console.log('Successfully joined canvas:', id);
    } catch (error) {
      console.error('Failed to connect or join canvas:', error);
      // Load from cache if cannot connect
      const state = await syncService.getStateFromCache();
      shapes.value = state.shapes;
      version.value = state.version;
    }

    // Update pending count
    pendingChangesCount.value = await syncService.getPendingCount();
  }

  function setupWebSocketListeners() {
    websocket.on('connected', async () => {
      isConnected.value = true;
      // Rejoin canvas on reconnect
      if (canvasId.value) {
        try {
          await websocket.joinCanvas(canvasId.value);
          console.log('Rejoined canvas after reconnect:', canvasId.value);
        } catch (error) {
          console.error('Failed to rejoin canvas:', error);
        }
      }
    });

    websocket.on('disconnected', () => {
      isConnected.value = false;
    });

    websocket.on('ERROR', (message) => {
      console.error('Server error:', message.error);
    });

    websocket.on('CANVAS_STATE', async (message) => {
      console.log('Received canvas state:', message.shapes?.length, 'shapes');
      shapes.value = message.shapes || [];
      version.value = message.version;
      users.value = message.users || [];
      
      // Cache the state
      await syncService.cacheState({
        shapes: shapes.value,
        version: version.value
      });

      // Sync any pending events
      if (await syncService.hasPendingChanges()) {
        syncService.syncPendingEvents();
      }
    });

    websocket.on('SHAPE_EVENT', (message) => {
      console.log('Received shape event:', message.eventType, message.shapeId);
      applyRemoteEvent(message);
      if (message.version) {
        syncService.updateVersion(message.version);
      }
    });

    websocket.on('USER_JOINED', (message) => {
      if (!users.value.find(u => u.userId === message.userId)) {
        users.value.push({
          userId: message.userId,
          username: message.username
        });
      }
    });

    websocket.on('USER_LEFT', (message) => {
      users.value = users.value.filter(u => u.userId !== message.userId);
      delete remoteCursors.value[message.userId];
    });

    websocket.on('CURSOR_MOVE', (message) => {
      remoteCursors.value[message.userId] = {
        x: message.x,
        y: message.y,
        username: message.username
      };
    });
  }

  function applyRemoteEvent(event) {
    const { eventType, shapeId, payload } = event;
    const existingShape = shapes.value.find(s => s.id === shapeId);

    // Use conflict resolution for updates to existing shapes
    if (existingShape && (eventType === 'SHAPE_EDITED' || eventType === 'SHAPE_UPDATED')) {
      const resolution = syncService.handleRemoteEvent(event, existingShape);
      
      switch (resolution.action) {
        case 'KEEP_LOCAL':
          // Remote event is outdated, ignore
          console.log('Conflict resolved: keeping local version');
          break;
        case 'APPLY_REMOTE':
          // Apply remote changes
          Object.assign(existingShape, resolution.shape);
          break;
        case 'MERGE':
          // Apply merged changes
          Object.assign(existingShape, resolution.shape);
          console.log('Conflict resolved: merged changes');
          break;
      }
      version.value = event.version;
      return;
    }

    switch (eventType) {
      case 'SHAPE_CREATED':
        if (!existingShape) {
          shapes.value.push({
            id: shapeId,
            type: payload.type,
            ...payload.properties,
            zIndex: payload.zIndex || 0
          });
        }
        break;

      case 'SHAPE_EDITED':
      case 'SHAPE_UPDATED':
        if (existingShape) {
          Object.assign(existingShape, payload.properties);
        }
        break;

      case 'SHAPE_MOVED':
        if (existingShape) {
          if (payload.position) {
            existingShape.x = payload.position.x;
            existingShape.y = payload.position.y;
          } else {
            existingShape.x = payload.x;
            existingShape.y = payload.y;
          }
        }
        break;

      case 'DRAG_END':
        if (existingShape && payload.endPosition) {
          existingShape.x = payload.endPosition.x;
          existingShape.y = payload.endPosition.y;
        }
        break;

      case 'SHAPE_RESIZED':
        if (existingShape) {
          Object.assign(existingShape, payload);
        }
        break;

      case 'SHAPE_ROTATED':
        if (existingShape) {
          existingShape.rotation = payload.rotation;
        }
        break;

      case 'SHAPE_DELETED':
        shapes.value = shapes.value.filter(s => s.id !== shapeId);
        selectedShapeIds.value = selectedShapeIds.value.filter(id => id !== shapeId);
        break;

      case 'Z_INDEX_CHANGED':
        if (existingShape) {
          existingShape.zIndex = payload.zIndex;
        }
        break;
        
      // Pointer and drag events for activity tracking (no shape changes)
      case 'POINTER_DOWN':
      case 'DRAG_START':
        // These are informational events, no shape updates needed
        break;
    }

    version.value = event.version;
  }

  // Shape operations
  async function addShape(type, startX, startY, endX, endY, options = {}) {
    const shape = createShape(type, startX, startY, endX, endY, {
      ...defaultStyles.value,
      ...options,
      zIndex: shapes.value.length
    });

    shapes.value.push(shape);
    selectedShapeIds.value = [shape.id];

    // Send SHAPE_CREATED event (stored)
    await syncService.queueShapeCreated(shape.id, shape.type, {
      ...getShapeProperties(shape),
      zIndex: shape.zIndex
    });

    return shape;
  }

  async function updateShape(shapeId, properties) {
    const shape = shapes.value.find(s => s.id === shapeId);
    if (!shape) return;

    Object.assign(shape, properties);

    // Send SHAPE_EDITED event (debounced for rapid changes)
    await syncService.queueShapeEdited(shapeId, properties);
  }

  // Start dragging a shape
  function startDrag(shapeId) {
    const shape = shapes.value.find(s => s.id === shapeId);
    if (!shape) return;

    dragState.value = {
      isDragging: true,
      shapeId,
      startPosition: { x: shape.x, y: shape.y }
    };

    // Send DRAG_START event (stored)
    syncService.queueDragStart(shapeId, { x: shape.x, y: shape.y });
  }

  // Update shape position during drag (not stored, just local update)
  function updateDragPosition(shapeId, x, y) {
    const shape = shapes.value.find(s => s.id === shapeId);
    if (!shape) return;

    shape.x = x;
    shape.y = y;
    
    // Cursor position is throttled separately
  }

  // End dragging - stores the final position
  async function endDrag(shapeId) {
    const shape = shapes.value.find(s => s.id === shapeId);
    if (!shape || !dragState.value.isDragging) return;

    const endPosition = { x: shape.x, y: shape.y };

    // Send DRAG_END event (stored) with start and end positions
    await syncService.queueDragEnd(
      shapeId, 
      dragState.value.startPosition, 
      endPosition
    );

    // Also send SHAPE_MOVED for the final position
    await syncService.queueShapeMoved(shapeId, endPosition);

    // Reset drag state
    dragState.value = {
      isDragging: false,
      shapeId: null,
      startPosition: null
    };
  }

  async function moveShape(shapeId, x, y) {
    const shape = shapes.value.find(s => s.id === shapeId);
    if (!shape) return;

    shape.x = x;
    shape.y = y;

    // Send SHAPE_MOVED event (stored)
    await syncService.queueShapeMoved(shapeId, { x, y });
  }

  async function resizeShape(shapeId, dimensions) {
    const shape = shapes.value.find(s => s.id === shapeId);
    if (!shape) return;

    Object.assign(shape, dimensions);

    // Send as SHAPE_EDITED (stored, debounced)
    await syncService.queueShapeEdited(shapeId, dimensions);
  }

  async function rotateShape(shapeId, rotation) {
    const shape = shapes.value.find(s => s.id === shapeId);
    if (!shape) return;

    shape.rotation = rotation;

    // Send as SHAPE_EDITED (stored, debounced)
    await syncService.queueShapeEdited(shapeId, { rotation });
  }

  async function deleteShape(shapeId) {
    shapes.value = shapes.value.filter(s => s.id !== shapeId);
    selectedShapeIds.value = selectedShapeIds.value.filter(id => id !== shapeId);

    // Send SHAPE_DELETED event (stored)
    await syncService.queueShapeDeleted(shapeId);
  }

  async function deleteSelectedShapes() {
    for (const shapeId of selectedShapeIds.value) {
      await deleteShape(shapeId);
    }
  }

  async function bringToFront(shapeId) {
    const maxZ = Math.max(...shapes.value.map(s => s.zIndex || 0));
    const shape = shapes.value.find(s => s.id === shapeId);
    if (shape) {
      shape.zIndex = maxZ + 1;
      await syncService.queueShapeEdited(shapeId, { zIndex: shape.zIndex });
    }
  }

  async function sendToBack(shapeId) {
    const minZ = Math.min(...shapes.value.map(s => s.zIndex || 0));
    const shape = shapes.value.find(s => s.id === shapeId);
    if (shape) {
      shape.zIndex = minZ - 1;
      await syncService.queueShapeEdited(shapeId, { zIndex: shape.zIndex });
    }
  }
  
  // Record pointer down event
  async function recordPointerDown(x, y, shapeId = null) {
    await syncService.queuePointerDown(x, y, shapeId);
  }

  // Selection operations
  function selectShape(shapeId, addToSelection = false) {
    if (addToSelection) {
      if (!selectedShapeIds.value.includes(shapeId)) {
        selectedShapeIds.value.push(shapeId);
      }
    } else {
      selectedShapeIds.value = [shapeId];
    }
  }

  function selectAll() {
    selectedShapeIds.value = shapes.value.map(s => s.id);
  }

  function clearSelection() {
    selectedShapeIds.value = [];
  }

  function setTool(tool) {
    currentTool.value = tool;
    if (tool !== TOOLS.SELECT) {
      clearSelection();
    }
  }

  // Clipboard operations
  function copySelected() {
    if (selectedShapes.value.length === 0) return;
    clipboard.value = JSON.parse(JSON.stringify(selectedShapes.value));
  }

  async function paste() {
    if (!clipboard.value) return;

    const newShapeIds = [];
    for (const shape of clipboard.value) {
      const newShape = {
        ...shape,
        id: uuidv4(),
        x: shape.x + 20,
        y: shape.y + 20,
        zIndex: shapes.value.length
      };
      shapes.value.push(newShape);
      newShapeIds.push(newShape.id);

      await syncService.queueShapeCreated(newShape.id, newShape.type, {
        ...getShapeProperties(newShape),
        zIndex: newShape.zIndex
      });
    }

    selectedShapeIds.value = newShapeIds;
  }

  async function duplicate() {
    copySelected();
    await paste();
  }

  // Cursor broadcasting (throttled via syncService)
  function sendCursorPosition(x, y) {
    if (isConnected.value) {
      syncService.sendCursorMove(x, y);
    }
  }

  // Cleanup
  function cleanup() {
    websocket.leaveCanvas();
    websocket.disconnect();
    shapes.value = [];
    selectedShapeIds.value = [];
    users.value = [];
    remoteCursors.value = {};
  }

  return {
    // State
    canvasId,
    shapes,
    selectedShapeIds,
    currentTool,
    isConnected,
    isOnline,
    isSyncing,
    pendingChangesCount,
    version,
    users,
    remoteCursors,
    defaultStyles,
    dragState,
    
    // Computed
    selectedShapes,
    sortedShapes,
    hasSelection,
    
    // Actions
    initCanvas,
    addShape,
    updateShape,
    moveShape,
    resizeShape,
    rotateShape,
    deleteShape,
    deleteSelectedShapes,
    bringToFront,
    sendToBack,
    selectShape,
    selectAll,
    clearSelection,
    setTool,
    copySelected,
    paste,
    duplicate,
    sendCursorPosition,
    cleanup,
    // Drag operations
    startDrag,
    updateDragPosition,
    endDrag,
    recordPointerDown
  };
});
