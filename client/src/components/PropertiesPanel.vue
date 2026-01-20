<template>
  <div class="properties-panel">
    <h3 class="panel-title">Properties</h3>
    
    <div v-if="selectedShape">
      <!-- Position -->
      <div class="property-row">
        <div class="property-group">
          <label class="property-label">X</label>
          <input 
            type="number" 
            class="property-input"
            :value="Math.round(selectedShape.x)"
            @change="updateProperty('x', Number($event.target.value))"
          />
        </div>
        <div class="property-group">
          <label class="property-label">Y</label>
          <input 
            type="number" 
            class="property-input"
            :value="Math.round(selectedShape.y)"
            @change="updateProperty('y', Number($event.target.value))"
          />
        </div>
      </div>
      
      <!-- Size (for rectangle and text) -->
      <div v-if="hasWidthHeight" class="property-row">
        <div class="property-group">
          <label class="property-label">Width</label>
          <input 
            type="number" 
            class="property-input"
            :value="Math.round(selectedShape.width)"
            @change="updateProperty('width', Number($event.target.value))"
          />
        </div>
        <div class="property-group">
          <label class="property-label">Height</label>
          <input 
            type="number" 
            class="property-input"
            :value="Math.round(selectedShape.height)"
            @change="updateProperty('height', Number($event.target.value))"
          />
        </div>
      </div>
      
      <!-- Radius (for circle) -->
      <div v-if="selectedShape.type === 'circle'" class="property-group">
        <label class="property-label">Radius</label>
        <input 
          type="number" 
          class="property-input"
          :value="Math.round(selectedShape.radius)"
          @change="updateProperty('radius', Number($event.target.value))"
        />
      </div>
      
      <!-- Rotation -->
      <div class="property-group">
        <label class="property-label">Rotation</label>
        <div class="property-row">
          <input 
            type="range" 
            min="0" 
            max="360"
            :value="selectedShape.rotation || 0"
            @input="updateProperty('rotation', Number($event.target.value))"
            style="flex: 1"
          />
          <input 
            type="number" 
            class="property-input"
            style="width: 60px"
            :value="Math.round(selectedShape.rotation || 0)"
            @change="updateProperty('rotation', Number($event.target.value))"
          />
        </div>
      </div>
      
      <hr style="margin: 16px 0; border: none; border-top: 1px solid var(--border-color);">
      
      <!-- Stroke Color -->
      <div class="property-group">
        <label class="property-label">Stroke Color</label>
        <div class="color-picker">
          <input 
            type="color" 
            class="color-swatch"
            :value="selectedShape.strokeColor"
            @input="updateProperty('strokeColor', $event.target.value)"
          />
          <input 
            type="text" 
            class="property-input color-input"
            :value="selectedShape.strokeColor"
            @change="updateProperty('strokeColor', $event.target.value)"
          />
        </div>
      </div>
      
      <!-- Stroke Width -->
      <div class="property-group">
        <label class="property-label">Stroke Width</label>
        <input 
          type="number" 
          class="property-input"
          min="1"
          max="20"
          :value="selectedShape.strokeWidth"
          @change="updateProperty('strokeWidth', Number($event.target.value))"
        />
      </div>
      
      <!-- Fill Color (for rectangle and circle) -->
      <div v-if="hasFill" class="property-group">
        <label class="property-label">Fill Color</label>
        <div class="color-picker">
          <input 
            type="color" 
            class="color-swatch"
            :value="fillColorValue"
            @input="updateProperty('fillColor', $event.target.value)"
          />
          <input 
            type="text" 
            class="property-input color-input"
            :value="selectedShape.fillColor"
            @change="updateProperty('fillColor', $event.target.value)"
            placeholder="transparent"
          />
        </div>
      </div>
      
      <!-- Corner Radius (for rectangle) -->
      <div v-if="selectedShape.type === 'rectangle'" class="property-group">
        <label class="property-label">Corner Radius</label>
        <input 
          type="number" 
          class="property-input"
          min="0"
          :value="selectedShape.cornerRadius || 0"
          @change="updateProperty('cornerRadius', Number($event.target.value))"
        />
      </div>
      
      <!-- Text Properties -->
      <template v-if="selectedShape.type === 'text'">
        <hr style="margin: 16px 0; border: none; border-top: 1px solid var(--border-color);">
        
        <div class="property-group">
          <label class="property-label">Text</label>
          <textarea 
            class="property-input"
            rows="3"
            :value="selectedShape.text"
            @change="updateProperty('text', $event.target.value)"
          ></textarea>
        </div>
        
        <div class="property-group">
          <label class="property-label">Font Size</label>
          <input 
            type="number" 
            class="property-input"
            min="8"
            max="72"
            :value="selectedShape.fontSize"
            @change="updateProperty('fontSize', Number($event.target.value))"
          />
        </div>
        
        <div class="property-group">
          <label class="property-label">Font Family</label>
          <select 
            class="property-input"
            :value="selectedShape.fontFamily"
            @change="updateProperty('fontFamily', $event.target.value)"
          >
            <option value="Arial">Arial</option>
            <option value="Helvetica">Helvetica</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Georgia">Georgia</option>
            <option value="Courier New">Courier New</option>
            <option value="Verdana">Verdana</option>
          </select>
        </div>
        
        <div class="property-row">
          <div class="property-group">
            <label class="property-label">Weight</label>
            <select 
              class="property-input"
              :value="selectedShape.fontWeight"
              @change="updateProperty('fontWeight', $event.target.value)"
            >
              <option value="normal">Normal</option>
              <option value="bold">Bold</option>
            </select>
          </div>
          <div class="property-group">
            <label class="property-label">Style</label>
            <select 
              class="property-input"
              :value="selectedShape.fontStyle"
              @change="updateProperty('fontStyle', $event.target.value)"
            >
              <option value="normal">Normal</option>
              <option value="italic">Italic</option>
            </select>
          </div>
        </div>
      </template>
      
      <!-- Arrow Head Size -->
      <div v-if="selectedShape.type === 'arrow'" class="property-group">
        <label class="property-label">Arrow Head Size</label>
        <input 
          type="number" 
          class="property-input"
          min="5"
          max="50"
          :value="selectedShape.arrowHeadSize || 15"
          @change="updateProperty('arrowHeadSize', Number($event.target.value))"
        />
      </div>
      
      <hr style="margin: 16px 0; border: none; border-top: 1px solid var(--border-color);">
      
      <!-- Actions -->
      <div class="property-group">
        <button class="btn btn-secondary" style="width: 100%; margin-bottom: 8px;" @click="bringToFront">
          Bring to Front
        </button>
        <button class="btn btn-secondary" style="width: 100%; margin-bottom: 8px;" @click="sendToBack">
          Send to Back
        </button>
        <button class="btn btn-danger" style="width: 100%;" @click="deleteShape">
          Delete
        </button>
      </div>
    </div>
    
    <div v-else class="no-selection">
      <p>Select a shape to edit its properties</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useCanvasStore } from '@/stores/canvas.js';

