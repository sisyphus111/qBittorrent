<script setup lang="ts">
import { computed } from 'vue';
import { Info } from 'lucide-vue-next';
import { bytes } from '../format';
import { capacitySegments } from '../capacity';
import type { StorageVolume } from '../storage';
import HintTooltip from './HintTooltip.vue';
const props = defineProps<{ volume: StorageVolume; compact?: boolean }>();
const segments = computed(() => capacitySegments(props.volume));
const occupied = computed(() => props.volume.used + props.volume.reserved);
const excluded = computed(() => props.volume.mounted
    ? props.volume.unknown_count + props.volume.unsettled_count : props.volume.task_count);
const forecastNote = computed(() => [
    !props.volume.mounted && excluded.value ? `${excluded.value} 个任务所在磁盘未挂载。` : '',
    props.volume.mounted && props.volume.unknown_count ? `${props.volume.unknown_count} 个任务缺少元数据。` : '',
    props.volume.mounted && props.volume.unsettled_count ? `${props.volume.unsettled_count} 个任务正在校验或移动。` : '',
    props.volume.cross_volume_count ? `${props.volume.cross_volume_count} 个跨盘任务按复制峰值估算。` : '',
].filter(Boolean).join(' '));
const summary = computed(() => !props.volume.mounted ? '未挂载，容量不可用'
    : `总量 ${bytes(props.volume.total)}；已用${props.volume.reserved ? '及保留' : ''} ${bytes(occupied.value)}；预计新增 ${bytes(props.volume.pending)}；预计剩余 ${bytes(props.volume.projected_free)}${props.volume.shortfall ? `；空间不足 ${bytes(props.volume.shortfall)}` : ''}`);
</script>

<template>
    <div class="capacity" :class="{ compact, unavailable: !volume.mounted }">
        <div class="capacity-track" role="img" :aria-label="`${summary} ${forecastNote}`" :title="`${summary} ${forecastNote}`">
            <span class="capacity-used" :style="{ width: `${segments.occupied}%` }"></span><span class="capacity-pending" :style="{ width: `${segments.pending}%` }"></span><span class="capacity-free" :style="{ width: `${segments.free}%` }"></span>
        </div>
        <div v-if="volume.mounted" class="capacity-values"><span>已用{{ volume.reserved ? '/保留' : '' }} {{ bytes(occupied) }}</span><span>预计 +{{ bytes(volume.pending) }}<HintTooltip v-if="forecastNote && !excluded" class="forecast-info" :text="forecastNote" label="容量估算说明"><Info :size="11" /></HintTooltip></span><span>剩余 {{ bytes(volume.projected_free) }}</span></div>
        <span v-if="!volume.mounted" class="capacity-note">未挂载</span>
        <span v-else-if="volume.shortfall" class="capacity-warning">预计超出 {{ bytes(volume.shortfall) }}</span>
        <HintTooltip v-if="excluded" class="capacity-note capacity-excluded" :text="forecastNote" :label="`未计入 ${excluded} 项`">未计入 {{ excluded }} 项</HintTooltip>
    </div>
</template>

<style scoped>
.capacity { display: grid; gap: 5px; min-width: 0; }
.capacity-track { height: 8px; display: flex; overflow: hidden; background: var(--surface-2); border-radius: 2px; }
.capacity-track > span { height: 100%; flex-shrink: 0; }
.capacity-used { background: var(--capacity-used); }
.capacity-pending { background: var(--capacity-pending); }
.capacity-free { background: var(--capacity-free); }
.capacity-values { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 10px; color: var(--muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.capacity-note { font-size: 10px; color: var(--muted); }
.forecast-info { margin-left: 3px; vertical-align: middle; }
.capacity-warning { color: var(--danger); font-size: 11px; }
.unavailable .capacity-track { background: repeating-linear-gradient(135deg, var(--border), var(--border) 4px, var(--surface-2) 4px, var(--surface-2) 8px); }
.compact .capacity-values { font-size: 10px; }
</style>
