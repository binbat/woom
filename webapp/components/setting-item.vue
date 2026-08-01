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
  <div class="hover:bg-blue-200 rounded p-3">
    <div class="flex flex-row justify-between space-x-1 items-center">
      <div class="flex flex-row justify-start items-center space-x-1 pr-3 max-w-[50%]">
        <label class="text-base font-semibold p-1 text-left w-max">
          {{ label }}
        </label>
        <div
          v-if="tooltips"
          class="relative"
          :class="tooltipVisible ? 'text-blue' : 'text-black'"
          @mouseenter="tooltipVisible = true"
          @mouseleave="tooltipVisible = false"
        >
          <SvgTip />
          <div v-if="tooltipVisible" class="absolute top-full mt-3 z-10 hidden md:block">
            <div class="absolute z-50 -top-2 border-l-8 border-r-8 border-b-8 border-transparent border-b-black"></div>
          </div>
        </div>
      </div>
      <slot />
    </div>
    <div v-if="tooltips && tooltipVisible" class="relative flex justify-start items-center px-3">
      <div class="flex flex-col items-start absolute z-50 top-1 bg-black text-white text-sm px-3 py-1 space-y-1 rounded shadow-lg w-max max-w-[90%]">
        <p v-for="(tip, index) in tooltips" :key="index" class="text-left">
          {{ tip }}
        </p>
      </div>
    </div>
  </div>
</template>
