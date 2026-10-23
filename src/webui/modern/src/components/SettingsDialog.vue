<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { ArrowDownToLine, Check, CircleAlert, Globe, LoaderCircle, Network, ShieldCheck, SlidersHorizontal, X } from "lucide-vue-next";
import { apiGet, apiPost } from "../api";
import { isStoragePath } from "../storage";
import SavePathPicker from "./SavePathPicker.vue";

type Value = string | number | boolean;
type Preferences = Record<string, Value>;
type GroupId = "downloads" | "connection" | "speed" | "bittorrent" | "webui";
type Option = { value: string | number; label: string };
type Field = {
    key: string;
    label: string;
    type: "text" | "number" | "toggle" | "select";
    hint?: string;
    min?: number;
    max?: number;
    step?: number;
    scale?: number;
    options?: Option[];
    enabled?: (values: Preferences) => boolean;
    full?: boolean;
};
type Section = { title: string; fields: Field[] };

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const groups = [
    { id: "downloads", label: "下载", icon: ArrowDownToLine, description: "文件保存位置与新任务偏好" },
    { id: "connection", label: "连接", icon: Network, description: "监听端口、连接数量与代理" },
    { id: "speed", label: "速度与队列", icon: SlidersHorizontal, description: "带宽分配与并行下载" },
    { id: "bittorrent", label: "BitTorrent", icon: Globe, description: "节点发现、加密与做种规则" },
    { id: "webui", label: "网页管理", icon: ShieldCheck, description: "登录账号与会话设置" }
] as const;
const proxyEnabled = (values: Preferences) => values.proxy_type !== "None";
const proxyAuthEnabled = (values: Preferences) => proxyEnabled(values) && values.proxy_type !== "SOCKS4" && Boolean(values.proxy_auth_enabled);
const queueEnabled = (values: Preferences) => Boolean(values.queueing_enabled);
const speedField = (key: string, label: string): Field => ({ key, label: `${label}（KiB/s）`, type: "number", min: 0, max: 2097151, scale: 1024, hint: "0 表示不限速" });
const schema: Record<GroupId, Section[]> = {
    downloads: [
        { title: "文件位置", fields: [
            { key: "save_path", label: "默认下载目录", type: "text", full: true }
        ] },
        { title: "添加与保存", fields: [
            { key: "add_stopped_enabled", label: "添加任务后先保持停止", type: "toggle" },
            { key: "auto_tmm_enabled", label: "默认启用自动管理", type: "toggle", hint: "根据任务分类管理保存目录。" },
            { key: "preallocate_all", label: "预先分配文件空间", type: "toggle" },
            { key: "incomplete_files_ext", label: "为未完成的文件添加 .!qB 后缀", type: "toggle" }
        ] }
    ],
    connection: [
        { title: "传入连接", fields: [
            { key: "listen_port", label: "BitTorrent 监听端口", type: "number", min: 0, max: 65535, hint: "0 表示每次启动时选择随机端口。" },
            { key: "upnp", label: "使用 UPnP / NAT-PMP 自动映射端口", type: "toggle" },
            { key: "max_connec", label: "全局最大连接数", type: "number", min: -1, hint: "-1 表示不限制" },
            { key: "max_connec_per_torrent", label: "每个任务最大连接数", type: "number", min: -1, hint: "-1 表示不限制" }
        ] },
        { title: "代理服务器", fields: [
            { key: "proxy_type", label: "代理类型", type: "select", options: [
                { value: "None", label: "不使用代理" }, { value: "SOCKS4", label: "SOCKS4" },
                { value: "SOCKS5", label: "SOCKS5" }, { value: "HTTP", label: "HTTP" }
            ] },
            { key: "proxy_ip", label: "服务器地址", type: "text", enabled: proxyEnabled },
            { key: "proxy_port", label: "代理端口", type: "number", min: 1, max: 65535, enabled: proxyEnabled },
            { key: "proxy_auth_enabled", label: "代理需要身份验证", type: "toggle", enabled: values => proxyEnabled(values) && values.proxy_type !== "SOCKS4" },
            { key: "proxy_username", label: "代理用户名", type: "text", enabled: proxyAuthEnabled },
            { key: "proxy_hostname_lookup", label: "通过代理解析主机名", type: "toggle", enabled: values => proxyEnabled(values) && values.proxy_type !== "SOCKS4" },
            { key: "proxy_bittorrent", label: "BitTorrent 使用代理", type: "toggle", enabled: proxyEnabled },
            { key: "proxy_peer_connections", label: "节点连接使用代理", type: "toggle", enabled: proxyEnabled },
            { key: "proxy_rss", label: "RSS 使用代理", type: "toggle", enabled: proxyEnabled }
        ] }
    ],
    speed: [
        { title: "全局速度限制", fields: [speedField("dl_limit", "下载速度"), speedField("up_limit", "上传速度")] },
        { title: "备用速度限制", fields: [speedField("alt_dl_limit", "备用下载速度"), speedField("alt_up_limit", "备用上传速度")] },
        { title: "任务队列", fields: [
            { key: "queueing_enabled", label: "启用任务队列", type: "toggle" },
            { key: "max_active_downloads", label: "最多同时下载", type: "number", min: -1, hint: "-1 表示不限制", enabled: queueEnabled },
            { key: "max_active_uploads", label: "最多同时上传", type: "number", min: -1, hint: "-1 表示不限制", enabled: queueEnabled },
            { key: "max_active_torrents", label: "最多同时活动的任务", type: "number", min: -1, hint: "-1 表示不限制", enabled: queueEnabled },
            { key: "dont_count_slow_torrents", label: "低速任务不计入队列限制", type: "toggle", enabled: queueEnabled }
        ] }
    ],
    bittorrent: [
        { title: "节点发现与加密", fields: [
            { key: "dht", label: "启用 DHT", type: "toggle", hint: "通过分布式网络发现其他节点。" },
            { key: "pex", label: "启用 PeX 节点交换", type: "toggle" },
            { key: "lsd", label: "启用本地节点发现", type: "toggle" },
            { key: "encryption", label: "连接加密", type: "select", options: [
                { value: 0, label: "允许加密" }, { value: 1, label: "要求加密" }, { value: 2, label: "禁用加密" }
            ] }
        ] },
        { title: "做种限制", fields: [
            { key: "max_ratio_enabled", label: "按分享率限制做种", type: "toggle" },
            { key: "max_ratio", label: "目标分享率", type: "number", min: 0, step: 0.1, enabled: values => Boolean(values.max_ratio_enabled) },
            { key: "max_seeding_time_enabled", label: "限制做种时间", type: "toggle" },
            { key: "max_seeding_time", label: "最长做种时间（分钟）", type: "number", min: 0, hint: "分钟", enabled: values => Boolean(values.max_seeding_time_enabled) },
            { key: "max_ratio_act", label: "达到限制后的操作", type: "select", options: [
                { value: 0, label: "停止任务" }, { value: 1, label: "移除任务，保留文件" },
                { value: 2, label: "启用超级做种" }, { value: 3, label: "移除任务并删除文件" }
            ] }
        ] }
    ],
    webui: [
        { title: "登录与会话", fields: [
            { key: "web_ui_username", label: "用户名", type: "text", full: true, hint: "至少 3 个字符，不能包含冒号。" },
            { key: "web_ui_session_timeout", label: "会话超时（秒）", type: "number", min: 0, hint: "秒 · 0 表示不自动超时" },
            { key: "web_ui_max_auth_fail_count", label: "允许连续登录失败次数", type: "number", min: 1 },
            { key: "web_ui_ban_duration", label: "登录失败后的封禁时间（秒）", type: "number", min: 0, hint: "秒" }
        ] }
    ]
};
const allFields = Object.values(schema).flatMap(sections => sections.flatMap(section => section.fields));
const activeGroup = ref<GroupId>("downloads");
const currentGroup = computed(() => groups.find(group => group.id === activeGroup.value)!);
const baseline = ref<Preferences>({});
const draft = reactive<Preferences>({});
const serverAddress = ref("");
const serverPort = ref(0);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const success = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const proxyPassword = ref("");
const modal = ref<HTMLElement | null>(null);
let loadSequence = 0;
let previousFocus: HTMLElement | null = null;
let previousOverflow = "";

