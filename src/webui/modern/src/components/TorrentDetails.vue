<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { AlertCircle, FileText, Info, ListTree, LoaderCircle, Network, Plus, RefreshCw, Search, Trash2, Users } from 'lucide-vue-next';
import { apiGet, apiPost } from '../api';
import type { Torrent } from '../types';

interface Properties {
    save_path: string;
    download_path: string;
    total_size: number;
    total_downloaded: number;
    total_uploaded: number;
    total_wasted: number;
    dl_speed: number;
    up_speed: number;
    share_ratio: number;
    time_elapsed: number;
    seeding_time: number;
    addition_date: number;
    completion_date: number;
    created_by: string;
    comment: string;
    pieces_have: number;
    pieces_num: number;
    piece_size: number;
    nb_connections: number;
    seeds: number;
    peers: number;
    has_metadata: boolean;
    infohash_v1: string;
    infohash_v2: string;
}

interface TorrentFile {
    index: number;
    name: string;
    size: number;
    progress: number;
    priority: number;
}

interface Tracker {
    url: string;
    status: number;
    updating?: boolean;
    tier: number;
    num_peers: number;
    num_seeds: number;
    num_leeches: number;
    msg: string;
}

interface Peer {
    ip?: string;
    port?: number;
    i2p_dest?: string;
    country?: string;
    client: string;
    connection: string;
    progress: number;
    dl_speed: number;
    up_speed: number;
    downloaded: number;
    uploaded: number;
}

const props = defineProps<{ torrent: Torrent | null }>();
const emit = defineEmits<{ refresh: [] }>();
const tabs = [
    { id: 'overview', label: '概览', icon: Info },
    { id: 'files', label: '文件', icon: ListTree },
    { id: 'trackers', label: 'Trackers', icon: Network },
    { id: 'peers', label: '连接', icon: Users },
] as const;
type DetailTab = typeof tabs[number]['id'];

const activeTab = ref<DetailTab>('overview');
const properties = ref<Properties | null>(null);
const files = ref<TorrentFile[]>([]);
const trackers = ref<Tracker[]>([]);
const peers = ref<Array<Peer & { id: string }>>([]);
const loading = ref(false);
const busy = ref(false);
const loadError = ref('');
const actionError = ref('');
const selectedFiles = ref<number[]>([]);
const fileQuery = ref('');
const batchPriority = ref(1);
const trackerFormOpen = ref(false);
const trackerUrls = ref('');
const trackerToRemove = ref<string | null>(null);
const addTrackerButton = ref<HTMLButtonElement | null>(null);
const trackerTextarea = ref<HTMLTextAreaElement | null>(null);
const removeTrackerCancel = ref<HTMLButtonElement | null>(null);
const priorities = [{ value: 0, label: '不下载' }, { value: 1, label: '正常' }, { value: 6, label: '高' }, { value: 7, label: '最高' }];
const trackerStatus: Record<number, string> = { 0: '未启用', 1: '未联系', 2: '正常', 3: '更新中', 4: '连接错误', 5: 'Tracker 错误', 6: '无法连接' };
let requestVersion = 0;
let selectionVersion = 0;
let requestPending = false;
let removeTrackerTrigger: HTMLButtonElement | null = null;
let pollTimer: ReturnType<typeof setInterval> | undefined;

const visibleFiles = computed(() => {
    const query = fileQuery.value.trim().toLocaleLowerCase();
    return query ? files.value.filter(file => file.name.toLocaleLowerCase().includes(query)) : files.value;
});
const allFilesSelected = computed(() => visibleFiles.value.length > 0 && visibleFiles.value.every(file => selectedFiles.value.includes(file.index)));
const someFilesSelected = computed(() => visibleFiles.value.some(file => selectedFiles.value.includes(file.index)));

const moveTab = (event: KeyboardEvent) => {
    const current = tabs.findIndex(tab => tab.id === activeTab.value);
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    activeTab.value = tabs[next].id;
    void nextTick(() => document.getElementById(`detail-tab-${activeTab.value}`)?.focus());
};

