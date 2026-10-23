<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ArrowDownToLine, BookOpen, CheckCheck, ChevronRight, CircleAlert, ExternalLink, Folder, Inbox, LoaderCircle, Plus, Rss, Search, Trash2, X } from "lucide-vue-next";
import { apiGet, apiPost } from "../api";

type Article = { id: string; title: string; date: string; description?: string; author?: string; torrentURL?: string; link?: string; isRead: boolean };
type Feed = { uid: string; url: string; title: string; path: string; folder: string; isLoading: boolean; hasError: boolean; articles: Article[] };
type ArticleEntry = { key: string; feed: Feed; article: Article };
const emit = defineEmits<{ "add-url": [url: string] }>();
const feeds = ref<Feed[]>([]);
const folders = ref<string[]>([]);
const selectedFeedId = ref("");
const selectedArticleKey = ref("");
const query = ref("");
const unreadOnly = ref(false);
const processingEnabled = ref<boolean | null>(null);
const loading = ref(false);
const busy = ref("");
const error = ref("");
const notice = ref("");
const adding = ref(false);
const feedUrl = ref("");
const feedName = ref("");
const feedFolder = ref("");
const pendingDelete = ref<Feed | null>(null);
const visibleLimit = ref(200);
let sequence = 0;
let pendingLoads = 0;
let poll: ReturnType<typeof setInterval> | undefined;
let disposed = false;
const selectedFeed = computed(() => feeds.value.find(feed => feed.uid === selectedFeedId.value));
const unreadCount = (feed: Feed) => feed.articles.filter(article => !article.isRead).length;
const totalUnread = computed(() => feeds.value.reduce((sum, feed) => sum + unreadCount(feed), 0));
const allArticles = computed<ArticleEntry[]>(() => feeds.value.flatMap(feed => feed.articles.map(article => ({
    key: `${feed.uid}:${article.id}`, feed, article
}))).sort((left, right) => (Date.parse(right.article.date) || 0) - (Date.parse(left.article.date) || 0)));
const filteredArticles = computed(() => {
    const term = query.value.trim().toLocaleLowerCase();
    return allArticles.value.filter(entry => (!selectedFeedId.value || entry.feed.uid === selectedFeedId.value)
        && (!unreadOnly.value || !entry.article.isRead)
        && (!term || entry.article.title.toLocaleLowerCase().includes(term)));
});
const visibleArticles = computed(() => filteredArticles.value.slice(0, visibleLimit.value));
const selectedArticle = computed(() => allArticles.value.find(entry => entry.key === selectedArticleKey.value));
const dateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const formatDate = (date: string) => Number.isFinite(Date.parse(date)) ? dateFormatter.format(new Date(date)) : "日期未知";
const problem = (cause: unknown) => cause instanceof Error ? cause.message : "操作失败，请稍后重试。";
const safeUrl = (value: string | undefined, torrent = false): string => {
    if (!value)
        return "";
    try {
        const parsed = new URL(value);
        return ["http:", "https:", ...(torrent ? ["magnet:"] : [])].includes(parsed.protocol) ? parsed.href : "";
    }
    catch { return ""; }
};
const torrentUrl = computed(() => safeUrl(selectedArticle.value?.article.torrentURL, true));
const articleLink = computed(() => safeUrl(selectedArticle.value?.article.link));
const plainDescription = computed(() => {
    const html = selectedArticle.value?.article.description ?? "";
    // Template contents remain inert; only their text is ever rendered into the page.
    const template = document.createElement("template");
    template.innerHTML = html;
    for (const unwanted of template.content.querySelectorAll("script, style, noscript"))
        unwanted.remove();
    for (const breakElement of template.content.querySelectorAll("br, p, div, li, h1, h2, h3"))
        breakElement.append(document.createTextNode("\n"));
    return (template.content.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n/g, "\n\n").trim();
});
const articleFrom = (value: unknown): Article | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return undefined;
    const article = value as Record<string, unknown>;
    if (typeof article.id !== "string")
        return undefined;
    const text = (key: string) => typeof article[key] === "string" ? article[key] as string : "";
    return { id: article.id, title: text("title"), date: text("date"), description: text("description"),
        author: text("author"), torrentURL: text("torrentURL"), link: text("link"), isRead: article.isRead === true };
};

