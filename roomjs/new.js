const STAIR_NODES = ['B2.up', 'B2.down', 'B4.up', 'B4.down'];

function displayName(nodeId) {
  if (!nodeId) return nodeId;
  const cp = connectionPoints[nodeId];
  if (cp && cp.displayName) return cp.displayName;
  return nodeId.replace(/^F\d+_/, '');
}

function prefixedId(rawName) {
  const p = `F${currentFloorNumber}_`;
  return rawName.startsWith(p) ? rawName : p + rawName;
}

const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x1a1a1a, 1);
document.getElementById('viewer').appendChild(renderer.domElement);

const ambientLight     = new THREE.AmbientLight(0x404040, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
directionalLight.position.set(0, 1000, 100);
scene.add(directionalLight);

const loader = new THREE.GLTFLoader();
let gltfScene        = null;
let currentModelRoot = null;

const MODELS = [
  { labels: 'Floor 1', file: '../models/floor1.glb' },
  { labels: 'Floor 2', file: '../models/floor2s.glb' },
  { labels: 'Floor 3', file: '../models/floor3.glb' },
  { labels: 'Floor 4', file: '../models/floor4s.glb' },
  { labels: 'Floor 5', file: '../models/floor5s.glb' },
  { labels: 'Floor 6', file: '../models/floor6s.glb' },
];
window.MODELS = MODELS;

let graph            = {};   
let connectionPoints = {};   
let nodes            = [];   

let currentFloorNumber = 1;

let routeFollowRafId   = null;
let movingPin          = null;
let routeFollowPoints  = null;
let routeFollowStartTs = 0;
const routeFollowTotalMs = 6000;
let   routeFloorOrder    = [];   
let   routeSegments      = {};   
let   routeIsFinalFloor  = true; 

function activateFloorData(floorNum) {
  const data = (window.FLOOR_DATA || {})[floorNum];
  if (!data) {
    console.warn(`activateFloorData: no data for floor ${floorNum}`);
    graph            = {};
    connectionPoints = {};
    nodes            = [];
    return;
  }

  currentFloorNumber = floorNum;
  graph              = data.graph            || {};
  connectionPoints   = data.connectionPoints || {};
  nodes              = Array.from(new Set(Object.keys(connectionPoints)));

  rebuildAutocomplete();
}

function getFloorNumberFromURL() {
  const p = (window.location.pathname || '').toLowerCase();
  const m = p.match(/(room|floor)([1-6])\.html/);
  return m ? Number(m[2]) : 1;
}

function setModelByIndex(modelIndex) {
  const idx      = Math.max(0, Math.min(MODELS.length - 1, Number(modelIndex) || 0));
  const floorNum = idx + 1;           

  // keep floor button highlighted while routing switches floors
  window.__highlightActiveFloor?.(floorNum);

  const file     = MODELS[idx]?.file;
  if (!file) return;

  clearAllFloorOverlays();

  if (currentModelRoot) {
    scene.remove(currentModelRoot);
    currentModelRoot = null;
  }
  gltfScene = null;

  activateFloorData(floorNum);

  loader.load(
    file,
    function (gltf) {
      gltfScene        = gltf.scene;
      currentModelRoot = gltf.scene;
      scene.add(gltf.scene);

      const box    = new THREE.Box3().setFromObject(gltf.scene);
      const center = box.getCenter(new THREE.Vector3());
      gltf.scene.position.sub(center);
      camera.position.set(0, 920, box.getSize(new THREE.Vector3()).length() * 1.5);

      gltfScene.traverse((child) => {
        if (child.isMesh) {
          if (child.material?.color) child.originalColor = child.material.color.clone();
          if (child.material)         child.material = child.material.clone();
        }
      });

      highlightConnectionPoints();

      try {
        const allSegs = sessionStorage.getItem('allFloorSegments');
        if (allSegs) {
          const segsMap    = JSON.parse(allSegs);
          const seg        = segsMap[floorNum];
          
          const floorKeys  = Object.keys(segsMap).map(Number).sort((a, b) => a - b);
          const isFinal    = floorKeys[floorKeys.length - 1] === floorNum;
          if (seg && seg.length) {
            sessionStorage.setItem('latestPath', JSON.stringify(seg));
            
            routeFloorOrder   = floorKeys;
            routeSegments     = segsMap;
            routeIsFinalFloor = isFinal;
            highlightPath(seg, isFinal);
          }
        } else {
          const latest = sessionStorage.getItem('latestPath');
          if (latest) {
            const path     = JSON.parse(latest);
            const filtered = (path || []).filter((id) => nodes.includes(id));
            if (filtered.length) highlightPath(filtered, true);
          }
        }
      } catch {  }
    },
    undefined,
    function (error) { console.error('GLTFLoader error', error); }
  );
}

window.__setFloorModel = setModelByIndex;

function setModelByFile(file) {
  const idx = MODELS.findIndex((m) => m.file === file);
  setModelByIndex(idx === -1 ? 0 : idx);
}

setModelByFile(MODELS[Math.max(0, getFloorNumberFromURL() - 1)].file);

function createTextSprite(text) {
  const canvas  = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width  = 512;
  canvas.height = 256;

  context.beginPath();
  context.arc(30, 64, 20, 0, 2 * Math.PI);
  context.fillStyle = 'rgba(255,255,255,0.8)';
  context.fill();

  context.font      = 'Bold 50px Arial';
  context.fillStyle = 'rgba(255,255,255,1)';
  context.fillText(text, 60, 80);

  const texture       = new THREE.CanvasTexture(canvas);
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
  const sprite        = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(24, 10, 1);
  return sprite;
}

function clearAllFloorOverlays() {
  stopRouteFollow();
  for (let i = scene.children.length - 1; i >= 0; i--) {
    const obj = scene.children[i];
    if (!obj) continue;
    const n = obj.name || '';
    if (
      n.startsWith('highlight_') ||
      n.startsWith('label_')     ||
      n === 'pathLinesGroup'
    ) {
      scene.remove(obj);
    }
  }
}

function highlightConnectionPoints() {
  
  clearAllFloorOverlays();

  const sphereGeometry = new THREE.SphereGeometry(0.8, 10, 10);
  const sphereMaterial = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0,
  });

  const excludeSuffixes = ['B2.up', 'B2.down', 'B4.up', 'B4.down'];

  Object.entries(connectionPoints).forEach(([roomId, pos]) => {
    const sphere = new THREE.Mesh(sphereGeometry.clone(), sphereMaterial.clone());
    sphere.position.set(pos.x, pos.y, pos.z || 0);
    sphere.name = `highlight_${roomId}`;
    scene.add(sphere);

    const dName   = displayName(roomId);   
    const isHall  = dName.startsWith('Hallway');
    const isSkip  = excludeSuffixes.some((s) => dName.endsWith(s));

    if (!isHall && !isSkip) {
      const label = createTextSprite(dName);   
      label.position.set(pos.x + 10, pos.y + 10, pos.z || 0);
      label.name = `label_${roomId}`;
      scene.add(label);
    }

    //     const label = createTextSprite(displayName(roomId));
    // label.position.set(pos.x + 10, pos.y + 10, pos.z || 0);
    // label.name = `label_${roomId}`;
    // scene.add(label);
  });
}

