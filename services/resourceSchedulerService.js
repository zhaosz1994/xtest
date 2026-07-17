const pool = require('../db');
const logger = require('./logger');
const { isAdmin } = require('../middleware');
const { safeJson, jsonValue, newId, parsePositiveInt } = require('./agentUtils');

class ResourceSchedulerService {
  _mapResource(row) {
    return {
      ...row,
      capabilities: safeJson(row.capabilities, []),
      supported_chip_versions: safeJson(row.supported_chip_versions, []),
      supported_modules: safeJson(row.supported_modules, []),
      connection_profiles: safeJson(row.connection_profiles, {}),
      metadata: safeJson(row.metadata, {})
    };
  }

  _mapLease(row) {
    return {
      ...row,
      bound_resources: safeJson(row.bound_resources, []),
      metadata: safeJson(row.metadata, {})
    };
  }

  async listResources(filters = {}) {
    const conditions = ['deleted_at IS NULL'];
    const params = [];
    if (filters.resourceType) {
      conditions.push('resource_type = ?');
      params.push(filters.resourceType);
    }
    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters.riskLevel) {
      conditions.push('risk_level = ?');
      params.push(filters.riskLevel);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const [rows] = await pool.execute(
      `SELECT * FROM env_resource ${where} ORDER BY FIELD(status, 'idle', 'leased', 'queue', 'maintenance', 'offline', 'dirty'), resource_type, resource_id`,
      params
    );
    return rows.map(row => this._mapResource(row));
  }

  async getResource(resourceId, connection = pool) {
    const [rows] = await connection.execute('SELECT * FROM env_resource WHERE resource_id = ? LIMIT 1', [resourceId]);
    return rows[0] ? this._mapResource(rows[0]) : null;
  }

  async upsertResource(data) {
    if (!data.resourceId && !data.resource_id) throw new Error('resourceId不能为空');
    const resourceId = data.resourceId || data.resource_id;
    const resourceType = data.resourceType || data.resource_type;
    if (!resourceType) throw new Error('resourceType不能为空');
    await pool.execute(
      `INSERT INTO env_resource
       (resource_id, resource_type, display_name, status, capabilities, supported_chip_versions,
        supported_modules, connection_profiles, risk_level, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        resource_type = VALUES(resource_type), display_name = VALUES(display_name), status = VALUES(status),
        capabilities = VALUES(capabilities), supported_chip_versions = VALUES(supported_chip_versions),
        supported_modules = VALUES(supported_modules), connection_profiles = VALUES(connection_profiles),
        risk_level = VALUES(risk_level), metadata = VALUES(metadata), updated_at = NOW()`,
      [
        resourceId,
        resourceType,
        data.displayName || data.display_name || resourceId,
        data.status || 'idle',
        jsonValue(data.capabilities || []),
        jsonValue(data.supportedChipVersions || data.supported_chip_versions || []),
        jsonValue(data.supportedModules || data.supported_modules || []),
        jsonValue(data.connectionProfiles || data.connection_profiles || {}),
        data.riskLevel || data.risk_level || 'medium',
        jsonValue(data.metadata || {})
      ]
    );
    return this.getResource(resourceId);
  }

  async checkAvailability(resourceId) {
    await this.sweepExpiredLeases();
    const resource = await this.getResource(resourceId);
    if (!resource) return { available: false, reason: 'RESOURCE_NOT_FOUND' };
    if (resource.status === 'idle') return { available: true, resource };
    const [leases] = await pool.execute(
      `SELECT * FROM env_resource_lease
       WHERE resource_id = ? AND lease_status = 'active' AND expires_at > NOW()
       ORDER BY acquired_at DESC LIMIT 1`,
      [resourceId]
    );
    return {
      available: false,
      reason: resource.status === 'dirty' ? 'RESOURCE_DIRTY' : 'RESOURCE_BUSY',
      resource,
      lease: leases[0] ? this._mapLease(leases[0]) : null
    };
  }

  _assertExecutableMode(mode) {
    if (!['execute', 'autonomous'].includes(String(mode || '').toLowerCase())) return false;
    return true;
  }