const flatten = (tree: Record<string, unknown>) => {
    const nextFeeds: Feed[] = [];
    const nextFolders: string[] = [];
    const visit = (items: Record<string, unknown>, parent = "") => {
        for (const [name, item] of Object.entries(items)) {
            if (!item || typeof item !== "object" || Array.isArray(item))
                continue;
            const value = item as Record<string, unknown>;
            const path = parent ? `${parent}\\${name}` : name;
            if (typeof value.url === "string" && typeof value.uid === "string") {
                nextFeeds.push({ uid: value.uid, url: value.url, title: String(value.title || name), path, folder: parent,
                    isLoading: value.isLoading === true, hasError: value.hasError === true,
                    articles: Array.isArray(value.articles) ? value.articles.map(articleFrom).filter((article): article is Article => Boolean(article)) : [] });
            }
            else {
                nextFolders.push(path);
                visit(value, path);
            }
        }
    };
    visit(tree);
    return { nextFeeds, nextFolders };
};
const loadItems = async (initial = false) => {
    const current = ++sequence;
    ++pendingLoads;
    if (initial)
        loading.value = true;
    try {
        const [tree, preferences] = await Promise.all([
            apiGet<Record<string, unknown>>("rss/items", { withData: true }),
            initial ? apiGet<Record<string, unknown>>("app/preferences") : Promise.resolve(null)
        ]);
        if (disposed || current !== sequence)
            return;
        const { nextFeeds, nextFolders } = flatten(tree);
        feeds.value = nextFeeds;
        folders.value = nextFolders;
        if (preferences)
            processingEnabled.value = preferences.rss_processing_enabled === true;
        if (selectedFeedId.value && !nextFeeds.some(feed => feed.uid === selectedFeedId.value))
            selectedFeedId.value = "";
        error.value = "";
    }
    catch (cause) {
        if (!disposed && current === sequence)
            error.value = problem(cause);
    }
    finally {
        --pendingLoads;
        if (current === sequence)
            loading.value = false;
    }
};
const perform = async (name: string, action: () => Promise<void>) => {
    if (busy.value)
        return;
    busy.value = name;
    error.value = "";
    notice.value = "";
    try { await action(); }
    catch (cause) { error.value = problem(cause); }
    finally { busy.value = ""; }
};
const chooseFeed = (uid: string) => {
    selectedFeedId.value = uid;
    selectedArticleKey.value = "";
    visibleLimit.value = 200;
};
const enable = () => perform("enable", async () => {
    await apiPost("app/setPreferences", { json: JSON.stringify({ rss_processing_enabled: true }) });
    processingEnabled.value = true;
    notice.value = "RSS 订阅已启用。";
    await loadItems();
});

const addFeed = () => perform("add", async () => {
    const url = safeUrl(feedUrl.value.trim());
    if (!url)
        throw new Error("请输入有效的 HTTP 或 HTTPS 订阅地址。");
    const name = feedName.value.trim();
    if (name.includes("\\"))
        throw new Error("订阅名称不能包含反斜杠，请在下方选择文件夹。");
    const path = feedFolder.value ? `${feedFolder.value}\\${name || url}` : name;
    await apiPost("rss/addFeed", { url, path });
    adding.value = false;
    feedUrl.value = "";
    feedName.value = "";
    feedFolder.value = "";
    await loadItems();
    const added = feeds.value.find(feed => feed.url === url);
    if (added)
        chooseFeed(added.uid);
    notice.value = "订阅已添加。";
});
const removeFeed = () => perform("delete", async () => {
    const feed = pendingDelete.value;
    if (!feed)
        return;
    await apiPost("rss/removeItem", { path: feed.path });
    pendingDelete.value = null;
    selectedArticleKey.value = "";
    await loadItems();
    notice.value = "订阅已删除。";
});
const selectArticle = async (entry: ArticleEntry) => {
    selectedArticleKey.value = entry.key;
    if (entry.article.isRead)
        return;
    try {
        await apiPost("rss/markAsRead", { itemPath: entry.feed.path, articleId: entry.article.id });
        const article = feeds.value.find(feed => feed.uid === entry.feed.uid)?.articles.find(item => item.id === entry.article.id);
        if (article)
            article.isRead = true;
    }
    catch (cause) { error.value = `无法标记已读：${problem(cause)}`; }
};
const markRead = () => perform("mark", async () => {
    await apiPost("rss/markAsRead", { itemPath: selectedFeed.value?.path ?? "" });
    await loadItems();
    notice.value = "已标记为已读。";
});
const resumeFeeds = () => { if (!document.hidden && !busy.value && !pendingLoads) void loadItems(); };
onMounted(() => {
    document.addEventListener('visibilitychange', resumeFeeds);
    window.addEventListener('online', resumeFeeds);
    void loadItems(true);
    poll = setInterval(() => {
        if (!document.hidden && !busy.value && !pendingLoads)
            void loadItems();
    }, 8000);
});
onBeforeUnmount(() => {
    disposed = true;
    document.removeEventListener('visibilitychange', resumeFeeds);
    window.removeEventListener('online', resumeFeeds);
    ++sequence;
    if (poll)
        clearInterval(poll);
});
</script>

