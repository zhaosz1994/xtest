(function() {
  'use strict';

  var ButtonState = {
    IDLE: 'idle',
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed'
  };

  window.ButtonState = ButtonState;

  var ButtonStateManager = function() {
    this.buttonStates = new Map();
  };

  ButtonStateManager.prototype.setState = function(pointId, state) {
    this.buttonStates.set(pointId, state);
    this.updateButtonUI(pointId, state);
  };

  ButtonStateManager.prototype.getState = function(pointId) {
    return this.buttonStates.get(pointId) || ButtonState.IDLE;
  };

  ButtonStateManager.prototype.isClickable = function(pointId) {
    var state = this.getState(pointId);
    return state === ButtonState.IDLE || state === ButtonState.COMPLETED || state === ButtonState.FAILED;
  };

  ButtonStateManager.prototype.updateButtonUI = function(pointId, state) {
    var button = document.querySelector('.ai-generate-overview-btn[data-point-id="' + pointId + '"]') ||
                 document.getElementById('ai-generate-summary-btn');
    if (!button) return;

    var self = this;
    switch (state) {
      case ButtonState.IDLE:
        button.disabled = false;
        button.classList.remove('btn-loading', 'btn-success', 'btn-error');
        button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"></path><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg> AI生成概述';
        button.title = '点击AI自动生成概述';
        break;
      case ButtonState.PENDING:
        button.disabled = true;
        button.classList.add('btn-loading');
        button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32"></circle></svg> 排队中...';
        button.title = '任务已提交，正在排队等待处理';
        break;
      case ButtonState.PROCESSING:
        button.disabled = true;
        button.classList.add('btn-loading');
        button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32"></circle></svg> 生成中...';
        button.title = 'AI正在生成概述，请稍候';
        break;
      case ButtonState.COMPLETED:
        button.disabled = false;
        button.classList.remove('btn-loading');
        button.classList.add('btn-success');
        button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"></path></svg> 已完成';
        button.title = '概述生成完成';
        setTimeout(function() { self.setState(pointId, ButtonState.IDLE); }, 2000);
        break;
      case ButtonState.FAILED:
        button.disabled = false;
        button.classList.remove('btn-loading');
        button.classList.add('btn-error');
        button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg> 失败';
        button.title = '概述生成失败，点击重试';
        setTimeout(function() { self.setState(pointId, ButtonState.IDLE); }, 3000);
        break;
    }
  };

  window.buttonStateManager = new ButtonStateManager();

  var BatchSelectionManager = function() {
    this.mode = null;
    this.selectedIds = new Set();
    this.conflictStrategy = 'overwrite';
  };

  BatchSelectionManager.prototype.enterMode = function(mode) {
    this.mode = mode;
    this.selectedIds.clear();
    this.conflictStrategy = 'overwrite';
    this.renderBatchUI();
    this.transformListUI();

    if (mode === 'key_config') {
      var self = this;
      var hasExpandedCases = document.querySelectorAll('.level1-test-case-item').length > 0;
      if (!hasExpandedCases && typeof window.toggleExpandAllLevel1 === 'function') {
        window.toggleExpandAllLevel1();
      }
      setTimeout(function() {
        self.transformListUI();
      }, 1000);
    }
  };

  BatchSelectionManager.prototype.exitMode = function() {
    this.mode = null;
    this.selectedIds.clear();
    this.removeBatchUI();
    this.restoreListUI();
  };

  BatchSelectionManager.prototype.toggleSelect = function(id) {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this.updateBatchBar();
    this.updateCheckboxUI(id);
  };

  BatchSelectionManager.prototype.selectAll = function(visibleIds) {
    var self = this;
    visibleIds.forEach(function(id) { self.selectedIds.add(id); });
    this.updateBatchBar();
    this.updateAllCheckboxes();
  };

  BatchSelectionManager.prototype.deselectAll = function() {
    this.selectedIds.clear();
    this.updateBatchBar();
    this.updateAllCheckboxes();
  };

  BatchSelectionManager.prototype.updateBatchBar = function() {
    var countEl = document.getElementById('ai-task-batch-count');
    if (countEl) {
      countEl.textContent = this.selectedIds.size;
    }
    var countEl2 = document.getElementById('ai-task-batch-count2');
    if (countEl2) {
      countEl2.textContent = this.selectedIds.size;
    }
    var submitBtn = document.getElementById('ai-task-batch-submit');
    if (submitBtn) {
      submitBtn.disabled = this.selectedIds.size === 0;
    }
  };

  BatchSelectionManager.prototype.updateCheckboxUI = function(id) {
    var checkbox = document.querySelector('.ai-task-batch-checkbox[data-id="' + id + '"]');
    if (checkbox) {
      checkbox.checked = this.selectedIds.has(id);
    }
  };

  BatchSelectionManager.prototype.updateAllCheckboxes = function() {
    var self = this;
    document.querySelectorAll('.ai-task-batch-checkbox').forEach(function(cb) {
      var id = parseInt(cb.dataset.id);
      cb.checked = self.selectedIds.has(id);
    });
  };

  BatchSelectionManager.prototype.renderBatchUI = function() {
    var existing = document.getElementById('ai-task-batch-bar');
    if (existing) existing.remove();

    var bar = document.createElement('div');
    bar.id = 'ai-task-batch-bar';
    bar.className = 'ai-task-batch-bar';
    bar.innerHTML = this._buildBatchBarHTML();

    var listContainer = document.querySelector('.level1-list-container');
    if (!listContainer) {
      var tableEl = document.getElementById('test-points-body');
      listContainer = tableEl ? tableEl.closest('.floating-panel-content') || tableEl.closest('table') : null;
    }
    if (!listContainer) {
      listContainer = document.querySelector('.floating-panel-content');
    }
    if (listContainer) {
      listContainer.parentNode.insertBefore(bar, listContainer);
    } else {
      var level1Section = document.getElementById('level1-section') || document.querySelector('[data-section="level1"]');
      if (level1Section) {
        level1Section.insertBefore(bar, level1Section.firstChild);
      }
    }
  };

  BatchSelectionManager.prototype._buildBatchBarHTML = function() {
    var isOverview = this.mode === 'overview';
    var title = isOverview ? '批量生成概述' : '批量生成关键配置';
    var icon = isOverview ? '📝' : '🔧';

    return '<div class="ai-task-batch-inner">' +
      '<div class="ai-task-batch-header">' +
        '<label class="ai-task-batch-select-all"><input type="checkbox" id="ai-task-batch-select-all" onchange="window.batchSelectionManager.handleSelectAll(this.checked)" style="width:16px;height:16px;accent-color:#6366f1;cursor:pointer;"> 全选</label>' +
        '<span class="ai-task-batch-count">已选 <strong id="ai-task-batch-count">0</strong> 项</span>' +
      '</div>' +
      '<div class="ai-task-batch-body">' +
        '<div class="ai-task-batch-title">' + icon + ' ' + title + ' (<span id="ai-task-batch-count2">0</span>)</div>' +
        '<div class="ai-task-batch-strategy">' +
          '<div class="ai-task-batch-strategy-label">冲突处理:</div>' +
          '<label class="ai-task-batch-radio"><input type="radio" name="ai-task-conflict" value="overwrite" checked onchange="window.batchSelectionManager.conflictStrategy=\'overwrite\'"> 覆盖</label>' +
          '<label class="ai-task-batch-radio"><input type="radio" name="ai-task-conflict" value="append" onchange="window.batchSelectionManager.conflictStrategy=\'append\'"> 追加</label>' +
          '<label class="ai-task-batch-radio"><input type="radio" name="ai-task-conflict" value="skip" onchange="window.batchSelectionManager.conflictStrategy=\'skip\'"> 跳过</label>' +
        '</div>' +
        '<div class="ai-task-batch-actions">' +
          '<button class="ai-task-btn ai-task-btn-cancel" onclick="window.batchSelectionManager.exitMode()">取消</button>' +
          '<button class="ai-task-btn ai-task-btn-submit" id="ai-task-batch-submit" disabled onclick="window.batchSelectionManager.submitBatch()">提交到队列</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  };

  BatchSelectionManager.prototype.removeBatchUI = function() {
    var bar = document.getElementById('ai-task-batch-bar');
    if (bar) bar.remove();
  };

  BatchSelectionManager.prototype.transformListUI = function() {
    var self = this;

    if (this.mode === 'overview') {
      document.querySelectorAll('.level1-list-item').forEach(function(item) {
        var pointId = item.dataset.pointId;
        if (!pointId) return;

        var existing = item.querySelector('.ai-task-batch-checkbox-cell');
        if (existing) return;

        var firstCol = item.querySelector(':scope > div:first-child');
        if (!firstCol) return;

        var cell = document.createElement('div');
        cell.className = 'ai-task-batch-checkbox-cell';
        cell.style.cssText = 'display:flex;align-items:center;margin-right:4px;';
        cell.innerHTML = '<input type="checkbox" class="ai-task-batch-checkbox" data-id="' + pointId + '" data-type="level1_point" onchange="event.stopPropagation();window.batchSelectionManager.toggleSelect(' + pointId + ')" onclick="event.stopPropagation()" style="width:16px;height:16px;accent-color:#6366f1;cursor:pointer;">';
        firstCol.insertBefore(cell, firstCol.firstChild);

        item.style.gridTemplateColumns = '70px 338px 2fr 80px 80px 130px 120px';
      });
    } else if (this.mode === 'key_config') {
      document.querySelectorAll('.level1-test-case-item').forEach(function(item) {
        var onclickAttr = item.getAttribute('onclick') || '';
        var match = onclickAttr.match(/openEditTestCaseDrawer\((\d+)\)/);
        if (!match) return;
        var caseId = match[1];

        var existing = item.querySelector('.ai-task-batch-checkbox-cell');
        if (existing) return;

        var firstCol = item.querySelector(':scope > div:first-child');
        if (!firstCol) return;

        var cell = document.createElement('div');
        cell.className = 'ai-task-batch-checkbox-cell';
        cell.style.cssText = 'display:flex;align-items:center;margin-right:2px;';
        cell.innerHTML = '<input type="checkbox" class="ai-task-batch-checkbox" data-id="' + caseId + '" data-type="test_case" onchange="event.stopPropagation();window.batchSelectionManager.toggleSelect(' + caseId + ')" onclick="event.stopPropagation()" style="width:16px;height:16px;accent-color:#6366f1;cursor:pointer;">';
        firstCol.insertBefore(cell, firstCol.firstChild);

        item.style.gridTemplateColumns = '48px 302px 1fr 90px 70px 50px 100px 60px';
      });

      document.querySelectorAll('.test-case-row').forEach(function(row) {
        var caseId = row.dataset.caseId;
        if (!caseId) return;

        var existing = row.querySelector('.ai-task-batch-checkbox-cell');
        if (existing) return;

        var firstTd = row.querySelector('td');
        if (!firstTd) return;

        var cell = document.createElement('td');
        cell.className = 'ai-task-batch-checkbox-cell';
        cell.style.cssText = 'text-align:center;width:40px;';
        cell.innerHTML = '<input type="checkbox" class="ai-task-batch-checkbox" data-id="' + caseId + '" data-type="test_case" onchange="event.stopPropagation();window.batchSelectionManager.toggleSelect(' + caseId + ')" onclick="event.stopPropagation()" style="width:16px;height:16px;accent-color:#6366f1;cursor:pointer;">';
        row.insertBefore(cell, firstTd);
      });
    }
  };

  BatchSelectionManager.prototype.restoreListUI = function() {
    document.querySelectorAll('.ai-task-batch-checkbox-cell').forEach(function(cell) {
      cell.remove();
    });
    document.querySelectorAll('.level1-list-item').forEach(function(item) {
      item.style.gridTemplateColumns = '';
    });
    document.querySelectorAll('.level1-test-case-item').forEach(function(item) {
      item.style.gridTemplateColumns = '';
    });
  };

  BatchSelectionManager.prototype.handleSelectAll = function(checked) {
    if (checked) {
      var ids = [];
      document.querySelectorAll('.ai-task-batch-checkbox').forEach(function(cb) {
        ids.push(parseInt(cb.dataset.id));
      });
      this.selectAll(ids);
    } else {
      this.deselectAll();
    }
  };

  BatchSelectionManager.prototype.submitBatch = function() {
    var ids = Array.from(this.selectedIds);
    if (ids.length === 0) return;

    var isOverview = this.mode === 'overview';
    var endpoint = isOverview ? '/ai-tasks/batch/overview' : '/ai-tasks/batch/key-config';
    var bodyKey = isOverview ? 'level1PointIds' : 'caseIds';

    var self = this;
    var body = {};
    body[bodyKey] = ids;
    body.conflictStrategy = self.conflictStrategy;

    apiRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    }).then(function(response) {
      if (response.success) {
        if (typeof window.showSuccessMessage === 'function') {
          window.showSuccessMessage(response.message);
        }
        self.exitMode();
      } else {
        if (typeof window.showErrorMessage === 'function') {
          window.showErrorMessage(response.message);
        }
      }
    }).catch(function(error) {
      if (typeof window.showErrorMessage === 'function') {
        window.showErrorMessage('批量提交失败: ' + error.message);
      }
    });
  };

  BatchSelectionManager.prototype.isPointGenerating = function(pointId) {
    var task = window.unifiedTaskManager ? window.unifiedTaskManager.getTasksByTarget('level1_point', pointId) : [];
    return task.length > 0;
  };

  window.batchSelectionManager = new BatchSelectionManager();

  var UnifiedTaskManager = function() {
    this.tasks = new Map();
    this.init();
  };

  UnifiedTaskManager.prototype.init = function() {
    var self = this;
    this._bindSocketEvents();
    if (typeof authToken !== 'undefined' && authToken) {
      this.loadPendingTasks();
    }
  };

  UnifiedTaskManager.prototype._bindSocketEvents = function() {
    var self = this;
    var tryBind = function() {
      var s = (typeof socket !== 'undefined' && socket !== null) ? socket : (typeof io !== 'undefined' ? (window._socket || null) : null);
      if (s && typeof s.on === 'function') {
        s.on('ai_task_complete', function(data) {
          self.handleTaskComplete(data);
        });
        s.on('reconnect', function() {
          self.loadPendingTasks();
        });
        return true;
      }
      return false;
    };
    if (!tryBind()) {
      var bindInterval = setInterval(function() {
        if (tryBind()) {
          clearInterval(bindInterval);
        }
      }, 1000);
      setTimeout(function() { clearInterval(bindInterval); }, 30000);
    }
  };

  UnifiedTaskManager.prototype.loadPendingTasks = function() {
    var self = this;
    if (typeof authToken === 'undefined' || !authToken) return;
    apiRequest('/ai-tasks/running', { useCache: false }).then(function(response) {
      if (response.success && response.data) {
        // 用服务端返回的运行中任务列表来同步本地Map，清理已不在运行中的陈旧条目
        var serverTaskIds = new Set();
        response.data.forEach(function(task) {
          serverTaskIds.add(task.task_id);
          self.tasks.set(task.task_id, task);
        });
        // 清理本地Map中已不在服务端运行列表中的陈旧任务
        var staleIds = [];
        self.tasks.forEach(function(taskInfo, taskId) {
          if (!serverTaskIds.has(taskId)) {
            staleIds.push(taskId);
          }
        });
        staleIds.forEach(function(taskId) {
          self.tasks.delete(taskId);
        });
        self.updateGlobalUI();
      }
    }).catch(function(error) {
      console.error('加载待处理任务失败:', error);
    });
  };

  UnifiedTaskManager.prototype.addTask = function(taskId, taskInfo) {
    this.tasks.set(taskId, Object.assign({}, taskInfo, { createdAt: Date.now() }));
    this.updateGlobalUI();
  };

  UnifiedTaskManager.prototype.removeTask = function(taskId) {
    this.tasks.delete(taskId);
    this.updateGlobalUI();
  };

  UnifiedTaskManager.prototype.getTask = function(taskId) {
    return this.tasks.get(taskId);
  };

  UnifiedTaskManager.prototype.getTasksByType = function(taskType) {
    var result = [];
    this.tasks.forEach(function(taskInfo, taskId) {
      if (taskInfo.task_type === taskType || taskInfo.taskType === taskType) {
        result.push(Object.assign({ taskId: taskId }, taskInfo));
      }
    });
    return result;
  };

  UnifiedTaskManager.prototype.getTasksByTarget = function(targetType, targetId) {
    var result = [];
    this.tasks.forEach(function(taskInfo, taskId) {
      if ((taskInfo.target_type === targetType || taskInfo.targetType === targetType) &&
          (taskInfo.target_id == targetId || taskInfo.targetId == targetId)) {
        result.push(Object.assign({ taskId: taskId }, taskInfo));
      }
    });
    return result;
  };

  UnifiedTaskManager.prototype.getTasksByStatus = function(status) {
    var result = [];
    this.tasks.forEach(function(taskInfo, taskId) {
      if (taskInfo.status === status) {
        result.push(Object.assign({ taskId: taskId }, taskInfo));
      }
    });
    return result;
  };

  UnifiedTaskManager.prototype.handleTaskComplete = function(data) {
    var taskId = data.taskId || data.task_id;
    var taskType = data.taskType || data.task_type;
    var targetType = data.targetType || data.target_type;
    var targetId = data.targetId || data.target_id;
    var success = data.success;
    var result = data.result;
    var errorMessage = data.errorMessage;

    // 标记此事件已被处理，防止其他监听器重复处理
    if (this._processedEvents && this._processedEvents.has(taskId)) {
      return;
    }
    if (!this._processedEvents) {
      this._processedEvents = new Set();
    }
    this._processedEvents.add(taskId);
    // 清理超过5分钟的已处理事件记录，防止内存泄漏
    if (this._processedEvents.size > 1000) {
      this._processedEvents.clear();
    }

    var taskInfo = this.tasks.get(taskId);

    if (taskInfo) {
      this.updateTaskUI(taskId, success ? 'completed' : 'failed', result);
      if (success) {
        if (typeof window.showSuccessMessage === 'function') {
          window.showSuccessMessage('任务完成 - ' + (taskInfo.target_name || taskInfo.targetName || ''));
        }
      } else {
        if (typeof window.showErrorMessage === 'function') {
          window.showErrorMessage('任务失败 - ' + (taskInfo.target_name || taskInfo.targetName || '') + ': ' + errorMessage);
        }
      }
      this.removeTask(taskId);
    } else {
      // 任务不在本地Map中，尝试通过_pendingAIOverview/_pendingAIKeyConfig处理
      this.handlePendingTaskComplete(data);
      if (success) {
        if (typeof window.showSuccessMessage === 'function') {
          window.showSuccessMessage('任务完成');
        }
      } else {
        if (typeof window.showErrorMessage === 'function') {
          window.showErrorMessage('任务失败: ' + errorMessage);
        }
      }
    }

    this.updateTaskBadge();
    if (typeof window.loadAITaskCenterData === 'function' && window.isAITaskCenterOpen()) {
      window.loadAITaskCenterData();
    }
  };

  // 处理通过_pendingAIOverview/_pendingAIKeyConfig注册的待处理任务完成事件
  UnifiedTaskManager.prototype.handlePendingTaskComplete = function(data) {
    var taskType = data.taskType || data.task_type;
    var success = data.success;
    var result = data.result;
    var errorMessage = data.errorMessage;

    if (!success) {
      if (taskType === 'overview_generation') {
        if (typeof window.resetOverviewBtn === 'function') window.resetOverviewBtn();
      }
      if (taskType === 'key_config_generation') {
        if (typeof window.resetKeyConfigBtn === 'function') window.resetKeyConfigBtn();
      }
      return;
    }

    if (taskType === 'overview_generation') {
      var pendingOverview = window._pendingAIOverview;
      var targetPointId = data.level1PointId || data.level1_point_id || data.targetId || data.target_id;
      if (pendingOverview && pendingOverview.textarea && document.body.contains(pendingOverview.textarea) && pendingOverview.pointId === targetPointId) {
        var appendMode = data.appendMode || data.append_mode || pendingOverview.appendMode;
        if (appendMode && pendingOverview.existingSummary) {
          pendingOverview.textarea.value = pendingOverview.existingSummary + '\n' + result;
        } else {
          pendingOverview.textarea.value = result;
        }
        pendingOverview.textarea.dispatchEvent(new Event('input'));
        if (typeof window.updateLevel1SummaryInList === 'function') {
          window.updateLevel1SummaryInList(pendingOverview.pointId, pendingOverview.textarea.value);
        }
        if (pendingOverview.generateBtn && typeof window.resetOverviewBtn === 'function') {
          window.resetOverviewBtn(pendingOverview.generateBtn);
        }
        delete window._pendingAIOverview;
      }
    }

    if (taskType === 'key_config_generation') {
      var pendingKeyConfig = window._pendingAIKeyConfig;
      if (pendingKeyConfig && pendingKeyConfig.textarea && document.body.contains(pendingKeyConfig.textarea) && pendingKeyConfig.caseName === (data.caseName || data.case_name)) {
        var appendMode = data.appendMode || data.append_mode || pendingKeyConfig.appendMode;
        if (appendMode && pendingKeyConfig.existingConfig) {
          pendingKeyConfig.textarea.value = pendingKeyConfig.existingConfig + '\n' + result;
        } else {
          pendingKeyConfig.textarea.value = result;
        }
        pendingKeyConfig.textarea.dispatchEvent(new Event('input'));
        if (pendingKeyConfig.generateBtn && typeof window.resetKeyConfigBtn === 'function') {
          window.resetKeyConfigBtn(pendingKeyConfig.generateBtn);
        }
        delete window._pendingAIKeyConfig;
      }
    }
  };

  UnifiedTaskManager.prototype.updateTaskUI = function(taskId, status, result) {
    var taskInfo = this.tasks.get(taskId);
    if (!taskInfo) return;

    var taskType = taskInfo.task_type || taskInfo.taskType;
    var targetId = taskInfo.target_id || taskInfo.targetId;

    switch (taskType) {
      case 'overview_generation':
        this.updateOverviewUI(taskInfo, status, result);
        break;
      case 'key_config_generation':
        this.updateKeyConfigUI(taskInfo, status, result);
        break;
    }
  };

  UnifiedTaskManager.prototype.updateOverviewUI = function(taskInfo, status, result) {
    var targetId = taskInfo.target_id || taskInfo.targetId;

    if (status === 'completed' && result) {
      var textarea = document.getElementById('edit-level1-point-summary');
      if (textarea) {
        var finalSummary = result;
        var appendMode = false;
        try {
          appendMode = taskInfo.appendMode || (taskInfo.config && (typeof taskInfo.config === 'string' ? JSON.parse(taskInfo.config).appendMode : taskInfo.config.appendMode));
        } catch (e) {
          console.error('解析概述任务配置失败:', e);
        }
        var existingSummary = textarea.value.trim();
        if (appendMode && existingSummary) {
          finalSummary = existingSummary + '\n' + result;
        }
        textarea.value = finalSummary;
        textarea.dispatchEvent(new Event('input'));
      }

      if (typeof window.updateLevel1SummaryInList === 'function') {
        window.updateLevel1SummaryInList(targetId, result);
      }
      if (typeof window.updateLevel1DetailModalSummary === 'function') {
        window.updateLevel1DetailModalSummary(targetId, result);
      }
    }

    if (typeof window.resetOverviewBtn === 'function') {
      window.resetOverviewBtn();
    }
  };

  UnifiedTaskManager.prototype.updateKeyConfigUI = function(taskInfo, status, result) {
    if (status === 'completed' && result) {
      var keyConfigField = document.getElementById('drawer-testcase-key-config') || document.getElementById('detail-case-key-config');
      if (keyConfigField) {
        var appendMode = false;
        try {
          appendMode = taskInfo.appendMode || (taskInfo.config && (typeof taskInfo.config === 'string' ? JSON.parse(taskInfo.config).appendMode : taskInfo.config.appendMode));
        } catch (e) {
          console.error('解析关键配置任务配置失败:', e);
        }
        var existingConfig = keyConfigField.value.trim();
        if (appendMode && existingConfig) {
          keyConfigField.value = existingConfig + '\n' + result;
        } else {
          keyConfigField.value = result;
        }
        keyConfigField.dispatchEvent(new Event('input'));
      }
    }

    if (typeof window.resetKeyConfigBtn === 'function') {
      window.resetKeyConfigBtn();
    }
  };

  UnifiedTaskManager.prototype.updateGlobalUI = function() {
    this.updateTaskBadge();
  };

  UnifiedTaskManager.prototype.updateTaskBadge = function() {
    var badge = document.getElementById('ai-task-badge');
    if (!badge) return;
    if (typeof authToken === 'undefined' || !authToken) return;

    var self = this;
    apiRequest('/ai-tasks/stats', { useCache: false }).then(function(data) {
      if (data.success) {
        var runningCount = (data.data.processing || 0) + (data.data.pending || 0);
        if (runningCount > 0) {
          badge.textContent = runningCount;
          badge.style.display = 'block';
        } else {
          badge.style.display = 'none';
        }
      }
    }).catch(function() {});
  };

  window.unifiedTaskManager = new UnifiedTaskManager();

  window.openAITaskCenter = function() {
    var panel = document.getElementById('ai-task-center-panel');
    if (panel) {
      panel.classList.add('ai-task-panel-open');
      window.loadAITaskCenterData();
      return;
    }

    var overlay = document.createElement('div');
    overlay.id = 'ai-task-center-overlay';
    overlay.className = 'ai-task-overlay';

    panel = document.createElement('div');
    panel.id = 'ai-task-center-panel';
    panel.className = 'ai-task-panel';

    panel.innerHTML =
      '<div class="ai-task-resize-handle" id="ai-task-resize-handle"></div>' +
      '<div class="ai-task-panel-header">' +
        '<h2 class="ai-task-panel-title">AI任务中心</h2>' +
        '<div class="ai-task-panel-actions">' +
          '<button class="ai-task-header-btn" onclick="window.loadAITaskCenterData()">刷新</button>' +
          '<button class="ai-task-header-btn ai-task-close-btn" onclick="window.closeAITaskCenter()">✕</button>' +
        '</div>' +
      '</div>' +
      '<div id="ai-task-stats-cards" class="ai-task-stats-cards"></div>' +
      '<div class="ai-task-tabs">' +
        '<button class="ai-task-tab active" data-tab="running" onclick="window.switchAITaskTab(\'running\')">进行中 <span id="ai-task-running-count" class="ai-task-tab-badge">0</span></button>' +
        '<button class="ai-task-tab" data-tab="stats" onclick="window.switchAITaskTab(\'stats\')">统计</button>' +
      '</div>' +
      '<div class="ai-task-panel-content">' +
        '<div id="ai-task-tab-running" class="ai-task-tab-content"></div>' +
        '<div id="ai-task-tab-stats" class="ai-task-tab-content" style="display:none;"></div>' +
      '</div>' +
      '<div class="ai-task-panel-footer">' +
        '<a href="/ai-operation-logs.html" target="_blank" class="ai-task-footer-link">查看历史记录与详细日志 →</a>' +
      '</div>';

    document.body.appendChild(overlay);
    document.body.appendChild(panel);

    overlay.onclick = window.closeAITaskCenter;

    initAITaskPanelResize();

    requestAnimationFrame(function() {
      panel.classList.add('ai-task-panel-open');
    });

    window.loadAITaskCenterData();
  };

  window.closeAITaskCenter = function() {
    var panel = document.getElementById('ai-task-center-panel');
    var overlay = document.getElementById('ai-task-center-overlay');
    if (panel) {
      panel.classList.remove('ai-task-panel-open');
    }
    setTimeout(function() {
      if (panel) panel.remove();
      if (overlay) overlay.remove();
    }, 300);
  };

  function initAITaskPanelResize() {
    var handle = document.getElementById('ai-task-resize-handle');
    var panel = document.getElementById('ai-task-center-panel');
    if (!handle || !panel) return;

    var isResizing = false;
    var startX = 0;
    var startWidth = 0;

    handle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      isResizing = true;
      startX = e.clientX;
      startWidth = panel.offsetWidth;
      handle.classList.add('ai-task-resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      panel.style.transition = 'none';
    });

    document.addEventListener('mousemove', function(e) {
      if (!isResizing) return;
      var dx = startX - e.clientX;
      var newWidth = Math.min(Math.max(startWidth + dx, 400), window.innerWidth * 0.9);
      panel.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', function() {
      if (!isResizing) return;
      isResizing = false;
      handle.classList.remove('ai-task-resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      panel.style.transition = '';
    });
  }

  window.isAITaskCenterOpen = function() {
    var panel = document.getElementById('ai-task-center-panel');
    return panel !== null && panel.classList.contains('ai-task-panel-open');
  };

  window.loadAITaskCenterData = function() {
    loadRunningTasks();
    loadTaskStats();
  };

  function loadRunningTasks() {
    if (typeof authToken === 'undefined' || !authToken) return;
    apiRequest('/ai-tasks/running', { useCache: false }).then(function(response) {
      if (response.success && response.data) {
        renderRunningTasks(response.data);
        var countEl = document.getElementById('ai-task-running-count');
        if (countEl) countEl.textContent = response.data.length;
      }
    }).catch(function(error) {
      console.error('加载运行中任务失败:', error);
    });
  }

  function loadTaskStats() {
    if (typeof authToken === 'undefined' || !authToken) return;
    apiRequest('/ai-tasks/stats', { useCache: false }).then(function(response) {
      if (response.success && response.data) {
        renderStatsCards(response.data);
        renderStatsTab(response.data);
      }
    }).catch(function(error) {
      console.error('加载统计失败:', error);
    });
  }

  function renderStatsCards(stats) {
    var container = document.getElementById('ai-task-stats-cards');
    if (!container) return;

    var cards = [
      { label: '总任务', value: stats.total, color: '#6366f1' },
      { label: '处理中', value: stats.processing, color: '#f59e0b' },
      { label: '排队中', value: stats.pending, color: '#3b82f6' },
      { label: '已完成', value: stats.completed, color: '#10b981' },
      { label: '失败', value: stats.failed, color: '#ef4444' }
    ];

    container.innerHTML = cards.map(function(card) {
      return '<div class="ai-task-stat-card" style="border-top:3px solid ' + card.color + ';">' +
        '<div class="ai-task-stat-value" style="color:' + card.color + ';">' + card.value + '</div>' +
        '<div class="ai-task-stat-label">' + card.label + '</div>' +
      '</div>';
    }).join('');
  }

  function renderRunningTasks(tasks) {
    var container = document.getElementById('ai-task-tab-running');
    if (!container) return;

    if (tasks.length === 0) {
      container.innerHTML = '<div class="ai-task-empty"><div class="ai-task-empty-icon">🎉</div><div class="ai-task-empty-text">暂无进行中的任务</div><div class="ai-task-empty-sub">所有AI任务都已完成</div></div>';
      return;
    }

    var typeConfig = {
      'overview_generation': { icon: '📝', label: '概述生成', color: '#3b82f6' },
      'key_config_generation': { icon: '🔧', label: '关键配置', color: '#8b5cf6' },
      'case_generation': { icon: '🧪', label: '用例生成', color: '#10b981' },
      'report_generation': { icon: '📊', label: '报告生成', color: '#f59e0b' }
    };

    container.innerHTML = tasks.map(function(task) {
      var tc = typeConfig[task.task_type] || { icon: '❓', label: '未知', color: '#6b7280' };
      var statusText = task.status === 'processing' ? '生成中...' : '排队中...';
      var isPending = task.status === 'pending';
      var safeTaskId = (task.task_id || '').replace(/[^a-zA-Z0-9_\-]/g, '');
      var safeTargetName = (task.target_name || '未知目标').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      var safeUsername = (task.username || '未知').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      var safeProgressMsg = (task.progress_message || statusText).replace(/</g, '&lt;').replace(/>/g, '&gt;');

      return '<div class="ai-task-running-item" style="border-left:4px solid ' + tc.color + ';">' +
        '<div class="ai-task-running-header">' +
          '<div class="ai-task-running-info">' +
            '<span class="ai-task-type-icon">' + tc.icon + '</span>' +
            '<span class="ai-task-type-badge" style="background:' + tc.color + '20;color:' + tc.color + ';">' + tc.label + '</span>' +
            '<span class="ai-task-target-name">' + safeTargetName + '</span>' +
            '<span class="ai-task-username">👤 ' + safeUsername + '</span>' +
          '</div>' +
          (isPending ? '<button class="ai-task-cancel-btn" onclick="window.cancelAITask(\'' + safeTaskId + '\')">取消</button>' : '') +
        '</div>' +
        '<div class="ai-task-progress-row">' +
          '<div class="ai-task-progress-bar"><div class="ai-task-progress-fill" style="width:' + (task.progress || 0) + '%;background:' + tc.color + ';"></div></div>' +
          '<span class="ai-task-progress-text">' + (task.progress || 0) + '%</span>' +
        '</div>' +
        '<div class="ai-task-progress-msg">' + safeProgressMsg + '</div>' +
      '</div>';
    }).join('');
  }

  function renderStatsTab(stats) {
    var container = document.getElementById('ai-task-tab-stats');
    if (!container) return;

    container.innerHTML =
      '<div class="ai-task-stats-detail">' +
        '<div class="ai-task-stats-row"><span>完成率</span><span>' + stats.completionRate + '%</span></div>' +
        '<div class="ai-task-stats-row"><span>平均耗时</span><span>' + stats.avgDuration + 's</span></div>' +
        '<div class="ai-task-stats-row"><span>Token消耗</span><span>' + (stats.totalTokens || 0).toLocaleString() + '</span></div>' +
        '<div class="ai-task-stats-row"><span>活跃用户</span><span>' + stats.activeUsers + '人</span></div>' +
      '</div>';
  }

  window.switchAITaskTab = function(tab) {
    document.querySelectorAll('.ai-task-tab').forEach(function(t) { t.classList.remove('active'); });
    var activeTab = document.querySelector('.ai-task-tab[data-tab="' + tab + '"]');
    if (activeTab) activeTab.classList.add('active');
    document.querySelectorAll('.ai-task-tab-content').forEach(function(c) { c.style.display = 'none'; });
    var tabContent = document.getElementById('ai-task-tab-' + tab);
    if (tabContent) tabContent.style.display = 'block';
  };

  window.cancelAITask = function(taskId) {
    apiRequest('/ai-tasks/cancel/' + taskId, { method: 'POST' }).then(function(response) {
      if (response.success) {
        if (typeof window.showSuccessMessage === 'function') window.showSuccessMessage('任务已取消');
        loadRunningTasks();
      } else {
        if (typeof window.showErrorMessage === 'function') window.showErrorMessage(response.message);
      }
    }).catch(function(error) {
      if (typeof window.showErrorMessage === 'function') window.showErrorMessage('取消任务失败');
    });
  };

  var _taskCenterRefreshTimer = null;
  function startTaskCenterRefresh() {
    if (_taskCenterRefreshTimer) clearInterval(_taskCenterRefreshTimer);
    _taskCenterRefreshTimer = setInterval(function() {
      if (window.isAITaskCenterOpen()) {
        loadRunningTasks();
      }
      // 定期同步本地tasks Map与服务端状态，清理断线期间已完成的陈旧任务
      window.unifiedTaskManager.loadPendingTasks();
      window.unifiedTaskManager.updateTaskBadge();
    }, 10000);
  }
  startTaskCenterRefresh();

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('beforeunload', function() {
      if (_taskCenterRefreshTimer) {
        clearInterval(_taskCenterRefreshTimer);
        _taskCenterRefreshTimer = null;
      }
    });
  }

  window.toggleAIGenerateMenu = function(menuId, event) {
    event.stopPropagation();
    var menu = document.getElementById(menuId);
    if (!menu) return;

    document.querySelectorAll('.ai-gen-dropdown-menu').forEach(function(m) {
      if (m.id !== menuId) m.classList.remove('ai-gen-menu-open');
    });

    menu.classList.toggle('ai-gen-menu-open');
  };

  document.addEventListener('click', function() {
    document.querySelectorAll('.ai-gen-dropdown-menu').forEach(function(m) {
      m.classList.remove('ai-gen-menu-open');
    });
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      if (window.batchSelectionManager && window.batchSelectionManager.mode) {
        window.batchSelectionManager.exitMode();
      }
      window.closeAITaskCenter();
    }
  });

})();
