<template>
  <div 
    class="canvas-container" 
    ref="containerRef"
    @contextmenu.prevent="handleContextMenu"
  >
    <canvas 
      ref="canvasRef" 
      class="drawing-canvas"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @mouseleave="handleMouseLeave"
      @dblclick="handleDoubleClick"
    ></canvas>
    
    <!-- Text Editor Overlay -->
    <div 
      v-if="textEditor.visible"
      class="text-editor-overlay"
      :style="{ 
        left: textEditor.x + 'px', 
        top: textEditor.y + 'px' 
      }"
    >
      <textarea
        ref="textInputRef"
        v-model="textEditor.text"
        class="text-editor-input"
        :style="{ 
          fontSize: textEditor.fontSize + 'px',
          fontFamily: textEditor.fontFamily,
          width: textEditor.width + 'px',
          minHeight: textEditor.height + 'px'
        }"
        @blur="finishTextEditing"
        @keydown.escape="cancelTextEditing"
        @keydown.enter.ctrl="finishTextEditing"
      ></textarea>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick, inject } from 'vue';
import { useCanvasStore } from '@/stores/canvas.js';
import { 
  TOOLS, 
  SHAPE_TYPES,
  getBoundingBox, 
  isPointInShape, 
  getResizeHandles,
  getRotationHandle,
  getHandleAtPoint,
  resizeShape as resizeShapeUtil,
  calculateRotation,
  HANDLE_SIZE
} from '@/utils/shapes.js';

const canvasStore = useCanvasStore();
const contextMenu = inject('contextMenu');

const containerRef = ref(null);
const canvasRef = ref(null);
const textInputRef = ref(null);
let ctx = null;

// Drawing state
const isDrawing = ref(false);
const isDragging = ref(false);
const isResizing = ref(false);
const isRotating = ref(false);
const startX = ref(0);
const startY = ref(0);
const currentX = ref(0);
const currentY = ref(0);
const dragOffset = ref({ x: 0, y: 0 });
const resizeHandle = ref(null);
const startBounds = ref(null);
const previewShape = ref(null);

// Text editor state
const textEditor = ref({
  visible: false,
  x: 0,
  y: 0,
  text: '',
  fontSize: 16,
  fontFamily: 'Arial',
  width: 200,
  height: 30,
  shapeId: null,
  isNew: false
});

// Animation frame for rendering
let animationFrameId = null;

// Resize observer
let resizeObserver = null;

onMounted(() => {
  const canvas = canvasRef.value;
  const container = containerRef.value;
  
  ctx = canvas.getContext('2d');
  
  // Set initial canvas size
  resizeCanvas();
  
  // Set up resize observer
  resizeObserver = new ResizeObserver(() => {
    resizeCanvas();
    render();
  });
  resizeObserver.observe(container);
  
  // Start render loop
  startRenderLoop();
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
});

function resizeCanvas() {
  const canvas = canvasRef.value;
  const container = containerRef.value;
  
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
}

function startRenderLoop() {
  const renderLoop = () => {
    render();
    animationFrameId = requestAnimationFrame(renderLoop);
  };
  renderLoop();
}

function render() {
  if (!ctx) return;
  
  const canvas = canvasRef.value;
  
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw all shapes
  for (const shape of canvasStore.sortedShapes) {
    drawShape(shape);
  }
  
  // Draw preview shape (while creating)
  if (previewShape.value) {
    drawShape(previewShape.value, true);
  }
  
  // Draw selection handles
  for (const shape of canvasStore.selectedShapes) {
    drawSelectionHandles(shape);
  }
}

function drawShape(shape, isPreview = false) {
  ctx.save();
  
  // Apply rotation
  if (shape.rotation) {
    const box = getBoundingBox(shape);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    ctx.translate(centerX, centerY);
    ctx.rotate(shape.rotation * Math.PI / 180);
    ctx.translate(-centerX, -centerY);
  }
  
  // Set styles
  ctx.strokeStyle = shape.strokeColor || '#000000';
  ctx.lineWidth = shape.strokeWidth || 2;
  ctx.fillStyle = shape.fillColor || 'transparent';
  ctx.globalAlpha = isPreview ? 0.6 : (shape.opacity || 1);
  
  switch (shape.type) {
    case SHAPE_TYPES.RECTANGLE:
      drawRectangle(shape);
      break;
    case SHAPE_TYPES.CIRCLE:
      drawCircle(shape);
      break;
    case SHAPE_TYPES.LINE:
      drawLine(shape);
      break;
    case SHAPE_TYPES.ARROW:
      drawArrow(shape);
      break;
    case SHAPE_TYPES.TEXT:
      drawText(shape);
      break;
  }
  
  ctx.restore();
}