function findShortestPath(start, end) {
  if (start === end) return [start];
  if (!nodes.includes(start) || !nodes.includes(end)) return null;

  const queue   = [[start, [start]]];
  const visited = new Set([start]);

  while (queue.length > 0) {
    const [current, path] = queue.shift();
    for (const neighbor of graph[current] || []) {
      if (neighbor === end) return [...path, neighbor];
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([neighbor, [...path, neighbor]]);
      }
    }
  }
  return null;
}

function getConnectionPoint(roomId) {
  
  if (connectionPoints[roomId]) return connectionPoints[roomId];
  
  for (let f = 1; f <= 6; f++) {
    const cp = (window.FLOOR_DATA || {})[f]?.connectionPoints?.[roomId];
    if (cp) return cp;
  }
  return null;
}

function buildMultiFloorGraph() {
  const mega = {};

  for (let f = 1; f <= 6; f++) {
    const data = (window.FLOOR_DATA || {})[f];
    if (!data) continue;
    for (const [node, neighbours] of Object.entries(data.graph)) {
      mega[node] = [...neighbours];
    }
  }

  for (let f = 1; f <= 6; f++) {
    for (const stair of STAIR_NODES) {
      const here = `F${f}_${stair}`;
      if (!mega[here]) continue;

      const isUp   = stair === 'B2.up'   || stair === 'B4.up';
      const isDown = stair === 'B2.down' || stair === 'B4.down';

      const targetFloor = isUp ? f + 1 : isDown ? f - 1 : null;
      if (!targetFloor || targetFloor < 1 || targetFloor > 6) continue;

      const there = `F${targetFloor}_${stair}`;
      if (!(window.FLOOR_DATA || {})[targetFloor]?.graph[there]) continue;

      if (!mega[here]) mega[here] = [];
      if (!mega[here].includes(there)) mega[here].push(there);

    }
  }

  return mega;
}

