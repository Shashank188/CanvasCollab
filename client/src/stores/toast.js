import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useToastStore = defineStore('toast', () => {
  const toasts = ref([]);
  let toastId = 0;

  function addToast(message, type = 'info', duration = 3000) {
    const id = ++toastId;
    toasts.value.push({ id, message, type });

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }

    return id;
  }

  function removeToast(id) {
    toasts.value = toasts.value.filter(t => t.id !== id);
  }

  function success(message, duration = 3000) {
    return addToast(message, 'success', duration);
  }

  function error(message, duration = 5000) {
    return addToast(message, 'error', duration);
  }

  function warning(message, duration = 4000) {
    return addToast(message, 'warning', duration);
  }

  function info(message, duration = 3000) {
    return addToast(message, 'info', duration);
  }

  return {
    toasts,
    addToast,
    removeToast,
    success,
    error,
    warning,
    info
  };
});
