import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js';
import { CSS3DRenderer, CSS3DObject } from 'https://cdn.jsdelivr.net/npm/three@0.162.0/examples/jsm/renderers/CSS3DRenderer.js';

const video = document.querySelector('#camera');
const vrVideo = document.querySelector('#vr-camera');
const space = document.querySelector('#space');
const gazeCursor = document.querySelector('#gaze-cursor');
const gazeCursorRight = document.querySelector('#gaze-cursor-right');
const cameraPermission = document.querySelector('#camera-permission');
const iframePlayer = document.querySelector('#iframe-player');
const dwellDuration = 1000;
let scene, rightScene, camera, renderer, cssRenderer, rightCssRenderer, initialSensorQuaternion = null;
let dwellTarget = null, dwellTimer = null, cameraMode = 'off';
let smoothingEnabled = true, stereoEnabled = false, resetOriginOnNextReading = false, movingAnchor = null, moveTimer = null, recenterTimer = null, recentering = false;
let sensorListening = false;
let appDistance = 2;
let iframeDistance = 2;
let iframeIsYoutube = false;
let calculatorExpression = '';
let calculatorResetOnDigit = false;
let lastInputPointerType = '';
const launcherDistance = 3;
let launcherAnchor = null;
const placementSlots = [
  { angle: 0, y: .85 },
  { angle: 0, y: .15 },
  { angle: 0, y: -.55 },
  { angle: 0, y: -1.25 },
  { angle: 0, y: -1.95 }
];
const sensorEuler = new THREE.Euler();
const sensorQuaternion = new THREE.Quaternion();
const screenAxis = new THREE.Vector3(0, 0, 1);
const sensorCorrection = new THREE.Quaternion(-Math.sqrt(.5), 0, 0, Math.sqrt(.5));
const appAnchors = new Map();
const appRegistry = new Map();

function updateGazeTarget() {
  if (movingAnchor) {
    clearTimeout(dwellTimer);
    gazeCursor.classList.remove('dwell');
    gazeCursorRight.classList.remove('dwell');
    dwellTarget = null;
    return;
  }
  const gazeX = stereoEnabled ? innerWidth * .25 : innerWidth / 2;
  const element = document.elementFromPoint(gazeX, innerHeight / 2);
  const actionable = element?.closest('[data-gaze], button, input, textarea');
  const nextTarget = actionable && !actionable.disabled && !actionable.closest('#gaze-cursor') ? actionable : null;
  if (nextTarget === dwellTarget) return;
  clearTimeout(dwellTimer);
  gazeCursor.classList.remove('dwell');
  gazeCursorRight.classList.remove('dwell');
  dwellTarget = nextTarget;
  if (!dwellTarget) return;
  gazeCursor.classList.add('dwell');
  gazeCursorRight.classList.add('dwell');
  dwellTimer = setTimeout(() => {
    if (dwellTarget) dwellTarget.click();
    gazeCursor.classList.remove('dwell');
    gazeCursorRight.classList.remove('dwell');
    dwellTarget = null;
  }, dwellDuration);
}

function startMove(appId) {
  const anchor = appAnchors.get(appId);
  if (!anchor) return;
  clearTimeout(moveTimer);
  anchor.userData.slotIndex = null;
  movingAnchor = anchor;
  anchor.element.classList.add('moving');
  anchor.userData.rightElement.classList.add('moving');
  moveTimer = setTimeout(() => {
    anchor.element.classList.remove('moving');
    anchor.userData.rightElement.classList.remove('moving');
    movingAnchor = null;
  }, 2500);
}

function createAppAnchor(element, position, scale = .006) {
  const object = new CSS3DObject(element);
  object.position.copy(position);
  object.scale.setScalar(scale);
  object.lookAt(camera.position);
  scene.add(object);
  const rightElement = element.cloneNode(true);
  rightElement.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  rightElement.removeAttribute('id');
  if (element.id === 'iframe-video' && iframeIsYoutube) rightElement.querySelector('iframe')?.removeAttribute('src');
  rightElement.setAttribute('aria-hidden', 'true');
  rightElement.style.pointerEvents = 'none';
  const rightObject = new CSS3DObject(rightElement);
  rightObject.position.copy(position);
  rightObject.scale.setScalar(scale);
  rightObject.lookAt(camera.position);
  rightScene.add(rightObject);
  object.userData.rightObject = rightObject;
  object.userData.rightElement = rightElement;
  return object;
}