const formatBytes = (value: number | undefined) => {
    if (value === undefined || !Number.isFinite(value) || value < 0)
        return '—';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    const index = value > 0 ? Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1) : 0;
    return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: index === 0 ? 0 : 1 }).format(value / 1024 ** index)} ${units[index]}`;
};
const formatDate = (value: number | undefined) => value && value > 0 ? new Date(value * 1000).toLocaleString('zh-CN', { hour12: false }) : '—';
const formatDuration = (value: number | undefined) => {
    if (value === undefined || value < 0)
        return '—';
    const days = Math.floor(value / 86400);
    const hours = Math.floor(value % 86400 / 3600);
    const minutes = Math.floor(value % 3600 / 60);
    return days > 0 ? `${days} 天 ${hours} 小时` : hours > 0 ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`;
};
const percent = (value: number) => `${Math.max(0, Math.min(100, value * 100)).toFixed(1)}%`;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '请求未完成，请稍后重试。';

const loadDetails = async (showLoader = false) => {
    const hash = props.torrent?.hash;
    if (!hash)
        return;
    const version = ++requestVersion;
    const tab = activeTab.value;
    requestPending = true;
    loading.value = showLoader;
    try {
        const current = () => version === requestVersion && props.torrent?.hash === hash;
        if (tab === 'overview') {
            const data = await apiGet<Properties>('torrents/properties', { hash });
            if (current()) properties.value = data;
        }
        else if (tab === 'files') {
            const data = await apiGet<TorrentFile[]>('torrents/files', { hash });
            if (current()) {
                files.value = data;
                selectedFiles.value = selectedFiles.value.filter(index => data.some(file => file.index === index));
            }
        }
        else if (tab === 'trackers') {
            const data = await apiGet<Tracker[]>('torrents/trackers', { hash });
            if (current()) trackers.value = data;
        }
        else {
            const data = await apiGet<{ peers?: Record<string, Peer> }>('sync/torrentPeers', { hash, rid: 0 });
            if (current()) peers.value = Object.entries(data.peers ?? {}).map(([id, peer]) => ({ ...peer, id }));
        }
        if (current()) loadError.value = '';
    }
    catch (error) {
        if (version === requestVersion) loadError.value = errorMessage(error);
    }
    finally {
        if (version === requestVersion) {
            requestPending = false;
            loading.value = false;
        }
    }
};

watch(() => props.torrent?.hash, () => {
    ++requestVersion;
    ++selectionVersion;
    requestPending = false;
    properties.value = null;
    files.value = [];
    trackers.value = [];
    peers.value = [];
    selectedFiles.value = [];
    fileQuery.value = '';
    trackerUrls.value = '';
    trackerFormOpen.value = false;
    trackerToRemove.value = null;
    removeTrackerTrigger = null;
    actionError.value = '';
    loadError.value = '';
    void loadDetails(true);
}, { immediate: true });
watch(activeTab, () => { void loadDetails(true); });
const resumeDetails = () => { if (!document.hidden && !busy.value) void loadDetails(); };
onMounted(() => {
    document.addEventListener('visibilitychange', resumeDetails);
    window.addEventListener('online', resumeDetails);
    pollTimer = setInterval(() => {
        if (!requestPending && !busy.value && document.visibilityState !== 'hidden')
            void loadDetails();
    }, 5000);
});
onBeforeUnmount(() => {
    ++requestVersion;
    ++selectionVersion;
    clearInterval(pollTimer);
    document.removeEventListener('visibilitychange', resumeDetails);
    window.removeEventListener('online', resumeDetails);
});

const runAction = async (endpoint: string, params: Record<string, string | number>) => {
    const hash = props.torrent?.hash;
    if (!hash || busy.value)
        return false;
    const selection = selectionVersion;
    busy.value = true;
    actionError.value = '';
    try {
        await apiPost(endpoint, params);
        if (selection === selectionVersion && props.torrent?.hash === hash) await loadDetails();
        emit('refresh');
        return true;
    }
    catch (error) {
        if (selection === selectionVersion && props.torrent?.hash === hash) actionError.value = errorMessage(error);
        return false;
    }
    finally {
        busy.value = false;
    }
};

