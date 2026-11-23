import axios from 'axios';

// ✅ FIX: Use relative path (via Vite Proxy)
const apiClient = axios.create({
    baseURL: '/api/v1',
    headers: { 'Content-Type': 'application/json' },
});

const PUBLIC_AUTH_PATHS = (url: string): boolean =>
    url.includes('/api/v1/auth/login') ||
    url.includes('/api/v1/auth/register') ||
    url.includes('/api/v1/auth/verify-email') ||
    url.includes('/api/v1/auth/resend-verification') ||
    url.includes('/api/v1/auth/forgot-password') ||
    url.includes('/api/v1/auth/reset-password') ||
    url.includes('/api/v1/auth/refresh-token');

let fetchInterceptorInstalled = false;

export const installAuthenticatedFetchInterceptor = (): void => {
    if (fetchInterceptorInstalled || typeof window === 'undefined' || typeof window.fetch !== 'function') {
        return;
    }
    fetchInterceptorInstalled = true;
    const nativeFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const isInternalApi =
            rawUrl.startsWith('/api/') ||
            rawUrl.startsWith(`${window.location.origin}/api/`);

        if (!isInternalApi || PUBLIC_AUTH_PATHS(rawUrl)) {
            return nativeFetch(input, init);
        }

        const token = sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken');
        const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
        if (token && !headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${token}`);
        }

        let res = await nativeFetch(input, { ...init, headers });

        if (res.status === 401) {
            const isSession = !!sessionStorage.getItem('refreshToken');
            const refreshToken = sessionStorage.getItem('refreshToken') || localStorage.getItem('refreshToken');
            if (refreshToken) {
                try {
                    const refreshRes = await nativeFetch('/api/v1/auth/refresh-token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ refresh_token: refreshToken }),
                    });
                    if (refreshRes.ok) {
                        const data = await refreshRes.json();
                        const store = isSession ? sessionStorage : localStorage;
                        store.setItem('accessToken', data.access_token);
                        if (data.refresh_token) store.setItem('refreshToken', data.refresh_token);
                        apiClient.defaults.headers.common['Authorization'] = `Bearer ${data.access_token}`;
                        headers.set('Authorization', `Bearer ${data.access_token}`);
                        res = await nativeFetch(input, { ...init, headers });
                    }
                } catch {
                    // fall through to original 401
                }
            }
        }

        if (res.status === 503) {
            try {
                const clone = res.clone();
                const data = await clone.json();
                if (data?.maintenance_mode) {
                    window.dispatchEvent(
                        new CustomEvent('app:maintenance', {
                            detail: { message: data?.detail || 'Scheduled maintenance in progress.' },
                        })
                    );
                }
            } catch {
                // ignore non-JSON 503 body
            }
        }

        return res;
    };
};

installAuthenticatedFetchInterceptor();

apiClient.interceptors.request.use(
    (config) => {
        const token = sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 502 || error.response?.status === 504) {
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('app:version-updating'));
            }
            return Promise.reject(error);
        }

        if (error.response?.status === 503 && error.response?.data?.maintenance_mode) {
            if (typeof window !== 'undefined') {
                window.dispatchEvent(
                    new CustomEvent('app:maintenance', {
                        detail: { message: error.response?.data?.detail || 'Scheduled maintenance in progress.' },
                    })
                );
            }
            return Promise.reject(error);
        }

        if (error.response?.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;

            try {
                const isSessionStorage = !!sessionStorage.getItem('refreshToken');
                const refreshToken = sessionStorage.getItem('refreshToken') || localStorage.getItem('refreshToken');

                if (!refreshToken) {
                    throw new Error("No refresh token");
                }

                // পাথ আপডেট: /v1/auth/refresh-token
                const { data } = await axios.post('/api/v1/auth/refresh-token', { refresh_token: refreshToken });

                if (isSessionStorage) {
                    sessionStorage.setItem('accessToken', data.access_token);
                    if (data.refresh_token) {
                        sessionStorage.setItem('refreshToken', data.refresh_token);
                    }
                } else {
                    localStorage.setItem('accessToken', data.access_token);
                    if (data.refresh_token) {
                        localStorage.setItem('refreshToken', data.refresh_token);
                    }
                }

                apiClient.defaults.headers.common['Authorization'] = `Bearer ${data.access_token}`;
                originalRequest.headers['Authorization'] = `Bearer ${data.access_token}`;

                return apiClient(originalRequest);

            } catch (refreshError) {
                console.error("Session expired", refreshError);
                sessionStorage.removeItem('accessToken');
                sessionStorage.removeItem('refreshToken');
                localStorage.removeItem('accessToken');
                localStorage.removeItem('refreshToken');
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('app:logout'));
                }
                return Promise.reject(refreshError);
            }
        }
        return Promise.reject(error);
    }
);

export default apiClient;