function getAvailableSlot() {
  const occupied = new Set([...appAnchors.values()].map(anchor => anchor.userData.slotIndex).filter(index => index !== null));
  return placementSlots.findIndex((slot, index) => !occupied.has(index));
}

function placeInGaze(element, distance = 2.2, slotIndex = -1) {
  const direction = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  camera.getWorldDirection(direction);
  right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const slot = placementSlots[slotIndex] || { angle: 0, y: 0 };
  const angle = THREE.MathUtils.degToRad(slot.angle);
  const angledDirection = direction.clone().multiplyScalar(Math.cos(angle)).add(right.clone().multiplyScalar(Math.sin(angle))).normalize();
  const position = camera.position.clone().add(angledDirection.multiplyScalar(distance)).add(up.multiplyScalar(slot.y));
  const anchor = createAppAnchor(element, position, .0055);
  anchor.userData.slotIndex = slotIndex;
  return anchor;
}

function moveAnchorToDistance(anchor, distance, slotIndex = -1) {
  const direction = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  camera.getWorldDirection(direction);
  right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const slot = placementSlots[slotIndex] || { angle: 0, y: 0 };
  const angle = THREE.MathUtils.degToRad(slot.angle);
  const angledDirection = direction.clone().multiplyScalar(Math.cos(angle)).add(right.clone().multiplyScalar(Math.sin(angle))).normalize();
  const verticalOffset = slot.y + (anchor === launcherAnchor ? -.85 : 0);
  anchor.position.copy(camera.position).add(angledDirection.multiplyScalar(distance)).add(up.multiplyScalar(verticalOffset));
  anchor.lookAt(camera.position);
  anchor.userData.rightObject.position.copy(anchor.position);
  anchor.userData.rightObject.lookAt(camera.position);
}

function updateAppDistance(value) {
  appDistance = THREE.MathUtils.clamp(Number(value), 1, 10);
  document.querySelector('#app-distance-value').textContent = `${appDistance.toFixed(1)}m`;
  const settingsAnchor = appAnchors.get('settings');
  const rightValue = settingsAnchor?.userData.rightElement.querySelector('#app-distance-value');
  if (rightValue) rightValue.textContent = `${appDistance.toFixed(1)}m`;
  appAnchors.forEach((anchor, appId) => {
    if (appId !== 'iframe-video' && anchor.userData.slotIndex !== null) moveAnchorToDistance(anchor, appDistance, anchor.userData.slotIndex);
  });
}

function spawnApp(appId) {
  const definition = appRegistry.get(appId);
  if (!definition) return;
  const existing = appAnchors.get(appId);
  if (existing) {
    existing.element.classList.add('window-visible');
    existing.userData.rightElement.classList.add('window-visible');
    return;
  }
  const element = definition.element || document.getElementById(definition.elementId);
  if (!element) return;
  const slotIndex = getAvailableSlot();
  const anchor = placeInGaze(element, definition.distance ?? appDistance, slotIndex);
  element.classList.add('window-visible');
  anchor.userData.rightElement.classList.add('window-visible');
  appAnchors.set(appId, anchor);
  definition.onSpawn?.(element);
}

function closeApp(appId) {
  const anchor = appAnchors.get(appId);
  if (!anchor) return;
  if (appId === 'iframe-video') {
    anchor.element.querySelector('iframe')?.removeAttribute('src');
    anchor.userData.rightElement.querySelector('iframe')?.removeAttribute('src');
    iframeIsYoutube = false;
  }
  anchor.element.classList.remove('window-visible');
  anchor.userData.rightElement.classList.remove('window-visible');
  scene.remove(anchor);
  rightScene.remove(anchor.userData.rightObject);
  document.body.appendChild(anchor.element);
  appAnchors.delete(appId);
}

function recenterOrigin() {
  recentering = true;
  clearTimeout(recenterTimer);
  recenterTimer = setTimeout(() => { recentering = false; }, 2500);
}

function updateCameraLabel() {
  document.querySelectorAll('[data-camera-mode]').forEach(button => button.classList.toggle('selected', button.dataset.cameraMode === cameraMode));
}