const toggleAllFiles = () => {
    const visible = new Set(visibleFiles.value.map(file => file.index));
    selectedFiles.value = allFilesSelected.value
        ? selectedFiles.value.filter(index => !visible.has(index))
        : [...new Set([...selectedFiles.value, ...visible])];
};
const setPriority = async (indexes: number[], priority: number) => {
    if (props.torrent && indexes.length > 0)
        await runAction('torrents/filePrio', { hash: props.torrent.hash, id: indexes.join('|'), priority });
};
const changeFilePriority = (file: TorrentFile, event: Event) => {
    const select = event.target as HTMLSelectElement;
    const priority = Number(select.value);
    select.value = String(file.priority);
    void setPriority([file.index], priority);
};
const restoreTrackerFocus = async (trigger: HTMLButtonElement | null, selection: number) => {
    await nextTick();
    if (selection !== selectionVersion || activeTab.value !== 'trackers')
        return;
    const target = trigger?.isConnected && !trigger.disabled ? trigger : addTrackerButton.value;
    target?.focus();
};
const closeTrackerForm = () => {
    if (busy.value)
        return;
    trackerFormOpen.value = false;
    void restoreTrackerFocus(addTrackerButton.value, selectionVersion);
};
const toggleTrackerForm = async () => {
    if (busy.value)
        return;
    if (trackerFormOpen.value) {
        closeTrackerForm();
        return;
    }
    const selection = selectionVersion;
    trackerFormOpen.value = true;
    await nextTick();
    if (selection === selectionVersion && activeTab.value === 'trackers' && trackerFormOpen.value)
        trackerTextarea.value?.focus();
};
const closeTrackerRemoval = () => {
    if (busy.value)
        return;
    const trigger = removeTrackerTrigger;
    trackerToRemove.value = null;
    removeTrackerTrigger = null;
    void restoreTrackerFocus(trigger, selectionVersion);
};
const openTrackerRemoval = async (url: string, event: MouseEvent) => {
    if (busy.value)
        return;
    const selection = selectionVersion;
    removeTrackerTrigger = event.currentTarget as HTMLButtonElement;
    trackerToRemove.value = url;
    await nextTick();
    if (selection === selectionVersion && activeTab.value === 'trackers' && trackerToRemove.value === url)
        removeTrackerCancel.value?.focus();
};
const addTrackers = async () => {
    const hash = props.torrent?.hash;
    const selection = selectionVersion;
    const urls = trackerUrls.value.split('\n').map(url => url.trim()).filter(Boolean).join('\n');
    if (!hash || !urls)
        return;
    if (await runAction('torrents/addTrackers', { hash, urls }) && selection === selectionVersion && props.torrent?.hash === hash) {
        trackerUrls.value = '';
        closeTrackerForm();
    }
};
const removeTracker = async () => {
    if (!props.torrent || !trackerToRemove.value)
        return;
    const hash = props.torrent.hash;
    const selection = selectionVersion;
    if (await runAction('torrents/removeTrackers', { hash, urls: encodeURIComponent(trackerToRemove.value) }) && selection === selectionVersion && props.torrent?.hash === hash)
        closeTrackerRemoval();
};
const reannounce = () => {
    if (props.torrent)
        void runAction('torrents/reannounce', { hashes: props.torrent.hash });
};
</script>

