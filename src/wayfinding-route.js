/* Source-constrained route previews. Vertical travel is accepted only through
 * explicitly verified connector landings; missing evidence never creates a
 * nearest-point bridge or a straight line between floors. */
(function (root) {
  'use strict';
  let data = null;
  const finitePoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const key = (floor, node) => floor + ':' + node;
  const connectorTypes = new Set(['escalator', 'elevator', 'stairs', 'ramp']);
  function configure(candidate) {
    data = null;
    if (!candidate || candidate.schema !== 'retailnav.routing-preview.v1' || candidate.routingVerified !== false ||
        !candidate.mallId || !candidate.coordinateSpace || !candidate.source?.sha256 ||
        candidate.projection?.unitsPerMeter !== 10 || !Array.isArray(candidate.floors) ||
        !(candidate.originToleranceMeters > 0 && candidate.originToleranceMeters <= .15)) return false;
    const floorById = new Map();
    for (const floor of candidate.floors) {
      if (!floor.id || floorById.has(floor.id) || !Array.isArray(floor.nodes) || !floor.nodes.every(finitePoint) ||
          !Array.isArray(floor.edges) || !floor.edges.every(e => Array.isArray(e) && e.length === 3 &&
            Number.isInteger(e[0]) && Number.isInteger(e[1]) && floor.nodes[e[0]] && floor.nodes[e[1]] &&
            e[0] !== e[1] && typeof e[2] === 'string') ||
          !Array.isArray(floor.terminals) || !floor.terminals.every(t => t.polygonId &&
            Number.isInteger(t.node) && floor.nodes[t.node] && finitePoint(t.point) && finitePoint(t.entrance) &&
            typeof t.sourceSegmentId === 'string' && t.sourceEntranceOffsetMeters >= 0 &&
            t.sourceEntranceOffsetMeters <= .15)) return false;
      floorById.set(floor.id, floor);
    }
    const connectors = candidate.connectors || [];
    if (!Array.isArray(connectors) || !connectors.every(c => {
      const from = floorById.get(c?.from?.floor), to = floorById.get(c?.to?.floor);
      return c && typeof c.id === 'string' && connectorTypes.has(c.type) && c.verified === true &&
        c.landingMappingsVerified === true && ['both', 'forward', 'reverse'].includes(c.direction) &&
        from && to && from !== to && Number.isInteger(c.from.node) && from.nodes[c.from.node] &&
        Number.isInteger(c.to.node) && to.nodes[c.to.node] && Number.isFinite(c.costUnits) && c.costUnits > 0 &&
        typeof c.sourceId === 'string';
    })) return false;
    data = {...candidate, connectors};
    return true;
  }
  function unavailable(reason, extra) {
    return {status: 'unavailable', routingVerified: false, points: [], routeSegments: [],
      connectorsUsed: [], reason, ...extra};
  }
  function projection(point, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], squared = dx * dx + dy * dy;
    const t = squared ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / squared)) : 0;
    const projected = [a[0] + t * dx, a[1] + t * dy];
    return {point: projected, offset: distance(point, projected)};
  }
  function graph() {
    const adjacency = new Map();
    const add = (from, to, weight, edge) => {
      if (!adjacency.has(from)) adjacency.set(from, []);
      adjacency.get(from).push({to, weight, edge});
    };
    for (const floor of data.floors) {
      floor.nodes.forEach((_, node) => adjacency.set(key(floor.id, node), []));
      for (const [a, b, sourceId] of floor.edges) {
        const weight = distance(floor.nodes[a], floor.nodes[b]);
        const edge = {kind: 'corridor', floor: floor.id, sourceId};
        add(key(floor.id, a), key(floor.id, b), weight, edge);
        add(key(floor.id, b), key(floor.id, a), weight, edge);
      }
    }
    for (const connector of data.connectors) {
      const a = key(connector.from.floor, connector.from.node);
      const b = key(connector.to.floor, connector.to.node);
      const edge = {kind: 'connector', connector};
      if (connector.direction !== 'reverse') add(a, b, connector.costUnits, edge);
      if (connector.direction !== 'forward') add(b, a, connector.costUnits, edge);
    }
    return adjacency;
  }
  function reachableFromTerminals(destinationFloor, terminals) {
    const adjacency = graph(), reverse = new Map([...adjacency].map(([id]) => [id, []]));
    for (const [from, links] of adjacency) for (const link of links) reverse.get(link.to).push(from);
    const connected = new Set(terminals.map(t => key(destinationFloor.id, t.node)));
    const pending = [...connected];
    while (pending.length) for (const next of reverse.get(pending.pop()) || [])
      if (!connected.has(next)) {connected.add(next);pending.push(next);}
    return connected;
  }
  function getOriginCandidates(input) {
    if (!data || input?.mallId !== data.mallId || input.coordinateSpace !== data.coordinateSpace) return [];
    const originFloor = data.floors.find(f => f.id === input.floor);
    const destinationFloor = data.floors.find(f => f.id === (input.destinationFloor || input.floor));
    if (!originFloor || !destinationFloor) return [];
    const ids = new Set(input.destinationPolygonIds || []);
    const terminals = destinationFloor.terminals.filter(t => ids.has(t.polygonId));
    if (!terminals.length) return [];
    const connected = reachableFromTerminals(destinationFloor, terminals);
    return originFloor.nodes.map((point, index) => ({point, index}))
      .filter(({index}) => connected.has(key(originFloor.id, index)))
      .map(({point, index}) => ({id: 'source-start:' + originFloor.id + ':' + index,
        floor: originFloor.id, x: point[0], y: point[1], previewOnly: true}));
  }
  function plan(input) {
    if (!data) return unavailable('source-data-unavailable');
    if (input?.mallId !== data.mallId || input.coordinateSpace !== data.coordinateSpace)
      return unavailable('different-coordinate-space');
    const destinationFloor = data.floors.find(f => f.id === input.floor);
    const originFloor = data.floors.find(f => f.id === (input.origin?.floor || input.floor));
    if (!destinationFloor || !originFloor) return unavailable('floor-unavailable');
    const origin = [input.origin?.x, input.origin?.y];
    if (!finitePoint(origin)) return unavailable('origin-unavailable');
    const ids = new Set(input.destinationPolygonIds || []);
    const terminals = destinationFloor.terminals.filter(t => ids.has(t.polygonId));
    if (!terminals.length) return unavailable('destination-access-unavailable', {floor: destinationFloor.id});
    let start = null;
    for (const edge of originFloor.edges) {
      const projected = projection(origin, originFloor.nodes[edge[0]], originFloor.nodes[edge[1]]);
      if (!start || projected.offset < start.offset) start = {...projected, edge};
    }
    if (!start || start.offset > data.originToleranceMeters * 10 + 1e-7)
      return unavailable('origin-not-on-source-path', {floor: originFloor.id});
    if (originFloor !== destinationFloor && !data.connectors.length)
      return unavailable('vertical-connection-unavailable', {floor: destinationFloor.id, originFloor: originFloor.id});
    const adjacency = graph(), costs = new Map(), previous = new Map(), visited = new Set();
    for (const id of adjacency.keys()) costs.set(id, Infinity);
    for (const node of start.edge.slice(0, 2))
      costs.set(key(originFloor.id, node), distance(start.point, originFloor.nodes[node]));
    while (visited.size < adjacency.size) {
      let current = null;
      for (const [id, cost] of costs) if (!visited.has(id) && Number.isFinite(cost) &&
          (current === null || cost < costs.get(current))) current = id;
      if (current === null) break;
      visited.add(current);
      for (const link of adjacency.get(current) || []) if (costs.get(current) + link.weight < costs.get(link.to)) {
        costs.set(link.to, costs.get(current) + link.weight);
        previous.set(link.to, {key: current, edge: link.edge});
      }
    }
    let destination = null;
    for (const terminal of terminals) {
      const nodeKey = key(destinationFloor.id, terminal.node);
      const cost = costs.get(nodeKey) + distance(destinationFloor.nodes[terminal.node], terminal.point);
      if (Number.isFinite(cost) && (!destination || cost < destination.cost)) destination = {terminal, cost, nodeKey};
    }
    if (!destination) return unavailable(originFloor === destinationFloor ? 'disconnected-source-paths' :
      'vertical-connection-unavailable', {floor: destinationFloor.id, originFloor: originFloor.id});
    const nodeKeys = [destination.nodeKey], pathEdges = [];
    while (previous.has(nodeKeys[0])) {
      const parent = previous.get(nodeKeys[0]);pathEdges.unshift(parent.edge);nodeKeys.unshift(parent.key);
    }
    const floorMap = new Map(data.floors.map(f => [f.id, f]));
    const decode = id => {const split = id.lastIndexOf(':');return {floor: id.slice(0, split), node: Number(id.slice(split + 1))};};
    const first = decode(nodeKeys[0]), routeSegments = [{floor: originFloor.id,
      points: [start.point.slice(), originFloor.nodes[first.node].slice()]}];
    const connectorsUsed = [], sourceSegmentIds = [start.edge[2]];
    for (let i = 0; i < pathEdges.length; i++) {
      const edge = pathEdges[i], next = decode(nodeKeys[i + 1]);
      if (edge.kind === 'corridor') {
        routeSegments.at(-1).points.push(floorMap.get(next.floor).nodes[next.node].slice());
        sourceSegmentIds.push(edge.sourceId);
      } else {
        connectorsUsed.push({id: edge.connector.id, type: edge.connector.type,
          fromFloor: decode(nodeKeys[i]).floor, toFloor: next.floor,
          direction: edge.connector.direction, verified: true,
          landingMappingsVerified: true, sourceId: edge.connector.sourceId});
        routeSegments.push({floor: next.floor, points: [floorMap.get(next.floor).nodes[next.node].slice()]});
      }
    }
    routeSegments.at(-1).points.push(destination.terminal.point.slice());
    for (const segment of routeSegments) segment.points = segment.points
      .filter((point, index, all) => !index || distance(point, all[index - 1]) > 1e-6);
    sourceSegmentIds.push(destination.terminal.sourceSegmentId);
    const points = routeSegments.length === 1 ? routeSegments[0].points.map(p => p.slice()) : [];
    return {status: 'provisional', routingVerified: false, reason: 'source-preview-not-verified',
      floor: destinationFloor.id, originFloor: originFloor.id,
      destinationPolygonId: destination.terminal.polygonId, points, routeSegments, connectorsUsed,
      endpoint: 'outside-destination', stopsBeforeObstacle: destination.terminal.stopsBeforeObstacle,
      originOffsetMeters: start.offset / 10, previewLengthMeters: destination.cost / 10,
      sourceSha256: data.source.sha256, sourceSegmentIds: [...new Set(sourceSegmentIds)],
      directionsVerified: false};
  }
  function pointInRing(point, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > point[1]) !== (b[1] > point[1]) &&
          point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  function pointInFeature(point, feature) {
    const rings = feature?.r;
    return Array.isArray(rings) && rings[0]?.length >= 3 && pointInRing(point, rings[0]) &&
      !rings.slice(1).some(ring => ring.length >= 3 && pointInRing(point, ring));
  }
  function segmentDistance(point, a, b) {
    return projection(point, a, b).offset;
  }
  function featureDistance(point, feature) {
    let nearest = Infinity;
    for (const ring of feature?.r || []) for (let i = 0; i < ring.length; i++)
      nearest = Math.min(nearest, segmentDistance(point, ring[i], ring[(i + 1) % ring.length]));
    return nearest;
  }
  function simplifyGridPath(points) {
    if (points.length < 3) return points;
    const simplified = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const a = simplified.at(-1), b = points[i], c = points[i + 1];
      const ab = [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
      const bc = [Math.sign(c[0] - b[0]), Math.sign(c[1] - b[1])];
      if (ab[0] !== bc[0] || ab[1] !== bc[1]) simplified.push(b);
    }
    simplified.push(points.at(-1));
    return simplified;
  }
  /* Some official SVG plans provide the floor shell and every shop boundary,
   * but no authored corridor centreline. When a mall explicitly opts in, this
   * derives a same-floor PREVIEW through the unoccupied source geometry. It is
   * never promoted to verified navigation and never creates a vertical link. */
  function planFloorGeometry(input) {
    const policy = input?.policy;
    if (!policy || policy.schema !== 'retailnav.same-floor-routing-preview.v1' ||
        policy.routingVerified !== false || policy.sourceGeometry !== 'official-svg-floor-minus-units')
      return unavailable('floor-geometry-preview-disabled');
    const origin = input.origin, floor = input.floor;
    if (!origin || origin.floor !== floor || !finitePoint([origin.x, origin.y]))
      return unavailable(origin?.floor && origin.floor !== floor ? 'vertical-connection-unavailable' : 'origin-unavailable');
    const features = Array.isArray(input.features) ? input.features : [];
    const slabs = features.filter(feature => feature.k === 'slab' && feature.r?.[0]?.length >= 3);
    const blockers = features.filter(feature => ['unit', 'anchor'].includes(feature.k) && feature.r?.[0]?.length >= 3);
    const destinationIds = new Set(input.destinationPolygonIds || []);
    const destinations = blockers.filter(feature => destinationIds.has(feature.id));
    if (!slabs.length || !destinations.length) return unavailable('destination-access-unavailable', {floor});
    const step = Math.max(8, Math.min(40, Number(policy.gridStepSourceUnits) || 18));
    const clearance = Math.max(0, Math.min(step * .45, Number(policy.clearanceSourceUnits) || 0));
    const all = slabs.flatMap(feature => feature.r[0]);
    const minX = Math.min(...all.map(p => p[0])), maxX = Math.max(...all.map(p => p[0]));
    const minY = Math.min(...all.map(p => p[1])), maxY = Math.max(...all.map(p => p[1]));
    const width = Math.ceil((maxX - minX) / step), height = Math.ceil((maxY - minY) / step);
    if (!(width > 0 && height > 0) || width * height > 90000) return unavailable('floor-geometry-too-large', {floor});
    const offsets = clearance ? [[0, 0], [clearance, 0], [-clearance, 0], [0, clearance], [0, -clearance]] : [[0, 0]];
    const openAt = point => offsets.every(offset => {
      const sample = [point[0] + offset[0], point[1] + offset[1]];
      return slabs.some(slab => pointInFeature(sample, slab)) && !blockers.some(blocker => pointInFeature(sample, blocker));
    });
    const originPoint = [origin.x, origin.y];
    if (!openAt(originPoint)) return unavailable('origin-not-in-source-free-space', {floor});
    const points = Array(width * height), open = new Uint8Array(width * height);
    const at = index => points[index];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = y * width + x, point = [minX + (x + .5) * step, minY + (y + .5) * step];
      points[index] = point;open[index] = Number(openAt(point));
    }
    const openIndices = [];
    for (let i = 0; i < open.length; i++) if (open[i]) openIndices.push(i);
    if (!openIndices.length) return unavailable('source-free-space-empty', {floor});
    const start = openIndices.reduce((best, index) => distance(at(index), originPoint) < distance(at(best), originPoint) ? index : best);
    if (distance(at(start), originPoint) > step * 1.6) return unavailable('origin-not-in-source-free-space', {floor});
    let goal = null, goalDistance = Infinity, destination = null;
    for (const index of openIndices) for (const feature of destinations) {
      const d = featureDistance(at(index), feature);
      if (d < goalDistance) {goalDistance = d;goal = index;destination = feature;}
    }
    if (goal === null || goalDistance > step * 2.25)
      return unavailable('destination-access-unavailable', {floor});
    const costs = new Float64Array(open.length);costs.fill(Infinity);costs[start] = 0;
    const previous = new Int32Array(open.length);previous.fill(-1);
    const queued = new Uint8Array(open.length), pending = [start];queued[start] = 1;
    const moves = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (pending.length) {
      let bestAt = 0;
      for (let i = 1; i < pending.length; i++) {
        const a = pending[i], b = pending[bestAt];
        if (costs[a] + distance(at(a), at(goal)) < costs[b] + distance(at(b), at(goal))) bestAt = i;
      }
      const current = pending.splice(bestAt, 1)[0];queued[current] = 0;
      if (current === goal) break;
      const cx = current % width, cy = Math.floor(current / width);
      for (const [dx, dy] of moves) {
        const x = cx + dx, y = cy + dy;if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const next = y * width + x;if (!open[next]) continue;
        if (dx && dy && (!open[cy * width + x] || !open[y * width + cx])) continue;
        const nextCost = costs[current] + (dx && dy ? Math.SQRT2 : 1) * step;
        if (nextCost + 1e-7 >= costs[next]) continue;
        costs[next] = nextCost;previous[next] = current;
        if (!queued[next]) {pending.push(next);queued[next] = 1;}
      }
    }
    if (start !== goal && previous[goal] < 0) return unavailable('disconnected-source-free-space', {floor});
    const path = [goal];while (path[0] !== start) path.unshift(previous[path[0]]);
    let routePoints = simplifyGridPath(path.map(at));
    if (distance(originPoint, routePoints[0]) > 1e-6) routePoints.unshift(originPoint);
    const previewLength = routePoints.slice(1).reduce((sum, point, i) => sum + distance(routePoints[i], point), 0);
    return {status: 'provisional', routingVerified: false, directionsVerified: false,
      reason: 'official-svg-free-space-preview', floor, originFloor: floor,
      destinationPolygonId: destination.id, points: routePoints,
      routeSegments: [{floor, points: routePoints.map(point => point.slice())}], connectorsUsed: [],
      endpoint: 'outside-destination', stopsBeforeObstacle: true,
      previewLengthMeters: previewLength * (Number(input.sourceUnitsToMeters) || 1),
      sourceSegmentIds: ['derived:official-svg-free-space:' + floor]};
  }
  root.RetailNavWayfindingRoute = Object.freeze({configure, plan, planFloorGeometry, getOriginCandidates});
})(typeof window === 'undefined' ? globalThis : window);
