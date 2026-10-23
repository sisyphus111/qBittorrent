// Keep bare info-hash formats aligned with TorrentDescriptor::parse in the backend.
export const isInfoHash = (source: string): boolean =>
    /^(?:[a-f0-9]{40}|[a-f0-9]{64}|[a-z2-7]{32})$/i.test(source.trim());

export const isTorrentSource = (source: string): boolean => {
    if (isInfoHash(source)) return true;
    try {
        return ['magnet:', 'http:', 'https:'].includes(new URL(source.trim()).protocol);
    } catch {
        return false;
    }
};