<template>
    <section v-if="torrent" class="torrent-details" aria-label="任务详情">
        <header class="details-heading">
            <div class="details-title">
                <span class="details-eyebrow">任务详情</span>
                <h2 :title="torrent.name">{{ torrent.name }}</h2>
            </div>
        </header>
        <div class="details-tabs" role="tablist" aria-label="详情视图">
            <button v-for="tab in tabs" :id="`detail-tab-${tab.id}`" :key="tab.id" class="detail-tab" :class="{ active: activeTab === tab.id }" type="button" role="tab" :aria-selected="activeTab === tab.id" :aria-controls="`detail-panel-${tab.id}`" :tabindex="activeTab === tab.id ? 0 : -1" @click="activeTab = tab.id" @keydown="moveTab">
                <component :is="tab.icon" :size="16" />{{ tab.label }}
            </button>
        </div>

        <div v-if="actionError || loadError" class="details-error" role="alert"><AlertCircle :size="17" /><span>{{ actionError || loadError }}</span></div>
        <div :id="`detail-panel-${activeTab}`" class="details-content" role="tabpanel" :aria-labelledby="`detail-tab-${activeTab}`" :aria-busy="loading">
            <div v-if="loading" class="details-empty"><LoaderCircle :size="22" class="spinning" /><span>加载中</span></div>

            <template v-else-if="activeTab === 'overview' && properties">
                <div v-if="!properties.has_metadata" class="details-note">获取元数据中</div>
                <div class="detail-stats">
                    <div><span>总大小</span><strong>{{ formatBytes(properties.total_size) }}</strong></div>
                    <div><span>已下载</span><strong>{{ formatBytes(properties.total_downloaded) }}</strong></div>
                    <div><span>已上传</span><strong>{{ formatBytes(properties.total_uploaded) }}</strong></div>
                    <div><span>分享率</span><strong>{{ properties.share_ratio < 0 ? '∞' : properties.share_ratio.toFixed(2) }}</strong></div>
                    <div><span>下载速度</span><strong>{{ formatBytes(properties.dl_speed) }}/s</strong></div>
                    <div><span>上传速度</span><strong>{{ formatBytes(properties.up_speed) }}/s</strong></div>
                    <div><span>运行时间</span><strong>{{ formatDuration(properties.time_elapsed) }}</strong></div>
                    <div><span>做种时间</span><strong>{{ formatDuration(properties.seeding_time) }}</strong></div>
                </div>
                <dl class="property-list">
                    <div><dt>保存位置</dt><dd>{{ properties.save_path || '—' }}</dd></div>
                    <div v-if="properties.download_path"><dt>临时目录</dt><dd>{{ properties.download_path }}</dd></div>
                    <div><dt>添加时间</dt><dd>{{ formatDate(properties.addition_date) }}</dd></div>
                    <div><dt>完成时间</dt><dd>{{ formatDate(properties.completion_date) }}</dd></div>
                    <div><dt>连接</dt><dd>{{ properties.nb_connections }} 个 · 种子 {{ properties.seeds }} · 下载者 {{ properties.peers }}</dd></div>
                    <div><dt>分块</dt><dd>{{ properties.pieces_have }} / {{ properties.pieces_num }} · 每块 {{ formatBytes(properties.piece_size) }}</dd></div>
                    <div><dt>创建程序</dt><dd>{{ properties.created_by || '—' }}</dd></div>
                    <div><dt>Info hash</dt><dd class="hash-text">{{ properties.infohash_v1 || torrent.hash }}</dd></div>
                    <div v-if="properties.infohash_v2"><dt>Info hash v2</dt><dd class="hash-text">{{ properties.infohash_v2 }}</dd></div>
                    <div v-if="properties.comment"><dt>备注</dt><dd class="comment-text">{{ properties.comment }}</dd></div>
                </dl>
            </template>

            <template v-else-if="activeTab === 'files'">
                <div class="detail-actions">
                    <label class="file-search"><Search :size="16" /><input v-model="fileQuery" class="input" type="search" placeholder="查找文件" aria-label="查找文件"></label>
                    <span class="selection-count">{{ selectedFiles.length ? `已选 ${selectedFiles.length} 个文件` : `${files.length} 个文件` }}</span>
                    <select v-model.number="batchPriority" class="input priority-select" aria-label="所选文件优先级" :disabled="busy">
                        <option v-for="priority in priorities" :key="priority.value" :value="priority.value">{{ priority.label }}</option>
                    </select>
                    <button class="button ghost" type="button" :disabled="busy || selectedFiles.length === 0" @click="setPriority(selectedFiles, batchPriority)">应用优先级</button>
                </div>
                <div v-if="visibleFiles.length" class="details-table-scroll">
                    <table class="details-table file-table">
                        <thead><tr><th class="checkbox-cell"><input type="checkbox" :checked="allFilesSelected" :indeterminate="someFilesSelected && !allFilesSelected" :disabled="busy" aria-label="选择当前列表全部文件" @change="toggleAllFiles"></th><th>文件名</th><th>大小</th><th>完成度</th><th>优先级</th></tr></thead>
                        <tbody>
                            <tr v-for="file in visibleFiles" :key="file.index" :class="{ selected: selectedFiles.includes(file.index) }">
                                <td class="checkbox-cell"><input v-model="selectedFiles" type="checkbox" :value="file.index" :disabled="busy" :aria-label="`选择 ${file.name}`"></td>
                                <td class="file-name"><span :title="file.name"><FileText :size="15" />{{ file.name }}</span></td>
                                <td class="numeric">{{ formatBytes(file.size) }}</td>
                                <td class="numeric">{{ percent(file.progress) }}</td>
                                <td><select class="input file-priority" :value="file.priority" :disabled="busy" :aria-label="`${file.name} 的优先级`" @change="changeFilePriority(file, $event)"><option v-for="priority in priorities" :key="priority.value" :value="priority.value">{{ priority.label }}</option></select></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div v-else class="details-empty"><ListTree :size="25" /><span>{{ fileQuery ? '没有匹配的文件' : '暂无文件' }}</span></div>
            </template>

            <template v-else-if="activeTab === 'trackers'">
                <div class="detail-actions">
                    <span class="selection-count">{{ trackers.length }} 个发现来源</span>
                    <button class="button ghost" type="button" :disabled="busy" @click="reannounce"><RefreshCw :size="15" />重新汇报</button>
                    <button ref="addTrackerButton" class="button primary" type="button" :disabled="busy" :aria-expanded="trackerFormOpen" aria-controls="tracker-add-form" @click="toggleTrackerForm"><Plus :size="15" />添加 Tracker</button>
                </div>
                <form v-if="trackerFormOpen" id="tracker-add-form" class="tracker-form" @submit.prevent="addTrackers">
                    <label class="field" for="new-tracker-urls">Tracker 地址，每行一个<textarea id="new-tracker-urls" ref="trackerTextarea" v-model="trackerUrls" class="input" rows="3" required placeholder="https://tracker.example.com/announce" :disabled="busy"></textarea></label>
                    <div class="form-actions"><button class="button ghost" type="button" :disabled="busy" @click="closeTrackerForm">取消</button><button class="button primary" type="submit" :disabled="busy || !trackerUrls.trim()">{{ busy ? '正在添加…' : '添加' }}</button></div>
                </form>
                <div v-if="trackerToRemove" id="tracker-remove-confirm" class="tracker-confirm" role="alert">
                    <span>移除这个 Tracker？<small>{{ trackerToRemove }}</small></span>
                    <button ref="removeTrackerCancel" class="button ghost" type="button" :disabled="busy" @click="closeTrackerRemoval">取消</button><button class="button danger" type="button" :disabled="busy" @click="removeTracker">移除</button>
                </div>
                <div v-if="trackers.length" class="tracker-list">
                    <article v-for="tracker in trackers" :key="tracker.url" class="tracker-item">
                        <Network :size="17" class="tracker-icon" />
                        <div class="tracker-main"><span class="tracker-url">{{ tracker.url }}</span><p v-if="tracker.msg">{{ tracker.msg }}</p><div class="tracker-meta"><span>种子 {{ tracker.num_seeds >= 0 ? tracker.num_seeds : '—' }}</span><span>下载者 {{ tracker.num_leeches >= 0 ? tracker.num_leeches : '—' }}</span><span>连接 {{ tracker.num_peers >= 0 ? tracker.num_peers : '—' }}</span></div></div>
                        <span class="badge tracker-status" :class="{ healthy: tracker.status === 2 && !tracker.updating, failed: tracker.status >= 4 && !tracker.updating }">{{ tracker.updating ? '更新中' : trackerStatus[tracker.status] || '未知' }}</span>
                        <button v-if="tracker.tier >= 0" class="icon-button" type="button" :title="`移除 ${tracker.url}`" :aria-label="`移除 ${tracker.url}`" :aria-expanded="trackerToRemove === tracker.url" aria-controls="tracker-remove-confirm" :disabled="busy" @click="openTrackerRemoval(tracker.url, $event)"><Trash2 :size="16" /></button>
                    </article>
                </div>
                <div v-else class="details-empty"><Network :size="25" /><span>暂无 Tracker</span></div>
            </template>

            <template v-else-if="activeTab === 'peers'">
                <p class="peer-summary">{{ peers.length }} 个已连接节点</p>
                <div v-if="peers.length" class="details-table-scroll">
                    <table class="details-table peer-table">
                        <thead><tr><th>节点</th><th>客户端</th><th>连接方式</th><th>完成度</th><th>下载速度</th><th>上传速度</th></tr></thead>
                        <tbody><tr v-for="peer in peers" :key="peer.id"><td><span class="peer-address">{{ peer.ip || peer.i2p_dest || peer.id }}{{ peer.port ? `:${peer.port}` : '' }}</span><small v-if="peer.country">{{ peer.country }}</small></td><td>{{ peer.client || '—' }}</td><td>{{ peer.connection || '—' }}</td><td class="numeric">{{ percent(peer.progress) }}</td><td class="numeric">{{ formatBytes(peer.dl_speed) }}/s</td><td class="numeric">{{ formatBytes(peer.up_speed) }}/s</td></tr></tbody>
                    </table>
                </div>
                <div v-else class="details-empty"><Users :size="25" /><span>当前没有已连接的节点</span></div>
            </template>
        </div>
    </section>