<template>
    <section class="rss-workspace" aria-labelledby="rss-title">
        <header class="rss-header">
            <div><h2 id="rss-title">RSS 订阅</h2></div>
            <div class="rss-header-actions"><button class="button primary" type="button" :disabled="Boolean(busy)" @click="adding = !adding"><Plus :size="17" />添加订阅</button></div>
        </header>
        <div v-if="processingEnabled === false" class="rss-disabled"><div><strong>RSS 未启用</strong></div><button class="button primary" :disabled="Boolean(busy)" @click="enable"><LoaderCircle v-if="busy === 'enable'" class="spin" :size="15" />启用 RSS</button></div>
        <form v-if="adding" class="rss-add-form" @submit.prevent="addFeed">
            <div class="rss-add-heading"><h3>添加订阅</h3><button class="icon-button" type="button" aria-label="关闭添加订阅" :disabled="Boolean(busy)" @click="adding = false"><X :size="17" /></button></div>
            <label class="field rss-add-url">订阅地址<input v-model="feedUrl" class="input" type="url" placeholder="https://example.com/feed.xml" required :disabled="Boolean(busy)"></label>
            <label class="field">名称（可选）<input v-model="feedName" class="input" type="text" :disabled="Boolean(busy)"></label>
            <label v-if="folders.length" class="field">文件夹<select v-model="feedFolder" class="input" :disabled="Boolean(busy)"><option value="">订阅根目录</option><option v-for="folder in folders" :key="folder" :value="folder">{{ folder.replaceAll('\\', ' / ') }}</option></select></label>
            <button class="button primary rss-add-submit" type="submit" :disabled="Boolean(busy) || !feedUrl.trim()"><LoaderCircle v-if="busy === 'add'" class="spin" :size="15" /><Plus v-else :size="15" />添加订阅</button>
        </form>
        <div v-if="error" class="rss-message rss-error" role="alert"><CircleAlert :size="16" /><span>{{ error }}</span></div>
        <p v-else-if="notice" class="rss-message" role="status"><CheckCheck :size="15" />{{ notice }}</p>
        <div v-if="pendingDelete" class="rss-delete-confirm" role="alert"><CircleAlert :size="18" /><span>删除「{{ pendingDelete.title }}」及其文章？</span><div><button class="button ghost" :disabled="Boolean(busy)" @click="pendingDelete = null">取消</button><button class="button danger" :disabled="Boolean(busy)" @click="removeFeed">删除订阅</button></div></div>
        <div v-if="loading && !feeds.length" class="rss-empty" role="status"><LoaderCircle class="spin" :size="28" /><h3>加载中</h3></div>
        <div v-else-if="!feeds.length" class="rss-empty"><h3>暂无订阅</h3><button class="button primary" @click="adding = true"><Plus :size="16" />添加订阅</button></div>
        <div v-else class="rss-body">
            <aside class="rss-feeds" aria-label="订阅源">
                <button class="rss-feed" :class="{ selected: !selectedFeedId }" :aria-pressed="!selectedFeedId" @click="chooseFeed('')"><Inbox :size="17" /><span class="rss-feed-name">全部文章</span><span class="rss-count">{{ totalUnread }}</span></button>
                <div class="rss-feed-heading">订阅源 <span>{{ feeds.length }}</span></div>
                <button v-for="feed in feeds" :key="feed.uid" class="rss-feed" :class="{ selected: selectedFeedId === feed.uid }" :aria-pressed="selectedFeedId === feed.uid" :title="feed.path" @click="chooseFeed(feed.uid)"><LoaderCircle v-if="feed.isLoading" class="spin" :size="16" /><CircleAlert v-else-if="feed.hasError" class="rss-feed-error" :size="16" /><Rss v-else :size="16" /><span class="rss-feed-name">{{ feed.title }}<small v-if="feed.folder"><Folder :size="10" />{{ feed.folder.replaceAll('\\', ' / ') }}</small></span><span v-if="unreadCount(feed)" class="rss-count">{{ unreadCount(feed) }}</span></button>
            </aside>
            <div class="rss-articles">
                <div class="rss-article-toolbar"><label class="rss-search"><Search :size="15" /><input v-model="query" class="input" type="search" placeholder="搜索文章…" aria-label="搜索 RSS 文章" @input="visibleLimit = 200"></label><button class="icon-button" title="全部标记为已读" aria-label="全部标记为已读" :disabled="Boolean(busy)" @click="markRead"><CheckCheck :size="18" /></button><button v-if="selectedFeed" class="icon-button" title="删除此订阅" aria-label="删除此订阅" :disabled="Boolean(busy)" @click="pendingDelete = selectedFeed"><Trash2 :size="16" /></button></div>
                <div class="rss-article-filter"><span>{{ filteredArticles.length }} 篇文章</span><label><input v-model="unreadOnly" type="checkbox">只看未读</label></div>
                <p v-if="selectedFeed?.hasError" class="rss-feed-warning"><CircleAlert :size="14" />暂时无法获取此订阅</p>
                <div class="rss-article-list">
                    <div v-if="!filteredArticles.length" class="rss-list-empty"><BookOpen :size="26" /><p>{{ query || unreadOnly ? '没有匹配的文章' : '暂时没有新文章' }}</p></div>
                    <button v-for="entry in visibleArticles" :key="entry.key" class="rss-article-row" :class="{ selected: selectedArticleKey === entry.key, unread: !entry.article.isRead }" :aria-pressed="selectedArticleKey === entry.key" @click="selectArticle(entry)"><span class="rss-article-meta"><span>{{ entry.feed.title }}</span><time>{{ formatDate(entry.article.date) }}</time></span><strong>{{ entry.article.title || '未命名文章' }}</strong><span class="rss-read-state"><i v-if="!entry.article.isRead" aria-label="未读"></i>{{ entry.article.isRead ? '已读' : '未读' }}<ChevronRight :size="13" /></span></button>
                    <button v-if="filteredArticles.length > visibleLimit" class="button ghost rss-more" @click="visibleLimit += 200">显示更多文章</button>
                </div>
            </div>
            <section class="rss-reader" :class="{ 'has-article': selectedArticle }" aria-label="文章内容">
                <template v-if="selectedArticle">
                    <div class="rss-reader-source"><Rss :size="14" />{{ selectedArticle.feed.title }}</div><h3>{{ selectedArticle.article.title || '未命名文章' }}</h3><div class="rss-reader-meta"><time>{{ formatDate(selectedArticle.article.date) }}</time><span v-if="selectedArticle.article.author">{{ selectedArticle.article.author }}</span></div>
                    <div class="rss-reader-actions"><button v-if="torrentUrl" class="button primary" @click="emit('add-url', torrentUrl)"><ArrowDownToLine :size="16" />添加下载</button><a v-if="articleLink" class="button ghost" :href="articleLink" target="_blank" rel="noopener noreferrer">查看原文<ExternalLink :size="14" /></a></div>
                    <p class="rss-description">{{ plainDescription || '暂无摘要' }}</p>
                </template>
                <div v-else class="rss-reader-empty"><BookOpen :size="34" /><h3>未选择文章</h3></div>
            </section>
        </div>
    </section>
