import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isInfoHash, isTorrentSource } from '../src/torrentSource.ts';

const hash = '0ac5e0449f352e35aa20fb418dfaafd0a8a4f83d';
test('accepts bare hashes in all formats supported by the backend', () => {
    for (const source of [hash, hash.toUpperCase(), `  ${hash}\n`, 'ab'.repeat(32), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', 'abcdefghijklmnopqrstuvwxyz234567']) {
        assert.equal(isInfoHash(source), true, source);
        assert.equal(isTorrentSource(source), true, source);
    }
});
test('rejects malformed hashes, arbitrary text, and unsupported URL schemes', () => {
    for (const source of ['', hash.slice(1), `${hash}0`, 'g'.repeat(40), 'a'.repeat(63), '1'.repeat(32), `${hash}\n${hash}`, 'not a torrent', 'file:///tmp/test.torrent', 'javascript:alert(1)']) {
        assert.equal(isTorrentSource(source), false, source);
    }
});
test('preserves existing magnet and HTTP URL support', () => {
    for (const source of [`magnet:?xt=urn:btih:${hash}`, 'https://example.com/file.torrent?token=a%2Bb', 'http://example.com/file.torrent']) {
        assert.equal(isTorrentSource(source), true, source);
        assert.equal(isInfoHash(source), false, source);
    }
});
