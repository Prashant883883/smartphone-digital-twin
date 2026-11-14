import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const $ = (id) => document.getElementById(id);
const startButton = $('startButton');
const stopButton = $('stopButton');
const calibrateButton = $('calibrateButton');
const host = $('twinCanvas');

let sensorStarted = false;
let hasOrientation = false;
let latestOrientation = { alpha: 0, beta: 0, gamma: 0 };
// Filtered values are used only for the numerical display.
let filteredOrientation = null;

const DISPLAY_DEADBAND = 0.1; 
const DISPLAY_SMOOTHING = 0.2;
let referenceQuaternion = null;
let targetQuaternion = new THREE.Quaternion();
let displayQuaternion = new THREE.Quaternion();
let lastHostSize = { width: 0, height: 0 };

// Scene and camera. The camera must explicitly face the model.
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(3.6, 3.0, 4.8);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
host.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xdceaff, 0x25334b, 2.0));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);
const rimLight = new THREE.PointLight(0x35d5b0, 12, 12);
rimLight.position.set(-3, 1, -2);
scene.add(rimLight);

const twin = new THREE.Group();
scene.add(twin);

// Phone body: its long dimension is along local Z.
const body = new THREE.Mesh(
  new THREE.BoxGeometry(1.55, 0.14, 2.75),
  new THREE.MeshStandardMaterial({ color: 0x438fe8, metalness: 0.45, roughness: 0.3 })
);
twin.add(body);
const screen = new THREE.Mesh(
  new THREE.BoxGeometry(1.42, 0.018, 2.58),
  new THREE.MeshStandardMaterial({ color: 0x10243d, metalness: 0.18, roughness: 0.28, emissive: 0x102d50 })
);
screen.position.y = 0.079;
twin.add(screen);
const cameraDot = new THREE.Mesh(
  new THREE.CylinderGeometry(0.065, 0.065, 0.025, 24),
  new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.2, roughness: 0.35 })
);
cameraDot.rotation.x = Math.PI / 2;
cameraDot.position.set(0, 0.095, -1.18);
twin.add(cameraDot);
const edges = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.58, 0.16, 2.78)),
  new THREE.LineBasicMaterial({ color: 0xa8d0ff, transparent: true, opacity: 0.8 })
);
twin.add(edges);

// A subtle floor grid makes the phone's rotation easier to understand.
const grid = new THREE.GridHelper(5, 10, 0x355579, 0x20334c);
grid.position.y = -1.05;
scene.add(grid);

function resizeRenderer() {
  const width = Math.max(1, Math.floor(host.clientWidth));
  const height = Math.max(1, Math.floor(host.clientHeight));
  if (width === lastHostSize.width && height === lastHostSize.height) return;
  lastHostSize = { width, height };
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

if ('ResizeObserver' in window) {
  const observer = new ResizeObserver(resizeRenderer);
  observer.observe(host);
} else {
  window.addEventListener('resize', resizeRenderer, { passive: true });
}
resizeRenderer();

function displayNumber(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '—';
}
function normalizeAngle(angle) {
  return ((angle % 360) + 360) % 360;
}

function shortestAngleDifference(target, current) {
  return ((target - current + 540) % 360) - 180;
}

function updateFilteredOrientation(raw) {
  if (!filteredOrientation) {
    filteredOrientation = { ...raw };
    return filteredOrientation;
  }

  // Alpha is circular: 359° and 0° are close together.
  const alphaDifference = shortestAngleDifference(
    raw.alpha,
    filteredOrientation.alpha
  );

  if (Math.abs(alphaDifference) >= DISPLAY_DEADBAND) {
    filteredOrientation.alpha = normalizeAngle(
      filteredOrientation.alpha +
      alphaDifference * DISPLAY_SMOOTHING
    );
  }

  // Beta and Gamma use ordinary numerical differences.
  ['beta', 'gamma'].forEach((axis) => {
    const difference = raw[axis] - filteredOrientation[axis];

    if (Math.abs(difference) >= DISPLAY_DEADBAND) {
      filteredOrientation[axis] += difference * DISPLAY_SMOOTHING;
    }
  });

  return filteredOrientation;
}

function displayOrientationNumber(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '—';
}





function setConnected(message = 'Receiving sensor events') {
  $('statusDot').classList.add('connected');
  $('statusText').textContent = message;
  calibrateButton.disabled = !hasOrientation;
}

function orientationToQuaternion(alpha, beta, gamma) {
  // Convert degrees from DeviceOrientationEvent into a 3D orientation.
  // Screen rotation is compensated so portrait/landscape changes are handled.
  const rad = Math.PI / 180;
  const euler = new THREE.Euler(beta * rad, alpha * rad, -gamma * rad, 'YXZ');
  const q = new THREE.Quaternion().setFromEuler(euler);
  const screenAngle = (screen.orientation && Number.isFinite(screen.orientation.angle))
    ? screen.orientation.angle
    : (Number.isFinite(window.orientation) ? window.orientation : 0);
  const screenCorrection = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1), -screenAngle * rad
  );
  return q.multiply(screenCorrection).normalize();
}

