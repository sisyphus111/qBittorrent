<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ArrowUp, Folder, FolderOpen, X } from 'lucide-vue-next';
import { apiGet } from '../api';
import { bytes } from '../format';
import { isStoragePath, storageRootFor, storageRoots, storageState } from '../storage';
import CapacityBar from './CapacityBar.vue';

const props = defineProps<{ modelValue: string; disabled?: boolean; id: string }>();
const emit = defineEmits<{ 'update:modelValue': [path: string] }>();
const selected = computed(() => storageRootFor(props.modelValue));
const root = computed(() => selected.value?.path || '');
const unavailable = computed(() => !selected.value?.writable || Boolean(storageState.error));
const folder = computed(() => storageRootFor(props.modelValue) ? props.modelValue.slice(root.value.length).replace(/^\/+/, '') : '');
const browsing = ref(false);
const browsePath = ref('');
const directories = ref<string[]>([]);
const loading = ref(false);
const error = ref('');
let generation = 0;
const update = (disk: string, subdirectory: string) => {
    const relative = subdirectory.replace(/^\/+/, '').replace(/\/{2,}/g, '/');
    emit('update:modelValue', `${disk}${relative ? `/${relative}` : ''}`);
};
const load = async (path: string) => {
    if (!isStoragePath(path)) return;
    const current = ++generation;
    browsePath.value = path;
    loading.value = true;
    error.value = '';
    directories.value = [];
    try {
        const paths = await apiGet<string[]>('app/getDirectoryContent', { dirPath: path, mode: 'dirs' });
        if (current !== generation) return;
        directories.value = paths.filter(isStoragePath).sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
    } catch (failure) {
        if (current === generation) error.value = (failure as Error).message;
    } finally {
        if (current === generation) loading.value = false;
    }
};
const browse = () => { browsing.value = !browsing.value; if (browsing.value) void load(root.value); };
const choose = () => { emit('update:modelValue', browsePath.value); browsing.value = false; };
watch(root, () => { if (browsing.value) void load(root.value); });
onBeforeUnmount(() => { generation++; });
</script>

<template>
    <div class="save-path-picker">
        <fieldset class="disk-choices" :disabled="disabled">
            <legend>磁盘</legend>
            <p v-if="storageState.error" class="storage-error" role="alert">{{ storageState.error }}</p>
            <p v-else-if="!storageState.loaded" class="storage-message" role="status">加载中</p>
            <p v-else-if="!storageRoots.length" class="storage-message">无可用磁盘</p>
            <div class="disk-options">
                <label v-for="(disk, index) in storageRoots" :key="disk.path" class="disk-option" :class="{ selected: root === disk.path, disabled: !disk.writable }" :for="`${id}-${index}`">
                    <div class="disk-option-heading"><input :id="`${id}-${index}`" type="radio" :name="id" :value="disk.path" :checked="root === disk.path" :disabled="disabled || !disk.writable || !!storageState.error" @change="update(disk.path, folder)"><span>{{ disk.label }}</span><small>{{ disk.volume.mounted ? bytes(disk.volume.total) : '未挂载' }}<span v-if="disk.volume.mounted && !disk.writable"> · 只读</span></small></div>
                    <span class="disk-path">{{ disk.path }}<span v-if="disk.volume.paths.length > 1"> · 共享容量</span></span>
                    <CapacityBar :volume="disk.volume" compact />
                </label>
            </div>
        </fieldset>
        <div class="path-controls">
            <div class="folder-control">
                <label :for="`${id}-folder`">路径</label>
                <div class="folder-input" :class="{ disabled: disabled || unavailable, browsing }">
                    <div class="path-prefix">
                        <input class="input path-root" :style="{ width: `calc(${Math.max(root.length, 1)}ch + 10px)` }" :value="root" readonly aria-label="所选磁盘根目录" :title="root" tabindex="-1">
                        <span class="path-separator" aria-hidden="true">/</span>
                    </div>
                    <input :id="`${id}-folder`" class="input path-folder" :value="folder" :disabled="disabled || unavailable" aria-label="子目录" autocomplete="off" @input="update(root, ($event.target as HTMLInputElement).value)">
                    <button class="path-browse" type="button" aria-label="浏览" title="浏览" :disabled="disabled || unavailable" :aria-expanded="browsing" :aria-controls="`${id}-browser`" @click="browse"><FolderOpen :size="16" /></button>
                </div>
            </div>
        </div>
        <div v-if="browsing" :id="`${id}-browser`" class="directory-browser" role="region" aria-label="浏览服务器目录">
            <div class="browser-header"><button class="icon-button" type="button" aria-label="上级目录" :disabled="disabled || loading || browsePath === root" @click="load(browsePath.slice(0, browsePath.lastIndexOf('/')))"><ArrowUp :size="15" /></button><span>{{ browsePath }}</span><button class="icon-button" type="button" aria-label="关闭目录浏览" @click="browsing = false"><X :size="15" /></button></div>
            <div class="directory-list">
                <p v-if="loading" role="status">加载中</p>
                <p v-else-if="error" role="alert">{{ error }}</p>
                <template v-else><button v-for="path in directories" :key="path" class="directory-entry" type="button" :disabled="disabled" @click="load(path)"><Folder :size="15" />{{ path.slice(path.lastIndexOf('/') + 1) }}</button><p v-if="!directories.length">无子目录</p></template>
            </div>
            <div class="browser-footer"><button class="button" type="button" :disabled="disabled || loading || !!error" @click="choose">选择当前目录</button></div>
        </div>
        <small v-if="storageState.loaded && unavailable" class="storage-error">磁盘不可写或未挂载</small>
    </div>
