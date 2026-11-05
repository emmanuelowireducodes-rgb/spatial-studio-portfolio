import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Euler, MathUtils, Quaternion, Vector3, type PerspectiveCamera } from 'three';
import { cameraControl } from './cameraControl';
import { constrainOfficeCameraPath } from './positionalXR';

type Pose = { position: Vector3; rotation: Quaternion; status: string; reason: string };
type XR8Module = {
  name: string;
  XrController: { configure: (options: object) => void; pipelineModule: () => object };
  XrConfig: { device: () => { MOBILE: unknown }; camera: () => { BACK: unknown } };
  addCameraPipelineModules: (modules: object[]) => void;
  run: (options: object) => void;
  stop: () => void;
};
export type PhysicalWalkBridge = { enter: (permissionsGranted?:boolean) => Promise<void>; exit: () => Promise<void>; recenter: () => void };
export type PhysicalWalkDiagnostics = {
  fps:number;
  trackingHz:number;
  poseAgeMs:number;
  rawPosition:[number,number,number] | null;
  appliedPosition:[number,number,number];
  trackingState:string;
  collisionConstrained:boolean;
  renderLoop:string;
  trackingStatus:string;
  trackingReason:string;
  poseValid:boolean;
  poseRejectionReason:string;
  recoveryState:string;
  stateSeconds:Record<string,number>;
  rejectedFrames:Record<string,number>;
};
type SDKWindow = Window & { XR8?: XR8Module; __spatialXR8?: Promise<XR8Module> };

function loadXR8() {
  const target = window as SDKWindow;
  if (target.XR8) return Promise.resolve(target.XR8);
  if (target.__spatialXR8) return target.__spatialXR8;
  target.__spatialXR8 = new Promise<XR8Module>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/dist/xr.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.preloadChunks = 'slam';
    const timeout = window.setTimeout(() => reject(new Error('Timed out loading the 8th Wall tracking engine. Check your network and reload.')), 20000);
    const ready = () => {
      const xr8 = target.XR8;
      if (!xr8) return;
      window.clearTimeout(timeout);
      resolve(xr8);
    };
    window.addEventListener('xrloaded', ready, {once:true});
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('The 8th Wall tracking engine could not load. Check the network, content blocker, or site policy.'));
    };
    script.onload = ready;
    document.head.appendChild(script);
  }).catch(error => {
    target.__spatialXR8 = undefined;
    throw error;
  });
  return target.__spatialXR8;
}

async function requestSensorPermissions() {
  for (const constructor of [window.DeviceOrientationEvent, window.DeviceMotionEvent]) {
    const request = (constructor as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> } | undefined)?.requestPermission;
    if (typeof request === 'function' && await request.call(constructor) !== 'granted') {
      throw new Error('Motion and orientation permission was not granted. Enable sensor access for this site and try again.');
    }
  }
}

