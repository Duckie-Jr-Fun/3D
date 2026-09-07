import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js';
import { CSS3DRenderer, CSS3DObject } from 'https://cdn.jsdelivr.net/npm/three@0.162.0/examples/jsm/renderers/CSS3DRenderer.js';

const video = document.querySelector('#camera');
const sensorStatus = document.querySelector('#sensor-status');
const orientationLabel = document.querySelector('#orientation');
const panel = document.querySelector('#panel');
const feedback = document.querySelector('#feedback');
let scene, camera, renderer, cssRenderer, roomAnchor, roomGroup, initialSensorQuaternion = null, hasOrientation = false;
let smoothingEnabled = true;
let cameraMode = 'rear';
let cameraEnabled = true;
let linesEnabled = true;
const menuNode = document.querySelector('.menu-node');
const menuPanel = document.querySelector('#panel');
const nestedPanel = document.querySelector('#nested-panel');
const videoWall = document.querySelector('#video-wall');
const youtubeFrame = document.querySelector('#youtube-frame');
const wallChoices = document.querySelector('#wall-choices');
const videoWallTitle = document.querySelector('#video-wall-title');
const cameraPermission = document.querySelector('#camera-permission');
const gazeCursor = document.querySelector('#gaze-cursor');
const resetZeroButton = document.querySelector('#reset-zero-button');
let pendingVideoId = null;
let activeVideoWall = 'back';
let resetZeroMode = false;
let dwellTarget = null;
let dwellTimer = null;
const dwellDuration = 1400;
const wallSurfaces = {
  back: { center: new THREE.Vector3(0, .75, -3.85), horizontal: new THREE.Vector3(3.35, 0, 0), vertical: new THREE.Vector3(0, 1.65, 0) },
  left: { center: new THREE.Vector3(-3.85, .75, 0), horizontal: new THREE.Vector3(0, 0, 3.35), vertical: new THREE.Vector3(0, 1.65, 0) },
  right: { center: new THREE.Vector3(3.85, .75, 0), horizontal: new THREE.Vector3(0, 0, -3.35), vertical: new THREE.Vector3(0, 1.65, 0) }
};
const menuWorldPosition = new THREE.Vector3(0, 0, -2.6);
const mainPanelWorldPosition = new THREE.Vector3(1.25, 0, -2.6);
const nestedPanelWorldPosition = new THREE.Vector3(-1.25, 0, -2.6);
const sensorEuler = new THREE.Euler();
const sensorQuaternion = new THREE.Quaternion();
const zee = new THREE.Vector3(0, 0, 1);
const q0 = new THREE.Quaternion(-Math.sqrt(.5), 0, 0, Math.sqrt(.5));
let menuObjects;

function projectToPixels(point) {
  const projected = point.clone().project(camera);
  return new THREE.Vector2(
    (projected.x * .5 + .5) * innerWidth,
    (-projected.y * .5 + .5) * innerHeight
  );
}

function updateVideoWallProjection() {
  const surface = wallSurfaces[activeVideoWall];
  const corners = [
    surface.center.clone().sub(surface.horizontal).add(surface.vertical),
    surface.center.clone().add(surface.horizontal).add(surface.vertical),
    surface.center.clone().add(surface.horizontal).sub(surface.vertical),
    surface.center.clone().sub(surface.horizontal).sub(surface.vertical)
  ].map(projectToPixels);
  const minX = Math.min(...corners.map(point => point.x));
  const maxX = Math.max(...corners.map(point => point.x));
  const minY = Math.min(...corners.map(point => point.y));
  const maxY = Math.max(...corners.map(point => point.y));
  const width = Math.max(120, maxX - minX);
  const height = Math.max(80, maxY - minY);
  const clip = corners.map(point => `${((point.x - minX) / width) * 100}% ${((point.y - minY) / height) * 100}%`).join(', ');
  videoWall.style.left = `${minX}px`;
  videoWall.style.top = `${minY}px`;
  videoWall.style.width = `${width}px`;
  videoWall.style.height = `${height}px`;
  videoWall.style.transform = 'none';
  videoWall.style.clipPath = `polygon(${clip})`;
  const centerDepth = surface.center.clone().project(camera).z;
  videoWall.style.visibility = centerDepth > -1 && centerDepth < 1 ? 'visible' : 'hidden';
}

