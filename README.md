# Canvas Collab

A real-time collaborative canvas application with offline-first architecture. Multiple users can create, edit, and manipulate shapes together in real-time.

## Features

### Shape Types
- **Rectangle** - With customizable corner radius
- **Circle** - Adjustable radius
- **Line** - Straight lines
- **Arrow** - Lines with arrow heads
- **Text** - Editable text nodes

### Shape Operations
- **Create** - Draw shapes by clicking and dragging
- **Select** - Click to select, Shift+click for multi-select
- **Drag** - Move shapes by dragging
- **Resize** - Use corner and edge handles to resize
- **Rotate** - Use the rotation handle above the shape
- **Edit** - Double-click text to edit, use properties panel for other attributes
- **Delete** - Press Delete/Backspace or use context menu

### Real-time Collaboration
- WebSocket-based real-time sync
- See other users' cursors in real-time
- All changes broadcast instantly to connected users
- User presence indicator in toolbar

### Offline-First Architecture
- Changes saved to IndexedDB when offline
- Automatic sync when connection is restored
- Batch event processing for efficient sync
- Visual indicator for pending changes

## Project Structure

```
canvas-collab/
├── client/                 # Vue 3 SPA
│   ├── src/
│   │   ├── components/     # Vue components
│   │   │   ├── CanvasArea.vue
│   │   │   ├── Toolbar.vue
│   │   │   ├── PropertiesPanel.vue
│   │   │   ├── RemoteCursors.vue
│   │   │   ├── ContextMenu.vue
│   │   │   └── ToastContainer.vue
│   │   ├── views/          # Page views
│   │   │   ├── Home.vue
│   │   │   └── CanvasEditor.vue
│   │   ├── stores/         # Pinia stores
│   │   │   ├── canvas.js
│   │   │   └── toast.js
│   │   ├── services/       # Service modules
│   │   │   ├── websocket.js
│   │   │   ├── syncService.js
│   │   │   └── indexedDb.js
│   │   ├── utils/          # Utility functions
│   │   │   └── shapes.js
│   │   ├── styles/
│   │   │   └── main.css
│   │   ├── router/
│   │   │   └── index.js
│   │   ├── App.vue
│   │   └── main.js
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
├── server/                 # Node.js Backend
│   ├── src/
│   │   ├── db/
│   │   │   ├── init.js     # Database schema initialization
│   │   │   └── pool.js     # PostgreSQL connection pool
│   │   ├── services/
│   │   │   ├── eventStore.js       # Event sourcing service
│   │   │   └── websocketManager.js # WebSocket management
│   │   └── index.js        # Express server entry
│   ├── .env.example
│   └── package.json
│
└── README.md
```

## Prerequisites

- Node.js >= 18
- PostgreSQL >= 14

## Setup & Installation

### 1. Database Setup

Create a PostgreSQL database:

```bash
createdb canvas_collab
```

Or using psql:

```sql
CREATE DATABASE canvas_collab;
```

### 2. Server Setup

```bash
cd server

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database credentials

# Initialize database tables
npm run db:init

# Start the server
npm start
# Or for development with auto-reload:
npm run dev
```

The server will start on `http://localhost:3001`

### 3. Client Setup

```bash
cd client

# Install dependencies
npm install

# Start the development server
npm run dev
```

The client will start on `http://localhost:5173`

## Usage

1. Open `http://localhost:5173` in your browser
2. Click "Create Canvas" to start a new canvas, or enter an existing canvas ID to join
3. Use the toolbar to select tools:
   - **V** - Select tool (click and drag to move shapes)
   - **R** - Rectangle tool
   - **C** - Circle tool
   - **L** - Line tool
   - **A** - Arrow tool
   - **T** - Text tool

4. Draw shapes by clicking and dragging on the canvas
5. Select shapes to see and edit their properties in the right panel
6. Right-click on shapes for context menu options

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| V | Select tool |
| R | Rectangle tool |
| C | Circle tool |
| L | Line tool |
| A | Arrow tool |
| T | Text tool |
| Ctrl/Cmd + A | Select all |
| Ctrl/Cmd + C | Copy |
| Ctrl/Cmd + V | Paste |
| Ctrl/Cmd + D | Duplicate |
| Delete/Backspace | Delete selected |
| Escape | Clear selection / Cancel |

## API Endpoints

### REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/canvas/:id` | Get canvas info |
| GET | `/api/canvas/:id/state` | Get current canvas state |
| GET | `/api/canvas/:id/events?since=N` | Get events since version N |
| POST | `/api/canvas` | Create new canvas |
| POST | `/api/canvas/:id/sync` | Batch sync offline events |

### WebSocket Messages

#### Client → Server

```javascript
// Join a canvas
{ type: 'JOIN_CANVAS', canvasId: 'uuid', username: 'User' }

// Shape event
{ type: 'SHAPE_EVENT', localEventId: 'uuid', eventType: 'SHAPE_CREATED', shapeId: 'uuid', payload: {...} }

// Batch sync offline events
{ type: 'BATCH_SYNC', events: [...], lastKnownVersion: 123 }

// Cursor position
{ type: 'CURSOR_MOVE', x: 100, y: 200 }
```

#### Server → Client

```javascript
// Canvas state
{ type: 'CANVAS_STATE', canvasId: 'uuid', shapes: [...], version: 123, users: [...] }

// Shape event from another user
{ type: 'SHAPE_EVENT', eventId: 'uuid', eventType: 'SHAPE_UPDATED', shapeId: 'uuid', payload: {...}, userId: 'uuid', version: 124 }

// Event acknowledgment
{ type: 'EVENT_ACK', localEventId: 'uuid', eventId: 'uuid', version: 124 }

// User joined/left
{ type: 'USER_JOINED', userId: 'uuid', username: 'User' }
{ type: 'USER_LEFT', userId: 'uuid' }

// Remote cursor
{ type: 'CURSOR_MOVE', userId: 'uuid', username: 'User', x: 100, y: 200 }
```

## Event Types

| Event Type | Description |
|------------|-------------|
| SHAPE_CREATED | New shape added to canvas |
| SHAPE_UPDATED | Shape properties modified |
| SHAPE_MOVED | Shape position changed |
| SHAPE_RESIZED | Shape dimensions changed |
| SHAPE_ROTATED | Shape rotation changed |
| SHAPE_DELETED | Shape removed from canvas |
| Z_INDEX_CHANGED | Shape layer order changed |

## Database Schema

### Canvases Table
Stores canvas metadata.

### Shapes Table
Stores current state of all shapes (computed from events).

### Events Table
Stores all user events for event sourcing and sync.