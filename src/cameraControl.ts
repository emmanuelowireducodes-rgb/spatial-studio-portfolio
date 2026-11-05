import { Quaternion } from 'three';

// Room interior bounds and wall-mounted exhibit anchors (world units).
export const ROOM = { minX: -9.7, maxX: 9.7, minZ: -6.7, maxZ: 6.7, eyeY: 1.1 } as const;
export const WALL_EXHIBITS = {
  front: { position: [0, 2.15, -4.68] as const, size: [5.8, 2.1, .12] as const },
  left: { position: [-9.62, 2.15, -1.65] as const, size: [.12, 2.4, 3.5] as const },
  right: { position: [9.62, 2.15, -1.65] as const, size: [.12, 2.4, 3.5] as const },
  rear: { position: [0, 2.15, 6.62] as const, size: [5.8, 2.1, .12] as const },
} as const;
// Headings assume the camera's home forward vector points toward the front wall (-Z).
export const WALL_HEADINGS = { front: 0, left: Math.PI / 2, right: -Math.PI / 2, rear: Math.PI } as const;
export const WALL_GALLERY = [
  { id: 'home', label: 'HOME', heading: WALL_HEADINGS.front },
  { id: 'deaim', label: 'DE-AIM', heading: WALL_HEADINGS.left },
  { id: 'rear', label: 'SKILLS & CONTACT', heading: WALL_HEADINGS.rear },
  { id: 'hmlnd', label: 'HMLND', heading: WALL_HEADINGS.right },
] as const;

export const WALL_CAMERA_PRESETS = [
  { label:'HOME', position:[0,ROOM.eyeY,3.5] as const, target:[0,2.15,-4.58] as const, width:4.8, height:1.55 },
  { label:'DE-AIM', position:[0,ROOM.eyeY,3.5] as const, target:[-9.48,2.15,-1.65] as const, width:3.5, height:2.4 },
  { label:'OTHER WORK', position:[0,ROOM.eyeY,.8] as const, target:[0,2.15,6.52] as const, width:5.6, height:2.25 },
  { label:'HMLND', position:[0,ROOM.eyeY,3.5] as const, target:[9.48,2.15,-1.65] as const, width:3.5, height:2.4 },
] as const;

export type InspectionPreset = {
  position: [number, number, number];
  centerPosition: [number, number, number];
  walkInPosition: [number, number, number];
  transitioning: boolean;
  yaw: number;
  pitch: number;
  fov: number;
};

export function frameWallPreset(index:number, aspect:number) {
  const preset=WALL_CAMERA_PRESETS[index];
  const dx=preset.target[0]-preset.position[0];
  const dy=preset.target[1]-preset.position[1];
  const dz=preset.target[2]-preset.position[2];
  const distance=Math.hypot(dx,dy,dz);
  const yaw=Math.atan2(-dx,-dz);
  const pitch=Math.atan2(dy,Math.hypot(dx,dz));
  const margin=1.18;
  const verticalForWidth=2*Math.atan(Math.tan(Math.atan((preset.width*margin/2)/distance))/Math.max(aspect,.1));
  const verticalForHeight=2*Math.atan((preset.height*margin/2)/distance);
  const fov=Math.min(100,Math.max(40,Math.max(verticalForWidth,verticalForHeight)*180/Math.PI));
  return {position:preset.position,yaw,pitch,fov};
}

export const cameraControl = {
  enabled: false,
  /** Gallery keeps its own wall preset; panorama orientation is transient. */
  mode: 'gallery' as 'gallery' | 'panorama360',
  physicalWalkActive: false,
  yaw: 0,
  pitch: 0,
  targetYaw: 0,
  targetPitch: 0,
  panoramaYaw: 0,
  panoramaPitch: 0,
  panoramaHomeYaw: 0,
  panoramaHomePitch: 0,
  panoramaInput: 'touch' as 'touch' | 'motion',
  sensorReady: false,
  sensorTarget: new Quaternion(),
  sensorOffset: new Quaternion(),
  rawSensorQuaternion: new Quaternion(),
  currentQuaternion: new Quaternion(),
  wallIndex: 0,
  transitioning: false,
  targetFov: 72,
  targetPosition: [0,ROOM.eyeY,3.5] as [number,number,number],
  /** Temporary close framing. The gallery/panorama state remains untouched beneath it. */
  inspection: null as InspectionPreset | null,
};

