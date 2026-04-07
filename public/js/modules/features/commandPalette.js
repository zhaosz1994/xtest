const CommandPalette = {
    isOpen: false,
    mode: 'command',
    selectedIndex: 0,
    selectedCategory: 0,
    commands: [],
    filteredCommands: [],
    searchResults: null,
    searchKeyword: '',
    searchDebounce: null,
    isLoading: false,
    searchHistory: [],
    abortController: null,
    
    config: {
        debounceDelay: 300,
        minSearchLength: 2,
        maxHistoryItems: 10,
        searchLimit: 5
    },

    init() {
        this.commands = this.getCommands();
        this.loadSearchHistory();
        this.render();
        this.bindEvents();
    },

    getCommands() {
        return [
            {
                id: 'global-search',
                title: '全局搜索',
                description: '搜索测试计划、用例、帖子、评论',
                icon: '🔍',
                shortcut: ['/'],
                action: () => this.switchToSearchMode()
            },
            {
                id: 'new-testplan',
                title: '新建测试计划',
                description: '创建一个新的测试计划',
                icon: '📋',
                shortcut: ['N', 'P'],
                action: async () => { 
                    this.close(); 
                    if (typeof openAdvancedTestPlanModal === 'function') {
                        await openAdvancedTestPlanModal();
                    } else {
                        console.warn('openAdvancedTestPlanModal function not found');
                        addTestPlan();
                    }
                }
            },
            {
                id: 'new-testcase',
                title: '新建测试用例',
                description: '创建一个新的测试用例',
                icon: '📝',
                shortcut: ['N', 'C'],
                action: () => { this.close(); if (typeof addTestCase === 'function') addTestCase(); }
            },
            {
                id: 'dashboard',
                title: '仪表盘',
                description: '查看测试概览',
                icon: '📊',
                shortcut: ['G', 'D'],
                action: () => { this.close(); Router.navigateTo('dashboard'); }
            },
            {
                id: 'testplans',
                title: '测试计划',
                description: '管理测试计划',
                icon: '📋',
                shortcut: ['G', 'P'],
                action: () => { this.close(); Router.navigateTo('testplans'); }
            },
            {
                id: 'cases',
                title: '用例管理',
                description: '管理测试用例',
                icon: '📁',
                shortcut: ['G', 'C'],
                action: () => { this.close(); Router.navigateTo('cases'); }
            },
            {
                id: 'reports',
                title: '测试报告',
                description: '查看测试报告',
                icon: '📈',
                shortcut: ['G', 'R'],
                action: () => { this.close(); Router.navigateTo('reports'); }
            },
            {
                id: 'settings',
                title: '配置中心',
                description: '系统配置管理',
                icon: '⚙️',
                shortcut: ['G', 'S'],
                action: () => { this.close(); Router.navigateTo('settings'); }
            },
            {
                id: 'toggle-theme',
                title: '切换主题',
                description: '在浅色和暗黑模式之间切换',
                icon: '🌙',
                shortcut: ['T', 'T'],
                action: () => { if (typeof ThemeService !== 'undefined') ThemeService.toggle(); }
            },
            {
                id: 'ai-assistant',
                title: 'AI知识问答',
                description: '打开AI助手',
                icon: '🤖',
                shortcut: ['A', 'I'],
                action: () => { this.close(); if (typeof openAIAssistant === 'function') openAIAssistant(); }
            },
            {
                id: 'forum',
                title: '技术论坛',
                description: '访问技术讨论区',
                icon: '💬',
                shortcut: ['G', 'F'],
                action: () => { this.close(); window.open('/forum.html', '_blank'); }
            }
        ];
    },

    render() {
        const palette = document.createElement('div');
        palette.id = 'command-palette';
        palette.className = 'command-palette';
        palette.innerHTML = `
            <div class="command-palette-container">
                <div class="command-palette-input-wrapper">
                    <svg class="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"></circle>
                        <path d="m21 21-4.35-4.35"></path>
                    </svg>
                    <input type="text" 
                           class="command-palette-input" 
                           id="command-input" 
                           placeholder="输入命令或搜索... (按 / 进入搜索模式)" 
                           autocomplete="off"
                           spellcheck="false">
                    <span class="mode-indicator" id="mode-indicator"></span>
                    <div class="shortcut-hint">
                        <kbd>ESC</kbd> 关闭
                    </div>
                </div>
                <div class="command-palette-results" id="command-results"></div>
            </div>
        `;
        
        document.body.appendChild(palette);
        
        this.element = palette;
        this.input = palette.querySelector('#command-input');
        this.results = palette.querySelector('#command-results');
        this.modeIndicator = palette.querySelector('#mode-indicator');
    },

    bindEvents() {
        document.addEventListener('keydown', (e) => this.handleGlobalKeydown(e));
        
        this.input.addEventListener('input', (e) => this.handleInput(e));
        
        this.element.addEventListener('click', (e) => {
            if (e.target === this.element) {
                this.close();
            }
        });
    },

    handleGlobalKeydown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            if (this.isOpen) {
                this.close();
            } else {
                this.open();
            }
            return;
        }
        
        if (this.isOpen) {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (this.mode === 'search') {
                    this.switchToCommandMode();
                } else {
                    this.close();
                }
                return;
            }
            
            if (e.key === '/' && this.mode === 'command') {
                e.preventDefault();
                this.switchToSearchMode();
                return;
            }
            
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.selectNext();
                return;
            }
            
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.selectPrev();
                return;
            }
            
            if (e.key === 'Enter') {
                e.preventDefault();
                this.execute();
                return;
            }
            
            if (e.key === 'Tab' && this.mode === 'search') {
                e.preventDefault();
                this.switchCategory(e.shiftKey ? -1 : 1);
                return;
            }
        }
    },

    handleInput(e) {
        const value = e.target.value;
        
        if (this.mode === 'search') {
            this.searchKeyword = value;
            this.performSearch(value);
        } else {
            this.filterCommands(value);
        }
    },

    open() {
        this.isOpen = true;
        this.selectedIndex = 0;
        this.element.classList.add('active');
        this.input.value = '';
        this.input.focus();
        
        if (this.mode === 'command') {
            this.filterCommands('');
        } else {
            this.renderSearchPrompt();
        }
    },

    close() {
        this.isOpen = false;
        this.element.classList.remove('active');
        this.mode = 'command';
        this.input.value = '';
        this.modeIndicator.textContent = '';
        this.input.placeholder = '输入命令或搜索... (按 / 进入搜索模式)';
        
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    },

    switchToSearchMode() {
        this.mode = 'search';
        this.selectedIndex = 0;
        this.selectedCategory = 0;
        this.input.placeholder = '搜索测试计划、用例、帖子、评论...';
        this.input.value = '';
        this.modeIndicator.textContent = '搜索';
        this.modeIndicator.classList.add('active');
        this.input.focus();
        this.renderSearchPrompt();
    },

    switchToCommandMode() {
        this.mode = 'command';
        this.input.value = '';
        this.modeIndicator.textContent = '';
        this.modeIndicator.classList.remove('active');
        this.input.placeholder = '输入命令或搜索... (按 / 进入搜索模式)';
        this.filterCommands('');
    },

    filterCommands(query) {
        const q = query.toLowerCase().trim();
        
        if (!q) {
            this.filteredCommands = this.commands;
        } else {
            this.filteredCommands = this.commands.filter(cmd =>
                cmd.title.toLowerCase().includes(q) ||
                cmd.description.toLowerCase().includes(q) ||
                cmd.id.toLowerCase().includes(q)
            );
        }
        
        this.selectedIndex = 0;
        this.renderCommandResults();
    },

    renderCommandResults() {
        if (this.filteredCommands.length === 0) {
            this.results.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-emoji">🔍</div>
                    <div class="empty-state-title">未找到匹配的命令</div>
                    <div class="empty-state-description">尝试其他关键词或按 / 进行全局搜索</div>
                </div>
            `;
            return;
        }
        
        this.results.innerHTML = this.filteredCommands.map((cmd, index) => `
            <div class="command-palette-item ${index === this.selectedIndex ? 'selected' : ''}" 
                 data-index="${index}">
                <div class="command-palette-item-icon">${cmd.icon}</div>
                <div class="command-palette-item-content">
                    <div class="command-palette-item-title">${cmd.title}</div>
                    <div class="command-palette-item-description">${cmd.description}</div>
                </div>
                ${cmd.shortcut ? `
                    <div class="command-palette-item-shortcut">
                        ${cmd.shortcut.map(k => `<kbd>${k}</kbd>`).join('')}
                    </div>
                ` : ''}
            </div>
        `).join('');
        
        this.bindCommandItemEvents();
    },

    bindCommandItemEvents() {
        this.results.querySelectorAll('.command-palette-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                this.executeCommand(index);
            });
            
            item.addEventListener('mouseenter', () => {
                this.selectedIndex = parseInt(item.dataset.index);
                this.updateCommandSelection();
            });
        });
    },

    async performSearch(query) {
        clearTimeout(this.searchDebounce);
        
        if (query.length < this.config.minSearchLength) {
            this.renderSearchPrompt();
            return;
        }
        
        this.renderSearching();
        
        this.searchDebounce = setTimeout(async () => {
            try {
                this.isLoading = true;
                
                if (this.abortController) {
                    this.abortController.abort();
                }
                this.abortController = new AbortController();
                
                const data = await apiRequest(
                    `/search?keyword=${encodeURIComponent(query)}&limit=${this.config.searchLimit}`,
                    { signal: this.abortController.signal }
                );
                
                if (data.success) {
                    this.searchResults = data.data;
                    this.renderSearchResults(query);
                    this.saveSearchHistory(query);
                } else {
                    this.renderSearchError(data.error?.message || '搜索失败');
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    return;
                }
                console.error('搜索错误:', error);
                this.renderSearchError('搜索服务暂时不可用');
            } finally {
                this.isLoading = false;
            }
        }, this.config.debounceDelay);
    },

    renderSearchPrompt() {
        const history = this.getSearchHistory();
        
        let html = '<div class="search-prompt">';
        
        if (history.length > 0) {
            html += `
                <div class="search-history">
                    <div class="search-history-header">
                        <span class="history-title">最近搜索</span>
                        <button class="clear-history-btn" id="clear-history-btn">清除</button>
                    </div>
                    <div class="search-history-tags">
                        ${history.map(h => `
                            <span class="history-tag" data-keyword="${this.escapeHtml(h)}">${this.escapeHtml(h)}</span>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        
        html += `
            <div class="search-hints">
                <div class="search-hint-title">搜索提示</div>
                <div class="search-hint-items">
                    <div class="search-hint-item">
                        <span class="hint-icon">💡</span>
                        <span>输入至少 2 个字符开始搜索</span>
                    </div>
                    <div class="search-hint-item">
                        <span class="hint-icon">⌨️</span>
                        <span>使用 <kbd>↑</kbd> <kbd>↓</kbd> 导航，<kbd>Enter</kbd> 选择</span>
                    </div>
                    <div class="search-hint-item">
                        <span class="hint-icon">🔄</span>
                        <span>按 <kbd>Tab</kbd> 切换搜索分类</span>
                    </div>
                </div>
            </div>
        `;
        
        html += '</div>';
        
        this.results.innerHTML = html;
        this.bindSearchPromptEvents();
    },

    bindSearchPromptEvents() {
        this.results.querySelectorAll('.history-tag').forEach(tag => {
            tag.addEventListener('click', () => {
                const keyword = tag.dataset.keyword;
                this.input.value = keyword;
                this.searchKeyword = keyword;
                this.performSearch(keyword);
            });
        });
        
        const clearBtn = this.results.querySelector('#clear-history-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.clearSearchHistory();
                this.renderSearchPrompt();
            });
        }
    },

    renderSearching() {
        this.results.innerHTML = `
            <div class="search-loading">
                <div class="loading-spinner"></div>
                <div class="loading-text">搜索中...</div>
            </div>
        `;
    },

    renderSearchResults(keyword) {
        const { testPlans, testCases, posts, comments } = this.searchResults;
        
        const categories = [
            { key: 'testPlans', data: testPlans, icon: '📋', title: '测试计划' },
            { key: 'testCases', data: testCases, icon: '📝', title: '测试用例' },
            { key: 'posts', data: posts, icon: '💬', title: '论坛帖子' },
            { key: 'comments', data: comments, icon: '💭', title: '评论' }
        ].filter(c => c.data && c.data.items && c.data.items.length > 0);
        
        if (categories.length === 0) {
            this.results.innerHTML = `
                <div class="search-empty">
                    <div class="search-empty-icon">🔍</div>
                    <div class="search-empty-title">未找到 "${this.escapeHtml(keyword)}" 相关结果</div>
                    <div class="search-empty-hint">尝试其他关键词或检查拼写</div>
                </div>
            `;
            return;
        }
        
        let html = '';
        
        categories.forEach((category, catIndex) => {
            const isSelected = catIndex === this.selectedCategory;
            
            html += `
                <div class="search-category ${isSelected ? 'selected' : ''}" data-category="${category.key}">
                    <div class="search-category-header">
                        <span class="category-icon">${category.icon}</span>
                        <span class="category-title">${category.title}</span>
                        <span class="category-count">${category.data.total} 个结果</span>
                        ${category.data.hasMore ? '<span class="category-more">更多</span>' : ''}
                    </div>
                    <div class="search-category-items">
                        ${category.data.items.map((item, itemIndex) => `
                            <div class="search-item ${isSelected && itemIndex === this.selectedIndex ? 'selected' : ''}" 
                                 data-type="${category.key.slice(0, -1).replace('testPlan', 'testplan').replace('testCase', 'case')}"
                                 data-id="${item.id}"
                                 ${item.postId ? `data-post-id="${item.postId}"` : ''}>
                                <div class="search-item-icon">${category.icon}</div>
                                <div class="search-item-content">
                                    <div class="search-item-title">${this.highlightText(
                                        item.name || item.title || item.contentPreview || item.content,
                                        keyword
                                    )}</div>
                                    <div class="search-item-meta">
                                        ${this.renderItemMeta(category.key, item)}
                                    </div>
                                </div>
                                <div class="search-item-arrow">${category.key === 'posts' || category.key === 'comments' ? '↗' : '→'}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        });
        
        this.results.innerHTML = html;
        this.bindSearchItemEvents();
    },

    renderItemMeta(categoryKey, item) {
        switch (categoryKey) {
            case 'testPlans':
                return `
                    <span>${item.projectName || item.project}</span>
                    <span class="meta-separator">·</span>
                    <span class="status-badge status-${item.status}">${item.status}</span>
                    <span class="meta-separator">·</span>
                    <span>${item.owner}</span>
                `;
            case 'testCases':
                return `
                    <span>${item.module}</span>
                    <span class="meta-separator">·</span>
                    <span class="priority-badge priority-${item.priority}">${item.priority}</span>
                    <span class="meta-separator">·</span>
                    <span>${item.type}</span>
                `;
            case 'posts':
                return `
                    <span>${item.author}</span>
                    <span class="meta-separator">·</span>
                    <span>💬 ${item.commentCount}</span>
                    <span class="meta-separator">·</span>
                    <span>${this.formatTime(item.createdAt)}</span>
                `;
            case 'comments':
                return `
                    <span>回复: ${item.postTitle}</span>
                    <span class="meta-separator">·</span>
                    <span>${item.author}</span>
                    <span class="meta-separator">·</span>
                    <span>${this.formatTime(item.createdAt)}</span>
                `;
            default:
                return '';
        }
    },

    bindSearchItemEvents() {
        this.results.querySelectorAll('.search-item').forEach(item => {
            item.addEventListener('click', () => {
                this.navigateToResult(
                    item.dataset.type,
                    item.dataset.id,
                    item.dataset.postId
                );
            });
            
            item.addEventListener('mouseenter', () => {
                const categoryEl = item.closest('.search-category');
                const categoryIndex = Array.from(
                    this.results.querySelectorAll('.search-category')
                ).indexOf(categoryEl);
                
                const itemIndex = Array.from(
                    categoryEl.querySelectorAll('.search-item')
                ).indexOf(item);
                
                this.selectedCategory = categoryIndex;
                this.selectedIndex = itemIndex;
                this.updateSearchSelection();
            });
        });
    },

    renderSearchError(message) {
        this.results.innerHTML = `
            <div class="search-error">
                <div class="error-icon">⚠️</div>
                <div class="error-title">搜索出错</div>
                <div class="error-message">${this.escapeHtml(message)}</div>
                <button class="retry-btn" id="search-retry-btn">重试</button>
            </div>
        `;
        
        this.results.querySelector('#search-retry-btn').addEventListener('click', () => {
            this.performSearch(this.searchKeyword);
        });
    },

    selectNext() {
        if (this.mode === 'command') {
            this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredCommands.length - 1);
            this.updateCommandSelection();
        } else {
            this.selectNextSearchItem();
        }
    },

    selectPrev() {
        if (this.mode === 'command') {
            this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
            this.updateCommandSelection();
        } else {
            this.selectPrevSearchItem();
        }
    },

    selectNextSearchItem() {
        const categories = this.results.querySelectorAll('.search-category');
        if (categories.length === 0) return;
        
        const currentCategory = categories[this.selectedCategory];
        const items = currentCategory.querySelectorAll('.search-item');
        
        if (this.selectedIndex < items.length - 1) {
            this.selectedIndex++;
        } else if (this.selectedCategory < categories.length - 1) {
            this.selectedCategory++;
            this.selectedIndex = 0;
        }
        
        this.updateSearchSelection();
    },

    selectPrevSearchItem() {
        if (this.selectedIndex > 0) {
            this.selectedIndex--;
        } else if (this.selectedCategory > 0) {
            this.selectedCategory--;
            const prevCategory = this.results.querySelectorAll('.search-category')[this.selectedCategory];
            this.selectedIndex = prevCategory.querySelectorAll('.search-item').length - 1;
        }
        
        this.updateSearchSelection();
    },

    switchCategory(direction) {
        const categories = this.results.querySelectorAll('.search-category');
        if (categories.length === 0) return;
        
        this.selectedCategory = Math.max(0, Math.min(
            this.selectedCategory + direction,
            categories.length - 1
        ));
        this.selectedIndex = 0;
        this.updateSearchSelection();
    },

    updateCommandSelection() {
        this.results.querySelectorAll('.command-palette-item').forEach((item, index) => {
            item.classList.toggle('selected', index === this.selectedIndex);
        });
    },

    updateSearchSelection() {
        this.results.querySelectorAll('.search-category').forEach((cat, catIndex) => {
            cat.classList.toggle('selected', catIndex === this.selectedCategory);
        });
        
        const selectedCategory = this.results.querySelectorAll('.search-category')[this.selectedCategory];
        if (selectedCategory) {
            selectedCategory.querySelectorAll('.search-item').forEach((item, itemIndex) => {
                item.classList.toggle('selected', itemIndex === this.selectedIndex);
            });
        }
    },

    executeCommand(index) {
        const cmd = this.filteredCommands[index];
        if (cmd && cmd.action) {
            if (cmd.id !== 'global-search') {
                this.close();
            }
            cmd.action();
        }
    },

    execute() {
        if (this.mode === 'command') {
            this.executeCommand(this.selectedIndex);
        } else {
            const categories = this.results.querySelectorAll('.search-category');
            const selectedCategory = categories[this.selectedCategory];
            if (selectedCategory) {
                const selectedItem = selectedCategory.querySelectorAll('.search-item')[this.selectedIndex];
                if (selectedItem) {
                    this.navigateToResult(
                        selectedItem.dataset.type,
                        selectedItem.dataset.id,
                        selectedItem.dataset.postId
                    );
                }
            }
        }
    },

    navigateToResult(type, id, postId) {
        this.close();
        
        switch (type) {
            case 'testplan':
                Router.navigateTo('testplans');
                setTimeout(async () => {
                    if (typeof viewTestPlanDetail === 'function') {
                        await viewTestPlanDetail(id);
                    } else {
                        console.warn('viewTestPlanDetail function not found');
                        const testplan = document.querySelector(`[data-testplan-id="${id}"]`);
                        if (testplan) {
                            testplan.click();
                            testplan.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    }
                }, 800);
                break;
            case 'case':
                Router.navigateTo('cases');
                setTimeout(async () => {
                    if (typeof openDrawerCaseDetail === 'function') {
                        await openDrawerCaseDetail(id);
                    } else {
                        console.warn('openDrawerCaseDetail function not found');
                        const testCase = document.querySelector(`[data-case-id="${id}"]`);
                        if (testCase) {
                            testCase.click();
                            testCase.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    }
                }, 800);
                break;
            case 'post':
                window.open(`/post-detail.html?id=${id}`, '_blank');
                break;
            case 'comment':
                window.open(`/post-detail.html?id=${postId}&comment=${id}`, '_blank');
                break;
        }
    },

    highlightText(text, keyword) {
        if (!text || !keyword) return this.escapeHtml(text || '');
        const escapedText = this.escapeHtml(text);
        const escapedKeyword = this.escapeHtml(keyword);
        const regex = new RegExp(`(${this.escapeRegex(escapedKeyword)})`, 'gi');
        return escapedText.replace(regex, '<mark class="highlight">$1</mark>');
    },

    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    formatTime(dateStr) {
        if (!dateStr) return '';
        
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;
        
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        
        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes}分钟前`;
        if (hours < 24) return `${hours}小时前`;
        if (days < 7) return `${days}天前`;
        
        return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    },

    loadSearchHistory() {
        this.searchHistory = JSON.parse(localStorage.getItem('globalSearchHistory') || '[]');
    },

    getSearchHistory() {
        return this.searchHistory || [];
    },

    saveSearchHistory(keyword) {
        if (!keyword || keyword.length < 2) return;
        
        let history = this.searchHistory.filter(h => h !== keyword);
        history.unshift(keyword);
        history = history.slice(0, this.config.maxHistoryItems);
        
        this.searchHistory = history;
        localStorage.setItem('globalSearchHistory', JSON.stringify(history));
    },

    clearSearchHistory() {
        this.searchHistory = [];
        localStorage.removeItem('globalSearchHistory');
    }
};

function initCommandPalette() {
    if (typeof CommandPalette !== 'undefined') {
        CommandPalette.init();
    }
}