</template>

<style scoped>
.torrent-details { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; min-width: 0; overflow: hidden; }
.details-heading { align-items: center; display: flex; gap: 16px; justify-content: space-between; padding: 20px 24px 16px; }
.details-title { min-width: 0; }
.details-eyebrow { color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: .08em; }
.details-title h2 { color: var(--text); font-size: 15px; font-weight: 650; line-height: 1.5; margin: 4px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.details-tabs { border-bottom: 1px solid var(--border); display: flex; gap: 4px; overflow-x: auto; padding: 0 18px; }
.detail-tab { align-items: center; background: none; border: 0; border-bottom: 2px solid transparent; color: var(--muted); cursor: pointer; display: inline-flex; flex-shrink: 0; font: inherit; font-size: 12px; gap: 7px; padding: 13px 16px; }
.detail-tab.active { border-bottom-color: var(--accent); color: var(--accent); font-weight: 650; }
.detail-tab:hover { color: var(--accent); }
.details-content { min-height: 180px; padding: 20px 24px 24px; }
.details-empty { align-items: center; color: var(--muted); display: flex; flex-direction: column; font-size: 12px; gap: 12px; justify-content: center; min-height: 150px; text-align: center; }
.details-error { align-items: flex-start; background: color-mix(in srgb, var(--danger) 8%, var(--surface)); border: 1px solid color-mix(in srgb, var(--danger) 24%, var(--border)); border-radius: 4px; color: var(--danger); display: flex; font-size: 12px; gap: 8px; margin: 16px 24px 0; padding: 11px 14px; }
.details-error svg { flex-shrink: 0; }
.details-note { background: var(--accent-soft); border-radius: 4px; color: var(--accent); font-size: 12px; margin-bottom: 18px; padding: 12px 14px; }
.detail-stats { display: grid; gap: 20px 24px; grid-template-columns: repeat(4, minmax(0, 1fr)); padding-bottom: 22px; }
.detail-stats div { display: flex; flex-direction: column; gap: 6px; }
.detail-stats span { color: var(--muted); font-size: 11px; }
.detail-stats strong { color: var(--text); font-size: 15px; font-variant-numeric: tabular-nums; font-weight: 600; }
.property-list { border-top: 1px solid var(--border); display: grid; gap: 14px; margin: 0; padding-top: 20px; }
.property-list div { display: grid; gap: 16px; grid-template-columns: 84px minmax(0, 1fr); }
.property-list dt { color: var(--muted); font-size: 12px; }
.property-list dd { color: var(--text); font-size: 12px; line-height: 1.6; margin: 0; overflow-wrap: anywhere; }
.property-list .hash-text { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; }
.comment-text { white-space: pre-wrap; }
.detail-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
.file-search { align-items: center; color: var(--muted); display: flex; flex: 1; min-width: 180px; position: relative; }
.file-search svg { left: 11px; position: absolute; }
.file-search input { padding-left: 35px; width: 100%; }
.selection-count { color: var(--muted); flex: 1; font-size: 12px; white-space: nowrap; }
.priority-select { max-width: 105px; }
.details-table-scroll { max-height: 340px; overflow: auto; }
.details-table { border-collapse: collapse; color: var(--text); font-size: 12px; text-align: left; width: 100%; }
.details-table th { background: var(--surface-2); color: var(--muted); font-size: 11px; font-weight: 500; padding: 11px 12px; position: sticky; top: 0; white-space: nowrap; z-index: 1; }
.details-table td { border-bottom: 1px solid var(--border); padding: 11px 12px; }
.details-table tr:last-child td { border-bottom: 0; }
.details-table tr.selected td { background: var(--accent-soft); }
.details-table .numeric { font-variant-numeric: tabular-nums; white-space: nowrap; }
.details-table .checkbox-cell { padding-left: 10px; padding-right: 6px; width: 30px; }
.details-table input[type="checkbox"] { accent-color: var(--accent); cursor: pointer; height: 14px; margin: 0; width: 14px; }
.file-name { min-width: 190px; width: 100%; }
.file-name span { align-items: center; display: flex; gap: 9px; line-height: 1.6; overflow-wrap: anywhere; }
.file-name svg { color: var(--muted); flex-shrink: 0; }
.file-priority { font-size: 11px; min-width: 75px; padding: 6px 9px; }
.tracker-form { background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; margin-bottom: 16px; padding: 16px; }
.tracker-form .field { display: flex; flex-direction: column; font-size: 12px; gap: 9px; }
.tracker-form textarea { font-family: inherit; resize: vertical; width: 100%; }
.form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
.tracker-confirm { align-items: center; border: 1px solid color-mix(in srgb, var(--danger) 28%, var(--border)); border-radius: 4px; display: flex; flex-wrap: wrap; font-size: 12px; gap: 10px; margin-bottom: 16px; padding: 12px 14px; }
.tracker-confirm > span { flex: 1; min-width: 160px; }
.tracker-confirm small { color: var(--muted); display: block; margin-top: 5px; overflow-wrap: anywhere; }
.tracker-item { align-items: center; border-bottom: 1px solid var(--border); display: flex; gap: 14px; padding: 15px 0; }
.tracker-item:first-child { padding-top: 4px; }
.tracker-item:last-child { border-bottom: 0; padding-bottom: 0; }
.tracker-icon { color: var(--accent); flex-shrink: 0; }
.tracker-main { flex: 1; min-width: 0; }
.tracker-url { color: var(--text); font-size: 12px; overflow-wrap: anywhere; }
.tracker-main p { color: var(--muted); font-size: 11px; line-height: 1.5; margin: 6px 0; overflow-wrap: anywhere; }
.tracker-meta { color: var(--muted); display: flex; flex-wrap: wrap; font-size: 11px; gap: 14px; margin-top: 6px; }
.tracker-status { flex-shrink: 0; font-size: 10px; }
.tracker-status.healthy { color: var(--success); }
.tracker-status.failed { color: var(--danger); }
.peer-summary { color: var(--text); display: flex; font-size: 12px; gap: 16px; justify-content: space-between; margin: 0 0 16px; }
.peer-summary span { color: var(--muted); font-size: 11px; }
.peer-table td { white-space: nowrap; }
.peer-table small { color: var(--muted); display: block; font-size: 10px; margin-top: 4px; }
.peer-address { display: block; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.spinning { animation: details-spin 1s linear infinite; }
@keyframes details-spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) {
    .details-heading { padding: 17px 16px 12px; }
    .details-tabs { padding: 0 10px; }
    .detail-tab { padding: 12px 11px; }
    .details-content { padding: 16px; }
    .details-error { margin-left: 16px; margin-right: 16px; }
    .detail-stats { gap: 18px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .property-list div { gap: 8px; grid-template-columns: 68px minmax(0, 1fr); }
    .detail-actions { gap: 8px; }
    .file-search { flex-basis: 100%; }
    .tracker-item { gap: 9px; }
    .tracker-icon { display: none; }
}
@media (prefers-reduced-motion: reduce) { .spinning { animation-duration: 2.5s; } }
</style>
