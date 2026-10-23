<script setup lang="ts">
import { ref } from 'vue';
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from 'lucide-vue-next';
import type { DownloadNode } from '../downloadTree';
import { downloadDestination } from '../downloadTree';
import { bytes } from '../format';

defineProps<{ node: DownloadNode; root: string; selectedId: string }>();
const emit = defineEmits<{ select: [id: string] }>();
const expanded = ref(true);
const visible = ref(100);
</script>

<template>
    <li class="tree-node">
        <button type="button" class="tree-row" :class="{ selected: selectedId === node.id, skipped: node.skipped }" :aria-expanded="node.directory ? expanded : undefined" :aria-current="selectedId === node.id ? 'true' : undefined" :title="downloadDestination(root, node.path)" @click="emit('select', node.id); node.directory && (expanded = !expanded)">
            <component :is="expanded ? ChevronDown : ChevronRight" v-if="node.directory" :size="13" class="disclosure" />
            <span v-else class="disclosure-spacer" />
            <component :is="node.directory ? (expanded ? FolderOpen : Folder) : File" :size="15" :class="{ 'folder-icon': node.directory }" />
            <span class="node-name">{{ node.name }}</span>
            <small v-if="node.conflict" class="path-conflict">同路径</small>
            <small class="node-size">{{ node.skipped ? '不下载' : bytes(node.size) }}</small>
        </button>
        <ul v-if="node.directory && expanded" class="tree-children">
            <DownloadTreeNode v-for="child in node.children.slice(0, visible)" :key="child.id" :node="child" :root="root" :selected-id="selectedId" @select="emit('select', $event)" />
            <li v-if="node.children.length > visible"><button class="button ghost" type="button" @click="visible += 100">再显示 {{ Math.min(100, node.children.length - visible) }} 项</button></li>
        </ul>
    </li>
</template>

<style scoped>
.tree-node { min-width: 0; }
.tree-row { display: flex; align-items: flex-start; gap: 6px; width: 100%; border: 0; border-radius: 3px; padding: 7px 6px; background: transparent; text-align: left; font-size: 12px; }
.tree-row:hover { background: var(--row-hover); }
.tree-row.selected { background: var(--accent-soft); }
.tree-row > svg { margin-top: 2px; color: var(--muted); }
.tree-row > .folder-icon { color: var(--accent); }
.disclosure-spacer { width: 13px; flex-shrink: 0; }
.node-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.node-size { white-space: nowrap; font-size: 10px; color: var(--muted); margin-left: 4px; padding-top: 1px; }
.path-conflict { color: var(--danger); white-space: nowrap; font-size: 10px; }
.skipped .node-name { text-decoration: line-through; color: var(--muted); }
.tree-children { list-style: none; margin: 0 0 0 12px; padding: 0 0 0 12px; border-left: 1px solid var(--border-subtle); }
</style>
