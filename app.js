
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const $ = (id) => document.getElementById(id);
const startButton = $('startButton');
const stopButton = $('stopButton');
const calibrateButton = $('calibrateButton');
const host = $('twinCanvas');

let sensorStarted = false;
let hasOrientation = false;
let latestOrientation = { alpha: 0, beta: 0, gamma: 0 };

// Low-pass filters for reducing sensor noise.
let filteredOrientation = null;
let filteredAcceleration = null;
let lastOrientationTime = null;
let lastMotionTime = null;

const ORIENTATION_TIME_CONSTANT = 0.18;
const ACCELERATION_TIME_CONSTANT = 0.25;
const ORIENTATION_DEADBAND = 0.08;
const ACCELERATION_DEADBAND = 0.04;

let referenceQuaternion = null;
let targetQuaternion = new THREE.Quaternion();
let displayQuaternion = new THREE.Quaternion();
let lastHostSize = { width: 0, height: 0 };

// Scene and camera.
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(3.6, 3.0, 4.8);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  powerPreference: 'low-power'
});

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

// Phone body.
const body = new THREE.Mesh(
  new THREE.BoxGeometry(1.55, 0.14, 2.75),
  new THREE.MeshStandardMaterial({
    color: 0x438fe8,
    metalness: 0.45,
    roughness: 0.3
  })
);
twin.add(body);

const screen = new THREE.Mesh(
  new THREE.BoxGeometry(1.42, 0.018, 2.58),
  new THREE.MeshStandardMaterial({
    color: 0x10243d,
    metalness: 0.18,
    roughness: 0.28,
    emissive: 0x102d50
  })
);
screen.position.y = 0.079;
twin.add(screen);

const cameraDot = new THREE.Mesh(
  new THREE.CylinderGeometry(0.065, 0.065, 0.025, 24),
  new THREE.MeshStandardMaterial({
    color: 0x111827,
    metalness: 0.2,
    roughness: 0.35
  })
);
cameraDot.rotation.x = Math.PI / 2;
cameraDot.position.set(0, 0.095, -1.18);
twin.add(cameraDot);

const edges = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.58, 0.16, 2.78)),
  new THREE.LineBasicMaterial({
    color: 0xa8d0ff,
    transparent: true,
    opacity: 0.8
  })
);
twin.add(edges);

// Floor grid.
const grid = new THREE.GridHelper(5, 10, 0x355579, 0x20334c);
grid.position.y = -1.05;
scene.add(grid);

