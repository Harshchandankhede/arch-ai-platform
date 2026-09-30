import { Canvas, useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { categoryOrder } from '../../data/nodeTypes.js'
import { categoryColor, colors } from '../../theme/tokens.js'
import { useDocumentActive, usePrefersReducedMotion } from './useGraphLayout.js'

const NODE_COUNT = 40
const SHELL_INNER = 4.4
const SHELL_OUTER = 8.8
const SHELL_FLATTEN = 0.78
const LINK_DISTANCE = 3.5
const LINK_PROBABILITY = 0.55
const MAX_LINKS = 96
const FLOATS_PER_LINK = 6
const NODE_RADIUS = 0.17
const DRIFT_AMPLITUDE = 0.16
const DRIFT_SPEED = 0.24
const SPIN_SPEED = 0.042
const NODE_SEED = 0x5eed1a7
const LINK_SEED = 0x10c4e5

function mulberry32(seed) {
  let state = seed >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildShell() {
  const rand = mulberry32(NODE_SEED)
  const points = []
  for (let i = 0; i < NODE_COUNT; i += 1) {
    const ratio = (i + 0.5) / NODE_COUNT
    const jitter = (rand() - 0.5) * 0.55
    const phi = Math.acos(THREE.MathUtils.clamp(1 - 2 * ratio + jitter * 0.08, -1, 1))
    const theta = Math.PI * (3 - Math.sqrt(5)) * i + rand() * 0.9
    const radius = SHELL_INNER + rand() * (SHELL_OUTER - SHELL_INNER)
    const sinPhi = Math.sin(phi)
    const category = categoryOrder[i % categoryOrder.length]
    points.push({
      base: [
        sinPhi * Math.cos(theta) * radius,
        Math.cos(phi) * radius * SHELL_FLATTEN,
        sinPhi * Math.sin(theta) * radius,
      ],
      scale: 0.55 + rand() * 0.8,
      phase: rand() * Math.PI * 2,
      speed: DRIFT_SPEED + rand() * 0.22,
      color: new THREE.Color(categoryColor[category] || colors.accent),
    })
  }
  return points
}

function buildLinks(points) {
  const rand = mulberry32(LINK_SEED)
  const limit = MAX_LINKS * FLOATS_PER_LINK
  const segments = []
  for (let i = 0; i < points.length && segments.length < limit; i += 1) {
    for (let j = i + 1; j < points.length && segments.length < limit; j += 1) {
      const a = points[i].base
      const b = points[j].base
      if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > LINK_DISTANCE) continue
      if (rand() > LINK_PROBABILITY) continue
      segments.push(a[0], a[1], a[2], b[0], b[1], b[2])
    }
  }
  return new Float32Array(segments.slice(0, limit))
}

function Field({ reduced }) {
  const groupRef = useRef(null)
  const meshRef = useRef(null)
  const points = useMemo(() => buildShell(), [])
  const links = useMemo(() => buildLinks(points), [points])
  const dummy = useMemo(() => new THREE.Object3D(), [])

  const writeMatrices = useMemo(
    () => (mesh, time) => {
      for (let i = 0; i < points.length; i += 1) {
        const point = points[i]
        const sway = reduced ? 0 : Math.sin(time * point.speed + point.phase) * DRIFT_AMPLITUDE
        const lift = reduced ? 0 : Math.cos(time * point.speed * 0.8 + point.phase) * DRIFT_AMPLITUDE * 0.6
        dummy.position.set(point.base[0] + sway, point.base[1] + lift, point.base[2] - sway)
        dummy.scale.setScalar(point.scale)
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    },
    [points, dummy, reduced],
  )

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    writeMatrices(mesh, 0)
    for (let i = 0; i < points.length; i += 1) mesh.setColorAt(i, points[i].color)
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [points, writeMatrices])

  useFrame((state, delta) => {
    const group = groupRef.current
    const mesh = meshRef.current
    if (reduced || !group || !mesh) return
    const time = state.clock.elapsedTime
    group.rotation.y += Math.min(delta, 0.1) * SPIN_SPEED
    group.rotation.x = Math.sin(time * 0.11) * 0.07
    writeMatrices(mesh, time)
  })

  return (
    <group ref={groupRef}>
      <instancedMesh ref={meshRef} args={[null, null, points.length]} frustumCulled={false} dispose={null}>
        <icosahedronGeometry args={[NODE_RADIUS, 0]} />
        <meshStandardMaterial
          emissive={colors.ink}
          emissiveIntensity={0.12}
          roughness={0.32}
          metalness={0.22}
        />
      </instancedMesh>
      {links.length > 0 && (
        <lineSegments frustumCulled={false} dispose={null}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[links, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={colors.blue} transparent opacity={0.17} depthWrite={false} />
        </lineSegments>
      )}
    </group>
  )
}

export default function LandingScene() {
  const active = useDocumentActive()
  const reduced = usePrefersReducedMotion()

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Canvas
        dpr={[1, 1.75]}
        frameloop={active ? 'always' : 'never'}
        camera={{ position: [0, 0.4, 15.5], fov: 42, near: 0.1, far: 80 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      >
        <ambientLight intensity={0.85} />
        <directionalLight position={[5, 8, 6]} intensity={0.7} />
        <Field reduced={reduced} />
      </Canvas>
    </div>
  )
}
