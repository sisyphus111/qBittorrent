<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronDown } from 'lucide-vue-next';
import { storageState } from '../storage';
import { bytes } from '../format';
import CapacityBar from './CapacityBar.vue';
const open = ref(true);
const estimateNote = computed(() => `按当前任务所选文件的剩余大小估算，含暂停任务，不含尚未提交的任务。${storageState.preallocation ? '已启用预分配，估算可能偏高。' : ''}${storageState.unmappedTasks ? `${storageState.unmappedTasks} 个任务的目标不在已发现磁盘上。` : ''}`);
try { open.value = localStorage.getItem('qbt-storage-expanded') !== 'false'; } catch { /* Optional preference. */ }
const toggle = () => { open.value = !open.value; try { localStorage.setItem('qbt-storage-expanded', String(open.value)); } catch { /* Optional preference. */ } };
</script>

<template>
    <section class="storage-overview" aria-label="磁盘容量" :style="{ '--storage-columns': Math.min(2, Math.max(1, storageState.volumes.length)) }">
        <header class="storage-heading">
            <button class="storage-toggle" type="button" :aria-expanded="open" aria-controls="storage-volumes" @click="toggle"><ChevronDown :size="14" :class="{ collapsed: !open }" />磁盘容量<span v-if="storageState.loaded">{{ storageState.volumes.length }}</span></button>
            <div class="capacity-legend" aria-label="容量条图例" :title="estimateNote"><span><i class="used"></i>已用</span><span><i class="pending"></i>预计新增</span><span><i class="free"></i>预计剩余</span></div>
        </header>
        <div v-if="open" id="storage-volumes" class="storage-body">
            <p v-if="storageState.error" class="storage-error" role="alert">{{ storageState.error }}<span v-if="storageState.loaded"> · 以下为上次采样</span></p>
            <p v-else-if="!storageState.loaded" class="storage-hint" role="status">加载中</p>
            <p v-else-if="!storageState.volumes.length" class="storage-hint">/mnt 下暂无存储位置。</p>
            <div class="storage-volumes">
                <article v-for="volume in storageState.volumes" :key="volume.id" class="storage-volume">
                    <div class="volume-title"><span :title="volume.paths.join('、')">{{ volume.label }}<small v-if="volume.paths.length > 1"> · {{ volume.paths.length }} 个共享挂载点</small></span><span>{{ volume.mounted ? `总量 ${bytes(volume.total)}` : '不可用' }}<small v-if="volume.mounted && !volume.writable_paths.length"> · 只读</small></span></div>
                    <CapacityBar :volume="volume" />
                </article>
            </div>
            <p v-if="storageState.loaded && storageState.unmappedTasks" class="storage-hint" title="这些任务的目标路径未匹配到已发现的磁盘。">未匹配 {{ storageState.unmappedTasks }} 项</p>
        </div>
    </section>
</template>

<style scoped>
.storage-overview { flex-shrink: 0; align-self: flex-start; width: min(100%, calc(var(--storage-columns) * 300px + (var(--storage-columns) - 1) * 24px)); padding-bottom: 12px; }
.storage-heading { display: flex; align-items: center; gap: 12px; min-height: 30px; }
.storage-toggle { display: flex; align-items: center; gap: 5px; padding: 0; border: 0; background: transparent; font-size: 11px; }
.storage-toggle > span { color: var(--muted); }
.collapsed { transform: rotate(-90deg); }
.capacity-legend { margin-left: auto; display: flex; gap: 14px; color: var(--muted); font-size: 10px; }
.capacity-legend > span { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
.capacity-legend i { width: 8px; height: 8px; border-radius: 1px; }
.used { background: var(--capacity-used); }.pending { background: var(--capacity-pending); }.free { background: var(--capacity-free); }
.storage-body { max-height: 230px; overflow: auto; }
.storage-volumes { display: grid; grid-template-columns: repeat(var(--storage-columns), minmax(0, 1fr)); gap: 12px 24px; }
.storage-volume { min-width: 0; }
.volume-title { display: flex; justify-content: space-between; gap: 12px; font-size: 11px; margin-bottom: 5px; }
.volume-title > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.volume-title > span:last-child { color: var(--muted); flex-shrink: 0; }
.volume-title small { font-size: 10px; color: var(--muted); }
.storage-hint { font-size: 10px; color: var(--muted); margin: 6px 0 0; }
.storage-error { font-size: 11px; color: var(--danger); margin-bottom: 8px; }
@media (max-width: 700px) { .storage-overview { width: min(100%, 360px); }.storage-volumes { grid-template-columns: 1fr; gap: 10px; }.storage-heading { gap: 5px; }.capacity-legend { gap: 8px; }.storage-body { max-height: 200px; } }
</style>