function findMultiFloorPath(start, end) {
  if (start === end) return [start];
  const mega = buildMultiFloorGraph();
  if (!mega[start] || !mega[end]) return null;

  const queue   = [[start, [start]]];
  const visited = new Set([start]);

  while (queue.length > 0) {
    const [current, path] = queue.shift();
    for (const neighbor of mega[current] || []) {
      if (neighbor === end) return [...path, neighbor];
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([neighbor, [...path, neighbor]]);
      }
    }
  }
  return null;
}

function groupPathByFloor(path) {
  const segments = {};
  for (const nodeId of path) {
    const m = nodeId.match(/^F(\d+)_/);
    if (!m) continue;
    const f = Number(m[1]);
    if (!segments[f]) segments[f] = [];
    segments[f].push(nodeId);
  }
  return segments;
}

function multiFloorLabel(nodeId, nextNodeId) {
  const m = nodeId.match(/^F(\d+)_(.+)$/);
  if (!m) return nodeId;
  const [, floorNum, rawName] = m;
  if (STAIR_NODES.includes(rawName) && nextNodeId) {
    const nm = nextNodeId.match(/^F(\d+)_/);
    if (nm && nm[1] !== floorNum) {
      return `${rawName} (Floor ${floorNum}→${nm[1]})`;
    }
  }
  
  const cp = (window.FLOOR_DATA || {})[Number(floorNum)]?.connectionPoints?.[nodeId];
  return cp?.displayName || rawName;
}

function buildPathSummary(fullPath) {
  if (!fullPath || fullPath.length === 0) return 'No path found.';
  const parts = [];
  for (let i = 0; i < fullPath.length; i++) {
    const id   = fullPath[i];
    const next = fullPath[i + 1] || null;
    const m    = id.match(/^F(\d+)_(.+)$/);
    if (!m) continue;
    const [, floorNum, rawName] = m;
    const isHall   = rawName.startsWith('Hallway');
    const isStair  = STAIR_NODES.includes(rawName);
    const isStart  = i === 0;
    const isEnd    = i === fullPath.length - 1;
    const isFloorChange = isStair && next && next.match(/^F(\d+)_/)?.[1] !== floorNum;

    if (isStart || isEnd || isFloorChange || (!isHall && !isStair)) {
      parts.push(multiFloorLabel(id, next));
    }
  }
  return parts.join(' → ');
}

function renderFloorStepGuide(fullPath) {
  const el = document.getElementById('floorSteps');
  if (!el) return;

  if (!fullPath || fullPath.length === 0) { el.innerHTML = ''; return; }

  const segments = groupPathByFloor(fullPath);
  const floors   = Object.keys(segments).map(Number).sort((a, b) => a - b);

  let html = '<ol style="margin:0;padding-left:1.2em;">';
  for (let i = 0; i < floors.length; i++) {
    const f    = floors[i];
    const seg  = segments[f];
    const last = seg[seg.length - 1];
    const next = floors[i + 1];

    const firstLabel = multiFloorLabel(seg[0], seg[1]);
    let stepText = `<strong>Floor ${f}:</strong> Start at ${firstLabel}`;

    if (next) {
      
      const stairNode = seg.find(n => STAIR_NODES.includes(n.replace(/^F\d+_/, '')));
      const stairName = stairNode ? stairNode.replace(/^F\d+_/, '') : 'staircase';
      stepText += ` → Take <em>${stairName}</em> to Floor ${next}`;
    } else {
      const destLabel = multiFloorLabel(last, null);
      stepText += ` → Arrive at <strong>${destLabel}</strong>`;
    }

    html += `<li style="margin-bottom:4px;">${stepText}</li>`;
  }
  html += '</ol>';
  el.innerHTML = html;
}

function stopRouteFollow() {
  if (routeFollowRafId !== null) {
    cancelAnimationFrame(routeFollowRafId);
    routeFollowRafId = null;
  }
  routeFollowPoints  = null;
  routeFollowStartTs = 0;
}

function clearPathLines() {
  stopRouteFollow();
  const existing = scene.getObjectByName('pathLinesGroup');
  if (existing) scene.remove(existing);
}