  async acquireLease(user, data) {
    await this.sweepExpiredLeases();
    const resourceId = data.resourceId || data.resource_id;
    if (!resourceId) throw new Error('resourceId不能为空');
    const taskId = data.taskId || data.task_id || newId('AT');
    const ttlMinutes = Math.max(5, Math.min(parsePositiveInt(data.ttlMinutes || data.ttl, 60), 24 * 60));
    const mode = String(data.mode || 'dry_run').toLowerCase();

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [resourceRows] = await connection.execute('SELECT * FROM env_resource WHERE resource_id = ? FOR UPDATE', [resourceId]);
      if (resourceRows.length === 0) throw new Error('资源不存在');
      const resource = this._mapResource(resourceRows[0]);
      if (resource.status !== 'idle') {
        await connection.rollback();
        return {
          acquired: false,
          reason: resource.status === 'dirty' ? 'RESOURCE_DIRTY' : 'RESOURCE_BUSY',
          resource
        };
      }
      if (resource.risk_level === 'high' && this._assertExecutableMode(mode) && !isAdmin(user)) {
        throw new Error('高风险资源执行模式需要管理员审批');
      }

      const leaseId = newId('LEASE');
      const boundResources = data.boundResources || data.bound_resources || [resourceId];
      await connection.execute(
        `INSERT INTO env_resource_lease
         (lease_id, resource_id, resource_type, owner_user, owner_user_id, task_id, module, chip_version,
          mode, lease_status, acquired_at, expires_at, bound_resources, auto_extend_policy, cleanup_policy, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), DATE_ADD(NOW(), INTERVAL ? MINUTE), ?, ?, ?, ?)`,
        [
          leaseId,
          resourceId,
          resource.resource_type,
          user.username || user.name || String(user.id),
          user.id,
          taskId,
          data.module || null,
          data.chipVersion || data.chip_version || null,
          mode,
          ttlMinutes,
          jsonValue(boundResources),
          data.autoExtendPolicy || 'allow_once_with_activity',
          data.cleanupPolicy || 'rollback_and_release',
          jsonValue(data.metadata || {})
        ]
      );
      await connection.execute(
        `UPDATE env_resource SET status = 'leased', current_lease_id = ?, updated_at = NOW() WHERE resource_id = ?`,
        [leaseId, resourceId]
      );
      await connection.commit();
      const [leases] = await pool.execute('SELECT * FROM env_resource_lease WHERE lease_id = ?', [leaseId]);
      await this._audit('resource_lease_acquired', { user, leaseId, resourceId, taskId, module: data.module, mode });
      return { acquired: true, lease: this._mapLease(leases[0]), connectionProfiles: resource.connection_profiles };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async renewLease(user, leaseId, ttlMinutes = 60) {
    const ttl = Math.max(5, Math.min(parsePositiveInt(ttlMinutes, 60), 24 * 60));
    const [rows] = await pool.execute('SELECT * FROM env_resource_lease WHERE lease_id = ? LIMIT 1', [leaseId]);
    if (rows.length === 0) throw new Error('Lease不存在');
    const lease = rows[0];
    if (lease.owner_user_id !== user.id && !isAdmin(user)) throw new Error('无权续租该资源');
    if (lease.lease_status !== 'active') throw new Error('Lease不是active状态');
    await pool.execute('UPDATE env_resource_lease SET expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE lease_id = ?', [ttl, leaseId]);
    const [updated] = await pool.execute('SELECT * FROM env_resource_lease WHERE lease_id = ?', [leaseId]);
    await this._audit('resource_lease_renewed', { user, leaseId, resourceId: lease.resource_id, taskId: lease.task_id });
    return this._mapLease(updated[0]);
  }

  async releaseLease(user, leaseId, cleanupStatus = 'clean') {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute('SELECT * FROM env_resource_lease WHERE lease_id = ? FOR UPDATE', [leaseId]);
      if (rows.length === 0) throw new Error('Lease不存在');
      const lease = rows[0];
      if (lease.owner_user_id !== user.id && !isAdmin(user)) throw new Error('无权释放该资源');
      await connection.execute(
        `UPDATE env_resource_lease
         SET lease_status = 'released', released_at = NOW(), cleanup_status = ?
         WHERE lease_id = ?`,
        [cleanupStatus, leaseId]
      );
      const resourceStatus = cleanupStatus === 'clean' || cleanupStatus === 'rollback_done' ? 'idle' : 'dirty';
      await connection.execute(
        `UPDATE env_resource SET status = ?, current_lease_id = NULL, updated_at = NOW() WHERE resource_id = ?`,
        [resourceStatus, lease.resource_id]
      );
      await connection.commit();
      await this._audit('resource_lease_released', { user, leaseId, resourceId: lease.resource_id, taskId: lease.task_id, cleanupStatus });
      return { leaseId, status: 'released', cleanupStatus, resourceStatus };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async enqueueTask(user, data) {
    const queueId = newId('QUEUE');
    const priority = Math.max(1, Math.min(parsePositiveInt(data.priority, 50), 100));
    await pool.execute(
      `INSERT INTO env_resource_queue
       (queue_id, task_id, user_id, resource_id, resource_requirements, priority, queue_status, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', NOW(), ?)`,
      [queueId, data.taskId || data.task_id || newId('AT'), String(user.id), data.resourceId || data.resource_id || null, jsonValue(data.resourceRequirements || data.resource_requirements || {}), priority, jsonValue(data.metadata || {})]
    );
    const [rows] = await pool.execute('SELECT * FROM env_resource_queue WHERE queue_id = ?', [queueId]);
    await this._audit('resource_queue_joined', { user, taskId: rows[0].task_id, resourceId: rows[0].resource_id, payload: rows[0] });
    return rows[0];
  }

  async listLeases(filters = {}, user = null) {
    await this.sweepExpiredLeases();
    const conditions = [];
    const params = [];
    if (filters.status) {
      conditions.push('l.lease_status = ?');
      params.push(filters.status);
    }
    if (filters.resourceId) {
      conditions.push('l.resource_id = ?');
      params.push(filters.resourceId);
    }
    if (user && !isAdmin(user)) {
      conditions.push('l.owner_user_id = ?');
      params.push(user.id);
    } else if (filters.mine && user) {
      conditions.push('l.owner_user_id = ?');
      params.push(user.id);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.execute(
      `SELECT l.*, u.username AS owner_username FROM env_resource_lease l LEFT JOIN users u ON l.owner_user_id = u.id ${where} ORDER BY l.acquired_at DESC LIMIT 100`,
      params
    );
    return rows.map(row => this._mapLease(row));
  }

  async findEquivalentResource(requirements = {}) {
    const filters = { status: 'idle' };
    if (requirements.resourceType) filters.resourceType = requirements.resourceType;
    const resources = await this.listResources(filters);
    return resources.filter(resource => {
      if (requirements.capability && !resource.capabilities.includes(requirements.capability)) return false;
      if (requirements.chipVersion && resource.supported_chip_versions.length && !resource.supported_chip_versions.includes(requirements.chipVersion)) return false;
      if (requirements.module && resource.supported_modules.length && !resource.supported_modules.includes(requirements.module)) return false;
      return true;
    });
  }

  /**
   * 根据 taskId 查找活跃 lease 关联资源的 connection_profiles
   * 用于工作流执行时注入 resourceConnections 上下文
   */
  async getConnectionProfilesForTask(taskId) {
    if (!taskId) return {};
    await this.sweepExpiredLeases();
    const [leases] = await pool.execute(
      `SELECT resource_id FROM env_resource_lease
       WHERE task_id = ? AND lease_status = 'active' AND expires_at > NOW()
       ORDER BY acquired_at DESC LIMIT 5`,
      [taskId]
    );
    if (leases.length === 0) return {};
    const profiles = {};
    for (const lease of leases) {
      const resource = await this.getResource(lease.resource_id);
      if (resource?.connection_profiles) {
        Object.assign(profiles, resource.connection_profiles);
      }
    }
    return profiles;
  }

  async validateLeaseForAction({ leaseId, taskId, userId, resourceId, action }) {
    await this.sweepExpiredLeases();
    if (!leaseId) return { valid: false, reason: 'LEASE_REQUIRED_OR_EXPIRED', action };
    const params = [leaseId];
    const conditions = ['lease_id = ?', "lease_status = 'active'", 'expires_at > NOW()'];
    if (taskId) { conditions.push('task_id = ?'); params.push(taskId); }
    if (resourceId) { conditions.push('resource_id = ?'); params.push(resourceId); }
    if (userId) { conditions.push('owner_user_id = ?'); params.push(userId); }
    const [rows] = await pool.execute(`SELECT * FROM env_resource_lease WHERE ${conditions.join(' AND ')} LIMIT 1`, params);
    if (rows.length === 0) return { valid: false, reason: 'LEASE_REQUIRED_OR_EXPIRED', action };
    return { valid: true, lease: this._mapLease(rows[0]) };
  }

  async sweepExpiredLeases() {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [expired] = await connection.execute(
        `SELECT lease_id, resource_id FROM env_resource_lease
         WHERE lease_status = 'active' AND expires_at <= NOW()
         FOR UPDATE`
      );
      if (expired.length === 0) {
        await connection.commit();
        return { released: 0 };
      }
      const resourceIds = [...new Set(expired.map(row => row.resource_id))];
      await connection.execute(
        `UPDATE env_resource_lease
         SET lease_status = 'expired', cleanup_status = 'expired_auto_release', released_at = NOW()
         WHERE lease_status = 'active' AND expires_at <= NOW()`
      );
      for (const resourceId of resourceIds) {
        const [active] = await connection.execute(
          `SELECT lease_id FROM env_resource_lease
           WHERE resource_id = ? AND lease_status = 'active' AND expires_at > NOW()
           LIMIT 1`,
          [resourceId]
        );
        if (active.length === 0) {
          await connection.execute(
            `UPDATE env_resource SET status = 'idle', current_lease_id = NULL, updated_at = NOW()
             WHERE resource_id = ? AND status = 'leased'`,
            [resourceId]
          );
        }
      }
      await connection.commit();
      return { released: expired.length };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async forceRelease(user, leaseId, cleanupStatus = 'force_released') {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    return this.releaseLease(user, leaseId, cleanupStatus);
  }

  // ===== Part 5: 资源 Bundle 联合锁 =====
  async listBundles(filters = {}) {
    const [rows] = await pool.execute(
      'SELECT b.bundle_id, b.display_name, b.status, b.compatible_modules, b.cleanup_sequence, b.created_at, COUNT(i.id) AS item_count FROM env_resource_bundle b LEFT JOIN env_resource_bundle_item i ON b.bundle_id = i.bundle_id GROUP BY b.bundle_id ORDER BY b.created_at DESC LIMIT 100'
    );
    return rows.map(row => ({
      ...row,
      compatible_modules: safeJson(row.compatible_modules, []),
      cleanup_sequence: safeJson(row.cleanup_sequence, [])
    }));
  }

  async getBundle(bundleId) {
    const [bundles] = await pool.execute('SELECT * FROM env_resource_bundle WHERE bundle_id = ?', [bundleId]);
    if (bundles.length === 0) return null;
    const [items] = await pool.execute('SELECT * FROM env_resource_bundle_item WHERE bundle_id = ? ORDER BY sort_order', [bundleId]);
    return {
      ...bundles[0],
      compatible_modules: safeJson(bundles[0].compatible_modules, []),
      cleanup_sequence: safeJson(bundles[0].cleanup_sequence, []),
      items
    };
  }

  async createBundle(user, data) {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    const bundleId = data.bundleId || newId('BUNDLE');
    const displayName = data.displayName || data.display_name || bundleId;
    await pool.execute(
      'INSERT INTO env_resource_bundle (bundle_id, display_name, status, compatible_modules, cleanup_sequence) VALUES (?, ?, "idle", ?, ?)',
      [bundleId, displayName, jsonValue(data.compatibleModules || data.compatible_modules || []), jsonValue(data.cleanupSequence || data.cleanup_sequence || [])]
    );
    const items = data.items || [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await pool.execute(
        'INSERT INTO env_resource_bundle_item (bundle_id, resource_id, sort_order, role) VALUES (?, ?, ?, ?)',
        [bundleId, item.resourceId || item.resource_id, item.sortOrder || item.sort_order || i, item.role || null]
      );
    }
    await this._audit('bundle_create', { user, resourceId: bundleId, payload: data });
    return { bundleId, displayName, itemCount: items.length };
  }

  async deleteBundle(user, bundleId) {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    const [bundles] = await pool.execute('SELECT status FROM env_resource_bundle WHERE bundle_id = ?', [bundleId]);
    if (bundles.length === 0) throw new Error('Bundle不存在');
    if (bundles[0].status === 'leased') throw new Error('Bundle正在使用中,不能删除');
    await pool.execute('DELETE FROM env_resource_bundle_item WHERE bundle_id = ?', [bundleId]);
    await pool.execute('DELETE FROM env_resource_bundle WHERE bundle_id = ?', [bundleId]);
    await this._audit('bundle_delete', { user, resourceId: bundleId });
    return { bundleId, deleted: true };
  }

  async acquireBundle(user, data) {
    const bundleId = data.bundleId || data.bundle_id;
    const [bundles] = await pool.execute('SELECT * FROM env_resource_bundle WHERE bundle_id = ?', [bundleId]);
    if (bundles.length === 0) throw new Error('Bundle不存在');
    const [items] = await pool.execute('SELECT * FROM env_resource_bundle_item WHERE bundle_id = ? ORDER BY sort_order', [bundleId]);
    if (items.length === 0) throw new Error('Bundle无资源项');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      // 检查所有资源是否 idle (FOR UPDATE 行锁,保证原子性)
      const boundResources = [];
      for (const item of items) {
        const [rows] = await connection.execute('SELECT status FROM env_resource WHERE resource_id = ? FOR UPDATE', [item.resource_id]);
        if (rows.length === 0) {
          await connection.rollback();
          return { acquired: false, reason: 'BUNDLE_RESOURCE_NOT_FOUND', resourceId: item.resource_id };
        }
        if (rows[0].status !== 'idle') {
          await connection.rollback();
          return { acquired: false, reason: 'BUNDLE_RESOURCE_BUSY', resourceId: item.resource_id, currentStatus: rows[0].status };
        }
        boundResources.push(item.resource_id);
      }
      // 生成单一 lease (lease_id 在 env_resource_lease 上有 UNIQUE 约束,因此只插一行,bound_resources 存全部资源)
      const leaseId = newId('LEASE');
      const ttl = Math.max(5, Math.min(parseInt(data.ttlMinutes || data.ttl_minutes || 60), 1440));
      const taskId = data.taskId || data.task_id || newId('AT');
      const primaryResource = items[0].resource_id;
      const primaryType = items[0].role || 'bundle';
      await connection.execute(
        'INSERT INTO env_resource_lease (lease_id, resource_id, resource_type, owner_user, owner_user_id, task_id, module, chip_version, mode, lease_status, acquired_at, expires_at, bound_resources, cleanup_policy, bundle_id) VALUES (?,?,?,?,?,?,?,?,?,"active",NOW(),DATE_ADD(NOW(),INTERVAL ? MINUTE),?,"rollback_and_release",?)',
        [leaseId, primaryResource, primaryType, user.username || String(user.id), user.id, taskId, data.module || null, data.chipVersion || data.chip_version || null, data.mode || 'dry_run', ttl, jsonValue(boundResources), bundleId]
      );
      // 锁定全部资源 (current_lease_id 指向同一 lease)
      for (const resourceId of boundResources) {
        await connection.execute('UPDATE env_resource SET status = "leased", current_lease_id = ? WHERE resource_id = ?', [leaseId, resourceId]);
      }
      await connection.execute('UPDATE env_resource_bundle SET status = "leased" WHERE bundle_id = ?', [bundleId]);
      await connection.commit();
      await this._audit('bundle_acquire', { user, leaseId, resourceId: bundleId, payload: data });
      return { acquired: true, leaseId, bundleId, resourceCount: items.length, boundResources, expiresAt: new Date(Date.now() + ttl * 60000).toISOString() };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async releaseBundle(user, leaseId) {
    const [leases] = await pool.execute('SELECT * FROM env_resource_lease WHERE lease_id = ? LIMIT 1', [leaseId]);
    if (leases.length === 0) throw new Error('Lease不存在');
    const lease = leases[0];
    if (lease.owner_user_id !== user.id && !isAdmin(user)) throw new Error('无权释放该Bundle Lease');
    const boundResources = safeJson(lease.bound_resources, [lease.resource_id]);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const resourceId of boundResources) {
        await connection.execute('UPDATE env_resource SET status = "idle", current_lease_id = NULL WHERE resource_id = ?', [resourceId]);
      }
      await connection.execute('UPDATE env_resource_lease SET lease_status = "released", released_at = NOW(), cleanup_status = "clean" WHERE lease_id = ?', [leaseId]);
      if (lease.bundle_id) {
        await connection.execute('UPDATE env_resource_bundle SET status = "idle" WHERE bundle_id = ?', [lease.bundle_id]);
      }
      await connection.commit();
      await this._audit('bundle_release', { user, leaseId, resourceId: lease.bundle_id });
      return { released: true, leaseId, bundleId: lease.bundle_id, resourceCount: boundResources.length };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async _audit(auditType, data) {
    try {
      await pool.execute(
        `INSERT INTO agent_audit_logs
         (audit_id, audit_type, task_id, lease_id, resource_id, user_id, module, mode, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId('AUDIT'), auditType, data.taskId || null, data.leaseId || null, data.resourceId || null, data.user?.id || null, data.module || null, data.mode || null, jsonValue(data.payload || data)]
      );
    } catch (error) {
      logger.warn('写入资源审计失败', { error: error.message, auditType });
    }
  }

  // ===== Part 6: EDA 预约 / 配额 / 抢占 =====
  static get PRIORITY_BY_TASK_TYPE() {
    return {
      release_gate: 100,
      nightly_regression: 80,
      module_owner_debug: 70,
      normal_execute: 50,
      dry_run: 30,
      exploratory: 20
    };
  }

  async listReservations(filters = {}, user = null) {
    const conditions = [];
    const params = [];
    if (filters.resourceId) { conditions.push('resource_id = ?'); params.push(filters.resourceId); }
    if (filters.status) { conditions.push('status = ?'); params.push(filters.status); }
    if (filters.taskType) { conditions.push('task_type = ?'); params.push(filters.taskType); }
    if (user && !isAdmin(user)) { conditions.push('user_id = ?'); params.push(user.id); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.execute(
      `SELECT * FROM eda_reservation ${where} ORDER BY start_time DESC LIMIT 200`,
      params
    );
    return rows;
  }

  async getReservation(reservationId) {
    const [rows] = await pool.execute('SELECT * FROM eda_reservation WHERE reservation_id = ? LIMIT 1', [reservationId]);
    return rows[0] || null;
  }

  async createReservation(user, data) {
    const resourceId = data.resourceId || data.resource_id;
    if (!resourceId) throw new Error('resourceId不能为空');
    const startTime = data.startTime || data.start_time;
    const endTime = data.endTime || data.end_time;
    if (!startTime || !endTime) throw new Error('startTime/endTime不能为空');
    if (new Date(endTime) <= new Date(startTime)) throw new Error('endTime必须晚于startTime');
    const taskType = data.taskType || data.task_type || 'normal_execute';
    const priority = data.priority != null
      ? Math.max(1, Math.min(parseInt(data.priority), 100))
      : (ResourceSchedulerService.PRIORITY_BY_TASK_TYPE[taskType] || 50);
    const reservationId = data.reservationId || newId('RSV');

    // 时间冲突检查: 同一资源, 同一时段, 不能有 confirmed/in_progress 的预约
    const [conflicts] = await pool.execute(
      `SELECT reservation_id, user_id, start_time, end_time, status FROM eda_reservation
       WHERE resource_id = ? AND status IN ('confirmed','in_progress')
       AND start_time < ? AND end_time > ?`,
      [resourceId, endTime, startTime]
    );
    if (conflicts.length > 0) {
      return {
        created: false,
        reason: 'RESERVATION_CONFLICT',
        conflicts
      };
    }

    await pool.execute(
      `INSERT INTO eda_reservation (reservation_id, resource_id, user_id, start_time, end_time, status, task_type, priority, notes)
       VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
      [reservationId, resourceId, user.id, startTime, endTime, taskType, priority, data.notes || null]
    );
    await this._audit('reservation_created', { user, resourceId: reservationId, payload: data });
    return { created: true, reservationId, resourceId, priority, taskType };
  }

  async cancelReservation(user, reservationId) {
    const [rows] = await pool.execute('SELECT * FROM eda_reservation WHERE reservation_id = ? LIMIT 1', [reservationId]);
    if (rows.length === 0) throw new Error('预约不存在');
    const reservation = rows[0];
    if (reservation.user_id !== user.id && !isAdmin(user)) throw new Error('无权取消该预约');
    if (['completed', 'cancelled'].includes(reservation.status)) throw new Error(`预约已${reservation.status},无法取消`);
    await pool.execute('UPDATE eda_reservation SET status = "cancelled" WHERE reservation_id = ?', [reservationId]);
    await this._audit('reservation_cancelled', { user, resourceId: reservationId });
    return { reservationId, status: 'cancelled' };
  }

  async listQuota(user, filters = {}) {
    const today = new Date().toISOString().split('T')[0];
    const quotaDate = filters.date || today;
    const conditions = ['quota_date = ?'];
    const params = [quotaDate];
    if (user && !isAdmin(user)) { conditions.push('user_id = ?'); params.push(user.id); }
    else if (filters.userId) { conditions.push('user_id = ?'); params.push(filters.userId); }
    if (filters.resourceType) { conditions.push('resource_type = ?'); params.push(filters.resourceType); }
    const [rows] = await pool.execute(
      `SELECT q.*, u.username FROM resource_quota q LEFT JOIN users u ON q.user_id = u.id WHERE ${conditions.join(' AND ')} ORDER BY q.user_id, q.resource_type`,
      params
    );
    return rows;
  }

  async setQuota(user, data) {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    const userId = parseInt(data.userId || data.user_id);
    const resourceType = data.resourceType || data.resource_type;
    if (!userId || !resourceType) throw new Error('userId/resourceType不能为空');
    const dailyQuota = Math.max(0, parseInt(data.dailyQuotaMinutes || data.daily_quota_minutes || 120));
    const today = new Date().toISOString().split('T')[0];
    await pool.execute(
      `INSERT INTO resource_quota (user_id, resource_type, daily_quota_minutes, used_today_minutes, quota_date)
       VALUES (?, ?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE daily_quota_minutes = VALUES(daily_quota_minutes)`,
      [userId, resourceType, dailyQuota, today]
    );
    await this._audit('quota_set', { user, resourceId: `${userId}:${resourceType}`, payload: data });
    const [rows] = await pool.execute('SELECT * FROM resource_quota WHERE user_id = ? AND resource_type = ? AND quota_date = ?', [userId, resourceType, today]);
    return rows[0];
  }

  // 根据当天累计使用分钟数, 检查用户对资源类型的配额是否超出
  async checkQuota(user, resourceType, requestedMinutes) {
    const today = new Date().toISOString().split('T')[0];
    const [rows] = await pool.execute(
      'SELECT * FROM resource_quota WHERE user_id = ? AND resource_type = ? AND quota_date = ?',
      [user.id, resourceType, today]
    );
    if (rows.length === 0) {
      // 默认配额 120 分钟
      return { allowed: true, dailyQuotaMinutes: 120, usedTodayMinutes: 0, requestedMinutes, remainingMinutes: 120 };
    }
    const quota = rows[0];
    const remaining = quota.daily_quota_minutes - quota.used_today_minutes;
    if (remaining < requestedMinutes) {
      return { allowed: false, reason: 'QUOTA_EXCEEDED', dailyQuotaMinutes: quota.daily_quota_minutes, usedTodayMinutes: quota.used_today_minutes, requestedMinutes, remainingMinutes: remaining };
    }
    return { allowed: true, dailyQuotaMinutes: quota.daily_quota_minutes, usedTodayMinutes: quota.used_today_minutes, requestedMinutes, remainingMinutes: remaining };
  }

  // 在 lease 释放时累加使用分钟数 (供 releaseLease 调用)
  async _accrueQuotaUsage(user, resourceType, usedMinutes) {
    if (!user || usedMinutes <= 0) return;
    const today = new Date().toISOString().split('T')[0];
    await pool.execute(
      `INSERT INTO resource_quota (user_id, resource_type, daily_quota_minutes, used_today_minutes, quota_date)
       VALUES (?, ?, 120, ?, ?)
       ON DUPLICATE KEY UPDATE used_today_minutes = used_today_minutes + VALUES(used_today_minutes)`,
      [user.id, resourceType, usedMinutes, today]
    );
  }

  // 高优先级任务抢占低优先级 lease (管理员才能调用)
  async preemptLease(user, leaseId, reason = 'preempted') {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    const [rows] = await pool.execute('SELECT * FROM env_resource_lease WHERE lease_id = ? LIMIT 1', [leaseId]);
    if (rows.length === 0) throw new Error('Lease不存在');
    const lease = rows[0];
    if (lease.lease_status !== 'active') throw new Error(`Lease状态为${lease.lease_status},无法抢占`);
    // 释放 lease, cleanup_status 标记为 preempted
    await this.forceRelease(user, leaseId, 'preempted');
    await this._audit('lease_preempted', { user, leaseId, resourceId: lease.resource_id, payload: { reason } });
    return { preempted: true, leaseId, resourceId: lease.resource_id, previousOwnerId: lease.owner_user_id, cleanupStatus: 'preempted' };
  }
}

module.exports = new ResourceSchedulerService();
