import { Canvas } from '@react-three/fiber';
import { ContactShadows, Environment, RoundedBox, Text } from '@react-three/drei';
import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { ArrowRight, ChevronDown, Code2, GraduationCap, Grid2X2, Home, Layers, Mail, Orbit, RotateCcw, User, Volume2, VolumeX, X } from 'lucide-react';
import { projects } from './data/projects';
import { useEnvironment, useExperience } from './store';
import { useFrame, useThree } from '@react-three/fiber';
import { cameraControl, ROOM, WALL_GALLERY, WALL_CAMERA_PRESETS, frameWallPreset } from './cameraControl';
import { CatmullRomCurve3, Color, Group, Quaternion, Euler, MathUtils, Vector2, Vector3, TubeGeometry, type AmbientLight, type DirectionalLight, type MeshStandardMaterial, type PointLight, type PerspectiveCamera } from 'three';
import { detectPositionalXR, PositionalXRController, type PositionalXRBridge } from './positionalXR';
import type { PhysicalWalkBridge, PhysicalWalkDiagnostics } from './physicalWalkXR';

const PhysicalWalkXRController = lazy(() => import('./physicalWalkXR').then(module => ({ default: module.PhysicalWalkXRController })));

type OrientationSample = { alpha: number; beta: number; gamma: number };
type InspectionName = 'about'|'deaim'|'hmlnd'|'rear'|'gramophone'|'desk';
type InspectionReturn = {
  mode:'gallery'|'panorama360'; wallIndex:number; targetYaw:number; targetPitch:number;
  targetPosition:[number,number,number]; targetFov:number; panoramaYaw:number; panoramaPitch:number;
};
const degreesToRadians = Math.PI / 180;
const deviceCorrection = new Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const screenAxis = new Vector3(0, 0, 1);
const orientationEuler = new Euler();
const motionTargetEuler = new Euler();
const screenCorrection = new Quaternion();
const daySceneColor = new Color('#8b8174');
const nightSceneColor = new Color('#080706');

async function requestPhysicalWalkSensorPermissions() {
  for (const constructor of [window.DeviceOrientationEvent, window.DeviceMotionEvent]) {
    const request = (constructor as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> } | undefined)?.requestPermission;
    if (typeof request === 'function' && await request.call(constructor) !== 'granted') {
      throw new Error('Motion and orientation permission was not granted. Enable sensor access for this site and try again.');
    }
  }
}

function getScreenOrientationRadians() {
  const angle = window.screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0;
  return angle * degreesToRadians;
}

/** DeviceOrientationControls conversion: intrinsic Z-X'-Y'' angles, camera correction, then screen rotation. */
function toDeviceQuaternion(sample: OrientationSample, screenAngle: number, result: Quaternion) {
  orientationEuler.set(sample.beta * degreesToRadians, sample.alpha * degreesToRadians, -sample.gamma * degreesToRadians, 'YXZ');
  result.setFromEuler(orientationEuler).multiply(deviceCorrection);
  screenCorrection.setFromAxisAngle(screenAxis, -screenAngle);
  result.multiply(screenCorrection);
  return result;
}

class SceneErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Spatial Studio scene failed:', error, info.componentStack);
  }
  render() {
    if (this.state.failed) return <div className="scene-error"><div className="scene-error-card">
      <span>SPATIAL STUDIO</span><h2>The 3D studio could not start</h2>
      <p>Your browser may have WebGL disabled. Portfolio navigation remains available.</p>
      <button onClick={() => this.setState({ failed: false })}>Try the scene again</button>
    </div></div>;
    return this.props.children;
  }
}

function Box({ position, size, color }: { position: [number, number, number]; size: [number, number, number]; color: string }) {
  return <mesh position={position} castShadow receiveShadow><boxGeometry args={size}/><meshStandardMaterial color={color} roughness={0.68} side={2}/></mesh>;
}

function ExecutiveDesk({ onInspect }: { onInspect?: () => void }) {
  return <group name="executive-desk">
    <RoundedBox position={[0,-.56,-.45]} args={[5.2,.18,2.12]} radius={.075} smoothness={4} castShadow receiveShadow>
      <meshStandardMaterial color="#b99c7e" roughness={.27} metalness={.08}/>
    </RoundedBox>
    <RoundedBox position={[0,-.665,-.45]} args={[5.12,.055,2.04]} radius={.025} smoothness={3}>
      <meshStandardMaterial color="#594638" roughness={.42}/>
    </RoundedBox>
    <RoundedBox position={[-1.62,-.915,-.38]} args={[.82,.77,1.45]} radius={.055} smoothness={3} castShadow>
      <meshStandardMaterial color="#49372a" roughness={.45}/>
    </RoundedBox>
    {Array.from({length:9},(_,index)=><mesh key={index} position={[-1.98+index*.09,-.915,-.38]} castShadow>
      <boxGeometry args={[.027,.67,1.32]}/><meshStandardMaterial color={index%2?'#705641':'#82674c'} roughness={.48}/>
    </mesh>)}
    <RoundedBox position={[1.75,-.94,-.38]} args={[.68,.72,1.42]} radius={.045} smoothness={3} castShadow>
      <meshStandardMaterial color="#49372a" roughness={.48}/>
    </RoundedBox>
    {[ -.82,-.48 ].map((y,index)=><group key={y}>
      <RoundedBox position={[1.75,y,.35]} args={[.56,.23,.035]} radius={.025} smoothness={3}>
        <meshStandardMaterial color="#765a40" roughness={.4}/>
      </RoundedBox>
      <mesh position={[1.75,y,.38]} rotation={[Math.PI/2,0,0]}>
        <cylinderGeometry args={[.018,.018,.13,10]}/><meshStandardMaterial color="#b58a55" metalness={.8} roughness={.28}/>
      </mesh>
    </group>)}
    <RoundedBox position={[0,-.425,-.45]} args={[.88,.055,.58]} radius={.025} smoothness={3} castShadow>
      <meshStandardMaterial color="#17191a" roughness={.3} metalness={.3}/>
    </RoundedBox>
    <RoundedBox position={[0,-.16,-.72]} args={[.86,.48,.045]} radius={.035} smoothness={3} castShadow>
      <meshStandardMaterial color="#17191a" roughness={.34} metalness={.38}/>
    </RoundedBox>
    <mesh position={[0,-.16,-.694]} onClick={event=>{event.stopPropagation();onInspect?.()}} onPointerOver={()=>{document.body.style.cursor='zoom-in'}} onPointerOut={()=>{document.body.style.cursor=''}}>
      <planeGeometry args={[.76,.38]}/><meshStandardMaterial color="#111619" emissive="#080b0c" emissiveIntensity={.12} roughness={.3}/>
    </mesh>
    <Text position={[0,-.16,-.683]} fontSize={.052} color="#f2d8a7" anchorX="center" anchorY="middle" letterSpacing={.001}>
      JESUS SAVES!
    </Text>
    <RoundedBox position={[-1.95,-.445,-.95]} args={[.34,.055,.28]} radius={.035} smoothness={3}>
      <meshStandardMaterial color="#29231e" roughness={.42}/>
    </RoundedBox>
    <mesh position={[-1.95,-.38,-.95]}><cylinderGeometry args={[.11,.13,.09,20]}/><meshStandardMaterial color="#3c3027" roughness={.38}/></mesh>
    <RoundedBox position={[1.37,-.445,-.78]} args={[.42,.035,.3]} radius={.025} smoothness={3}>
      <meshStandardMaterial color="#554332" roughness={.44}/>
    </RoundedBox>
    <mesh position={[1.37,-.405,-.78]}><cylinderGeometry args={[.014,.018,.16,8]}/><meshStandardMaterial color="#b28a56" metalness={.78} roughness={.3}/></mesh>
  </group>;
}

function ExecutiveChair() {
  return <group name="executive-chair">
    <RoundedBox position={[0,-.77,-2.27]} args={[1.05,.23,.92]} radius={.13} smoothness={5} castShadow receiveShadow>
      <meshStandardMaterial color="#8f7965" roughness={.72}/>
    </RoundedBox>
    <RoundedBox position={[0,-.63,-2.31]} args={[.91,.12,.76]} radius={.12} smoothness={5}>
      <meshStandardMaterial color="#aa9279" roughness={.84}/>
    </RoundedBox>
    <RoundedBox position={[0,-.25,-2.78]} args={[1.02,1.0,.24]} radius={.16} smoothness={6} castShadow receiveShadow>
      <meshStandardMaterial color="#8f7965" roughness={.72}/>
    </RoundedBox>
    <RoundedBox position={[0,.2,-2.79]} args={[.72,.28,.22]} radius={.1} smoothness={5}>
      <meshStandardMaterial color="#a38a71" roughness={.8}/>
    </RoundedBox>
    {[-1,1].map(side=><group key={side}>
      <mesh position={[side*.61,-.4,-2.34]} castShadow><cylinderGeometry args={[.035,.045,.42,10]}/><meshStandardMaterial color="#765d46" metalness={.38} roughness={.36}/></mesh>
      <RoundedBox position={[side*.62,-.18,-2.34]} args={[.16,.08,.65]} radius={.04} smoothness={4}>
        <meshStandardMaterial color="#aa9076" roughness={.72}/>
      </RoundedBox>
    </group>)}
    <mesh position={[0,-1.02,-2.31]}><cylinderGeometry args={[.07,.095,.38,16]}/><meshStandardMaterial color="#262626" metalness={.72} roughness={.28}/></mesh>
    <mesh position={[0,-1.23,-2.31]}><cylinderGeometry args={[.23,.29,.08,20]}/><meshStandardMaterial color="#262626" metalness={.75} roughness={.28}/></mesh>
    <group position={[0,-1.205,-2.31]}>
      {Array.from({length:5},(_,index)=>{
        const angle=index*Math.PI*2/5;
        return <group key={index} rotation={[0,-angle,0]}>
          <mesh position={[0,0,-.31]}><boxGeometry args={[.075,.055,.62]}/><meshStandardMaterial color="#262626" metalness={.72} roughness={.3}/></mesh>
          <mesh position={[0,0,-.61]}><sphereGeometry args={[.095,12,8]}/><meshStandardMaterial color="#242424" metalness={.38} roughness={.4}/></mesh>
        </group>;
      })}
    </group>
  </group>;
}

function LoungeSofa() {
  return <group name="corner-lounge-sofa" position={[8.02,-.84,3.55]}>
    <RoundedBox position={[0,-.35,0]} args={[1.28,.22,2.9]} radius={.1} smoothness={4} castShadow>
      <meshStandardMaterial color="#292725" roughness={.52}/>
    </RoundedBox>
    <RoundedBox position={[-.12,-.02,0]} args={[1.3,.34,2.7]} radius={.16} smoothness={6} castShadow receiveShadow>
      <meshStandardMaterial color="#786b60" roughness={.92}/>
    </RoundedBox>
    <RoundedBox position={[.43,.38,0]} args={[.42,1.02,2.78]} radius={.18} smoothness={6} castShadow receiveShadow>
      <meshStandardMaterial color="#71645a" roughness={.9}/>
    </RoundedBox>
    {[-.86,0,.86].map((z,index)=><group key={z}>
      <RoundedBox position={[-.16,.06,z]} args={[.95,.2,.84]} radius={.11} smoothness={5}>
        <meshStandardMaterial color={index===1?'#85776b':'#7c6e62'} roughness={.95}/>
      </RoundedBox>
      <RoundedBox position={[.15,.49,z]} rotation={[0,0,index===0?-.08:index===2?.08:0]} args={[.34,.66,.78]} radius={.13} smoothness={5}>
        <meshStandardMaterial color={index===1?'#807267':'#74675d'} roughness={.92}/>
      </RoundedBox>
    </group>)}
    {[-1,1].map(side=><RoundedBox key={side} position={[-.05,.12,side*1.37]} args={[1.18,.68,.38]} radius={.15} smoothness={6} castShadow>
      <meshStandardMaterial color="#76685d" roughness={.88}/>
    </RoundedBox>)}
    <mesh position={[-.22,-.38,-1.15]}><boxGeometry args={[.09,.12,.09]}/><meshStandardMaterial color="#8b6b47" metalness={.75} roughness={.3}/></mesh>
    <mesh position={[-.22,-.38,1.15]}><boxGeometry args={[.09,.12,.09]}/><meshStandardMaterial color="#8b6b47" metalness={.75} roughness={.3}/></mesh>
  </group>;
}

function LoungeTable() {
  return <group name="lounge-table" position={[6.42,-.99,3.55]}>
    <RoundedBox position={[0,.26,0]} args={[1.12,.1,1.65]} radius={.075} smoothness={5} castShadow receiveShadow>
      <meshStandardMaterial color="#45372c" roughness={.3} metalness={.12}/>
    </RoundedBox>
    <RoundedBox position={[0,.19,0]} args={[1.05,.035,1.58]} radius={.05} smoothness={4}>
      <meshStandardMaterial color="#b69a77" roughness={.24} metalness={.12}/>
    </RoundedBox>
    {[[-.4,-.55],[-.4,.55],[.4,-.55],[.4,.55]].map(([x,z],index)=><mesh key={index} position={[x,-.02,z]}>
      <cylinderGeometry args={[.025,.045,.58,10]}/><meshStandardMaterial color="#42352a" metalness={.58} roughness={.34}/>
    </mesh>)}
    <mesh position={[-.4,.38,-.25]}><cylinderGeometry args={[.12,.14,.08,20]}/><meshStandardMaterial color="#efe7db" roughness={.26}/></mesh>
    <mesh position={[.23,.37,.28]}><boxGeometry args={[.38,.035,.26]}/><meshStandardMaterial color="#2e2924" roughness={.58}/></mesh>
  </group>;
}

