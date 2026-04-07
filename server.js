const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const DATA_FILE = path.join(__dirname, 'cloud_data.json');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// Initialize data file if not exists
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    _meta: { created: '2026-04-07', description: 'Coconut verification results' },
    verifications: {},
    drawnPolygons: [],
  }));
}

// GET - read all data
app.get('/api/data', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    res.json(data);
  } catch (e) {
    res.json({ verifications: {}, drawnPolygons: [] });
  }
});

// PUT - update data (merge)
app.put('/api/data', (req, res) => {
  try {
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e) {}

    const incoming = req.body;

    // Merge verifications (incoming wins for same keys)
    const mergedVerifications = {
      ...(existing.verifications || {}),
      ...(incoming.verifications || {}),
    };

    // Merge drawn polygons (add new, keep existing)
    const existingDrawn = existing.drawnPolygons || [];
    const incomingDrawn = incoming.drawnPolygons || [];
    const drawnMap = {};
    existingDrawn.forEach(p => { drawnMap[`${p.district}:${p.id}`] = p; });
    incomingDrawn.forEach(p => { drawnMap[`${p.district}:${p.id}`] = p; });
    const mergedDrawn = Object.values(drawnMap);

    const merged = {
      _meta: {
        ...existing._meta,
        ...incoming._meta,
        lastUpdated: new Date().toISOString(),
      },
      verifications: mergedVerifications,
      drawnPolygons: mergedDrawn,
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2));
    res.json(merged);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Coconut Verifier API running on port ${PORT}`);
});
