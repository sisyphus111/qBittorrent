<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, CheckCheck, ChevronDown, FolderInput, LoaderCircle, Pause, Play, Plus, RotateCw, Tag, Trash2, X } from 'lucide-vue-next';
import { apiGet, apiPost } from '../api';
import type { Torrent } from '../types';
import TorrentDetails from './TorrentDetails.vue';

const props = defineProps<{ torrents: Torrent[]; loading: boolean }>();
const emit = defineEmits<{ refresh: []; add: [] }>();
type SortKey = 'name' | 'progress' | 'size' | 'dlspeed' | 'upspeed' | 'eta' | 'ratio' | 'added_on';
type DialogKind = 'delete' | 'location' | 'category' | 'recheck';
const sortKey = ref<SortKey>('added_on');
const descending = ref(true);
const selected = ref(new Set<string>());
const focusedHash = ref('');
const anchorHash = ref('');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const actionDialog = ref<HTMLDialogElement | null>(null);
const moreActions = ref<HTMLDetailsElement | null>(null);
const dialogKind = ref<DialogKind>('delete');
const dialogHashes = ref<string[]>([]);
const dialogValue = ref('');
const dialogError = ref('');
const deleteFiles = ref(false);
const categoryNames = ref<string[]>([]);
const valueInput = ref<HTMLInputElement | null>(null);
const selectionSummary = ref<HTMLDivElement | null>(null);
const tableScroll = ref<HTMLDivElement | null>(null);
const detailContainer = ref<HTMLDivElement | null>(null);
let dialogReturnFocus: HTMLElement | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

const columns = [
    { id: 'name', label: '名称', min: 180, width: 280, sort: 'name', icon: ArrowUpDown },
    { id: 'progress', label: '进度', min: 80, width: 110, sort: 'progress', icon: ArrowUpDown },
    { id: 'state', label: '状态', min: 80, width: 96, sort: undefined, icon: undefined },
    { id: 'size', label: '大小', min: 72, width: 90, sort: 'size', icon: ArrowUpDown },
    { id: 'dlspeed', label: '下载', min: 84, width: 96, sort: 'dlspeed', icon: ArrowDown },
    { id: 'upspeed', label: '上传', min: 84, width: 96, sort: 'upspeed', icon: ArrowUp },
    { id: 'eta', label: '剩余时间', min: 96, width: 108, sort: 'eta', icon: ArrowUpDown },
    { id: 'ratio', label: '分享率', min: 80, width: 84, sort: 'ratio', icon: ArrowUpDown },
] as const;
const columnStorageKey = 'qbt-torrent-column-widths-v1';
const savedWidths = ref<Record<string, number>>({});
const viewportWidth = ref(0);
const resizing = ref(false);
const widths = computed(() => columns.map(column => savedWidths.value[column.id]
    ?? (column.id === 'name' ? Math.max(280, Math.min(2000, viewportWidth.value - 40 - columns.slice(1).reduce((sum, item) => sum + item.width, 0))) : column.width)));
