import { v4 as uuidv4 } from 'uuid';

export const SHAPE_TYPES = {
  RECTANGLE: 'rectangle',
  CIRCLE: 'circle',
  LINE: 'line',
  ARROW: 'arrow',
  TEXT: 'text'
};

export const TOOLS = {
  SELECT: 'select',
  RECTANGLE: 'rectangle',
  CIRCLE: 'circle',
  LINE: 'line',
  ARROW: 'arrow',
  TEXT: 'text',
  PAN: 'pan'
};

export const HANDLE_SIZE = 10;
export const ROTATION_HANDLE_OFFSET = 25;

// Create default shape properties
export function createShape(type, startX, startY, endX, endY, options = {}) {
  const id = uuidv4();
  const baseShape = {
    id,
    type,
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    rotation: 0,
    strokeColor: options.strokeColor || '#000000',
    strokeWidth: options.strokeWidth || 2,
    fillColor: options.fillColor || 'transparent',
    opacity: options.opacity || 1,
    zIndex: options.zIndex || 0
  };

  switch (type) {
    case SHAPE_TYPES.RECTANGLE:
      return {
        ...baseShape,
        width: Math.abs(endX - startX),
        height: Math.abs(endY - startY),
        cornerRadius: options.cornerRadius || 0
      };

    case SHAPE_TYPES.CIRCLE:
      const radius = Math.sqrt(
        Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2)
      ) / 2;
      return {
        ...baseShape,
        x: (startX + endX) / 2,
        y: (startY + endY) / 2,
        radius: radius
      };

    case SHAPE_TYPES.LINE:
      return {
        ...baseShape,
        x: startX,
        y: startY,
        endX: endX,
        endY: endY
      };

    case SHAPE_TYPES.ARROW:
      return {
        ...baseShape,
        x: startX,
        y: startY,
        endX: endX,
        endY: endY,
        arrowHeadSize: options.arrowHeadSize || 15
      };

    case SHAPE_TYPES.TEXT:
      return {
        ...baseShape,
        x: startX,
        y: startY,
        text: options.text || 'Text',
        fontSize: options.fontSize || 16,
        fontFamily: options.fontFamily || 'Arial',
        fontWeight: options.fontWeight || 'normal',
        fontStyle: options.fontStyle || 'normal',
        textAlign: options.textAlign || 'left',
        width: options.width || 100,
        height: options.height || 30
      };

    default:
      return baseShape;
  }
}

// Get bounding box of a shape
export function getBoundingBox(shape) {
  switch (shape.type) {
    case SHAPE_TYPES.RECTANGLE:
    case SHAPE_TYPES.TEXT:
      return {
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height
      };

    case SHAPE_TYPES.CIRCLE:
      return {
        x: shape.x - shape.radius,
        y: shape.y - shape.radius,
        width: shape.radius * 2,
        height: shape.radius * 2
      };

    case SHAPE_TYPES.LINE:
    case SHAPE_TYPES.ARROW:
      return {
        x: Math.min(shape.x, shape.endX),
        y: Math.min(shape.y, shape.endY),
        width: Math.abs(shape.endX - shape.x),
        height: Math.abs(shape.endY - shape.y)
      };

    default:
      return { x: shape.x, y: shape.y, width: 0, height: 0 };
  }
}

// Check if a point is inside a shape
export function isPointInShape(shape, px, py) {
  // Apply inverse rotation if shape is rotated
  const transformed = transformPointForRotation(shape, px, py);
  px = transformed.x;
  py = transformed.y;

  switch (shape.type) {
    case SHAPE_TYPES.RECTANGLE:
      return (
        px >= shape.x &&
        px <= shape.x + shape.width &&
        py >= shape.y &&
        py <= shape.y + shape.height
      );

    case SHAPE_TYPES.TEXT:
      // Use default width/height if not set
      const textWidth = shape.width || 100;
      const textHeight = shape.height || 30;
      return (
        px >= shape.x &&
        px <= shape.x + textWidth &&
        py >= shape.y &&
        py <= shape.y + textHeight
      );

    case SHAPE_TYPES.CIRCLE:
      const dx = px - shape.x;
      const dy = py - shape.y;
      return Math.sqrt(dx * dx + dy * dy) <= shape.radius;

    case SHAPE_TYPES.LINE:
    case SHAPE_TYPES.ARROW:
      return isPointNearLine(shape.x, shape.y, shape.endX, shape.endY, px, py, 10);

    default:
      return false;
  }
}

// Transform point to account for shape rotation
function transformPointForRotation(shape, px, py) {
  if (!shape.rotation) return { x: px, y: py };

  const box = getBoundingBox(shape);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  const radians = -shape.rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const dx = px - centerX;
  const dy = py - centerY;

  return {
    x: centerX + dx * cos - dy * sin,
    y: centerY + dx * sin + dy * cos
  };
}

