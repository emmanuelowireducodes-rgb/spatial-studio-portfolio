let THREE = null;
let XR8Ref = null;
let running = false;
let pipelineAdded = false;
let latestPose = null;
let originPose = null;
let office = null;
let officeLighting = null;
let xrCamera = null;
let frontDisplay = null;
let cameraOriginPosition = null;
let officeBasePosition = null;
let officeBaseQuaternion = null;
let cameraWorldScratch = null;
let cameraDeltaScratch = null;
let appliedCameraPositionScratch = null;
let latestUsableCameraPosition = null;
let cameraBeforeTracking = null;
let movementThresholdCrossed = false;
let positionalSensitivity = 1.5;
let lastTrackingUsable = false;
let lastTrackingLabel = '';
let lastHudUpdateAt = 0;
let rateWindowStart = 0;
let renderFrameCount = 0;
let poseUpdateFrameCount = 0;
let trackingConfigured = false;
let firstPoseComparisonLogged = false;
let poseTimer = 0;
let rendererTimer = 0;
let updateCount = 0;

const $ = (id) => document.getElementById(id);
const canvas = $('xr-canvas');
const startButton = $('start-button');
const recenterButton = $('recenter-button');
const stopButton = $('stop-button');
const engineStatus = $('engine-status');
const stageStatus = $('stage-status');
const errorMessage = $('error-message');
const pulse = $('pulse');
const sensitivitySelect = $('position-scale');

function setDiagnostic(key, state, detail) {
  const row = document.querySelector(`[data-diagnostic="${key}"]`);
  if (!row) return;
  row.dataset.state = state;
  row.querySelector('b').textContent = ({pass:'Ready', active:'Active', fail:'Failed', waiting:'Waiting'})[state] || state;
  let description = row.querySelector('small');
  if (!description) {
    description = document.createElement('small');
    row.append(description);
  }
  description.textContent = detail || '';
}

function failStage(key, message, stageMessage = message) {
  setDiagnostic(key, 'fail', stageMessage);
  engineStatus.textContent = 'Startup stopped. See the diagnostic details below.';
  stageStatus.textContent = 'Tracking unavailable';
  pulse.className = 'pulse';
  showError(message);
  console.error(`[Physical Walk: ${key}] ${message}`);
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function clearError() {
  errorMessage.hidden = true;
  errorMessage.textContent = '';
}

function capabilityProbe() {
  const secure = window.isSecureContext;
  const cameraApi = !!navigator.mediaDevices?.getUserMedia;
  const orientationApi = typeof window.DeviceOrientationEvent !== 'undefined';
  const webAssembly = typeof WebAssembly !== 'undefined';
  let webgl = false;
  let simd = false;

  try {
    const probeCanvas = document.createElement('canvas');
    const context = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    webgl = !!context;
    context?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { webgl = false; }

  if (webAssembly) {
    // Minimal module containing v128.const. 8th Wall lists WebAssembly SIMD as a requirement.
    const simdProbe = new Uint8Array([
      0,97,115,109,1,0,0,0,
      1,5,1,96,0,1,123,
      3,2,1,0,
      10,22,1,20,0,253,12,...Array(16).fill(0),11,
    ]);
    simd = WebAssembly.validate(simdProbe);
  }

  return {secure, cameraApi, orientationApi, webgl, webAssembly, simd};
}

function readableError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
    return 'Permission was denied. Allow Camera and Motion & Orientation access for this site in iPhone Settings / Safari, then reload and tap Start again.';
  }
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    return 'No usable camera was found. Close other apps using the camera and try again.';
  }
  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
    return 'The camera is unavailable or busy. Close other camera apps and retry.';
  }
  return error?.message || String(error || 'Unknown startup error.');
}