function resetHighlights() {
  if (!gltfScene) return;
  gltfScene.traverse((child) => {
    if (child.isMesh && nodes.includes(child.name) && child.originalColor && child.material?.color) {
      child.material.color.copy(child.originalColor);
    }
  });
}

function createPinMesh(color) {
  const pinGroup = new THREE.Group();

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(2, 16, 16),
    new THREE.MeshBasicMaterial({ color })
  );
  head.position.y = 3.75;
  pinGroup.add(head);

  const point = new THREE.Mesh(
    new THREE.ConeGeometry(2, 8, 16),
    new THREE.MeshBasicMaterial({ color })
  );
  point.position.y = -0.5;
  point.rotateX(Math.PI);
  pinGroup.add(point);

  return pinGroup;
}

function drawPathLines(path, isFinalFloor) {
  clearPathLines();
  if (!path || path.length < 2) return;

  const pathGroup = new THREE.Group();
  pathGroup.name  = 'pathLinesGroup';
  scene.add(pathGroup);

  const yOffset  = 1;
  const points   = [];
  for (const roomId of path) {
    const pt = getConnectionPoint(roomId);
    if (pt) points.push(new THREE.Vector3(pt.x, pt.y + yOffset, pt.z || 0));
  }
  if (points.length < 2) return;

  const startPin = createPinMesh(0x22c55e);
  startPin.position.copy(points[0]);
  startPin.position.y += 4;
  pathGroup.add(startPin);

  const endPin = createPinMesh(0xff0000);
  endPin.position.copy(points[points.length - 1]);
  endPin.position.y += 4;
  pathGroup.add(endPin);

  movingPin          = startPin;
  routeFollowPoints  = points.slice();

  const dashLength   = 2;
  const gapLength    = 2;
  const radius       = 0.5;
  const dashMaterial = new THREE.MeshBasicMaterial({ color: 0x0ea5a4, transparent: true, opacity: 1 });

  for (let i = 0; i < points.length - 1; i++) {
    const segStart    = points[i];
    const segEnd      = points[i + 1];
    const direction   = new THREE.Vector3().subVectors(segEnd, segStart);
    const totalLength = direction.length();
    direction.normalize();

    let dist = 0;
    while (dist < totalLength) {
      const dStart  = segStart.clone().add(direction.clone().multiplyScalar(dist));
      const actual  = Math.min(dashLength, totalLength - dist);
      if (actual > 0) {
        const dEnd = dStart.clone().add(direction.clone().multiplyScalar(actual));
        const geo  = new THREE.CylinderGeometry(radius, radius, actual, 8);
        const mesh = new THREE.Mesh(geo, dashMaterial);
        mesh.position.copy(dStart.clone().add(dEnd).multiplyScalar(0.5));
        mesh.lookAt(dEnd);
        mesh.rotateX(Math.PI / 2);
        pathGroup.add(mesh);
      }
      dist += dashLength + gapLength;
    }
  }

  startRouteFollow(points, isFinalFloor !== false); 
}

function startRouteFollow(points, isFinalFloor) {
  stopRouteFollow();
  if (!movingPin || !points || points.length < 2) return;

  const routePoints = points.slice();

  const destId = window.__lastRouteDestId || null;

  const segLengths  = [];

  let   totalLen    = 0;
  for (let i = 0; i < routePoints.length - 1; i++) {
    const len = routePoints[i].distanceTo(routePoints[i + 1]);
    segLengths.push(len);
    totalLen += len;
  }

  routeFollowStartTs = performance.now();

  const moveStep = (ts) => {
    if (!movingPin) return;   

    const elapsed    = ts - routeFollowStartTs;
    const t          = Math.min(1, elapsed / routeFollowTotalMs);
    const targetDist = totalLen * t;

    let accum = 0;
    for (let i = 0; i < segLengths.length; i++) {
      const next = accum + segLengths[i];
      if (targetDist <= next || i === segLengths.length - 1) {
        const localT = segLengths[i] === 0
          ? 0
          : Math.min(1, (targetDist - accum) / segLengths[i]);
        movingPin.position.copy(
          routePoints[i].clone().lerp(routePoints[i + 1] ?? routePoints[i], localT)
        );
        break;
      }
      accum = next;
    }

    if (t < 1) {
      
      routeFollowRafId = requestAnimationFrame(moveStep);
    } else {
      
      movingPin.position.copy(routePoints[routePoints.length - 1]);

      if (isFinalFloor) {
        stopRouteFollow();
        const destLabel = getRouteDestLabel();
        showRouteModal('Destination reached', destLabel ? `You have arrived at ${destLabel}.` : 'You have arrived at your destination.');
      } else { 
        stopRouteFollow();
        // jump floors
        const lastFloor  = routeFloorOrder[routeFloorOrder.length - 1];
        setTimeout(() => setModelByIndex(lastFloor - 1), 400);
      }
    }
  };

  movingPin.position.copy(points[0]);
  routeFollowRafId = requestAnimationFrame(moveStep);
}