async function setCameraMode(mode) {
  if (mode === 'off') {
    video.srcObject?.getTracks().forEach(track => track.stop());
    video.srcObject = null;
    vrVideo.srcObject = null;
    video.classList.remove('front-camera');
    cameraMode = 'off';
    updateCameraLabel();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: mode === 'rear' ? 'environment' : 'user' } }, audio: false });
    video.srcObject?.getTracks().forEach(track => track.stop());
    video.srcObject = stream;
    vrVideo.srcObject = stream;
    cameraMode = mode;
    video.classList.toggle('front-camera', mode === 'front');
    vrVideo.classList.toggle('front-camera', mode === 'front');
    updateCameraLabel();
    cameraPermission.hidden = true;
  } catch (error) {
    cameraMode = 'off';
    updateCameraLabel();
    cameraPermission.hidden = false;
  }
}

function setVrMode(enabled) {
  stereoEnabled = enabled;
  if (enabled && iframeIsYoutube) closeIframeVideo();
  document.body.classList.toggle('vr-mode', enabled);
  vrVideo.srcObject = enabled ? video.srcObject : null;
  const width = enabled ? innerWidth / 2 : innerWidth;
  cssRenderer.setSize(width, innerHeight);
  rightCssRenderer.setSize(width, innerHeight);
}

function closeIframeVideo() {
  const existing = appAnchors.get('iframe-video');
  if (existing) closeApp('iframe-video');
  iframePlayer.src = '';
}

async function requestSensorPermission() {
  if (sensorListening) return;
  if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
    try { await DeviceOrientationEvent.requestPermission(); } catch (error) { return; }
  }
  window.addEventListener('deviceorientation', trackTilt, true);
  sensorListening = true;
}

function trackTilt(event) {
  sensorEuler.set(THREE.MathUtils.degToRad(event.beta || 0), THREE.MathUtils.degToRad(event.alpha || 0), THREE.MathUtils.degToRad(-(event.gamma || 0)), 'YXZ');
  sensorQuaternion.setFromEuler(sensorEuler);
  sensorQuaternion.multiply(sensorCorrection);
  sensorQuaternion.multiply(new THREE.Quaternion().setFromAxisAngle(screenAxis, -THREE.MathUtils.degToRad(screen.orientation?.angle || 0)));
  if (!initialSensorQuaternion || resetOriginOnNextReading || recentering) {
    initialSensorQuaternion = sensorQuaternion.clone();
    resetOriginOnNextReading = false;
  }
  camera.userData.targetQuaternion.copy(initialSensorQuaternion.clone().invert().multiply(sensorQuaternion));
}

function setupApps() {
  appRegistry.set('settings', { elementId: 'settings-app', element: document.querySelector('#settings-app'), label: 'Settings' });
  appRegistry.set('library', { elementId: 'library-app', element: document.querySelector('#library-app'), label: 'App Library' });
  appRegistry.set('iframe', { elementId: 'iframe-app', element: document.querySelector('#iframe-app'), label: 'Iframe' });
  appRegistry.set('iframe-video', { elementId: 'iframe-video', element: document.querySelector('#iframe-video'), label: 'Embedded video', distance: 2.2 });
  appRegistry.set('calculator', { elementId: 'calculator-app', element: document.querySelector('#calculator-app'), label: 'Calculator' });
}

function normalizeVideoUrl(value) {
  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return `https://www.youtube.com/embed/${value}?autoplay=1&mute=1&playsinline=1&rel=0`;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL');
  if (url.hostname.includes('youtube.com') && url.pathname === '/watch') {
    const id = url.searchParams.get('v');
    if (id) return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0`;
  }
  if (url.hostname === 'youtu.be') {
    const id = url.pathname.slice(1);
    if (id) return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0`;
  }
  return url.href;
}

function isYoutubeVideo(value) {
  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.hostname.includes('youtube.com') || url.hostname === 'youtu.be';
  } catch (error) {
    return false;
  }
}

function setIframeSources(url) {
  iframePlayer.src = url;
  const iframeAnchor = appAnchors.get('iframe-video');
  const rightPlayer = iframeAnchor?.userData.rightElement.querySelector('iframe');
  if (!rightPlayer) return;
  if (iframeIsYoutube) rightPlayer.removeAttribute('src');
  else rightPlayer.src = url;
}