const enabled = (field: Field) => !field.enabled || field.enabled(draft);
const present = (field: Field) => Object.hasOwn(draft, field.key);
const changedValues = computed(() => {
    const changes: Preferences = {};
    const saved = baseline.value;
    for (const field of allFields) {
        if (present(field) && enabled(field) && draft[field.key] !== saved[field.key]) {
            changes[field.key] = field.scale ? Number(draft[field.key]) * field.scale : draft[field.key]!;
        }
    }
    // Enabling a share limit requires its value; the server clears it when disabled.
    if (changes.max_ratio_enabled === true)
        changes.max_ratio = Number(draft.max_ratio);
    if (changes.max_seeding_time_enabled === true)
        changes.max_seeding_time = Number(draft.max_seeding_time);
    if (newPassword.value)
        changes.web_ui_password = newPassword.value;
    if (proxyPassword.value && proxyAuthEnabled(draft))
        changes.proxy_password = proxyPassword.value;
    return changes;
});
const changedCount = computed(() => Object.keys(changedValues.value).length);
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : "操作失败，请稍后重试。";

const load = async () => {
    const sequence = ++loadSequence;
    loading.value = true;
    error.value = "";
    success.value = "";
    newPassword.value = "";
    confirmPassword.value = "";
    proxyPassword.value = "";
    try {
        const values = await apiGet<Record<string, unknown>>("app/preferences");
        if (sequence !== loadSequence || !props.open)
            return;
        for (const key of Object.keys(draft))
            delete draft[key];
        for (const field of allFields) {
            const value = values[field.key];
            if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
                draft[field.key] = field.scale ? Number(value) / field.scale : value;
        }
        baseline.value = { ...draft };
        serverAddress.value = String(values.web_ui_address ?? "");
        serverPort.value = Number(values.web_ui_port ?? 0);
    }
    catch (cause) {
        if (sequence === loadSequence)
            error.value = `无法读取设置：${errorMessage(cause)}`;
    }
    finally {
        if (sequence === loadSequence)
            loading.value = false;
    }
};