function getRouteDestLabel() {
  const destId = window.__lastRouteDestId;
  if (!destId) return '';
  return displayName(destId);
}


function showRouteModal(title, message) {
  const modal = document.getElementById('routeModal');
  const modalTitle = document.getElementById('routeModalTitle');
  const modalBody = document.getElementById('routeModalBody');
  const closeBtn = document.getElementById('routeModalClose');
  const okBtn = document.getElementById('routeModalOk');

  if (!modal || !modalTitle || !modalBody) {
    alert(`${title}: ${message}`);
    return;
  }

  modalTitle.textContent = title || 'Message';
  modalBody.textContent = message || '';

  modal.style.display = 'block';
  modal.setAttribute('aria-hidden', 'false');

  const hide = () => {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  };

  modal.removeEventListener('click', routeModalBackdropHandler);
  modal.removeEventListener('click', routeModalBackdropHandler);

  window.routeModalBackdropHandler = (e) => {
    if (e.target === modal) hide();
  };

  modal.addEventListener('click', window.routeModalBackdropHandler);

  okBtn?.addEventListener('click', hide, { once: true });
  closeBtn?.addEventListener('click', hide, { once: true });
}

function highlightPath(path, isFinalFloor) {

  resetHighlights();
  clearPathLines();

  if (!path || path.length === 0) {
    const el = document.getElementById('pathInfo');
    if (el) el.textContent = 'No path found.';
    return;
  }

  path.forEach((room) => {
    const obj = gltfScene?.getObjectByName(room);
    if (obj?.isMesh && obj.material?.color) obj.material.color.set();
  });

  drawPathLines(path, isFinalFloor);
  const el = document.getElementById('pathInfo');
  if (el) el.textContent = `Shortest path: ${path.map(displayName).join(' → ')}`;
}

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping     = true;
controls.dampingFactor     = 0.05;
controls.screenSpacePanning = false;
controls.minDistance       = 1;
controls.maxDistance       = 500;
controls.maxPolarAngle     = Math.PI / 2;

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function rebuildAutocomplete() {
  let datalist = document.getElementById('roomList');
  if (!datalist) {
    datalist    = document.createElement('datalist');
    datalist.id = 'roomList';
    document.body.appendChild(datalist);
  }
  datalist.innerHTML = '';

  const seen = new Set();

  for (let f = 1; f <= 6; f++) {
    const data = (window.FLOOR_DATA || {})[f];
    if (!data) continue;

    Object.entries(data.connectionPoints).forEach(([nodeId, pos]) => {
      const dName = pos.displayName || nodeId.replace(/^F\d+_/, '');
      if (dName.startsWith('Hallway')) return;
      if (STAIR_NODES.some(s => dName === s || dName.endsWith(s))) return;
      if (dName === 'Entrance' || dName === 'Exit') return;

      const key = `${dName}|F${f}`;
      if (seen.has(key)) return;
      seen.add(key);

      const opt         = document.createElement('option');
      opt.value         = dName;
      opt.dataset.id    = nodeId;
      opt.dataset.floor = f;
      datalist.appendChild(opt);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  
  rebuildAutocomplete();

  const fromInput = document.getElementById('fromInput');
  const toInput   = document.getElementById('toInput');

  fromInput?.setAttribute('list', 'roomList');
  toInput?.setAttribute('list',   'roomList');

  try {
    const saved = sessionStorage.getItem('multiFloorPath');
    if (saved) {
      const fullPath = JSON.parse(saved);
      if (Array.isArray(fullPath) && fullPath.length) {
        applyMultiFloorPath(fullPath);
        window.__highlightActiveFloor?.(destFloor);  // in case we reload different floor
      }
    }
  } catch {  }

  document.getElementById('reset')?.addEventListener('click', () => {
    if (fromInput) fromInput.value = '';
    if (toInput)   toInput.value   = '';
    const info = document.querySelector('.info');
    if (info) info.textContent = 'Enter From and To rooms, then search.';
    const pathInfo = document.getElementById('pathInfo');
    if (pathInfo) pathInfo.textContent = '';
    const stepsEl = document.getElementById('floorSteps');
    if (stepsEl) stepsEl.innerHTML = '';
    resetHighlights();
    clearPathLines();
    sessionStorage.removeItem('multiFloorPath');
    sessionStorage.removeItem('latestPath');
    sessionStorage.removeItem('allFloorSegments');
    routeFloorOrder   = [];
    routeSegments     = {};
    routeIsFinalFloor = true;
  });

  document.getElementById('searchBtn')?.addEventListener('click', runSearch);
  toInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') runSearch();
  });
});

