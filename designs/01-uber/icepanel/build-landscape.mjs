#!/usr/bin/env node
/**
 * Build the Uber C4 model in IcePanel via the REST API.
 *
 * Creates model objects (actors, systems, apps, stores), the connections
 * between them, and a container ("app") diagram with a computed layered
 * layout — mirroring the Mermaid architecture diagram in ../diagrams/.
 *
 * Requires Node 18+ (uses the built-in global `fetch`).
 *
 * Environment variables (never hard-code secrets):
 *   ICEPANEL_API_KEY      required — Profile settings -> API keys -> Create
 *   ICEPANEL_LANDSCAPE_ID required — the landscape id (see README)
 *   ICEPANEL_VERSION_ID   optional — defaults to "latest"
 *
 * Usage:
 *   ICEPANEL_API_KEY=... ICEPANEL_LANDSCAPE_ID=... node build-landscape.mjs
 */

const API = 'https://api.icepanel.io/v1';
const KEY = process.env.ICEPANEL_API_KEY;
const LANDSCAPE = process.env.ICEPANEL_LANDSCAPE_ID;
const VERSION = process.env.ICEPANEL_VERSION_ID || 'latest';

if (!KEY || !LANDSCAPE) {
  console.error('✗ Missing env. Set ICEPANEL_API_KEY and ICEPANEL_LANDSCAPE_ID.');
  process.exit(1);
}

