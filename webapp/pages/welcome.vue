<script setup lang="ts">
import Join from '../components/join.vue'
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center gap-10 px-4">
    <div class="text-center">
      <h1 class="text-white text-6xl font-extrabold tracking-tight">WOOM</h1>
      <p class="mt-2 text-slate-400">A new meeting</p>
    </div>
    <Join />
  </div>
</template>