function applyCapabilities() {
  setDiagnostic('context', 'active', 'Checking secure origin…');
  const capabilities = capabilityProbe();
  const problems = [];

  if (!capabilities.secure) problems.push('Open this page directly on HTTPS (localhost is allowed for local development).');
  setDiagnostic('context', capabilities.secure ? 'pass' : 'fail', capabilities.secure
    ? 'Secure context detected.'
    : 'This page is not in a secure context; camera access requires HTTPS.');

  if (!capabilities.cameraApi) problems.push('This browser does not expose navigator.mediaDevices.getUserMedia.');
  if (!capabilities.orientationApi) problems.push('This browser does not expose DeviceOrientationEvent, which 8th Wall requires for SLAM.');
  if (!capabilities.webgl) problems.push('WebGL is unavailable or disabled in this browser.');
  if (!capabilities.webAssembly) problems.push('WebAssembly is unavailable in this browser.');
  else if (!capabilities.simd) problems.push('WebAssembly SIMD is unavailable; it is required by the 8th Wall browser engine.');

  const featureSummary = [
    `camera API ${capabilities.cameraApi ? 'available' : 'missing'}`,
    `device orientation ${capabilities.orientationApi ? 'available' : 'missing'}`,
    `WebGL ${capabilities.webgl ? 'available' : 'missing'}`,
    `WebAssembly SIMD ${capabilities.simd ? 'available' : 'missing'}`,
  ].join(' · ');
  setDiagnostic('capabilities', problems.length ? 'fail' : 'pass', featureSummary);

  if (problems.length) {
    startButton.disabled = true;
    engineStatus.textContent = 'This browser or page is not ready for positional tracking.';
    showError(problems.join(' '));
    return false;
  }
  engineStatus.textContent = 'Browser checks passed. Loading the tracking engine…';
  return true;
}

function makeOffice(scene) {
  const group = new THREE.Group();
  group.name = 'PrototypeOffice';
  scene.background = new THREE.Color('#10141b');

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshStandardMaterial({color:'#363b42', roughness:.92}));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.55;
  group.add(floor);

  const floorGrid = new THREE.GridHelper(8, 32, '#75818b', '#434c55');
  floorGrid.position.set(0, -1.535, -1.3);
  group.add(floorGrid);

  const wallMaterial = new THREE.MeshStandardMaterial({color:'#8a8277', roughness:.88});
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, .12), wallMaterial);
  backWall.position.set(0, 0, -5.5);
  group.add(backWall);
  for (const x of [-3.5, 3.5]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(.12, 3.2, 8), wallMaterial);
    wall.position.set(x, 0, -2.5);
    group.add(wall);
  }

  function addTestDisplay({name, title, subtitle, width, height, z, color}) {
    const display = new THREE.Group();
    display.name = name;
    display.position.set(0, 0, z);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, .08),
      new THREE.MeshStandardMaterial({color:'#10202a', emissive:'#071821', roughness:.45})
    );
    display.add(body);
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(width + .08, height + .08, .1)),
      new THREE.LineBasicMaterial({color, toneMapped:false})
    );
    display.add(frame);

    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 640;
    labelCanvas.height = 320;
    const context = labelCanvas.getContext('2d');
    if (context) {
      context.fillStyle = '#10202a';
      context.fillRect(0,0,640,320);
      context.strokeStyle = color;
      context.lineWidth = 8;
      context.strokeRect(10,10,620,300);
      context.fillStyle = '#f5eee2';
      context.textAlign = 'center';
      context.font = '600 48px Arial, sans-serif';
      context.fillText(title,320,142,570);
      context.fillStyle = color;
      context.font = '28px Arial, sans-serif';
      context.fillText(subtitle,320,205,570);
    }
    const texture = new THREE.CanvasTexture(labelCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(width - .14, height - .14),
      new THREE.MeshBasicMaterial({map:texture, color:'#ffffff', toneMapped:false})
    );
    face.position.z = .046;
    display.add(face);
    group.add(display);
    return display;
  }

  frontDisplay = addTestDisplay({
    name:'FrontPerspectiveDisplay', title:'PERSPECTIVE TEST', subtitle:'FRONT · 1.60 m',
    width:1.38, height:.98, z:-1.6, color:'#6be3d4',
  });
  const rearReference = addTestDisplay({
    name:'RearReferenceDisplay', title:'REFERENCE', subtitle:'REAR · 3.80 m',
    width:.86, height:.6, z:-3.8, color:'#f0bf76',
  });
  rearReference.position.x = .72;

  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.4,.08,.6), new THREE.MeshStandardMaterial({color:'#483a30',roughness:.7}));
  desk.position.set(.2,-.65,-1.4);
  group.add(desk);
  const legMaterial = new THREE.MeshStandardMaterial({color:'#2d2925',roughness:.65});
  for (const x of [-.42,.82]) for (const z of [-1.63,-1.17]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(.055,.72,.055), legMaterial);
    leg.position.set(x,-1.02,z);
    group.add(leg);
  }
  const chair = new THREE.Mesh(new THREE.BoxGeometry(.65,.48,.55), new THREE.MeshStandardMaterial({color:'#536372',roughness:.85}));
  chair.position.set(1.8,-.95,-.4);
  group.add(chair);

  const lighting = new THREE.Group();
  lighting.name = 'PrototypeOfficeLighting';
  lighting.add(new THREE.HemisphereLight(0xc4d7e8,0x342a20,2.0));
  const key = new THREE.DirectionalLight(0xffdfb6,2.2);
  key.position.set(1.2,3,2);
  lighting.add(key);
  officeLighting = lighting;
  scene.add(lighting);
  scene.add(group);
  return group;
}

