import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const moduleSource = readFileSync(new URL('../src/wayfinding-route.js', import.meta.url), 'utf8');
const data = JSON.parse(readFileSync(new URL('../data/official-maps/aventura-routing-preview.json', import.meta.url), 'utf8'));
const source = JSON.parse(readFileSync(new URL('../data/official-maps/aventura.json', import.meta.url), 'utf8'));
const mesh = JSON.parse(readFileSync(new URL('../data/official-maps/aventura-3d.json', import.meta.url), 'utf8'));
function api(candidate = data) {const context = {window: {}};vm.runInNewContext(moduleSource, context);const result = context.window.RetailNavWayfindingRoute;assert.equal(result.configure(candidate), true);return result;}
const project = ([lon, lat]) => [(lon + 80.14275) * 111320 * Math.cos(25.95706 * Math.PI / 180) * 10, (25.95706 - lat) * 111320 * 10];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const origin = {x: 284.25644526, y: -1364.7832};
const venchi = '106b53c386cd808785a547936cfed059';
const joe = '1e262d8a02e8023eecf555d59ee77313';
const query = changes => ({mallId: data.mallId, coordinateSpace: data.coordinateSpace, floor: 'LL', origin, destinationPolygonIds: [venchi], ...changes});
function onSegment(p, a, b) {const length = distance(a, b);return Math.abs(distance(a, p) + distance(p, b) - length) < 1e-5;}
function sourceSegments(floor) {return source.floors.find(f => f.id === floor).circulation.flatMap(line => line.coordinates.slice(1).map((p, i) => [project(line.coordinates[i]), project(p)]));}
function insideRing(point, ring) {let result = false;for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {const a = ring[i], b = ring[j];if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;}return result;}
function inside(point, rings) {return insideRing(point, rings[0]) && !rings.slice(1).some(ring => insideRing(point, ring));}

const fixture = () => ({schema: data.schema, mallId: 'test', coordinateSpace: 'test:decimeters', routingVerified: false,
  source: {sha256: 'fixture'}, projection: {unitsPerMeter: 10}, originToleranceMeters: .15,
  floors: [{id: 'LL', nodes: [[0, 0], [100, 0], [100, 100], [0, 100]],
    edges: [[0, 1, 'a'], [1, 2, 'b'], [2, 3, 'c']],
    terminals: [{polygonId: 'target', node: 3, point: [0, 120], entrance: [0, 130], sourceSegmentId: 'access', sourceEntranceOffsetMeters: 0, stopsBeforeObstacle: true}]}]});
const fixtureQuery = changes => ({mallId: 'test', coordinateSpace: 'test:decimeters', floor: 'LL', origin: {x: 50, y: 0}, destinationPolygonIds: ['target'], ...changes});

test('offline graph retains only source segments in the existing 3D coordinate system', () => {
  assert.equal(data.routingVerified, false);
  assert.equal(data.coordinateSpace, mesh.coordinateSpace);
  assert.deepEqual(data.projection, mesh.projection);
  assert.equal(data.source.sha256, source.sources.map.sha256);
  for (const floor of data.floors) {
    const originals = sourceSegments(floor.id);
    for (const [a, b] of floor.edges) assert.ok(originals.some(([x, y]) =>
      distance(floor.nodes[a], x) < 1e-6 && distance(floor.nodes[b], y) < 1e-6 ||
      distance(floor.nodes[a], y) < 1e-6 && distance(floor.nodes[b], x) < 1e-6), 'Every edge must be an exact source segment');
    for (const terminal of floor.terminals) assert.ok(originals.some(([a, b]) =>
      onSegment(floor.nodes[terminal.node], a, b) && onSegment(terminal.point, a, b)), 'Terminal remains on its source access segment');
    assert.ok(floor.audit.excludedSegments > 0);
  }
  const ids = new Set(data.floors[0].edges.map(e => e[2]));
  // Direct shortcuts through Dyson, and the source segment crossing the
  // exterior wall toward Apple, must never be used as corridor edges.
  for (const blocked of ['0f9f0029881f27a5c3881b5128712087:0', '692932b7f55f893acbc3d4c6d713816c:0', '2db3f0a9241972246f45f4bd36127d5a:0']) assert.ok(!ids.has(blocked));
});

