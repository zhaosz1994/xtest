const apiCache = {
    data: {},
    timestamps: {},
    ttl: 5 * 60 * 1000,

    get(key) {
        const cached = this.data[key];
        const timestamp = this.timestamps[key];
        if (cached && timestamp && (Date.now() - timestamp < this.ttl)) {
            return cached;
        }
        return null;
    },

    set(key, value, customTtl) {
        this.data[key] = value;
        this.timestamps[key] = Date.now();
        if (customTtl) {
            setTimeout(() => this.delete(key), customTtl);
        }
    },

    delete(key) {
        if (this.data.hasOwnProperty(key)) {
            delete this.data[key];
        }
        if (this.timestamps.hasOwnProperty(key)) {
            delete this.timestamps[key];
        }
    },

    deleteByPrefix(prefix) {
        let count = 0;
        Object.keys(this.data).forEach(key => {
            if (key.startsWith(prefix)) {
                delete this.data[key];
                delete this.timestamps[key];
                count++;
            }
        });
    },

    clear() {
        this.data = {};
        this.timestamps = {};
    }
};

async function handleApiResponse(response) {
    try {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'API请求失败');
            }
            return data;
        } else {
            throw new Error('服务器返回非JSON响应');
        }
    } catch (error) {
        throw new Error('API响应解析失败: ' + error.message);
    }
}

async function refreshToken() {
    try {
        const response = await fetch(`${API_BASE_URL}/users/refresh-token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (!response.ok) {
            throw new Error('Token刷新失败');
        }

        const data = await response.json();
        
        if (data.success && data.token) {
            authToken = data.token;
            currentUser = data.user;
            
            localStorage.setItem('authToken', authToken);
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('[Token刷新] 刷新失败:', error);
        return false;
    }
}

async function apiRequest(endpoint, options = {}) {
    const { useCache = true, cacheTtl, method = 'GET', skipRetry = false, signal } = options;

    if (method === 'GET' && useCache) {
        const cached = apiCache.get(endpoint);
        if (cached) {
            return cached;
        }
    }

    const url = `${API_BASE_URL}${endpoint}`;
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }

    try {
        const response = await fetch(url, {
            ...options,
            headers,
            ...(signal && { signal })
        });

        if (!response.ok) {
            if (response.status === 403 && !skipRetry && authToken) {
                const refreshed = await refreshToken();
                
                if (refreshed) {
                    headers['Authorization'] = `Bearer ${authToken}`;
                    
                    const retryResponse = await fetch(url, {
                        ...options,
                        headers
                    });
                    
                    if (retryResponse.ok) {
                        const result = await handleApiResponse(retryResponse);
                        
                        if (method === 'GET' && result.success && useCache) {
                            apiCache.set(endpoint, result, cacheTtl);
                        }
                        
                        return result;
                    }
                } else {
                    authToken = null;
                    currentUser = null;
                    localStorage.removeItem('authToken');
                    localStorage.removeItem('currentUser');
                    
                    showNetworkError('登录已过期，请重新登录');
                    
                    setTimeout(() => {
                        if (typeof showLoginSection === 'function') {
                            showLoginSection();
                        }
                    }, 1500);
                    
                    return { success: false, message: '登录已过期，请重新登录', _authExpired: true };
                }
            }
            
            try {
                const text = await response.text();
                if (text.includes('<!DOCTYPE') || text.includes('<html')) {
                    return { success: false, message: '服务器返回HTML页面 (404 Not Found)' };
                } else {
                    return { success: false, message: text };
                }
            } catch {
                return { success: false, message: `服务器错误: ${response.status} ${response.statusText}` };
            }
        }

        const result = await handleApiResponse(response);

        if (method === 'GET' && result.success && useCache) {
            apiCache.set(endpoint, result, cacheTtl);
        }

        if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
            const basePath = endpoint.split('?')[0];
            apiCache.delete(basePath);

            const pathParts = basePath.split('/');
            if (pathParts.length >= 2) {
                const resourceBase = pathParts.slice(0, 2).join('/');
                apiCache.delete(resourceBase + '/list');
            }

            apiCache.delete(basePath.replace('/create', '/list'));
            apiCache.delete(basePath.replace('/update', '/list'));
            apiCache.delete(basePath.replace('/delete', '/list'));

            if (pathParts.length >= 2) {
                const baseResource = pathParts.slice(0, pathParts.length).join('/');
                apiCache.deleteByPrefix(baseResource);
            }
        }

        return result;
    } catch (error) {
        console.error('API请求错误:', error);

        if (error.name === 'TypeError' || error.message.includes('fetch')) {
            showNetworkError('网络连接失败，请检查网络设置');
        } else if (error.message.includes('JSON') || error.message.includes('parse')) {
            showNetworkError('服务器响应格式错误');
        }

        return { success: false, message: error.message || '服务器连接失败', _error: true };
    }
}