const base = `${API}/landscapes/${LANDSCAPE}/versions/${VERSION}`;

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${res.statusText}\n${text}`);
  }
  return text ? JSON.parse(text) : {};
}

// ─── C4 model definition ──────────────────────────────────────────────────
// Each object: key, name, type, optional external + technology, and the
// x/y position used on the container diagram (px). width 170 / height 90.

const W = 170, H = 90;

const OBJECTS = [
  // Top-level (parentId: null)
  { key: 'rider',     name: 'Rider',             type: 'actor',  top: true, x: 120, y: 40 },
  { key: 'driver',    name: 'Driver',            type: 'actor',  top: true, x: 360, y: 40 },
  { key: 'uber',      name: 'Uber Platform',     type: 'system', top: true, place: false },
  { key: 'maps',      name: 'Maps / Routing API',type: 'system', top: true, external: true, x: 940, y: 490 },
  { key: 'psp',       name: 'Payment Provider',  type: 'system', top: true, external: true, x: 940, y: 790 },

  // Inside Uber Platform (parent: uber)
  { key: 'riderApp',  name: 'Rider App',         type: 'app',   parent: 'uber', tech: 'Mobile',     x: 120, y: 190 },
  { key: 'driverApp', name: 'Driver App',        type: 'app',   parent: 'uber', tech: 'Mobile',     x: 360, y: 190 },
  { key: 'gateway',   name: 'API Gateway',       type: 'app',   parent: 'uber',                     x: 120, y: 340 },
  { key: 'wsFleet',   name: 'WebSocket Fleet',   type: 'app',   parent: 'uber',                     x: 360, y: 340 },
  { key: 'rideSvc',   name: 'Ride Service',      type: 'app',   parent: 'uber',                     x: 40,  y: 490 },
  { key: 'matchSvc',  name: 'Matching Service',  type: 'app',   parent: 'uber',                     x: 260, y: 490 },
  { key: 'locSvc',    name: 'Location Service',  type: 'app',   parent: 'uber',                     x: 480, y: 490 },
  { key: 'paySvc',    name: 'Payment Service',   type: 'app',   parent: 'uber',                     x: 700, y: 490 },
  { key: 'geo',       name: 'Geo Index',         type: 'store', parent: 'uber', tech: 'Redis / H3', x: 260, y: 640 },
  { key: 'pubsub',    name: 'Pub/Sub',           type: 'app',   parent: 'uber',                     x: 480, y: 640 },
  { key: 'kafka',     name: 'Kafka',             type: 'store', parent: 'uber',                     x: 700, y: 640 },
  { key: 'tripDb',    name: 'Trip DB',           type: 'store', parent: 'uber', tech: 'Relational', x: 40,  y: 790 },
  { key: 'payDb',     name: 'Payment DB',        type: 'store', parent: 'uber', tech: 'Relational', x: 700, y: 790 },
  { key: 'dwh',       name: 'Data Warehouse',    type: 'store', parent: 'uber',                     x: 700, y: 940 },
];

const CONNECTIONS = [
  ['rider', 'riderApp', 'uses'],
  ['driver', 'driverApp', 'uses'],
  ['riderApp', 'gateway', 'REST'],
  ['driverApp', 'gateway', 'REST + location pings'],
  ['riderApp', 'wsFleet', 'live updates', 'bidirectional'],
  ['driverApp', 'wsFleet', 'live updates', 'bidirectional'],
  ['gateway', 'rideSvc', ''],
  ['gateway', 'locSvc', ''],
  ['rideSvc', 'matchSvc', 'find driver'],
  ['matchSvc', 'geo', 'nearby query'],
  ['locSvc', 'geo', 'upsert (LWW)'],
  ['rideSvc', 'geo', 'CAS driver status'],
  ['rideSvc', 'tripDb', 'persist trip'],
  ['rideSvc', 'paySvc', 'settle fare'],
  ['paySvc', 'payDb', ''],
  ['rideSvc', 'pubsub', 'status events'],
  ['locSvc', 'pubsub', 'live positions'],
  ['pubsub', 'wsFleet', 'fan-out'],
  ['locSvc', 'kafka', 'sampled'],
  ['rideSvc', 'kafka', 'trip events'],
  ['kafka', 'dwh', ''],
  ['matchSvc', 'maps', 'ETA / distance'],
  ['paySvc', 'psp', 'charge'],
];

// ─── Build ──────────────────────────────────────────────────────────────────

const id = {};       // key -> model object id
const connId = {};   // "origin->target" -> model connection id

async function main() {
  console.log(`→ Landscape ${LANDSCAPE} (version: ${VERSION})\n`);

  // 1. Model objects (parents before children so parentId resolves)
  console.log('Creating model objects…');
  for (const o of OBJECTS) {
    const body = {
      name: o.name,
      type: o.type,
      parentId: o.parent ? id[o.parent] : null,
      external: !!o.external,
    };
    if (o.tech) body.caption = o.tech;
    const res = await api('POST', '/model/objects', body);
    id[o.key] = res.modelObject.id;
    console.log(`  ✓ ${o.name} (${o.type})`);
  }

  // 2. Connections
  console.log('\nCreating connections…');
  for (const [from, to, name, dir] of CONNECTIONS) {
    const res = await api('POST', '/model/connections', {
      originId: id[from],
      targetId: id[to],
      name: name || '',
      direction: dir || 'outgoing',
    });
    connId[`${from}->${to}`] = res.modelConnection.id;
    console.log(`  ✓ ${from} → ${to}${name ? ` (${name})` : ''}`);
  }

  // 3. Container diagram for Uber Platform
  console.log('\nCreating container diagram…');
  const diag = await api('POST', '/diagrams', {
    name: 'Uber Platform — Containers',
    type: 'app-diagram',
    modelId: id.uber,
    index: 0,
  });
  const diagramId = diag.diagram.id;

  // 4. Place objects on the diagram (content id == model object id)
  const placedKeys = OBJECTS.filter((o) => o.place !== false);
  const objectsAdd = {};
  for (const o of placedKeys) {
    const oid = id[o.key];
    objectsAdd[oid] = {
      id: oid, modelId: oid, type: o.type, shape: 'box',
      x: o.x, y: o.y, width: W, height: H,
    };
  }

  // 5. Draw connections whose both endpoints are placed
  const placed = new Set(placedKeys.map((o) => o.key));
  const connectionsAdd = {};
  for (const [from, to] of CONNECTIONS) {
    if (!placed.has(from) || !placed.has(to)) continue;
    const cid = connId[`${from}->${to}`];
    connectionsAdd[cid] = {
      id: cid, modelId: cid,
      originId: id[from], targetId: id[to],
      originConnector: 'bottom-middle', targetConnector: 'top-middle',
      lineShape: 'curved', points: [],
    };
  }

  await api('PATCH', `/diagrams/${diagramId}/content`, {
    objects: { $add: objectsAdd },
    connections: { $add: connectionsAdd },
  });
  console.log(`  ✓ Placed ${placedKeys.length} objects, ${Object.keys(connectionsAdd).length} connections`);

  console.log('\n✅ Done. Open IcePanel, tidy the layout if needed, then');
  console.log('   Share → Export (SVG) and Share → copy link for the README.');
}

main().catch((e) => {
  console.error('\n✗ Failed:', e.message);
  process.exit(1);
});
