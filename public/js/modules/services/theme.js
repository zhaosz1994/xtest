const ThemeService = {
    currentTheme: 'light',
    themes: {
        light: {
            name: '浅色主题',
            icon: '☀️',
            colors: {
                primary: '#3b82f6',
                background: '#ffffff',
                text: '#1e293b',
                border: '#e2e8f0',
                card: '#ffffff',
                hover: '#f8fafc'
            }
        },
        dark: {
            name: '深色主题',
            icon: '🌙',
            colors: {
                primary: '#60a5fa',
                background: '#0f172a',
                text: '#e2e8f0',
                border: '#334155',
                card: '#1e293b',
                hover: '#334155'
            }
        }
    },

    init() {
        const savedTheme = StorageService.getPreference('theme', 'light');
        this.setTheme(savedTheme);
    },

    setTheme(themeName) {
        if (!this.themes[themeName]) {
            console.warn(`[Theme] 主题 "${themeName}" 不存在`);
            return false;
        }

        this.currentTheme = themeName;
        const theme = this.themes[themeName];

        document.documentElement.setAttribute('data-theme', themeName);

        Object.entries(theme.colors).forEach(([key, value]) => {
            document.documentElement.style.setProperty(`--color-${key}`, value);
        });

        StorageService.setPreference('theme', themeName);

        this.emit('themeChanged', { theme: themeName, colors: theme.colors });

        return true;
    },

    toggle() {
        const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
        return this.setTheme(newTheme);
    },

    getCurrentTheme() {
        return {
            name: this.currentTheme,
            ...this.themes[this.currentTheme]
        };
    },

    getAvailableThemes() {
        return Object.entries(this.themes).map(([key, value]) => ({
            key,
            ...value
        }));
    },

    listeners: {},

    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    },

    off(event, callback) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    },

    emit(event, data) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`[Theme] 事件处理器错误 [${event}]:`, error);
            }
        });
    }
};

function initTheme() {
    ThemeService.init();

    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            ThemeService.toggle();
        });
    }

    ThemeService.on('themeChanged', ({ theme, colors }) => {
        const themeIcon = document.querySelector('.theme-icon');
        if (themeIcon) {
            themeIcon.textContent = ThemeService.themes[theme].icon;
        }
    });
}

function applyThemeColors(colors) {
    const root = document.documentElement;
    Object.entries(colors).forEach(([key, value]) => {
        root.style.setProperty(`--color-${key}`, value);
    });
}

function createThemeSelector() {
    const themes = ThemeService.getAvailableThemes();
    const currentTheme = ThemeService.getCurrentTheme();

    return `
        <div class="theme-selector">
            ${themes.map(theme => `
                <button 
                    class="theme-option ${theme.key === currentTheme.name ? 'active' : ''}"
                    onclick="ThemeService.setTheme('${theme.key}')"
                >
                    <span class="theme-icon">${theme.icon}</span>
                    <span class="theme-name">${theme.name}</span>
                </button>
            `).join('')}
        </div>
    `;
}