function resizeRenderer() {
  const width = Math.max(1, Math.floor(host.clientWidth));
  const height = Math.max(1, Math.floor(host.clientHeight));

  if (width === lastHostSize.width && height === lastHostSize.height) {
    return;
  }

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

// Display helpers.
function displayNumber(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '—';
}

function displayOrientationNumber(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '—';
}

function normalizeAngle(angle) {
  return ((angle % 360) + 360) % 360;
}

function shortestAngleDifference(target, current) {
  return ((target - current + 540) % 360) - 180;
}

// Time-based smoothing.
function smoothingFactor(deltaTime, timeConstant) {
  const safeDelta = Math.min(Math.max(deltaTime, 0.001), 0.25);
  return 1 - Math.exp(-safeDelta / timeConstant);
}

// Filter Alpha, Beta and Gamma.
function updateFilteredOrientation(raw, now) {
  if (!filteredOrientation) {
    filteredOrientation = { ...raw };
    lastOrientationTime = now;
    return filteredOrientation;
  }

  const deltaTime = lastOrientationTime == null
    ? 0.05
    : (now - lastOrientationTime) / 1000;

  lastOrientationTime = now;

  const factor = smoothingFactor(
    deltaTime,
    ORIENTATION_TIME_CONSTANT
  );

  // Alpha is circular: 359° and 0° are close together.
  const alphaDifference = shortestAngleDifference(
    raw.alpha,
    filteredOrientation.alpha
  );

  if (Math.abs(alphaDifference) >= ORIENTATION_DEADBAND) {
    filteredOrientation.alpha = normalizeAngle(
      filteredOrientation.alpha + alphaDifference * factor
    );
  }

  ['beta', 'gamma'].forEach((axis) => {
    const difference = raw[axis] - filteredOrientation[axis];

    if (Math.abs(difference) >= ORIENTATION_DEADBAND) {
      filteredOrientation[axis] += difference * factor;
    }
  });

  return filteredOrientation;
}

// Filter accelerometer X, Y and Z.
function updateFilteredAcceleration(raw, now) {
  if (!filteredAcceleration) {
    filteredAcceleration = { ...raw };
    lastMotionTime = now;
    return filteredAcceleration;
  }

  const deltaTime = lastMotionTime == null
    ? 0.05
    : (now - lastMotionTime) / 1000;

  lastMotionTime = now;

  const factor = smoothingFactor(
    deltaTime,
    ACCELERATION_TIME_CONSTANT
  );

  ['x', 'y', 'z'].forEach((axis) => {
    const value = raw[axis];

    if (!Number.isFinite(value)) return;

    const previous = filteredAcceleration[axis];

    if (!Number.isFinite(previous)) {
      filteredAcceleration[axis] = value;
      return;
    }

    const difference = value - previous;

    if (Math.abs(difference) >= ACCELERATION_DEADBAND) {
      filteredAcceleration[axis] = previous + difference * factor;
    }
  });

  return filteredAcceleration;
}

function setConnected(message = 'Receiving sensor events') {
  $('statusDot').classList.add('connected');
  $('statusText').textContent = message;
  calibrateButton.disabled = !hasOrientation;
}

// Convert sensor orientation to a 3D quaternion.
function orientationToQuaternion(alpha, beta, gamma) {
  const rad = Math.PI / 180;

  const euler = new THREE.Euler(
    beta * rad,
    alpha * rad,
    -gamma * rad,
    'YXZ'
  );

  const q = new THREE.Quaternion().setFromEuler(euler);

  const screenAngle = (
    screen.orientation &&
    Number.isFinite(screen.orientation.angle)
  )
    ? screen.orientation.angle
    : (Number.isFinite(window.orientation) ? window.orientation : 0);

  const screenCorrection = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    -screenAngle * rad
  );

  return q.multiply(screenCorrection).normalize();
}

function updateRelativeTarget() {
  const orientation = filteredOrientation || latestOrientation;

  const current = orientationToQuaternion(
    orientation.alpha,
    orientation.beta,
    orientation.gamma
  );

  if (referenceQuaternion) {
    targetQuaternion
      .copy(referenceQuaternion)
      .invert()
      .multiply(current)
      .normalize();
  } else {
    targetQuaternion.copy(current);
  }
}

// Orientation sensor event.
function onOrientation(event) {
  if (
    event.alpha == null ||
    event.beta == null ||
    event.gamma == null
  ) {
    return;
  }

  latestOrientation = {
    alpha: event.alpha,
    beta: event.beta,
    gamma: event.gamma
  };

  hasOrientation = true;

  const displayed = updateFilteredOrientation(
    latestOrientation,
    performance.now()
  );

  $('alpha').textContent = displayOrientationNumber(displayed.alpha);
  $('beta').textContent = displayOrientationNumber(displayed.beta);
  $('gamma').textContent = displayOrientationNumber(displayed.gamma);

  $('orientationSummary').textContent =
    `α ${displayOrientationNumber(displayed.alpha)}° · ` +
    `β ${displayOrientationNumber(displayed.beta)}° · ` +
    `γ ${displayOrientationNumber(displayed.gamma)}°`;

  updateRelativeTarget();
  setConnected();
}

