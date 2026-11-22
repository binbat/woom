<script setup lang="ts">
import Join from '../components/join.vue'
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center gap-10 px-4" data-testid="welcome-page">
    <div class="text-center">
      <h1 class="text-heading text-6xl font-extrabold tracking-tight">WOOM</h1>
      <p class="mt-2 text-muted">A new meeting</p>
    </div>
    <Join />
  </div>
</template>