const update = (field: Field, event: Event) => {
    const control = event.target as HTMLInputElement;
    success.value = "";
    if (field.type === "toggle") {
        draft[field.key] = control.checked;
        if (field.key === "max_ratio_enabled" && control.checked && Number(draft.max_ratio) < 0)
            draft.max_ratio = 1;
        if (field.key === "max_seeding_time_enabled" && control.checked && Number(draft.max_seeding_time) < 0)
            draft.max_seeding_time = 1440;
    }
    else if (field.type === "number") {
        draft[field.key] = control.value === "" ? "" : Number(control.value);
    }
    else if (field.type === "select") {
        const option = field.options?.find(item => String(item.value) === control.value);
        if (option)
            draft[field.key] = option.value;
    }
    else {
        draft[field.key] = control.value;
    }
};

const validate = (): string => {
    for (const field of allFields) {
        if (!present(field) || !enabled(field))
            continue;
        const value = draft[field.key];
        if (field.type === "number") {
            if (value === "" || !Number.isFinite(Number(value)))
                return `请为「${field.label}」填写有效数值。`;
            if ((!field.step || field.step === 1) && !Number.isInteger(Number(value)))
                return `「${field.label}」需要填写整数。`;
            if (field.min !== undefined && Number(value) < field.min)
                return `「${field.label}」不能小于 ${field.min}。`;
            if (field.max !== undefined && Number(value) > field.max)
                return `「${field.label}」不能大于 ${field.max}。`;
        }
    }
    if (Object.hasOwn(changedValues.value, "save_path") && !isStoragePath(String(draft.save_path ?? "").trim()))
        return "默认下载目录应位于 /mnt 下可写的已挂载磁盘上，且不能包含 . 或 .. 路径段。";
    if (proxyEnabled(draft) && !String(draft.proxy_ip ?? "").trim())
        return "请填写代理服务器地址。";
    const username = String(draft.web_ui_username ?? "");
    if (username.trim().length < 3 || username.includes(":"))
        return "网页管理用户名至少需要 3 个字符，且不能包含冒号。";
    if (newPassword.value && newPassword.value.length < 6)
        return "新密码至少需要 6 个字符。";
    if (newPassword.value !== confirmPassword.value)
        return "两次输入的新密码不一致。";
    return "";
};