function updateGazeTarget() {
  const target = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  const actionable = target?.closest('button, input, [data-wall]');
  const nextDwellTarget = actionable && actionable !== cameraPermission && !actionable.disabled && !actionable.closest('#gaze-cursor') ? actionable : null;
  if (nextDwellTarget === dwellTarget) return;
  clearTimeout(dwellTimer);
  gazeCursor.classList.remove('dwell');
  dwellTarget = nextDwellTarget;
  if (!dwellTarget) return;
  gazeCursor.style.setProperty('--dwell-time', `${dwellDuration}ms`);
  gazeCursor.classList.add('dwell');
  dwellTimer = setTimeout(() => {
    dwellTarget.click();
    gazeCursor.classList.remove('dwell');
    dwellTarget = null;
  }, dwellDuration);
}

function addBeam(start, end, radius = .035, color = 0x70f3d1, opacity = .75) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), 8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity })
  );
  beam.position.copy(start).add(end).multiplyScalar(.5);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  (roomGroup || scene).add(beam);
}

function addRoomStructure() {
  const min = new THREE.Vector3(-4, -1.5, -4);
  const max = new THREE.Vector3(4, 3, 4);
  const corners = [
    new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, max.z), new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, min.z), new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, max.z), new THREE.Vector3(min.x, max.y, max.z)
  ];
  [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
    .forEach(([start, end]) => addBeam(corners[start], corners[end], .055, 0x70f3d1, .9));

}

function addWallGrid(width, height, position, rotation) {
  const points = [];
  const divisions = 8;
  for (let index = 0; index <= divisions; index += 1) {
    const x = -width / 2 + (width * index) / divisions;
    const y = -height / 2 + (height * index) / divisions;
    points.push(-width / 2, y, 0, width / 2, y, 0);
    points.push(x, -height / 2, 0, x, height / 2, 0);
  }
  const grid = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)),
    new THREE.LineBasicMaterial({ color: 0x70f3d1, transparent: true, opacity: .13 })
  );
  grid.position.copy(position);
  grid.rotation.set(rotation.x, rotation.y, rotation.z);
  (roomGroup || scene).add(grid);
}

function setupSpace() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, .1, 100);
  camera.position.set(0, 0, 0);
  camera.userData.targetQuaternion = new THREE.Quaternion();
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  document.querySelector('#space').appendChild(renderer.domElement);
  cssRenderer = new CSS3DRenderer();
  cssRenderer.setSize(innerWidth, innerHeight);
  cssRenderer.domElement.className = 'css-world';
  document.querySelector('#space').appendChild(cssRenderer.domElement);
  menuObjects = [
    { element: menuNode, position: menuWorldPosition, scale: .01 },
    { element: menuPanel, position: mainPanelWorldPosition, scale: .0065 },
    { element: nestedPanel, position: nestedPanelWorldPosition, scale: .0065 }
  ];
  menuObjects.forEach(({ element, position, scale }) => {
    const object = new CSS3DObject(element);
    object.position.copy(position);
    object.scale.setScalar(scale);
    scene.add(object);
  });
  roomGroup = new THREE.Group();
  scene.add(roomGroup);
  const floor = new THREE.GridHelper(8, 8, 0x70f3d1, 0x70f3d1);
  floor.material.transparent = true;
  floor.material.opacity = .16;
  floor.position.y = -1.5;
  roomGroup.add(floor);
  const ceiling = floor.clone();
  ceiling.position.y = 3;
  ceiling.material = floor.material.clone();
  ceiling.material.opacity = .045;
  roomGroup.add(ceiling);
  addWallGrid(8, 4.5, new THREE.Vector3(-4, .75, 0), new THREE.Euler(0, Math.PI / 2, 0));
  addWallGrid(8, 4.5, new THREE.Vector3(4, .75, 0), new THREE.Euler(0, Math.PI / 2, 0));
  addWallGrid(8, 4.5, new THREE.Vector3(0, .75, -4), new THREE.Euler(0, 0, 0));
  const roomFrame = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(-4, -1.5, -4), new THREE.Vector3(4, 3, 4)), 0x70f3d1);
  roomFrame.visible = false;
  roomGroup.add(roomFrame);
  addRoomStructure();
  const menuBackdrop = new THREE.Mesh(
    new THREE.CircleGeometry(.709, 48),
    new THREE.MeshBasicMaterial({ color: 0x081017, transparent: true, opacity: .9 })
  );
  menuBackdrop.position.set(0, 0, -2.6);
  scene.add(menuBackdrop);
  const ring = new THREE.Mesh(new THREE.RingGeometry(.743, .776, 48), new THREE.MeshBasicMaterial({ color: 0x70f3d1, transparent: true, opacity: .75 }));
  ring.position.set(0, 0, -2.56);
  scene.add(ring);
  roomAnchor = new THREE.Object3D();
  roomAnchor.position.copy(menuWorldPosition);
  scene.add(roomAnchor);
  animate();
}

