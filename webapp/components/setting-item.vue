<script setup lang="ts">
import { ref } from 'vue'
import SvgTip from './svg/tip.vue'

defineProps<{
  label: string
  tooltips?: string[]
}>()

const tooltipVisible = ref(false)
</script>

<template>
  <div class="rounded-xl px-3 py-3 transition-colors hover:bg-white/5">
    <div class="flex flex-row justify-between items-center gap-2">
      <div class="flex flex-row items-center gap-1.5 pr-3">
        <label class="text-sm font-medium text-slate-200 whitespace-nowrap">
          {{ label }}
        </label>
        <div
          v-if="tooltips"
          class="relative"
          :class="tooltipVisible ? 'text-indigo-300' : 'text-slate-500'"
          @mouseenter="tooltipVisible = true"
          @mouseleave="tooltipVisible = false"
        >
          <SvgTip />
          <div v-if="tooltipVisible" class="absolute top-full mt-3 z-10 hidden md:block">
            <div class="absolute z-50 -top-2 border-l-8 border-r-8 border-b-8 border-transparent border-b-slate-800"></div>
          </div>
        </div>
      </div>
      <slot />
    </div>
    <div v-if="tooltips && tooltipVisible" class="relative flex justify-start items-center">
      <div class="flex flex-col items-start absolute z-50 top-1 bg-slate-800 text-slate-200 text-xs px-3 py-2 space-y-1 rounded-lg shadow-xl border border-white/10 w-max max-w-[90%]">
        <p v-for="(tip, index) in tooltips" :key="index" class="text-left">
          {{ tip }}
        </p>
      </div>
    </div>
  </div>
</template>