function updateRelativeTarget() {
  const current = orientationToQuaternion(
    latestOrientation.alpha,
    latestOrientation.beta,
    latestOrientation.gamma
  );
  if (referenceQuaternion) {
    targetQuaternion.copy(referenceQuaternion).invert().multiply(current).normalize();
  } else {
    targetQuaternion.copy(current);
  }
}

function onOrientation(event) {
  if (event.alpha == null || event.beta == null || event.gamma == null) return;

  // Preserve original sensor readings for the Digital Twin.
  latestOrientation = {
    alpha: event.alpha,
    beta: event.beta,
    gamma: event.gamma
  };

  hasOrientation = true;

  // Filter only the numerical display.
  const displayed = updateFilteredOrientation(latestOrientation);

  $('alpha').textContent = displayOrientationNumber(displayed.alpha);
  $('beta').textContent = displayOrientationNumber(displayed.beta);
  $('gamma').textContent = displayOrientationNumber(displayed.gamma);

  $('orientationSummary').textContent =
    `α ${displayOrientationNumber(displayed.alpha)}° · ` +
    `β ${displayOrientationNumber(displayed.beta)}° · ` +
    `γ ${displayOrientationNumber(displayed.gamma)}°`;

  // The 3D model continues receiving the original readings.
  updateRelativeTarget();

  setConnected();
}

function onMotion(event) {
  const acceleration = event.accelerationIncludingGravity || event.acceleration;
  if (acceleration) {
    $('accX').textContent = displayNumber(acceleration.x);
    $('accY').textContent = displayNumber(acceleration.y);
    $('accZ').textContent = displayNumber(acceleration.z);
    setConnected('Receiving motion data');
  }
}

function animate() {
  requestAnimationFrame(animate);
  // Smooth only the 3D display. Raw sensor numbers remain visible for the experiment.
  displayQuaternion.slerp(targetQuaternion, 0.12);
  twin.quaternion.copy(displayQuaternion);
  renderer.render(scene, camera);
}
animate();

async function requestSensorPermission(EventType) {
  if (typeof EventType !== 'undefined' && typeof EventType.requestPermission === 'function') {
    return EventType.requestPermission();
  }
  return 'granted';
}

async function startSensors() {
  if (sensorStarted) return;
  startButton.disabled = true;
  startButton.textContent = 'Requesting permission…';
  try {
    // iOS Safari may expose separate permission methods for orientation and motion.
    const orientationPermission = await requestSensorPermission(window.DeviceOrientationEvent);
    if (orientationPermission !== 'granted') throw new Error('Orientation permission was not granted.');
    const motionPermission = await requestSensorPermission(window.DeviceMotionEvent);
    if (motionPermission !== 'granted') throw new Error('Motion permission was not granted.');

    if (!('DeviceOrientationEvent' in window) && !('DeviceMotionEvent' in window)) {
      throw new Error('This browser does not expose motion or orientation sensor events.');
    }
    window.addEventListener('deviceorientation', onOrientation, { capture: true, passive: true });
    window.addEventListener('devicemotion', onMotion, { capture: true, passive: true });
    sensorStarted = true;
    startButton.hidden = true;
    stopButton.hidden = false;
    $('statusDot').classList.add('connected');
    $('statusText').textContent = 'Sensors enabled — waiting for readings';
    $('orientationSummary').textContent = 'Waiting for orientation data';
  } catch (error) {
    $('statusDot').classList.remove('connected');
    $('statusText').textContent = error.message || 'Could not access sensors';
    startButton.disabled = false;
    startButton.textContent = 'Try sensor permission again';
  }
}

function stopSensors() {
  if (!sensorStarted) return;
  window.removeEventListener('deviceorientation', onOrientation, true);
  window.removeEventListener('devicemotion', onMotion, true);
  sensorStarted = false;
  hasOrientation = false;
  referenceQuaternion = null;
  latestOrientation = { alpha: 0, beta: 0, gamma: 0 };
  filteredOrientation = null;
  targetQuaternion.identity();
  displayQuaternion.identity();

  // Clear displayed values so the user can see that this page is no longer reading events.
  ['accX', 'accY', 'accZ', 'alpha', 'beta', 'gamma'].forEach((id) => { $(id).textContent = '—'; });
  $('orientationSummary').textContent = 'Sensors are disabled';
  $('calibrationText').textContent = 'Not set';
  $('statusDot').classList.remove('connected');
  $('statusText').textContent = 'Sensors disabled';
  calibrateButton.disabled = true;
  stopButton.hidden = true;
  startButton.hidden = false;
  startButton.disabled = false;
  startButton.textContent = 'Enable smartphone sensors';
}

startButton.addEventListener('click', startSensors);
stopButton.addEventListener('click', stopSensors);
calibrateButton.addEventListener('click', () => {
  if (!hasOrientation) return;
  referenceQuaternion = orientationToQuaternion(
    latestOrientation.alpha,
    latestOrientation.beta,
    latestOrientation.gamma
  );
  targetQuaternion.identity();
  $('calibrationText').textContent = 'Reference saved';
  $('orientationSummary').textContent = 'Relative to calibrated position';
});

window.addEventListener('orientationchange', () => {
  // Recalculate dimensions after the browser finishes its orientation transition.
  requestAnimationFrame(resizeRenderer);
}, { passive: true });