const canvasStore = useCanvasStore();

const selectedShape = computed(() => canvasStore.selectedShapes[0]);

const hasWidthHeight = computed(() => {
  return selectedShape.value && 
    (selectedShape.value.type === 'rectangle' || selectedShape.value.type === 'text');
});

const hasFill = computed(() => {
  return selectedShape.value && 
    (selectedShape.value.type === 'rectangle' || selectedShape.value.type === 'circle');
});

const fillColorValue = computed(() => {
  const fill = selectedShape.value?.fillColor;
  return fill && fill !== 'transparent' ? fill : '#ffffff';
});

async function updateProperty(property, value) {
  if (!selectedShape.value) return;
  await canvasStore.updateShape(selectedShape.value.id, { [property]: value });
}

async function bringToFront() {
  if (selectedShape.value) {
    await canvasStore.bringToFront(selectedShape.value.id);
  }
}

async function sendToBack() {
  if (selectedShape.value) {
    await canvasStore.sendToBack(selectedShape.value.id);
  }
}

async function deleteShape() {
  if (selectedShape.value) {
    await canvasStore.deleteShape(selectedShape.value.id);
  }
}
</script>

<style scoped>
.no-selection {
  color: var(--text-muted);
  text-align: center;
  padding: 40px 20px;
}
</style>
