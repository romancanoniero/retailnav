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
  root.RetailNavWayfindingRoute = Object.freeze({configure, plan, getOriginCandidates});
})(typeof window === 'undefined' ? globalThis : window);
