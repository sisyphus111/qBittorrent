import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDownloadTree, downloadDestination } from '../src/downloadTree.ts';

test('single-file torrents save directly under the chosen destination', () => {
    const [file] = buildDownloadTree([{ path: 'Episode 01.mkv', length: 200 }]);
    assert.equal(file.directory, false);
    assert.equal(file.name, 'Episode 01.mkv');
    assert.equal(downloadDestination('/mnt/disk2', file.path), '/mnt/disk2/Episode 01.mkv');
    assert.equal(downloadDestination('/mnt/disk1/Bangumi/', file.path), '/mnt/disk1/Bangumi/Episode 01.mkv');
});
test('only actual path segments create folders, shared folders merge across tasks', () => {
    const [series] = buildDownloadTree([
        { path: 'Series/Season 1/02.mkv', length: 20 },
        { path: 'Series/Season 1/01.mkv', length: 10 },
        { path: 'Series/字幕/01.srt', length: 2 },
    ]);
    assert.equal(series.name, 'Series');
    assert.equal(series.size, 32);
    assert.equal(series.children.length, 2);
    const season = series.children.find(node => node.name === 'Season 1');
    assert.deepEqual(season.children.map(node => node.name), ['01.mkv', '02.mkv']);
    assert.equal(downloadDestination('/mnt/disk2/动画', season.children[0].path), '/mnt/disk2/动画/Series/Season 1/01.mkv');
});
test('excluded files remain marked and do not inflate folder download sizes', () => {
    const [folder] = buildDownloadTree([{ path: 'Series/episode.mkv', length: 20 }, { path: 'Series/extra.txt', length: 5, priority: 0 }]);
    assert.equal(folder.size, 20);
    assert.equal(folder.skipped, false);
    assert.equal(folder.children.find(node => node.name === 'extra.txt').skipped, true);
});
test('colliding file destinations are retained and flagged rather than silently hidden', () => {
    const tree = buildDownloadTree([{ path: 'same.bin', length: 10 }, { path: 'same.bin', length: 20 }, { path: 'same.bin/child', length: 1 }]);
    assert.equal(tree.length, 3);
    assert(tree.every(node => node.conflict));
    assert.equal(new Set(tree.map(node => node.id)).size, 3);
});
