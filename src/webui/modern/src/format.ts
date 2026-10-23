export const bytes = (value: number | undefined, digits = 1): string => {
    if (!value || value < 0) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** exponent).toFixed(exponent ? digits : 0)} ${units[exponent]}`;
};
export const speed = (value?: number) => `${bytes(value)}/s`;
