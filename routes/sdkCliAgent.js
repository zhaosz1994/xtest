const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware');
const sdkCliToolService = require('../services/sdkCliToolService');

router.use(authenticateToken);

router.post('/sessions', async (req, res) => {
  try {
    const data = await sdkCliToolService.openSession(req.user, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/commands/run', async (req, res) => {
  try {
    const data = await sdkCliToolService.runCommand(req.user, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/commands/batch', async (req, res) => {
  try {
    const data = await sdkCliToolService.runCommandBatch(req.user, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/snapshots', async (req, res) => {
  try {
    const data = await sdkCliToolService.snapshotState(req.user, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/snapshots/diff', async (req, res) => {
  try {
    const data = await sdkCliToolService.diffSnapshot(req.user, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/counters/query', async (req, res) => {
  try {
    const data = await sdkCliToolService.queryCounter(req.user, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/rollback/generate', async (req, res) => {
  try {
    const data = await sdkCliToolService.generateRollback(req.body.stateDiff || req.body.state_diff || {});
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/sessions/:sessionId/close', async (req, res) => {
  try {
    const data = await sdkCliToolService.closeSession({ ...req.body, sessionId: req.params.sessionId });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