function setValue(id, value) {
  $(id).textContent = Number.isFinite(value) ? value.toFixed(3) : '—';
}

function getRenderedCameraWorldPosition() {
  if (!xrCamera || !cameraWorldScratch) return null;
  xrCamera.updateWorldMatrix(true, false);
  return xrCamera.getWorldPosition(cameraWorldScratch);
}

function applyTranslationSensitivity(reality, cameraWorld) {
  if (!office || !cameraOriginPosition || !officeBasePosition || !officeBaseQuaternion || !cameraDeltaScratch || !cameraWorld) return;
  const trackingUsable = reality?.trackingStatus === 'NORMAL' && reality?.trackingReason !== 'INITIALIZING';
  lastTrackingUsable = trackingUsable;
  if (!trackingUsable) return;

  cameraDeltaScratch.subVectors(cameraWorld, cameraOriginPosition);
  latestUsableCameraPosition?.copy(cameraWorld);
  // XR8 continues to own the real camera pose. Translating the virtual room by only the
  // excess displacement is equivalent to scaling camera translation about the recenter origin.
  // This leaves orientation and projection/FOV untouched and avoids applying the pose twice.
  office.position.copy(officeBasePosition).addScaledVector(cameraDeltaScratch, -(positionalSensitivity - 1));
  office.updateMatrix();
}

function publishFrameRates(now) {
  if (!rateWindowStart) rateWindowStart = now;
  const elapsed = now - rateWindowStart;
  if (elapsed < 1000) return;
  const fps = renderFrameCount * 1000 / elapsed;
  const poseHz = poseUpdateFrameCount * 1000 / elapsed;
  const row = document.querySelector('[data-diagnostic="performance"]');
  if (row) {
    row.dataset.state = running ? 'active' : 'waiting';
    row.querySelector('b').textContent = running ? `${fps.toFixed(0)} FPS` : 'Waiting';
    $('performance-value').textContent = `XR pose updates ${poseHz.toFixed(0)} Hz · tracking ${lastTrackingLabel || 'waiting'} · scale ${positionalSensitivity.toFixed(1)}×`;
  }
  renderFrameCount = 0;
  poseUpdateFrameCount = 0;
  rateWindowStart = now;
}