function drawRectangle(shape) {
  const { x, y, width, height, cornerRadius = 0 } = shape;
  
  ctx.beginPath();
  if (cornerRadius > 0) {
    ctx.roundRect(x, y, width, height, cornerRadius);
  } else {
    ctx.rect(x, y, width, height);
  }
  
  if (shape.fillColor && shape.fillColor !== 'transparent') {
    ctx.fill();
  }
  ctx.stroke();
}

function drawCircle(shape) {
  const { x, y, radius } = shape;
  
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  
  if (shape.fillColor && shape.fillColor !== 'transparent') {
    ctx.fill();
  }
  ctx.stroke();
}

function drawLine(shape) {
  const { x, y, endX, endY } = shape;
  
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(endX, endY);
  ctx.stroke();
}

function drawArrow(shape) {
  const { x, y, endX, endY, arrowHeadSize = 15 } = shape;
  
  // Draw line
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  
  // Draw arrow head
  const angle = Math.atan2(endY - y, endX - x);
  
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(
    endX - arrowHeadSize * Math.cos(angle - Math.PI / 6),
    endY - arrowHeadSize * Math.sin(angle - Math.PI / 6)
  );
  ctx.moveTo(endX, endY);
  ctx.lineTo(
    endX - arrowHeadSize * Math.cos(angle + Math.PI / 6),
    endY - arrowHeadSize * Math.sin(angle + Math.PI / 6)
  );
  ctx.stroke();
}

function drawText(shape) {
  const { x, y, text, fontSize = 16, fontFamily = 'Arial', fontWeight = 'normal', fontStyle = 'normal' } = shape;
  
  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = shape.strokeColor || '#000000';
  ctx.textBaseline = 'top';
  
  // Word wrap
  const lines = text.split('\n');
  let lineY = y;
  for (const line of lines) {
    ctx.fillText(line, x, lineY);
    lineY += fontSize * 1.2;
  }
}

