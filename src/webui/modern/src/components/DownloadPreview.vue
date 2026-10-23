<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { File, FolderOpen, LoaderCircle } from 'lucide-vue-next';
import { apiPost, apiUpload } from '../api';
import { bytes } from '../format';
import { isInfoHash, isTorrentSource } from '../torrentSource';
import { buildDownloadTree, downloadDestination } from '../downloadTree';
import type { DownloadNode } from '../downloadTree';
import DownloadTreeNode from './DownloadTreeNode.vue';

interface Metadata {
    info?: { name: string; files: { path: string; length: number; priority?: number }[] };
}
interface Entry {
    source: string;
    label: string;
    metadata?: Metadata;
    state: 'idle' | 'loading' | 'ready' | 'error' | 'waiting';
    error?: string;
}
const props = defineProps<{ files: File[]; links: string; savePath: string }>();
const entries = ref<Entry[]>([]);
const loading = computed(() => entries.value.some(entry => entry.state === 'loading'));
const readyFiles = computed(() => entries.value.flatMap(entry => entry.state === 'ready' ? entry.metadata?.info?.files || [] : []));
const tree = computed(() => buildDownloadTree(readyFiles.value));
const unresolved = computed(() => entries.value.filter(entry => entry.state !== 'ready'));
const wanted = computed(() => readyFiles.value.filter(file => file.priority !== 0));
const selectedId = ref('');
const visibleRoots = ref(100);
const selectedNode = computed(() => {
    let selected: DownloadNode | undefined;
    let firstFile: DownloadNode | undefined;
    const visit = (nodes: DownloadNode[]) => {
        for (const node of nodes) {
            if (node.id === selectedId.value) selected = node;
            if (!node.directory && !node.skipped && !firstFile) firstFile = node;
            if (node.directory) visit(node.children);
        }
    };
    visit(tree.value);
    return selected || firstFile || tree.value[0];
});
const selectedDestination = computed(() => selectedNode.value ? downloadDestination(props.savePath, selectedNode.value.path) : '');
watch(tree, () => { visibleRoots.value = 100; });
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let controller = new AbortController();
const cache = new Map<string, Metadata>();

const sourceLabel = (source: string, index: number) => {
    if (isInfoHash(source)) return source;
    try {
        const url = new URL(source);
        if (url.protocol === 'magnet:') return url.searchParams.get('dn') || `磁力链接 ${index + 1}`;
        return decodeURIComponent(url.pathname.split('/').at(-1) || url.hostname);
    } catch { return `链接 ${index + 1}`; }
};
const reset = () => {
    generation++;
    clearTimeout(timer);
    controller.abort();
    controller = new AbortController();
};

