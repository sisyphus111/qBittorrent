<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ArrowDownToLine, ChevronLeft, ChevronRight, ExternalLink, LoaderCircle, Plus, Search, Settings2, Square, ToggleLeft, ToggleRight } from 'lucide-vue-next';
import { apiGet, apiPost } from '../api';
import { bytes } from '../format';
interface Plugin { name: string; fullName: string; version: string; enabled: boolean; supportedCategories: { id: string; name: string }[] }
interface Result { fileName: string; fileUrl: string; fileSize: number; nbSeeders: number; nbLeechers: number; engineName: string; descrLink: string; siteUrl: string }
const emit = defineEmits<{ 'add-url': [url: string] }>();
const plugins = ref<Plugin[]>([]);
const pattern = ref('');
const engine = ref('enabled');
const category = ref('all');
const results = ref<Result[]>([]);
const total = ref(0);
const offset = ref(0);
const jobId = ref<number | null>(null);
const running = ref(false);
const busy = ref(false);
const pluginBusy = ref(false);
const downloading = ref('');
const error = ref('');
const notice = ref('');
const pluginPanel = ref(false);
const pluginUrl = ref('');
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let requestGeneration = 0;
const categories = computed(() => plugins.value.find(plugin => plugin.name === engine.value)?.supportedCategories || [{ id: 'all', name: '全部分类' }]);
const safeLink = (url: string) => /^https?:\/\//i.test(url) ? url : undefined;
const sortedResults = computed(() => [...results.value].sort((a, b) => b.nbSeeders - a.nbSeeders));
async function loadPlugins() {
    try { plugins.value = await apiGet<Plugin[]>('search/plugins'); }
    catch (failure) { error.value = (failure as Error).message; }
}
async function poll() {
    if (jobId.value === null || disposed) return;
    if (timer) clearTimeout(timer);
    const id = jobId.value;
    const generation = ++requestGeneration;
    try {
        const data = await apiGet<{ results: Result[]; total: number; status: string }>('search/results', { id, limit: 100, offset: offset.value });
        if (disposed || id !== jobId.value || generation !== requestGeneration) return;
        results.value = data.results; total.value = data.total; running.value = data.status === 'Running';
        error.value = '';
        if (running.value) timer = setTimeout(poll, 1800);
    } catch (failure) {
        if (disposed || generation !== requestGeneration) return;
        error.value = (failure as Error).message; running.value = false;
    }
}
async function search() {
    if (!pattern.value.trim() || busy.value) return;
    busy.value = true; error.value = ''; notice.value = '';
    try {
        if (jobId.value !== null && running.value) await apiPost('search/stop', { id: jobId.value });
        const job = await apiPost<{ id: number }>('search/start', { pattern: pattern.value.trim(), plugins: engine.value, category: category.value });
        jobId.value = job.id; results.value = []; total.value = 0; offset.value = 0; running.value = true;
        await poll();
    } catch (failure) { error.value = (failure as Error).message; }
    finally { busy.value = false; }
}
async function stop() {
    try { await apiPost('search/stop', { id: jobId.value }); running.value = false; await poll(); }
    catch (failure) { error.value = (failure as Error).message; }
}
async function page(delta: number) { offset.value = Math.max(0, offset.value + delta * 100); await poll(); }
async function togglePlugin(plugin: Plugin) {
    pluginBusy.value = true;
    try { await apiPost('search/enablePlugin', { names: plugin.name, enable: !plugin.enabled }); await loadPlugins(); }
    catch (failure) { error.value = (failure as Error).message; }
    finally { pluginBusy.value = false; }
}
async function install() {
    if (!safeLink(pluginUrl.value.trim())) { error.value = '请输入有效的 HTTP 或 HTTPS 插件地址。'; return; }
    pluginBusy.value = true; error.value = '';
    try { await apiPost('search/installPlugin', { sources: pluginUrl.value.trim() }); pluginUrl.value = ''; notice.value = '插件安装请求已提交，稍后重新打开插件面板查看结果。'; await loadPlugins(); }
    catch (failure) { error.value = (failure as Error).message; }
    finally { pluginBusy.value = false; }
}
async function download(result: Result) {
    if (/^magnet:/i.test(result.fileUrl)) { emit('add-url', result.fileUrl); return; }
    downloading.value = result.fileUrl;
    try { await apiPost('search/downloadTorrent', { torrentUrl: result.fileUrl, pluginName: result.engineName }); notice.value = '已请求获取种子，成功后会出现在任务列表中。'; }
    catch (failure) { error.value = (failure as Error).message; }
    finally { downloading.value = ''; }
}
onMounted(loadPlugins);
onUnmounted(() => { disposed = true; if (timer) clearTimeout(timer); });
</script>