function updatePoseDiagnostics(reality, cameraWorld) {
  if (!xrCamera || !frontDisplay || !latestPose || !cameraWorld) return;
  frontDisplay.updateWorldMatrix(true, false);
  const displayWorld = frontDisplay.getWorldPosition(new THREE.Vector3());
  const displayDistance = cameraWorld.distanceTo(displayWorld);
  const cameraDelta = cameraDeltaScratch.subVectors(cameraWorld, cameraOriginPosition || cameraWorld);
  const rawTravel = originPose
    ? Math.hypot(latestPose.position.x-originPose.position.x, latestPose.position.y-originPose.position.y, latestPose.position.z-originPose.position.z)
    : 0;
  const cameraTravel = cameraDelta.length();
  appliedCameraPositionScratch.copy(cameraOriginPosition || cameraWorld)
    .addScaledVector(cameraDelta, positionalSensitivity);

  setValue('raw-x-value', latestPose.position.x);
  setValue('raw-y-value', latestPose.position.y);
  setValue('raw-z-value', latestPose.position.z);
  setValue('camera-x-value', appliedCameraPositionScratch.x);
  setValue('camera-y-value', appliedCameraPositionScratch.y);
  setValue('camera-z-value', appliedCameraPositionScratch.z);
  setValue('distance-value', displayDistance);
  $('applied-scale-value').textContent = `${positionalSensitivity.toFixed(positionalSensitivity % 1 ? 1 : 0)}×`;

  if (originPose && cameraOriginPosition) {
    const appliedTravel = cameraTravel * positionalSensitivity;
    $('movement-value').textContent = `${rawTravel.toFixed(2)} / ${appliedTravel.toFixed(2)} m`;

    const status = reality.trackingStatus || 'UNKNOWN';
    if (!lastTrackingUsable) {
      $('scale-value').textContent = `Tracking ${status.toLowerCase()}; sensitivity is paused until pose is reliable.`;
    } else if (rawTravel >= .30) {
      const ratio = rawTravel > .001 ? appliedTravel / rawTravel : 0;
      $('scale-value').textContent = `30 cm threshold crossed · applied/raw travel ${ratio.toFixed(2)}× (target ${positionalSensitivity.toFixed(1)}×)`;
      if (!movementThresholdCrossed) {
        movementThresholdCrossed = true;
        console.info('[Physical Walk: movement threshold]', {rawTravelMetres:rawTravel, appliedCameraTravelMetres:appliedTravel, positionalSensitivity, appliedPerRawRatio:ratio});
      }
    } else {
      const ratio = rawTravel > .03 ? cameraTravel / rawTravel : null;
      $('scale-value').textContent = ratio === null
        ? `Below 0.30 m threshold; small changes may be tracking noise. Applied scale ${positionalSensitivity.toFixed(1)}×.`
        : `Below 0.30 m threshold · raw camera ratio ${ratio.toFixed(2)}×; applied ${positionalSensitivity.toFixed(1)}×`;
    }
  }

  if (!firstPoseComparisonLogged) {
    firstPoseComparisonLogged = true;
    console.info('[Physical Walk: first XR pose]', {
      rawTrackedPositionMetres: {...latestPose.position},
      renderedCameraLocalBeforeTracking: cameraBeforeTracking?.local,
      renderedCameraWorldAfterTracking: cameraWorld.toArray(),
      effectiveAppliedCameraPosition:appliedCameraPositionScratch.toArray(),
      displayWorldPosition: displayWorld.toArray(),
      cameraToDisplayDistanceMetres: displayDistance,
      cameraFovDegrees: xrCamera.fov,
      trackingStatus: reality.trackingStatus,
      trackingReason: reality.trackingReason,
    });
  }
}

function finitePose(pose) {
  return pose && ['x','y','z'].every(key => Number.isFinite(pose.position?.[key])) &&
    ['x','y','z','w'].every(key => Number.isFinite(pose.rotation?.[key]));
}

function recenterOffice() {
  if (!finitePose(latestPose) || !xrCamera || !lastTrackingUsable) {
    showError('Recenter is available after a valid, normal tracking pose arrives. Keep the camera on a detailed surface and try again.');
    return;
  }
  originPose = {
    position: {...latestPose.position},
    rotation: {...latestPose.rotation},
  };

  const cameraPosition = getRenderedCameraWorldPosition();
  const cameraRotation = xrCamera.getWorldQuaternion(new THREE.Quaternion());
  cameraOriginPosition = cameraPosition.clone();
  movementThresholdCrossed = false;

  if (office) {
    const inverse = cameraRotation.clone().invert();
    office.quaternion.copy(inverse);
    office.position.copy(cameraPosition).applyQuaternion(inverse).multiplyScalar(-1);
    office.updateMatrixWorld(true);
    officeBasePosition.copy(office.position);
    officeBaseQuaternion.copy(office.quaternion);
  }
  $('movement-value').textContent = '0.00 / 0.00 m';
  $('scale-value').textContent = 'Recentered; move at least 0.30 m to compare tracked and rendered travel.';
  clearError();
}