const save = async () => {
    error.value = validate();
    if (error.value || saving.value || !changedCount.value)
        return;
    saving.value = true;
    success.value = "";
    try {
        const accountChanged = Boolean(newPassword.value) || draft.web_ui_username !== baseline.value.web_ui_username;
        const changes = { ...changedValues.value };
        await apiPost("app/setPreferences", { json: JSON.stringify(changes) });
        const savedValues = { ...baseline.value };
        for (const field of allFields) {
            if (Object.hasOwn(changes, field.key))
                savedValues[field.key] = field.scale ? Number(changes[field.key]) / field.scale : changes[field.key]!;
        }
        baseline.value = savedValues;
        Object.assign(draft, savedValues);
        newPassword.value = "";
        confirmPassword.value = "";
        proxyPassword.value = "";
        success.value = accountChanged ? "设置已保存。下次登录请使用更新后的账号信息。" : "设置已保存，已立即生效。";
        emit("saved");
    }
    catch (cause) {
        error.value = `保存失败：${errorMessage(cause)}`;
    }
    finally {
        saving.value = false;
    }
};

const close = () => {
    if (!saving.value)
        emit("close");
};
const handleKeys = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
        event.preventDefault();
        close();
    }
    if (event.key !== "Tab" || !modal.value)
        return;
    const controls = [...modal.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
        .filter(element => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === modal.value)) {
        event.preventDefault();
        last?.focus();
    }
    else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
    }
};
watch(() => props.open, async open => {
    if (open) {
        previousFocus = document.activeElement as HTMLElement | null;
        previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        void load();
        await nextTick();
        modal.value?.focus();
    }
    else {
        ++loadSequence;
        document.body.style.overflow = previousOverflow;
        previousFocus?.focus();
        newPassword.value = "";
        confirmPassword.value = "";
        proxyPassword.value = "";
    }
}, { immediate: true });
onBeforeUnmount(() => {
    ++loadSequence;
    if (props.open)
        document.body.style.overflow = previousOverflow;
});
</script>

