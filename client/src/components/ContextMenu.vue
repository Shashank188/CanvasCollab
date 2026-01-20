<template>
  <div 
    class="context-menu"
    :style="{ left: x + 'px', top: y + 'px' }"
    @click.stop
  >
    <div class="context-menu-item" @click="copy">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
      Copy
    </div>
    <div class="context-menu-item" @click="duplicate">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="8" y="8" width="14" height="14" rx="2" ry="2"/>
        <path d="M4 16V4a2 2 0 0 1 2-2h12"/>
      </svg>
      Duplicate
    </div>
    
    <div class="context-menu-divider"></div>
    
    <div class="context-menu-item" @click="bringToFront">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="18 15 12 9 6 15"/>
      </svg>
      Bring to Front
    </div>
    <div class="context-menu-item" @click="sendToBack">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
      Send to Back
    </div>
    
    <div class="context-menu-divider"></div>
    
    <div class="context-menu-item danger" @click="deleteShape">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </svg>
      Delete
    </div>
  </div>
</template>

<script setup>
import { useCanvasStore } from '@/stores/canvas.js';

const props = defineProps({
  x: Number,
  y: Number
});

const emit = defineEmits(['close']);
const canvasStore = useCanvasStore();

function copy() {
  canvasStore.copySelected();
  emit('close');
}

function duplicate() {
  canvasStore.duplicate();
  emit('close');
}

function bringToFront() {
  const shape = canvasStore.selectedShapes[0];
  if (shape) {
    canvasStore.bringToFront(shape.id);
  }
  emit('close');
}

function sendToBack() {
  const shape = canvasStore.selectedShapes[0];
  if (shape) {
    canvasStore.sendToBack(shape.id);
  }
  emit('close');
}

function deleteShape() {
  canvasStore.deleteSelectedShapes();
  emit('close');
}
</script>

<style scoped>
.context-menu-item.danger {
  color: var(--danger-color);
}

.context-menu-item svg {
  flex-shrink: 0;
}
</style>
