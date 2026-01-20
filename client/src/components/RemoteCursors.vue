<template>
  <div class="remote-cursors-container">
    <div 
      v-for="(cursor, userId) in canvasStore.remoteCursors" 
      :key="userId"
      class="remote-cursor"
      :style="{ 
        transform: `translate(${cursor.x}px, ${cursor.y}px)`,
        color: getUserColor(userId)
      }"
    >
      <div class="cursor-pointer"></div>
      <div 
        class="cursor-label"
        :style="{ backgroundColor: getUserColor(userId) }"
      >
        {{ cursor.username }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { useCanvasStore } from '@/stores/canvas.js';
import { getUserColor } from '@/utils/shapes.js';

const canvasStore = useCanvasStore();
</script>

<style scoped>
.remote-cursors-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: hidden;
}
</style>