<template>
    <Teleport to="body">
        <div v-if="open" class="modal-backdrop settings-backdrop" @click.self="close">
            <section ref="modal" class="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1" @keydown="handleKeys">
                <header class="settings-header">

                    <div><h2 id="settings-title">设置</h2></div>
                    <button class="icon-button" type="button" aria-label="关闭设置" :disabled="saving" @click="close"><X :size="20" /></button>
                </header>
                <div v-if="loading" class="settings-loading" role="status"><LoaderCircle class="spin" :size="24" />加载中</div>
                <div v-else-if="!Object.keys(baseline).length" class="settings-loading">
                    <CircleAlert :size="25" /><p role="alert">{{ error }}</p><button class="button" @click="load">重新加载</button>
                </div>
                <div v-else class="settings-body">
                    <nav class="settings-nav" aria-label="设置分类">
                        <button v-for="group in groups" :key="group.id" type="button" :class="{ active: activeGroup === group.id }" :aria-current="activeGroup === group.id ? 'page' : undefined" @click="activeGroup = group.id">
                            <component :is="group.icon" :size="17" /><span>{{ group.label }}</span>
                        </button>
                    </nav>
                    <div class="settings-content">
                        <div class="settings-intro"><h3>{{ currentGroup.label }}</h3></div>
                        <section v-for="section in schema[activeGroup]" :key="section.title" class="settings-section">
                            <h4>{{ section.title }}</h4>
                            <div class="settings-grid">
                                <template v-for="field in section.fields" :key="field.key">
                                    <div v-if="present(field) && field.key === 'save_path'" class="field settings-field settings-full" :class="{ 'settings-disabled': !enabled(field) }">
                                        <span>{{ field.label }}</span>
                                        <SavePathPicker :id="`setting-${field.key}`" :model-value="String(draft[field.key] ?? '')" :disabled="!enabled(field) || saving" @update:model-value="draft[field.key] = $event" />
                                    </div>
                                    <label v-else-if="present(field)" class="field settings-field" :class="{ 'settings-toggle': field.type === 'toggle', 'settings-full': field.full, 'settings-disabled': !enabled(field) }" :for="`setting-${field.key}`">
                                        <span class="field-copy" :title="field.hint"><span>{{ field.label }}</span></span>
                                        <input v-if="field.type === 'toggle'" :id="`setting-${field.key}`" type="checkbox" :checked="Boolean(draft[field.key])" :disabled="!enabled(field) || saving" @change="update(field, $event)">
                                        <select v-else-if="field.type === 'select'" :id="`setting-${field.key}`" class="input" :value="draft[field.key]" :disabled="!enabled(field) || saving" @change="update(field, $event)">
                                            <option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option>
                                        </select>
                                        <input v-else :id="`setting-${field.key}`" class="input" :type="field.type" :title="field.hint" :aria-description="field.hint" :value="draft[field.key]" :min="field.min" :max="field.max" :step="field.step ?? 1" :disabled="!enabled(field) || saving" autocomplete="off" spellcheck="false" @input="update(field, $event)">
                                    </label>
                                </template>
                            </div>
                        </section>
                        <section v-if="activeGroup === 'connection' && proxyAuthEnabled(draft)" class="settings-section">
                            <label class="field settings-field" for="setting-proxy-password"><span>更换代理密码</span><input id="setting-proxy-password" v-model="proxyPassword" class="input" type="password" autocomplete="new-password" :disabled="saving" title="留空保留当前密码"></label>
                        </section>
                        <template v-if="activeGroup === 'webui'">
                            <section class="settings-section"><h4>更换登录密码</h4><div class="settings-grid">
                                <label class="field settings-field" for="setting-password"><span>新密码</span><input id="setting-password" v-model="newPassword" class="input" type="password" autocomplete="new-password" :disabled="saving" title="留空保留当前密码"></label>
                                <label class="field settings-field" for="setting-confirm-password"><span>再次输入新密码</span><input id="setting-confirm-password" v-model="confirmPassword" class="input" type="password" autocomplete="new-password" :disabled="saving" title="至少 6 个字符"></label>
                            </div></section>
                            <section class="settings-section"><h4>当前访问地址</h4><div class="settings-endpoint"><span>监听地址 <strong>{{ serverAddress }}</strong></span><span>端口 <strong>{{ serverPort }}</strong></span></div></section>
                        </template>
                        <p v-if="activeGroup === 'bittorrent' && draft.max_ratio_act === 3" class="settings-notice"><CircleAlert :size="17" />达到做种限制时，将同时删除任务和已下载的文件。</p>
                    </div>
                </div>
                <footer class="settings-footer">
                    <div class="settings-feedback" aria-live="polite"><span v-if="error && Object.keys(baseline).length" class="settings-error" role="alert"><CircleAlert :size="16" />{{ error }}</span><span v-else-if="success" class="settings-success"><Check :size="16" />{{ success }}</span><span v-else>{{ changedCount ? `${changedCount} 项未保存` : '' }}</span></div>
                    <div class="settings-actions"><button class="button ghost" type="button" :disabled="saving" @click="close">关闭</button><button class="button primary" type="button" :disabled="loading || saving || !changedCount" @click="save"><LoaderCircle v-if="saving" class="spin" :size="16" /><Check v-else :size="16" />{{ saving ? '保存中…' : '保存更改' }}</button></div>
                </footer>
            </section>
        </div>
    </Teleport>
</template>