function BuiltInShelving({ mode }: { mode:'day'|'night' }) {
  const ledMaterials=useRef<MeshStandardMaterial[]>([]);
  const shelfLight=useRef<PointLight>(null);
  const shelfY=[2.12,1.15,.18,-.79];
  const books=[
    {x:-8.36,w:.16,h:.58,c:'#67503b'},{x:-8.17,w:.13,h:.66,c:'#c2a780'},{x:-8.01,w:.17,h:.52,c:'#39322a'},
    {x:-7.79,w:.14,h:.62,c:'#8b6f51'},{x:-7.61,w:.18,h:.55,c:'#322d28'},{x:-7.39,w:.14,h:.68,c:'#b99d76'},
    {x:-7.2,w:.16,h:.49,c:'#514236'},{x:-6.99,w:.18,h:.61,c:'#77604a'},{x:-6.78,w:.14,h:.55,c:'#d0b792'},
  ];
  useFrame((_,delta)=>{
    ledMaterials.current.forEach(material=>{material.emissiveIntensity=MathUtils.damp(material.emissiveIntensity,mode==='night'?1.25:.035,2,delta)});
    if(shelfLight.current) shelfLight.current.intensity=MathUtils.damp(shelfLight.current.intensity,mode==='night'?10:.12,2,delta);
  });
  return <group name="illuminated-walnut-library">
    <RoundedBox position={[-7.2,.35,-4.55]} args={[3.16,3.6,.28]} radius={.035} smoothness={3} castShadow>
      <meshStandardMaterial color="#211b17" roughness={.78}/>
    </RoundedBox>
    {[-8.72,-5.68].map(x=><RoundedBox key={x} position={[x,.35,-4.16]} args={[.12,3.58,.52]} radius={.02} smoothness={3}>
      <meshStandardMaterial color="#614a35" roughness={.43}/>
    </RoundedBox>)}
    {shelfY.map((y,index)=><group key={y}>
      <RoundedBox position={[-7.2,y,-4.16]} args={[3.08,.11,.54]} radius={.025} smoothness={3} castShadow receiveShadow>
        <meshStandardMaterial color="#74583d" roughness={.4} metalness={.08}/>
      </RoundedBox>
      <mesh position={[-7.2,y-.073,-3.91]}>
        <boxGeometry args={[2.98,.025,.018]}/><meshStandardMaterial ref={material=>{if(material)ledMaterials.current[index]=material}} color="#ffd7a1" emissive="#ffb860" emissiveIntensity={0} roughness={.32}/>
      </mesh>
    </group>)}
    {shelfY.slice(0,3).map((y,row)=><group key={`books-${row}`}>
      {books.slice(row*3,row*3+3).map((book,index)=><RoundedBox key={book.x} position={[book.x,y+.07+book.h/2,-4.11]} args={[book.w,book.h,.22]} radius={.015} smoothness={2}>
        <meshStandardMaterial color={book.c} roughness={.74}/>
      </RoundedBox>)}
    </group>)}
    <mesh position={[-6.16,1.55,-4.04]}><sphereGeometry args={[.23,18,12]}/><meshStandardMaterial color="#39342e" metalness={.5} roughness={.32}/></mesh>
    <mesh position={[-6.16,1.55,-3.8]}><sphereGeometry args={[.12,18,12]}/><meshStandardMaterial color="#b28a56" metalness={.88} roughness={.22}/></mesh>
    <mesh position={[-6.23,.48,-4.02]}><cylinderGeometry args={[.11,.16,.33,18]}/><meshStandardMaterial color="#4d4135" roughness={.36}/></mesh>
    <pointLight ref={shelfLight} position={[-7.2,1.85,-3.9]} intensity={0} color="#ffc27e" distance={5} decay={2}/>
  </group>;
}

function StatementChandelier({ mode }: { mode:'day'|'night' }) {
  const light=useRef<PointLight>(null);
  const diffuser=useRef<MeshStandardMaterial>(null);
  const bulb=useRef<MeshStandardMaterial>(null);
  useFrame((_,delta)=>{
    const night=mode==='night';
    if(light.current) {
      light.current.intensity=MathUtils.damp(light.current.intensity,night?9:0,10,delta);
      if(!night&&light.current.intensity<.015) light.current.intensity=0;
    }
    if(diffuser.current) {
      diffuser.current.emissiveIntensity=MathUtils.damp(diffuser.current.emissiveIntensity,night?1.65:0,10,delta);
      if(!night&&diffuser.current.emissiveIntensity<.008) diffuser.current.emissiveIntensity=0;
    }
    if(bulb.current) {
      bulb.current.emissiveIntensity=MathUtils.damp(bulb.current.emissiveIntensity,night?2.1:0,10,delta);
      if(!night&&bulb.current.emissiveIntensity<.008) bulb.current.emissiveIntensity=0;
    }
  });
  return <group name="brass-ring-chandelier">
    <mesh position={[0,5.45,0]}><cylinderGeometry args={[.16,.2,.1,24]}/><meshStandardMaterial color="#a47b4a" metalness={.82} roughness={.25}/></mesh>
    <mesh position={[0,4.975,0]}><cylinderGeometry args={[.018,.018,.95,10]}/><meshStandardMaterial color="#a47b4a" metalness={.86} roughness={.24}/></mesh>
    {[0,Math.PI/2,Math.PI,Math.PI*1.5].map((angle,index)=><mesh key={index} position={[Math.cos(angle)*.72,4.86,Math.sin(angle)*.72]}>
      <cylinderGeometry args={[.012,.012,.62,8]}/><meshStandardMaterial color="#a47b4a" metalness={.86} roughness={.24}/>
    </mesh>)}
    <mesh position={[0,4.5,0]} rotation={[Math.PI/2,0,0]}>
      <torusGeometry args={[1.08,.035,8,72]}/><meshStandardMaterial color="#bd9460" metalness={.84} roughness={.24}/>
    </mesh>
    <mesh position={[0,4.48,0]} rotation={[Math.PI/2,0,0]}>
      <torusGeometry args={[.88,.055,8,72]}/><meshStandardMaterial ref={diffuser} color="#f1c68d" emissive="#ffb860" emissiveIntensity={0} roughness={.38}/>
    </mesh>
    <mesh position={[0,4.4,0]}>
      <sphereGeometry args={[.2,20,14]}/><meshStandardMaterial ref={bulb} color="#fff0d5" emissive="#ffc36e" emissiveIntensity={0} roughness={.22}/>
    </mesh>
    <pointLight ref={light} position={[0,4.35,0]} color="#ffd09a" intensity={0} distance={11} decay={2}/>
  </group>;
}

