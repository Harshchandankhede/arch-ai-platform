import { Html, Line, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { colors } from '../../theme/tokens.js'
import { PacketStream } from './PacketStream.jsx'
import {
  useDocumentActive,
  useGraphLayout,
  usePrefersReducedMotion,
} from './useGraphLayout.js'

const GEOMETRIES = {
  pill: new THREE.CapsuleGeometry(0.22, 0.5, 4, 14),
  rect: new THREE.BoxGeometry(0.92, 0.34, 0.56),
  plate: new THREE.BoxGeometry(0.86, 0.1, 0.6),
  tab: new THREE.BoxGeometry(0.34, 0.18, 0.6),
  tier: new THREE.BoxGeometry(0.8, 0.11, 0.54),
  cylinder: new THREE.CylinderGeometry(0.34, 0.36, 0.62, 22),
  core: new THREE.SphereGeometry(0.25, 14, 10),
  crown: new THREE.SphereGeometry(0.33, 16, 10),
  puff: new THREE.SphereGeometry(0.2, 12, 8),
  shield: new THREE.SphereGeometry(0.42, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
}

function Surface({ color, opacity = 1 }) {
  return (
    <meshStandardMaterial
      color={color}
      emissive={color}
      emissiveIntensity={0.34}
      roughness={0.42}
      metalness={0.16}
      transparent={opacity < 1}
      opacity={opacity}
    />
  )
}

function ShapeMesh({ shape, color }) {
  if (shape === 'pill') {
    return (
      <mesh geometry={GEOMETRIES.pill} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.82]} dispose={null}>
        <Surface color={color} />
      </mesh>
    )
  }
  if (shape === 'cylinder') {
    return (
      <mesh geometry={GEOMETRIES.cylinder} dispose={null}>
        <Surface color={color} />
      </mesh>
    )
  }
  if (shape === 'folder') {
    return (
      <group>
        <mesh geometry={GEOMETRIES.plate} position={[0, -0.14, 0]} dispose={null}>
          <Surface color={color} />
        </mesh>
        <mesh geometry={GEOMETRIES.tab} position={[-0.24, 0.02, 0]} dispose={null}>
          <Surface color={color} opacity={0.82} />
        </mesh>
      </group>
    )
  }
  if (shape === 'stack') {
    return (
      <group>
        <mesh geometry={GEOMETRIES.tier} position={[0, -0.2, 0]} dispose={null}>
          <Surface color={color} />
        </mesh>
        <mesh geometry={GEOMETRIES.tier} position={[0, 0, 0]} dispose={null}>
          <Surface color={color} />
        </mesh>
        <mesh geometry={GEOMETRIES.tier} position={[0, 0.2, 0]} dispose={null}>
          <Surface color={color} opacity={0.82} />
        </mesh>
      </group>
    )
  }
  if (shape === 'cloud') {
    return (
      <group>
        <mesh geometry={GEOMETRIES.crown} position={[-0.24, 0.04, 0]} dispose={null}>
          <Surface color={color} />
        </mesh>
        <mesh geometry={GEOMETRIES.core} position={[0.26, -0.04, 0.02]} dispose={null}>
          <Surface color={color} />
        </mesh>
        <mesh geometry={GEOMETRIES.puff} position={[0.02, -0.12, 0.16]} dispose={null}>
          <Surface color={color} opacity={0.8} />
        </mesh>
      </group>
    )
  }
  if (shape === 'shield') {
    return (
      <mesh
        geometry={GEOMETRIES.shield}
        position={[0, 0.14, 0]}
        scale={[1, 0.9, 0.38]}
        dispose={null}
      >
        <Surface color={color} />
      </mesh>
    )
  }
  return (
    <mesh geometry={GEOMETRIES.rect} dispose={null}>
      <Surface color={color} />
    </mesh>
  )
}

function ComponentNode({ item, labelled }) {
  const [x, y, z] = item.position
  return (
    <group position={[x, y, z]}>
      <ShapeMesh shape={item.shape} color={item.color} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.42, 0]} dispose={null}>
        <ringGeometry args={[0.62, 0.86, 28]} />
        <meshBasicMaterial
          color={item.color}
          transparent
          opacity={0.24}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {labelled && (
        <Html
          position={[0, 0.92, 0]}
          center
          zIndexRange={[6, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div className="pointer-events-none max-w-[132px] rounded-[6px] border border-line bg-overlay/95 px-2 py-1 text-center shadow-lg">
            <div className="truncate text-[10.5px] leading-tight font-semibold text-ink">{item.name}</div>
            <div className="font-mono text-[10px] leading-tight" style={{ color: item.color }}>
              {Math.round(item.utilization * 100)}% util
            </div>
          </div>
        </Html>
      )}
    </group>
  )
}

function Graph({ layout, running }) {
  const { nodes, edges, labelIds, bounds } = layout
  const labelSet = useMemo(() => new Set(labelIds), [labelIds])
  const paths = useMemo(
    () =>
      edges.map((edge) => {
        const mid = [
          (edge.from[0] + edge.to[0]) / 2,
          (edge.from[1] + edge.to[1]) / 2 + edge.arc,
          (edge.from[2] + edge.to[2]) / 2,
        ]
        return { key: edge.key, points: [edge.from, mid, edge.to], color: edge.color }
      }),
    [edges],
  )
  const target = bounds.center

  return (
    <group>
      {paths.map((path) => (
        <Line
          key={path.key}
          points={path.points}
          color={path.color}
          lineWidth={1.1}
          transparent
          opacity={0.34}
          depthWrite={false}
          toneMapped={false}
        />
      ))}
      {nodes.map((item) => (
        <ComponentNode key={item.id} item={item} labelled={labelSet.has(item.id)} />
      ))}
      <PacketStream edges={edges} running={running} throughputPerSec={layout.throughputPerSec} />
      <OrbitControls
        makeDefault
        target={target}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.65}
        zoomSpeed={0.7}
        panSpeed={0.6}
        minDistance={5}
        maxDistance={46}
        minPolarAngle={0.15}
        maxPolarAngle={Math.PI * 0.88}
      />
    </group>
  )
}

export default function TwinScene({ architecture, sim, running = false }) {
  const active = useDocumentActive()
  const reduced = usePrefersReducedMotion()
  const layout = useGraphLayout(architecture, sim)
  const center = layout.bounds.center
  const camera = useMemo(
    () => ({
      position: [center[0] + 0.6, center[1] + 3.4, center[2] + 18],
      fov: 45,
      near: 0.1,
      far: 140,
    }),
    [center],
  )

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Canvas
        dpr={[1, 1.75]}
        frameloop={active ? 'always' : 'never'}
        camera={camera}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={[colors.base]} />
        <fog attach="fog" args={[colors.base, 24, 62]} />
        <ambientLight intensity={0.62} />
        <directionalLight position={[7, 13, 9]} intensity={0.95} />
        <Graph layout={layout} running={Boolean(running) && !reduced} />
      </Canvas>
    </div>
  )
}