</template>

<style scoped>
.rss-workspace { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; display: flex; flex: 1; flex-direction: column; min-height: 0; overflow: hidden; }
.rss-header { align-items: center; display: flex; flex: 0 0 auto; gap: 20px; justify-content: space-between; padding: 14px 16px; }
.rss-header h2 { font-size: 16px; letter-spacing: -0.7px; margin: 0 0 7px; }
.rss-header p { color: var(--muted); font-size: 12px; margin: 0; }
.rss-header-actions { display: flex; gap: 8px; }
.rss-disabled { align-items: center; background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border)); border-radius: 4px; display: flex; flex: 0 0 auto; gap: 14px; margin: 0 26px 20px; padding: 17px 20px; }
.rss-disabled strong { font-size: 13px; font-weight: 550; }
.rss-disabled p { color: var(--muted); font-size: 11px; margin: 4px 0 0; }
.rss-disabled .button { margin-left: auto; }
.rss-add-form { align-items: end; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; display: grid; flex: 0 0 auto; gap: 16px; grid-template-columns: 1fr 1fr; margin: 0 26px 20px; padding: 18px; }
.rss-add-heading { align-items: center; display: flex; grid-column: 1 / -1; justify-content: space-between; }
.rss-add-heading h3 { font-size: 14px; }
.rss-add-url { grid-column: 1 / -1; }
.rss-add-form .input { width: 100%; }
.rss-add-submit { justify-self: end; }
.rss-message { align-items: center; color: var(--muted); display: flex; flex: 0 0 auto; font-size: 11px; gap: 8px; margin: 0; padding: 10px 26px; }
.rss-error { background: color-mix(in srgb, var(--danger) 7%, var(--surface)); color: var(--danger); }
.rss-error .button { margin-left: auto; }
.rss-delete-confirm { align-items: center; background: color-mix(in srgb, var(--danger) 7%, var(--surface)); color: var(--danger); display: flex; flex: 0 0 auto; font-size: 12px; gap: 10px; padding: 14px 26px; }
.rss-delete-confirm > div { display: flex; gap: 7px; margin-left: auto; }
.rss-body { border-top: 1px solid var(--border); display: grid; flex: 1; grid-template-columns: 200px minmax(230px, 0.9fr) minmax(290px, 1.1fr); min-height: 0; }
.rss-feeds { background: var(--surface-2); border-right: 1px solid var(--border); overflow: auto; padding: 16px 10px; }
.rss-feed { align-items: center; background: transparent; border: 0; border-radius: 4px; color: var(--muted); display: flex; font: inherit; font-size: 12px; gap: 8px; padding: 11px 10px; text-align: left; width: 100%; }
.rss-feed:hover { background: var(--surface); }
.rss-feed.selected { background: var(--accent-soft); color: var(--accent); }
.rss-feed-name { flex: 1; line-height: 1.5; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rss-feed-name small { align-items: center; color: var(--muted); display: flex; font-size: 9px; gap: 4px; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; }
.rss-feed-error { color: var(--danger); }
.rss-count { font-size: 10px; font-variant-numeric: tabular-nums; }
.rss-feed-heading { color: var(--muted); display: flex; font-size: 10px; justify-content: space-between; letter-spacing: 1px; padding: 23px 10px 9px; }
.rss-articles { border-right: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.rss-article-toolbar { align-items: center; display: flex; flex: 0 0 auto; gap: 6px; padding: 16px 14px 10px; }
.rss-search { color: var(--muted); flex: 1; min-width: 0; position: relative; }
.rss-search > svg { left: 10px; position: absolute; top: 12px; }
.rss-search input { font-size: 11px; padding-left: 31px; width: 100%; }
.rss-article-filter { align-items: center; color: var(--muted); display: flex; flex: 0 0 auto; font-size: 10px; justify-content: space-between; padding: 5px 17px 14px; }
.rss-article-filter label { align-items: center; display: flex; gap: 5px; }
.rss-article-filter input { accent-color: var(--accent); }
.rss-feed-warning { align-items: flex-start; color: var(--danger); display: flex; font-size: 11px; gap: 7px; line-height: 1.6; margin: 0; padding: 8px 15px; }
.rss-article-list { border-top: 1px solid var(--border); flex: 1; min-height: 0; overflow: auto; }
.rss-article-row { background: transparent; border: 0; border-bottom: 1px solid var(--border); color: var(--text); display: flex; flex-direction: column; font: inherit; gap: 8px; padding: 18px; text-align: left; width: 100%; }
.rss-article-row:hover { background: var(--surface-2); }
.rss-article-row.selected { background: var(--accent-soft); box-shadow: inset 3px 0 var(--accent); }
.rss-article-row strong { display: -webkit-box; font-size: 12px; font-weight: 450; line-height: 1.7; overflow: hidden; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.rss-article-row.unread strong { font-weight: 650; }
.rss-article-meta { align-items: center; color: var(--muted); display: flex; font-size: 9px; gap: 9px; justify-content: space-between; width: 100%; }
.rss-article-meta > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rss-article-meta time { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
.rss-read-state { align-items: center; color: var(--muted); display: flex; font-size: 9px; gap: 5px; width: 100%; }
.rss-read-state i { background: var(--accent); border-radius: 50%; height: 5px; width: 5px; }
.rss-read-state svg { margin-left: auto; }
.rss-more { margin: 16px; }
.rss-reader { min-width: 0; overflow: auto; padding: 30px 28px; }
.rss-reader-source { align-items: center; color: var(--accent); display: flex; font-size: 11px; gap: 7px; margin-bottom: 17px; }
.rss-reader > h3 { font-size: 21px; font-weight: 600; letter-spacing: -0.4px; line-height: 1.7; margin: 0 0 14px; overflow-wrap: anywhere; }
.rss-reader-meta { color: var(--muted); display: flex; flex-wrap: wrap; font-size: 10px; gap: 12px; }
.rss-reader-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 24px 0; }
.rss-description { border-top: 1px solid var(--border); font-size: 13px; line-height: 2; margin: 0; overflow-wrap: anywhere; padding-top: 22px; white-space: pre-wrap; }
.rss-empty, .rss-reader-empty, .rss-list-empty { align-items: center; color: var(--muted); display: flex; flex: 1; flex-direction: column; justify-content: center; min-height: 280px; padding: 40px 24px; text-align: center; }
.rss-empty > h3, .rss-reader-empty h3 { color: var(--text); font-size: 16px; font-weight: 550; margin: 18px 0 8px; }
.rss-empty p, .rss-reader-empty p, .rss-list-empty p { font-size: 12px; line-height: 1.8; margin: 0; max-width: 320px; }
.rss-empty .button { margin-top: 24px; }
.rss-reader-empty > svg, .rss-list-empty > svg { color: var(--accent); margin-bottom: 7px; opacity: 0.65; }
.rss-reader-empty { height: 100%; padding-inline: 0; }
.rss-reader-empty h3 { font-size: 14px; }
.spin { animation: rss-spin 1s linear infinite; }
@keyframes rss-spin { to { transform: rotate(360deg); } }
@media (width <= 1200px) {
    .rss-body { grid-template-columns: 170px minmax(220px, 1fr); }
    .rss-reader { border-top: 1px solid var(--border); grid-column: 1 / -1; max-height: 400px; }
    .rss-reader:not(.has-article) { display: none; }
    .rss-feeds, .rss-articles { max-height: 380px; }
    .rss-body { overflow: auto; }
}
@media (width <= 700px) {
    .rss-header { align-items: flex-start; flex-direction: column; gap: 16px; padding: 22px 20px; }
    .rss-header-actions { width: 100%; }
    .rss-header-actions .button { flex: 1; }
    .rss-disabled { flex-wrap: wrap; margin-inline: 16px; padding: 14px; }
    .rss-disabled .button { margin-left: 54px; }
    .rss-disabled-icon { flex-basis: 36px; height: 36px; }
    .rss-disabled > div { flex: 1; min-width: 140px; }
    .rss-add-form { grid-template-columns: 1fr; margin-inline: 16px; }
    .rss-add-submit { justify-self: stretch; }
    .rss-body { display: flex; flex-direction: column; }
    .rss-feeds { border-bottom: 1px solid var(--border); border-right: 0; display: flex; flex: 0 0 auto; gap: 5px; overflow-x: auto; padding: 10px; }
    .rss-feed { flex: 0 0 auto; max-width: 180px; width: auto; }
    .rss-feed-heading { display: none; }
    .rss-articles { border-right: 0; flex: 0 0 370px; max-height: none; }
    .rss-reader { flex: 0 0 auto; max-height: none; padding: 24px 20px; }
    .rss-reader > h3 { font-size: 19px; }
    .rss-delete-confirm { flex-wrap: wrap; padding: 14px; }
    .rss-delete-confirm > span { flex: 1; }
    .rss-delete-confirm > div { justify-content: flex-end; width: 100%; }
}
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