test('Venchi preview uses the longer source path and stops outside the store', () => {
  const result = api().plan(query());
  assert.equal(result.status, 'provisional');
  assert.equal(result.routingVerified, false);
  assert.equal(result.directionsVerified, false);
  assert.equal(result.endpoint, 'outside-destination');
  assert.equal(result.stopsBeforeObstacle, true);
  assert.ok(result.previewLengthMeters > 100 && result.previewLengthMeters < 110);
  assert.ok(result.points.length > 6);
  const originals = sourceSegments('LL');
  const polygons = source.floors[0].features.map(f => f.geometry.coordinates.map(r => r.map(project)));
  for (let i = 1; i < result.points.length; i++) {
    const a = result.points[i - 1], b = result.points[i];
    assert.ok(originals.some(([x, y]) => onSegment(a, x, y) && onSegment(b, x, y)), 'No straight-line shortcuts between source segments');
    for (let step = 0; step <= 32; step++) {
      const p = [a[0] + (b[0] - a[0]) * step / 32, a[1] + (b[1] - a[1]) * step / 32];
      assert.ok(!polygons.some(rings => inside(p, rings)), 'Preview must stay outside every store');
    }
  }
  const terminal = data.floors[0].terminals.find(t => t.polygonId === venchi);
  assert.ok(distance(result.points.at(-1), terminal.entrance) > 40, 'Do not draw an invented final line through the wall to the source entrance');
});

test('missing, conflicting or disconnected evidence produces no path', () => {
  const planner = api();
  for (const [changes, reason] of [
    [{coordinateSpace: 'provisional-plan-pixels'}, 'different-coordinate-space'],
    [{mallId: 'another-mall'}, 'different-coordinate-space'],
    [{floor: 'not-a-floor'}, 'floor-unavailable'],
    [{origin: null}, 'origin-unavailable'],
    [{origin: {x: 900000, y: 900000}}, 'origin-not-on-source-path'],
    [{destinationPolygonIds: ['unknown']}, 'destination-access-unavailable'],
    [{destinationPolygonIds: ['afe666fc9afcd1f07016c49075052dbc']}, 'destination-access-unavailable'],
    [{floor: 'UL', destinationPolygonIds: ['e3f00b2b41f9ef040b22406bd2d602dd']}, 'destination-access-unavailable'],
  ]) {
    const result = planner.plan(query(changes));
    assert.equal(result.status, 'unavailable');assert.equal(result.reason, reason);assert.equal(result.points.length, 0);
  }
  const joeResult = planner.plan(query({destinationPolygonIds: [joe]}));
  assert.equal(joeResult.status, 'provisional');assert.ok(joeResult.previewLengthMeters < 3);
});

test('only source quantization tolerance is accepted, without drawing a connector', () => {
  const planner = api(fixture());
  const near = planner.plan(fixtureQuery({origin: {x: 50, y: 1}}));
  assert.equal(near.status, 'provisional');assert.ok(Math.abs(near.originOffsetMeters - .1) < 1e-8);
  assert.equal(near.points[0][1], 0);
  const far = planner.plan(fixtureQuery({origin: {x: 50, y: 1.6}}));
  assert.equal(far.reason, 'origin-not-on-source-path');assert.equal(far.points.length, 0);
});

test('routing follows source bends and never joins nearby disconnected endpoints', () => {
  const planner = api(fixture()), route = planner.plan(fixtureQuery());
  assert.deepEqual(JSON.parse(JSON.stringify(route.points)), [[50, 0], [100, 0], [100, 100], [0, 100], [0, 120]]);
  assert.equal(route.previewLengthMeters, 27);
  const disconnected = fixture();
  disconnected.floors[0].nodes = [[0, 0], [100, 0], [101, 0], [201, 0]];
  disconnected.floors[0].edges = [[0, 1, 'left'], [2, 3, 'right']];
  disconnected.floors[0].terminals[0].point = [210, 0];
  disconnected.floors[0].terminals[0].entrance = [220, 0];
  const missing = api(disconnected).plan(fixtureQuery());
  assert.equal(missing.reason, 'disconnected-source-paths');assert.equal(missing.points.length, 0);
});