const tableWidth = computed(() => 40 + widths.value.reduce((sum, width) => sum + width, 0));
let resizeObserver: ResizeObserver | undefined;
let drag: { index: number; x: number; scroll: number; widths: number[]; saved: Record<string, number>; element: HTMLElement; pointerId: number } | undefined;
try {
    const stored = JSON.parse(localStorage.getItem(columnStorageKey) || '{}');
    for (const column of columns) {
        const width = stored?.[column.id];
        if (typeof width === 'number' && Number.isFinite(width)) savedWidths.value[column.id] = Math.max(column.min, Math.min(2000, width));
    }
} catch { /* Use default column widths if local preferences are unavailable. */ }
const persistWidths = () => {
    try { localStorage.setItem(columnStorageKey, JSON.stringify(savedWidths.value)); } catch { /* Resizing still works without storage. */ }
};
const setColumnWidth = (index: number, width: number, baseline = widths.value) => {
    const next = [...baseline];
    next[index] = Math.round(Math.max(columns[index].min, Math.min(2000, width)));
    // Let the neighbouring column absorb the change until it reaches its minimum.
    // Wider layouts then scroll horizontally instead of squeezing other content.
    if (index + 1 < columns.length) next[index + 1] = Math.min(2000, Math.max(columns[index + 1].min, baseline[index + 1] - (next[index] - baseline[index])));
    savedWidths.value = Object.fromEntries(columns.map((column, i) => [column.id, next[i]]));
};
const finishResize = (cancel = false) => {
    if (!drag) return;
    const previous = drag;
    drag = undefined;
    resizing.value = false;
    document.documentElement.classList.remove('qbt-column-resizing');
    if (cancel) savedWidths.value = previous.saved;
    else persistWidths();
    if (previous.element.hasPointerCapture(previous.pointerId)) previous.element.releasePointerCapture(previous.pointerId);
};
const startResize = (index: number, event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary) return;
    finishResize();
    const element = event.currentTarget as HTMLElement;
    drag = { index, x: event.clientX, scroll: tableScroll.value?.scrollLeft || 0, widths: [...widths.value], saved: { ...savedWidths.value }, element, pointerId: event.pointerId };
    element.setPointerCapture(event.pointerId);
    resizing.value = true;
    document.documentElement.classList.add('qbt-column-resizing');
};
const moveResize = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const delta = event.clientX - drag.x + (tableScroll.value?.scrollLeft || 0) - drag.scroll;
    setColumnWidth(drag.index, drag.widths[drag.index] + delta, drag.widths);
};
const resetWidths = () => { finishResize(true); savedWidths.value = {}; persistWidths(); };
const resizeKey = (index: number, event: KeyboardEvent) => {
    if (event.key === 'Escape') { finishResize(true); return; }
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 8;
    setColumnWidth(index, event.key === 'Home' ? columns[index].min : widths.value[index] + (event.key === 'ArrowRight' ? step : -step));
    persistWidths();
};
const cancelResize = (event: KeyboardEvent) => { if (event.key === 'Escape') finishResize(true); };
watch(tableScroll, (element) => {
    resizeObserver?.disconnect();
    if (!element) return;
    viewportWidth.value = element.clientWidth;
    resizeObserver = new ResizeObserver(() => { viewportWidth.value = element.clientWidth; });
    resizeObserver.observe(element);
});

// Preserve row positions during live updates. Reorder only when the user sorts
// or the filtered membership changes; speed/progress ticks must not move rows.
const orderedHashes = ref<string[]>([]);
watch([() => props.torrents.map(torrent => torrent.hash).join('|'), sortKey, descending], () => {
    orderedHashes.value = [...props.torrents].sort((left, right) => {
        const a = left[sortKey.value];
        const b = right[sortKey.value];
        const result = typeof a === 'string' && typeof b === 'string'
            ? a.localeCompare(b, 'zh-CN', { numeric: true }) : Number(a) - Number(b);
        return (descending.value ? -result : result) || left.hash.localeCompare(right.hash);
    }).map(torrent => torrent.hash);
}, { immediate: true });
const sortedTorrents = computed(() => {
    const byHash = new Map(props.torrents.map(torrent => [torrent.hash, torrent]));
    return orderedHashes.value.flatMap(hash => byHash.has(hash) ? [byHash.get(hash)!] : []);
});
const allSelected = computed(() => props.torrents.length > 0 && props.torrents.every(torrent => selected.value.has(torrent.hash)));
const someSelected = computed(() => selected.value.size > 0 && !allSelected.value);
const detailTorrent = computed(() => props.torrents.find(torrent => torrent.hash === focusedHash.value && selected.value.has(torrent.hash))
    ?? props.torrents.find(torrent => selected.value.has(torrent.hash)) ?? null);
const actionsDisabled = computed(() => !selected.value.size || busy.value);
const dialogTitle = computed(() => ({ delete: '移除下载任务', location: '更改保存目录', category: '设置分类', recheck: '重新校验文件' })[dialogKind.value]);