function drawSelectionHandles(shape) {
  const box = getBoundingBox(shape);
  
  ctx.save();
  
  // Apply rotation
  if (shape.rotation) {
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    ctx.translate(centerX, centerY);
    ctx.rotate(shape.rotation * Math.PI / 180);
    ctx.translate(-centerX, -centerY);
  }
  
  // Draw selection rectangle
  ctx.strokeStyle = '#4a90d9';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  ctx.setLineDash([]);
  
  // Draw resize handles
  const handles = getResizeHandles(shape);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#4a90d9';
  ctx.lineWidth = 2;
  
  for (const handle of Object.values(handles)) {
    ctx.fillRect(handle.x, handle.y, HANDLE_SIZE, HANDLE_SIZE);
    ctx.strokeRect(handle.x, handle.y, HANDLE_SIZE, HANDLE_SIZE);
  }
  
  // Draw rotation handle
  const rotHandle = getRotationHandle(shape);
  
  // Line from shape to rotation handle
  ctx.beginPath();
  ctx.strokeStyle = '#4a90d9';
  ctx.lineWidth = 1;
  ctx.moveTo(box.x + box.width / 2, box.y);
  ctx.lineTo(rotHandle.x, rotHandle.y);
  ctx.stroke();
  
  // Rotation handle circle
  ctx.beginPath();
  ctx.arc(rotHandle.x, rotHandle.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#4a90d9';
  ctx.fill();
  
  ctx.restore();
}

// Mouse event handlers
function handleMouseDown(e) {
  const rect = canvasRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  startX.value = x;
  startY.value = y;
  currentX.value = x;
  currentY.value = y;
  
  const tool = canvasStore.currentTool;
  
  if (tool === TOOLS.SELECT) {
    handleSelectionMouseDown(x, y, e);
  } else if (tool === TOOLS.TEXT) {
    handleTextToolClick(x, y);
  } else {
    // Start drawing a shape
    isDrawing.value = true;
    previewShape.value = null;
  }
}

function handleSelectionMouseDown(x, y, e) {
  // Record pointer down event
  canvasStore.recordPointerDown(x, y);
  
  // Check if clicking on resize/rotation handle of selected shape
  for (const shape of canvasStore.selectedShapes) {
    const handleInfo = getHandleAtPoint(shape, x, y);
    if (handleInfo) {
      if (handleInfo.name === 'rotate') {
        isRotating.value = true;
      } else {
        isResizing.value = true;
        resizeHandle.value = handleInfo.name;
        startBounds.value = { ...getBoundingBox(shape), shapeId: shape.id };
      }
      return;
    }
  }
  
  // Check if clicking on a shape
  const clickedShapes = canvasStore.sortedShapes.filter(s => isPointInShape(s, x, y));
  
  if (clickedShapes.length > 0) {
    const topShape = clickedShapes[clickedShapes.length - 1];
    
    if (e.shiftKey) {
      canvasStore.selectShape(topShape.id, true);
    } else if (!canvasStore.selectedShapeIds.includes(topShape.id)) {
      canvasStore.selectShape(topShape.id);
    }
    
    // Start dragging - use the new startDrag method
    isDragging.value = true;
    dragOffset.value = {
      x: x - topShape.x,
      y: y - topShape.y
    };
    
    // Record drag start for the first selected shape
    canvasStore.startDrag(topShape.id);
  } else {
    canvasStore.clearSelection();
  }
}

function handleTextToolClick(x, y) {
  // Check if clicking on existing text
  const clickedShapes = canvasStore.sortedShapes.filter(
    s => s.type === SHAPE_TYPES.TEXT && isPointInShape(s, x, y)
  );
  
  if (clickedShapes.length > 0) {
    const textShape = clickedShapes[clickedShapes.length - 1];
    startEditingText(textShape);
  } else {
    // Create new text
    startNewText(x, y);
  }
}

function startNewText(x, y) {
  textEditor.value = {
    visible: true,
    x,
    y,
    text: '',
    fontSize: canvasStore.defaultStyles.fontSize,
    fontFamily: canvasStore.defaultStyles.fontFamily,
    width: 200,
    height: 30,
    shapeId: null,
    isNew: true
  };
  
  nextTick(() => {
    textInputRef.value?.focus();
  });
}

function startEditingText(shape) {
  canvasStore.selectShape(shape.id);
  
  textEditor.value = {
    visible: true,
    x: shape.x,
    y: shape.y,
    text: shape.text,
    fontSize: shape.fontSize,
    fontFamily: shape.fontFamily,
    width: shape.width || 200,
    height: shape.height || 30,
    shapeId: shape.id,
    isNew: false
  };
  
  nextTick(() => {
    textInputRef.value?.focus();
    textInputRef.value?.select();
  });
}

async function finishTextEditing() {
  if (!textEditor.value.visible) return;
  
  const text = textEditor.value.text.trim();
  
  if (text) {
    if (textEditor.value.isNew) {
      // Calculate text dimensions based on content
      const ctx = canvasRef.value.getContext('2d');
      ctx.font = `${textEditor.value.fontSize}px ${textEditor.value.fontFamily}`;
      const lines = text.split('\n');
      const maxWidth = Math.max(...lines.map(line => ctx.measureText(line).width), 50);
      const textHeight = lines.length * textEditor.value.fontSize * 1.2;
      
      await canvasStore.addShape(
        SHAPE_TYPES.TEXT,
        textEditor.value.x,
        textEditor.value.y,
        textEditor.value.x + maxWidth + 20, // Add padding
        textEditor.value.y + textHeight + 10,
        {
          text,
          fontSize: textEditor.value.fontSize,
          fontFamily: textEditor.value.fontFamily,
          width: maxWidth + 20,
          height: Math.max(textHeight + 10, 30)
        }
      );
    } else if (textEditor.value.shapeId) {
      // Update text and recalculate dimensions
      const ctx = canvasRef.value.getContext('2d');
      const shape = canvasStore.shapes.find(s => s.id === textEditor.value.shapeId);
      if (shape) {
        ctx.font = `${shape.fontSize || 16}px ${shape.fontFamily || 'Arial'}`;
        const lines = text.split('\n');
        const maxWidth = Math.max(...lines.map(line => ctx.measureText(line).width), 50);
        const textHeight = lines.length * (shape.fontSize || 16) * 1.2;
        
        await canvasStore.updateShape(textEditor.value.shapeId, { 
          text,
          width: maxWidth + 20,
          height: Math.max(textHeight + 10, 30)
        });
      }
    }
  }
  
  textEditor.value.visible = false;
  canvasStore.setTool(TOOLS.SELECT);
}

function cancelTextEditing() {
  textEditor.value.visible = false;
}

function handleMouseMove(e) {
  const rect = canvasRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  currentX.value = x;
  currentY.value = y;
  
  // Send cursor position to other users
  canvasStore.sendCursorPosition(x, y);
  
  // Update cursor style
  updateCursor(x, y);
  
  if (isDrawing.value) {
    // Update preview shape
    const tool = canvasStore.currentTool;
    previewShape.value = createPreviewShape(tool, startX.value, startY.value, x, y);
  } else if (isDragging.value) {
    // Move selected shapes
    handleDrag(x, y);
  } else if (isResizing.value) {
    // Resize selected shape
    handleResize(x, y);
  } else if (isRotating.value) {
    // Rotate selected shape
    handleRotate(x, y);
  }
}

function updateCursor(x, y) {
  const canvas = canvasRef.value;
  
  if (canvasStore.currentTool !== TOOLS.SELECT) {
    canvas.style.cursor = 'crosshair';
    return;
  }
  
  // Check if over a handle
  for (const shape of canvasStore.selectedShapes) {
    const handleInfo = getHandleAtPoint(shape, x, y);
    if (handleInfo) {
      if (handleInfo.name === 'rotate') {
        canvas.style.cursor = 'grab';
      } else {
        canvas.style.cursor = handleInfo.handle.cursor;
      }
      return;
    }
  }
  
  // Check if over a shape
  const hoverShape = canvasStore.sortedShapes.find(s => isPointInShape(s, x, y));
  if (hoverShape) {
    canvas.style.cursor = 'move';
  } else {
    canvas.style.cursor = 'default';
  }
}

function createPreviewShape(tool, x1, y1, x2, y2) {
  const type = tool === TOOLS.RECTANGLE ? SHAPE_TYPES.RECTANGLE :
               tool === TOOLS.CIRCLE ? SHAPE_TYPES.CIRCLE :
               tool === TOOLS.LINE ? SHAPE_TYPES.LINE :
               tool === TOOLS.ARROW ? SHAPE_TYPES.ARROW : null;
  
  if (!type) return null;
  
  const baseShape = {
    id: 'preview',
    type,
    x: type === SHAPE_TYPES.LINE || type === SHAPE_TYPES.ARROW ? x1 : Math.min(x1, x2),
    y: type === SHAPE_TYPES.LINE || type === SHAPE_TYPES.ARROW ? y1 : Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
    radius: type === SHAPE_TYPES.CIRCLE ? 
      Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)) / 2 : undefined,
    endX: x2,
    endY: y2,
    strokeColor: canvasStore.defaultStyles.strokeColor,
    strokeWidth: canvasStore.defaultStyles.strokeWidth,
    fillColor: canvasStore.defaultStyles.fillColor
  };
  
  // Adjust circle center
  if (type === SHAPE_TYPES.CIRCLE) {
    return {
      ...baseShape,
      x: (x1 + x2) / 2,
      y: (y1 + y2) / 2
    };
  }
  
  return baseShape;
}