function runSearch() {
  const fromInput = document.getElementById('fromInput');
  const toInput   = document.getElementById('toInput');
  const rawFrom   = fromInput?.value.trim();
  const rawTo     = toInput?.value.trim();

  if (!rawFrom || !rawTo) { alert('Please enter both From and To rooms.'); return; }

  let from = null;
  for (let f = 1; f <= 6; f++) {
    const candidate = `F${f}_${rawFrom}`;
    if ((window.FLOOR_DATA || {})[f]?.connectionPoints?.[candidate]) {
      from = candidate;
      break;
    }
  }
  
  if (!from && rawFrom.toLowerCase() === 'entrance') from = 'F1_Entrance';

  if (!from) {
    alert(`Starting room "${rawFrom}" was not found on any floor. Please check the spelling.`);
    return;
  }

  let to = null;
  for (let f = 1; f <= 6; f++) {
    const candidate = `F${f}_${rawTo}`;
    if ((window.FLOOR_DATA || {})[f]?.connectionPoints?.[candidate]) {
      to = candidate;
      break;
    }
  }
  if (!to && rawTo.toLowerCase() === 'entrance') to = 'F1_Entrance';

  if (!to) {
    alert(`Destination room "${rawTo}" was not found on any floor. Please check the spelling.`);
    return;
  }

  if (from === to) {
    alert('Your starting room and destination are the same!');
    return;
  }

  const fullPath = findMultiFloorPath(from, to);

  if (!fullPath || fullPath.length === 0) {
    const pathInfo = document.getElementById('pathInfo');
    if (pathInfo) pathInfo.textContent = `No path found between "${rawFrom}" and "${rawTo}".`;
    return;
  }

  sessionStorage.setItem('multiFloorPath', JSON.stringify(fullPath));
  applyMultiFloorPath(fullPath);
}

function applyMultiFloorPath(fullPath) {
  const startId    = fullPath[0];
  const destId     = fullPath[fullPath.length - 1];
  const startFloor = Number(startId.match(/^F(\d+)_/)?.[1] || 1);
  const destFloor  = Number(destId.match(/^F(\d+)_/)?.[1] || 1);
  const segments   = groupPathByFloor(fullPath);

  sessionStorage.setItem('allFloorSegments', JSON.stringify(segments));

  const pathInfo = document.getElementById('pathInfo');
  if (pathInfo) {
    const summary  = buildPathSummary(fullPath);
    const floors   = Object.keys(segments).map(Number).sort((a, b) => a - b);
    const floorTag = floors.length > 1
      ? ` [Floors ${floors.join('→')}]`
      : ` [Floor ${floors[0]}]`;
    pathInfo.textContent = summary + floorTag;
  }

  // Save destination so we can show it when the animation finishes (final floor)
  window.__lastRouteDestId = destId;

  // Start label (From room)
  window.__lastRouteStartId = startId;

  showRouteModal('Route started', `From ${displayName(startId)}. Destination: ${displayName(destId)}.`);

  renderFloorStepGuide(fullPath);

  window.__highlightActiveFloor?.(destFloor);

  const floorOrder = Object.keys(segments).map(Number).sort((a, b) => a - b);
  routeFloorOrder  = floorOrder;
  routeSegments    = segments;

  if (startFloor === destFloor) {
    
    routeIsFinalFloor = true;
    const seg = segments[startFloor] || [];
    sessionStorage.setItem('latestPath', JSON.stringify(seg));
    if (currentFloorNumber !== startFloor) {
      setModelByIndex(startFloor - 1);
    } else {
      highlightPath(seg, true);
    }
    return;
  }

  routeIsFinalFloor = false;
  const sourceSeg = segments[startFloor] || [];
  sessionStorage.setItem('latestPath', JSON.stringify(sourceSeg));

  if (currentFloorNumber !== startFloor) {
    setModelByIndex(startFloor - 1);
  } else {
    
    highlightPath(sourceSeg, false);
  }
}
