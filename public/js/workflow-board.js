/**
 * CTA 工作流可视化看板
 * 覆盖改进报告 6.1 节：DAG 工作流可视化、闭环展示、实时节点事件
 */
class WorkflowBoard {
    constructor(taskId, options = {}) {
        this.taskId = taskId;
        this.container = options.container || document.getElementById('workflow-canvas');
        this.socket = options.socket || (typeof window !== 'undefined' && window.socket ? window.socket : null);
        this.instanceId = null;
        this.definition = null;
        this.nodes = [];
        this.edges = [];
        this.currentNodeId = null;
        this.nodeStates = new Map();
        this.logEntries = [];
        this.maxLogEntries = 200;
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };
        this._destroyed = false;
        this._socketHandlers = [];
        this._globalHandlers = [];
        this._ownedElements = [];
        this._loadToken = 0; // 用于取消旧的load请求

        if (!this.container) {
            console.warn('[WorkflowBoard] 容器不存在');
            return;
        }
        try {
            this._initSvg();
            if (this.socket && typeof this.socket.on === 'function') {
                this._initSocket();
            }
        } catch (e) {
            console.error('[WorkflowBoard] 初始化失败', e);
        }
    }

    _uid() {
        if (!this._instanceUid) this._instanceUid = 'wf' + Math.random().toString(36).substring(2, 9);
        return this._instanceUid;
    }

    _initSvg() {
        // 清空容器（使用 firstChild 循环而非 innerHTML，兼容 SVG）
        while (this.container.firstChild) {
            this.container.removeChild(this.container.firstChild);
        }
        const svgNs = 'http://www.w3.org/2000/svg';
        this.svg = document.createElementNS(svgNs, 'svg');
        this.svg.setAttribute('width', '100%');
        this.svg.setAttribute('height', '100%');
        this.svg.setAttribute('viewBox', '0 0 1200 600');
        this.svg.style.cursor = 'grab';
        this.container.appendChild(this.svg);

        // 定义箭头标记 - 使用 createElementNS 而非 innerHTML（兼容性）
        const defs = document.createElementNS(svgNs, 'defs');
        const uid = this._uid();
        const markers = [
            { id: `wf-arrow-${uid}`, color: '#94a3b8' },
            { id: `wf-arrow-active-${uid}`, color: '#6366f1' },
            { id: `wf-arrow-loop-${uid}`, color: '#f59e0b' },
        ];
        for (const m of markers) {
            const marker = document.createElementNS(svgNs, 'marker');
            marker.setAttribute('id', m.id);
            marker.setAttribute('viewBox', '0 0 10 10');
            marker.setAttribute('refX', '10');
            marker.setAttribute('refY', '5');
            marker.setAttribute('markerWidth', '8');
            marker.setAttribute('markerHeight', '8');
            marker.setAttribute('orient', 'auto');
            const path = document.createElementNS(svgNs, 'path');
            path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
            path.setAttribute('fill', m.color);
            marker.appendChild(path);
            defs.appendChild(marker);
        }
        this.svg.appendChild(defs);

        this.g = document.createElementNS(svgNs, 'g');
        this.svg.appendChild(this.g);

        // 缩放与平移
        const wheelHandler = (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            this.zoom = Math.max(0.5, Math.min(3, this.zoom + delta));
            this._applyTransform();
        };
        const mouseDownHandler = (e) => {
            if (!this.svg || e.target === this.svg) {
                this.isDragging = true;
                this.dragStart = { x: e.clientX, y: e.clientY };
                this.svg.style.cursor = 'grabbing';
            }
        };
        const mouseMoveHandler = (e) => {
            if (!this.isDragging || this._destroyed) return;
            this.panX += (e.clientX - this.dragStart.x);
            this.panY += (e.clientY - this.dragStart.y);
            this.dragStart = { x: e.clientX, y: e.clientY };
            this._applyTransform();
        };
        const mouseUpHandler = () => {
            this.isDragging = false;
            if (this.svg && !this._destroyed) this.svg.style.cursor = 'grab';
        };

        this.svg.addEventListener('wheel', wheelHandler);
        this.svg.addEventListener('mousedown', mouseDownHandler);
        window.addEventListener('mousemove', mouseMoveHandler);
        window.addEventListener('mouseup', mouseUpHandler);

        this._globalHandlers.push(
            { target: this.svg, type: 'wheel', handler: wheelHandler },
            { target: this.svg, type: 'mousedown', handler: mouseDownHandler },
            { target: window, type: 'mousemove', handler: mouseMoveHandler },
            { target: window, type: 'mouseup', handler: mouseUpHandler }
        );

        // 日志面板 - 创建到container内部
        this.logPanel = document.createElement('div');
        this.logPanel.className = 'wf-log-panel';
        const logHeader = document.createElement('div');
        logHeader.className = 'wf-log-header';
        logHeader.textContent = '执行日志';
        this.logBody = document.createElement('div');
        this.logBody.className = 'wf-log-body';
        this.logPanel.appendChild(logHeader);
        this.logPanel.appendChild(this.logBody);
        this.container.appendChild(this.logPanel);
        this._ownedElements.push(this.logPanel);
    }

    _applyTransform() {
        if (this._destroyed || !this.g) return;
        this.g.setAttribute('transform', `translate(${this.panX},${this.panY}) scale(${this.zoom})`);
    }

    _initSocket() {
        const taskFilter = (data) => !this.taskId || (data && data.taskId === this.taskId);
        const handlers = [
            { event: 'workflow:node_start', fn: (data) => { if (taskFilter(data)) this._onNodeStart(data); } },
            { event: 'workflow:node_complete', fn: (data) => { if (taskFilter(data)) this._onNodeComplete(data); } },
            { event: 'workflow:node_event', fn: (data) => { if (taskFilter(data)) this._onNodeEvent(data); } },
            { event: 'workflow:approval_required', fn: (data) => { if (taskFilter(data)) this._onApprovalRequired(data); } },
            { event: 'workflow:complete', fn: (data) => { if (taskFilter(data)) this._onWorkflowComplete(data); } },
            { event: 'workflow:failed', fn: (data) => { if (taskFilter(data)) this._onWorkflowFailed(data); } },
        ];
        for (const h of handlers) {
            this.socket.on(h.event, h.fn);
            this._socketHandlers.push(h);
        }
    }

    async load(taskId) {
        this.taskId = taskId || this.taskId;
        if (!this.taskId || this._destroyed) return;
        // 递增 token，使旧的异步 load 调用失效
        const myToken = ++this._loadToken;
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        try {
            const res = await fetch(`/api/workflow/tasks/${encodeURIComponent(this.taskId)}/workflow`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (this._destroyed || myToken !== this._loadToken) return;
            const data = await res.json().catch(() => ({}));
            if (this._destroyed || myToken !== this._loadToken) return;
            const inst = data.data || data.instance;
            if (inst) {
                this.instanceId = inst.instance_id;
                this._syncNodeStates(inst);
            }
            if (!this.definition) {
                const wtType = (inst && inst.workflow_type) || 'default';
                const wtRes = await fetch(`/api/workflow/definitions/${encodeURIComponent(wtType)}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (this._destroyed || myToken !== this._loadToken) return;
                const wtData = await wtRes.json().catch(() => ({}));
                if (this._destroyed || myToken !== this._loadToken) return;
                // loadDefinition 返回的是已解析的工作流定义对象 { nodes, edges, ... }
                const def = wtData.data;
                if (def) {
                    // def 可能是 { nodes, edges } 或 { definition_json: "..." }
                    if (def.definition_json) {
                        this.definition = typeof def.definition_json === 'string'
                            ? JSON.parse(def.definition_json)
                            : def.definition_json;
                    } else if (def.nodes) {
                        this.definition = def;
                    }
                }
            }
            if (this.definition && !this._destroyed && myToken === this._loadToken) {
                this._layoutNodes();
                this._render();
            }
        } catch (e) {
            if (!this._destroyed && myToken === this._loadToken) {
                console.error('[WorkflowBoard] load 失败', e);
                this._addLog('加载工作流失败: ' + (e.message || e), 'error');
            }
        }
    }

    _syncNodeStates(instance) {
        if (!instance) return;
        try {
            // 后端返回 context_json 而非 context
            const ctx = typeof instance.context_json === 'string' ? JSON.parse(instance.context_json)
                      : (instance.context_json || (typeof instance.context === 'string' ? JSON.parse(instance.context) : instance.context));
            if (ctx && ctx.nodeResults) {
                for (const [nodeId, result] of Object.entries(ctx.nodeResults)) {
                    this.nodeStates.set(nodeId, {
                        status: result.status || 'completed',
                        output: result.output || null,
                        events: [],
                        loopCount: (result.output && result.output.retest_count) || 0
                    });
                }
                this.currentNodeId = ctx.currentNode || null;
            }
        } catch (e) {
            // 解析失败忽略
        }
    }

    _layoutNodes() {
        const nodes = (this.definition && this.definition.nodes) || [];
        const edges = (this.definition && this.definition.edges) || [];
        this.nodes = nodes.map(n => ({ ...n, x: 0, y: 0, layer: 0 }));
        this.edges = edges.map(e => ({ ...e }));

        const nodeMap = new Map(this.nodes.map(n => [n.id, n]));
        const inDeg = new Map(this.nodes.map(n => [n.id, 0]));
        for (const e of this.edges) {
            if (e.from !== '__START__' && nodeMap.has(e.to)) {
                inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
            }
        }
        const layers = new Map();
        const queue = [];
        for (const n of this.nodes) {
            if ((inDeg.get(n.id) || 0) === 0) {
                layers.set(n.id, 0);
                queue.push(n.id);
            }
        }
        while (queue.length) {
            const id = queue.shift();
            const cur = layers.get(id) || 0;
            for (const e of this.edges) {
                if (e.from === id && nodeMap.has(e.to)) {
                    const newLayer = cur + 1;
                    if (!layers.has(e.to) || layers.get(e.to) < newLayer) {
                        layers.set(e.to, newLayer);
                        queue.push(e.to);
                    }
                }
            }
        }
        for (const n of this.nodes) {
            n.layer = layers.get(n.id) || 0;
        }
        const layerGroups = new Map();
        for (const n of this.nodes) {
            if (!layerGroups.has(n.layer)) layerGroups.set(n.layer, []);
            layerGroups.get(n.layer).push(n);
        }
        const layerWidth = 220;
        const nodeHeight = 90;
        const startY = 80;
        const maxLayer = this.nodes.length > 0 ? Math.max.apply(null, this.nodes.map(n => n.layer).concat([0])) : 0;
        for (let layer = 0; layer <= maxLayer; layer++) {
            const group = layerGroups.get(layer) || [];
            const totalHeight = group.length * nodeHeight + Math.max(0, group.length - 1) * 30;
            let y = startY + (500 - totalHeight) / 2;
            for (const n of group) {
                n.x = 80 + layer * layerWidth;
                n.y = y;
                y += nodeHeight + 30;
            }
        }
    }

    _render() {
        if (this._destroyed || !this.g) return;
        const svgNs = 'http://www.w3.org/2000/svg';
        // 清空 g 元素（使用 removeChild 循环而非 innerHTML）
        while (this.g.firstChild) {
            this.g.removeChild(this.g.firstChild);
        }
        const uid = this._uid();

        // 渲染边
        for (const edge of this.edges) {
            const fromNode = edge.from === '__START__' ? null : this.nodes.find(n => n.id === edge.from);
            const toNode = this.nodes.find(n => n.id === edge.to);
            if (!toNode) continue;
            const fromX = fromNode ? fromNode.x + 160 : 40;
            const fromY = fromNode ? fromNode.y + 45 : 250;
            const toX = toNode.x;
            const toY = toNode.y + 45;

            const path = document.createElementNS(svgNs, 'path');
            const isLoop = fromNode && toNode && fromNode.layer >= toNode.layer;
            const isConditional = edge.condition != null;
            const midX = (fromX + toX) / 2;
            const d = isLoop
                ? `M ${fromX} ${fromY} C ${fromX + 60} ${fromY - 80}, ${toX - 60} ${toY - 80}, ${toX} ${toY}`
                : `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;
            path.setAttribute('d', d);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', isLoop ? '#f59e0b' : (isConditional ? '#8b5cf6' : '#94a3b8'));
            path.setAttribute('stroke-width', '2');
            path.setAttribute('stroke-dasharray', isLoop ? '6 4' : '0');
            path.setAttribute('marker-end', isLoop ? `url(#wf-arrow-loop-${uid})` : `url(#wf-arrow-${uid})`);
            this.g.appendChild(path);

            if (isConditional && edge.condition) {
                const label = document.createElementNS(svgNs, 'text');
                label.setAttribute('x', midX);
                label.setAttribute('y', (fromY + toY) / 2 - 6);
                label.setAttribute('text-anchor', 'middle');
                label.setAttribute('font-size', '11');
                label.setAttribute('fill', '#8b5cf6');
                label.textContent = edge.condition.length > 30 ? edge.condition.slice(0, 28) + '…' : edge.condition;
                this.g.appendChild(label);
            }
        }

        // 渲染节点
        for (const node of this.nodes) {
            const state = this.nodeStates.get(node.id) || { status: 'pending' };
            const group = document.createElementNS(svgNs, 'g');
            group.setAttribute('transform', `translate(${node.x},${node.y})`);

            const rect = document.createElementNS(svgNs, 'rect');
            rect.setAttribute('width', '160');
            rect.setAttribute('height', '90');
            rect.setAttribute('rx', '8');
            rect.setAttribute('fill', state.status === 'running' ? '#eef2ff' : (state.status === 'completed' ? '#ecfdf5' : (state.status === 'failed' ? '#fef2f2' : '#fff')));
            rect.setAttribute('stroke', state.status === 'running' ? '#6366f1' : (state.status === 'completed' ? '#10b981' : (state.status === 'failed' ? '#ef4444' : '#cbd5e1')));
            rect.setAttribute('stroke-width', state.status === 'running' ? '2' : '1.5');
            group.appendChild(rect);

            const idText = document.createElementNS(svgNs, 'text');
            idText.setAttribute('x', '12');
            idText.setAttribute('y', '22');
            idText.setAttribute('font-size', '12');
            idText.setAttribute('font-weight', '600');
            idText.setAttribute('fill', '#1e293b');
            idText.textContent = node.id;
            group.appendChild(idText);

            const labelText = document.createElementNS(svgNs, 'text');
            labelText.setAttribute('x', '12');
            labelText.setAttribute('y', '42');
            labelText.setAttribute('font-size', '11');
            labelText.setAttribute('fill', '#64748b');
            labelText.textContent = (node.label || node.handler || '').slice(0, 20);
            group.appendChild(labelText);

            const badge = document.createElementNS(svgNs, 'text');
            badge.setAttribute('x', '148');
            badge.setAttribute('y', '22');
            badge.setAttribute('text-anchor', 'end');
            badge.setAttribute('font-size', '11');
            badge.setAttribute('font-weight', '600');
            const statusText = {
                pending: '⏳',
                running: '▶',
                completed: '✅',
                failed: '❌',
                skipped: '⏭️'
            }[state.status] || '⏳';
            badge.textContent = statusText;
            group.appendChild(badge);

            if (state.loopCount > 0) {
                const loopBadge = document.createElementNS(svgNs, 'circle');
                loopBadge.setAttribute('cx', '150');
                loopBadge.setAttribute('cy', '75');
                loopBadge.setAttribute('r', '12');
                loopBadge.setAttribute('fill', '#f59e0b');
                group.appendChild(loopBadge);
                const loopText = document.createElementNS(svgNs, 'text');
                loopText.setAttribute('x', '150');
                loopText.setAttribute('y', '79');
                loopText.setAttribute('text-anchor', 'middle');
                loopText.setAttribute('font-size', '10');
                loopText.setAttribute('fill', '#fff');
                loopText.setAttribute('font-weight', '700');
                loopText.textContent = `×${state.loopCount}`;
                group.appendChild(loopText);
            }

            this.g.appendChild(group);
        }
    }

    // ===== 事件处理 =====

    _onNodeStart(data) {
        if (this._destroyed) return;
        this.currentNodeId = data.nodeId;
        this._setNodeState(data.nodeId, { status: 'running' });
        this._addLog(`▶ ${data.nodeLabel || data.nodeId}: 开始执行`, 'info');
        this._render();
    }

    _onNodeComplete(data) {
        if (this._destroyed) return;
        const state = this.nodeStates.get(data.nodeId) || { events: [] };
        const output = (data.result && data.result.output) || data.output || {};
        this._setNodeState(data.nodeId, {
            status: (data.result && data.result.status) || 'completed',
            output,
            loopCount: output.retest_count || state.loopCount || 0
        });
        this._addLog(`✓ ${data.nodeLabel || data.nodeId}: ${(data.result && data.result.status) || '完成'}`, (data.result && data.result.status) === 'failed' ? 'error' : 'success');
        this._render();
    }

    _onNodeEvent(data) {
        if (this._destroyed) return;
        const state = this.nodeStates.get(data.nodeId);
        if (!state) return;
        if (!state.events) state.events = [];
        state.events.push({ event: data.event, data: data.data, ts: Date.now() });
        if (state.events.length > 50) state.events.shift();
    }

    _onApprovalRequired(data) {
        if (this._destroyed) return;
        this._addLog(`🔔 节点 ${data.nodeId} 需要审批`, 'warn');
    }

    _onWorkflowComplete(data) {
        if (this._destroyed) return;
        this._addLog('✅ 工作流执行完成', 'success');
    }

    _onWorkflowFailed(data) {
        if (this._destroyed) return;
        this._addLog(`❌ 工作流执行失败: ${data.error || data.message || '未知错误'}`, 'error');
    }

    _setNodeState(nodeId, partial) {
        const existing = this.nodeStates.get(nodeId) || { status: 'pending', events: [], loopCount: 0 };
        this.nodeStates.set(nodeId, { ...existing, ...partial });
    }

    _addLog(message, level) {
        level = level || 'info';
        if (this._destroyed) return;
        const entry = { ts: new Date(), message, level };
        this.logEntries.push(entry);
        if (this.logEntries.length > this.maxLogEntries) this.logEntries.shift();
        if (!this.logBody) return;
        const line = document.createElement('div');
        line.className = `wf-log-line wf-log-${level}`;
        // 转换为北京时间 (UTC+8)
        const beijingTime = new Date(entry.ts.getTime() + (entry.ts.getTimezoneOffset() + 480) * 60000);
        const pad = n => String(n).padStart(2, '0');
        const time = `${pad(beijingTime.getHours())}:${pad(beijingTime.getMinutes())}:${pad(beijingTime.getSeconds())}`;
        line.textContent = `[${time}] ${message}`;
        this.logBody.appendChild(line);
        this.logBody.scrollTop = this.logBody.scrollHeight;
    }

    _escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // ===== 销毁 =====

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._loadToken++; // 使所有正在进行的 load 调用失效
        // 精确移除socket监听器
        if (this.socket && this._socketHandlers.length) {
            for (const h of this._socketHandlers) {
                try { this.socket.removeListener(h.event, h.fn); } catch (e) {}
            }
            this._socketHandlers = [];
        }
        // 移除window/document事件监听器
        for (const h of this._globalHandlers) {
            try { h.target.removeEventListener(h.type, h.handler); } catch (e) {}
        }
        this._globalHandlers = [];
        // 移除本实例创建的额外DOM元素
        for (const el of this._ownedElements) {
            if (el && el.parentElement) {
                try { el.parentElement.removeChild(el); } catch (e) {}
            }
        }
        this._ownedElements = [];
        // 清空容器
        if (this.container) {
            while (this.container.firstChild) {
                this.container.removeChild(this.container.firstChild);
            }
        }
        // 释放引用
        this.svg = null;
        this.g = null;
        this.logBody = null;
        this.logPanel = null;
    }
}

if (typeof window !== 'undefined') {
    window.WorkflowBoard = WorkflowBoard;
}