<template>
    <section class="search-workspace">
        <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
        <div v-if="notice" class="success-banner" role="status">{{ notice }}</div>
        <form class="search-controls" @submit.prevent="search">
            <div class="query-input"><Search :size="18" /><input class="input" v-model="pattern" placeholder="搜索" aria-label="搜索资源关键词" required /></div>
            <select class="input" v-model="engine" aria-label="搜索引擎" @change="category = 'all'"><option value="enabled">已启用的引擎</option><option v-for="plugin in plugins" :key="plugin.name" :value="plugin.name">{{ plugin.fullName }}</option></select>
            <select class="input" v-model="category" aria-label="资源分类"><option v-for="item in categories" :key="item.id" :value="item.id">{{ item.name }}</option></select>
            <button class="button primary" :disabled="busy || !plugins.length"><LoaderCircle v-if="busy" class="spin" :size="16" /><Search v-else :size="16" />搜索</button>
            <button v-if="running" class="button" type="button" @click="stop"><Square :size="14" />停止</button>
            <button class="icon-button" type="button" title="搜索插件" aria-label="搜索插件" :aria-expanded="pluginPanel" @click="pluginPanel = !pluginPanel; pluginPanel && loadPlugins()"><Settings2 :size="18" /></button>
        </form>
        <section v-if="pluginPanel" class="plugin-panel">
            <div class="plugin-heading"><h3>搜索插件</h3><span class="muted">仅安装你信任的插件</span></div>
            <div v-for="plugin in plugins" :key="plugin.name" class="plugin-row"><span>{{ plugin.fullName }} <small class="muted">v{{ plugin.version }}</small></span><button class="button ghost" :disabled="pluginBusy" @click="togglePlugin(plugin)"><ToggleRight v-if="plugin.enabled" :size="22" /><ToggleLeft v-else :size="22" />{{ plugin.enabled ? '已启用' : '已停用' }}</button></div>
            <form class="plugin-install" @submit.prevent="install"><input class="input" v-model="pluginUrl" type="url" aria-label="插件地址" placeholder="插件的 HTTPS 地址" required /><button class="button" :disabled="pluginBusy"><Plus :size="16" />安装插件</button></form>
        </section>
        <div class="results-heading"><span>搜索结果 <span class="badge">{{ total }}</span></span><span class="muted"><LoaderCircle v-if="running" class="spin" :size="13" />{{ running ? '搜索中' : jobId !== null ? '已完成' : '' }}</span></div>
        <div v-if="!results.length" class="empty-state"><h3>{{ !plugins.length ? '未安装搜索插件' : running ? '搜索中' : jobId !== null ? '无结果' : '暂无搜索' }}</h3><button v-if="!plugins.length" class="button" @click="pluginPanel = true">管理搜索插件</button></div>
        <div v-else class="results-scroll"><table><thead><tr><th>资源名称</th><th>大小</th><th>做种 / 下载</th><th>来源</th><th><span class="sr-only">操作</span></th></tr></thead><tbody><tr v-for="(result, index) in sortedResults" :key="`${result.fileUrl}-${index}`"><td><a v-if="safeLink(result.descrLink)" :href="safeLink(result.descrLink)" target="_blank" rel="noopener noreferrer">{{ result.fileName }} <ExternalLink :size="12" /></a><span v-else>{{ result.fileName }}</span></td><td>{{ result.fileSize >= 0 ? bytes(result.fileSize) : '—' }}</td><td><span class="seeders">{{ result.nbSeeders >= 0 ? result.nbSeeders : '—' }}</span> / {{ result.nbLeechers >= 0 ? result.nbLeechers : '—' }}</td><td>{{ result.engineName }}</td><td><button class="icon-button" :disabled="!!downloading" :aria-label="`下载 ${result.fileName}`" title="下载" @click="download(result)"><ArrowDownToLine :size="17" /></button></td></tr></tbody></table></div>
        <div v-if="total > 100" class="pagination"><span class="muted">{{ offset + 1 }}–{{ Math.min(offset + 100, total) }} / {{ total }}</span><button class="icon-button" :disabled="offset === 0" aria-label="上一页" @click="page(-1)"><ChevronLeft :size="18" /></button><button class="icon-button" :disabled="offset + 100 >= total" aria-label="下一页" @click="page(1)"><ChevronRight :size="18" /></button></div>
    </section>
</template>

<style scoped>
.search-workspace { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
.search-controls { display: flex; gap: 10px; align-items: center; padding: 22px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.query-input { flex: 1; min-width: 180px; display: flex; align-items: center; gap: 10px; color: var(--muted); border: 1px solid var(--border); border-radius: 4px; padding: 0 12px; }
.query-input input { border: 0; background: transparent; min-width: 0; width: 100%; padding-left: 0; box-shadow: none; }
.search-controls select { max-width: 200px; }
.results-heading { padding: 18px 24px; display: flex; align-items: center; justify-content: space-between; font-size: 12px; gap: 14px; }
.results-heading > span { display: flex; align-items: center; gap: 9px; }
.results-heading > .muted { font-size: 11px; }
.results-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { text-align: left; padding: 12px 20px; background: var(--surface-2); color: var(--muted); font-size: 10px; font-weight: 500; }
td { padding: 15px 20px; border-bottom: 1px solid var(--border); white-space: nowrap; }
td:first-child { white-space: normal; min-width: 250px; max-width: 600px; word-break: break-word; line-height: 1.6; }
td a { color: var(--text); text-decoration: none; }
td a:hover { color: var(--accent); }
.seeders { color: var(--success); }
.plugin-panel { padding: 22px; background: var(--surface-2); border-bottom: 1px solid var(--border); }
.plugin-heading { display: flex; align-items: center; justify-content: space-between; font-size: 11px; }
.plugin-heading h3 { font-size: 13px; margin: 0 0 12px; }
.plugin-row { display: flex; justify-content: space-between; align-items: center; font-size: 12px; border-bottom: 1px solid var(--border); padding: 5px 0; }
.plugin-install { display: flex; gap: 10px; margin-top: 15px; }
.plugin-install input { flex: 1; min-width: 0; }
.pagination { display: flex; justify-content: flex-end; align-items: center; gap: 12px; padding: 12px 22px; font-size: 11px; }
.error-banner, .success-banner { margin: 16px; }
@media (max-width: 700px) { .search-controls { padding: 16px; } .query-input { flex-basis: 100%; } .search-controls select { flex: 1; width: 110px; } .results-heading { padding: 16px; flex-wrap: wrap; } }
</style>