const readLinks = async (current: number) => {
    if (current !== generation) return;
    const signal = controller.signal;
    const deadline = Date.now() + 60000;
    for (const entry of entries.value) {
        if (entry.state !== 'ready' && isTorrentSource(entry.source)) {
            entry.state = 'loading';
            entry.error = '';
        }
    }
    const poll = async () => {
        const pending = entries.value.filter(entry => entry.state === 'loading');
        let index = 0;
        const worker = async () => {
            while (current === generation && index < pending.length) {
                const entry = pending[index++];
                try {
                    const metadata = await apiPost<Metadata>('torrents/fetchMetadata', { source: entry.source }, signal);
                    if (current !== generation) return;
                    if (metadata.info?.files) {
                        entry.metadata = metadata;
                        entry.state = 'ready';
                        cache.set(entry.source, metadata);
                    }
                } catch (failure) {
                    if (current !== generation) return;
                    entry.state = 'error';
                    entry.error = (failure as Error).message;
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
        if (current !== generation) return;
        if (Date.now() >= deadline) {
            for (const entry of entries.value) if (entry.state === 'loading') entry.state = 'waiting';
        } else if (loading.value) timer = setTimeout(poll, 2000);
    };
    await poll();
};

watch([() => [...props.files], () => props.links.split('\n').map(source => source.trim()).filter(Boolean).join('\n')], async () => {
    reset();
    const current = generation;
    if (!props.files.length) {
        entries.value = [...new Set(props.links.split('\n').map(source => source.trim()).filter(Boolean))]
            .map((source, index) => ({ source, label: sourceLabel(source, index), metadata: cache.get(source), state: cache.has(source) ? 'ready' : 'idle' }));
        if (entries.value.some(entry => entry.state !== 'ready' && isTorrentSource(entry.source))) {
            timer = setTimeout(() => { void readLinks(current); }, 600);
        }
        return;
    }
    entries.value = props.files.map(file => ({ source: '', label: file.name, state: 'loading' }));
    const data = new FormData();
    // Distinct upload names prevent collisions when files share a filename.
    props.files.forEach((file, index) => data.append('file', file, String(index).padStart(8, '0')));
    try {
        const metadata = await apiUpload<Metadata[]>('torrents/parseMetadata', data, controller.signal);
        if (current !== generation) return;
        // The response order is unspecified; use each torrent's own metadata for its label.
        entries.value = metadata.map(item => ({
            source: '', label: item.info?.name || '种子文件', metadata: item,
            state: item.info?.files ? 'ready' : 'error',
            error: item.info?.files ? '' : '未能读取种子文件列表。',
        }));
    } catch (failure) {
        if (current !== generation) return;
        for (const entry of entries.value) {
            entry.state = 'error';
            entry.error = (failure as Error).message;
        }
    }
}, { immediate: true });
onBeforeUnmount(reset);
</script>

<template>
    <section class="download-preview" aria-label="下载目录预览">
        <header class="preview-heading">
            <h3>文件</h3>
            <small v-if="loading" role="status"><LoaderCircle :size="13" class="spin" />读取中</small>
            <small v-else-if="readyFiles.length">{{ wanted.length }} 个文件 · {{ bytes(wanted.reduce((total, file) => total + file.length, 0)) }}</small>
        </header>
        <div class="destination"><FolderOpen :size="17" /><code>{{ savePath || '请先选择保存磁盘' }}</code></div>
        <div class="preview-content">
            <ul v-if="tree.length" class="download-tree" aria-label="文件目录结构">
                <DownloadTreeNode v-for="node in tree.slice(0, visibleRoots)" :key="node.id" :node="node" :root="savePath" :selected-id="selectedNode?.id || ''" @select="selectedId = $event" />
                <li v-if="tree.length > visibleRoots"><button class="button ghost" type="button" @click="visibleRoots += 100">再显示 {{ Math.min(100, tree.length - visibleRoots) }} 项</button></li>
            </ul>
            <p v-if="!entries.length" class="preview-empty">暂无文件</p>
            <div v-for="(entry, index) in unresolved" :key="index" class="preview-pending">
                <div class="pending-label"><LoaderCircle v-if="entry.state === 'loading'" :size="13" class="spin" /><span>{{ entry.label }}</span></div>
                <p v-if="entry.state === 'error'" class="preview-error" role="alert">{{ entry.error }}</p>
                <p v-else-if="entry.state === 'waiting'">未获取到文件信息</p>
                <p v-else-if="entry.state === 'idle' && !isTorrentSource(entry.source)">等待完整输入</p>
            </div>
        </div>
        <div v-if="selectedNode" class="destination-detail">
            <div class="destination-detail-label"><component :is="selectedNode.directory ? FolderOpen : File" :size="14" /><span>完整路径</span></div>
            <code class="full-destination">{{ selectedDestination || '请先选择保存磁盘' }}</code>
            <p v-if="selectedNode.skipped">已被规则排除</p>
            <p v-if="selectedNode.conflict" class="preview-error">多个文件使用同一路径</p>
        </div>
    </section>
</template>

<style scoped>
.download-preview { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; border-left: 1px solid var(--border); background: var(--input-bg); }
.preview-heading { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 12px; padding: 18px 20px 12px; }
.preview-heading h3 { font-size: 13px; font-weight: 500; }
.preview-heading small { display: flex; align-items: center; gap: 6px; }
.destination { flex-shrink: 0; display: flex; align-items: flex-start; gap: 8px; padding: 10px 20px; border-bottom: 1px solid var(--border); }
.destination svg { margin-top: 2px; color: var(--accent); }
.destination code { font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
.preview-content { flex: 1; min-height: 0; overflow: auto; padding: 12px 14px; }
.download-tree { list-style: none; margin: 0 0 0 14px; padding: 0 0 0 10px; border-left: 1px solid var(--border); }
.preview-pending { padding: 12px 6px; }
.preview-pending + .preview-pending { border-top: 1px solid var(--border-subtle); }
.pending-label { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; overflow-wrap: anywhere; }
.pending-label span { min-width: 0; }
.pending-label svg { margin-top: 3px; }
small, p { font-size: 11px; color: var(--muted); }
.preview-pending p { margin-top: 6px; }
.preview-empty { padding: 10px 6px; }
.preview-error { color: var(--danger); }
.destination-detail { flex-shrink: 0; padding: 14px 20px; border-top: 1px solid var(--border); background: var(--surface); max-height: 180px; overflow: auto; }
.destination-detail-label { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); margin-bottom: 8px; }
.full-destination { display: block; font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; user-select: text; }
.destination-detail p { margin-top: 6px; }
@media (max-width: 850px) { .download-preview { height: 420px; border-left: 0; border-top: 1px solid var(--border); } }
</style>
