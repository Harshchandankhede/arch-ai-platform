import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { MAX_PACKETS, packetRateFor } from './useGraphLayout.js'

const PACKET_RADIUS = 0.075
const TRIM_START = 0.06
const TRIM_END = 0.06
const MAX_DELTA = 0.1

function clamp01(value) {
  if (!Number.isFinite(value) || value < 0) return 0
  return value > 1 ? 1 : value
}

function edgePoint(from, to, progress, arc) {
  const t = TRIM_START + clamp01(progress) * (1 - TRIM_START - TRIM_END)
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t + Math.sin(Math.PI * t) * arc,
    from[2] + (to[2] - from[2]) * t,
  ]
}

function createPool() {
  return {
    slots: Array.from({ length: MAX_PACKETS }, () => ({
      edge: -1,
      progress: 0,
      duration: 1,
      color: new THREE.Color('#ffffff'),
    })),
    free: Array.from({ length: MAX_PACKETS }, (_, i) => MAX_PACKETS - 1 - i),
    accumulators: new Float32Array(0),
  }
}

export function PacketStream({ edges = [], running = false, throughputPerSec = 0 }) {
  const meshRef = useRef(null)
  const poolRef = useRef(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  if (poolRef.current === null) poolRef.current = createPool()

  useEffect(() => {
    const pool = poolRef.current
    for (const slot of pool.slots) slot.edge = -1
    pool.free = Array.from({ length: MAX_PACKETS }, (_, i) => MAX_PACKETS - 1 - i)
    pool.accumulators = new Float32Array(edges.length)
  }, [running, edges])

  useFrame((_, delta) => {
    const mesh = meshRef.current
    const pool = poolRef.current
    if (!mesh || !pool) return
    if (pool.accumulators.length !== edges.length) {
      pool.accumulators = new Float32Array(edges.length)
    }

    const dt = Math.min(Math.max(delta, 0), MAX_DELTA)

    if (running && edges.length) {
      const rate = packetRateFor(throughputPerSec)
      for (let i = 0; i < edges.length; i += 1) {
        pool.accumulators[i] += rate * dt
        if (pool.accumulators[i] < 1) continue
        const overflow = pool.accumulators[i] % 1
        pool.accumulators[i] = overflow
        const index = pool.free.pop()
        if (index === undefined) {
          pool.accumulators[i] = 0
          continue
        }
        const slot = pool.slots[index]
        slot.edge = i
        slot.duration = edges[i].duration || 1
        slot.progress = 1 - overflow
        slot.color.set(edges[i].color)
        mesh.setColorAt(index, slot.color)
      }
    }

    for (let i = 0; i < MAX_PACKETS; i += 1) {
      const slot = pool.slots[i]
      const edge = slot.edge >= 0 ? edges[slot.edge] : null
      if (edge) slot.progress += dt / slot.duration
      if (slot.edge >= 0 && (!edge || slot.progress >= 1)) {
        slot.edge = -1
        pool.free.push(i)
      }
      if (edge && slot.progress < 1) {
        const point = edgePoint(edge.from, edge.to, slot.progress, edge.arc)
        dummy.position.set(point[0], point[1], point[2])
        dummy.scale.setScalar(1)
      } else {
        dummy.position.set(0, -60, 0)
        dummy.scale.setScalar(0)
      }
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[null, null, MAX_PACKETS]}
      visible={running && edges.length > 0}
      frustumCulled={false}
      dispose={null}
    >
      <sphereGeometry args={[PACKET_RADIUS, 8, 8]} />
      <meshBasicMaterial
        transparent
        opacity={0.95}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </instancedMesh>
  )
}
