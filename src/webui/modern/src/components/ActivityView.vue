<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Activity, AlertCircle, Check, ChevronDown, CircleAlert, Info, RefreshCw, Search, TriangleAlert } from "lucide-vue-next";
import { apiGet } from "../api";

type LogEntry = { id: number; timestamp: number; type: number; message: string };
const levels = [
    { type: 1, label: "常规", icon: Check, className: "normal" },
    { type: 2, label: "信息", icon: Info, className: "info" },
    { type: 4, label: "警告", icon: TriangleAlert, className: "warning" },
    { type: 8, label: "错误", icon: AlertCircle, className: "critical" }
] as const;
const entries = ref<LogEntry[]>([]);
const selectedLevel = ref<number | null>(null);
const query = ref("");
const loading = ref(false);
const error = ref("");
const updatedAt = ref<Date | null>(null);
const visibleLimit = ref(300);
let requestSequence = 0;
let poll: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let queued = false;
let failures = 0;
const filtered = computed(() => {
    const term = query.value.trim().toLocaleLowerCase();
    return entries.value.filter(entry => (selectedLevel.value === null || entry.type === selectedLevel.value)
        && (!term || entry.message.toLocaleLowerCase().includes(term)));
});
const visibleEntries = computed(() => filtered.value.slice(0, visibleLimit.value));
const levelCounts = computed(() => new Map(levels.map(level => [level.type, entries.value.filter(entry => entry.type === level.type).length])));
const timestampFormatter = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
});
const timeFormatter = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const timestamp = (entry: LogEntry) => Number.isFinite(entry.timestamp) ? timestampFormatter.format(new Date(entry.timestamp * 1000)) : "—";
const levelFor = (type: number) => levels.find(level => level.type === type) ?? levels[0];

const refresh = async (immediate = false) => {
    if (disposed) return;
    if (loading.value) { queued ||= immediate; return; }
    clearTimeout(poll);
    const sequence = ++requestSequence;
    loading.value = true;
    try {
        const result = await apiGet<LogEntry[]>("log/main", { normal: true, info: true, warning: true, critical: true, last_known_id: -1 });
        if (sequence !== requestSequence)
            return;
        if (!Array.isArray(result))
            throw new Error("返回的日志格式不正确。");
        entries.value = result.sort((left, right) => right.id - left.id);
        updatedAt.value = new Date();
        error.value = ""; failures = 0;
    }
    catch (cause) {
        if (sequence === requestSequence) {
            error.value = cause instanceof Error ? cause.message : "无法读取日志，请稍后重试。";
            failures++;
        }
    }
    finally {
        if (sequence === requestSequence) {
            loading.value = false;
            const delay = queued ? 0 : document.hidden ? 30000 : Math.min(5000 * 2 ** Math.min(failures, 3), 30000);
            queued = false;
            if (!disposed) poll = setTimeout(() => { void refresh(); }, delay);
        }
    }
};
const chooseLevel = (level: number | null) => {
    selectedLevel.value = level;
    visibleLimit.value = 300;
};
const visibility = () => {
    clearTimeout(poll);
    if (!document.hidden) void refresh(true);
    else if (!loading.value) poll = setTimeout(() => { void refresh(); }, 30000);
};
const online = () => { void refresh(true); };
onMounted(() => {
    void refresh();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', online);
});
onBeforeUnmount(() => {
    disposed = true; ++requestSequence; clearTimeout(poll);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('online', online);
});
</script>

<template>
    <section class="activity-view" aria-labelledby="activity-title">
        <header class="activity-header">
            <div><h2 id="activity-title">运行日志</h2></div>
        </header>
        <div class="activity-controls">
            <div class="activity-filters" role="group" aria-label="日志级别">
                <button type="button" :class="{ selected: selectedLevel === null }" :aria-pressed="selectedLevel === null" @click="chooseLevel(null)">全部<span>{{ entries.length }}</span></button>
                <button v-for="level in levels" :key="level.type" type="button" :class="{ selected: selectedLevel === level.type }" :aria-pressed="selectedLevel === level.type" @click="chooseLevel(level.type)">{{ level.label }}<span>{{ levelCounts.get(level.type) ?? 0 }}</span></button>
            </div>
            <label class="activity-search"><Search :size="16" /><input v-model="query" class="input" type="search" aria-label="搜索日志" placeholder="搜索日志内容…" @input="visibleLimit = 300"></label>
        </div>
        <div v-if="error" class="activity-error" role="alert"><CircleAlert :size="17" /><span>{{ error }}</span></div>
        <div class="activity-log" :aria-busy="loading">
            <div v-if="loading && !entries.length" class="activity-empty" role="status"><RefreshCw class="spin" :size="26" /><h3>加载中</h3></div>
            <div v-else-if="!filtered.length && !error" class="activity-empty"><Activity :size="34" /><h3>{{ query || selectedLevel !== null ? '没有匹配的日志' : '暂无日志' }}</h3></div>
            <ol v-else class="activity-entries" aria-label="运行日志列表">
                <li v-for="entry in visibleEntries" :key="entry.id" class="activity-entry">
                    <span class="activity-level" :class="levelFor(entry.type).className" :title="levelFor(entry.type).label"><component :is="levelFor(entry.type).icon" :size="16" /><span>{{ levelFor(entry.type).label }}</span></span>
                    <div class="activity-entry-content"><time :datetime="new Date(entry.timestamp * 1000).toISOString()">{{ timestamp(entry) }}</time><p>{{ entry.message }}</p></div>
                </li>
            </ol>
            <div v-if="filtered.length > visibleLimit" class="activity-more"><button class="button ghost" type="button" @click="visibleLimit += 300"><ChevronDown :size="16" />再显示 300 条<span>还有 {{ filtered.length - visibleLimit }} 条</span></button></div>
        </div>
        <footer class="activity-footer"><span>{{ filtered.length }} 条记录<span v-if="filtered.length > visibleLimit"> · 已显示 {{ visibleEntries.length }} 条</span></span><span v-if="updatedAt">更新于 {{ timeFormatter.format(updatedAt) }}</span></footer>
    </section>
