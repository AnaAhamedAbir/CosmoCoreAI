import axios from 'axios';

// ✅ FIX: Use relative path (via Vite Proxy)
const apiClient = axios.create({
    baseURL: '/api/v1',
    headers: { 'Content-Type': 'application/json' },
});

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
                window.location.href = '/';
                return Promise.reject(refreshError);
            }
        }
        return Promise.reject(error);
    }
);

export default apiClient;
