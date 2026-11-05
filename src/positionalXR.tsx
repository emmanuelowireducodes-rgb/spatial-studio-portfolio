import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Group, Quaternion, Vector3 } from 'three';
import { cameraControl, ROOM } from './cameraControl';

export type PositionalXRBridge = {
  enter: () => Promise<void>;
  exit: () => Promise<void>;
  recenter: () => void;
};

type XRNavigator = Navigator & { xr?: XRSystem };
type Calibration = {
  xrOrigin: Vector3;
  officeOrigin: Vector3;
  xrToOffice: Quaternion;
  officeToXR: Quaternion;
  previousOfficePosition: Vector3;
};

// Keep the viewer about 0.3 m clear of walls and wall-mounted exhibits, below the chandelier, and above the floor.
const XR_ROOM_BOUNDS = { minX: -9.15, maxX: 9.15, minY: -0.95, maxY: 4.1, minZ: -4.15, maxZ: 6.3 };
// Conservative floor-plan collision areas, expanded for the viewer's body radius.
const FURNITURE_ZONES = [
  { minX: -2.88, maxX: 2.88, minZ: -1.79, maxZ: 0.89 }, // Executive desk
  { minX: -0.78, maxX: 0.78, minZ: -3.48, maxZ: -1.62 }, // Executive chair
  { minX: 5.76, maxX: 7.10, minZ: 2.48, maxZ: 4.62 }, // Lounge table and gramophone
  { minX: 7.06, maxX: 8.98, minZ: 1.78, maxZ: 5.32 }, // Lounge sofa
  { minX: -9.18, maxX: -5.34, minZ: -4.78, maxZ: -3.76 }, // Library shelving
];

