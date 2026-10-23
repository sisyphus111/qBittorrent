<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { FileUp, Link2, LoaderCircle, Plus, X } from 'lucide-vue-next';
import { apiPost, apiUpload } from '../api';
import { defaultStoragePath, isStoragePath, refreshStorage, storageRootFor, storageState } from '../storage';
import SavePathPicker from './SavePathPicker.vue';
import DownloadPreview from './DownloadPreview.vue';
import { isTorrentSource } from '../torrentSource';

const props = defineProps<{ open: boolean; defaultSavePath: string; initialUrl?: string }>();
interface AddResult { success_count: number; failure_count: number; pending_count: number }
const emit = defineEmits<{ close: []; added: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const urlInput = ref<HTMLTextAreaElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
type AddMode = 'link' | 'file';
const mode = ref<AddMode>('link');
const links = ref('');
const files = ref<File[]>([]);
const savePath = ref('');
const busy = ref(false);
const error = ref('');
const dragging = ref(false);
const previewFiles = computed(() => mode.value === 'file' ? files.value : []);
const count = computed(() => mode.value === 'file' ? files.value.length : links.value.split('\n').filter(value => value.trim()).length);
const canSubmit = computed(() => count.value > 0 && !busy.value && storageState.loaded && !storageState.error);
const initialSavePath = () => storageRootFor(defaultStoragePath(props.defaultSavePath))?.path || '';

const close = () => {
    if (!busy.value) emit('close');
};
const selectMode = (value: AddMode) => {
    mode.value = value;
    error.value = '';
};
const moveMode = async (event: KeyboardEvent) => {
    if (busy.value || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    selectMode(event.key === 'Home' ? 'link' : event.key === 'End' ? 'file' : mode.value === 'link' ? 'file' : 'link');
    await nextTick();
    dialog.value?.querySelector<HTMLButtonElement>(`#add-tab-${mode.value}`)?.focus();
};
const selectFiles = (values: FileList | File[]) => {
    error.value = '';
    const incoming = Array.from(values);
    const invalid = incoming.filter(file => !file.name.toLowerCase().endsWith('.torrent'));
    if (invalid.length) {
        error.value = '请选择 .torrent 格式的种子文件。';
        return;
    }
    for (const file of incoming) {
        if (!files.value.some(existing => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) {
            files.value.push(file);
        }
    }
};
const onFileChange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (target.files) selectFiles(target.files);
    target.value = '';
};
const onDrop = (event: DragEvent) => {
    dragging.value = false;
    if (!busy.value && event.dataTransfer?.files) selectFiles(event.dataTransfer.files);
};
const formatSize = (size: number) => size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KiB`;

const submit = async () => {
    if (!canSubmit.value) return;
    error.value = '';
    if (!isStoragePath(savePath.value)) {
        error.value = '请选择 /mnt 下已挂载且可写的磁盘，子目录不能包含 . 或 .. 路径段。';
        return;
    }
    const urls = links.value.split('\n').map(value => value.trim()).filter(Boolean);
    if (mode.value === 'link') {
        for (const value of urls) {
            if (!isTorrentSource(value)) {
                error.value = '请输入有效的种子哈希、磁力链接或 HTTP / HTTPS 种子地址，每行一个。';
                return;
            }
        }
    }
    busy.value = true;
    try {
        const options = { savepath: savePath.value, storageRoot: storageRootFor(savePath.value)!.path, stopped: false, stopCondition: 'None', contentLayout: 'Original', autoTMM: false, useDownloadPath: false };
        let result: AddResult;
        if (mode.value === 'file') {
            const data = new FormData();
            for (const file of files.value) data.append('torrents', file, file.name);
            for (const [key, value] of Object.entries(options)) data.set(key, String(value));
            result = await apiUpload<AddResult>('torrents/add', data);
        }
        else {
            result = await apiPost<AddResult>('torrents/add', { ...options, urls: urls.join('\n') });
        }
        if (result?.failure_count > 0) {
            error.value = `已提交 ${result.success_count + result.pending_count} 个任务，${result.failure_count} 个未能添加。请检查下载列表，移除已添加的项目后重试。`;
            return;
        }
        emit('added');
        emit('close');
    }
    catch (reason) {
        error.value = reason instanceof Error ? reason.message : '添加失败，请稍后重试。';
    }
    finally {
        busy.value = false;
    }
};

watch(() => props.open, async (open) => {
    if (open) {
        links.value = props.initialUrl ?? '';
        files.value = [];
        savePath.value = initialSavePath();
        void refreshStorage(true);
        error.value = '';
        mode.value = 'link';
        await nextTick();
        if (dialog.value && !dialog.value.open) dialog.value.showModal();
        urlInput.value?.focus();
    }
    else if (dialog.value?.open) dialog.value.close();
}, { immediate: true });

onBeforeUnmount(() => dialog.value?.close());
watch(() => storageState.loaded, (loaded) => {
    if (loaded && props.open && !savePath.value) savePath.value = initialSavePath();
});
</script>

<template>
    <dialog ref="dialog" class="modal add-torrent-dialog" aria-labelledby="add-torrent-title" @cancel.prevent="close">
        <form @submit.prevent="submit">
            <header class="dialog-heading">

                <div><h2 id="add-torrent-title">添加任务</h2></div>
                <button type="button" class="icon-button" aria-label="关闭" :disabled="busy" @click="close"><X :size="20" /></button>
            </header>
            <div class="dialog-layout">
                <div class="add-form-pane">
                    <section class="form-section" aria-labelledby="source-heading">
                        <h3 id="source-heading">任务来源</h3>
                    <div class="add-tabs" role="tablist" aria-label="添加方式">
                        <button id="add-tab-link" type="button" role="tab" aria-controls="add-panel-link" :aria-selected="mode === 'link'" :tabindex="mode === 'link' ? 0 : -1" :class="{ active: mode === 'link' }" :disabled="busy" @click="selectMode('link')" @keydown="moveMode"><Link2 :size="17" />链接 / 哈希</button>
                        <button id="add-tab-file" type="button" role="tab" aria-controls="add-panel-file" :aria-selected="mode === 'file'" :tabindex="mode === 'file' ? 0 : -1" :class="{ active: mode === 'file' }" :disabled="busy" @click="selectMode('file')" @keydown="moveMode"><FileUp :size="17" />种子文件</button>
                    </div>
                    <div class="source-panel">
                        <div :id="`add-panel-${mode}`" role="tabpanel" :aria-labelledby="`add-tab-${mode}`">
                        <label v-if="mode === 'link'" class="field">
                            <span class="sr-only">链接或种子哈希</span>
                            <textarea ref="urlInput" v-model="links" class="input links-input" rows="5" :disabled="busy" spellcheck="false"></textarea>
                        </label>
                        <div v-else>
                            <input ref="fileInput" type="file" accept=".torrent,application/x-bittorrent" multiple hidden :disabled="busy" @change="onFileChange">
                            <button type="button" class="file-drop" :class="{ dragging, 'has-files': files.length > 0 }" :disabled="busy" @click="fileInput?.click()" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="onDrop">
                                <FileUp :size="30" /><strong>选择或拖入种子</strong>
                            </button>
                            <ul v-if="files.length" class="upload-list">
                                <li v-for="(file, index) in files" :key="`${file.name}-${file.size}-${file.lastModified}`">
                                    <FileUp :size="17" /><span class="upload-name">{{ file.name }}</span><small>{{ formatSize(file.size) }}</small>
                                    <button type="button" class="icon-button" :aria-label="`移除 ${file.name}`" :disabled="busy" @click="files.splice(index, 1)"><X :size="16" /></button>
                                </li>
                            </ul>
                        </div>
                        </div>
                    </div>
                    </section>
                    <section class="form-section storage-section" aria-labelledby="storage-heading">
                        <h3 id="storage-heading">保存位置</h3>
                        <SavePathPicker v-if="open" id="add-save-disk" v-model="savePath" :disabled="busy" />
                    </section>
                    <p v-if="error" class="dialog-error" role="alert">{{ error }}</p>
                </div>
                <DownloadPreview v-if="open" :files="previewFiles" :links="mode === 'link' ? links : ''" :save-path="savePath" />
            </div>
            <footer class="dialog-footer">
                <button type="button" class="button ghost" :disabled="busy" @click="close">取消</button>
                <button type="submit" class="button primary" :disabled="!canSubmit"><LoaderCircle v-if="busy" :size="17" class="spinning" /><Plus v-else :size="17" />{{ busy ? '正在添加…' : '添加任务' }}</button>
            </footer>
        </form>
    </dialog>
</template>

<style scoped>
.add-torrent-dialog { width: min(1120px, calc(100vw - 32px)); height: min(780px, calc(100dvh - 40px)); max-height: calc(100dvh - 40px); margin: auto; padding: 0; overflow: hidden; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; box-shadow: var(--shadow); }
.add-torrent-dialog > form { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.dialog-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, .95fr) minmax(0, 1.2fr); overflow: hidden; border-top: 1px solid var(--border); }
.add-form-pane { min-width: 0; min-height: 0; overflow: auto; padding: 20px; }
.add-torrent-dialog::backdrop { background: var(--dialog-backdrop); }
.dialog-heading { display: flex; align-items: center; gap: 14px; padding: 18px 22px; flex-shrink: 0; }
.dialog-heading > .icon-button { margin-left: auto; align-self: flex-start; }
.dialog-heading h2 { margin: 0; font-size: 18px; letter-spacing: -.4px; }
.dialog-heading p { margin: 0; color: var(--muted); font-size: 12px; }
.form-section { display: grid; gap: 12px; min-width: 0; }
.form-section h3 { font-size: 13px; font-weight: 600; }
.storage-section { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border); }
.add-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; padding: 4px; margin: 0; border: 1px solid var(--border); border-radius: 5px; background: var(--input-bg); }
.add-tabs button { position: relative; display: flex; align-items: center; justify-content: center; gap: 7px; min-width: 0; min-height: 40px; padding: 9px 6px; font: inherit; font-size: 13px; border: 1px solid transparent; border-radius: 3px; background: transparent; color: var(--muted); cursor: pointer; white-space: nowrap; }
.add-tabs button:hover:not(:disabled):not(.active) { background: var(--row-hover); color: var(--text); }
.add-tabs button:focus-visible { outline-offset: 1px; z-index: 1; }
.add-tabs button.active { background: color-mix(in srgb, var(--text) 8%, var(--surface)); border-color: var(--border); color: var(--text); font-weight: 500; }
.source-panel { min-width: 0; padding-top: 2px; }
.field > span { display: flex; align-items: center; gap: 7px; }
.links-input { resize: vertical; min-height: 130px; line-height: 1.7; }
.file-drop { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 11px; width: 100%; min-height: 170px; padding: 20px; border: 1.5px dashed var(--border); border-radius: 4px; color: var(--accent); background: var(--surface-2); cursor: pointer; font: inherit; }
.file-drop strong { font-size: 14px; font-weight: 600; color: var(--text); }
.file-drop:hover, .file-drop.dragging { border-color: var(--accent); background: var(--accent-soft); }
.file-drop.has-files { min-height: 0; flex-direction: row; padding: 10px; gap: 8px; }
.file-drop.has-files svg { width: 18px; height: 18px; }
.upload-list { display: grid; gap: 8px; margin: 12px 0 0; padding: 0; list-style: none; max-height: 170px; overflow: auto; }
.upload-list li { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 7px 9px; border: 1px solid var(--border); border-radius: 4px; color: var(--muted); }
.upload-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text); }
.upload-list small { white-space: nowrap; font-size: 11px; }
.dialog-error { margin: 16px 0 0; padding: 11px 13px; border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent); border-radius: 4px; color: var(--danger); background: color-mix(in srgb, var(--danger) 7%, transparent); font-size: 13px; overflow-wrap: anywhere; }
.dialog-footer { flex-shrink: 0; display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 14px 22px; border-top: 1px solid var(--border); background: var(--surface); }
.spinning { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 850px) { .dialog-layout { display: block; overflow: auto; } .add-form-pane { overflow: visible; } }
@media (max-width: 520px) { .dialog-heading { padding: 16px 20px; } .dialog-footer { padding: 12px 20px; } }
@media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
</style>
