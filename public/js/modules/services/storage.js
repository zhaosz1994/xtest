const StorageService = {
    set(key, value, options = {}) {
        try {
            const storage = options.session ? sessionStorage : localStorage;
            const data = {
                value,
                timestamp: Date.now(),
                expiry: options.expiry ? Date.now() + options.expiry : null
            };
            storage.setItem(key, JSON.stringify(data));
            return true;
        } catch (error) {
            console.error('[Storage] 保存数据失败:', error);
            return false;
        }
    },

    get(key, options = {}) {
        try {
            const storage = options.session ? sessionStorage : localStorage;
            const item = storage.getItem(key);
            
            if (!item) return null;

            const data = JSON.parse(item);

            if (data.expiry && Date.now() > data.expiry) {
                this.remove(key, options);
                return null;
            }

            return data.value;
        } catch (error) {
            console.error('[Storage] 读取数据失败:', error);
            return null;
        }
    },

    remove(key, options = {}) {
        try {
            const storage = options.session ? sessionStorage : localStorage;
            storage.removeItem(key);
            return true;
        } catch (error) {
            console.error('[Storage] 删除数据失败:', error);
            return false;
        }
    },

    clear(options = {}) {
        try {
            if (options.session) {
                sessionStorage.clear();
            } else if (options.local) {
                localStorage.clear();
            } else {
                sessionStorage.clear();
                localStorage.clear();
            }
            return true;
        } catch (error) {
            console.error('[Storage] 清空数据失败:', error);
            return false;
        }
    },

    getKeys(options = {}) {
        try {
            const storage = options.session ? sessionStorage : localStorage;
            return Object.keys(storage);
        } catch (error) {
            console.error('[Storage] 获取键列表失败:', error);
            return [];
        }
    },

    getSize(options = {}) {
        try {
            const storage = options.session ? sessionStorage : localStorage;
            let size = 0;
            for (let key in storage) {
                if (storage.hasOwnProperty(key)) {
                    size += storage.getItem(key).length * 2;
                }
            }
            return size;
        } catch (error) {
            console.error('[Storage] 获取存储大小失败:', error);
            return 0;
        }
    },

    setAuth(token, user) {
        this.set('authToken', token);
        this.set('currentUser', user);
    },

    getAuth() {
        const token = this.get('authToken');
        const user = this.get('currentUser');
        return { token, user };
    },

    clearAuth() {
        this.remove('authToken');
        this.remove('currentUser');
    },

    setPreference(key, value) {
        const preferences = this.get('userPreferences') || {};
        preferences[key] = value;
        this.set('userPreferences', preferences);
    },

    getPreference(key, defaultValue = null) {
        const preferences = this.get('userPreferences') || {};
        return preferences[key] !== undefined ? preferences[key] : defaultValue;
    },

    setRecentItem(type, item, maxItems = 10) {
        const key = `recent_${type}`;
        const items = this.get(key) || [];
        
        const filtered = items.filter(i => i.id !== item.id);
        filtered.unshift(item);
        
        if (filtered.length > maxItems) {
            filtered.splice(maxItems);
        }
        
        this.set(key, filtered);
    },

    getRecentItems(type, limit = 10) {
        const key = `recent_${type}`;
        const items = this.get(key) || [];
        return items.slice(0, limit);
    },

    clearRecentItems(type) {
        const key = `recent_${type}`;
        this.remove(key);
    }
};
