const DataEventManager = {
    events: {},
    
    on(event, callback) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(callback);
        return () => this.off(event, callback);
    },
    
    off(event, callback) {
        if (!this.events[event]) return;
        this.events[event] = this.events[event].filter(cb => cb !== callback);
    },
    
    emit(event, data = {}) {
        if (!this.events[event]) return;
        this.events[event].forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`事件处理器错误 [${event}]:`, error);
            }
        });
    },
    
    clear(event) {
        if (event) {
            delete this.events[event];
        } else {
            this.events = {};
        }
    },
    
    getEventCount(event) {
        return this.events[event] ? this.events[event].length : 0;
    }
};
