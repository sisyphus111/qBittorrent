<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { ArrowDown, ArrowUp, Check, CircleHelp, Folder, Layers, ListFilter, LoaderCircle, LogOut, Menu, Moon, Plus, Rss, Search, Settings2, Sun, Terminal, Upload, ArrowDownToLine } from 'lucide-vue-next';
import { apiGet, apiPost, ApiError } from './api';
import { speed } from './format';
import type { Torrent } from './types';
import DownloadWorkspace from './components/DownloadWorkspace.vue';
import AddTorrentDialog from './components/AddTorrentDialog.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import ActivityView from './components/ActivityView.vue';
import SearchView from './components/SearchView.vue';
import RssView from './components/RssView.vue';
import StorageOverview from './components/StorageOverview.vue';
import { refreshStorage, startStorageMonitoring, stopStorageMonitoring } from './storage';

const authenticated = ref(false);
const checking = ref(true);
const loginBusy = ref(false);
const username = ref('');
const password = ref('');
const loginError = ref('');
const error = ref('');
const isDark = ref(document.documentElement.dataset.theme === 'dark');
const route = ref('downloads');
const filter = ref('all');
const category = ref<string | null>(null);
const query = ref('');
const sidebarOpen = ref(false);
const compactMedia = window.matchMedia('(max-width: 700px)');
const compact = ref(compactMedia.matches);
const updateCompact = () => { compact.value = compactMedia.matches; };
const settingsOpen = ref(false);
const addOpen = ref(false);
const initialUrl = ref('');
const refreshBusy = ref(false);
const torrentMap = reactive<Record<string, Torrent>>({});
const categories = ref<Record<string, { name: string; savePath: string }>>({});
const server = reactive<Record<string, any>>({});
const preferences = ref<Record<string, any>>({});
const lastUpdate = ref<Date | null>(null);
let rid = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
let refreshQueued = false;
let failures = 0;
let disposed = false;
let sessionGeneration = 0;
const torrents = computed(() => Object.values(torrentMap));
const downloading = (torrent: Torrent) => ['downloading', 'forcedDL', 'metaDL', 'forcedMetaDL', 'stalledDL', 'queuedDL', 'allocating', 'checkingDL'].includes(torrent.state);
const seeding = (torrent: Torrent) => ['uploading', 'forcedUP', 'stalledUP', 'queuedUP', 'checkingUP'].includes(torrent.state);
const stopped = (torrent: Torrent) => ['stoppedDL', 'stoppedUP', 'pausedDL', 'pausedUP'].includes(torrent.state);
const matches = (torrent: Torrent, state: string) => state === 'all' || (state === 'downloading' && downloading(torrent)) || (state === 'seeding' && seeding(torrent)) || (state === 'completed' && torrent.progress >= 1) || (state === 'stopped' && stopped(torrent)) || (state === 'error' && ['error', 'missingFiles'].includes(torrent.state));
const statusItems = computed(() => [
    { id: 'all', label: '全部任务', icon: Layers },
    { id: 'downloading', label: '正在下载', icon: ArrowDownToLine },
    { id: 'seeding', label: '正在做种', icon: Upload },
    { id: 'completed', label: '已完成', icon: Check },
    { id: 'stopped', label: '已暂停', icon: ListFilter },
    { id: 'error', label: '异常任务', icon: CircleHelp },
].map(item => ({ ...item, count: torrents.value.filter(torrent => matches(torrent, item.id)).length })));
const visibleTorrents = computed(() => torrents.value.filter(torrent => matches(torrent, filter.value)
    && (category.value === null || torrent.category === category.value)
    && torrent.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())));
