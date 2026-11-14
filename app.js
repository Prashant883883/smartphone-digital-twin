import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const $ = (id) => document.getElementById(id);
const startButton = $('startButton');
const calibrateButton = $('calibrateButton');
let latestOrientation = { alpha: 0, beta: 0, gamma: 0 };
let reference = null;
let sensorStarted = false;

// Three.js scene: a simple 3D object represents the physical device's digital twin.
const host = $('twinCanvas');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(4.2, 3.1, 5.4);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 1.8));
const keyLight = new THREE.DirectionalLight(0x9bc7ff, 3.2);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);
const rimLight = new THREE.PointLight(0x35d5b0, 18, 12);
rimLight.position.set(-3, 1, -2);
scene.add(rimLight);

const twin = new THREE.Group();
scene.add(twin);
const body = new THREE.Mesh(
  new THREE.BoxGeometry(1.7, 0.18, 2.8),
  new THREE.MeshStandardMaterial({ color: 0x438fe8, metalness: 0.55, roughness: 0.28 })
);
body.castShadow = true;
twin.add(body);
const screen = new THREE.Mesh(
  new THREE.BoxGeometry(1.48, 0.025, 2.48),
  new THREE.MeshStandardMaterial({ color: 0x142943, metalness: 0.25, roughness: 0.35, emissive: 0x102d50 })
);
screen.position.y = 0.105;
twin.add(screen);
const cameraDot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.035, 24), new THREE.MeshStandardMaterial({ color: 0x111827 }));
cameraDot.rotation.x = Math.PI / 2;
cameraDot.position.set(0, 0.13, -1.12);
twin.add(cameraDot);
const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.72, 0.2, 2.82)), new THREE.LineBasicMaterial({ color: 0x9ccaff, transparent: true, opacity: 0.75 }));
twin.add(edges);

function resize() {
  const width = Math.max(host.clientWidth, 1);
  const height = Math.max(host.clientHeight, 1);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
new ResizeObserver(resize).observe(host);
resize();

function render() {
  requestAnimationFrame(render);
  renderer.render(scene, camera);
}
render();

function displayNumber(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '—';
}

function updateTwin() {
  const { alpha, beta, gamma } = latestOrientation;
  const offset = reference || { alpha: 0, beta: 0, gamma: 0 };
  const toRad = Math.PI / 180;
  // DeviceOrientation angles are mapped to the 3D model as a visual representation.
  twin.rotation.set(
    (beta - offset.beta) * toRad,
    (alpha - offset.alpha) * toRad,
    -(gamma - offset.gamma) * toRad,
    'YXZ'
  );
  $('orientationSummary').textContent = `α ${displayNumber(alpha)}° · β ${displayNumber(beta)}° · γ ${displayNumber(gamma)}°`;
}

function onOrientation(event) {
  if (event.alpha == null && event.beta == null && event.gamma == null) return;
  latestOrientation = {
    alpha: event.alpha ?? 0,
    beta: event.beta ?? 0,
    gamma: event.gamma ?? 0
  };
  $('alpha').textContent = displayNumber(event.alpha);
  $('beta').textContent = displayNumber(event.beta);
  $('gamma').textContent = displayNumber(event.gamma);
  updateTwin();
  setConnected();
}

function onMotion(event) {
  const acceleration = event.accelerationIncludingGravity || event.acceleration;
  if (acceleration) {
    $('accX').textContent = displayNumber(acceleration.x);
    $('accY').textContent = displayNumber(acceleration.y);
    $('accZ').textContent = displayNumber(acceleration.z);
  }
  if (event.rotationRate) {
    // Rotation-rate values are available in degrees per second on supporting browsers.
    // Orientation values above are used for the 3D model.
  }
  setConnected();
}

function setConnected() {
  $('statusDot').classList.add('connected');
  $('statusText').textContent = 'Receiving sensor events';
  calibrateButton.disabled = false;
}

async function startSensors() {
  if (sensorStarted) return;
  try {
    // iOS Safari requires explicit permission from a user gesture.
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') throw new Error('Motion/orientation permission was not granted.');
    }
    if (!('DeviceOrientationEvent' in window) && !('DeviceMotionEvent' in window)) {
      throw new Error('This browser does not expose motion or orientation sensor events.');
    }
    window.addEventListener('deviceorientation', onOrientation, true);
    window.addEventListener('devicemotion', onMotion, true);
    sensorStarted = true;
    startButton.textContent = 'Sensors enabled';
    startButton.disabled = true;
    $('statusText').textContent = 'Waiting for sensor readings';
  } catch (error) {
    $('statusText').textContent = error.message || 'Could not access sensors';
    $('statusDot').classList.remove('connected');
  }
}

startButton.addEventListener('click', startSensors);
calibrateButton.addEventListener('click', () => {
  reference = { ...latestOrientation };
  $('calibrationText').textContent = 'Reference saved';
  updateTwin();
});

window.addEventListener('orientationchange', resize);
