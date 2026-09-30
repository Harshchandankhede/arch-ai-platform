function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

export function strongArchitecture() {
  return {
    nodes: [
      { id: 'user-1', type: 'user', name: 'User', position: { x: 60, y: 240 }, parameters: {} },
      {
        id: 'gw-1',
        type: 'apiGateway',
        name: 'API Gateway',
        position: { x: 260, y: 240 },
        parameters: {
          processingTime: 8,
          capacity: 250,
          failureProbability: 0.005,
          memoryMb: 192,
          memoryPerSessionMb: 4,
          retryLimit: 1,
          baseLatencyMs: 2,
        },
      },
      {
        id: 'lb-1',
        type: 'loadBalancer',
        name: 'Load Balancer',
        position: { x: 470, y: 240 },
        parameters: {
          processingTime: 3,
          capacity: 400,
          failureProbability: 0.002,
          memoryMb: 128,
          memoryPerSessionMb: 4,
          retryLimit: 1,
          baseLatencyMs: 1,
        },
      },
      {
        id: 'srv-1',
        type: 'server',
        name: 'App Server A',
        position: { x: 680, y: 150 },
        parameters: {
          processingTime: 25,
          capacity: 120,
          failureProbability: 0.01,
          memoryMb: 256,
          memoryPerSessionMb: 12,
          retryLimit: 1,
          baseLatencyMs: 2,
        },
      },
      {
        id: 'srv-2',
        type: 'server',
        name: 'App Server B',
        position: { x: 680, y: 330 },
        parameters: {
          processingTime: 25,
          capacity: 120,
          failureProbability: 0.01,
          memoryMb: 256,
          memoryPerSessionMb: 12,
          retryLimit: 1,
          baseLatencyMs: 2,
        },
      },
      {
        id: 'cache-1',
        type: 'cache',
        name: 'Cache',
        position: { x: 890, y: 240 },
        parameters: {
          processingTime: 3,
          capacity: 500,
          failureProbability: 0.001,
          memoryMb: 512,
          memoryPerSessionMb: 2,
          retryLimit: 0,
          baseLatencyMs: 1,
        },
      },
      {
        id: 'db-1',
        type: 'database',
        name: 'Database',
        position: { x: 1090, y: 240 },
        parameters: {
          processingTime: 35,
          capacity: 150,
          failureProbability: 0.004,
          queueCapacity: 80,
          memoryMb: 2048,
          memoryPerSessionMb: 24,
          retryLimit: 1,
          baseLatencyMs: 4,
        },
      },
      {
        id: 'auth-1',
        type: 'authentication',
        name: 'Auth Service',
        position: { x: 260, y: 430 },
        parameters: {
          processingTime: 6,
          capacity: 300,
          failureProbability: 0.003,
          memoryMb: 160,
          memoryPerSessionMb: 4,
          retryLimit: 1,
          baseLatencyMs: 2,
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'user-1', target: 'gw-1' },
      { id: 'e2', source: 'gw-1', target: 'lb-1' },
      { id: 'e3', source: 'lb-1', target: 'srv-1' },
      { id: 'e4', source: 'lb-1', target: 'srv-2' },
      { id: 'e5', source: 'srv-1', target: 'cache-1' },
      { id: 'e6', source: 'srv-2', target: 'cache-1' },
      { id: 'e7', source: 'cache-1', target: 'db-1' },
      { id: 'e8', source: 'gw-1', target: 'auth-1' },
    ],
  }
}

export function weakArchitecture() {
  return {
    nodes: [
      { id: 'user-1', type: 'user', name: 'User', position: { x: 80, y: 240 }, parameters: {} },
      {
        id: 'api-1',
        type: 'apiGateway',
        name: 'API',
        position: { x: 340, y: 240 },
        parameters: {
          processingTime: 12,
          capacity: 120,
          failureProbability: 0.02,
          memoryMb: 128,
          memoryPerSessionMb: 8,
          retryLimit: 1,
          baseLatencyMs: 2,
        },
      },
      {
        id: 'srv-1',
        type: 'server',
        name: 'App Server',
        position: { x: 620, y: 240 },
        parameters: {
          processingTime: 45,
          capacity: 60,
          failureProbability: 0.02,
          memoryMb: 192,
          memoryPerSessionMb: 10,
          retryLimit: 1,
          baseLatencyMs: 2,
        },
      },
      {
        id: 'db-1',
        type: 'database',
        name: 'Database',
        position: { x: 900, y: 240 },
        parameters: {
          processingTime: 55,
          capacity: 40,
          failureProbability: 0.015,
          queueCapacity: 20,
          memoryMb: 1024,
          memoryPerSessionMb: 24,
          retryLimit: 1,
          baseLatencyMs: 4,
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'user-1', target: 'api-1' },
      { id: 'e2', source: 'api-1', target: 'srv-1' },
      { id: 'e3', source: 'srv-1', target: 'db-1' },
    ],
  }
}

export function starterArchitecture() {
  return {
    nodes: [
      { id: 'user-1', type: 'user', name: 'User', position: { x: 80, y: 200 }, parameters: {} },
      {
        id: 'gw-1',
        type: 'apiGateway',
        name: 'API Gateway',
        position: { x: 340, y: 200 },
        parameters: {},
      },
      { id: 'srv-1', type: 'server', name: 'App Server', position: { x: 620, y: 200 }, parameters: {} },
      { id: 'db-1', type: 'database', name: 'Database', position: { x: 900, y: 200 }, parameters: {} },
    ],
    edges: [
      { id: 'e1', source: 'user-1', target: 'gw-1' },
      { id: 'e2', source: 'gw-1', target: 'srv-1' },
      { id: 'e3', source: 'srv-1', target: 'db-1' },
    ],
  }
}

export function seedProjects() {
  return [
    {
      id: 'p1',
      name: 'Checkout Service — v2',
      description:
        'Redundant e-commerce checkout pipeline with a load-balanced application tier, cache and authentication layer.',
      updatedAt: Date.now(),
      arch: strongArchitecture(),
    },
    {
      id: 'p2',
      name: 'Legacy Order API — v1',
      description: 'Single-server monolith handling order writes directly against the primary database.',
      updatedAt: Date.now() - 86400000,
      arch: weakArchitecture(),
    },
  ]
}

export function cloneArchitecture(arch) {
  return clone(arch)
}