function openIframeVideo(event) {
  event.preventDefault();
  const urlField = document.querySelector('#iframe-url');
  let url;
  try {
    url = normalizeVideoUrl(urlField.value.trim());
  } catch (error) {
    urlField.setCustomValidity('Enter a valid video link.');
    urlField.reportValidity();
    return;
  }
  const nextIframeIsYoutube = isYoutubeVideo(urlField.value.trim());
  if (stereoEnabled && nextIframeIsYoutube) return;
  iframeIsYoutube = nextIframeIsYoutube;
  urlField.setCustomValidity('');
  const distance = iframeDistance;
  document.querySelector('#iframe-distance-value').textContent = `${distance.toFixed(1)}m`;
  appRegistry.get('iframe-video').distance = distance;
  const existing = appAnchors.get('iframe-video');
  if (existing) {
    setIframeSources(url);
    moveAnchorToDistance(existing, distance, existing.userData.slotIndex);
    existing.element.classList.add('window-visible');
    existing.userData.rightElement.classList.add('window-visible');
  } else {
    iframePlayer.src = url;
    spawnApp('iframe-video');
    setIframeSources(url);
  }
}

function updateIframeDistance(delta) {
  iframeDistance = THREE.MathUtils.clamp(Number((iframeDistance + delta).toFixed(1)), 1, 10);
  document.querySelector('#iframe-distance-value').textContent = `${iframeDistance.toFixed(1)}m`;
  const iframeAnchor = appAnchors.get('iframe');
  const rightValue = iframeAnchor?.userData.rightElement.querySelector('#iframe-distance-value');
  if (rightValue) rightValue.textContent = `${iframeDistance.toFixed(1)}m`;
}

function calculatorInput(type, value) {
  const display = document.querySelector('#calculator-display');
  if (type === 'clear') { calculatorExpression = ''; calculatorResetOnDigit = false; display.textContent = '0'; return; }
  if (type === 'backspace') { calculatorExpression = calculatorExpression.slice(0, -1); display.textContent = calculatorExpression || '0'; return; }
  if (type === 'digit' || type === 'decimal') {
    if (calculatorResetOnDigit) { calculatorExpression = ''; calculatorResetOnDigit = false; }
    if (type === 'decimal' && calculatorExpression.split(/[+\-*/]/).pop().includes('.')) return;
    calculatorExpression += type === 'decimal' ? '.' : value;
    display.textContent = calculatorExpression;
    return;
  }
  if (type === 'operator') {
    if (!calculatorExpression) return;
    calculatorExpression = calculatorExpression.replace(/[+\-*/]+$/, '') + value;
    display.textContent = calculatorExpression;
    return;
  }
  if (type === 'equals') {
    if (!/^[0-9+\-*/. ]+$/.test(calculatorExpression)) return;
    try {
      const result = Function(`"use strict"; return (${calculatorExpression})`)();
      if (!Number.isFinite(result)) throw new Error('Invalid result');
      calculatorExpression = String(Math.round(result * 1e10) / 1e10);
      display.textContent = calculatorExpression;
      calculatorResetOnDigit = true;
    } catch (error) { display.textContent = 'Error'; calculatorExpression = ''; calculatorResetOnDigit = true; }
  }
}

function setupScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .1, 100);
  camera.userData.targetQuaternion = new THREE.Quaternion();
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  space.appendChild(renderer.domElement);
  cssRenderer = new CSS3DRenderer();
  cssRenderer.setSize(innerWidth, innerHeight);
  cssRenderer.domElement.className = 'css-world css-world-left';
  space.appendChild(cssRenderer.domElement);
  rightScene = new THREE.Scene();
  rightCssRenderer = new CSS3DRenderer();
  rightCssRenderer.setSize(innerWidth, innerHeight);
  rightCssRenderer.domElement.className = 'css-world css-world-right';
  space.appendChild(rightCssRenderer.domElement);
  launcherAnchor = createAppAnchor(document.querySelector('#launcher'), new THREE.Vector3(0, -.85, -launcherDistance));
  setupApps();
  animate();
}

function animate() {
  requestAnimationFrame(animate);
  if (movingAnchor) {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    const moveDistance = movingAnchor === appAnchors.get('iframe-video') ? appRegistry.get('iframe-video').distance : appDistance;
    movingAnchor.position.copy(camera.position).add(direction.multiplyScalar(moveDistance));
    movingAnchor.lookAt(camera.position);
    movingAnchor.userData.rightObject.position.copy(movingAnchor.position);
    movingAnchor.userData.rightObject.lookAt(camera.position);
  }
  camera.quaternion.slerp(camera.userData.targetQuaternion, smoothingEnabled ? .24 : 1);
  camera.updateMatrixWorld();
  updateGazeTarget();
  renderer.render(scene, camera);
  cssRenderer.render(scene, camera);
  rightCssRenderer.render(rightScene, camera);
}