// Check if point is near a line
function isPointNearLine(x1, y1, x2, y2, px, py, threshold) {
  const lineLength = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  if (lineLength === 0) return false;

  const distance = Math.abs(
    (y2 - y1) * px - (x2 - x1) * py + x2 * y1 - y2 * x1
  ) / lineLength;

  if (distance > threshold) return false;

  // Check if point is within line segment bounds
  const minX = Math.min(x1, x2) - threshold;
  const maxX = Math.max(x1, x2) + threshold;
  const minY = Math.min(y1, y2) - threshold;
  const maxY = Math.max(y1, y2) + threshold;

  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}

// Get resize handles for a shape
export function getResizeHandles(shape) {
  const box = getBoundingBox(shape);
  const halfHandle = HANDLE_SIZE / 2;

  return {
    nw: { x: box.x - halfHandle, y: box.y - halfHandle, cursor: 'nwse-resize' },
    n: { x: box.x + box.width / 2 - halfHandle, y: box.y - halfHandle, cursor: 'ns-resize' },
    ne: { x: box.x + box.width - halfHandle, y: box.y - halfHandle, cursor: 'nesw-resize' },
    e: { x: box.x + box.width - halfHandle, y: box.y + box.height / 2 - halfHandle, cursor: 'ew-resize' },
    se: { x: box.x + box.width - halfHandle, y: box.y + box.height - halfHandle, cursor: 'nwse-resize' },
    s: { x: box.x + box.width / 2 - halfHandle, y: box.y + box.height - halfHandle, cursor: 'ns-resize' },
    sw: { x: box.x - halfHandle, y: box.y + box.height - halfHandle, cursor: 'nesw-resize' },
    w: { x: box.x - halfHandle, y: box.y + box.height / 2 - halfHandle, cursor: 'ew-resize' }
  };
}

// Get rotation handle position
export function getRotationHandle(shape) {
  const box = getBoundingBox(shape);
  return {
    x: box.x + box.width / 2,
    y: box.y - ROTATION_HANDLE_OFFSET
  };
}

// Check which handle is at a point
export function getHandleAtPoint(shape, px, py) {
  const handles = getResizeHandles(shape);
  
  for (const [name, handle] of Object.entries(handles)) {
    if (
      px >= handle.x &&
      px <= handle.x + HANDLE_SIZE &&
      py >= handle.y &&
      py <= handle.y + HANDLE_SIZE
    ) {
      return { name, handle };
    }
  }

  // Check rotation handle
  const rotHandle = getRotationHandle(shape);
  const dist = Math.sqrt(
    Math.pow(px - rotHandle.x, 2) + Math.pow(py - rotHandle.y, 2)
  );
  if (dist <= HANDLE_SIZE) {
    return { name: 'rotate', handle: rotHandle };
  }

  return null;
}

// Calculate new dimensions after resize
export function resizeShape(shape, handleName, deltaX, deltaY, startBounds) {
  const newShape = { ...shape };
  
  switch (handleName) {
    case 'nw':
      newShape.x = startBounds.x + deltaX;
      newShape.y = startBounds.y + deltaY;
      newShape.width = startBounds.width - deltaX;
      newShape.height = startBounds.height - deltaY;
      break;
    case 'n':
      newShape.y = startBounds.y + deltaY;
      newShape.height = startBounds.height - deltaY;
      break;
    case 'ne':
      newShape.y = startBounds.y + deltaY;
      newShape.width = startBounds.width + deltaX;
      newShape.height = startBounds.height - deltaY;
      break;
    case 'e':
      newShape.width = startBounds.width + deltaX;
      break;
    case 'se':
      newShape.width = startBounds.width + deltaX;
      newShape.height = startBounds.height + deltaY;
      break;
    case 's':
      newShape.height = startBounds.height + deltaY;
      break;
    case 'sw':
      newShape.x = startBounds.x + deltaX;
      newShape.width = startBounds.width - deltaX;
      newShape.height = startBounds.height + deltaY;
      break;
    case 'w':
      newShape.x = startBounds.x + deltaX;
      newShape.width = startBounds.width - deltaX;
      break;
  }

  // Ensure minimum size
  if (newShape.width < 10) {
    newShape.width = 10;
  }
  if (newShape.height < 10) {
    newShape.height = 10;
  }

  // Special handling for circle
  if (shape.type === SHAPE_TYPES.CIRCLE) {
    newShape.radius = Math.max(newShape.width, newShape.height) / 2;
    newShape.x = startBounds.x + newShape.width / 2;
    newShape.y = startBounds.y + newShape.height / 2;
  }

  return newShape;
}

// Calculate rotation angle
export function calculateRotation(shape, mouseX, mouseY) {
  const box = getBoundingBox(shape);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  const angle = Math.atan2(mouseY - centerY, mouseX - centerX);
  const degrees = (angle * 180 / Math.PI) + 90;
  
  return degrees;
}

// Get shape properties extract for event
export function getShapeProperties(shape) {
  const { id, type, zIndex, ...properties } = shape;
  return properties;
}

// User color assignment
const userColors = [
  '#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#f39c12',
  '#1abc9c', '#e91e63', '#00bcd4', '#ff5722', '#607d8b'
];

export function getUserColor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return userColors[Math.abs(hash) % userColors.length];
}
