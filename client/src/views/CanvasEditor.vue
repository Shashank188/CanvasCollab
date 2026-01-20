<template>
  <div class="app-container">
    <Toolbar />
    <div class="main-content">
      <CanvasArea />
      <PropertiesPanel v-if="canvasStore.hasSelection" />
    </div>
    <RemoteCursors />
    <ContextMenu 
      v-if="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      @close="closeContextMenu"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, provide } from 'vue';
import { useRoute } from 'vue-router';
import { useCanvasStore } from '@/stores/canvas.js';
import { useToastStore } from '@/stores/toast.js';
import Toolbar from '@/components/Toolbar.vue';
import CanvasArea from '@/components/CanvasArea.vue';
import PropertiesPanel from '@/components/PropertiesPanel.vue';
import RemoteCursors from '@/components/RemoteCursors.vue';
import ContextMenu from '@/components/ContextMenu.vue';

const route = useRoute();
const canvasStore = useCanvasStore();
const toastStore = useToastStore();

const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0
});

provide('contextMenu', {
  show: (x, y) => {
    contextMenu.value = { visible: true, x, y };
  },
  hide: () => {
    contextMenu.value.visible = false;
  }
});

function closeContextMenu() {
  contextMenu.value.visible = false;
}

// Keyboard shortcuts
function handleKeyDown(e) {
  // Prevent shortcuts when editing text
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modifier = isMac ? e.metaKey : e.ctrlKey;

  if (modifier) {
    switch (e.key.toLowerCase()) {
      case 'a':
        e.preventDefault();
        canvasStore.selectAll();
        break;
      case 'c':
        e.preventDefault();
        canvasStore.copySelected();
        break;
      case 'v':
        e.preventDefault();
        canvasStore.paste();
        break;
      case 'd':
        e.preventDefault();
        canvasStore.duplicate();
        break;
      case 'z':
        e.preventDefault();
        // Undo would go here
        break;
    }
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (canvasStore.hasSelection) {
      e.preventDefault();
      canvasStore.deleteSelectedShapes();
    }
  }

  if (e.key === 'Escape') {
    canvasStore.clearSelection();
    canvasStore.setTool('select');
  }

  // Tool shortcuts
  if (!modifier) {
    switch (e.key.toLowerCase()) {
      case 'v':
        canvasStore.setTool('select');
        break;
      case 'r':
        canvasStore.setTool('rectangle');
        break;
      case 'c':
        canvasStore.setTool('circle');
        break;
      case 'l':
        canvasStore.setTool('line');
        break;
      case 'a':
        canvasStore.setTool('arrow');
        break;
      case 't':
        canvasStore.setTool('text');
        break;
    }
  }
}

onMounted(async () => {
  const canvasId = route.params.id;
  
  try {
    await canvasStore.initCanvas(canvasId);
    toastStore.success('Connected to canvas');
  } catch (error) {
    console.error('Failed to initialize canvas:', error);
    toastStore.error('Failed to connect to canvas');
  }

  window.addEventListener('keydown', handleKeyDown);
  document.addEventListener('click', (e) => {
    if (contextMenu.value.visible) {
      closeContextMenu();
    }
  });
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  canvasStore.cleanup();
});
</script>