</template>

<style scoped>
.activity-view { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; display: flex; flex: 1; flex-direction: column; min-height: 0; overflow: hidden; }
.activity-header { align-items: center; display: flex; flex: 0 0 auto; gap: 20px; justify-content: space-between; padding: 14px 16px; }
.activity-header h2 { font-size: 16px; letter-spacing: -0.7px; margin: 0 0 8px; }
.activity-header p { color: var(--muted); font-size: 12px; margin: 0; }
.activity-header .button { flex: 0 0 auto; }
.activity-controls { align-items: center; border-bottom: 1px solid var(--border); display: flex; flex: 0 0 auto; flex-wrap: wrap; gap: 16px; justify-content: space-between; padding: 0 30px 18px; }
.activity-filters { display: flex; flex-wrap: wrap; gap: 5px; }
.activity-filters button { align-items: center; background: transparent; border: 1px solid transparent; border-radius: 4px; color: var(--muted); cursor: pointer; display: inline-flex; font: inherit; font-size: 12px; gap: 7px; padding: 8px 10px; }
.activity-filters button:hover { background: var(--surface-2); color: var(--text); }
.activity-filters button.selected { background: var(--accent-soft); color: var(--accent); }
.activity-filters button > span { font-size: 10px; font-variant-numeric: tabular-nums; opacity: 0.8; }
.activity-search { align-items: center; color: var(--muted); display: flex; min-width: 180px; position: relative; width: 240px; }
.activity-search > svg { left: 12px; pointer-events: none; position: absolute; }
.activity-search input { padding-left: 36px; width: 100%; }
.activity-error { align-items: center; background: color-mix(in srgb, var(--danger) 7%, var(--surface)); border-bottom: 1px solid var(--border); color: var(--danger); display: flex; flex: 0 0 auto; font-size: 12px; gap: 10px; padding: 10px 24px; }
.activity-error > svg { flex: 0 0 auto; }
.activity-error .button { margin-left: auto; }
.activity-log { flex: 1; min-height: 240px; overflow: auto; }
.activity-empty { align-items: center; color: var(--muted); display: flex; flex-direction: column; justify-content: center; min-height: 320px; padding: 50px 24px; text-align: center; }
.activity-empty > svg { color: var(--accent); margin-bottom: 18px; opacity: 0.7; }
.activity-empty h3 { color: var(--text); font-size: 16px; font-weight: 500; margin: 0 0 8px; }
.activity-empty p { font-size: 12px; margin: 0; }
.activity-entries { list-style: none; margin: 0; padding: 0 30px; }
.activity-entry { align-items: flex-start; border-bottom: 1px solid var(--border); display: flex; gap: 18px; padding: 18px 0; }
.activity-entry:last-child { border-bottom: 0; }
.activity-level { align-items: center; background: var(--surface-2); border-radius: 4px; color: var(--muted); display: flex; flex: 0 0 68px; font-size: 10px; gap: 5px; justify-content: center; margin-top: 1px; padding: 7px; }
.activity-level.info { background: var(--accent-soft); color: var(--accent); }
.activity-level.warning { background: color-mix(in srgb, #bf852d 12%, var(--surface)); color: light-dark(#936013, #e4b66b); }
.activity-level.critical { background: color-mix(in srgb, var(--danger) 10%, var(--surface)); color: var(--danger); }
.activity-entry-content { flex: 1; min-width: 0; }
.activity-entry time { color: var(--muted); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 10px; font-variant-numeric: tabular-nums; }
.activity-entry p { color: var(--text); font-size: 12px; line-height: 1.8; margin: 5px 0 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.activity-more { display: flex; justify-content: center; padding: 18px; }
.activity-more .button > span { color: var(--muted); font-size: 10px; margin-left: 8px; }
.activity-footer { align-items: center; border-top: 1px solid var(--border); color: var(--muted); display: flex; flex: 0 0 auto; font-size: 10px; justify-content: space-between; padding: 13px 30px; }
.spin { animation: activity-spin 1s linear infinite; }
@keyframes activity-spin { to { transform: rotate(360deg); } }
@media (width <= 700px) {
    .activity-header { align-items: flex-start; padding: 22px 20px; }
    .activity-header h2 { font-size: 16px; }
    .activity-header p { max-width: 190px; line-height: 1.6; }
    .activity-controls { gap: 12px; padding: 0 16px 16px; }
    .activity-search { width: 100%; }
    .activity-filters { gap: 2px; }
    .activity-filters button { padding: 7px; }
    .activity-entries { padding: 0 18px; }
    .activity-entry { gap: 12px; }
    .activity-level { flex-basis: 30px; padding: 7px; }
    .activity-level > span { display: none; }
    .activity-footer { padding: 12px 18px; }
}
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
