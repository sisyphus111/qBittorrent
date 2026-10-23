import { computed, reactive } from 'vue';
import { apiGet } from './api';

export interface StorageVolume {
    id: string;
    label: string;
    paths: string[];
    writable_paths: string[];
    mounted: boolean;
    total: number;
    used: number;
    reserved: number;
    available: number;
    pending: number;
    projected_free: number;
    shortfall: number;
    task_count: number;
    unknown_count: number;
    unsettled_count: number;
    cross_volume_count: number;
}
interface Snapshot {
    volumes: StorageVolume[];
    sampled_at?: number;
    refreshing: boolean;
    unmapped_tasks?: number;
    preallocation?: boolean;
}
export const storageState = reactive({
    volumes: [] as StorageVolume[], loaded: false, loading: false, refreshing: false,
    sampledAt: 0, error: '', unmappedTasks: 0, preallocation: false,
});
let monitoring = false;
let forceQueued = false;
let failures = 0;
let generation = 0;
let request: Promise<void> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

export const refreshStorage = (force = false): Promise<void> => {
    if (request) { forceQueued ||= force; return request; }
    clearTimeout(timer);
    const current = generation;
    storageState.loading = true;
    request = (async () => {
        try {
            const data = await apiGet<Snapshot>('app/storageInfo', force ? { force: true } : {});
            if (current !== generation) return;
            storageState.volumes = data.volumes;
            storageState.loaded = Boolean(data.sampled_at);
            storageState.sampledAt = data.sampled_at || 0;
            storageState.refreshing = data.refreshing;
            storageState.unmappedTasks = data.unmapped_tasks || 0;
            storageState.preallocation = Boolean(data.preallocation);
            storageState.error = '';
            failures = 0;
        } catch (failure) {
            if (current === generation) { storageState.error = (failure as Error).message; failures++; }
        } finally {
            if (current === generation) {
                request = undefined;
                storageState.loading = false;
                clearTimeout(timer);
                if (forceQueued) {
                    forceQueued = false;
                    void refreshStorage(true);
                } else if (monitoring) {
                    const delay = document.hidden ? 30000 : failures ? Math.min(4000 * 2 ** Math.min(failures - 1, 3), 30000) : storageState.refreshing ? 250 : 4000;
                    timer = setTimeout(() => { void refreshStorage(); }, delay);
                }
            }
        }
    })();
    return request;
};
const visibility = () => {
    if (!monitoring) return;
    clearTimeout(timer);
    if (document.hidden) timer = setTimeout(() => { void refreshStorage(); }, 30000);
    else void refreshStorage(true);
};
const online = () => { if (monitoring) void refreshStorage(true); };
export const startStorageMonitoring = () => {
    if (!monitoring) {
        document.addEventListener('visibilitychange', visibility);
        window.addEventListener('online', online);
    }
    monitoring = true;
    void refreshStorage(true);
};
export const stopStorageMonitoring = () => {
    monitoring = false; generation++; clearTimeout(timer); request = undefined;
    forceQueued = false; failures = 0;
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('online', online);
    Object.assign(storageState, { volumes: [], loaded: false, loading: false, refreshing: false, sampledAt: 0, error: '', unmappedTasks: 0, preallocation: false });
};
export const storageRoots = computed(() => storageState.volumes.flatMap(volume => volume.paths.map(path => ({
    path, label: path.split('/').at(-1) || path, volume,
    writable: volume.mounted && volume.writable_paths.includes(path),
}))));
export const storageRootFor = (path: string) => storageRoots.value
    .filter(root => path === root.path || path.startsWith(`${root.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
export const validStoragePathSyntax = (path: string) => path.startsWith('/mnt/')
    && !/[\u0000-\u001f\u007f]/.test(path)
    && !path.split('/').some(part => part === '.' || part === '..');
export const isStoragePath = (path: string) => validStoragePathSyntax(path) && Boolean(storageRootFor(path)?.writable);
// Keep a configured but disconnected path visible; never silently switch disks.
export const defaultStoragePath = (path: string) => validStoragePathSyntax(path)
    ? path.replace(/\/+$/, '') : storageRoots.value.find(root => root.writable)?.path || '';