function animate() {
  requestAnimationFrame(animate);
  if (roomAnchor) {
    camera.quaternion.slerp(camera.userData.targetQuaternion, smoothingEnabled ? .1 : 1);
    camera.updateMatrixWorld();
    if (!videoWall.hidden) updateVideoWallProjection();
  }
  updateGazeTarget();
  renderer.render(scene, camera);
  cssRenderer.render(scene, camera);
}

async function enter() {
  try {
    await startCamera('rear');
    cameraPermission.hidden = true;
  } catch (error) {
    try {
      await startCamera('front');
      cameraPermission.hidden = true;
    } catch (fallbackError) {
      feedback.textContent = 'Camera unavailable - spatial mode still active.';
      cameraPermission.hidden = false;
    }
  }
  if (screen.orientation?.lock) screen.orientation.lock('landscape').catch(() => {});
  if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
    try { await DeviceOrientationEvent.requestPermission(); } catch (error) { /* permission can be granted later */ }
  }
  window.addEventListener('deviceorientation', trackTilt, true);
  sensorStatus.textContent = 'SENSOR READY';
}

async function startCamera(mode) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { exact: mode === 'rear' ? 'environment' : 'user' } },
    audio: false
  });
  video.srcObject?.getTracks().forEach(track => track.stop());
  video.srcObject = stream;
  cameraMode = mode;
  cameraEnabled = true;
  video.classList.toggle('front-camera', mode === 'front');
  return stream;
}

function requestCamera(mode) {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: mode === 'rear' ? 'environment' : 'user' } },
    audio: false
  });
}

function trackTilt(event) {
  hasOrientation = true;
  sensorEuler.set(
    THREE.MathUtils.degToRad(event.beta || 0),
    THREE.MathUtils.degToRad(event.alpha || 0),
    THREE.MathUtils.degToRad(-(event.gamma || 0)),
    'YXZ'
  );
  sensorQuaternion.setFromEuler(sensorEuler);
  sensorQuaternion.multiply(q0);
  sensorQuaternion.multiply(q0.clone().setFromAxisAngle(zee, -THREE.MathUtils.degToRad(screen.orientation?.angle || 0)));
  if (!initialSensorQuaternion || resetZeroMode) {
    initialSensorQuaternion = sensorQuaternion.clone();
    sensorStatus.textContent = 'ZERO LOCKED';
  }
  const relativeQuaternion = initialSensorQuaternion.clone().invert().multiply(sensorQuaternion);
  camera.userData.targetQuaternion.copy(relativeQuaternion);
  orientationLabel.textContent = `${innerWidth > innerHeight ? 'LANDSCAPE' : 'PORTRAIT'} / ZERO ${Math.round(event.alpha || 0)}°`;
}