export async function detectPositionalXR(): Promise<boolean> {
  if (!window.isSecureContext) return false;
  try {
    const xr = (navigator as XRNavigator).xr;
    if (!xr) return false;
    return await xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

function isBlocked(position: Vector3) {
  if (position.x < XR_ROOM_BOUNDS.minX || position.x > XR_ROOM_BOUNDS.maxX ||
      position.y < XR_ROOM_BOUNDS.minY || position.y > XR_ROOM_BOUNDS.maxY ||
      position.z < XR_ROOM_BOUNDS.minZ || position.z > XR_ROOM_BOUNDS.maxZ) return true;
  return FURNITURE_ZONES.some(zone => position.x > zone.minX && position.x < zone.maxX && position.z > zone.minZ && position.z < zone.maxZ);
}

export function constrainOfficeCameraPath(from: Vector3, to: Vector3, result: Vector3, scratch: Vector3, slideX: Vector3, slideZ: Vector3) {
  const distance = from.distanceTo(to);
  const steps = Math.max(1, Math.ceil(distance / 0.08));
  result.copy(from);
  for (let index = 1; index <= steps; index++) {
    scratch.copy(from).lerp(to, index / steps);
    scratch.x = Math.max(XR_ROOM_BOUNDS.minX, Math.min(XR_ROOM_BOUNDS.maxX, scratch.x));
    scratch.y = Math.max(XR_ROOM_BOUNDS.minY, Math.min(XR_ROOM_BOUNDS.maxY, scratch.y));
    scratch.z = Math.max(XR_ROOM_BOUNDS.minZ, Math.min(XR_ROOM_BOUNDS.maxZ, scratch.z));
    if (!isBlocked(scratch)) {
      result.copy(scratch);
      continue;
    }

    // Slide along a wall or furniture footprint when one movement axis is clear.
    slideX.copy(scratch);
    slideX.z = result.z;
    slideZ.copy(scratch);
    slideZ.x = result.x;
    if (!isBlocked(slideX)) result.copy(slideX);
    else if (!isBlocked(slideZ)) result.copy(slideZ);
    else break;
  }
  return result;
}

export function PositionalXRController({
  worldRoot,
  bridgeRef,
  onBridgeReady,
  onActiveChange,
  onError,
}: {
  worldRoot: React.RefObject<Group | null>;
  bridgeRef: React.MutableRefObject<PositionalXRBridge | null>;
  onBridgeReady: (ready: boolean) => void;
  onActiveChange: (active: boolean) => void;
  onError: (message: string) => void;
}) {
  const { gl, scene } = useThree();
  const calibration = useRef<Calibration | null>(null);
  const recenterRequested = useRef(false);
  const viewerPosition = useRef(new Vector3());
  const viewerRotation = useRef(new Quaternion());
  const candidatePosition = useRef(new Vector3());
  const constrainedPosition = useRef(new Vector3());
  const scratchPosition = useRef(new Vector3());
  const slideXPosition = useRef(new Vector3());
  const slideZPosition = useRef(new Vector3());
  const clearAlpha = useRef(1);

  useEffect(() => {
    const xr = (navigator as XRNavigator).xr;
    if (!xr) return;
    let disposed = false;
    let activeSession: XRSession | null = null;
    const initialBackground = scene.background;

    const handleSessionEnd = () => {
      activeSession?.removeEventListener('end', handleSessionEnd);
      activeSession = null;
      calibration.current = null;
      recenterRequested.current = false;
      const root = worldRoot.current;
      if (root) {
        root.position.set(0, 0, 0);
        root.quaternion.identity();
      }
      scene.background = initialBackground;
      gl.setClearAlpha(clearAlpha.current);
      if (cameraControl.panoramaInput === 'motion' && cameraControl.sensorReady) {
        cameraControl.sensorOffset.copy(cameraControl.currentQuaternion).multiply(cameraControl.rawSensorQuaternion.clone().invert());
        cameraControl.sensorTarget.copy(cameraControl.currentQuaternion);
      }
      onActiveChange(false);
    };

    const bridge: PositionalXRBridge = {
      enter: async () => {
        if (!xr || activeSession || disposed) return;
        try {
          // Immersive AR needs camera passthrough; DOM overlay keeps exit and recenter controls visible.
          const session = await xr.requestSession('immersive-ar', {
            requiredFeatures: ['local', 'dom-overlay'],
            domOverlay: { root: document.body },
          });
          activeSession = session;
          session.addEventListener('end', handleSessionEnd);
          calibration.current = null;
          gl.xr.enabled = true;
          gl.xr.setReferenceSpaceType('local');
          clearAlpha.current = gl.getClearAlpha();
          gl.setClearColor(0x000000, 0);
          scene.background = null;
          await gl.xr.setSession(session);
          if (!disposed) onActiveChange(true);
        } catch {
          const failedSession = activeSession;
          activeSession = null;
          if (failedSession) {
            failedSession.removeEventListener('end', handleSessionEnd);
            void failedSession.end().catch(() => undefined);
          }
          const root = worldRoot.current;
          if (root) {
            root.position.set(0, 0, 0);
            root.quaternion.identity();
          }
          scene.background = initialBackground;
          gl.setClearAlpha(clearAlpha.current);
          onError('Positional AR could not start. This browser may not provide an AR session with the required controls.');
        }
      },
      exit: async () => {
        const session = gl.xr.getSession();
        if (session) await session.end();
      },
      recenter: () => { recenterRequested.current = true; },
    };

    bridgeRef.current = bridge;
    onBridgeReady(true);
    return () => {
      disposed = true;
      onBridgeReady(false);
      bridgeRef.current = null;
      if (activeSession) void activeSession.end();
      gl.xr.enabled = false;
    };
  }, [gl, scene, worldRoot, bridgeRef]);

  useFrame(() => {
    if (!gl.xr.isPresenting || !worldRoot.current) return;
    const referenceSpace = gl.xr.getReferenceSpace();
    const frame = gl.xr.getFrame();
    const pose = referenceSpace && frame?.getViewerPose(referenceSpace);
    if (!pose) return;

    const { position, orientation } = pose.transform;
    viewerPosition.current.set(position.x, position.y, position.z);
    viewerRotation.current.set(orientation.x, orientation.y, orientation.z, orientation.w);
    let current = calibration.current;

    if (!current) {
      const xrOrigin = viewerPosition.current.clone();
      const officeOrigin = new Vector3(0, ROOM.eyeY, 3.5);
      const xrToOffice = cameraControl.currentQuaternion.clone().multiply(viewerRotation.current.clone().invert());
      current = {
        xrOrigin,
        officeOrigin,
        xrToOffice,
        officeToXR: xrToOffice.clone().invert(),
        previousOfficePosition: officeOrigin.clone(),
      };
      calibration.current = current;
    }

    if (recenterRequested.current) {
      cameraControl.currentQuaternion.copy(current.xrToOffice).multiply(viewerRotation.current);
      current.xrOrigin.copy(viewerPosition.current);
      current.officeOrigin.set(0, ROOM.eyeY, 3.5);
      current.xrToOffice.copy(cameraControl.currentQuaternion).multiply(viewerRotation.current.clone().invert());
      current.officeToXR.copy(current.xrToOffice).invert();
      current.previousOfficePosition.copy(current.officeOrigin);
      recenterRequested.current = false;
    }

    candidatePosition.current.copy(viewerPosition.current).sub(current.xrOrigin).applyQuaternion(current.xrToOffice).add(current.officeOrigin);
    constrainOfficeCameraPath(current.previousOfficePosition, candidatePosition.current, constrainedPosition.current, scratchPosition.current, slideXPosition.current, slideZPosition.current);
    current.previousOfficePosition.copy(constrainedPosition.current);
    cameraControl.currentQuaternion.copy(current.xrToOffice).multiply(viewerRotation.current);

    const root = worldRoot.current;
    root.quaternion.copy(current.officeToXR);
    root.position.copy(viewerPosition.current).sub(scratchPosition.current.copy(constrainedPosition.current).applyQuaternion(current.officeToXR));
  });

  return null;
}