</template>

<style scoped>
.save-path-picker { display: grid; gap: 7px; min-width: 0; }
.path-controls { display: grid; gap: 12px; }
.disk-choices { margin: 0; padding: 0; border: 0; min-width: 0; }
.disk-choices legend { padding: 0 0 7px; font-size: 12px; }
.disk-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px; max-height: 250px; overflow: auto; }
.disk-option { border: 1px solid var(--border); padding: 9px; border-radius: 3px; cursor: pointer; min-width: 0; }
.disk-option.selected { border-color: color-mix(in srgb, var(--muted) 40%, var(--border)); background: color-mix(in srgb, var(--text) 5%, var(--surface)); }
.disk-option.disabled { cursor: not-allowed; opacity: .65; }
.disk-option-heading { display: flex; align-items: center; gap: 6px; }
.disk-option-heading input { margin: 0; }
.disk-option-heading small { margin-left: auto; }
.disk-path { font-size: 10px; color: var(--muted); overflow-wrap: anywhere; }
.storage-message { font-size: 11px; color: var(--muted); padding: 8px 0; }
.storage-error { color: var(--danger); font-size: 11px; }
.folder-control { display: grid; gap: 6px; }
.folder-input { display: flex; align-items: stretch; height: 36px; min-width: 0; overflow: hidden; border: 1px solid var(--border-input); border-radius: 4px; background: var(--input-bg); }
.folder-input:focus-within, .folder-input.browsing { border-color: var(--accent); }
.folder-input.disabled { opacity: .55; }
.folder-input .input { height: 100%; min-height: 0; min-width: 0; border: 0; border-radius: 0; background: transparent; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
.folder-input .input:focus { outline: none; }
.path-prefix { display: flex; align-items: center; flex: 0 1 auto; min-width: 0; max-width: 48%; background: var(--surface-2); }
.path-prefix .path-root { flex: 0 1 auto; padding: 0 0 0 10px; color: var(--muted); }
.path-folder { flex: 1 1 0; padding: 0 8px; }
.path-separator { flex-shrink: 0; padding: 0 7px 0 2px; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
.path-browse { display: flex; align-items: center; justify-content: center; flex: 0 0 34px; padding: 0; border: 0; border-left: 1px solid var(--border); background: transparent; color: var(--muted); }
.path-browse:hover:not(:disabled), .path-browse[aria-expanded="true"] { background: var(--accent-soft); color: var(--accent); }
.path-browse:focus-visible { outline-offset: -3px; }
label { display: flex; flex-direction: column; gap: 6px; color: var(--text); font-size: 12px; font-weight: 400; }
small { color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
.directory-browser { border: 1px solid var(--border); border-radius: 4px; font-size: 12px; }
.browser-header { display: flex; align-items: center; gap: 6px; padding: 4px; border-bottom: 1px solid var(--border); }
.browser-header span { flex: 1; overflow-wrap: anywhere; min-width: 0; }
.directory-list { max-height: 180px; overflow: auto; }
.directory-list p { padding: 12px; color: var(--muted); }
.directory-entry { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 12px; border: 0; background: transparent; text-align: left; overflow-wrap: anywhere; }
.directory-entry:hover { background: var(--accent-soft); }
.browser-footer { display: flex; justify-content: flex-end; padding: 6px; border-top: 1px solid var(--border); }
@media (max-width: 520px) { .path-controls { grid-template-columns: 1fr; } }
</style>
