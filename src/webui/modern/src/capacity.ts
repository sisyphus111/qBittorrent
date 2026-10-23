export interface CapacityInput { total: number; used: number; reserved: number; pending: number; available: number }
export const capacitySegments = (volume: CapacityInput) => {
    if (!(volume.total > 0)) return { occupied: 0, pending: 0, free: 0 };
    const occupied = Math.min(volume.total, Math.max(0, volume.used) + Math.max(0, volume.reserved));
    const pending = Math.min(volume.total - occupied, Math.max(0, volume.pending));
    return { occupied: occupied / volume.total * 100, pending: pending / volume.total * 100, free: Math.max(0, volume.total - occupied - pending) / volume.total * 100 };
};
