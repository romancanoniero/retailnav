/* Source-constrained, same-floor route previews. Never navigation instructions. */
(function (root) {
  'use strict';
  let data = null;
  const finitePoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function configure(candidate) {
    data = null;
    if (!candidate || candidate.schema !== 'retailnav.routing-preview.v1' || candidate.routingVerified !== false ||
        !candidate.mallId || !candidate.coordinateSpace || !candidate.source?.sha256 ||
        candidate.projection?.unitsPerMeter !== 10 || !Array.isArray(candidate.floors) ||
        !(candidate.originToleranceMeters > 0 && candidate.originToleranceMeters <= .15)) return false;
    for (const floor of candidate.floors) {
      if (!floor.id || !Array.isArray(floor.nodes) || !floor.nodes.every(finitePoint) ||
          !Array.isArray(floor.edges) || !floor.edges.every(e => Array.isArray(e) && e.length === 3 &&
            Number.isInteger(e[0]) && Number.isInteger(e[1]) && floor.nodes[e[0]] && floor.nodes[e[1]] &&
            e[0] !== e[1] && typeof e[2] === 'string') ||
          !Array.isArray(floor.terminals) || !floor.terminals.every(t => t.polygonId &&
            Number.isInteger(t.node) && floor.nodes[t.node] && finitePoint(t.point) && finitePoint(t.entrance) &&
            typeof t.sourceSegmentId === 'string' && t.sourceEntranceOffsetMeters >= 0 &&
            t.sourceEntranceOffsetMeters <= .15)) return false;
    }
    data = candidate;
    return true;
  }
  function unavailable(reason, extra) {
    return {status: 'unavailable', routingVerified: false, points: [], reason, ...extra};
  }
  function projection(point, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], squared = dx * dx + dy * dy;
    const t = squared ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / squared)) : 0;
    const projected = [a[0] + t * dx, a[1] + t * dy];
    return {point: projected, offset: distance(point, projected)};
  }
  function getOriginCandidates(input) {
    if (!data || input?.mallId !== data.mallId || input.coordinateSpace !== data.coordinateSpace) return [];
    const floor = data.floors.find(f => f.id === input.floor);
    if (!floor) return [];
    const ids = new Set(input.destinationPolygonIds || []);
    const terminals = floor.terminals.filter(t => ids.has(t.polygonId));
    if (!terminals.length) return [];
    const adjacency = floor.nodes.map(() => []);
    for (const [a, b] of floor.edges) {adjacency[a].push(b);adjacency[b].push(a);}
    const connected = new Set(terminals.map(t => t.node)), pending = [...connected];
    while (pending.length) {
      for (const next of adjacency[pending.pop()]) {
        if (!connected.has(next)) {connected.add(next);pending.push(next);}
      }
    }
    // These are explicit choices for the visitor, never a nearest-node snap
    // or an assertion that the visitor is already at one of these positions.
    return [...connected].sort((a, b) => a - b).map(index => ({
      id: 'source-start:' + floor.id + ':' + index, floor: floor.id,
      x: floor.nodes[index][0], y: floor.nodes[index][1], previewOnly: true
    }));
  }
  function plan(input) {
    if (!data) return unavailable('source-data-unavailable');
    if (input?.mallId !== data.mallId || input.coordinateSpace !== data.coordinateSpace)
      return unavailable('different-coordinate-space');
    const floor = data.floors.find(f => f.id === input.floor);
    if (!floor) return unavailable('floor-unavailable');
    const origin = [input.origin?.x, input.origin?.y];
    if (!finitePoint(origin)) return unavailable('origin-unavailable');
    const ids = new Set(input.destinationPolygonIds || []);
    const terminals = floor.terminals.filter(t => ids.has(t.polygonId));
    if (!terminals.length) return unavailable('destination-access-unavailable', {floor: floor.id});
    let start = null;
    for (const edge of floor.edges) {
      const projected = projection(origin, floor.nodes[edge[0]], floor.nodes[edge[1]]);
      if (!start || projected.offset < start.offset) start = {...projected, edge};
    }
    if (!start || start.offset > data.originToleranceMeters * 10 + 1e-7)
      return unavailable('origin-not-on-source-path', {floor: floor.id});
    // Only the existing source edge containing the origin is split. A point
    // within source coordinate precision may be normalized onto that edge;
    // no visible connector from an arbitrary visitor position is invented.
    const adjacency = floor.nodes.map(() => []);
    for (const edge of floor.edges) {
      const [a, b] = edge, weight = distance(floor.nodes[a], floor.nodes[b]);
      adjacency[a].push([b, weight, edge[2]]);
      adjacency[b].push([a, weight, edge[2]]);
    }
    const costs = floor.nodes.map(() => Infinity), previous = floor.nodes.map(() => null), visited = new Set();
    for (const node of start.edge.slice(0, 2)) costs[node] = distance(start.point, floor.nodes[node]);
    while (visited.size < floor.nodes.length) {
      let current = -1;
      for (let i = 0; i < costs.length; i++)
        if (!visited.has(i) && Number.isFinite(costs[i]) && (current < 0 || costs[i] < costs[current])) current = i;
      if (current < 0) break;
      visited.add(current);
      for (const [next, weight, segmentId] of adjacency[current]) {
        if (costs[current] + weight < costs[next]) {
          costs[next] = costs[current] + weight;
          previous[next] = {node: current, segmentId};
        }
      }
    }
    let destination = null;
    for (const terminal of terminals) {
      const cost = costs[terminal.node] + distance(floor.nodes[terminal.node], terminal.point);
      if (Number.isFinite(cost) && (!destination || cost < destination.cost)) destination = {terminal, cost};
    }
    if (!destination) return unavailable('disconnected-source-paths', {floor: floor.id});
    const chain = [], sourceSegmentIds = [destination.terminal.sourceSegmentId];
    let cursor = destination.terminal.node;
    while (true) {
      chain.push(floor.nodes[cursor]);
      const parent = previous[cursor];
      if (!parent) break;
      sourceSegmentIds.push(parent.segmentId);
      cursor = parent.node;
    }
    sourceSegmentIds.push(start.edge[2]);
    const points = [start.point, ...chain.reverse(), destination.terminal.point]
      .filter((point, index, all) => !index || distance(point, all[index - 1]) > 1e-6)
      .map(p => p.slice());
    return {status: 'provisional', routingVerified: false, reason: 'source-preview-not-verified',
      floor: floor.id, destinationPolygonId: destination.terminal.polygonId, points,
      endpoint: 'outside-destination', stopsBeforeObstacle: destination.terminal.stopsBeforeObstacle,
      originOffsetMeters: start.offset / 10, previewLengthMeters: destination.cost / 10,
      sourceSha256: data.source.sha256, sourceSegmentIds: [...new Set(sourceSegmentIds.reverse())],
      directionsVerified: false};
  }
  root.RetailNavWayfindingRoute = Object.freeze({configure, plan, getOriginCandidates});
})(typeof window === 'undefined' ? globalThis : window);