function handleDrag(x, y) {
  const deltaX = x - startX.value;
  const deltaY = y - startY.value;
  
  for (const shape of canvasStore.selectedShapes) {
    // Calculate new position
    let newX, newY;
    
    if (shape.type === SHAPE_TYPES.LINE || shape.type === SHAPE_TYPES.ARROW) {
      // For lines/arrows, update both endpoints
      shape.x += deltaX;
      shape.y += deltaY;
      shape.endX += deltaX;
      shape.endY += deltaY;
      newX = shape.x;
      newY = shape.y;
    } else {
      newX = shape.x + deltaX;
      newY = shape.y + deltaY;
    }
    
    // Update position locally (not sent to server yet - only on drag end)
    canvasStore.updateDragPosition(shape.id, newX, newY);
  }
  
  startX.value = x;
  startY.value = y;
}

function handleResize(x, y) {
  if (!startBounds.value || !resizeHandle.value) return;
  
  const deltaX = x - startX.value;
  const deltaY = y - startY.value;
  
  const shape = canvasStore.shapes.find(s => s.id === startBounds.value.shapeId);
  if (!shape) return;
  
  const newDimensions = resizeShapeUtil(shape, resizeHandle.value, deltaX, deltaY, startBounds.value);
  Object.assign(shape, newDimensions);
}

