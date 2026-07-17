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

    darkColors: {
        bg: '#0d1117',
        bgSurface: '#161b22',
        bgElevated: '#1c2128',
        bgHover: '#21262d',
        textPrimary: '#e6edf3',
        textSecondary: '#8b949e',
        textMuted: '#6e7681',
        border: '#30363d',
        borderLight: '#21262d',
        primary: '#58a6ff',
        primaryHover: '#388bfd',
        success: '#34d399',
        warning: '#fbbf24',
        danger: '#f87171',
        info: '#60a5fa',
        successBg: 'rgba(52, 211, 153, 0.15)',
        warningBg: 'rgba(251, 191, 36, 0.15)',
        dangerBg: 'rgba(248, 113, 113, 0.15)',
        infoBg: 'rgba(96, 165, 250, 0.15)',
        inputBg: '#0d1117',
        inputBorder: '#30363d',
        inputFocusBorder: '#58a6ff',
        overlay: 'rgba(0, 0, 0, 0.7)'
    },

    lightColors: {
        bg: '#ffffff',
        bgSurface: '#f8fafc',
        bgElevated: '#ffffff',
        bgHover: '#f1f5f9',
        textPrimary: '#1e293b',
        textSecondary: '#64748b',
        textMuted: '#94a3b8',
        border: '#e2e8f0',
        borderLight: '#f1f5f9',
        primary: '#3b82f6',
        primaryHover: '#2563eb',
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
        info: '#3b82f6',
        successBg: '#d1fae5',
        warningBg: '#fef3c7',
        dangerBg: '#fee2e2',
        infoBg: '#dbeafe',
        inputBg: '#ffffff',
        inputBorder: '#e2e8f0',
        inputFocusBorder: '#3b82f6',
        overlay: 'rgba(0, 0, 0, 0.5)'
    },

    isDarkMode() {
        return this.currentTheme === 'dark';
    },

    getColor(key) {
        const palette = this.isDarkMode() ? this.darkColors : this.lightColors;
        return palette[key] || this.lightColors[key] || '';
    },

    getColors() {
        return this.isDarkMode() ? this.darkColors : this.lightColors;
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
