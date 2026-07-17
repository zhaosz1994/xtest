const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware');
const resourceSchedulerService = require('../services/resourceSchedulerService');

router.use(authenticateToken);

router.get('/resources', async (req, res) => {
  try {
    const data = await resourceSchedulerService.listResources(req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/resources', requireAdmin, async (req, res) => {
  try {
    const data = await resourceSchedulerService.upsertResource(req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/resources/:resourceId/availability', async (req, res) => {
  try {
    const data = await resourceSchedulerService.checkAvailability(req.params.resourceId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/leases', async (req, res) => {
  try {
    const data = await resourceSchedulerService.listLeases(req.query, req.user);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/leases/sweep-expired', requireAdmin, async (req, res) => {
  try {
    const data = await resourceSchedulerService.sweepExpiredLeases();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/leases/acquire', async (req, res) => {
  try {
    const data = await resourceSchedulerService.acquireLease(req.user, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/leases/:leaseId/renew', async (req, res) => {
  try {
    const data = await resourceSchedulerService.renewLease(req.user, req.params.leaseId, req.body.ttlMinutes || req.body.ttl);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/leases/:leaseId/release', async (req, res) => {
  try {
    const data = await resourceSchedulerService.releaseLease(req.user, req.params.leaseId, req.body.cleanupStatus || req.body.cleanup_status || 'clean');
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/leases/:leaseId/force-release', requireAdmin, async (req, res) => {
  try {
    const data = await resourceSchedulerService.forceRelease(req.user, req.params.leaseId, req.body.cleanupStatus || 'force_released');
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/queue', async (req, res) => {
  try {
    const data = await resourceSchedulerService.enqueueTask(req.user, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/equivalent-resources', async (req, res) => {
  try {
    const data = await resourceSchedulerService.findEquivalentResource(req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ===== Part 5: 资源 Bundle 联合锁 =====
router.get('/bundles', async (req, res) => {
  try {
    const data = await resourceSchedulerService.listBundles(req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/bundles', requireAdmin, async (req, res) => {
  try {
    const data = await resourceSchedulerService.createBundle(req.user, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/bundles/:bundleId', async (req, res) => {
  try {
    const data = await resourceSchedulerService.getBundle(req.params.bundleId);
    if (!data) return res.status(404).json({ success: false, message: 'Bundle不存在' });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/bundles/:bundleId', requireAdmin, async (req, res) => {
  try {
    const data = await resourceSchedulerService.deleteBundle(req.user, req.params.bundleId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/bundles/:bundleId/acquire', async (req, res) => {
  try {
    const data = await resourceSchedulerService.acquireBundle(req.user, { ...req.body, bundleId: req.params.bundleId });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/bundles/release/:leaseId', async (req, res) => {
  try {
    const data = await resourceSchedulerService.releaseBundle(req.user, req.params.leaseId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// ===== Part 6: EDA 预约 / 配额 / 抢占 =====
router.get('/reservations', async (req, res) => {
  try {
    const data = await resourceSchedulerService.listReservations(req.query, req.user);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/reservations', async (req, res) => {
  try {
    const data = await resourceSchedulerService.createReservation(req.user, req.body);
    if (data.created === false) return res.status(409).json({ success: false, message: '预约时段冲突', data });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/reservations/:reservationId/cancel', async (req, res) => {
  try {
    const data = await resourceSchedulerService.cancelReservation(req.user, req.params.reservationId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/quota', async (req, res) => {
  try {
    const data = await resourceSchedulerService.listQuota(req.user, req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/quota', requireAdmin, async (req, res) => {
  try {
    const data = await resourceSchedulerService.setQuota(req.user, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/quota/check', async (req, res) => {
  try {
    const resourceType = req.query.resourceType || req.query.resource_type;
    const requestedMinutes = parseInt(req.query.requestedMinutes || req.query.requested_minutes || 0);
    if (!resourceType) return res.status(400).json({ success: false, message: 'resourceType不能为空' });
    const data = await resourceSchedulerService.checkQuota(req.user, resourceType, requestedMinutes);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/preempt', requireAdmin, async (req, res) => {
  try {
    const leaseId = req.body.leaseId || req.body.lease_id;
    if (!leaseId) return res.status(400).json({ success: false, message: 'leaseId不能为空' });
    const data = await resourceSchedulerService.preemptLease(req.user, leaseId, req.body.reason || 'preempted');
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