export function PhysicalWalkXRController({
  bridgeRef,
  requested,
  suspended,
  onBridgeReady,
  onStatus,
  onError,
  onActiveChange,
  diagnosticsEnabled,
  onDiagnostics,
}: {
  bridgeRef: React.MutableRefObject<PhysicalWalkBridge | null>;
  requested: boolean;
  suspended: boolean;
  onBridgeReady: (ready:boolean) => void;
  onStatus: (status: string) => void;
  onError: (message: string) => void;
  onActiveChange: (active: boolean) => void;
  diagnosticsEnabled:boolean;
  onDiagnostics:(diagnostics:PhysicalWalkDiagnostics)=>void;
}) {
  const { advance, camera, gl } = useThree();
  const requestedRef = useRef(requested);
  const suspendedRef = useRef(suspended);
  requestedRef.current = requested;
  suspendedRef.current = suspended;
  const callbacksRef = useRef({onStatus,onError,onActiveChange,onDiagnostics,onBridgeReady});
  const diagnosticsEnabledRef = useRef(diagnosticsEnabled);
  callbacksRef.current = {onStatus,onError,onActiveChange,onDiagnostics,onBridgeReady};
  diagnosticsEnabledRef.current = diagnosticsEnabled;

  useEffect(() => {
    let disposed = false;
    let xr8: XR8Module | null = null;
    let modulesRegistered = false;
    let active = false;
    let runRequested = false;
    let trackingUsable = false;
    let rebaseAfterSuspend = false;
    let recenterRequested = false;
    let originReady = false;
    let lastStatus = '';
    let lastAcceptedAt = 0;
    let latestValidPoseAt = 0;
    let pendingPoseAt = 0;
    let pendingPoseFrames = 0;
    let filterAt = 0;
    let filterReady = false;
    let lastDiagnosticsAt = 0;
    let diagnosticsWasEnabled = false;
    let rateWindowAt = 0;
    let renderFrames = 0;
    let trackingFrames = 0;
    let collisionConstrained = false;
    let trackingState = 'Waiting for camera';
    let xrTrackingStatus = 'UNKNOWN';
    let xrTrackingReason = '';
    let poseValid = false;
    let poseRejectionReason = '';
    let recoveryState = 'idle';
    let recoveryNeedsPair = false;
    let trackingStateSince = performance.now();
    const stateElapsedMs:Record<string,number> = {};
    const rejectedFrames:Record<string,number> = {};
    let hasLatestPose = false;
    let originPosition = new Vector3();
    let originRotation = new Quaternion();
    const officeOrigin = new Vector3();
    const xrToOffice = new Quaternion();
    const inverseTrackedRotation = new Quaternion();
    const trackedPosition = new Vector3();
    const mappedDelta = new Vector3();
    const candidatePosition = new Vector3();
    const constrainedPosition = new Vector3();
    const pathScratch = new Vector3();
    const pathSlideX = new Vector3();
    const pathSlideZ = new Vector3();
    const latestTrackedPosition = new Vector3();
    const latestTrackedRotation = new Quaternion();
    const latestPose: Pose = {position:latestTrackedPosition,rotation:latestTrackedRotation,status:'UNKNOWN',reason:''};
    const incomingPosition = new Vector3();
    const incomingRotation = new Quaternion();
    const lastAcceptedPosition = new Vector3();
    const lastAcceptedRotation = new Quaternion();
    const pendingPosition = new Vector3();
    const pendingRotation = new Quaternion();
    const filteredPosition = new Vector3();
    const filteredRotation = new Quaternion();
    const cameraEuler = new Euler();
    const validPoseValues = [0,0,0,0,0,0,0];
    const sensitivity = 2;
    const originalPixelRatio = gl.getPixelRatio();
    const publishStatus = (status:string) => {
      if (status === lastStatus) return;
      lastStatus = status;
      callbacksRef.current.onStatus(status);
    };
    const setTrackingState = (next:string) => {
      if (next === trackingState) return;
      const now = performance.now();
      stateElapsedMs[trackingState] = (stateElapsedMs[trackingState] || 0) + Math.max(0,now-trackingStateSince);
      trackingStateSince = now;
      trackingState = next;
    };
    const rejectPose = (reason:string, uiStatus:string) => {
      poseValid = false;
      poseRejectionReason = reason;
      rejectedFrames[reason] = (rejectedFrames[reason] || 0) + 1;
      trackingUsable = false;
      rebaseAfterSuspend = true;
      recoveryState = 'awaiting valid poses';
      setTrackingState('Pose unavailable');
      publishStatus(uiStatus);
    };

    const establishOrigin = () => {
      if (!hasLatestPose || !trackingUsable) return false;
      originPosition.copy(latestPose.position);
      originRotation.copy(latestPose.rotation);
      camera.updateMatrixWorld(true);
      officeOrigin.copy(camera.position);
      xrToOffice.copy(camera.quaternion).multiply(inverseTrackedRotation.copy(originRotation).invert());
      filteredPosition.copy(latestPose.position);
      filteredRotation.copy(latestPose.rotation);
      filterAt = performance.now();
      filterReady = true;
      rebaseAfterSuspend = false;
      recenterRequested = false;
      originReady = true;
      return true;
    };

    const publishDiagnostics = (now:number) => {
      if (!diagnosticsEnabledRef.current) {
        diagnosticsWasEnabled = false;
        renderFrames = 0;
        trackingFrames = 0;
        return;
      }
      if (!diagnosticsWasEnabled) {
        diagnosticsWasEnabled = true;
        renderFrames = 0;
        trackingFrames = 0;
        rateWindowAt = now;
        lastDiagnosticsAt = now;
      }
      renderFrames += 1;
      if (now - lastDiagnosticsAt < 400) return;
      const elapsed = rateWindowAt ? Math.max(1,now-rateWindowAt) : 400;
      callbacksRef.current.onDiagnostics({
        fps:renderFrames*1000/elapsed,
        trackingHz:trackingFrames*1000/elapsed,
        poseAgeMs:latestValidPoseAt ? Math.max(0,now-latestValidPoseAt) : Infinity,
        rawPosition:hasLatestPose ? latestPose.position.toArray() as [number,number,number] : null,
        appliedPosition:camera.position.toArray() as [number,number,number],
        trackingState,
        collisionConstrained,
        renderLoop:'XR8 onRender → R3F advance (single canvas)',
        trackingStatus:xrTrackingStatus,
        trackingReason:xrTrackingReason,
        poseValid,
        poseRejectionReason,
        recoveryState,
        stateSeconds:Object.fromEntries(Object.entries({...stateElapsedMs,[trackingState]:(stateElapsedMs[trackingState]||0)+Math.max(0,now-trackingStateSince)}).map(([key,value])=>[key,Math.round(value/1000)])),
        rejectedFrames:{...rejectedFrames},
      });
      renderFrames = 0;
      trackingFrames = 0;
      rateWindowAt = now;
      lastDiagnosticsAt = now;
    };

    const poseModule = {
      name: 'spatial-studio-physical-walk',
      onCameraStatusChange: ({status}: {status:string}) => {
        if (status === 'requesting') publishStatus('Waiting for iPhone camera permission…');
        else if (status === 'hasStream') publishStatus('Camera permission granted; starting visual tracking…');
        else if (status === 'hasVideo') publishStatus('Camera active; locating the office origin…');
        else if (status === 'failed') {
          callbacksRef.current.onError('Safari could not open the rear camera. Allow camera access for this site, close other camera apps, and retry.');
          void stopEngine();
        }
      },
      onStart: () => {
        if (disposed || !requestedRef.current || !runRequested) { void stopEngine(); return; }
        active = true;
        cameraControl.physicalWalkActive = true;
        trackingUsable = false;
        originReady = false;
        filterReady = false;
        lastAcceptedAt = 0;
        latestValidPoseAt = 0;
        pendingPoseFrames = 0;
        renderFrames = 0;
        trackingFrames = 0;
        rateWindowAt = performance.now();
        lastDiagnosticsAt = rateWindowAt;
        hasLatestPose = false;
        callbacksRef.current.onActiveChange(true);
        publishStatus('Tracking starting… keep the phone on a detailed, well-lit view.');
      },
      onCanvasSizeChange: ({canvasWidth,canvasHeight}: {canvasWidth:number;canvasHeight:number}) => {
        if (canvasWidth <= 0 || canvasHeight <= 0) return;
        // XR8 resizes its tracking canvas. Keep the existing R3F renderer and camera projection in sync.
        gl.setPixelRatio(1);
        gl.setSize(canvasWidth,canvasHeight,false);
        const perspective = camera as PerspectiveCamera;
        perspective.aspect = canvasWidth / canvasHeight;
        perspective.updateProjectionMatrix();
      },
      onUpdate: ({processCpuResult}: {processCpuResult?: {reality?: {position?: {x:number;y:number;z:number}; rotation?: {x:number;y:number;z:number;w:number}; trackingStatus?: string; trackingReason?: string}}}) => {
        const reality = processCpuResult?.reality;
        const position = reality?.position;
        const rotation = reality?.rotation;
        const now = performance.now();
        const status = reality?.trackingStatus || 'UNKNOWN';
        const reason = reality?.trackingReason || '';
        xrTrackingStatus = status;
        xrTrackingReason = reason;
        if (status === 'LIMITED' || status === 'INITIALIZING' || reason === 'INITIALIZING') {
          if (trackingState !== 'XR8 LIMITED') recoveryNeedsPair = true;
          trackingUsable = false;
          rebaseAfterSuspend = true;
          pendingPoseFrames = 0;
          recoveryState = 'holding last safe camera';
          poseValid = false;
          poseRejectionReason = '';
          setTrackingState('XR8 LIMITED');
          publishStatus('Finding position…');
          return;
        }
        if (status !== 'NORMAL') {
          trackingUsable = false;
          recoveryState = 'waiting for XR8 NORMAL';
          setTrackingState(`XR8 ${status}`);
          publishStatus('Camera pose temporarily unavailable');
          return;
        }
        if (!position || !rotation) {
          rejectPose('missing position or orientation','Camera pose temporarily unavailable');
          return;
        }
        validPoseValues[0]=position.x;validPoseValues[1]=position.y;validPoseValues[2]=position.z;
        validPoseValues[3]=rotation.x;validPoseValues[4]=rotation.y;validPoseValues[5]=rotation.z;validPoseValues[6]=rotation.w;
        if (!Number.isFinite(validPoseValues[0])||!Number.isFinite(validPoseValues[1])||!Number.isFinite(validPoseValues[2])||!Number.isFinite(validPoseValues[3])||!Number.isFinite(validPoseValues[4])||!Number.isFinite(validPoseValues[5])||!Number.isFinite(validPoseValues[6])) {
          rejectPose('non-finite pose','Camera pose temporarily unavailable');
          return;
        }
        incomingPosition.set(position.x,position.y,position.z);
        incomingRotation.set(rotation.x,rotation.y,rotation.z,rotation.w);
        const quaternionLengthSq = incomingRotation.lengthSq();
        if (quaternionLengthSq < .8 || quaternionLengthSq > 1.2) {
          rejectPose('invalid quaternion norm','Camera pose temporarily unavailable');
          return;
        }
        incomingRotation.normalize();
        const poseDeltaTime = lastAcceptedAt ? Math.max(.001,(now-lastAcceptedAt)/1000) : 1;
        // Validate raw XR metres before applying the 2× virtual translation gain.
        const recovering = recoveryNeedsPair || rebaseAfterSuspend;
        const positionJump = !recovering && lastAcceptedAt > 0 && incomingPosition.distanceTo(lastAcceptedPosition) > Math.max(.35,poseDeltaTime*4.5);
        const rotationJump = !recovering && lastAcceptedAt > 0 && incomingRotation.angleTo(lastAcceptedRotation) > Math.max(.8,poseDeltaTime*20);
        if (recovering && pendingPoseFrames === 0) {
          pendingPosition.copy(incomingPosition); pendingRotation.copy(incomingRotation); pendingPoseAt=now; pendingPoseFrames=1;
          recoveryState='confirming fresh pose';
          poseValid=true; poseRejectionReason='';
          setTrackingState('Recovering');
          publishStatus('Finding position…');
          return;
        }
        if (recovering && pendingPoseFrames > 0) {
          const pendingDt=Math.max(.001,(now-pendingPoseAt)/1000);
          const pairStable=incomingPosition.distanceTo(pendingPosition)<=Math.max(.16,pendingDt*4.5) && incomingRotation.angleTo(pendingRotation)<=Math.max(.4,pendingDt*14);
          if (!pairStable) {
            pendingPosition.copy(incomingPosition); pendingRotation.copy(incomingRotation); pendingPoseAt=now; pendingPoseFrames=1;
            recoveryState='confirming fresh pose';
            setTrackingState('Recovering');
            publishStatus('Finding position…');
            return;
          }
          recoveryNeedsPair=false;
          pendingPoseFrames=0;
          // Keep camera translation and viewing direction fixed while accepting the new XR coordinate origin.
          rebaseAfterSuspend=true;
          lastAcceptedAt=0;
          recoveryState='rebased';
        }
        if (positionJump || rotationJump) {
          const pendingDeltaTime = pendingPoseAt ? Math.max(.001,(now-pendingPoseAt)/1000) : 1;
          const stableWithPending = pendingPoseFrames > 0 && incomingPosition.distanceTo(pendingPosition) <= Math.max(.12,pendingDeltaTime*3.5) && incomingRotation.angleTo(pendingRotation) <= Math.max(.35,pendingDeltaTime*12);
          if (!stableWithPending) {
            pendingPosition.copy(incomingPosition);
            pendingRotation.copy(incomingRotation);
            pendingPoseAt = now;
            pendingPoseFrames = 1;
            trackingUsable = false;
            rebaseAfterSuspend = true;
            poseRejectionReason='raw motion spike pending confirmation';
            rejectedFrames['raw motion spike pending confirmation'] = (rejectedFrames['raw motion spike pending confirmation'] || 0) + 1;
            recoveryState='spike confirmation';
            setTrackingState('Pose reacquiring');
            publishStatus('Finding position…');
            return;
          }
          pendingPoseFrames += 1;
          pendingPosition.copy(incomingPosition);
          pendingRotation.copy(incomingRotation);
          pendingPoseAt = now;
          if (pendingPoseFrames < 2) return;
          rebaseAfterSuspend = true;
        } else {
          pendingPoseFrames = 0;
          pendingPoseAt = 0;
        }

        latestTrackedPosition.copy(incomingPosition);
        latestTrackedRotation.copy(incomingRotation);
        latestPose.status = status;
        latestPose.reason = reason;
        hasLatestPose = true;
        lastAcceptedPosition.copy(incomingPosition);
        lastAcceptedRotation.copy(incomingRotation);
        lastAcceptedAt = now;
        latestValidPoseAt = now;
        if (diagnosticsEnabledRef.current) trackingFrames += 1;
        trackingUsable = true;
        poseValid=true; poseRejectionReason='';
        setTrackingState('NORMAL');
        recoveryState='tracking';
        publishStatus(collisionConstrained?'Movement blocked by furniture':`Tracking normally · translation ${sensitivity.toFixed(1)}×`);
      },
      onRender: () => {
        if (!active || !requestedRef.current) return;
        const now = performance.now();
        if (suspendedRef.current) {
          rebaseAfterSuspend = true;
        } else if (trackingUsable && hasLatestPose) {
          if (now-latestValidPoseAt > 200) {
            trackingUsable = false;
            rebaseAfterSuspend = true;
            recoveryNeedsPair=true;
            recoveryState='waiting for fresh frames';
            setTrackingState('Pose stale');
            publishStatus('Camera pose temporarily unavailable');
          }
        }
        if (!suspendedRef.current && trackingUsable && hasLatestPose) {
          if (!originReady || recenterRequested || rebaseAfterSuspend) establishOrigin();
          if (originReady) {
            const filterDelta = MathUtils.clamp((now-filterAt)/1000,0,.1);
            filterAt = now;
            if (!filterReady) {
              filteredPosition.copy(latestPose.position);
              filteredRotation.copy(latestPose.rotation);
              filterReady = true;
            } else {
              filteredPosition.lerp(latestPose.position,1-Math.exp(-34*filterDelta));
              filteredRotation.slerp(latestPose.rotation,1-Math.exp(-44*filterDelta));
            }
            trackedPosition.copy(filteredPosition);
            mappedDelta.copy(trackedPosition).sub(originPosition).applyQuaternion(xrToOffice);
            candidatePosition.copy(officeOrigin).addScaledVector(mappedDelta,sensitivity);
            constrainOfficeCameraPath(camera.position,candidatePosition,constrainedPosition,pathScratch,pathSlideX,pathSlideZ);
            collisionConstrained = candidatePosition.distanceToSquared(constrainedPosition) > .0004;
            camera.position.copy(constrainedPosition);
            camera.quaternion.copy(xrToOffice).multiply(filteredRotation);
            camera.updateMatrixWorld(true);
            cameraControl.currentQuaternion.copy(camera.quaternion);
            cameraEuler.setFromQuaternion(camera.quaternion,'YXZ');
            cameraControl.yaw = cameraEuler.y;
            cameraControl.pitch = cameraEuler.x;
          }
        }
        if (collisionConstrained) publishStatus('Movement blocked by furniture');
        else if (trackingUsable) publishStatus(`Tracking normally · translation ${sensitivity.toFixed(1)}×`);
        // 8th Wall owns the camera-frame loop; R3F advances the existing office once per XR8 frame.
        // Its Threejs and camera-texture modules are intentionally omitted, avoiding another renderer or passthrough.
        gl.resetState();
        advance(performance.now());
        publishDiagnostics(performance.now());
      },
      onException: ({exception}: {exception?: unknown}) => {
        const message = exception instanceof Error ? exception.message : String(exception || 'Unknown XR runtime error.');
        callbacksRef.current.onError(`Physical Walk stopped: ${message}`);
        void stopEngine();
      },
    };

    async function stopEngine() {
      if (active || runRequested) {
        active = false;
        runRequested = false;
        trackingUsable = false;
        try { xr8?.stop(); } catch { /* Preserve the Touch and Motion modes if XR8 is already stopped. */ }
      }
      originReady = false;
      filterReady = false;
      hasLatestPose = false;
      lastAcceptedAt = 0;
      latestValidPoseAt = 0;
      pendingPoseFrames = 0;
      const returnEuler = cameraEuler.setFromQuaternion(camera.quaternion,'YXZ');
      cameraControl.panoramaYaw = returnEuler.y;
      cameraControl.panoramaPitch = MathUtils.clamp(returnEuler.x,-75*Math.PI/180,75*Math.PI/180);
      if (cameraControl.panoramaInput === 'motion' && cameraControl.sensorReady) {
        cameraControl.sensorOffset.copy(cameraControl.currentQuaternion).multiply(cameraControl.rawSensorQuaternion.clone().invert());
        cameraControl.sensorTarget.copy(cameraControl.currentQuaternion);
      }
      cameraControl.physicalWalkActive = false;
      if (!runRequested) {
        const bounds = gl.domElement.getBoundingClientRect();
        gl.setPixelRatio(originalPixelRatio);
        if (bounds.width > 0 && bounds.height > 0) {
          gl.setSize(bounds.width,bounds.height,false);
          const perspective = camera as PerspectiveCamera;
          perspective.aspect = bounds.width / bounds.height;
          perspective.updateProjectionMatrix();
        }
      }
      callbacksRef.current.onActiveChange(false);
    }

    const bridge: PhysicalWalkBridge = {
      enter: async (permissionsGranted = false) => {
        if (active || disposed) return;
        if (!window.isSecureContext) throw new Error('Physical Walk requires this portfolio to be opened over HTTPS.');
        if (gl.xr.isPresenting) throw new Error('Exit the current positional AR session before starting Physical Walk.');
        const permissionRequest = permissionsGranted ? Promise.resolve() : requestSensorPermissions();
        publishStatus('Requesting motion permission and loading the tracking engine…');
        await permissionRequest;
        if (disposed || !requestedRef.current) return;
        xr8 = await loadXR8();
        if (disposed || !requestedRef.current) return;
        if (!modulesRegistered) {
          xr8.XrController.configure({disableWorldTracking:false,leftHandedAxes:false,scale:'absolute'});
          xr8.addCameraPipelineModules([xr8.XrController.pipelineModule(),poseModule]);
          modulesRegistered = true;
        }
        cameraControl.physicalWalkActive = true;
        gl.setPixelRatio(1);
        publishStatus('Opening rear camera and starting 8th Wall visual tracking…');
        runRequested = true;
        try {
          xr8.run({
            canvas:gl.domElement,
            ownRunLoop:true,
            allowedDevices:xr8.XrConfig.device().MOBILE,
            cameraConfig:{direction:xr8.XrConfig.camera().BACK},
            glContextConfig:{alpha:true,antialias:false,depth:true,stencil:false},
          });
        } catch (error) {
          runRequested = false;
          cameraControl.physicalWalkActive = false;
          throw error;
        }
      },
      exit: stopEngine,
      recenter: () => { recenterRequested = true; },
    };

    bridgeRef.current = bridge;
    callbacksRef.current.onBridgeReady(true);
    return () => {
      disposed = true;
      bridgeRef.current = null;
      callbacksRef.current.onBridgeReady(false);
      if (active) void stopEngine();
      cameraControl.physicalWalkActive = false;
    };
  }, [advance, bridgeRef, camera, gl]);

  return null;
}
