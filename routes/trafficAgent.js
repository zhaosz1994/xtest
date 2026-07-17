const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware');
const trafficToolService = require('../services/trafficToolService');

router.use(authenticateToken);

router.post('/packet-template', async (req, res) => {
  try {
    const data = await trafficToolService.buildPacketTemplate(req.body.packetRequirements || req.body.packet_requirements || req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/flow-spec', async (req, res) => {
  try {
    const data = await trafficToolService.compileFlowSpec(req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/start', async (req, res) => {
  try {
    const data = await trafficToolService.startTraffic(req.user, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/runs/:runId/stop', async (req, res) => {
  try {
    const data = await trafficToolService.stopTraffic(req.user, req.params.runId, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/runs/:runId/stats', async (req, res) => {
  try {
    const data = await trafficToolService.getStats(req.params.runId, req.user);
    res.json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
});

router.post('/runs/:runId/capture', async (req, res) => {
  try {
    const data = await trafficToolService.capturePackets(req.user, req.params.runId, req.body.port, req.body.durationSec || req.body.duration_sec);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/pcap/analyze', async (req, res) => {
  try {
    const data = await trafficToolService.analyzePcap(req.body.pcapPath || req.body.pcap_path, req.body.expectedPattern || req.body.expected_pattern || {});
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
