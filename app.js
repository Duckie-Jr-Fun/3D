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
const menuWorldPosition = new THREE.Vector3(0, 0, -4.5);
const sensorEuler = new THREE.Euler();
const sensorQuaternion = new THREE.Quaternion();
const zee = new THREE.Vector3(0, 0, 1);
const q0 = new THREE.Quaternion(-Math.sqrt(.5), 0, 0, Math.sqrt(.5));

function setupSpace() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, .1, 100);
  camera.position.set(0, 0, 0);
  camera.userData.targetQuaternion = new THREE.Quaternion();
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  document.querySelector('#space').appendChild(renderer.domElement);
  const floor = new THREE.GridHelper(12, 12, 0x70f3d1, 0x70f3d1);
  floor.material.transparent = true;
  floor.material.opacity = .12;
  floor.position.y = -2;
  scene.add(floor);
  const ceiling = floor.clone();
  ceiling.position.y = 4;
  ceiling.material = floor.material.clone();
  ceiling.material.opacity = .045;
  scene.add(ceiling);
  const wallGrid = new THREE.GridHelper(12, 12, 0x70f3d1, 0x70f3d1);
  wallGrid.material.transparent = true;
  wallGrid.material.opacity = .08;
  wallGrid.rotation.x = Math.PI / 2;
  wallGrid.position.set(-6, 1, 0);
  scene.add(wallGrid);
  const rightWall = wallGrid.clone();
  rightWall.position.x = 6;
  scene.add(rightWall);
  const backWall = wallGrid.clone();
  backWall.rotation.set(0, 0, 0);
  backWall.position.set(0, 1, -6);
  scene.add(backWall);
  const roomFrame = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(-6, -2, -6), new THREE.Vector3(6, 4, 6)), 0x70f3d1);
  roomFrame.material.transparent = true;
  roomFrame.material.opacity = .35;
  scene.add(roomFrame);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.11, 48), new THREE.MeshBasicMaterial({ color: 0x70f3d1, transparent: true, opacity: .5 }));
  ring.position.set(0, 0, -4.45);
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
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
