// Formation 2 — the encoder's neural network. Pure. 19 nodes in four layers (4-6-6-3):
// 35% of N fill the nodes as particle spheres, 50% run along every edge between adjacent layers (each edge's share
// ∝ its length), 15% are dust. Horizontal (inputs left), or top to bottom at aspect < 0.8 (inputs on top).
// meta = position along the network, 0 at the inputs to 1 at the outputs (layer / 3 for a node, between its two
// layers for an edge particle): the shader's activation pulse (uPulse) travels along it.
import { makeFormation, gauss, fillDust, shuffle } from './common.js';

export const NETWORK_LAYERS = [4, 6, 6, 3];

const SHARE = { spheres: 0.35, edges: 0.5 };   // the rest is dust
const PITCH = 1;                       // node spacing within a layer
// Horizontal: inputs → outputs, and the node sphere radius. The box (12.4 × 5.4, about 2.3 : 1) is near the shape
// of the stage below the text on most screens, so the rows get the height and each hidden label clears the node above.
const H = { span: 12, radius: 0.2 };
// Vertical: every label sits to the right of its node, and most labels are longer than the pitch, so each row
// steps down to the right — a node one pitch along sits `shear` lower — and a label passes above the next nodes
// of its row instead of running into them. The short input and output rows step further: on a phone their labels
// stack (the vertical network's scale is set by the phone's width); the hidden rows step just enough for their
// labels on a portrait tablet, so the four rows stay apart.
const V = { span: 6, radius: 0.15, shear: [0.45, 0.3, 0.3, 0.45] };
const EDGE_JITTER = 0.012;             // thickness of an edge line (σ, world units)
const DUST_RADIUS = 0.6;               // dust ball radius, × the larger side of the box
const MIN_N = 1000;                    // below it a node gets < 20 particles and an edge < 7: no longer a network

/**
 * The 19 nodes of the network in its local frame, centred on its box: `index` counts from the top (horizontal)
 * or from the left (vertical); `r` is the sphere radius.
 */
export function networkNodes({ vertical }) {
  const nodes = [];
  const last = NETWORK_LAYERS.length - 1;
  NETWORK_LAYERS.forEach((count, layer) => {
    const along = layer / last - 0.5;  // −0.5 at the inputs … 0.5 at the outputs
    for (let index = 0; index < count; index++) {
      const across = index - (count - 1) / 2;
      const x = vertical ? across * PITCH : along * H.span;
      const y = vertical ? -along * V.span - across * V.shear[layer] * PITCH : -across * PITCH;
      nodes.push({ layer, index, x, y, z: 0, r: vertical ? V.radius : H.radius });
    }
  });
  // The shear tilts the rows, so the vertical extent is not symmetric: centre the box on the local origin.
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { y, r } of nodes) {
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  }
  const mid = (minY + maxY) / 2;
  for (const node of nodes) node.y -= mid;
  return nodes;
}

/** The nodes' extent `{ w, h }` (spheres included); networkNodes centres it on the local origin. */
export function networkBox(nodes) {
  let w = 0;
  let h = 0;
  for (const { x, y, r } of nodes) {
    w = Math.max(w, 2 * (Math.abs(x) + r));
    h = Math.max(h, 2 * (Math.abs(y) + r));
  }
  return { w, h };
}

/** Splits `total` into whole counts proportional to `weights` (largest remainder), summing exactly to `total`. */
function apportion(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.floor((total * w) / sum));
  let left = total - counts.reduce((a, b) => a + b, 0);
  const order = weights.map((w, i) => i).sort((a, b) => (total * weights[b]) / sum - counts[b] - ((total * weights[a]) / sum - counts[a]));
  for (let i = 0; left > 0; i++, left--) counts[order[i % order.length]]++;
  return counts;
}

export function buildNetwork(N, { vertical, rng }) {
  const data = makeFormation(N);
  const nodes = networkNodes({ vertical });
  const box = networkBox(nodes);
  const last = NETWORK_LAYERS.length - 1;
  const nSpheres = Math.round(N * SHARE.spheres);
  const nEdges = Math.round(N * SHARE.edges);
  let i = 0;
  const put = (x, y, z, meta) => {
    data[i * 4] = x;
    data[i * 4 + 1] = y;
    data[i * 4 + 2] = z;
    data[i * 4 + 3] = meta;
    i++;
  };

  // Spheres: uniform in each node's ball.
  for (const [n, count] of apportion(nSpheres, nodes.map(() => 1)).entries()) {
    const { x, y, z, r, layer } = nodes[n];
    for (let j = 0; j < count; j++) {
      const rr = r * Math.cbrt(rng());
      const cz = 2 * rng() - 1;
      const a = 2 * Math.PI * rng();
      const s = Math.sqrt(1 - cz * cz);
      put(x + rr * s * Math.cos(a), y + rr * s * Math.sin(a), z + rr * cz, layer / last);
    }
  }

  // Edges: every node to every node of the next layer, sphere surface to sphere surface, stratified along it.
  const edges = [];
  for (const a of nodes) {
    for (const b of nodes) {
      if (b.layer !== a.layer + 1) continue;
      const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      edges.push({ a, b, length, t0: a.r / length, t1: 1 - b.r / length });
    }
  }
  const counts = apportion(nEdges, edges.map((e) => e.length));   // ∝ edge length
  edges.forEach(({ a, b, length, t0, t1 }, e) => {
    const nx = -(b.y - a.y) / length;    // the in-plane normal, for the line's thickness
    const ny = (b.x - a.x) / length;
    for (let j = 0; j < counts[e]; j++) {
      const t = t0 + ((t1 - t0) * (j + rng())) / counts[e];
      const off = EDGE_JITTER * gauss(rng);
      put(
        a.x + (b.x - a.x) * t + nx * off,
        a.y + (b.y - a.y) * t + ny * off,
        a.z + (b.z - a.z) * t + EDGE_JITTER * gauss(rng),
        (a.layer + t) / last,
      );
    }
  });

  fillDust(data, i, N, { radius: DUST_RADIUS * Math.max(box.w, box.h), rng });
  shuffle(data, 4, rng);               // so any slice of the particles is spread over the whole network
  return { data, box, minN: MIN_N };
}
