type Parameters = Record<string, unknown>;

export class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = 'ApiError';
    }
}

const encode = (parameters: Parameters) => new URLSearchParams(
    Object.entries(parameters).filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)])
);

const request = async <T>(endpoint: string, init: RequestInit = {}): Promise<T> => {
    let response: Response;
    try {
        response = await fetch(`/api/v2/${endpoint}`, {
            credentials: 'same-origin', cache: 'no-store', ...init,
            signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
        });
    } catch {
        throw new ApiError(0, '暂时无法连接服务器，请检查网络后重试。');
    }
    const text = await response.text();
    if (!response.ok) {
        const expired = response.status === 403 && !endpoint.startsWith('auth/login');
        if (expired) window.dispatchEvent(new Event('qbt-session-expired'));
        const message = expired ? '登录已过期，请重新登录。'
            : response.status === 401 ? '用户名或密码不正确。'
            : text && text.length < 400 && !text.startsWith('<') ? text
            : `请求失败（${response.status}），请稍后重试。`;
        throw new ApiError(response.status, message);
    }
    if (!text) return undefined as T;
    try { return JSON.parse(text) as T; }
    catch { return text as T; }
};

export const apiGet = <T = unknown>(endpoint: string, parameters: Parameters = {}) => {
    const query = encode(parameters).toString();
    return request<T>(`${endpoint}${query ? `?${query}` : ''}`);
};
export const apiPost = <T = unknown>(endpoint: string, parameters: Parameters = {}, signal?: AbortSignal) =>
    request<T>(endpoint, { method: 'POST', body: encode(parameters), signal });
export const apiUpload = <T = unknown>(endpoint: string, body: FormData, signal?: AbortSignal) =>
    request<T>(endpoint, { method: 'POST', body, signal });