function AboutFeatureWall({ mode, onInspect }: { mode:'day'|'night'; onInspect:()=>void }) {
  const setView=useExperience(state=>state.setView);
  const edgeMaterials=useRef<MeshStandardMaterial[]>([]);
  const edgeLights=useRef<PointLight[]>([]);
  useFrame((_,delta)=>{
    edgeMaterials.current.forEach(material=>{
      material.emissiveIntensity=MathUtils.damp(material.emissiveIntensity,mode==='night'?1.8:.025,5,delta);
    });
    edgeLights.current.forEach(light=>{
      light.intensity=MathUtils.damp(light.intensity,mode==='night'?2.5:.04,5,delta);
    });
  });
  const openStory=(event:{delta:number})=>{if(event.delta<8)setView('about')};

  return <group name="emmanuel-about-wall" onClick={openStory} onPointerOver={()=>{document.body.style.cursor='pointer'}} onPointerOut={()=>{document.body.style.cursor=''}}>
    <RoundedBox position={[0,2.28,-4.69]} args={[7.9,5.5,.14]} radius={.025} smoothness={3}>
      <meshStandardMaterial color="#211a15" roughness={.68}/>
    </RoundedBox>
    {Array.from({length:8},(_,index)=>{
      const x=-3.5+index;
      return <mesh key={index} position={[x,2.28,-4.59]}>
        <boxGeometry args={[.92,5.38,.055]}/><meshStandardMaterial color={index%2?'#38291e':'#302219'} roughness={.52}/>
      </mesh>;
    })}
    {[-2.49,2.49].map(x=><mesh key={x} position={[x,2.35,-4.44]}>
      <boxGeometry args={[.028,1.68,.028]}/><meshStandardMaterial color="#a67c4d" metalness={.78} roughness={.27}/>
    </mesh>)}
    {[-2.53,2.53].map((x,index)=><group key={x}>
      <mesh position={[x,2.35,-4.405]}>
        <boxGeometry args={[.022,1.55,.025]}/><meshStandardMaterial ref={material=>{if(material)edgeMaterials.current[index]=material}} color="#ffd19a" emissive="#ffad58" emissiveIntensity={0} roughness={.3}/>
      </mesh>
      <pointLight ref={light=>{if(light)edgeLights.current[index]=light}} position={[x+(index===0?.16:-.16),2.45,-4.22]} intensity={0} color="#ffbd7b" distance={2.6} decay={2}/>
    </group>)}
    <group>
      <RoundedBox position={[0,2.35,-4.53]} args={[4.92,1.72,.12]} radius={.04} smoothness={4} castShadow>
        <meshStandardMaterial color="#8b6746" metalness={.48} roughness={.32}/>
      </RoundedBox>
      <RoundedBox position={[0,2.35,-4.455]} args={[4.74,1.55,.045]} radius={.03} smoothness={3}>
        <meshStandardMaterial color="#111314" roughness={.38} metalness={.18}/>
      </RoundedBox>
      <Text position={[-2.18,2.79,-4.425]} fontSize={.27} color="#fffaf2" anchorX="left" anchorY="middle">Emmanuel Owiredu</Text>
      <Text position={[-2.17,2.51,-4.423]} fontSize={.12} color="#e8bd87" anchorX="left" anchorY="middle" letterSpacing={.01}>SOFTWARE DEVELOPER</Text>
      <Text position={[-2.17,2.11,-4.423]} fontSize={.095} maxWidth={2.55} lineHeight={1.25} color="#e5dfd7" anchorX="left" anchorY="middle">
        I build modern web experiences and practical software solutions, combining thoughtful design with reliable engineering.
      </Text>
      <mesh position={[.55,2.35,-4.42]}><boxGeometry args={[.018,1.28,.02]}/><meshStandardMaterial color="#927047" metalness={.8} roughness={.28}/></mesh>
      <Text position={[.78,2.81,-4.42]} fontSize={.095} color="#d7ad78" anchorX="left" anchorY="middle" letterSpacing={.007}>TECHNICAL SKILLS</Text>
      <Text position={[.78,2.56,-4.42]} fontSize={.095} lineHeight={1.4} color="#fffaf2" anchorX="left" anchorY="middle">
        React · TypeScript · JavaScript\nNode.js · Express · PostgreSQL
      </Text>
      <RoundedBox position={[1.62,1.78,-4.42]} args={[1.42,.25,.035]} radius={.12} smoothness={4}>
        <meshStandardMaterial color="#6e5238" metalness={.24} roughness={.42}/>
      </RoundedBox>
      <Text position={[1.62,1.78,-4.393]} fontSize={.07} color="#fff4e3" anchorX="center" anchorY="middle">Explore My Story →</Text>
      <group position={[1.75,2.02,-4.35]} onClick={event=>{event.stopPropagation();onInspect()}} onPointerOver={()=>{document.body.style.cursor='zoom-in'}} onPointerOut={()=>{document.body.style.cursor=''}}>
        <RoundedBox args={[.92,.22,.035]} radius={.09} smoothness={4}><meshStandardMaterial color="#a47a4f" metalness={.35} roughness={.35}/></RoundedBox>
        <Text position={[0,0,.025]} fontSize={.065} color="#fffaf2" anchorX="center" anchorY="middle">INSPECT WALL</Text>
      </group>
      <mesh position={[0,2.35,-4.39]}>
        <planeGeometry args={[4.7,1.5]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/>
      </mesh>
    </group>
    <mesh position={[0,2.28,-4.48]}>
      <boxGeometry args={[7.72,5.26,.015]}/><meshStandardMaterial transparent opacity={0} depthWrite={false}/>
    </mesh>
  </group>;
}

function Gramophone({ position, playing, audioAvailable, onToggle }: { position:[number,number,number]; playing:boolean; audioAvailable:boolean; onToggle:()=>void }) {
  const record=useRef<Group>(null);
  const hornProfile=useMemo(()=>[
    [0,0],[.045,.008],[.052,.07],[.075,.14],[.12,.22],[.19,.3],[.27,.38],[.36,.46],[.405,.5],
    [.382,.5],[.31,.445],[.235,.38],[.16,.3],[.095,.2],[.06,.11],[.045,.025],[0,0],
  ].map(([radius,height])=>new Vector2(radius,height)),[]);
  const neckGeometry=useMemo(()=>{
    const curve=new CatmullRomCurve3([
      new Vector3(.08,.2,-.12),new Vector3(-.01,.25,-.11),new Vector3(-.08,.32,-.08),new Vector3(-.13,.37,-.06),
    ]);
    return new TubeGeometry(curve,24,.024,8,false);
  },[]);
  useFrame((_,delta)=>{
    if(playing&&record.current) record.current.rotation.y+=delta*1.7;
  });
  const activate=(event:{delta:number;stopPropagation:()=>void})=>{
    if(event.delta>=5)return;
    event.stopPropagation();
    onToggle();
  };
  return <group name="vintage-gramophone" position={position} onClick={activate} onPointerOver={()=>{document.body.style.cursor='pointer'}} onPointerOut={()=>{document.body.style.cursor=''}}>
    <RoundedBox position={[0,.105,0]} args={[.62,.21,.48]} radius={.045} smoothness={4} castShadow receiveShadow>
      <meshStandardMaterial color="#38271b" roughness={.38}/>
    </RoundedBox>
    <RoundedBox position={[0,.205,0]} args={[.59,.035,.45]} radius={.025} smoothness={3}>
      <meshStandardMaterial color="#725337" roughness={.3} metalness={.12}/>
    </RoundedBox>
    <mesh position={[0,.232,0]}><cylinderGeometry args={[.205,.205,.035,48]}/><meshStandardMaterial color="#ad8754" metalness={.82} roughness={.25}/></mesh>
    <group ref={record} position={[0,.254,0]}>
      <mesh><cylinderGeometry args={[.178,.178,.012,48]}/><meshStandardMaterial color="#151515" roughness={.42}/></mesh>
      <mesh position={[0,.008,0]}><cylinderGeometry args={[.046,.046,.005,32]}/><meshStandardMaterial color="#a47d4d" roughness={.4}/></mesh>
      <mesh position={[.105,.01,0]}><boxGeometry args={[.11,.004,.012]}/><meshStandardMaterial color="#cab58d" roughness={.48}/></mesh>
    </group>
    <mesh position={[.12,.23,-.06]}><cylinderGeometry args={[.045,.055,.07,12]}/><meshStandardMaterial color="#9b7649" metalness={.78} roughness={.3}/></mesh>
    <mesh position={[.08,.27,-.04]} rotation={[0,0,-.22]}><boxGeometry args={[.28,.018,.018]}/><meshStandardMaterial color="#bb925b" metalness={.85} roughness={.23}/></mesh>
    <mesh position={[-.075,.275,-.06]} rotation={[0,0,.28]}><boxGeometry args={[.08,.016,.016]}/><meshStandardMaterial color="#25221e" metalness={.58} roughness={.3}/></mesh>
    <mesh geometry={neckGeometry} castShadow><meshStandardMaterial color="#b78c53" metalness={.86} roughness={.24}/></mesh>
    <group position={[-.13,.37,-.06]} rotation={[Math.PI/3,0,-.18]}>
      <mesh castShadow receiveShadow>
        <latheGeometry args={[hornProfile,48]}/><meshStandardMaterial color="#b9894d" metalness={.87} roughness={.23} side={2}/>
      </mesh>
      <mesh position={[0,.5,0]} rotation={[Math.PI/2,0,0]}>
        <torusGeometry args={[.395,.025,8,48]}/><meshStandardMaterial color="#d0a665" metalness={.9} roughness={.2}/>
      </mesh>
      <mesh position={[0,.495,0]} rotation={[-Math.PI/2,0,0]}>
        <circleGeometry args={[.35,40]}/><meshStandardMaterial color="#211811" roughness={.82} side={2}/>
      </mesh>
    </group>
    <Text position={[0,.105,.246]} fontSize={.043} color="#edcf9b" anchorX="center" anchorY="middle" maxWidth={.56}>
      {audioAvailable?(playing?'NOW PLAYING · TAP TO PAUSE':'TAP TO PLAY'):'MUSIC COMING SOON'}
    </Text>
  </group>;
}

function AboutStory({ onProject, onContact }: { onProject:(id:'deaim'|'hmlnd')=>void; onContact:()=>void }) {
  return <div className="about-story">
    <div className="about-portrait" aria-label="Portrait placeholder">
      <div className="portrait-halo"/><User size={46}/><small>PORTRAIT<br/>PLACEHOLDER</small>
    </div>
    <div className="about-story-content">
      <small className="about-kicker">ABOUT THE DEVELOPER</small>
      <h2>Emmanuel Owiredu</h2>
      <p className="about-role">Software Developer</p>
      <p>I build modern web experiences and practical software solutions, combining thoughtful design with reliable engineering.</p>
      <h3>Development approach</h3>
      <p>I start with the people and problem, shape a clear interface, then build maintainable software around it.</p>
      <h3>Technical skills</h3>
      <div className="about-skills">{['React','TypeScript','JavaScript','Node.js','Express','PostgreSQL'].map(skill=><span key={skill}>{skill}</span>)}</div>
      <h3>Software projects</h3>
      <div className="about-project-links"><button onClick={()=>onProject('deaim')}>De-Aim <ArrowRight size={14}/></button><button onClick={()=>onProject('hmlnd')}>HMLND <ArrowRight size={14}/></button></div>
      <p className="verified-note">Verified education and experience details have not been supplied for this portfolio yet.</p>
      <button className="cta about-contact" onClick={onContact}>Contact <ArrowRight size={15}/></button>
    </div>
  </div>;
}

function WallProjectDisplay({ project, position, rotation = 0, onInspect }: { project:'deaim'|'hmlnd'; position:[number,number,number]; rotation?:number; onInspect:()=>void }) {
  const setView=useExperience(state=>state.setView);
  const deaim=project==='deaim';
  const select=()=>setView(project);
  return <group position={position} rotation={[0,rotation,0]}>
    <mesh position={[0,0,-.06]}><boxGeometry args={[3.25,2.25,.14]}/><meshStandardMaterial color="#231d18" roughness={.62} emissive="#7d542e" emissiveIntensity={.14}/></mesh>
    <mesh position={[0,0,.025]} onClick={(event)=>{if(event.delta<8)select()}} onPointerOver={()=>{document.body.style.cursor='pointer'}} onPointerOut={()=>{document.body.style.cursor=''}}>
      <planeGeometry args={[3.05,2.05]}/><meshStandardMaterial color={deaim?'#e5e8e2':'#e8dfd3'} roughness={.65}/>
    </mesh>
    <Text position={[-1.32,.77,.05]} fontSize={.26} color={deaim?'#173628':'#30241b'} anchorX="left" anchorY="middle">{deaim?'DE-AIM':'HMLND'}</Text>
    <Text position={[-1.32,.5,.05]} fontSize={.105} color="#4b4842" anchorX="left" anchorY="middle">{deaim?'SCHOOL MANAGEMENT':'FASHION STOREFRONT'}</Text>
    {deaim ? <group>
      <mesh position={[-.87,-.08,.05]}><planeGeometry args={[.72,1.05]}/><meshStandardMaterial color="#24342d"/></mesh>
      <Text position={[-1.17,.27,.07]} fontSize={.09} color="#e7eee8" anchorX="left">DASHBOARD</Text>
      {[-.42,-.1,.22].map((x,i)=><mesh key={x} position={[x,.17,.06]}><planeGeometry args={[.48,.35]}/><meshStandardMaterial color={['#fff','#fff','#fff'][i]}/></mesh>)}
      <Text position={[-.62,.18,.08]} fontSize={.075} color="#45554b">STUDENTS</Text><Text position={[-.3,.18,.08]} fontSize={.068} color="#45554b">ATTEND</Text><Text position={[.04,.18,.08]} fontSize={.068} color="#45554b">FINANCE</Text>
      <mesh position={[.14,-.42,.06]}><planeGeometry args={[1.05,.55]}/><meshStandardMaterial color="#d1ded4"/></mesh>
      {[.0,.11,.23,.36,.49].map((x,i)=><mesh key={x} position={[-.24+x,-.51+(i%2)*.04,.08]}><planeGeometry args={[.07,.18+(i%3)*.07]}/><meshStandardMaterial color="#549071"/></mesh>)}
    </group> : <group>
      <mesh position={[.37,-.05,.05]}><planeGeometry args={[1.45,1.28]}/><meshStandardMaterial color="#c4aa8e"/></mesh>
      <mesh position={[.37,-.05,.07]}><capsuleGeometry args={[.23,.54,4,8]}/><meshStandardMaterial color="#382d27"/></mesh>
      <mesh position={[-.65,-.18,.06]}><planeGeometry args={[.72,.75]}/><meshStandardMaterial color="#d7cbbb"/></mesh>
      <Text position={[-.96,-.12,.08]} fontSize={.09} color="#4b4038" anchorX="left">CUSTOM STUDIO</Text>
      <Text position={[-.96,-.34,.08]} fontSize={.06} color="#6e6256" anchorX="left">FABRIC · FIT · DETAILS</Text>
    </group>}
    <Text position={[-1.32,-.87,.05]} fontSize={.075} color="#554d45" anchorX="left" anchorY="middle">{deaim?'React · Node · Express · PostgreSQL':'React · TypeScript · Vite · Fabric.js'}</Text>
    <group position={[.95,-.86,.09]} onClick={event=>{event.stopPropagation();onInspect()}} onPointerOver={()=>{document.body.style.cursor='zoom-in'}} onPointerOut={()=>{document.body.style.cursor=''}}>
      <RoundedBox args={[.56,.22,.035]} radius={.09} smoothness={4}><meshStandardMaterial color={deaim?'#42654e':'#72543a'}/></RoundedBox>
      <Text position={[0,0,.025]} fontSize={.065} color="#fff" anchorX="center" anchorY="middle">INSPECT</Text>
    </group>
    <mesh position={[1.23,-.78,.065]} onClick={select}><circleGeometry args={[.14,24]}/><meshBasicMaterial color={deaim?'#557a61':'#8b6d51'}/></mesh>
    <Text position={[1.23,-.78,.09]} fontSize={.08} color="#ffffff" anchorX="center" anchorY="middle">→</Text>
  </group>;
}

function OtherWallDisplay({ mode, onInspect }: { mode:'day'|'night'; onInspect:()=>void }) {
  const trim=useRef<MeshStandardMaterial[]>([]);
  const wallWash=useRef<PointLight>(null);
  useFrame((_,delta)=>{
    trim.current.forEach(material=>material.emissiveIntensity=MathUtils.damp(material.emissiveIntensity,mode==='night'?1.25:.025,5,delta));
    if(wallWash.current) wallWash.current.intensity=MathUtils.damp(wallWash.current.intensity,mode==='night'?3.6:.08,2.5,delta);
  });
  return <group name="other-work-skills-contact-display" position={[0,0,6.52]} rotation={[0,Math.PI,0]}>
    <RoundedBox position={[0,2.15,.04]} args={[5.35,2.05,.16]} radius={.045} smoothness={4}>
      <meshStandardMaterial color="#30251d" metalness={.38} roughness={.42}/>
    </RoundedBox>
    <mesh position={[0,2.15,.135]}>
      <boxGeometry args={[5.13,1.83,.035]}/><meshStandardMaterial color="#151719" roughness={.36}/>
    </mesh>
    {[[0,3.075,5.18,.04],[0,1.225,5.18,.04],[-2.57,2.15,.04,1.9],[2.57,2.15,.04,1.9]].map(([x,y,w,h],index)=><mesh key={index} position={[x,y,.166]}>
      <boxGeometry args={[w,h,.018]}/><meshStandardMaterial ref={material=>{if(material)trim.current[index]=material}} color="#c2925e" emissive="#ffb868" emissiveIntensity={0} metalness={.6} roughness={.3}/>
    </mesh>)}
    <Text position={[-2.32,2.87,.18]} fontSize={.25} color="#fff5e8" anchorX="left" anchorY="middle">OTHER WORK</Text>
    <Text position={[-2.31,2.55,.18]} fontSize={.1} color="#d9b88e" anchorX="left" anchorY="middle" letterSpacing={.01}>SKILLS · PROJECTS · CONTACT</Text>
    {[-.75,.85].map((x,index)=><mesh key={x} position={[x,2.02,.18]}>
      <boxGeometry args={[.018,1.05,.02]}/><meshStandardMaterial color="#806242" metalness={.72} roughness={.3}/>
    </mesh>)}
    <Text position={[-2.3,2.28,.18]} fontSize={.11} color="#e5bd8c" anchorX="left" anchorY="middle">TECHNICAL SKILLS</Text>
    <Text position={[-2.3,1.91,.18]} fontSize={.105} lineHeight={1.35} color="#f3eee7" anchorX="left" anchorY="middle">React · TypeScript\nJavaScript · Node.js\nExpress · PostgreSQL</Text>
    <Text position={[-.53,2.28,.18]} fontSize={.11} color="#e5bd8c" anchorX="left" anchorY="middle">OTHER PROJECTS</Text>
    <Text position={[-.53,1.99,.18]} fontSize={.105} lineHeight={1.5} color="#f3eee7" anchorX="left" anchorY="middle">Shepherd360\nDesignpot\nMore work in progress</Text>
    <Text position={[1.08,2.28,.18]} fontSize={.11} color="#e5bd8c" anchorX="left" anchorY="middle">CONTACT</Text>
    <Text position={[1.08,1.98,.18]} fontSize={.105} lineHeight={1.4} maxWidth={1.2} color="#f3eee7" anchorX="left" anchorY="middle">Contact details will be added here.</Text>
    <group position={[2.25,1.62,.2]} onClick={event=>{event.stopPropagation();onInspect()}} onPointerOver={()=>{document.body.style.cursor='zoom-in'}} onPointerOut={()=>{document.body.style.cursor=''}}>
      <RoundedBox args={[.7,.2,.03]} radius={.08} smoothness={4}><meshStandardMaterial color="#80603d"/></RoundedBox>
      <Text position={[0,0,.025]} fontSize={.058} color="#fff" anchorX="center" anchorY="middle">INSPECT</Text>
    </group>
    <pointLight ref={wallWash} position={[0,3.8,1.42]} intensity={0} color="#ffc27e" distance={6} decay={2}/>
  </group>;
}

function Office({ gramophonePlaying, gramophoneAudioAvailable, onToggleGramophone, onInspect, performanceMode }: { gramophonePlaying:boolean; gramophoneAudioAvailable:boolean; onToggleGramophone:()=>void; onInspect:(target:'about'|'deaim'|'hmlnd'|'rear'|'gramophone'|'desk')=>void; performanceMode:boolean }) {
  const mode = useEnvironment(state => state.mode);
  const toggleMode = useEnvironment(state => state.toggle);
  const ambient = useRef<AmbientLight>(null);
  const ceilingPractical = useRef<PointLight>(null);
  const exhibitLights = useRef<PointLight[]>([]);
  useFrame((_, delta) => {
    if (ambient.current) ambient.current.intensity = MathUtils.damp(ambient.current.intensity, mode === 'day' ? 1.35 : .14, 2.5, delta);
    if (ceilingPractical.current) ceilingPractical.current.intensity = MathUtils.damp(ceilingPractical.current.intensity, mode === 'day' ? .2 : 8, 2.5, delta);
    exhibitLights.current.forEach(light=>{light.intensity=MathUtils.damp(light.intensity,mode==='night'?2.8:.08,2.5,delta)});
  });
  return <group>
    <Box position={[0,-1.45,0]} size={[20,.3,14]} color="#392d24"/>
    <Box position={[0,2.2,-4.9]} size={[20,7,.3]} color="#28221e"/>
    <Box position={[-9.85,2.2,0]} size={[.3,7,14]} color="#302720"/>
    <Box position={[9.85,2.2,0]} size={[.3,7,14]} color="#302720"/>
    <Box position={[0,5.65,0]} size={[20,.3,14]} color="#332a23"/>
    <Box position={[0,2.2,6.85]} size={[20,7,.3]} color="#352a23"/>
    <Box position={[-6,2.2,-4.65]} size={[.08,6,.12]} color="#a77748"/>
    <Box position={[6,2.2,-4.65]} size={[.08,6,.12]} color="#a77748"/>
    <Box position={[-8,0,-3.8]} size={[3,.3,2]} color="#49372a"/>
    <Box position={[-9.3,1.3,-3.8]} size={[.22,2.7,2]} color="#241c17"/>
    <Box position={[-8,1.3,-3.8]} size={[.22,2.7,2]} color="#241c17"/>
    <ExecutiveDesk onInspect={()=>onInspect('desk')}/>
    <ExecutiveChair/>
    <LoungeSofa/>
    <LoungeTable/>
    <AboutFeatureWall mode={mode} onInspect={()=>onInspect('about')}/>
    <WallProjectDisplay project="deaim" position={[-9.48,2.15,-1.65]} rotation={Math.PI/2} onInspect={()=>onInspect('deaim')}/>
    <WallProjectDisplay project="hmlnd" position={[9.48,2.15,-1.65]} rotation={-Math.PI/2} onInspect={()=>onInspect('hmlnd')}/>
    <OtherWallDisplay mode={mode} onInspect={()=>onInspect('rear')}/>
    <mesh position={[-9.66,1.25,1.35]} onClick={event=>{event.stopPropagation();toggleMode()}} onPointerOver={()=>{document.body.style.cursor='pointer'}} onPointerOut={()=>{document.body.style.cursor=''}}>
      <boxGeometry args={[.12,.46,.3]}/><meshStandardMaterial color="#d1c6b4" roughness={.32}/>
    </mesh>
    <mesh position={[-9.57,1.25,1.35]} onClick={event=>{event.stopPropagation();toggleMode()}}>
      <boxGeometry args={[.08,.19,.12]}/><meshStandardMaterial color={mode==='night'?'#d9a96f':'#77736b'} emissive={mode==='night'?'#d68c43':'#000000'} emissiveIntensity={mode==='night'?.8:0}/>
    </mesh>
    <BuiltInShelving mode={mode}/>
    <Gramophone position={[6.65,-.68,3.18]} playing={gramophonePlaying} audioAvailable={gramophoneAudioAvailable} onToggle={onToggleGramophone}/>
    <Box position={[5,0,-2]} size={[.18,4,.3]} color="#92765c"/>
    <mesh position={[0,-1.27,1]} rotation={[-Math.PI/2,0,0]} receiveShadow><planeGeometry args={[20,14]}/><meshStandardMaterial color="#514237" roughness={.35}/></mesh>
    <ambientLight ref={ambient} intensity={.42}/>
    <pointLight ref={ceilingPractical} position={[0,4.8,0]} intensity={8} color="#ffd2a1" distance={12}/>
    {[-1,1].map((side,index)=><pointLight key={side} ref={light=>{if(light)exhibitLights.current[index]=light}} position={[side*8,3.3,-1.65]} intensity={0} color="#ffc27e" distance={6.5} decay={2}/>) }
    <StatementChandelier mode={mode}/>
    {!performanceMode&&<ContactShadows position={[0,-1.29,0]} opacity={.45} scale={18} blur={2}/>}
  </group>;
}

function Scene({ gramophonePlaying, gramophoneAudioAvailable, onToggleGramophone, onInspect, xrActive, xrBridge, onXRBridgeReady, onXRActiveChange, onXRError, physicalWalkRequested, physicalWalkSuspended, physicalWalkBridge, onPhysicalWalkBridgeReady, onPhysicalWalkStatus, onPhysicalWalkError, onPhysicalWalkActiveChange, onPhysicalWalkDiagnostics, physicalWalkDiagnosticsEnabled }: { gramophonePlaying:boolean; gramophoneAudioAvailable:boolean; onToggleGramophone:()=>void; onInspect:(target:'about'|'deaim'|'hmlnd'|'rear'|'gramophone'|'desk')=>void; xrActive:boolean; xrBridge:React.MutableRefObject<PositionalXRBridge|null>; onXRBridgeReady:(ready:boolean)=>void; onXRActiveChange:(active:boolean)=>void; onXRError:(message:string)=>void; physicalWalkRequested:boolean; physicalWalkSuspended:boolean; physicalWalkBridge:React.MutableRefObject<PhysicalWalkBridge|null>; onPhysicalWalkBridgeReady:(ready:boolean)=>void; onPhysicalWalkStatus:(status:string)=>void; onPhysicalWalkError:(message:string)=>void; onPhysicalWalkActiveChange:(active:boolean)=>void; onPhysicalWalkDiagnostics:(diagnostics:PhysicalWalkDiagnostics)=>void; physicalWalkDiagnosticsEnabled:boolean }) {
  const mode=useEnvironment(state=>state.mode);
  const background=useRef<Color>(null);
  const daylight=useRef<DirectionalLight>(null);
  const xrWorldRoot=useRef<Group>(null);
  useFrame((_,delta)=>{
    const day=mode==='day';
    if(background.current) background.current.lerp(day?daySceneColor:nightSceneColor,1-Math.exp(-1.6*delta));
    if(daylight.current) daylight.current.intensity=MathUtils.damp(daylight.current.intensity,day?2.1:.22,2.2,delta);
  });
  return <>{!xrActive&&<color ref={background} attach="background" args={['#080706']}/>}<group ref={xrWorldRoot}><directionalLight ref={daylight} position={[4,8,5]} intensity={.22} castShadow={!physicalWalkRequested}/>
    <Office gramophonePlaying={gramophonePlaying} gramophoneAudioAvailable={gramophoneAudioAvailable} onToggleGramophone={onToggleGramophone} onInspect={onInspect} performanceMode={physicalWalkRequested}/></group><Suspense fallback={null}><Environment preset="apartment"/></Suspense><CameraLookController/>
    <PositionalXRController worldRoot={xrWorldRoot} bridgeRef={xrBridge} onBridgeReady={onXRBridgeReady} onActiveChange={onXRActiveChange} onError={onXRError}/>
    {physicalWalkRequested&&<Suspense fallback={null}><PhysicalWalkXRController bridgeRef={physicalWalkBridge} requested={physicalWalkRequested} suspended={physicalWalkSuspended} onBridgeReady={onPhysicalWalkBridgeReady} onStatus={onPhysicalWalkStatus} onError={onPhysicalWalkError} onActiveChange={onPhysicalWalkActiveChange} diagnosticsEnabled={physicalWalkDiagnosticsEnabled} onDiagnostics={onPhysicalWalkDiagnostics}/></Suspense>}
  </>;
}

function CameraLookController() {
  const { camera, size, gl } = useThree();
  const initialized = useRef(false);
  const reducedMotion = useRef(typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const destination = useRef(new Vector3());
  const desiredRotation = useRef(new Quaternion());
  const cameraEuler = useRef(new Euler());
  useEffect(() => {
    if (cameraControl.mode === 'panorama360') return;
    const preset=frameWallPreset(cameraControl.wallIndex,size.width/size.height);
    cameraControl.targetYaw=preset.yaw+Math.round((cameraControl.yaw-preset.yaw)/(Math.PI*2))*Math.PI*2;
    cameraControl.targetPitch=preset.pitch;cameraControl.targetFov=preset.fov;
    cameraControl.targetPosition=[...preset.position];
    if(initialized.current) cameraControl.transitioning=true;
  },[camera,size.width,size.height]);
  useFrame((_,delta) => {
    if(gl.xr.isPresenting||cameraControl.physicalWalkActive)return;
    const perspective=camera as PerspectiveCamera;
    const inspection=cameraControl.inspection;
    const inspectionTransitioning=inspection?.transitioning ?? false;
    destination.current.set(...(inspection?.position ?? cameraControl.targetPosition));
    const yaw = inspection ? inspection.yaw : cameraControl.mode === 'panorama360' ? cameraControl.panoramaYaw : cameraControl.targetYaw;
    const pitch = inspection ? inspection.pitch : cameraControl.mode === 'panorama360' ? cameraControl.panoramaPitch : cameraControl.targetPitch;
    const useSensor = cameraControl.mode === 'panorama360' && cameraControl.panoramaInput === 'motion' && cameraControl.sensorReady && !inspectionTransitioning;
    if (useSensor) desiredRotation.current.copy(cameraControl.sensorTarget);
    else desiredRotation.current.setFromEuler(new Euler(pitch,yaw,0,'YXZ'));
    if(!initialized.current){
      camera.position.copy(destination.current);camera.quaternion.copy(desiredRotation.current);perspective.fov=inspection?.fov ?? cameraControl.targetFov;perspective.updateProjectionMatrix();
      cameraControl.currentQuaternion.copy(camera.quaternion);
      cameraControl.yaw=cameraControl.targetYaw;cameraControl.pitch=cameraControl.targetPitch;initialized.current=true;return;
    }
    const ease=reducedMotion.current?1:1-Math.exp(-5*delta);
    camera.position.lerp(destination.current,ease);
    const rotationEase = useSensor ? 1 - Math.exp(-14 * delta) : reducedMotion.current ? 1 : cameraControl.mode === 'panorama360' ? 1 - Math.exp(-10 * delta) : ease;
    camera.quaternion.slerp(desiredRotation.current,rotationEase);
    cameraControl.currentQuaternion.copy(camera.quaternion);
    perspective.fov=reducedMotion.current?(inspection?.fov ?? cameraControl.targetFov):MathUtils.damp(perspective.fov,inspection?.fov ?? cameraControl.targetFov,5,delta);perspective.updateProjectionMatrix();
    if (useSensor) {
      cameraEuler.current.setFromQuaternion(camera.quaternion, 'YXZ');
      cameraControl.yaw=cameraEuler.current.y;
      cameraControl.pitch=cameraEuler.current.x;
    } else {
      cameraControl.yaw=MathUtils.damp(cameraControl.yaw,yaw, cameraControl.mode === 'panorama360' ? 10 : 5,delta);
      cameraControl.pitch=MathUtils.damp(cameraControl.pitch,pitch, cameraControl.mode === 'panorama360' ? 10 : 5,delta);
    }
    if(Math.abs(yaw-cameraControl.yaw)<.002&&camera.position.distanceTo(destination.current)<.01){cameraControl.yaw=yaw;cameraControl.transitioning=false;}
    if(inspectionTransitioning && inspection && camera.position.distanceTo(destination.current)<.015 && camera.quaternion.angleTo(desiredRotation.current)<.003){
      inspection.transitioning=false;
      if(cameraControl.mode==='panorama360'&&cameraControl.panoramaInput==='motion'&&cameraControl.sensorReady){
        cameraControl.sensorOffset.copy(camera.quaternion).multiply(cameraControl.rawSensorQuaternion.clone().invert());
        cameraControl.sensorTarget.copy(camera.quaternion);
      }
    }
  });
  return null;
}

const navigation = [['home',Home],['projects',Grid2X2],['skills',Layers],['about',User],['contact',Mail],['panorama360',Orbit]] as const;

export default function App() {
  const view = useExperience(state => state.view);
  const setView = useExperience(state => state.setView);
  const project = projects.find(item => item.id === view);
  const pointer = useRef<{id:number;x:number;y:number;lastX:number;lastY:number;captured:boolean;moved:boolean}|null>(null);
  const [mobileMode, setMobileMode] = useState<'welcome' | 'exploring'>('welcome');
  const [activeWall, setActiveWall] = useState(cameraControl.wallIndex);
  const [panoramaActive, setPanoramaActive] = useState(cameraControl.mode === 'panorama360');
  const [panoramaControlsExpanded, setPanoramaControlsExpanded] = useState(false);
  const [walkPreflightOpen, setWalkPreflightOpen] = useState(false);
  const [panoramaInput, setPanoramaInput] = useState<'touch' | 'motion'>('touch');
  const [motionStatus, setMotionStatus] = useState('');
  const [positionalXRSupport, setPositionalXRSupport] = useState<'checking'|'supported'|'unsupported'>('checking');
  const [positionalXRActive, setPositionalXRActive] = useState(false);
  const [positionalXRBridgeReady, setPositionalXRBridgeReady] = useState(false);
  const [positionalXRError, setPositionalXRError] = useState('');
  const positionalXRBridge = useRef<PositionalXRBridge|null>(null);
  const [physicalWalkDriveRequested, setPhysicalWalkDriveRequested] = useState(false);
  const [physicalWalkBridgeReady, setPhysicalWalkBridgeReady] = useState(false);
  const [physicalWalkPermissionsGranted, setPhysicalWalkPermissionsGranted] = useState(false);
  const [physicalWalkActive, setPhysicalWalkActive] = useState(false);
  const [physicalWalkStatus, setPhysicalWalkStatus] = useState('Ready when you are in a clear area.');
  const [physicalWalkError, setPhysicalWalkError] = useState('');
  const [walkDiagnosticsOpen, setWalkDiagnosticsOpen] = useState(false);
  const [walkDiagnosticsCopied, setWalkDiagnosticsCopied] = useState(false);
  const [walkDiagnostics, setWalkDiagnostics] = useState<PhysicalWalkDiagnostics|null>(null);
  const physicalWalkBridge = useRef<PhysicalWalkBridge|null>(null);
  const physicalWalkEnterStarted = useRef(false);
  const motionPermission = useRef<'unknown' | 'requesting' | 'granted' | 'denied' | 'unsupported'>('unknown');
  const motionRequest = useRef(0);
  const audioRef = useRef<HTMLAudioElement|null>(null);
  const audioFade = useRef<{ frame:number; finish:()=>void }|null>(null);
  const audioAction = useRef(0);
  const audioStarting = useRef(false);
  const [gramophoneAudioAvailable, setGramophoneAudioAvailable] = useState(false);
  const [gramophonePlaying, setGramophonePlaying] = useState(false);
  const [musicMuted, setMusicMuted] = useState(false);
  const [musicInteracted, setMusicInteracted] = useState(false);
  const [inspectionTarget, setInspectionTarget] = useState<InspectionName|null>(null);
  const [inspectionWalkStep, setInspectionWalkStep] = useState<'center'|'closer'>('center');
  const inspectionReturn = useRef<InspectionReturn|null>(null);
  const [musicMessage, setMusicMessage] = useState('Music coming soon · licensed instrumental asset not supplied.');
  const mobileExploring = mobileMode === 'exploring';
  const walkDebugEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('walkDebug') === '1';
  const canShowWalkDiagnostics = walkDebugEnabled || import.meta.env.DEV;
  const walkClientClass = (() => {
    const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    const browser = /SamsungBrowser\//.test(ua) ? 'Samsung Internet' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
    const device = /Android/i.test(ua) ? 'Android device' : /iPad/i.test(ua) ? 'iPad' : /iPhone|iPod/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows device' : /Macintosh|Mac OS/i.test(ua) ? 'Mac device' : /Linux/i.test(ua) ? 'Linux device' : 'Unknown device class';
    return `${browser} · ${device}`;
  })();
  const compactMotionStatus = motionStatus && !motionStatus.startsWith('Waiting for phone movement') ? motionStatus : '';

  const handlePhysicalWalkError = (_message:string) => {
    physicalWalkEnterStarted.current=false;
    setPhysicalWalkPermissionsGranted(false);
    cameraControl.physicalWalkActive=false;
    setPhysicalWalkError('Physical Walk could not start. Try Again or return to Touch Mode.');
    setPhysicalWalkDriveRequested(false);
    setPhysicalWalkActive(false);
    setPhysicalWalkStatus('Physical Walk unavailable; 360° Motion remains available.');
    if (cameraControl.mode === 'panorama360') {
      cameraControl.panoramaInput='motion';
      setPanoramaInput('motion');
      setMotionStatus('Physical Walk could not start. You can continue in Motion mode.');
    }
  };
  const handlePhysicalWalkActiveChange = (active:boolean) => {
    setPhysicalWalkActive(active);
  };
  const handlePhysicalWalkBridgeReady = (ready:boolean) => {
    setPhysicalWalkBridgeReady(ready);
  };
  const handlePhysicalWalkStatus = (status:string) => {
    setPhysicalWalkStatus(status);
    if (status.startsWith('Tracking normally')) setPanoramaControlsExpanded(false);
  };
  const handlePositionalXRActiveChange = (active:boolean) => {
    setPositionalXRActive(active);
    if(active)setPanoramaControlsExpanded(false);
  };
  const startPhysicalWalk = (permissionsAlreadyGranted = false) => {
    if (!panoramaActive || view !== 'home' || positionalXRActive || inspectionTarget) {
      setPhysicalWalkError('Physical Walk is not ready. Use the regular 360° Motion mode instead.');
      return;
    }
    setPhysicalWalkError('');
    setWalkPreflightOpen(false);
    setPanoramaControlsExpanded(false);
    physicalWalkEnterStarted.current=false;
    setPhysicalWalkBridgeReady(false);
    setPhysicalWalkPermissionsGranted(permissionsAlreadyGranted);
    physicalWalkBridge.current=null;
    flushSync(() => setPhysicalWalkDriveRequested(true));
    // Invoke iOS sensor permission prompts directly within the visitor's tap, before lazy-loading the XR module.
    if(!permissionsAlreadyGranted)void requestPhysicalWalkSensorPermissions().then(()=>setPhysicalWalkPermissionsGranted(true)).catch(error=>handlePhysicalWalkError(error instanceof Error?error.message:String(error)));
  };
  useEffect(() => {
    if (!physicalWalkDriveRequested || !physicalWalkBridgeReady || !physicalWalkPermissionsGranted || physicalWalkEnterStarted.current) return;
    const bridge=physicalWalkBridge.current;
    if (!bridge) return;
    physicalWalkEnterStarted.current=true;
    void bridge.enter(true).catch(error=>handlePhysicalWalkError(error instanceof Error?error.message:String(error)));
  },[physicalWalkDriveRequested,physicalWalkBridgeReady,physicalWalkPermissionsGranted]);
  const exitPhysicalWalk = async () => {
    flushSync(() => setPhysicalWalkDriveRequested(false));
    try { await physicalWalkBridge.current?.exit(); }
    finally {
      physicalWalkEnterStarted.current=false;
      setPhysicalWalkPermissionsGranted(false);
      setPhysicalWalkDriveRequested(false);
      setPhysicalWalkActive(false);
      setPhysicalWalkStatus('Physical Walk stopped.');
    }
  };
  const retryPhysicalWalk = async () => {
    // Request any iOS motion permission synchronously from this explicit tap before awaiting session shutdown.
    const permissionRequest=requestPhysicalWalkSensorPermissions();
    try {
      await exitPhysicalWalk();
      await permissionRequest;
      setPhysicalWalkError('');
      startPhysicalWalk(true);
    } catch(error) {
      handlePhysicalWalkError(error instanceof Error?error.message:String(error));
    }
  };

  useEffect(() => {
    let active=true;
    fetch('/audio/gospel-sax.mp3',{method:'HEAD',cache:'no-store'}).then(response=>{
      const contentType=response.headers.get('content-type')??'';
      const available=response.ok&&contentType.toLowerCase().startsWith('audio/');
      if(!active)return;
      setGramophoneAudioAvailable(available);
      if(available)setMusicMessage('Ready · tap the gramophone to play.');
      else setMusicMessage('Music coming soon · add a licensed track at public/audio/gospel-sax.mp3.');
    }).catch(()=>{
      if(active)setMusicMessage('Music coming soon · add a licensed track at public/audio/gospel-sax.mp3.');
    });
    return ()=>{active=false};
  },[]);

  useEffect(() => {
    let active=true;
    detectPositionalXR().then(supported=>{
      if(active)setPositionalXRSupport(supported?'supported':'unsupported');
    });
    return ()=>{active=false};
  },[]);

  const stopAudioFade = () => {
    const active=audioFade.current;
    if(!active)return;
    cancelAnimationFrame(active.frame);
    audioFade.current=null;
    active.finish();
  };
  const fadeAudioTo = (player:HTMLAudioElement,target:number,duration=500) => new Promise<void>(resolve=>{
    stopAudioFade();
    const start=player.volume;
    const began=performance.now();
    const state={frame:0,finish:resolve};
    audioFade.current=state;
    const tick=(now:number)=>{
      if(audioFade.current!==state)return;
      const progress=Math.min(1,(now-began)/duration);
      player.volume=start+(target-start)*progress;
      if(progress<1)state.frame=requestAnimationFrame(tick);
      else{
        player.volume=target;
        audioFade.current=null;
        resolve();
      }
    };
    state.frame=requestAnimationFrame(tick);
  });

  useEffect(()=>()=>{
    stopAudioFade();
    audioAction.current++;
    audioStarting.current=false;
    const player=audioRef.current;
    if(player){player.pause();player.removeAttribute('src');player.load();audioRef.current=null;}
  },[]);

  const toggleGramophone = async () => {
    setMusicInteracted(true);
    if(!gramophoneAudioAvailable){
      setMusicMessage('Music coming soon · add a licensed track at public/audio/gospel-sax.mp3.');
      return;
    }
    let player=audioRef.current;
    if(!player){
      player=new Audio('/audio/gospel-sax.mp3');
      player.preload='metadata';
      player.loop=true;
      player.volume=.3;
      player.muted=musicMuted;
      player.onplay=()=>{setGramophonePlaying(true);setMusicMessage('Playing instrumental gospel saxophone.');};
      player.onpause=()=>setGramophonePlaying(false);
      player.onerror=()=>{setGramophoneAudioAvailable(false);setGramophonePlaying(false);setMusicMessage('Music coming soon · the licensed audio file could not be loaded.');};
      audioRef.current=player;
    }
    const action=++audioAction.current;
    if(audioStarting.current){
      audioStarting.current=false;
      stopAudioFade();
      player.pause();
      player.volume=.3;
      setMusicMessage('Music paused. Tap the gramophone to resume.');
      return;
    }
    if(player.paused){
      try{
        audioStarting.current=true;
        player.volume=0;
        await player.play();
        if(action!==audioAction.current)return;
        audioStarting.current=false;
        await fadeAudioTo(player,.3,500);
      }
      catch{
        audioStarting.current=false;
        if(action!==audioAction.current)return;
        player.pause();
        player.volume=.3;
        setGramophonePlaying(false);
        setGramophoneAudioAvailable(false);
        setMusicMessage('Music coming soon · the licensed audio file could not be played.');
      }
    }else{
      await fadeAudioTo(player,0,500);
      if(action!==audioAction.current)return;
      player.pause();
      player.volume=.3;
      setMusicMessage('Music paused. Tap the gramophone to resume.');
    }
  };

  const toggleMusicMute = () => {
    setMusicMuted(previous=>{
      const muted=!previous;
      if(audioRef.current)audioRef.current.muted=muted;
      return muted;
    });
  };
  const focusInspection = (name:InspectionName) => {
    if (inspectionTarget) return;
    const currentPanoramaEuler=new Euler().setFromQuaternion(cameraControl.currentQuaternion,'YXZ');
    const oldPosition=[...cameraControl.targetPosition] as [number,number,number];
    inspectionReturn.current={
      mode:cameraControl.mode, wallIndex:cameraControl.wallIndex,
      targetYaw:cameraControl.targetYaw, targetPitch:cameraControl.targetPitch,
      targetPosition:oldPosition, targetFov:cameraControl.targetFov,
      panoramaYaw:cameraControl.mode==='panorama360'&&cameraControl.panoramaInput==='motion'?currentPanoramaEuler.y:cameraControl.panoramaYaw,
      panoramaPitch:cameraControl.mode==='panorama360'&&cameraControl.panoramaInput==='motion'?currentPanoramaEuler.x:cameraControl.panoramaPitch,
    };
    let target:[number,number,number];
    let position:[number,number,number];
    let walkInPosition:[number,number,number];
    let width:number;
    let height:number;
    if(name==='gramophone'){
      target=[6.52,-.31,3.12];
      position=[5.15,ROOM.eyeY,2.05];
      walkInPosition=[5.55,ROOM.eyeY,2.32];
      width=.9;height=1.15;
    }else if(name==='desk'){
      target=[0,-.16,-.68];
      position=[0,ROOM.eyeY,1.55];
      walkInPosition=[.55,ROOM.eyeY,1.12];
      width=2.3;height=1.25;
    }else{
      const wallIndex=name==='about'?0:name==='deaim'?1:name==='rear'?2:3;
      const preset=WALL_CAMERA_PRESETS[wallIndex];
      target=[...preset.target];
      if(name==='about') target[1]=2.35;
      if(name==='deaim'||name==='hmlnd'){width=3.05;height=2.05;}
      else if(name==='rear'){width=5.13;height=1.83;}
      else {width=4.74;height=1.55;}
      // Advance toward the validated wall's real exhibit anchor while staying inside the room.
      position=[MathUtils.lerp(preset.position[0],target[0],.28),ROOM.eyeY,MathUtils.lerp(preset.position[2],target[2],.28)];
      // A second hand-picked stop moves closer while preserving a clear gap from the wall.
      walkInPosition=[MathUtils.lerp(preset.position[0],target[0],.55),ROOM.eyeY,MathUtils.lerp(preset.position[2],target[2],.55)];
    }
    const dx=target[0]-position[0],dy=target[1]-position[1],dz=target[2]-position[2];
    const distance=Math.hypot(dx,dy,dz);
    const aspect=Math.max(.35,window.innerWidth/window.innerHeight);
    const frameMargin=name==='gramophone'||name==='desk'?1.12:1.04;
    const widthFov=2*Math.atan((width*frameMargin/2/distance)/aspect);
    const heightFov=2*Math.atan(height*frameMargin/2/distance);
    const centerPosition=[...position] as [number,number,number];
    cameraControl.inspection={
      position:centerPosition,
      centerPosition,
      walkInPosition,
      transitioning:true,
      yaw:Math.atan2(-dx,-dz),
      pitch:Math.atan2(dy,Math.hypot(dx,dz)),
      fov:Math.min(100,Math.max(36,Math.max(widthFov,heightFov)*180/Math.PI)),
    };
    cameraControl.transitioning=true;
    setInspectionWalkStep('center');
    setInspectionTarget(name);
  };
  const moveCloser = () => {
    const inspection=cameraControl.inspection;
    if(!inspection||inspectionWalkStep==='closer')return;
    inspection.position=[...inspection.walkInPosition];
    inspection.transitioning=true;
    cameraControl.transitioning=true;
    setInspectionWalkStep('closer');
  };
  const stepBack = () => {
    const inspection=cameraControl.inspection;
    if(!inspection||inspectionWalkStep==='center')return;
    inspection.position=[...inspection.centerPosition];
    inspection.transitioning=true;
    cameraControl.transitioning=true;
    setInspectionWalkStep('center');
  };
  const closeInspection = () => {
    const saved=inspectionReturn.current;
    cameraControl.inspection=null;
    setInspectionTarget(null);
    setInspectionWalkStep('center');
    if(!saved)return;
    cameraControl.mode=saved.mode;
    cameraControl.wallIndex=saved.wallIndex;
    setActiveWall(saved.wallIndex);
    cameraControl.targetPosition=[...saved.targetPosition];
    cameraControl.targetFov=saved.targetFov;
    cameraControl.panoramaYaw=saved.panoramaYaw;
    cameraControl.panoramaPitch=saved.panoramaPitch;
    if(saved.mode==='panorama360'&&cameraControl.panoramaInput==='motion'&&cameraControl.sensorReady){
      const returnRotation=new Quaternion().setFromEuler(new Euler(saved.panoramaPitch,saved.panoramaYaw,0,'YXZ'));
      cameraControl.sensorOffset.copy(returnRotation).multiply(cameraControl.rawSensorQuaternion.clone().invert());
      cameraControl.sensorTarget.copy(returnRotation);
    }
    cameraControl.targetYaw=saved.targetYaw+Math.round((cameraControl.yaw-saved.targetYaw)/(Math.PI*2))*Math.PI*2;
    cameraControl.targetPitch=saved.targetPitch;
    cameraControl.transitioning=true;
    inspectionReturn.current=null;
  };
  const goToWall = (index:number) => {
    if (physicalWalkDriveRequested) void exitPhysicalWalk();
    if(cameraControl.inspection)return;
    if (cameraControl.transitioning && cameraControl.mode === 'gallery') return;
    cameraControl.mode='gallery';
    setPanoramaActive(false);
    const next=(index+WALL_GALLERY.length)%WALL_GALLERY.length;
    if (next===cameraControl.wallIndex) {
      const current=frameWallPreset(next,window.innerWidth/window.innerHeight);
      cameraControl.targetYaw=current.yaw+Math.round((cameraControl.yaw-current.yaw)/(Math.PI*2))*Math.PI*2;
      cameraControl.targetPitch=current.pitch;cameraControl.targetFov=current.fov;cameraControl.targetPosition=[...current.position];
      if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){cameraControl.yaw=cameraControl.targetYaw;cameraControl.pitch=current.pitch;cameraControl.transitioning=false;}else cameraControl.transitioning=true;
      return;
    }
    cameraControl.wallIndex=next;
    const preset=frameWallPreset(next,window.innerWidth/window.innerHeight);
    cameraControl.targetYaw=preset.yaw+Math.round((cameraControl.yaw-preset.yaw)/(Math.PI*2))*Math.PI*2;
    cameraControl.targetPitch=preset.pitch;
    cameraControl.targetFov=preset.fov;
    cameraControl.targetPosition=[...preset.position];
    cameraControl.transitioning=true;
    setActiveWall(next);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { cameraControl.yaw=cameraControl.targetYaw;cameraControl.pitch=cameraControl.targetPitch;cameraControl.transitioning=false; }
  };
  const enterPanorama = () => {
    if (cameraControl.mode === 'panorama360') return;
    if (physicalWalkDriveRequested) void exitPhysicalWalk();
    motionRequest.current++;
    cameraControl.panoramaYaw=cameraControl.yaw;
    cameraControl.panoramaPitch=cameraControl.pitch;
    cameraControl.panoramaHomeYaw=cameraControl.yaw;
    cameraControl.panoramaHomePitch=cameraControl.pitch;
    cameraControl.mode='panorama360';
    cameraControl.panoramaInput='touch';
    cameraControl.sensorReady=false;
    setPanoramaInput('touch');
    setMotionStatus('');
    cameraControl.targetFov=76;
    cameraControl.transitioning=false;
    setView('home');
    if (window.innerWidth < 768) setMobileMode('exploring');
    setPanoramaActive(true);
    setPanoramaControlsExpanded(false);
    setWalkPreflightOpen(false);
  };
  const exitPanorama = () => {
    if (cameraControl.mode !== 'panorama360') return;
    if (physicalWalkDriveRequested) void exitPhysicalWalk();
    if (positionalXRActive) void positionalXRBridge.current?.exit();
    motionRequest.current++;
    cameraControl.mode='gallery';
    cameraControl.sensorReady=false;
    cameraControl.panoramaInput='touch';
    setPanoramaInput('touch');
    setPanoramaActive(false);
    setPanoramaControlsExpanded(false);
    setWalkPreflightOpen(false);
    goToWall(cameraControl.wallIndex);
  };
  const selectTouchMode = () => {
    if (physicalWalkDriveRequested) void exitPhysicalWalk();
    motionRequest.current++;
    cameraControl.sensorReady=false;
    cameraControl.panoramaInput='touch';
    const currentEuler=new Euler().setFromQuaternion(cameraControl.currentQuaternion,'YXZ');
    cameraControl.panoramaYaw=currentEuler.y;
    cameraControl.panoramaPitch=MathUtils.clamp(currentEuler.x,-75*Math.PI/180,75*Math.PI/180);
    setPanoramaInput('touch');
    setMotionStatus('');
    setWalkPreflightOpen(false);
    setPanoramaControlsExpanded(false);
  };
  const selectMotionMode = async () => {
    if (!panoramaActive || view !== 'home') return;
    setWalkPreflightOpen(false);
    setPanoramaControlsExpanded(false);
    if (physicalWalkDriveRequested) void exitPhysicalWalk();
    const requestId=++motionRequest.current;
    if (!window.isSecureContext) {
      setMotionStatus('Motion requires a secure HTTPS connection.');
      return;
    }
    if (typeof DeviceOrientationEvent === 'undefined') {
      motionPermission.current='unsupported';
      setMotionStatus('Motion sensors are not supported in this browser.');
      return;
    }
    if (motionPermission.current === 'denied') {
      setMotionStatus('Motion permission was denied. Use Touch mode or change browser settings.');
      return;
    }
    if (motionPermission.current === 'requesting') {
      setMotionStatus('Waiting for the browser permission response.');
      return;
    }
    if (motionPermission.current === 'unsupported') {
      setMotionStatus('Motion sensors are not supported in this browser.');
      return;
    }
    const orientationConstructor = DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };
    if (orientationConstructor.requestPermission && motionPermission.current === 'unknown') {
      motionPermission.current='requesting';
      try {
        // iOS Safari requires this call to happen directly from the Motion button gesture.
        const permission=await orientationConstructor.requestPermission();
        motionPermission.current=permission;
        if (permission !== 'granted') {
          setMotionStatus('Motion permission was denied. Touch mode is still available.');
          return;
        }
      } catch {
        motionPermission.current='denied';
        setMotionStatus('Could not request motion permission. Touch mode is still available.');
        return;
      }
    } else {
      motionPermission.current='granted';
    }
    if (requestId !== motionRequest.current || cameraControl.mode !== 'panorama360' || useExperience.getState().view !== 'home') return;
    cameraControl.sensorReady=false;
    cameraControl.panoramaInput='motion';
    setPanoramaInput('motion');
    setMotionStatus('Waiting for phone movement…');
  };
  const enterPositionalXR = () => {
    if (physicalWalkDriveRequested) { setPositionalXRError('Exit Physical Walk before starting Experimental Positional AR.'); return; }
    setPositionalXRError('');
    if (!positionalXRBridge.current) {
      setPositionalXRError('Positional AR is not ready in this browser.');
      return;
    }
    void positionalXRBridge.current.enter();
  };
  const recenterPositionalXR = () => positionalXRBridge.current?.recenter();
  const exitPositionalXR = () => { void positionalXRBridge.current?.exit(); };
  const recenter = () => {
    if (cameraControl.mode === 'panorama360') {
      if (panoramaInput === 'motion') {
        if (!cameraControl.sensorReady) {
          setMotionStatus('Waiting for a motion reading before recentering.');
          return;
        }
        cameraControl.sensorOffset.copy(cameraControl.currentQuaternion).multiply(cameraControl.rawSensorQuaternion.clone().invert());
        cameraControl.sensorTarget.copy(cameraControl.currentQuaternion);
        setMotionStatus('Motion reference recentered.');
        return;
      }
      cameraControl.panoramaYaw=cameraControl.panoramaHomeYaw;
      cameraControl.panoramaPitch=cameraControl.panoramaHomePitch;
      return;
    }
    goToWall(0);
  };
  const navigateBy = (delta:number) => goToWall(cameraControl.wallIndex+delta);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (inspectionTarget || view !== 'home' || (cameraControl.mode === 'panorama360' && panoramaInput === 'motion') || (cameraControl.mode === 'gallery' && (window.innerWidth >= 768 || !mobileExploring)) || (event.target as HTMLElement).closest('button, article, nav, a, section, input, [role="dialog"]')) return;
    pointer.current = { id:event.pointerId, x:event.clientX, y:event.clientY, lastX:event.clientX, lastY:event.clientY, captured:false, moved:false };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (inspectionTarget) return;
    if (!pointer.current || pointer.current.id !== event.pointerId) return;
    if (cameraControl.mode === 'panorama360' && cameraControl.panoramaInput === 'motion') return;
    const drag=pointer.current;
    const dx=event.clientX-drag.x, dy=event.clientY-drag.y;
    if (cameraControl.mode === 'panorama360') {
      if (!drag.moved && Math.hypot(dx,dy)>5) drag.moved=true;
      if (drag.moved) {
        cameraControl.panoramaYaw += (drag.lastX-event.clientX)*0.0042;
        cameraControl.panoramaPitch = MathUtils.clamp(cameraControl.panoramaPitch+(drag.lastY-event.clientY)*0.0032,-75*Math.PI/180,75*Math.PI/180);
      }
    } else if (!drag.captured && Math.abs(dx)>24) {
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.captured=true;
    }
    if (drag.moved && !drag.captured && cameraControl.mode === 'panorama360') {
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.captured=true;
    }
    drag.lastX=event.clientX;drag.lastY=event.clientY;
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointer.current?.id !== event.pointerId) return;
    const dx=event.clientX-pointer.current.x, dy=event.clientY-pointer.current.y;
    const wasCaptured=pointer.current.captured;
    pointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cameraControl.mode==='gallery' && view==='home' && mobileExploring && Math.abs(dx)>=55 && Math.abs(dx)>Math.abs(dy)*1.25) navigateBy(dx<0?1:-1);
    void wasCaptured;
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && positionalXRActive) { void positionalXRBridge.current?.exit(); return; }
      if (event.key === 'Escape') setView('home');
      if (mobileExploring && view==='home' && event.key==='ArrowLeft') navigateBy(-1);
      if (mobileExploring && view==='home' && event.key==='ArrowRight') navigateBy(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setView,mobileExploring,view,positionalXRActive]);

  useEffect(() => {
    if (!panoramaActive || view !== 'home' || panoramaInput !== 'motion' || positionalXRActive) {
      cameraControl.sensorReady=false;
      return;
    }

    let receivedSample=false;
    let screenAngle=getScreenOrientationRadians();
    let lastSample: OrientationSample | null=null;
    let receivedTimer=0;

    const calibrateToCurrentView = (raw: Quaternion) => {
      cameraControl.rawSensorQuaternion.copy(raw);
      cameraControl.sensorOffset.copy(cameraControl.currentQuaternion).multiply(raw.clone().invert());
      cameraControl.sensorTarget.copy(cameraControl.currentQuaternion);
      cameraControl.sensorReady=true;
    };

    const onDeviceOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha === null || event.beta === null || event.gamma === null) return;
      const sample={alpha:event.alpha,beta:event.beta,gamma:event.gamma};
      const currentScreenAngle=getScreenOrientationRadians();
      if (Math.abs(currentScreenAngle-screenAngle)>=0.001) {
        screenAngle=currentScreenAngle;
        lastSample=sample;
        calibrateToCurrentView(toDeviceQuaternion(sample,screenAngle,cameraControl.rawSensorQuaternion));
        receivedSample=true;
        window.clearTimeout(receivedTimer);
        setMotionStatus('Screen orientation updated.');
        return;
      }
      const raw=toDeviceQuaternion(sample,screenAngle,cameraControl.rawSensorQuaternion);
      lastSample=sample;
      if (!receivedSample) {
        receivedSample=true;
        calibrateToCurrentView(raw);
        window.clearTimeout(receivedTimer);
        setMotionStatus('Motion active · move your phone to look around.');
        return;
      }
      cameraControl.sensorTarget.copy(cameraControl.sensorOffset).multiply(raw);
      motionTargetEuler.setFromQuaternion(cameraControl.sensorTarget,'YXZ');
      motionTargetEuler.x=MathUtils.clamp(motionTargetEuler.x,-75*Math.PI/180,75*Math.PI/180);
      motionTargetEuler.z=0;
      cameraControl.sensorTarget.setFromEuler(motionTargetEuler);
    };

    const onScreenOrientationChange = () => {
      const nextAngle=getScreenOrientationRadians();
      if (Math.abs(nextAngle-screenAngle)<0.001) return;
      screenAngle=nextAngle;
      if (!lastSample) return;
      const raw=toDeviceQuaternion(lastSample,screenAngle,cameraControl.rawSensorQuaternion);
      calibrateToCurrentView(raw);
      setMotionStatus('Screen orientation updated.');
    };

    window.addEventListener('deviceorientation',onDeviceOrientation);
    window.addEventListener('orientationchange',onScreenOrientationChange);
    window.screen.orientation?.addEventListener?.('change',onScreenOrientationChange);
    receivedTimer=window.setTimeout(() => {
      if (receivedSample) return;
      cameraControl.sensorReady=false;
      cameraControl.panoramaInput='touch';
      setPanoramaInput('touch');
      setMotionStatus('No motion readings received. Touch mode remains active.');
    },2500);

    return () => {
      window.clearTimeout(receivedTimer);
      window.removeEventListener('deviceorientation',onDeviceOrientation);
      window.removeEventListener('orientationchange',onScreenOrientationChange);
      window.screen.orientation?.removeEventListener?.('change',onScreenOrientationChange);
      cameraControl.sensorReady=false;
    };
  },[panoramaActive,panoramaInput,view,positionalXRActive]);

  return <main className={`${inspectionTarget?'is-inspecting':''} ${positionalXRActive?'positional-ar-active':''} ${physicalWalkActive?'physical-walk-active':''}`}>
    {inspectionTarget && <div className="inspection-tools"><span>Close inspection · {inspectionTarget==='about'?'About Me':inspectionTarget==='deaim'?'De-Aim':inspectionTarget==='hmlnd'?'HMLND':inspectionTarget==='rear'?'Other Work':inspectionTarget==='desk'?'Executive Desk':'Gramophone'}</span>{panoramaActive&&panoramaInput==='motion'&&<div className="guided-walk-controls" aria-label="Guided camera movement"><button onClick={moveCloser} disabled={inspectionWalkStep==='closer'}>Move Closer</button><button onClick={stepBack} disabled={inspectionWalkStep==='center'}>Step Back</button><button onClick={closeInspection}>Return to Center</button></div>}{!(panoramaActive&&panoramaInput==='motion')&&<button onClick={closeInspection}>Back to {cameraControl.mode==='panorama360'?'360° View':'Wall View'}</button>}</div>}
    {musicInteracted && <button className="gramophone-inspect" onClick={()=>focusInspection('gramophone')}>Inspect gramophone</button>}
    <div className={`scene ${mobileExploring?'exploring':''} ${panoramaActive?'panorama':''}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}><SceneErrorBoundary><Canvas frameloop={physicalWalkDriveRequested?'never':'always'} shadows={!physicalWalkDriveRequested} gl={{alpha:true}} camera={{ position:[0,1.1,3.5], fov:72 }} dpr={[1,1.35]}><Scene gramophonePlaying={gramophonePlaying} gramophoneAudioAvailable={gramophoneAudioAvailable} onToggleGramophone={toggleGramophone} onInspect={focusInspection} xrActive={positionalXRActive} xrBridge={positionalXRBridge} onXRBridgeReady={setPositionalXRBridgeReady} onXRActiveChange={handlePositionalXRActiveChange} onXRError={setPositionalXRError} physicalWalkRequested={physicalWalkDriveRequested} physicalWalkSuspended={view!=='home'} physicalWalkBridge={physicalWalkBridge} onPhysicalWalkBridgeReady={handlePhysicalWalkBridgeReady} onPhysicalWalkStatus={handlePhysicalWalkStatus} onPhysicalWalkError={handlePhysicalWalkError} onPhysicalWalkActiveChange={handlePhysicalWalkActiveChange} onPhysicalWalkDiagnostics={setWalkDiagnostics} physicalWalkDiagnosticsEnabled={walkDebugEnabled||import.meta.env.DEV&&walkDiagnosticsOpen}/></Canvas></SceneErrorBoundary><div className="scene-label"><span>●</span> SPATIAL STUDIO</div></div>
    <header><a className="brand" onClick={() => {if(panoramaActive)exitPanorama();setView('home')}}><b>EO</b><span><strong>Emmanuel Owiredu</strong><small>Spatial Developer Portfolio</small></span></a><div className="status">●　Immersive Experience</div><button className="panorama-pill" onClick={panoramaActive?exitPanorama:enterPanorama} aria-label={panoramaActive?'Exit 360 degree view':'Enter 360 degree view'}><Orbit size={16}/>{panoramaActive?'Exit 360°':'360° View'}</button></header>
    {view === 'home' && !panoramaActive && <section className="landing-panels" aria-label="Featured portfolio panels">
      <article className="card deaim" onClick={() => setView('deaim')}><div className="project-head"><div className="symbol"><GraduationCap/></div><div><h2>De-Aim</h2><span>School Management System</span></div><ArrowRight className="arrow"/></div><div className="preview"><div className="preview-side">DE-AIM<br/><br/>Dashboard<br/>Students<br/>Attendance<br/>Finance</div><div className="dash"><small>OVERVIEW · SAMPLE DATA</small><div className="stats"><b>40<small>Students</small></b><b>6<small>Teachers</small></b><b>8<small>Classes</small></b></div><strong>Attendance this week</strong><div className="bars"><i/><i/><i/><i/><i/><i/></div></div></div><small className="tag">EDUCATION PLATFORM · CONCEPT PREVIEW</small></article>
      <article className="card intro"><span className="eyebrow">SOFTWARE DEVELOPER</span><div className="intro-grid"><div><h1>Emmanuel<br/>Owiredu</h1><p>Building immersive web experiences, smart applications, and digital systems that solve real problems.</p><div className="actions"><button onClick={() => setView('projects')}>Explore Projects <ArrowRight size={15}/></button><button className="ghost" disabled aria-label="GitHub profile link not configured"><Code2 size={15}/> GitHub coming soon</button><button className="ghost" onClick={enterPanorama}><Orbit size={14}/> 360° View</button></div></div><div className="portrait"><User size={54}/><small>PORTRAIT<br/>COMING SOON</small></div></div></article>
      <article className="card hmlnd" onClick={() => setView('hmlnd')}><div className="project-head"><div className="symbol"><Layers/></div><div><h2>HMLND</h2><span>Heritage Memory Language Narrative Divinity</span></div><ArrowRight className="arrow"/></div><div className="preview"><div className="fashion"><small>HMLND　 MAINLINE　 STORIES</small><h3>Mainline</h3><span>THE CORE COLLECTION</span><div className="fashion-shape">H</div></div></div><small className="tag">DIGITAL COMMERCE · CONCEPT PREVIEW</small></article>
    </section>}
    {view === 'home' && mobileMode === 'welcome' && <section className="mobile-welcome"><small>SOFTWARE DEVELOPER</small><h1>Emmanuel Owiredu</h1><p>Building immersive web experiences, smart applications, and digital systems that solve real problems.</p><div><button onClick={() => setMobileMode('exploring')}>Explore Office</button><button onClick={() => setView('deaim')}>De-Aim</button><button onClick={() => setView('hmlnd')}>HMLND</button></div></section>}
    {mobileExploring && <button className="mobile-home" onClick={() => {if(panoramaActive)exitPanorama();setMobileMode('welcome');goToWall(0)}}>Home</button>}
    {view !== 'home' && <section className={`overlay ${project?'project-detail':''} ${view==='about'?'about-overlay':''}`}>
      <button className="close" onClick={() => setView('home')}>← Back to Office</button>
      {project ? <>
        <small>{project.tag} · FEATURED PROJECT</small><h2>{project.name}</h2><p>{project.description}</p>
        {project.id==='hmlnd' ? <><div className="live-preview-placeholder"><span>HMLND · LIVE SITE PREVIEW</span><p>Embed policy could not be verified from this environment. This panel is a lightweight project placeholder.</p></div><a className="cta" href="https://hmlnd.netlify.app/" target="_blank" rel="noreferrer">Open Full Website <ArrowRight size={16}/></a></> : <><div className="media-gallery"><div className="media-placeholder">STUDENT MANAGEMENT · SCREENSHOT NEEDED</div><div className="media-placeholder">ATTENDANCE · SCREENSHOT NEEDED</div><div className="media-placeholder">FINANCE · SCREENSHOT NEEDED</div><div className="media-placeholder">ADMINISTRATION · SCREENSHOT NEEDED</div><div className="media-placeholder">PARENT / TEACHER DASHBOARDS · SCREENSHOT NEEDED</div></div><small className="project-stack">React · Node.js · Express · PostgreSQL</small></>}
        <button className="cta" onClick={() => setView('home')}>Back to Office</button>
      </> : view==='about' ? <AboutStory
        onProject={id=>setView(id)}
        onContact={()=>{setView('contact');if(cameraControl.mode==='gallery')goToWall(2)}}
      /> : <>
        <small>SPATIAL STUDIO</small>
        <h2>{view === 'projects' ? 'Featured projects' : `${view[0].toUpperCase()+view.slice(1)} — coming soon`}</h2>
        <p>{view === 'projects' ? 'Select a floating project card to explore its concept preview.' : view==='contact' ? 'Contact details will be added here.' : 'This portfolio section is being prepared.'}</p>
      </>}
    </section>}
    {panoramaActive && (view==='home'||physicalWalkDriveRequested) && <div className={`panorama-tools ${panoramaControlsExpanded?'is-expanded':''} ${physicalWalkActive?'is-physical-walk':''}`} aria-label="360 degree viewing controls">
      <div className="panorama-toolbar-main">
        <div className="panorama-mode-switch" role="group" aria-label="Camera control mode">
          <button className={!physicalWalkDriveRequested&&!positionalXRActive&&panoramaInput==='touch'?'selected':''} aria-pressed={!physicalWalkDriveRequested&&!positionalXRActive&&panoramaInput==='touch'} onClick={selectTouchMode} disabled={positionalXRActive}>Touch</button>
          <button className={!physicalWalkDriveRequested&&!positionalXRActive&&panoramaInput==='motion'?'selected':''} aria-pressed={!physicalWalkDriveRequested&&!positionalXRActive&&panoramaInput==='motion'} onClick={()=>void selectMotionMode()} disabled={positionalXRActive}>Motion</button>
          <button className={physicalWalkDriveRequested||walkPreflightOpen?'selected':''} aria-label="Physical Walk" aria-pressed={physicalWalkDriveRequested||walkPreflightOpen} onClick={()=>{if(physicalWalkDriveRequested){setPanoramaControlsExpanded(true);return;}setWalkPreflightOpen(true);setPanoramaControlsExpanded(true);}} disabled={positionalXRActive||!!inspectionTarget}>Walk</button>
        </div>
        <button className="panorama-icon-button" aria-label="Recenter view" title="Recenter" onClick={positionalXRActive?recenterPositionalXR:physicalWalkDriveRequested?()=>physicalWalkBridge.current?.recenter():recenter}><RotateCcw size={16}/></button>
        <button className="panorama-icon-button" aria-label={positionalXRActive?'Exit Positional AR':physicalWalkDriveRequested?'Exit Physical Walk':'Exit 360 degree view'} title={positionalXRActive?'Exit AR':physicalWalkDriveRequested?'Exit Walk':'Exit 360°'} onClick={()=>{if(positionalXRActive)exitPositionalXR();else if(physicalWalkDriveRequested)selectTouchMode();else exitPanorama();}}><X size={17}/></button>
        <button className={`panorama-expand-button ${panoramaControlsExpanded?'is-open':''}`} aria-label={panoramaControlsExpanded?'Collapse 360 view information':'Expand 360 view information'} aria-expanded={panoramaControlsExpanded} aria-controls="panorama-details" onClick={()=>setPanoramaControlsExpanded(value=>!value)}><ChevronDown size={17}/></button>
      </div>
      {(physicalWalkDriveRequested||physicalWalkError||compactMotionStatus||positionalXRError||positionalXRActive)&&<div className={`panorama-compact-status ${physicalWalkActive&&physicalWalkStatus.startsWith('Tracking normally')?'is-live':''}`} role="status" aria-live="polite">
        <span title={physicalWalkDriveRequested?physicalWalkStatus:physicalWalkError||positionalXRError||compactMotionStatus}>{positionalXRActive?'WebXR camera passthrough active':physicalWalkDriveRequested?physicalWalkStatus:physicalWalkError||positionalXRError||compactMotionStatus}</span>
        {(physicalWalkStatus.includes('Try Again')||!!physicalWalkError)&&<button onClick={()=>void retryPhysicalWalk()}>Retry</button>}
        {physicalWalkDriveRequested&&!physicalWalkActive&&!physicalWalkStatus.includes('Try Again')&&<button onClick={()=>void exitPhysicalWalk()}>Cancel</button>}
        {(physicalWalkDriveRequested||!!physicalWalkError)&&canShowWalkDiagnostics&&<button onClick={()=>setWalkDiagnosticsOpen(value=>!value)} aria-expanded={walkDiagnosticsOpen}>Walk Diagnostics</button>}
      </div>}
      {(physicalWalkDriveRequested||!!physicalWalkError)&&canShowWalkDiagnostics&&walkDiagnosticsOpen&&<section className="walk-production-diagnostics" aria-label="Walk Diagnostics">
        <div className="walk-production-diagnostics-head"><strong>Walk Diagnostics</strong><button onClick={()=>setWalkDiagnosticsOpen(false)} aria-label="Collapse Walk Diagnostics">Close</button></div>
        {walkDiagnostics ? <>
          <dl>
            <div><dt>XR8 script loaded</dt><dd>{walkDiagnostics.engineLoaded?'Yes':'No'} · version {walkDiagnostics.engineVersion}</dd></div>
            <div><dt>Pipeline API / canvas</dt><dd>{walkDiagnostics.pipelineApiCompatible?'compatible':'not confirmed'} · canvas {walkDiagnostics.canvasConnected?'connected':'detached'} · WebGL {walkDiagnostics.webglContextStatus}</dd></div>
            <div><dt>Latest successful stage</dt><dd>{walkDiagnostics.latestSuccessfulStage} · {Math.round(walkDiagnostics.stageAgeMs/1000)}s ago</dd></div>
            <div><dt>Camera status</dt><dd>{walkDiagnostics.cameraStatus}{walkDiagnostics.cameraFailureReason?` · ${walkDiagnostics.cameraFailureReason}`:''}</dd></div>
            <div><dt>Camera / tracking canvas</dt><dd>{walkDiagnostics.videoDimensions} / {walkDiagnostics.pipelineCanvasDimensions} · XR8 projection {walkDiagnostics.projectionCalibrated?'synchronized':'not synchronized'}</dd></div>
            <div><dt>XR8 pipeline callbacks</dt><dd>{walkDiagnostics.pipelineCallbackCount?'Yes':'No'} · {walkDiagnostics.pipelineCallbackCount} received · onUpdate {walkDiagnostics.onUpdateCount}</dd></div>
            <div><dt>processCpuResult.reality</dt><dd>{walkDiagnostics.realityPresent?'Present':'Missing'}</dd></div>
            <div><dt>Tracking</dt><dd>{walkDiagnostics.trackingStatus}{walkDiagnostics.trackingReason?` · ${walkDiagnostics.trackingReason}`:''}</dd></div>
            <div><dt>Tracking frames / time</dt><dd>{Object.entries(walkDiagnostics.trackingFrameCounts).map(([state,count])=>`${state} ${count}`).join(' · ')||'No tracking states received'} · {Object.entries(walkDiagnostics.trackingStateDurationsSeconds).map(([state,seconds])=>`${state} ${seconds.toFixed(1)}s`).join(' · ')}</dd></div>
            <div><dt>Status transitions</dt><dd>{Object.entries(walkDiagnostics.trackingTransitions).map(([transition,count])=>`${transition} ×${count}`).join(' · ')||'No transitions yet'}</dd></div>
            <div><dt>Raw pose present / finite</dt><dd>{walkDiagnostics.rawPosition?'Present':'Missing'} / {walkDiagnostics.rawPoseFinite?'Yes':'No'}{walkDiagnostics.rawPosition?` · ${walkDiagnostics.rawPosition.map(value=>value.toFixed(3)).join(', ')}`:''}</dd></div>
            <div><dt>Origin / accepted</dt><dd>{walkDiagnostics.originReady?'Established':'Not established'} / {walkDiagnostics.poseAccepted?'Yes':'No'}{walkDiagnostics.poseRejectionReason?` · ${walkDiagnostics.poseRejectionReason}`:''}</dd></div>
            <div><dt>Camera application</dt><dd>{walkDiagnostics.renderedPoseCount} camera updates · {walkDiagnostics.collisionConstrained?'collision constrained':'not constrained'} · {walkDiagnostics.appliedPosition.map(value=>value.toFixed(2)).join(', ')}</dd></div>
            <div><dt>Engine exception</dt><dd>{walkDiagnostics.engineException||'None reported'}</dd></div>
            <div><dt>Browser / device class</dt><dd>{walkClientClass}</dd></div>
          </dl>
          <button className="walk-diagnostics-copy" onClick={async()=>{
            const lines=[
              'Spatial Studio Physical Walk diagnostics',
              `XR8 script loaded: ${walkDiagnostics.engineLoaded?'yes':'no'}`,
              `XR8 version: ${walkDiagnostics.engineVersion}`,
              `Pipeline API compatible: ${walkDiagnostics.pipelineApiCompatible?'yes':'not confirmed'}; canvas connected: ${walkDiagnostics.canvasConnected?'yes':'no'}; WebGL: ${walkDiagnostics.webglContextStatus}`,
              `Latest successful stage: ${walkDiagnostics.latestSuccessfulStage} (${Math.round(walkDiagnostics.stageAgeMs/1000)}s ago)`,
              `Camera status: ${walkDiagnostics.cameraStatus}`,
              `Camera / pipeline canvas dimensions: ${walkDiagnostics.videoDimensions} / ${walkDiagnostics.pipelineCanvasDimensions}`,
              `XR8 projection synchronized: ${walkDiagnostics.projectionCalibrated?'yes':'no'}`,
              `Camera failure reason: ${walkDiagnostics.cameraFailureReason||'none reported'}`,
              `Pipeline callbacks: ${walkDiagnostics.pipelineCallbackCount}; onUpdate: ${walkDiagnostics.onUpdateCount}`,
              `processCpuResult.reality: ${walkDiagnostics.realityPresent?'present':'missing'}`,
              `Tracking: ${walkDiagnostics.trackingStatus}; reason: ${walkDiagnostics.trackingReason||'none'}`,
              `Tracking frames by status: ${Object.entries(walkDiagnostics.trackingFrameCounts).map(([state,count])=>`${state} ${count}`).join('; ')||'none'}`,
              `Tracking state/reason durations: ${Object.entries(walkDiagnostics.trackingStateDurationsSeconds).map(([state,seconds])=>`${state} ${seconds.toFixed(1)}s`).join('; ')||'none'}`,
              `Tracking transitions: ${Object.entries(walkDiagnostics.trackingTransitions).map(([transition,count])=>`${transition} x${count}`).join('; ')||'none'}`,
              `Raw finite pose: ${walkDiagnostics.rawPoseFinite?'yes':'no'}; XYZ: ${walkDiagnostics.rawPosition?.map(value=>value.toFixed(3)).join(', ')||'unavailable'}`,
              `Origin established: ${walkDiagnostics.originReady?'yes':'no'}; pose accepted: ${walkDiagnostics.poseAccepted?'yes':'no'}; rejection: ${walkDiagnostics.poseRejectionReason||'none'}`,
              `R3F camera updates: ${walkDiagnostics.renderedPoseCount}; collision constrained: ${walkDiagnostics.collisionConstrained?'yes':'no'}; applied XYZ: ${walkDiagnostics.appliedPosition.map(value=>value.toFixed(2)).join(', ')}`,
              `Engine exception: ${walkDiagnostics.engineException||'none reported'}`,
              `Browser/device class: ${walkClientClass}`,
            ].join('\n');
            try { await navigator.clipboard.writeText(lines); setWalkDiagnosticsCopied(true); window.setTimeout(()=>setWalkDiagnosticsCopied(false),1800); }
            catch { setWalkDiagnosticsCopied(false); }
          }}>{walkDiagnosticsCopied?'Copied':'Copy Diagnostics'}</button>
          {!navigator.clipboard&&<small>Clipboard access requires HTTPS and browser support.</small>}
        </> : <p>Waiting for XR8 startup diagnostics…</p>}
      </section>}
      {panoramaControlsExpanded&&<section id="panorama-details" className="panorama-details" aria-label="360 degree viewing information">
        {walkPreflightOpen&&!physicalWalkDriveRequested ? <>
          <h2>Physical Walk</h2>
          <p>Physical Walk needs rear-camera access for visual tracking. Camera imagery is used for tracking and is not shown as the office background.</p>
          <p className="panorama-safety-copy">The virtual office does not show real obstacles. Start only in a clear area, keep your route unobstructed, and exit if you feel unsafe.</p>
          <small>This product includes XR Engine software developed by Niantic Spatial, Inc. Spatial Studio is independent and not endorsed by Niantic Spatial. <a href="https://github.com/8thwall/engine/blob/main/LICENSE" target="_blank" rel="noreferrer">XR Engine License Agreement</a>.</small>
          <div className="panorama-detail-actions"><button className="panorama-primary-action" onClick={()=>startPhysicalWalk()}>Start Physical Walk</button><button onClick={()=>{setWalkPreflightOpen(false);setPanoramaControlsExpanded(false);}}>Cancel</button></div>
        </> : <>
          <h2>{positionalXRActive?'Positional AR':physicalWalkDriveRequested?'Walk Info':'360° View'}</h2>
          {positionalXRActive ? <>
            <p>Camera passthrough is active. The virtual office hides real obstacles; use a clear area.</p>
            <div className="panorama-detail-actions"><button onClick={recenterPositionalXR}>Recenter / Calibrate</button><button onClick={exitPositionalXR}>Exit Positional AR</button></div>
          </> : physicalWalkDriveRequested ? <>
            <p>The rear camera is used by XR Engine visual tracking; its live image is not shown. The virtual office hides real obstacles. Stay in a clear area and exit if you feel unsafe.</p>
            <small>This product includes XR Engine software developed by Niantic Spatial, Inc. Copyright © 2026 Niantic Spatial, Inc. All rights reserved. The engine is provided as-is without warranties. Spatial Studio is independent and not endorsed by Niantic Spatial. <a href="https://github.com/8thwall/engine/blob/main/LICENSE" target="_blank" rel="noreferrer">XR Engine License Agreement</a>.</small>
          </> : <>
            <p>{panoramaInput==='motion'?'Motion mode uses the phone orientation sensor to look around.':'Touch mode: drag across the office to look around.'}</p>
            {motionStatus&&<p className="panorama-detail-note">{motionStatus}</p>}
            {physicalWalkError&&<p className="panorama-detail-note">{physicalWalkError}</p>}
            {positionalXRError&&<p className="panorama-detail-note">{positionalXRError}</p>}
            <div className="panorama-webxr-info">
              <strong>WebXR Positional AR</strong>
              {positionalXRSupport==='supported'?<><p>Available as a separate camera-passthrough AR mode, independent of 8th Wall Physical Walk. The office hides real obstacles; use a clear area.</p><button onClick={enterPositionalXR} disabled={!positionalXRBridgeReady}>Start Experimental Positional AR</button></>:positionalXRSupport==='checking'?<p>Checking WebXR immersive-ar support. This check does not determine 8th Wall Physical Walk availability.</p>:<p>WebXR immersive-ar is unavailable in this browser or device. This does not mean 8th Wall Physical Walk is unsupported; that feature checks XR8 separately when started.</p>}
            </div>
          </>}
        </>}
        {import.meta.env.DEV&&physicalWalkDriveRequested&&<div className="panorama-dev-diagnostics">
          {walkDiagnostics&&<><b>XR8: {walkDiagnostics.engineLoaded?'loaded':'not loaded'} · camera {walkDiagnostics.cameraStreamInitialized?'ready':'not ready'} ({walkDiagnostics.cameraStatus})</b><span>{walkDiagnostics.trackingStatus}{walkDiagnostics.trackingReason?` · ${walkDiagnostics.trackingReason}`:''} · updates {walkDiagnostics.xrFrameCount} · origin {walkDiagnostics.originReady?'ready':'waiting'}</span><span>Pose {walkDiagnostics.poseAccepted?'accepted':'unavailable'} · {Number.isFinite(walkDiagnostics.rawPoseAgeMs)?walkDiagnostics.rawPoseAgeMs.toFixed(0):'—'} ms · {walkDiagnostics.rawPosition?.map(value=>value.toFixed(2)).join(', ')??'—'} · {walkDiagnostics.fps.toFixed(0)} FPS · {walkDiagnostics.collisionConstrained?'collision constrained':'clear'}</span></>}
          <button onClick={()=>setWalkDiagnosticsOpen(value=>!value)} aria-expanded={walkDiagnosticsOpen}>Detailed stats</button>
          {walkDiagnosticsOpen&&walkDiagnostics&&<div className="walk-debug-panel"><span>Reject: {walkDiagnostics.poseRejectionReason||'none'} · {walkDiagnostics.recoveryState}</span><span>Quaternion: {walkDiagnostics.rawOrientation?.map(value=>value.toFixed(3)).join(', ')??'—'}</span><span>Camera XYZ: {walkDiagnostics.appliedPosition.map(value=>value.toFixed(2)).join(', ')}</span><span>State seconds: {Object.entries(walkDiagnostics.stateSeconds).map(([name,seconds])=>`${name} ${seconds}s`).join(' · ')||'—'}</span><span>Rejected frames: {Object.entries(walkDiagnostics.rejectedFrames).map(([name,count])=>`${name} ${count}`).join(' · ')||'0'}</span></div>}
        </div>}
        <button className="panorama-collapse-link" onClick={()=>setPanoramaControlsExpanded(false)}>Close information</button>
      </section>}
    </div>}
    {mobileExploring && view==='home' && !panoramaActive && <div className="wall-controls"><button aria-label="Previous wall" onClick={()=>navigateBy(-1)}>‹</button><span>{String(activeWall+1).padStart(2,'0')} / 04 · {WALL_GALLERY[activeWall].label}</span><button aria-label="Next wall" onClick={()=>navigateBy(1)}>›</button><button className="wall-recenter" onClick={recenter}>Recenter</button></div>}
    {musicInteracted && <aside className="gramophone-toast" role="status" aria-live="polite"><span>{musicMessage}</span>{gramophoneAudioAvailable&&<button className="music-mute" onClick={toggleMusicMute} aria-label={musicMuted?'Unmute gramophone':'Mute gramophone'}>{musicMuted?<VolumeX size={16}/>:<Volume2 size={16}/>}<span>{musicMuted?'Unmute':'Mute'}</span></button>}<button className="music-dismiss" onClick={()=>setMusicInteracted(false)} aria-label="Dismiss music status">×</button></aside>}
    <nav>{navigation.map(([id,Icon]) => <button key={id} className={view === id || (id==='panorama360'&&panoramaActive) ? 'active' : ''} onClick={() => {
      if (id==='home') { setView('home'); goToWall(0); setMobileMode('welcome'); }
      else if (id==='projects') { setView('home'); goToWall(1); }
      else if (id==='about') { setView('about'); if(cameraControl.mode==='gallery')goToWall(0); }
      else if (id==='skills'||id==='contact') { setView('home'); goToWall(2); }
      else if (id==='panorama360') { panoramaActive ? exitPanorama() : enterPanorama(); }
      else setView(id);
    }}><Icon size={19}/><span>{id === 'panorama360' ? '360° View' : id[0].toUpperCase()+id.slice(1)}</span></button>)}</nav>
    <div className="hint">MOVE YOUR CURSOR TO EXPLORE</div>
  </main>;
}