const formatBytes = (value: number, decimals = 1) => {
    if (!Number.isFinite(value) || value < 0) return '—';
    if (value < 1024) return `${Math.round(value)} B`;
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
    return `${(value / 1024 ** index).toFixed(decimals)} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][index]}`;
};
const formatEta = (seconds: number) => {
    if (seconds < 0 || seconds >= 8640000) return '—';
    if (seconds === 0) return '完成';
    if (seconds < 60) return '< 1 分钟';
    if (seconds < 3600) return `${Math.ceil(seconds / 60)} 分钟`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分`;
    return `${Math.floor(seconds / 86400)} 天 ${Math.floor(seconds % 86400 / 3600)} 小时`;
};
const progress = (value: number) => Math.min(100, Math.max(0, Number.isFinite(value) ? value * 100 : 0));
const statusLabels: Record<string, string> = {
    downloading: '下载中', forcedDL: '强制下载', metaDL: '获取元数据', forcedMetaDL: '获取元数据',
    uploading: '做种中', forcedUP: '强制做种', stalledUP: '等待上传', stalledDL: '等待连接',
    stoppedDL: '已暂停', stoppedUP: '已暂停', pausedDL: '已暂停', pausedUP: '已暂停',
    queuedDL: '等待下载', queuedUP: '等待做种', checkingDL: '校验中', checkingUP: '校验中',
    checkingResumeData: '恢复任务', moving: '移动文件', error: '错误', missingFiles: '文件缺失', unknown: '未知状态',
};
const statusTone = (torrent: Torrent) => {
    if (['error', 'missingFiles'].includes(torrent.state)) return 'error';
    if (/^(stopped|paused)/.test(torrent.state)) return 'muted';
    if (['uploading', 'forcedUP', 'stalledUP'].includes(torrent.state)) return 'success';
    return 'active';
};
const changeSort = (key: SortKey) => {
    if (sortKey.value === key) descending.value = !descending.value;
    else { sortKey.value = key; descending.value = key !== 'name'; }
};
const toggleSelection = (hash: string, force?: boolean) => {
    const next = new Set(selected.value);
    const checked = force ?? !next.has(hash);
    if (checked) next.add(hash);
    else next.delete(hash);
    selected.value = next;
    if (checked) focusedHash.value = hash;
    anchorHash.value = hash;
};
const selectRow = (torrent: Torrent, event: MouseEvent | KeyboardEvent) => {
    if (event.shiftKey && anchorHash.value) {
        const list = sortedTorrents.value;
        const start = list.findIndex(item => item.hash === anchorHash.value);
        const end = list.findIndex(item => item.hash === torrent.hash);
        if (start >= 0 && end >= 0) {
            const next = new Set(event.ctrlKey || event.metaKey ? selected.value : []);
            for (const item of list.slice(Math.min(start, end), Math.max(start, end) + 1)) next.add(item.hash);
            selected.value = next;
            focusedHash.value = torrent.hash;
            return;
        }
    }
    if (event.ctrlKey || event.metaKey) toggleSelection(torrent.hash);
    else { selected.value = new Set([torrent.hash]); focusedHash.value = torrent.hash; anchorHash.value = torrent.hash; }
};
const toggleAll = () => {
    selected.value = allSelected.value ? new Set() : new Set(props.torrents.map(torrent => torrent.hash));
    focusedHash.value = selected.value.values().next().value ?? '';
};
const clearSelection = async () => {
    selected.value = new Set();
    focusedHash.value = '';
    await nextTick();
    selectionSummary.value?.focus();
};
const announce = (message: string) => {
    notice.value = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.value = ''; }, 5000);
};
const runAction = async (endpoint: string, message: string) => {
    if (actionsDisabled.value) return;
    const hashes = [...selected.value];
    error.value = '';
    busy.value = true;
    try {
        await apiPost(`torrents/${endpoint}`, { hashes: hashes.join('|') });
        announce(`已${message} ${hashes.length} 个任务`);
        emit('refresh');
    }
    catch (reason) { error.value = reason instanceof Error ? reason.message : '操作失败，请稍后重试。'; }
    finally { busy.value = false; }
};
const openDialog = async (kind: DialogKind) => {
    if (actionsDisabled.value) return;
    dialogReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialogReturnFocus && moreActions.value?.contains(dialogReturnFocus)) {
        dialogReturnFocus = moreActions.value.querySelector('summary');
    }
    if (moreActions.value) moreActions.value.open = false;
    dialogKind.value = kind;
    dialogHashes.value = [...selected.value];
    dialogError.value = '';
    deleteFiles.value = false;
    dialogValue.value = kind === 'location' ? detailTorrent.value?.save_path ?? '' : kind === 'category' ? detailTorrent.value?.category ?? '' : '';
    await nextTick();
    actionDialog.value?.showModal();
    if (kind === 'location' || kind === 'category') valueInput.value?.focus();
    if (kind === 'category') {
        try { categoryNames.value = Object.keys(await apiGet<Record<string, unknown>>('torrents/categories')); }
        catch { categoryNames.value = [...new Set(props.torrents.map(torrent => torrent.category).filter(Boolean))]; }
    }
};
const closeDialog = () => { if (!busy.value) actionDialog.value?.close(); };
const restoreActionFocus = async () => {
    await nextTick();
    if (dialogReturnFocus?.isConnected && !dialogReturnFocus.matches(':disabled')) dialogReturnFocus.focus();
    else selectionSummary.value?.focus();
    dialogReturnFocus = null;
};
const submitDialog = async () => {
    if (busy.value) return;
    if (dialogKind.value === 'location' && !dialogValue.value.trim()) {
        dialogError.value = '请输入服务器上的保存目录。';
        return;
    }
    busy.value = true;
    dialogError.value = '';
    const hashes = dialogHashes.value.join('|');
    try {
        if (dialogKind.value === 'delete') {
            await apiPost('torrents/delete', { hashes, deleteFiles: deleteFiles.value });
            const remaining = new Set(selected.value);
            for (const hash of dialogHashes.value) remaining.delete(hash);
            selected.value = remaining;
            announce(`已移除 ${dialogHashes.value.length} 个任务`);
        }
        else if (dialogKind.value === 'location') {
            await apiPost('torrents/setLocation', { hashes, location: dialogValue.value.trim() });
            announce('已提交保存目录变更');
        }
        else if (dialogKind.value === 'category') {
            const category = dialogValue.value.trim();
            if (category) {
                const categories = await apiGet<Record<string, unknown>>('torrents/categories');
                if (!Object.hasOwn(categories, category)) await apiPost('torrents/createCategory', { category });
            }
            await apiPost('torrents/setCategory', { hashes, category });
            announce(category ? `已移入「${category}」分类` : '已清除任务分类');
        }
        else {
            await apiPost('torrents/recheck', { hashes });
            announce('已开始重新校验文件');
        }
        actionDialog.value?.close();
        emit('refresh');
    }
    catch (reason) { dialogError.value = reason instanceof Error ? reason.message : '操作失败，请稍后重试。'; }
    finally { busy.value = false; }
};

watch(() => props.torrents.map(torrent => torrent.hash), (hashes) => {
    const visible = new Set(hashes);
    selected.value = new Set([...selected.value].filter(hash => visible.has(hash)));
    if (!visible.has(focusedHash.value)) focusedHash.value = '';
});
watch(() => detailTorrent.value?.hash, async (hash) => {
    if (!hash) return;
    await nextTick();
    const scroller = tableScroll.value;
    const row = scroller?.querySelector<HTMLElement>(`[data-torrent-hash="${hash}"]`);
    if (scroller && row) {
        const viewport = scroller.getBoundingClientRect();
        const bounds = row.getBoundingClientRect();
        const headerHeight = scroller.querySelector('thead')?.getBoundingClientRect().height ?? 0;
        if (bounds.top < viewport.top + headerHeight) scroller.scrollTop += bounds.top - viewport.top - headerHeight;
        else if (bounds.bottom > viewport.bottom) scroller.scrollTop += bounds.bottom - viewport.bottom;
    }
    detailContainer.value?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});
const closeMoreActions = (event: MouseEvent) => {
    if (moreActions.value && !moreActions.value.contains(event.target as Node)) moreActions.value.open = false;
};
const closeMoreOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && moreActions.value?.open && !actionDialog.value?.open) {
        moreActions.value.open = false;
        moreActions.value.querySelector('summary')?.focus();
    }
};
onMounted(() => {
    document.addEventListener('click', closeMoreActions);
    document.addEventListener('keydown', closeMoreOnEscape);
    document.addEventListener('keydown', cancelResize);
});
onBeforeUnmount(() => {
    finishResize(true);
    resizeObserver?.disconnect();
    clearTimeout(noticeTimer);
    actionDialog.value?.close();
    document.removeEventListener('click', closeMoreActions);
    document.removeEventListener('keydown', closeMoreOnEscape);
    document.removeEventListener('keydown', cancelResize);
});
</script>

<template>
    <section class="download-workspace" :class="{ 'has-details': detailTorrent }" aria-label="下载任务">
        <div class="workspace-toolbar">
            <div ref="selectionSummary" class="selection-summary" tabindex="-1">
                <span class="task-count">{{ selected.size ? `已选择 ${selected.size} 项` : `${torrents.length} 个任务` }}</span>
                <button v-if="selected.size" class="icon-button" aria-label="取消选择" @click="clearSelection"><X :size="15" /></button>
            </div>
            <div class="workspace-actions" aria-label="任务操作">
                <button class="button ghost" :disabled="actionsDisabled" @click="runAction('start', '开始')"><Play :size="15" /><span>开始</span></button>
                <button class="button ghost" :disabled="actionsDisabled" @click="runAction('stop', '暂停')"><Pause :size="15" /><span>暂停</span></button>
                <button class="button ghost action-delete" :disabled="actionsDisabled" @click="openDialog('delete')"><Trash2 :size="15" /><span>移除</span></button>
                <details ref="moreActions" class="more-actions">
                    <summary class="button ghost" aria-label="更多任务操作">更多<ChevronDown :size="14" /></summary>
                    <div class="action-menu">
                        <button :disabled="actionsDisabled" @click="openDialog('recheck')"><CheckCheck :size="16" />重新校验</button>
                        <button :disabled="actionsDisabled" @click="openDialog('location')"><FolderInput :size="16" />更改保存目录</button>
                        <button :disabled="actionsDisabled" @click="openDialog('category')"><Tag :size="16" />设置分类</button>
                    </div>
                </details>
            </div>
        </div>
        <div v-if="error" class="workspace-message error-message" role="alert"><span>{{ error }}</span><button class="icon-button" aria-label="关闭错误提示" @click="error = ''"><X :size="16" /></button></div>
        <div v-if="notice" class="workspace-message success-message" role="status"><Check :size="16" />{{ notice }}</div>
        <div v-if="loading && !torrents.length" class="workspace-empty" role="status"><LoaderCircle :size="32" class="spinning" /><h3>加载中</h3></div>
        <div v-else-if="!torrents.length" class="workspace-empty">

            <h3>暂无任务</h3>
            <button class="button primary" @click="emit('add')"><Plus :size="17" />添加下载任务</button>
        </div>
        <div v-else ref="tableScroll" class="torrent-table-scroll">
            <table class="torrent-table" :class="{ resizing }" :style="{ width: `${tableWidth}px` }">
                <colgroup><col style="width: 40px"><col v-for="(column, index) in columns" :key="column.id" :style="{ width: `${widths[index]}px` }"></colgroup>
                <thead><tr>
                    <th class="select-cell"><input type="checkbox" :checked="allSelected" :indeterminate="someSelected" aria-label="选择所有当前任务" @change="toggleAll"></th>
                    <th v-for="(column, index) in columns" :key="column.id" :data-column="column.id" :aria-sort="column.sort ? (sortKey === column.sort ? descending ? 'descending' : 'ascending' : 'none') : undefined">
                        <button v-if="column.sort" class="column-sort" type="button" @click="changeSort(column.sort)">{{ column.label }}<component :is="column.icon" :size="12" /></button>
                        <span v-else>{{ column.label }}</span>
                        <span class="column-resizer" role="separator" aria-orientation="vertical" :aria-label="`${column.label}列宽`" :aria-valuemin="column.min" :aria-valuemax="2000" :aria-valuenow="widths[index]" tabindex="0" title="拖动调整列宽，双击恢复默认" @pointerdown.stop.prevent="startResize(index, $event)" @pointermove="moveResize" @pointerup="finishResize()" @pointercancel="finishResize(true)" @lostpointercapture="finishResize()" @click.stop.prevent @dblclick.stop.prevent="resetWidths" @keydown.stop="resizeKey(index, $event)"></span>
                    </th>
                </tr></thead>
                <tbody>
                    <tr v-for="torrent in sortedTorrents" :key="torrent.hash" :data-torrent-hash="torrent.hash" :class="{ selected: selected.has(torrent.hash) }" tabindex="0" :aria-selected="selected.has(torrent.hash)" @click="selectRow(torrent, $event)" @keydown.enter.self.prevent="selectRow(torrent, $event)" @keydown.space.self.prevent="selectRow(torrent, $event)">
                        <td class="select-cell" @click.stop><input type="checkbox" :checked="selected.has(torrent.hash)" :aria-label="`选择 ${torrent.name}`" @change="toggleSelection(torrent.hash)"></td>
                        <td class="name-cell"><div class="torrent-name"><div><strong :title="torrent.name">{{ torrent.name }}</strong><small v-if="torrent.category || torrent.tags">{{ torrent.category }}<span v-if="torrent.tags"> · {{ torrent.tags }}</span></small></div></div></td>
                        <td><div class="progress-value">{{ progress(torrent.progress).toFixed(1) }}<span>%</span></div><div class="torrent-progress" :class="statusTone(torrent)" role="progressbar" :aria-valuenow="Math.round(progress(torrent.progress))" aria-valuemin="0" aria-valuemax="100" :aria-label="`${torrent.name} 下载进度`"><span :style="{ width: `${progress(torrent.progress)}%` }"></span></div></td>
                        <td class="status-cell"><span class="status-badge" :class="statusTone(torrent)">{{ statusLabels[torrent.state] ?? torrent.state }}</span></td>
                        <td class="numeric-cell">{{ formatBytes(torrent.size) }}</td>
                        <td class="numeric-cell" :class="{ 'download-speed': torrent.dlspeed > 0 }">{{ torrent.dlspeed ? `${formatBytes(torrent.dlspeed)}/s` : '—' }}</td>
                        <td class="numeric-cell" :class="{ 'upload-speed': torrent.upspeed > 0 }">{{ torrent.upspeed ? `${formatBytes(torrent.upspeed)}/s` : '—' }}</td>
                        <td class="numeric-cell">{{ torrent.progress >= 1 ? '—' : formatEta(torrent.eta) }}</td>
                        <td class="numeric-cell ratio-cell">{{ torrent.ratio < 0 ? '∞' : torrent.ratio.toFixed(2) }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <div v-if="detailTorrent" ref="detailContainer" class="detail-container"><button class="icon-button detail-close" aria-label="关闭任务详情" title="关闭详情" @click="clearSelection"><X :size="17" /></button><TorrentDetails :torrent="detailTorrent" @refresh="emit('refresh')" /></div>
    </section>

    <dialog ref="actionDialog" class="modal action-dialog" aria-labelledby="torrent-action-title" @cancel.prevent="closeDialog" @close="restoreActionFocus">
        <form @submit.prevent="submitDialog">
            <header><div class="action-dialog-icon" :class="{ destructive: dialogKind === 'delete' }"><Trash2 v-if="dialogKind === 'delete'" :size="22" /><FolderInput v-else-if="dialogKind === 'location'" :size="22" /><Tag v-else-if="dialogKind === 'category'" :size="22" /><RotateCw v-else :size="22" /></div><div><h2 id="torrent-action-title">{{ dialogTitle }}</h2><p>已选择 {{ dialogHashes.length }} 个任务</p></div><button type="button" class="icon-button" aria-label="关闭" :disabled="busy" @click="closeDialog"><X :size="20" /></button></header>
            <div class="action-dialog-body">
                <template v-if="dialogKind === 'delete'"><label class="delete-files-option"><input v-model="deleteFiles" type="checkbox" :disabled="busy"><span>同时删除已下载的文件</span></label><p v-if="deleteFiles" class="delete-warning">文件将永久删除。</p><small v-else>保留本地文件</small></template>
                <label v-else-if="dialogKind === 'location'" class="field"><span>新的保存目录</span><input ref="valueInput" v-model="dialogValue" class="input" type="text" required :disabled="busy" autocomplete="off"><small>现有文件将一并移动。</small></label>
                <label v-else-if="dialogKind === 'category'" class="field"><span>分类名称</span><input ref="valueInput" v-model="dialogValue" class="input" type="text" list="torrent-categories" placeholder="留空以清除分类" :disabled="busy" autocomplete="off"><datalist id="torrent-categories"><option v-for="name in categoryNames" :key="name" :value="name"></option></datalist></label>
                <p v-else>重新校验所选任务？</p>
                <p v-if="dialogError" class="dialog-error" role="alert">{{ dialogError }}</p>
            </div>
            <footer><button type="button" class="button ghost" :disabled="busy" @click="closeDialog">取消</button><button type="submit" class="button" :class="dialogKind === 'delete' ? 'danger' : 'primary'" :disabled="busy"><LoaderCircle v-if="busy" :size="16" class="spinning" />{{ busy ? '处理中' : dialogKind === 'delete' ? '确认移除' : '确认' }}</button></footer>
        </form>
    </dialog>
</template>

<style scoped>
.download-workspace { display: flex; flex-direction: column; min-width: 0; min-height: 0; flex: 1; overflow: hidden; background: var(--surface); border: 0; border-radius: 0; }
.workspace-toolbar { display: flex; align-items: center; gap: 15px; min-height: 40px; padding: 4px 12px; border-bottom: 1px solid var(--border); }
.selection-summary { display: flex; align-items: center; gap: 4px; min-width: 88px; }
.task-count { color: var(--muted); font-size: 12px; white-space: nowrap; }
.workspace-actions { display: flex; align-items: center; gap: 5px; }
.workspace-actions { border-left: 1px solid var(--border); padding-left: 12px; }
.workspace-actions .button { padding: 4px 8px; font-size: 12px; }
.action-delete:not(:disabled):hover { color: var(--danger); }
.more-actions { position: relative; }
.more-actions summary { list-style: none; }
.more-actions summary::-webkit-details-marker { display: none; }
.action-menu { position: absolute; z-index: 15; top: calc(100% + 8px); left: 0; min-width: 170px; padding: 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); box-shadow: var(--shadow); }
.action-menu button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px; border: 0; border-radius: 4px; background: transparent; color: var(--text); font: inherit; font-size: 12px; cursor: pointer; text-align: left; }
.action-menu button:not(:disabled):hover { color: var(--accent); background: var(--accent-soft); }
.action-menu button:disabled { opacity: .4; cursor: default; }
.workspace-message { display: flex; align-items: center; gap: 8px; padding: 10px 18px; font-size: 12px; }
.workspace-message > span { flex: 1; }
.error-message { color: var(--danger); background: color-mix(in srgb, var(--danger) 7%, var(--surface)); }
.success-message { color: var(--success); background: color-mix(in srgb, var(--success) 7%, var(--surface)); }
.workspace-empty { display: flex; flex: 1; min-height: 330px; align-items: center; justify-content: center; flex-direction: column; gap: 15px; padding: 36px 24px; text-align: center; color: var(--muted); }
.workspace-empty h3 { margin: 0; font-size: 19px; font-weight: 600; letter-spacing: -.3px; color: var(--text); }
.workspace-empty p { margin: 0 0 6px; font-size: 13px; line-height: 1.9; }
.torrent-table-scroll { flex: 1; min-height: 0; overflow: auto; }
.has-details .torrent-table-scroll { min-height: 120px; }
.torrent-table { border-collapse: collapse; table-layout: fixed; text-align: left; }
.torrent-table thead { position: sticky; top: 0; z-index: 2; background: var(--surface-2); }
.torrent-table th { position: relative; padding: 7px 14px 7px 10px; border-bottom: 1px solid var(--border); color: var(--muted); font-size: 11px; font-weight: 500; white-space: nowrap; }
.torrent-table th button { max-width: 100%; overflow: hidden; display: inline-flex; align-items: center; gap: 6px; padding: 0; background: none; border: 0; color: inherit; font: inherit; cursor: pointer; }
.torrent-table th[aria-sort="ascending"] button, .torrent-table th[aria-sort="descending"] button { color: var(--accent); }
.torrent-table td { padding: 7px 10px; border-bottom: 1px solid var(--border-subtle); font-size: 12px; vertical-align: middle; }
.column-resizer { position: absolute; z-index: 3; top: 0; right: -4px; bottom: 0; width: 9px; cursor: col-resize; touch-action: none; }
.column-resizer::after { content: ''; position: absolute; width: 1px; top: 7px; bottom: 7px; left: 4px; background: var(--border-input); opacity: .6; }
.column-resizer:hover::after, .column-resizer:focus-visible::after { background: var(--accent); opacity: 1; width: 2px; }
.torrent-table th:last-child .column-resizer { right: 0; }
:global(html.qbt-column-resizing), :global(html.qbt-column-resizing *) { cursor: col-resize !important; user-select: none !important; }
.torrent-table tbody tr { cursor: pointer; outline-offset: -3px; }
.torrent-table tbody tr:nth-child(even) { background: var(--row-stripe); }
.torrent-table tbody tr:hover { background: var(--row-hover); }
.torrent-table tbody tr.selected { background: var(--accent-soft); }
.torrent-table tbody tr.selected td:first-child { box-shadow: inset 3px 0 var(--accent); }
.torrent-table .select-cell { padding-left: 14px; padding-right: 4px; }
.select-cell input { display: block; width: 15px; height: 15px; accent-color: var(--accent); cursor: pointer; }
.torrent-table td { overflow: hidden; text-overflow: ellipsis; }
.torrent-name { display: flex; align-items: center; gap: 12px; min-width: 0; }
.torrent-name > div { width: 100%; min-width: 0; }
.torrent-name strong { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; color: var(--text); }
.torrent-name small { display: block; margin-top: 5px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 10px; }
.progress-value { font-size: 11px; color: var(--text); font-variant-numeric: tabular-nums; }
.progress-value > span { padding-left: 2px; color: var(--muted); }
.torrent-progress { width: min(92px, 100%); height: 2px; margin-top: 3px; overflow: hidden; border-radius: 5px; background: color-mix(in srgb, var(--accent) 13%, var(--surface-2)); }
.torrent-progress > span { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width .25s ease; }
.torrent-progress.success > span { background: var(--success); }
.torrent-progress.error > span { background: var(--danger); }
.torrent-progress.muted > span { background: var(--muted); }
.status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 0; border-radius: 4px; white-space: nowrap; color: var(--accent); background: transparent; font-size: 10px; }
.status-badge > i { width: 4px; height: 4px; border-radius: 50%; background: currentColor; }
.status-badge.success { color: var(--success); background: transparent; }
.status-badge.error { color: var(--danger); background: transparent; }
.status-badge.muted { color: var(--muted); background: transparent; }
.numeric-cell { white-space: nowrap; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.numeric-cell.download-speed { color: var(--accent); }
.numeric-cell.upload-speed { color: var(--success); }
.detail-container { position: relative; flex: 0 0 38%; max-height: 45%; min-height: 180px; overflow: auto; border-top: 1px solid var(--border); }
.detail-container :deep(.torrent-details) { border: 0; border-radius: 0; }
.detail-container :deep(.details-heading) { padding-right: 62px; }
.detail-close { position: absolute; z-index: 3; top: 12px; right: 14px; }
.action-dialog { width: min(490px, calc(100vw - 32px)); max-height: calc(100dvh - 40px); margin: auto; padding: 0; overflow: auto; background: var(--surface); color: var(--text); border: 0; border-radius: 0; }
.action-dialog::backdrop { background: var(--dialog-backdrop); }
.action-dialog header { display: flex; align-items: center; gap: 13px; padding: 24px 24px 0; }
.action-dialog header > .icon-button { margin-left: auto; align-self: flex-start; }
.action-dialog-icon { display: grid; place-items: center; width: 46px; height: 46px; flex-shrink: 0; border-radius: 4px; background: var(--accent-soft); color: var(--accent); }
.action-dialog-icon.destructive { background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--danger); }
.action-dialog h2 { font-size: 18px; margin: 0 0 4px; }
.action-dialog header p { color: var(--muted); font-size: 12px; margin: 0; }
.action-dialog-body { display: grid; gap: 14px; padding: 24px; font-size: 13px; }
.action-dialog-body p { margin: 0; line-height: 1.7; }
.action-dialog-body small { color: var(--muted); font-size: 12px; line-height: 1.6; }
.delete-files-option { display: flex; align-items: center; gap: 8px; padding: 12px; border: 1px solid var(--border); border-radius: 4px; }
.delete-files-option input { width: 16px; height: 16px; accent-color: var(--danger); }
.delete-warning, .dialog-error { color: var(--danger); }
.dialog-error { padding: 10px 12px; border-radius: 4px; background: color-mix(in srgb, var(--danger) 8%, transparent); overflow-wrap: anywhere; }
.action-dialog footer { display: flex; justify-content: flex-end; gap: 9px; padding: 16px 24px; border-top: 1px solid var(--border); }
.spinning { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 1100px) { .workspace-toolbar { gap: 9px; padding-inline: 12px; } .workspace-actions { gap: 1px; padding-left: 7px; } .workspace-actions .button { padding-inline: 7px; } }
@media (max-width: 720px) { .workspace-toolbar { flex-wrap: wrap; gap: 4px; } .selection-summary { flex: 1; } .workspace-actions { border: 0; padding: 0; } .workspace-actions .button { padding: 4px 7px; } .download-workspace { border-radius: 0; } .workspace-empty { min-height: 300px; } .detail-container { max-height: 55vh; } }
@media (prefers-reduced-motion: reduce) { .spinning { animation: none; } .torrent-progress > span { transition: none; } }
</style>