function onCameraStatusChange({status}) {
  if (status === 'requesting') {
    setDiagnostic('camera', 'active', 'Waiting for Safari camera permission. Accept the prompt to continue.');
    engineStatus.textContent = 'Waiting for camera permission…';
  } else if (status === 'hasStream') {
    setDiagnostic('camera', 'active', 'Camera permission granted; waiting for image frames.');
  } else if (status === 'hasVideo') {
    setDiagnostic('camera', 'pass', 'Camera opened and frames are arriving for tracking.');
    stageStatus.textContent = 'Camera active · initializing visual tracking';
    clearTimeout(poseTimer);
    poseTimer = window.setTimeout(() => {
      if (!latestPose && running) failStage('pose', 'The camera is open, but the engine has not supplied a valid 6DoF pose after 25 seconds. Check the XR8/runtime diagnostics, use the rear camera in a bright textured area, and confirm Motion & Orientation access.', 'Camera frames arrive, but no valid pose was received.');
    }, 25000);
  } else if (status === 'failed') {
    failStage('camera', 'Safari could not open the camera. Allow camera access for this site, open the page directly rather than in an embedded browser, close other camera apps, and retry.', 'Camera request failed or was denied.');
  }
}

const readTracking = {
  name: 'physical-walk-pose-readout',
  onCameraStatusChange,
  onStart: () => {
    setDiagnostic('renderer', 'active', 'XR started; initializing Three.js scene and renderer…');
    const xrScene = XR8Ref.Threejs.xrScene();
    if (!xrScene?.scene || !xrScene?.camera || !xrScene?.renderer) {
      throw new Error('XR8.Threejs.xrScene() did not return a scene, camera, and renderer.');
    }
    if (office?.parent) office.parent.remove(office);
    if (officeLighting?.parent) officeLighting.parent.remove(officeLighting);
    xrCamera = xrScene.camera;
    xrCamera.position.set(0, 1.55, 0);
    xrCamera.quaternion.identity();
    xrCamera.updateMatrixWorld(true);
    xrScene.renderer.setClearColor('#10141b', 1);
    xrScene.renderer.setClearAlpha(1);
    office = makeOffice(xrScene.scene);
    cameraBeforeTracking = {
      local:[xrCamera.position.x, xrCamera.position.y, xrCamera.position.z],
      quaternion:[xrCamera.quaternion.x, xrCamera.quaternion.y, xrCamera.quaternion.z, xrCamera.quaternion.w],
    };
    // This is the one-time XR8 camera/scene synchronization required by its Three.js integration.
    // XR8 owns camera pose updates after this call; this app never copies raw pose into the camera.
    XR8Ref.XrController.updateCameraProjectionMatrix({
      origin:xrCamera.position.clone(),
      facing:xrCamera.quaternion.clone(),
    });
    console.info('[Physical Walk: camera synchronization]', {
      initialCameraLocalPosition:cameraBeforeTracking.local,
      initialCameraQuaternion:cameraBeforeTracking.quaternion,
      coordinateScale:'absolute metres',
      cameraFovDegrees:xrCamera.fov,
    });
    setDiagnostic('renderer', 'pass', 'Three.js scene created; renderer is attached to the XR canvas.');
    setDiagnostic('camera', 'active', 'XR8 camera pose synchronization configured; waiting for camera permission and frames.');
    stageStatus.textContent = '3D scene ready · waiting for camera';
    clearTimeout(rendererTimer);
  },
  onUpdate: ({processCpuResult}) => {
    updateCount += 1;
    const reality = processCpuResult?.reality;
    if (!reality || !finitePose(reality)) {
      lastTrackingUsable = false;
      if (lastTrackingLabel !== 'NO_POSE') {
        lastTrackingLabel = 'NO_POSE';
        setDiagnostic('pose', 'active', 'No valid pose in the latest XR update; enhanced translation is paused.');
        stageStatus.textContent = 'Waiting for a tracked pose';
        pulse.className = 'pulse limited';
      }
      publishFrameRates(performance.now());
      if (updateCount === 1) setDiagnostic('pose', 'active', 'XR pipeline is updating; waiting for the first valid tracked pose.');
      return;
    }

    latestPose = {
      position: {x:reality.position.x, y:reality.position.y, z:reality.position.z},
      rotation: {x:reality.rotation.x, y:reality.rotation.y, z:reality.rotation.z, w:reality.rotation.w},
    };
    const trackingStatus = reality.trackingStatus || 'UNKNOWN';
    const initializing = reality.trackingReason === 'INITIALIZING';
    const limited = trackingStatus !== 'NORMAL' || initializing;
    lastTrackingUsable = !limited;
    poseUpdateFrameCount += 1;

    const cameraWorld = getRenderedCameraWorldPosition();
    if (!originPose && lastTrackingUsable) recenterOffice();
    applyTranslationSensitivity(reality, cameraWorld);
    clearTimeout(poseTimer);
    const statusText = `${trackingStatus}${reality.trackingReason ? ` · ${reality.trackingReason}` : ''}`;
    if (statusText !== lastTrackingLabel) {
      lastTrackingLabel = statusText;
      setDiagnostic('pose', limited ? 'active' : 'pass', `6DoF pose ${limited ? 'limited' : 'valid'} (${statusText}).`);
      stageStatus.textContent = limited ? `Tracking ${trackingStatus.toLowerCase()}${reality.trackingReason ? ` · ${reality.trackingReason.toLowerCase()}` : ''}` : 'Tracking normally';
      pulse.className = `pulse ${limited ? 'limited' : 'live'}`;
    }

    const now = performance.now();
    if (now - lastHudUpdateAt >= 100) {
      updatePoseDiagnostics(reality, cameraWorld);
      setValue('qx-value', latestPose.rotation.x);
      setValue('qy-value', latestPose.rotation.y);
      setValue('qz-value', latestPose.rotation.z);
      setValue('qw-value', latestPose.rotation.w);
      lastHudUpdateAt = now;
    }
    publishFrameRates(now);
  },
  onRender: () => {
    renderFrameCount += 1;
    publishFrameRates(performance.now());
  },
  onException: ({exception}) => {
    const detail = readableError(exception);
    const failedKey = office ? 'pipeline' : 'renderer';
    failStage(failedKey, `The XR engine reported a runtime exception: ${detail}`, detail);
  },
};

