export interface PreviewFile {
    path: string;
    length: number;
    priority?: number;
}

export interface DownloadNode {
    id: string;
    path: string;
    name: string;
    directory: boolean;
    size: number;
    skipped: boolean;
    conflict: boolean;
    children: DownloadNode[];
}

// Paths already contain any root folder supplied by the torrent. A torrent's
// display name is not a directory and must never add another level to the tree.
export const buildDownloadTree = (files: PreviewFile[]): DownloadNode[] => {
    const roots: DownloadNode[] = [];
    const directories = new Map<string, DownloadNode>();
    const destinations = new Map<string, DownloadNode[]>();
    const register = (node: DownloadNode) => {
        const matching = destinations.get(node.path) || [];
        matching.push(node);
        if (matching.length > 1) matching.forEach(item => { item.conflict = true; });
        destinations.set(node.path, matching);
    };
    files.forEach((file, index) => {
        const segments = file.path.split('/');
        let siblings = roots;
        const parents: DownloadNode[] = [];
        for (let depth = 0; depth < segments.length - 1; depth++) {
            const path = segments.slice(0, depth + 1).join('/');
            let directory = directories.get(path);
            if (!directory) {
                directory = { id: `dir:${path}`, path, name: segments[depth], directory: true, size: 0, skipped: true, conflict: false, children: [] };
                directories.set(path, directory);
                siblings.push(directory);
                register(directory);
            }
            parents.push(directory);
            siblings = directory.children;
        }
        const node: DownloadNode = {
            id: `file:${index}:${file.path}`, path: file.path, name: segments.at(-1) || file.path,
            directory: false, size: file.length, skipped: file.priority === 0, conflict: false, children: [],
        };
        siblings.push(node);
        register(node);
        if (!node.skipped) parents.forEach(parent => { parent.size += node.size; parent.skipped = false; });
    });
    const sort = (nodes: DownloadNode[]) => {
        nodes.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
        nodes.forEach(node => { if (node.directory) sort(node.children); });
    };
    sort(roots);
    return roots;
};

export const downloadDestination = (root: string, relative: string): string =>
    root ? `${root.replace(/\/+$/, '')}/${relative}` : '';