function handleRotate(x, y) {
  const shape = canvasStore.selectedShapes[0];
  if (!shape) return;
  
  const rotation = calculateRotation(shape, x, y);
  shape.rotation = Math.round(rotation);
}

async function handleMouseUp(e) {
  const rect = canvasRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  if (isDrawing.value && previewShape.value) {
    // Create the actual shape
    const tool = canvasStore.currentTool;
    const type = tool === TOOLS.RECTANGLE ? SHAPE_TYPES.RECTANGLE :
                 tool === TOOLS.CIRCLE ? SHAPE_TYPES.CIRCLE :
                 tool === TOOLS.LINE ? SHAPE_TYPES.LINE :
                 tool === TOOLS.ARROW ? SHAPE_TYPES.ARROW : null;
    
    if (type && (Math.abs(x - startX.value) > 5 || Math.abs(y - startY.value) > 5)) {
      await canvasStore.addShape(type, startX.value, startY.value, x, y);
    }
    
    previewShape.value = null;
    canvasStore.setTool(TOOLS.SELECT);
  }
  
  if (isDragging.value) {
    // End drag - this sends DRAG_END and SHAPE_MOVED events
    for (const shape of canvasStore.selectedShapes) {
      if (shape.type === SHAPE_TYPES.LINE || shape.type === SHAPE_TYPES.ARROW) {
        // For lines/arrows, update all position properties
        await canvasStore.updateShape(shape.id, {
          x: shape.x,
          y: shape.y,
          endX: shape.endX,
          endY: shape.endY
        });
      } else {
        // Use endDrag which records DRAG_END and SHAPE_MOVED
        await canvasStore.endDrag(shape.id);
      }
    }
  }
  
  if (isResizing.value) {
    const shape = canvasStore.selectedShapes[0];
    if (shape) {
      const box = getBoundingBox(shape);
      if (shape.type === SHAPE_TYPES.CIRCLE) {
        await canvasStore.resizeShape(shape.id, { x: shape.x, y: shape.y, radius: shape.radius });
      } else if (shape.type === SHAPE_TYPES.LINE || shape.type === SHAPE_TYPES.ARROW) {
        await canvasStore.resizeShape(shape.id, { x: shape.x, y: shape.y, endX: shape.endX, endY: shape.endY });
      } else {
        await canvasStore.resizeShape(shape.id, { x: box.x, y: box.y, width: box.width, height: box.height });
      }
    }
  }
  
  if (isRotating.value) {
    const shape = canvasStore.selectedShapes[0];
    if (shape) {
      await canvasStore.rotateShape(shape.id, shape.rotation);
    }
  }
  
  isDrawing.value = false;
  isDragging.value = false;
  isResizing.value = false;
  isRotating.value = false;
  resizeHandle.value = null;
  startBounds.value = null;
}

function handleMouseLeave() {
  // Don't reset states, just stop tracking cursor
}

function handleDoubleClick(e) {
  const rect = canvasRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  // Check if double-clicking on a text shape
  const textShapes = canvasStore.sortedShapes.filter(
    s => s.type === SHAPE_TYPES.TEXT && isPointInShape(s, x, y)
  );
  
  if (textShapes.length > 0) {
    startEditingText(textShapes[textShapes.length - 1]);
  }
}

function handleContextMenu(e) {
  if (canvasStore.hasSelection) {
    contextMenu.show(e.clientX, e.clientY);
  }
}

// Watch for shape changes and trigger re-render
watch(() => canvasStore.shapes, () => {
  render();
}, { deep: true });
</script>