<style scoped>
.settings-backdrop { padding: 24px; }
.settings-modal { display: flex; flex-direction: column; max-height: min(820px, calc(100dvh - 48px)); max-width: 900px; overflow: hidden; padding: 0; width: 100%; }
.settings-header { align-items: center; border-bottom: 1px solid var(--border); display: flex; flex: 0 0 auto; gap: 14px; padding: 14px 18px; }
.settings-header h2 { font-size: 20px; letter-spacing: -0.5px; margin: 0 0 4px; }
.settings-header p, .settings-intro p { color: var(--muted); font-size: 12px; margin: 0; }
.settings-header > .icon-button { margin-left: auto; }
.settings-loading { align-items: center; color: var(--muted); display: flex; flex-direction: column; gap: 14px; min-height: 330px; padding: 60px 24px; text-align: center; }
.settings-body { display: flex; min-height: 0; }
.settings-nav { background: var(--surface-2); border-right: 1px solid var(--border); display: flex; flex: 0 0 190px; flex-direction: column; gap: 5px; overflow-y: auto; padding: 20px 12px; }
.settings-nav button { align-items: center; background: transparent; border: 0; border-radius: 4px; color: var(--muted); cursor: pointer; display: flex; font: inherit; font-size: 13px; gap: 10px; padding: 12px; text-align: left; white-space: nowrap; }
.settings-nav button:hover { background: var(--surface); color: var(--text); }
.settings-nav button.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.settings-content { flex: 1; min-height: 0; min-width: 0; overflow-y: auto; padding: 26px; }
.settings-intro { margin-bottom: 26px; }
.settings-intro h3 { font-size: 20px; letter-spacing: -0.5px; margin: 0 0 7px; }
.settings-section + .settings-section { border-top: 1px solid var(--border); margin-top: 26px; padding-top: 24px; }
.settings-section h4 { font-size: 13px; font-weight: 600; margin: 0 0 17px; }
.settings-grid { display: grid; gap: 18px 20px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.settings-field { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.settings-field > span, .field-copy > span { font-size: 12px; }
.field-copy { display: flex; flex-direction: column; gap: 5px; }
.field-copy small { color: var(--muted); font-size: 11px; line-height: 1.5; }
.settings-field .input { min-height: 39px; width: 100%; }
.settings-full, .settings-toggle { grid-column: 1 / -1; }
.settings-toggle { align-items: center; flex-direction: row; justify-content: space-between; min-height: 35px; }
.settings-toggle input { accent-color: var(--accent); cursor: pointer; flex: 0 0 17px; height: 17px; width: 17px; }
.settings-disabled { opacity: 0.5; }
.settings-disabled input { cursor: default; }
.settings-endpoint { color: var(--muted); display: flex; font-size: 12px; gap: 28px; }
.settings-endpoint strong { color: var(--text); font-family: ui-monospace, monospace; font-weight: 500; margin-left: 8px; }
.settings-hint { color: var(--muted); font-size: 11px; margin: 12px 0 0; }
.settings-notice { align-items: flex-start; background: var(--accent-soft); border-radius: 4px; display: flex; font-size: 12px; gap: 8px; line-height: 1.7; padding: 12px; }
.settings-notice svg { flex: 0 0 auto; margin-top: 2px; }
.settings-footer { align-items: center; border-top: 1px solid var(--border); display: flex; flex: 0 0 auto; gap: 16px; justify-content: space-between; padding: 16px 24px; }
.settings-feedback { color: var(--muted); font-size: 11px; line-height: 1.6; min-width: 0; }
.settings-feedback > span { align-items: center; display: flex; gap: 6px; }
.settings-feedback svg { flex: 0 0 auto; }
.settings-error { color: var(--danger); }
.settings-success { color: var(--success); }
.settings-actions { display: flex; flex: 0 0 auto; gap: 9px; }
.spin { animation: settings-spin 1s linear infinite; }
@keyframes settings-spin { to { transform: rotate(360deg); } }
@media (width <= 680px) {
    .settings-backdrop { padding: 10px; }
    .settings-modal { max-height: calc(100dvh - 20px); }
    .settings-header { padding: 16px; }
    .settings-header p { display: none; }
    .settings-body { flex-direction: column; }
    .settings-nav { border-bottom: 1px solid var(--border); border-right: 0; flex: 0 0 auto; flex-direction: row; overflow-x: auto; padding: 8px; }
    .settings-nav button { font-size: 12px; padding: 10px; }
    .settings-content { padding: 20px 18px; }
    .settings-grid { grid-template-columns: 1fr; }
    .settings-footer { align-items: stretch; flex-direction: column; gap: 10px; padding: 14px 16px; }
    .settings-actions { justify-content: flex-end; }
}
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