const pageTitle = computed(() => ({ downloads: category.value || statusItems.value.find(item => item.id === filter.value)?.label || '全部任务', search: '搜索资源', rss: 'RSS 订阅', activity: '运行日志' }[route.value]));
const activeCount = computed(() => torrents.value.filter(torrent => torrent.dlspeed > 0 || torrent.upspeed > 0).length);
const connection = computed(() => error.value ? '连接中断' : lastUpdate.value ? '已连接' : '正在连接');
const navigate = (target: string, state = 'all') => {
    route.value = target; filter.value = state; category.value = null; sidebarOpen.value = false;
    history.replaceState(null, '', `#${target}`);
};
const add = (url = '') => { initialUrl.value = url; addOpen.value = true; };
const toggleTheme = () => {
    isDark.value = !isDark.value;
    const value = isDark.value ? 'dark' : 'light';
    document.documentElement.dataset.theme = value;
    try { localStorage.setItem('qbt-appearance', value); } catch { /* Still applies without storage. */ }
};
const syncTheme = (event: StorageEvent) => {
    if (event.key !== 'qbt-appearance') return;
    isDark.value = event.newValue === 'dark';
    document.documentElement.dataset.theme = isDark.value ? 'dark' : 'light';
};
const expire = () => {
    stopStorageMonitoring();
    sessionGeneration++;
    polling = false; refreshQueued = false; failures = 0; refreshBusy.value = false;
    authenticated.value = false;
    settingsOpen.value = false;
    addOpen.value = false;
    if (timer) clearTimeout(timer);
    Object.keys(torrentMap).forEach(key => delete torrentMap[key]);
    Object.keys(server).forEach(key => delete server[key]);
    categories.value = {};
    preferences.value = {};
    lastUpdate.value = null;
    error.value = '';
    rid = 0;
};
async function refresh(immediate = false) {
    if (!authenticated.value || disposed) return;
    if (polling) { refreshQueued ||= immediate; return; }
    clearTimeout(timer);
    polling = true; refreshBusy.value = true;
    const generation = sessionGeneration;
    try {
        const data = await apiGet<any>('sync/maindata', { rid });
        if (!authenticated.value || generation !== sessionGeneration) return;
        rid = data.rid;
        if (data.full_update) {
            Object.keys(torrentMap).filter(key => !Object.hasOwn(data.torrents || {}, key)).forEach(key => delete torrentMap[key]);
            categories.value = {};
        }
        for (const [hash, value] of Object.entries(data.torrents || {})) {
            if (torrentMap[hash]) Object.assign(torrentMap[hash], value);
            else torrentMap[hash] = { ...(value as object), hash } as Torrent;
        }
        for (const hash of data.torrents_removed || []) delete torrentMap[hash];
        Object.assign(server, data.server_state || {});
        Object.assign(categories.value, data.categories || {});
        for (const key of data.categories_removed || []) delete categories.value[key];
        lastUpdate.value = new Date(); error.value = ''; failures = 0;
    } catch (failure) {
        if (generation === sessionGeneration) { error.value = (failure as Error).message; failures++; }
    } finally {
        if (generation === sessionGeneration) {
            polling = false; refreshBusy.value = false;
            clearTimeout(timer);
            const delay = refreshQueued ? 0 : document.hidden ? 15000 : Math.min(1000 * 2 ** Math.min(failures, 4), 15000);
            refreshQueued = false;
            if (authenticated.value && !disposed) timer = setTimeout(() => { void refresh(); }, delay);
        }
    }
}
async function loadSession() {
    preferences.value = await apiGet<Record<string, any>>('app/preferences');
    authenticated.value = true;
    startStorageMonitoring();
    rid = 0;
    await refresh();
}
async function login() {
    loginBusy.value = true; loginError.value = '';
    try {
        await apiPost('auth/login', { username: username.value, password: password.value });
        password.value = '';
        await loadSession();
    } catch (failure) { loginError.value = (failure as Error).message; }
    finally { loginBusy.value = false; }
}
async function logout() {
    try { await apiPost('auth/logout'); expire(); }
    catch (failure) { error.value = (failure as Error).message; }
}
const taskChanged = () => { void refresh(true); void refreshStorage(true); };
async function settingsSaved() {
    try { preferences.value = await apiGet<Record<string, any>>('app/preferences'); taskChanged(); }
    catch (failure) { error.value = (failure as Error).message; }
}
const keydown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault(); document.getElementById('workspace-search')?.focus();
    }
    if (event.key === 'Escape') sidebarOpen.value = false;
};
const visibility = () => {
    clearTimeout(timer);
    if (!document.hidden) void refresh(true);
    else if (authenticated.value && !polling) timer = setTimeout(() => { void refresh(); }, 15000);
};
const online = () => { void refresh(true); };
onMounted(async () => {
    const hash = location.hash.slice(1);
    if (['downloads', 'search', 'rss', 'activity'].includes(hash)) route.value = hash;
    window.addEventListener('qbt-session-expired', expire);
    compactMedia.addEventListener('change', updateCompact);
    window.addEventListener('storage', syncTheme);
    window.addEventListener('keydown', keydown);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', online);
    try { await loadSession(); }
    catch (failure) { if (!(failure instanceof ApiError && failure.status === 403)) loginError.value = (failure as Error).message; }
    finally { checking.value = false; }
});
onUnmounted(() => {
    stopStorageMonitoring();
    compactMedia.removeEventListener('change', updateCompact);
    disposed = true;
    if (timer) clearTimeout(timer);
    window.removeEventListener('qbt-session-expired', expire);
    window.removeEventListener('storage', syncTheme);
    window.removeEventListener('keydown', keydown);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('online', online);
});
</script>

