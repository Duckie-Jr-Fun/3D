import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js';

const video = document.querySelector('#camera');
const sensorStatus = document.querySelector('#sensor-status');
const orientationLabel = document.querySelector('#orientation');
const panel = document.querySelector('#panel');
const note = document.querySelector('#note');
const saved = document.querySelector('#saved');
let scene, camera, renderer, roomAnchor, initialSensorQuaternion = null, hasOrientation = false;
const menuNode = document.querySelector('.menu-node');
const menuPanel = document.querySelector('#panel');
const menuWorldPosition = new THREE.Vector3(0, 0, -2.6);
const sensorEuler = new THREE.Euler();
const sensorQuaternion = new THREE.Quaternion();
const zee = new THREE.Vector3(0, 0, 1);
const q0 = new THREE.Quaternion(-Math.sqrt(.5), 0, 0, Math.sqrt(.5));

function addBeam(start, end, radius = .035, color = 0x70f3d1, opacity = .75) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), 8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity })
  );
  beam.position.copy(start).add(end).multiplyScalar(.5);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  scene.add(beam);
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

  const major = [
    [new THREE.Vector3(-2, -1.48, -4), new THREE.Vector3(-2, -1.48, 4)],
    [new THREE.Vector3(2, -1.48, -4), new THREE.Vector3(2, -1.48, 4)],
    [new THREE.Vector3(-4, -1.48, -2), new THREE.Vector3(4, -1.48, -2)],
    [new THREE.Vector3(-4, -1.48, 2), new THREE.Vector3(4, -1.48, 2)],
    [new THREE.Vector3(-4, .75, -2), new THREE.Vector3(4, .75, -2)],
    [new THREE.Vector3(-4, 2, -2), new THREE.Vector3(4, 2, -2)]
  ];
  major.forEach(([start, end]) => addBeam(start, end, .025, 0x70f3d1, .5));
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
    new THREE.LineBasicMaterial({ color: 0x70f3d1, transparent: true, opacity: .08 })
  );
  grid.position.copy(position);
  grid.rotation.set(rotation.x, rotation.y, rotation.z);
  scene.add(grid);
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
  const floor = new THREE.GridHelper(8, 8, 0x70f3d1, 0x70f3d1);
  floor.material.transparent = true;
  floor.material.opacity = .12;
  floor.position.y = -1.5;
  scene.add(floor);
  const ceiling = floor.clone();
  ceiling.position.y = 3;
  ceiling.material = floor.material.clone();
  ceiling.material.opacity = .045;
  scene.add(ceiling);
  addWallGrid(8, 4.5, new THREE.Vector3(-4, .75, 0), new THREE.Euler(0, Math.PI / 2, 0));
  addWallGrid(8, 4.5, new THREE.Vector3(4, .75, 0), new THREE.Euler(0, Math.PI / 2, 0));
  addWallGrid(8, 4.5, new THREE.Vector3(0, .75, -4), new THREE.Euler(0, 0, 0));
  const roomFrame = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(-4, -1.5, -4), new THREE.Vector3(4, 3, 4)), 0x70f3d1);
  roomFrame.visible = false;
  scene.add(roomFrame);
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
    camera.quaternion.slerp(camera.userData.targetQuaternion, .1);
    camera.updateMatrixWorld();
    const projected = roomAnchor.position.clone().project(camera);
    const visible = !hasOrientation || (projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1.15 && Math.abs(projected.y) < 1.15);
    menuNode.style.display = visible ? 'grid' : 'none';
    menuPanel.style.visibility = visible ? 'visible' : 'hidden';
    if (visible) {
      menuNode.style.left = `${(projected.x * .5 + .5) * innerWidth}px`;
      menuNode.style.top = `${(-projected.y * .5 + .5) * innerHeight}px`;
      menuPanel.style.left = `${(projected.x * .5 + .5) * innerWidth}px`;
      menuPanel.style.top = `${(-projected.y * .5 + .5) * innerHeight}px`;
    }
  }
  renderer.render(scene, camera);
}

async function enter() {
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
  } catch (error) {
    saved.textContent = 'Camera unavailable - spatial mode still active.';
  }
  if (screen.orientation?.lock) screen.orientation.lock('landscape').catch(() => {});
  if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
    try { await DeviceOrientationEvent.requestPermission(); } catch (error) { /* permission can be granted later */ }
  }
  window.addEventListener('deviceorientation', trackTilt, true);
  sensorStatus.textContent = 'SENSOR READY';
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
  if (!initialSensorQuaternion) {
    initialSensorQuaternion = sensorQuaternion.clone();
    sensorStatus.textContent = 'ZERO LOCKED';
  }
  const relativeQuaternion = initialSensorQuaternion.clone().invert().multiply(sensorQuaternion);
  camera.userData.targetQuaternion.copy(relativeQuaternion);
  orientationLabel.textContent = `${innerWidth > innerHeight ? 'LANDSCAPE' : 'PORTRAIT'} / ZERO ${Math.round(event.alpha || 0)}°`;
}

document.querySelector('#menu-button').addEventListener('click', () => { panel.classList.add('open'); setTimeout(() => note.focus(), 250); });
document.querySelector('#close').addEventListener('click', () => panel.classList.remove('open'));
document.querySelector('#entry').addEventListener('submit', (event) => { event.preventDefault(); if (!note.value.trim()) return; saved.textContent = `NOTE PLACED: “${note.value.trim()}”`; note.value = ''; });
addEventListener('resize', () => { if (camera) { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); } });
setupSpace();
enter();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=3').catch(() => {});