async function requestMotionPermission() {
  for (const [label, eventType] of [['orientation', window.DeviceOrientationEvent], ['motion', window.DeviceMotionEvent]]) {
    if (typeof eventType?.requestPermission !== 'function') continue;
    setDiagnostic('capabilities', 'active', `Requesting iOS ${label} sensor permission from the Start button…`);
    const result = await eventType.requestPermission();
    if (result !== 'granted') {
      throw Object.assign(new Error(`iOS ${label} permission was ${result}. Enable it and reload this page.`), {name:'NotAllowedError'});
    }
  }
  setDiagnostic('capabilities', 'pass', 'Required camera, orientation, WebGL, and WebAssembly SIMD capabilities are available; sensor permission is granted when required.');
}

async function startTracking() {
  if (!XR8Ref || running) return;
  clearError();
  startButton.disabled = true;
  recenterButton.disabled = true;
  stopButton.disabled = true;
  originPose = null;
  latestPose = null;
  cameraOriginPosition = null;
  firstPoseComparisonLogged = false;
  movementThresholdCrossed = false;
  updateCount = 0;
  renderFrameCount = 0;
  poseUpdateFrameCount = 0;
  rateWindowStart = performance.now();
  lastHudUpdateAt = 0;
  lastTrackingUsable = false;
  lastTrackingLabel = '';

  let startupStage = 'permissions';
  try {
    engineStatus.textContent = 'Requesting iPhone motion and orientation permission if required…';
    await requestMotionPermission();

    if (!pipelineAdded) {
      startupStage = 'pipeline';
      setDiagnostic('pipeline', 'active', 'Registering Three.js renderer, XR8 world tracking, and diagnostic callbacks…');
      try {
        if (!trackingConfigured) {
          XR8Ref.XrController.configure({disableWorldTracking:false, leftHandedAxes:false, scale:'absolute'});
          trackingConfigured = true;
          setDiagnostic('pipeline', 'active', 'World tracking configured for absolute metre scale and right-handed Three.js axes.');
        }
        XR8Ref.addCameraPipelineModules([
          XR8Ref.Threejs.pipelineModule(),
          XR8Ref.XrController.pipelineModule(),
          readTracking,
        ]);
      } catch (error) {
        throw new Error(`Pipeline registration failed: ${readableError(error)}`);
      }
      pipelineAdded = true;
      setDiagnostic('pipeline', 'pass', 'Three.js, XrController, and pose diagnostic modules registered.');
    }

    startupStage = 'camera';
    setDiagnostic('camera', 'active', 'Starting XR8; Safari should ask for camera access.');
    setDiagnostic('renderer', 'waiting', 'Waiting for XR start callback.');
    setDiagnostic('pose', 'waiting', 'Waiting for camera frames and the first 6DoF pose.');
    stageStatus.textContent = 'Starting camera and visual tracking…';
    engineStatus.textContent = 'Opening the rear camera and starting world tracking…';
    rendererTimer = window.setTimeout(() => {
      if (running && office === null) failStage('renderer', 'XR8 did not initialize the Three.js scene within 15 seconds. Check that WebGL is enabled and inspect the XR runtime error details.', 'No Three.js XR start callback received.');
    }, 15000);

    XR8Ref.run({
      canvas,
      allowedDevices: XR8Ref.XrConfig.device().MOBILE,
      cameraConfig: {direction: XR8Ref.XrConfig.camera().BACK},
      glContextConfig: {alpha:false, antialias:true, depth:true, stencil:false},
    });
    running = true;
    recenterButton.disabled = false;
    stopButton.disabled = false;
  } catch (error) {
    running = false;
    clearTimeout(rendererTimer);
    const message = readableError(error);
    if (startupStage === 'permissions') {
      setDiagnostic('capabilities', 'fail', message);
    } else if (startupStage === 'pipeline') {
      setDiagnostic('pipeline', 'fail', message);
    } else {
      setDiagnostic('camera', error?.name === 'NotAllowedError' ? 'fail' : 'waiting', error?.name === 'NotAllowedError' ? 'Camera permission was denied.' : 'Camera has not started.');
    }
    showError(message);
    engineStatus.textContent = 'Startup failed. Correct the indicated issue and retry.';
    stageStatus.textContent = 'Could not start tracking';
    console.error('[Physical Walk: startup]', error);
    try { XR8Ref.stop(); } catch { /* XR8 may not have started yet. */ }
    startButton.disabled = false;
  }
}

