<template>
  <div class="app-container">
    <router-view />
    <ToastContainer />
  </div>
</template>

<script setup>
import ToastContainer from '@/components/ToastContainer.vue';
</script>