document.querySelector('#menu-button').addEventListener('click', () => panel.classList.add('open'));
document.querySelector('#close').addEventListener('click', () => panel.classList.remove('open'));
const nestedTitle = document.querySelector('#nested-title');
const nestedMeta = document.querySelector('#nested-meta');
const youtubeTools = document.querySelector('#youtube-tools');
const settingsTools = document.querySelector('#settings-tools');
function openNestedPanel(title, meta) {
  nestedTitle.textContent = title;
  nestedMeta.textContent = meta;
  youtubeTools.hidden = title !== 'YouTube';
  settingsTools.hidden = title !== 'Settings';
  document.querySelector('#nested-panel').classList.add('open');
}
document.querySelector('#youtube-button').addEventListener('click', () => openNestedPanel('YouTube', 'VIDEO SPACE'));
document.querySelector('#settings-button').addEventListener('click', () => openNestedPanel('Settings', 'MY WORLD PREFERENCES'));
document.querySelector('#nested-close').addEventListener('click', () => document.querySelector('#nested-panel').classList.remove('open'));
document.querySelector('#youtube-entry').addEventListener('submit', (event) => {
  event.preventDefault();
  const url = document.querySelector('#youtube-url').value.trim();
  const videoId = /^[A-Za-z0-9_-]{11}$/.test(url) ? url : (url.match(/[?&]v=([A-Za-z0-9_-]{11})/) || url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/))?.[1];
  if (!videoId && !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
    feedback.textContent = 'PASTE A YOUTUBE LINK FIRST.';
    return;
  }
  pendingVideoId = videoId;
  wallChoices.hidden = false;
  feedback.textContent = 'CHOOSE A WALL FOR THE VIDEO.';
});
document.querySelector('#smoothing-button').addEventListener('click', (event) => {
  smoothingEnabled = !smoothingEnabled;
  event.currentTarget.textContent = `Sensor smoothing: ${smoothingEnabled ? 'On' : 'Off'}`;
});
document.querySelector('#camera-button').addEventListener('click', async (event) => {
  const nextMode = !cameraEnabled ? 'rear' : cameraMode === 'rear' ? 'front' : 'off';
  if (nextMode === 'off') {
    cameraEnabled = false;
    video.srcObject?.getTracks().forEach(track => track.stop());
    video.srcObject = null;
    video.classList.remove('front-camera');
    event.currentTarget.textContent = 'Camera: Off';
    feedback.textContent = 'CAMERA OFF. WORLD LINES STILL ACTIVE.';
    return;
  }
  cameraMode = nextMode;
  cameraEnabled = true;
  const stream = video.srcObject;
  stream?.getTracks().forEach(track => track.stop());
  try {
    await startCamera(cameraMode);
    event.currentTarget.textContent = `Camera: On / ${cameraMode === 'rear' ? 'Rear' : 'Front'}`;
    feedback.textContent = `${cameraMode === 'rear' ? 'REAR' : 'FRONT'} CAMERA ACTIVE.`;
  } catch (error) {
    cameraEnabled = false;
    cameraMode = 'off';
    feedback.textContent = 'CAMERA SWITCH FAILED.';
  }
});
document.querySelector('#lines-button').addEventListener('click', (event) => {
  linesEnabled = !linesEnabled;
  roomGroup.visible = linesEnabled;
  event.currentTarget.textContent = `World lines: ${linesEnabled ? 'On' : 'Off'}`;
  feedback.textContent = linesEnabled ? 'WORLD LINES ON.' : 'WORLD LINES OFF. MENU MARKINGS REMAIN.';
});
document.querySelector('#reset-zero-button').addEventListener('click', () => {
  resetZeroMode = !resetZeroMode;
  if (resetZeroMode) {
    initialSensorQuaternion = null;
    resetZeroButton.textContent = 'Reset zero point: On';
    resetZeroButton.classList.add('active');
    feedback.textContent = 'ZERO MODE ON. POINT PHONE FORWARD.';
  } else {
    resetZeroButton.textContent = 'Reset zero point: Off';
    resetZeroButton.classList.remove('active');
    feedback.textContent = 'ZERO MODE OFF.';
  }
});
wallChoices.querySelectorAll('[data-wall]').forEach(button => {
  button.addEventListener('click', () => {
    if (!pendingVideoId) return;
    const wall = button.dataset.wall;
    activeVideoWall = wall;
    youtubeFrame.src = `https://www.youtube.com/embed/${pendingVideoId}?autoplay=1&rel=0`;
    if (videoWallTitle) videoWallTitle.textContent = `YouTube / ${wall} wall`;
    videoWall.hidden = false;
    document.querySelector('#nested-panel').classList.remove('open');
    feedback.textContent = 'VIDEO PLACED IN YOUR WORLD.';
  });
});
document.querySelector('#video-wall-close').addEventListener('click', () => {
  youtubeFrame.src = '';
  videoWall.hidden = true;
});
addEventListener('resize', () => { if (camera) { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); cssRenderer.setSize(innerWidth, innerHeight); } });
setupSpace();
enter();
cameraPermission.addEventListener('click', enter);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=16').catch(() => {});