function stopTracking() {
  clearTimeout(poseTimer);
  clearTimeout(rendererTimer);
  if (running) {
    try {
      XR8Ref.stop();
      setDiagnostic('camera', 'pass', 'XR8.stop() called; the engine documents that this closes the camera feed.');
      setDiagnostic('pose', 'waiting', 'Stopped; no position is being estimated.');
    } catch (error) {
      failStage('camera', `Could not stop the camera pipeline: ${readableError(error)}`);
    }
  }
  running = false;
  lastTrackingUsable = false;
  lastTrackingLabel = '';
  latestPose = null;
  originPose = null;
  cameraOriginPosition = null;
  movementThresholdCrossed = false;
  $('raw-x-value').textContent = $('raw-y-value').textContent = $('raw-z-value').textContent = '—';
  $('camera-x-value').textContent = $('camera-y-value').textContent = $('camera-z-value').textContent = '—';
  $('distance-value').textContent = '—';
  $('movement-value').textContent = '— / — m';
  $('scale-value').textContent = 'Waiting for a valid tracked pose.';
  $('qx-value').textContent = $('qy-value').textContent = $('qz-value').textContent = $('qw-value').textContent = '—';
  stageStatus.textContent = 'Stopped';
  engineStatus.textContent = 'Camera and tracking stopped.';
  pulse.className = 'pulse';
  startButton.disabled = !XR8Ref;
  recenterButton.disabled = true;
  stopButton.disabled = true;
  const performanceRow = document.querySelector('[data-diagnostic="performance"]');
  if (performanceRow) {
    performanceRow.dataset.state = 'waiting';
    performanceRow.querySelector('b').textContent = 'Waiting';
    $('performance-value').textContent = `Tracking stopped · scale ${positionalSensitivity.toFixed(1)}×`;
  }
}

