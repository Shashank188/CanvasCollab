import { v4 as uuidv4 } from 'uuid';

class WebSocketService {
  constructor() {
    this.ws = null;
    this.userId = this.getUserId();
    this.username = '';
    this.canvasId = null;
    this.isConnected = false;
    this.hasJoinedCanvas = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.messageHandlers = new Map();
    this.pendingAcks = new Map();
    this.eventQueue = [];
  }

  getUserId() {
    let userId = localStorage.getItem('canvas-collab-user-id');
    if (!userId) {
      userId = uuidv4();
      localStorage.setItem('canvas-collab-user-id', userId);
    }
    return userId;
  }

  connect(username = '') {
    this.username = username || `User-${this.userId.slice(0, 4)}`;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws?userId=${this.userId}`;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.processEventQueue();
          this.emit('connected');
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('Error parsing message:', error);
          }
        };

        this.ws.onclose = () => {
          console.log('WebSocket disconnected');
          this.isConnected = false;
          this.hasJoinedCanvas = false;
          this.emit('disconnected');
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.emit('error', error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnection attempts reached');
      this.emit('reconnect-failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`Attempting reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect(this.username).then(() => {
        // Rejoin canvas if we were in one
        if (this.canvasId) {
          this.joinCanvas(this.canvasId, this.username);
        }
      }).catch(() => {
        // Will trigger onclose and retry
      });
    }, delay);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  send(message) {
    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    } else {
      // Queue message for when we reconnect
      this.eventQueue.push(message);
      return false;
    }
  }

  processEventQueue() {
    while (this.eventQueue.length > 0) {
      const message = this.eventQueue.shift();
      this.send(message);
    }
  }

  handleMessage(message) {
    // Handle acknowledgments
    if (message.type === 'EVENT_ACK') {
      const resolver = this.pendingAcks.get(message.localEventId);
      if (resolver) {
        resolver(message);
        this.pendingAcks.delete(message.localEventId);
      }
    }

    // Emit to handlers
    this.emit(message.type, message);
  }

  on(eventType, handler) {
    if (!this.messageHandlers.has(eventType)) {
      this.messageHandlers.set(eventType, new Set());
    }
    this.messageHandlers.get(eventType).add(handler);

    // Return unsubscribe function
    return () => {
      this.messageHandlers.get(eventType)?.delete(handler);
    };
  }

  off(eventType, handler) {
    this.messageHandlers.get(eventType)?.delete(handler);
  }

  emit(eventType, data) {
    const handlers = this.messageHandlers.get(eventType);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  // Canvas operations
  joinCanvas(canvasId, username) {
    this.canvasId = canvasId;
    this.username = username || this.username;
    
    return new Promise((resolve, reject) => {
      // Set up handlers for join response
      const successHandler = (message) => {
        if (message.canvasId === canvasId) {
          this.off('JOIN_SUCCESS', successHandler);
          this.off('JOIN_ERROR', errorHandler);
          this.hasJoinedCanvas = true;
          resolve(message);
        }
      };
      
      const errorHandler = (message) => {
        if (message.canvasId === canvasId) {
          this.off('JOIN_SUCCESS', successHandler);
          this.off('JOIN_ERROR', errorHandler);
          this.hasJoinedCanvas = false;
          reject(new Error(message.error || 'Failed to join canvas'));
        }
      };
      
      this.on('JOIN_SUCCESS', successHandler);
      this.on('JOIN_ERROR', errorHandler);
      
      // Send join request
      this.send({
        type: 'JOIN_CANVAS',
        canvasId,
        username: this.username
      });
      
      // Timeout after 10 seconds
      setTimeout(() => {
        this.off('JOIN_SUCCESS', successHandler);
        this.off('JOIN_ERROR', errorHandler);
        // Don't reject - just resolve without confirmation (backward compatibility)
        this.hasJoinedCanvas = true;
        resolve({ canvasId, timeout: true });
      }, 10000);
    });
  }

  leaveCanvas() {
    if (this.canvasId) {
      this.send({
        type: 'LEAVE_CANVAS',
        canvasId: this.canvasId
      });
      this.canvasId = null;
      this.hasJoinedCanvas = false;
    }
  }

  // Check if WebSocket is truly ready to send
  isReady() {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  // Shape events
  sendShapeEvent(eventType, shapeId, payload) {
    const localEventId = uuidv4();
    
    // Check if we can actually send before trying
    if (!this.isReady()) {
      return Promise.reject(new Error('WebSocket not ready'));
    }
    
    const sent = this.send({
      type: 'SHAPE_EVENT',
      localEventId,
      eventType,
      shapeId,
      payload
    });

    // If send failed, reject immediately
    if (!sent) {
      return Promise.reject(new Error('Failed to send message'));
    }

    // Return a promise that resolves when we get acknowledgment
    return new Promise((resolve, reject) => {
      this.pendingAcks.set(localEventId, resolve);
      
      // Timeout after 5 seconds (reduced from 30 for faster offline detection)
      setTimeout(() => {
        if (this.pendingAcks.has(localEventId)) {
          this.pendingAcks.delete(localEventId);
          reject(new Error('Event acknowledgment timeout'));
        }
      }, 5000);
    });
  }

  // Batch sync for offline events
  batchSync(events, lastKnownVersion) {
    return new Promise((resolve, reject) => {
      const handler = (message) => {
        if (message.type === 'BATCH_SYNC_RESULT') {
          this.off('BATCH_SYNC_RESULT', handler);
          if (message.success) {
            resolve(message);
          } else {
            reject(new Error(message.error));
          }
        }
      };

      this.on('BATCH_SYNC_RESULT', handler);

      this.send({
        type: 'BATCH_SYNC',
        events,
        lastKnownVersion
      });

      // Timeout after 60 seconds
      setTimeout(() => {
        this.off('BATCH_SYNC_RESULT', handler);
        reject(new Error('Batch sync timeout'));
      }, 60000);
    });
  }

  // Request current state
  getState(sinceVersion) {
    this.send({
      type: 'GET_STATE',
      sinceVersion
    });
  }

  // Send cursor position
  sendCursorMove(x, y) {
    if (this.isConnected) {
      this.send({
        type: 'CURSOR_MOVE',
        x,
        y
      });
    }
  }
}

export default new WebSocketService();