// Accelerometer sensor event.
function onMotion(event) {
  const acceleration =
    event.accelerationIncludingGravity || event.acceleration;

  if (!acceleration) return;

  const raw = {
    x: acceleration.x,
    y: acceleration.y,
    z: acceleration.z
  };

  if (![raw.x, raw.y, raw.z].every(Number.isFinite)) {
    return;
  }

  const displayed = updateFilteredAcceleration(
    raw,
    performance.now()
  );

  $('accX').textContent = displayNumber(displayed.x);
  $('accY').textContent = displayNumber(displayed.y);
  $('accZ').textContent = displayNumber(displayed.z);

  setConnected('Receiving motion data');
}

// Animation loop.
function animate() {
  requestAnimationFrame(animate);

  displayQuaternion.slerp(targetQuaternion, 0.12);
  twin.quaternion.copy(displayQuaternion);

  renderer.render(scene, camera);
}

animate();

// Request sensor permission.
async function requestSensorPermission(EventType) {
  if (
    typeof EventType !== 'undefined' &&
    typeof EventType.requestPermission === 'function'
  ) {
    return EventType.requestPermission();
  }

  return 'granted';
}

// Start sensors.
async function startSensors() {
  if (sensorStarted) return;

  startButton.disabled = true;
  startButton.textContent = 'Requesting permission…';

  try {
    const orientationPermission = await requestSensorPermission(
      window.DeviceOrientationEvent
    );

    if (orientationPermission !== 'granted') {
      throw new Error('Orientation permission was not granted.');
    }

    const motionPermission = await requestSensorPermission(
      window.DeviceMotionEvent
    );

    if (motionPermission !== 'granted') {
      throw new Error('Motion permission was not granted.');
    }

    if (
      !('DeviceOrientationEvent' in window) &&
      !('DeviceMotionEvent' in window)
    ) {
      throw new Error(
        'This browser does not expose motion or orientation sensor events.'
      );
    }

    window.addEventListener(
      'deviceorientation',
      onOrientation,
      { capture: true, passive: true }
    );

    window.addEventListener(
      'devicemotion',
      onMotion,
      { capture: true, passive: true }
    );

    sensorStarted = true;

    startButton.hidden = true;
    stopButton.hidden = false;

    $('statusDot').classList.add('connected');
    $('statusText').textContent =
      'Sensors enabled — waiting for readings';

    $('orientationSummary').textContent =
      'Waiting for orientation data';

  } catch (error) {
    $('statusDot').classList.remove('connected');
    $('statusText').textContent =
      error.message || 'Could not access sensors';

    startButton.disabled = false;
    startButton.textContent = 'Try sensor permission again';
  }
}

// Stop sensors and reset readings.
function stopSensors() {
  if (!sensorStarted) return;

  window.removeEventListener('deviceorientation', onOrientation, true);
  window.removeEventListener('devicemotion', onMotion, true);

  sensorStarted = false;
  hasOrientation = false;
  referenceQuaternion = null;

  latestOrientation = {
    alpha: 0,
    beta: 0,
    gamma: 0
  };

  filteredOrientation = null;
  filteredAcceleration = null;
  lastOrientationTime = null;
  lastMotionTime = null;

  targetQuaternion.identity();
  displayQuaternion.identity();

  ['accX', 'accY', 'accZ', 'alpha', 'beta', 'gamma'].forEach((id) => {
    $(id).textContent = '—';
  });

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

// Button events.
startButton.addEventListener('click', startSensors);
stopButton.addEventListener('click', stopSensors);

calibrateButton.addEventListener('click', () => {
  if (!hasOrientation) return;

  const orientation = filteredOrientation || latestOrientation;

  referenceQuaternion = orientationToQuaternion(
    orientation.alpha,
    orientation.beta,
    orientation.gamma
  );

  targetQuaternion.identity();

  $('calibrationText').textContent = 'Reference saved';
  $('orientationSummary').textContent =
    'Relative to calibrated position';
});

// Screen orientation change.
window.addEventListener(
  'orientationchange',
  () => {
    requestAnimationFrame(resizeRenderer);
  },
  { passive: true }
);