async function boot() {
  if (!applyCapabilities()) return;
  const sdkState = window.__physicalWalkSdk;
  if (!sdkState?.promise) {
    failStage('sdk', 'The XR Engine loader did not initialize. Reload the page; if the issue persists, verify index.html and the jsDelivr URL.', 'SDK loader state is missing.');
    return;
  }

  setDiagnostic('sdk', 'active', 'Downloading pinned @8thwall/engine-binary@1.0.0 from jsDelivr…');
  try {
    const threeModule = await import('three');
    THREE = threeModule;
    cameraWorldScratch = new THREE.Vector3();
    cameraDeltaScratch = new THREE.Vector3();
    appliedCameraPositionScratch = new THREE.Vector3();
    latestUsableCameraPosition = new THREE.Vector3();
    officeBasePosition = new THREE.Vector3();
    officeBaseQuaternion = new THREE.Quaternion();
    positionalSensitivity = Number(sensitivitySelect?.value || 1.5);
    // XR8.Threejs reads Three from the global namespace. A module import alone is insufficient.
    window.THREE = THREE;
    setDiagnostic('three', 'pass', `Three.js ${THREE.REVISION} loaded and exposed as window.THREE.`);
  } catch (error) {
    failStage('three', `Three.js could not load from its import-map URL: ${readableError(error)}`, 'Three.js import failed.');
    return;
  }

  try {
    XR8Ref = await sdkState.promise;
    setDiagnostic('sdk', 'pass', 'Pinned XR Engine script loaded successfully.');
    const requiredFunctions = [
      ['XR8.addCameraPipelineModules', XR8Ref.addCameraPipelineModules],
      ['XR8.run', XR8Ref.run],
      ['XR8.stop', XR8Ref.stop],
      ['XR8.Threejs.pipelineModule', XR8Ref.Threejs?.pipelineModule],
      ['XR8.XrController.pipelineModule', XR8Ref.XrController?.pipelineModule],
      ['XR8.XrConfig', XR8Ref.XrConfig],
    ];
    const missing = requiredFunctions.filter(([, value]) => typeof value !== 'function' && typeof value !== 'object').map(([name]) => name);
    if (missing.length) throw new Error(`XR8 loaded, but required API entries are missing: ${missing.join(', ')}.`);
    setDiagnostic('api', 'pass', `window.XR8 ready${typeof XR8Ref.version === 'function' ? ` (engine ${XR8Ref.version()})` : ''}.`);
    engineStatus.textContent = 'Startup checks passed. Start only when you are in a clear area.';
    startButton.disabled = false;
  } catch (error) {
    const message = readableError(error);
    setDiagnostic('sdk', 'fail', sdkState.error || message);
    failStage('api', message, 'XR8 runtime did not become ready.');
  }
}

sensitivitySelect?.addEventListener('change', () => {
  const nextSensitivity = Number(sensitivitySelect.value);
  if (![1, 1.5, 2].includes(nextSensitivity)) return;
  positionalSensitivity = nextSensitivity;
  $('applied-scale-value').textContent = `${positionalSensitivity.toFixed(positionalSensitivity % 1 ? 1 : 0)}×`;
  if (running && lastTrackingUsable && latestUsableCameraPosition && cameraOriginPosition) {
    applyTranslationSensitivity({trackingStatus:'NORMAL'}, latestUsableCameraPosition);
    updatePoseDiagnostics({trackingStatus:'NORMAL'}, latestUsableCameraPosition);
  }
  console.info('[Physical Walk: positional sensitivity]', `${positionalSensitivity}×`);
});

startButton.addEventListener('click', startTracking);
recenterButton.addEventListener('click', recenterOffice);
stopButton.addEventListener('click', stopTracking);
window.addEventListener('pagehide', () => { if (running) XR8Ref?.stop(); });

void boot().catch(error => {
  failStage('api', `Unexpected startup error: ${readableError(error)}`);
});
