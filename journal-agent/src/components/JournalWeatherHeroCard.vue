<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { WeatherSnapshot } from '../services/weatherService';
import { renderWeatherSymbol } from '../services/weatherSymbolPlugin';

const props = defineProps<{
  snapshot: WeatherSnapshot | null;
  loading: boolean;
  metaText: string;
}>();

const emit = defineEmits<{
  retry: [];
}>();

const mainIconUrl = ref<string | null>(null);
let activeIconRequest: symbol | null = null;

const symbolTintColor = computed(() => {
  if (!props.snapshot) {
    return '#8E8E93';
  }

  switch (props.snapshot.condition) {
    case 'clear':
      return props.snapshot.isDay ? '#0A84FF' : '#4A67A1';
    case 'cloudy':
      return '#6C7A89';
    case 'fog':
      return '#90A0AF';
    case 'rain':
      return '#4877B8';
    case 'snow':
      return '#7BA7D8';
    case 'storm':
      return '#5B5F93';
    default:
      return '#8E8E93';
  }
});

watch(
  [() => props.snapshot, symbolTintColor],
  async ([snapshot, tintColor]) => {
    if (!snapshot) {
      mainIconUrl.value = null;
      return;
    }

    const requestKey = Symbol('weather-icons');
    activeIconRequest = requestKey;

    const mainIcon = await renderWeatherSymbol({
      name: snapshot.symbolName,
      pointSize: 18,
      weight: 'regular',
      scale: 'small',
      tintColor,
    });

    if (activeIconRequest !== requestKey) {
      return;
    }

    mainIconUrl.value = mainIcon;
  },
  { immediate: true },
);
</script>

<template>
  <section class="weather-inline" aria-label="今日天气">
    <template v-if="snapshot">
      <div class="weather-inline-main">
        <div class="weather-inline-symbol" aria-hidden="true">
          <img
            v-if="mainIconUrl"
            :src="mainIconUrl"
            :alt="snapshot.summary"
            class="weather-inline-symbol-image"
          />
          <span v-else class="weather-inline-symbol-fallback">{{ snapshot.summary }}</span>
        </div>

        <p class="weather-inline-summary">{{ snapshot.summary }}</p>
        <p class="weather-inline-temperature">{{ snapshot.temperature }}°</p>
      </div>
    </template>

    <template v-else>
      <button
        v-if="!loading"
        type="button"
        class="weather-inline-button"
        @click="emit('retry')"
      >
        天气
      </button>
      <span v-else class="weather-inline-loading">天气</span>
    </template>
  </section>
</template>

<style scoped>
.weather-inline {
  flex: 0 0 auto;
  min-width: 0;
}

.weather-inline-main {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--ink-2);
}

.weather-inline-symbol {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.weather-inline-symbol-image {
  width: 18px;
  height: 18px;
  object-fit: contain;
}

.weather-inline-symbol-fallback {
  font-size: 10px;
  line-height: 1;
  color: var(--ink-3);
}

.weather-inline-summary,
.weather-inline-temperature,
.weather-inline-loading {
  margin: 0;
  white-space: nowrap;
}

.weather-inline-summary {
  font-size: 14px;
  color: var(--ink-3);
}

.weather-inline-temperature {
  font-size: 16px;
  font-weight: 600;
  color: var(--ink-1);
  letter-spacing: -0.02em;
}

.weather-inline-button {
  padding: 0;
  color: var(--ink-3);
  font-size: 14px;
}

.weather-inline-loading {
  font-size: 14px;
  color: var(--ink-4);
}
</style>