<template>
    <div v-if="checking" class="boot-screen"><LoaderCircle class="spin" :size="28" /><span>正在连接…</span></div>
    <div v-else-if="!authenticated" class="auth-page">
        <header class="auth-header">
            <div class="brand"><strong>qBittorrent</strong></div>
            <button class="icon-button theme-switch" @click="toggleTheme" :aria-label="isDark ? '切换浅色模式' : '切换深色模式'" :title="isDark ? '切换浅色模式' : '切换深色模式'"><Sun v-if="isDark" :size="19" /><Moon v-else :size="19" /></button>
        </header>
        <main class="auth-layout">
            <section class="auth-card">
                <h2>登录</h2>
                <form @submit.prevent="login" class="login-form">
                    <label class="field">用户名<input class="input" v-model="username" name="username" autocomplete="username" autocapitalize="none" required autofocus /></label>
                    <label class="field">密码<input class="input" v-model="password" name="password" type="password" autocomplete="current-password" required /></label>
                    <p v-if="loginError" class="error-banner" role="alert">{{ loginError }}</p>
                    <button class="button primary login-submit" :disabled="loginBusy"><LoaderCircle v-if="loginBusy" :size="17" class="spin" /><span>{{ loginBusy ? '正在登录' : '登录' }}</span></button>
                </form>
            </section>
        </main>
    </div>
    <div v-else class="app-shell">
        <button v-if="sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false" aria-label="关闭导航"></button>
        <aside id="app-navigation" class="sidebar" :class="{ open: sidebarOpen }" :inert="compact && !sidebarOpen">
            <div class="brand"><strong>qBittorrent</strong></div>
            <nav aria-label="主导航" class="sidebar-nav">
                <span class="nav-label">下载管理</span>
                <button v-for="item in statusItems" :key="item.id" class="nav-item" :class="{ active: route === 'downloads' && filter === item.id && category === null }" @click="navigate('downloads', item.id)"><component :is="item.icon" :size="18" :stroke-width="1.7" /><span>{{ item.label }}</span><span class="nav-count">{{ item.count }}</span></button>
                <span class="nav-label section-gap">工具</span>
                <button class="nav-item" :class="{ active: route === 'search' }" @click="navigate('search')"><Search :size="18" :stroke-width="1.7" /><span>搜索资源</span></button>
                <button class="nav-item" :class="{ active: route === 'rss' }" @click="navigate('rss')"><Rss :size="18" :stroke-width="1.7" /><span>RSS 订阅</span></button>
                <template v-if="Object.keys(categories).length">
                    <span class="nav-label section-gap">分类</span>
                    <button v-for="(item, key) in categories" :key="key" class="nav-item" :class="{ active: category === key && route === 'downloads' }" @click="navigate('downloads'); category = String(key)"><Folder :size="17" :stroke-width="1.7" /><span>{{ item.name || key }}</span><span class="nav-count">{{ torrents.filter(t => t.category === key).length }}</span></button>
                </template>
            </nav>
            <div class="sidebar-bottom">
                <button class="nav-item" :class="{ active: route === 'activity' }" @click="navigate('activity')"><Terminal :size="18" :stroke-width="1.7" /><span>运行日志</span></button>
                <button class="nav-item" @click="settingsOpen = true"><Settings2 :size="18" :stroke-width="1.7" /><span>设置</span></button>
                <div class="sidebar-account"><div><strong>{{ preferences.web_ui_username }}</strong><small><span class="status-dot" :class="{ offline: error }"></span>{{ connection }}</small></div><button class="icon-button" @click="logout" aria-label="退出登录" title="退出登录"><LogOut :size="16" /></button></div>
            </div>
        </aside>
        <div class="workspace">
            <header class="topbar">
                <button class="icon-button mobile-menu" @click="sidebarOpen = !sidebarOpen" aria-label="打开导航" aria-controls="app-navigation" :aria-expanded="sidebarOpen"><Menu :size="21" /></button>
                <h1 class="view-title">{{ pageTitle }}<span v-if="route === 'downloads'">{{ visibleTorrents.length }}</span></h1>
                <div class="topbar-actions"><button class="button add-task" @click="add()"><Plus :size="15" />添加任务</button><span class="connection-indicator"><span class="status-dot" :class="{ offline: error }"></span>{{ connection }}</span><span class="topbar-divider"></span><button class="icon-button theme-switch" @click="toggleTheme" :aria-label="isDark ? '切换浅色模式' : '切换深色模式'" :title="isDark ? '切换浅色模式' : '切换深色模式'"><Sun v-if="isDark" :size="19" /><Moon v-else :size="19" /></button></div>
            </header>
            <main class="main-content">
                <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
                <div v-if="route === 'downloads'" class="transfer-status" aria-label="传输状态">
                    <span><ArrowDown :size="14" />下载 <strong>{{ speed(server.dl_info_speed) }}</strong></span>
                    <span><ArrowUp :size="14" />上传 <strong>{{ speed(server.up_info_speed) }}</strong></span>
                    <span>活跃 <strong>{{ activeCount }} / {{ torrents.length }}</strong></span>
                </div>
                <StorageOverview v-if="route === 'downloads'" />
                <section v-if="route === 'downloads'" class="downloads-section">
                    <div class="section-heading"><h2>任务列表</h2><label class="search-field"><Search :size="16" /><input id="workspace-search" v-model="query" placeholder="搜索任务" aria-label="搜索任务名称" /></label></div>
                    <DownloadWorkspace :torrents="visibleTorrents" :loading="refreshBusy && !lastUpdate" @refresh="taskChanged" @add="add()" />
                </section>
                <SearchView v-else-if="route === 'search'" @add-url="add" />
                <RssView v-else-if="route === 'rss'" @add-url="add" />
                <ActivityView v-else-if="route === 'activity'" />
            </main>
        </div>
        <AddTorrentDialog :open="addOpen" :default-save-path="preferences.save_path || ''" :initial-url="initialUrl" @close="addOpen = false" @added="addOpen = false; taskChanged()" />
        <SettingsDialog :open="settingsOpen" @close="settingsOpen = false" @saved="settingsSaved" />
    </div>
</template>