function setupInteractions() {
  document.querySelectorAll('[data-app]').forEach(button => button.addEventListener('click', () => spawnApp(button.dataset.app)));
  document.querySelectorAll('[data-close-app]').forEach(button => button.addEventListener('click', () => closeApp(button.dataset.closeApp)));
  document.querySelectorAll('[data-move-app]').forEach(button => button.addEventListener('click', () => startMove(button.dataset.moveApp)));
  document.querySelectorAll('[data-camera-mode]').forEach(button => button.addEventListener('click', () => setCameraMode(button.dataset.cameraMode)));
  document.querySelector('#recenter-button').addEventListener('click', recenterOrigin);
  document.querySelector('#smoothing-button').addEventListener('click', event => {
    smoothingEnabled = !smoothingEnabled;
    event.currentTarget.textContent = `SENSOR SMOOTHING: ${smoothingEnabled ? 'ON' : 'OFF'}`;
  });
  document.querySelector('#stereo-button').addEventListener('click', event => {
    setVrMode(!stereoEnabled);
    event.currentTarget.textContent = `VR mode: ${stereoEnabled ? 'ON' : 'OFF'}`;
    const settingsAnchor = appAnchors.get('settings');
    const rightVrButton = settingsAnchor?.userData.rightElement.querySelector('#stereo-button');
    if (rightVrButton) rightVrButton.textContent = `VR mode: ${stereoEnabled ? 'ON' : 'OFF'} →`;
  });
  document.querySelector('#iframe-form').addEventListener('submit', openIframeVideo);
  const iframeUrl = document.querySelector('#iframe-url');
  const iframeKeyboard = document.querySelector('#iframe-keyboard');
  const toggleIframeKeyboard = visible => { iframeKeyboard.hidden = !visible; iframeKeyboard.classList.toggle('keyboard-visible', visible); };
  iframeUrl.addEventListener('pointerdown', event => { lastInputPointerType = event.pointerType; });
  iframeUrl.addEventListener('click', event => {
    if (event.detail === 0) {
      toggleIframeKeyboard(true);
    } else if (lastInputPointerType === 'touch') {
      iframeUrl.focus();
      toggleIframeKeyboard(false);
    } else if (lastInputPointerType === 'mouse' || !lastInputPointerType) {
      toggleIframeKeyboard(true);
    }
  });
  document.querySelector('#iframe-keyboard-toggle').addEventListener('click', () => toggleIframeKeyboard(!iframeKeyboard.classList.contains('keyboard-visible')));
  document.querySelectorAll('[data-virtual-key]').forEach(key => key.addEventListener('click', () => {
    const value = key.dataset.virtualKey;
    if (value === 'CLOSE') { toggleIframeKeyboard(false); return; }
    if (value === 'BACKSPACE') iframeUrl.value = iframeUrl.value.slice(0, -1);
    else if (value === 'SPACE') iframeUrl.value += ' ';
    else iframeUrl.value += value;
  }));
  document.querySelector('#iframe-distance-minus').addEventListener('click', () => updateIframeDistance(-.5));
  document.querySelector('#iframe-distance-plus').addEventListener('click', () => updateIframeDistance(.5));
  document.querySelector('#app-distance-minus').addEventListener('click', () => updateAppDistance(appDistance - .5));
  document.querySelector('#app-distance-plus').addEventListener('click', () => updateAppDistance(appDistance + .5));
  cameraPermission.addEventListener('click', () => setCameraMode('rear'));
  document.addEventListener('pointerdown', requestSensorPermission, { passive: true });
  document.querySelectorAll('[data-calc]').forEach(button => button.addEventListener('click', () => calculatorInput(button.dataset.calc, button.dataset.value)));
}

addEventListener('resize', () => {
  if (!camera) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  cssRenderer.setSize(innerWidth, innerHeight);
  rightCssRenderer.setSize(stereoEnabled ? innerWidth / 2 : innerWidth, innerHeight);
});

setupScene();
setupInteractions();
requestSensorPermission();
setCameraMode('rear');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=19').catch(() => {});
