<template>
  <div class="home-container">
    <div class="home-content">
      <h1 class="home-title">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        Canvas Collab
      </h1>
      <p class="home-subtitle">Real-time collaborative drawing canvas</p>
      
      <div class="canvas-actions">
        <div class="action-card">
          <h3>Create New Canvas</h3>
          <p>Start a new collaborative drawing session</p>
          <button class="btn btn-primary" @click="createNewCanvas">
            Create Canvas
          </button>
        </div>
        
        <div class="action-card">
          <h3>Join Existing Canvas</h3>
          <p>Enter a canvas ID to join</p>
          <div class="join-form">
            <input 
              v-model="joinCanvasId" 
              type="text" 
              class="property-input"
              placeholder="Enter Canvas ID"
            />
            <button 
              class="btn btn-primary" 
              @click="joinCanvas"
              :disabled="!joinCanvasId.trim()"
            >
              Join
            </button>
          </div>
        </div>
      </div>

      <div class="features-section">
        <h2>Features</h2>
        <div class="features-grid">
          <div class="feature-item">
            <span class="feature-icon">🎨</span>
            <h4>Multiple Shape Types</h4>
            <p>Rectangle, Circle, Line, Arrow, and Text</p>
          </div>
          <div class="feature-item">
            <span class="feature-icon">🔄</span>
            <h4>Real-time Collaboration</h4>
            <p>See changes from other users instantly</p>
          </div>
          <div class="feature-item">
            <span class="feature-icon">📴</span>
            <h4>Offline Support</h4>
            <p>Keep working even when offline</p>
          </div>
          <div class="feature-item">
            <span class="feature-icon">↔️</span>
            <h4>Full Shape Control</h4>
            <p>Move, resize, rotate, and edit</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { v4 as uuidv4 } from 'uuid';

const router = useRouter();
const joinCanvasId = ref('');

function createNewCanvas() {
  const canvasId = uuidv4();
  router.push(`/canvas/${canvasId}`);
}

function joinCanvas() {
  if (joinCanvasId.value.trim()) {
    router.push(`/canvas/${joinCanvasId.value.trim()}`);
  }
}
</script>

<style scoped>
.home-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
}

.home-content {
  max-width: 800px;
  text-align: center;
  color: white;
}

.home-title {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  font-size: 3rem;
  margin-bottom: 10px;
}

.home-subtitle {
  font-size: 1.25rem;
  opacity: 0.9;
  margin-bottom: 40px;
}

.canvas-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
  margin-bottom: 60px;
}

.action-card {
  background: white;
  color: var(--text-color);
  padding: 30px;
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
}

.action-card h3 {
  margin-bottom: 10px;
}

.action-card p {
  color: var(--text-muted);
  margin-bottom: 20px;
}

.join-form {
  display: flex;
  gap: 10px;
}

.join-form .property-input {
  flex: 1;
}

.features-section {
  background: rgba(255, 255, 255, 0.1);
  padding: 40px;
  border-radius: 12px;
  backdrop-filter: blur(10px);
}

.features-section h2 {
  margin-bottom: 30px;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
  text-align: left;
}

.feature-item {
  background: rgba(255, 255, 255, 0.1);
  padding: 20px;
  border-radius: 8px;
}

.feature-icon {
  font-size: 2rem;
  display: block;
  margin-bottom: 10px;
}

.feature-item h4 {
  margin-bottom: 5px;
}

.feature-item p {
  font-size: 0.9rem;
  opacity: 0.8;
}
</style>