test('invalid configuration cannot silently enable guidance', () => {
  const planner = api();
  assert.equal(planner.configure({...fixture(), routingVerified: true}), false);
  assert.equal(planner.plan(fixtureQuery()).reason, 'source-data-unavailable');
  assert.equal(planner.configure({...fixture(), originToleranceMeters: 5}), false);
});

test('explicit origin choices are source nodes connected to the requested destination', () => {
  const planner = api(), candidates = planner.getOriginCandidates(query());
  assert.ok(candidates.length > 10);
  const nodes = data.floors[0].nodes;
  for (const candidate of candidates) {
    assert.equal(candidate.previewOnly, true);
    assert.equal(candidate.floor, 'LL');
    assert.ok(nodes.some(p => p[0] === candidate.x && p[1] === candidate.y));
    assert.equal(planner.plan(query({origin: candidate})).status, 'provisional');
  }
  assert.equal(planner.getOriginCandidates(query({coordinateSpace: 'photo-pixels'})).length, 0);
  assert.equal(planner.getOriginCandidates(query({destinationPolygonIds: ['unknown']})).length, 0);
  const disconnected = fixture();
  disconnected.floors[0].nodes = [[0, 0], [100, 0], [101, 0], [201, 0]];
  disconnected.floors[0].edges = [[0, 1, 'left'], [2, 3, 'right']];
  disconnected.floors[0].terminals[0].point = [210, 0];
  disconnected.floors[0].terminals[0].entrance = [220, 0];
  const isolatedPlanner = api(disconnected), isolated = isolatedPlanner.getOriginCandidates(fixtureQuery());
  assert.deepEqual(isolated.map(p => p.x).sort((a, b) => a - b).join(','), '101,201');
  for (const point of isolated) assert.equal(isolatedPlanner.plan(fixtureQuery({origin: point})).status, 'provisional');
});

test('verified escalator landings extend the same graph across floors without an invented vertical line', () => {
  const connected = fixture();
  connected.floors[0].terminals = [];
  connected.floors.push({id: 'UL', nodes: [[0, 100], [100, 100]], edges: [[0, 1, 'upper']],
    terminals: [{polygonId: 'upper-target', node: 1, point: [120, 100], entrance: [130, 100],
      sourceSegmentId: 'upper-access', sourceEntranceOffsetMeters: 0, stopsBeforeObstacle: true}]});
  connected.connectors = [{id: 'escalator-1', type: 'escalator',
    from: {floor: 'LL', node: 3}, to: {floor: 'UL', node: 0}, direction: 'both',
    costUnits: 80, verified: true, landingMappingsVerified: true, sourceId: 'survey:escalator-1'}];
  const planner = api(connected);
  const route = planner.plan(fixtureQuery({floor: 'UL', destinationPolygonIds: ['upper-target'],
    origin: {floor: 'LL', x: 50, y: 0}}));
  assert.equal(route.status, 'provisional');
  assert.deepEqual(JSON.parse(JSON.stringify(route.routeSegments.map(s => s.floor))), ['LL', 'UL']);
  assert.deepEqual(JSON.parse(JSON.stringify(route.routeSegments[0].points.at(-1))), [0, 100]);
  assert.deepEqual(JSON.parse(JSON.stringify(route.routeSegments[1].points[0])), [0, 100]);
  assert.equal(route.points.length, 0, 'cross-floor points remain split by floor for rendering');
  assert.deepEqual(JSON.parse(JSON.stringify(route.connectorsUsed.map(c => [c.id, c.type, c.fromFloor, c.toFloor]))),
    [['escalator-1', 'escalator', 'LL', 'UL']]);
  assert.ok(planner.getOriginCandidates({mallId: 'test', coordinateSpace: 'test:decimeters',
    floor: 'LL', destinationFloor: 'UL', destinationPolygonIds: ['upper-target']}).length > 0);

  const unverified = structuredClone(connected);unverified.connectors[0].landingMappingsVerified = false;
  assert.equal(planner.configure(unverified), false, 'an unverified landing invalidates the whole route dataset');
  assert.equal(planner.plan(fixtureQuery()).reason, 'source-data-unavailable');
});
