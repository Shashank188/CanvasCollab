<template>
  <div class="toolbar">
    <div class="toolbar-section">
      <router-link to="/" class="logo-link">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
      </router-link>
      
      <div class="toolbar-divider"></div>
      
      <!-- Tool Selection -->
      <button 
        class="tool-btn" 
        :class="{ active: canvasStore.currentTool === 'select' }"
        @click="canvasStore.setTool('select')"
        title="Select (V)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
        </svg>
      </button>
      
      <div class="toolbar-divider"></div>
      
      <button 
        class="tool-btn" 
        :class="{ active: canvasStore.currentTool === 'rectangle' }"
        @click="canvasStore.setTool('rectangle')"
        title="Rectangle (R)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        </svg>
      </button>
      
      <button 
        class="tool-btn" 
        :class="{ active: canvasStore.currentTool === 'circle' }"
        @click="canvasStore.setTool('circle')"
        title="Circle (C)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="9"/>
        </svg>
      </button>
      
      <button 
        class="tool-btn" 
        :class="{ active: canvasStore.currentTool === 'line' }"
        @click="canvasStore.setTool('line')"
        title="Line (L)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="5" y1="19" x2="19" y2="5"/>
        </svg>
      </button>
      
      <button 
        class="tool-btn" 
        :class="{ active: canvasStore.currentTool === 'arrow' }"
        @click="canvasStore.setTool('arrow')"
        title="Arrow (A)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="5" y1="19" x2="19" y2="5"/>
          <polyline points="10 5 19 5 19 14"/>
        </svg>
      </button>
      
      <button 
        class="tool-btn" 
        :class="{ active: canvasStore.currentTool === 'text' }"
        @click="canvasStore.setTool('text')"
        title="Text (T)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="4 7 4 4 20 4 20 7"/>
          <line x1="9" y1="20" x2="15" y2="20"/>
          <line x1="12" y1="4" x2="12" y2="20"/>
        </svg>
      </button>
    </div>
    
    <div class="toolbar-section">
      <!-- Action Buttons -->
      <button 
        class="tool-btn" 
        @click="canvasStore.deleteSelectedShapes"
        :disabled="!canvasStore.hasSelection"
        title="Delete"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
      
      <div class="toolbar-divider"></div>
      
      <!-- Sync Status -->
      <div class="connection-status">
        <span 
          class="status-dot" 
          :class="{ 
            online: canvasStore.isConnected && canvasStore.isOnline,
            offline: !canvasStore.isOnline,
            syncing: canvasStore.isSyncing
          }"
        ></span>
        <span v-if="canvasStore.isSyncing">Syncing...</span>
        <span v-else-if="!canvasStore.isOnline">Offline</span>
        <span v-else-if="canvasStore.isConnected">Online</span>
        <span v-else>Connecting...</span>
        
        <span v-if="canvasStore.pendingChangesCount > 0" class="pending-badge">
          {{ canvasStore.pendingChangesCount }} pending
        </span>
      </div>
      
      <div class="toolbar-divider"></div>
      
      <!-- Users -->
      <div class="users-list" v-if="canvasStore.users.length > 0">
        <div 
          v-for="user in canvasStore.users" 
          :key="user.userId"
          class="user-avatar"
          :style="{ backgroundColor: getUserColor(user.userId) }"
          :title="user.username"
        >
          {{ user.username?.charAt(0).toUpperCase() }}
        </div>
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
.logo-link {
  display: flex;
  align-items: center;
  color: var(--primary-color);
  text-decoration: none;
}

.logo-link:hover {
  opacity: 0.8;
}

.pending-badge {
  margin-left: 8px;
  padding: 2px 8px;
  background-color: var(--warning-color);
  color: white;
  border-radius: 10px;
  font-size: 11px;
}

.tool-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
