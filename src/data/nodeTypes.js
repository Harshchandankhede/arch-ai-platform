export const categories = {
  client: { label: 'Client' },
  application: { label: 'Application' },
  data: { label: 'Data' },
  infrastructure: { label: 'Infrastructure' },
  security: { label: 'Security' },
}

export const categoryOrder = ['client', 'application', 'data', 'infrastructure', 'security']

export const parameterMeta = {
  processingTime: { label: 'Processing Time', unit: 'ms', min: 1, max: 500, step: 1, kind: 'number' },
  capacity: { label: 'Capacity', unit: 'concurrent', min: 1, max: 2000, step: 1, kind: 'number' },
  failureProbability: { label: 'Failure Probability', unit: '0–1', min: 0, max: 1, step: 0.001, kind: 'probability' },
  queueCapacity: { label: 'Queue Capacity', unit: 'waiting', min: 0, max: 2000, step: 1, kind: 'number' },
  memoryMb: { label: 'Base Memory', unit: 'MB', min: 16, max: 8192, step: 16, kind: 'number' },
  memoryPerSessionMb: { label: 'Memory / Session', unit: 'MB', min: 0, max: 512, step: 1, kind: 'number' },
  retryLimit: { label: 'Retry Limit', unit: 'attempts', min: 0, max: 5, step: 1, kind: 'number' },
  baseLatencyMs: { label: 'Network Latency', unit: 'ms', min: 0, max: 500, step: 1, kind: 'number' },
}

const base = { memoryMb: 128, memoryPerSessionMb: 8, retryLimit: 1, baseLatencyMs: 2 }

export const nodeTypes = {
  user: { name: 'User', cat: 'client', shape: 'pill', defaults: {} },
  webClient: { name: 'Web Client', cat: 'client', shape: 'pill', defaults: {} },
  mobileClient: { name: 'Mobile Client', cat: 'client', shape: 'pill', defaults: {} },
  apiGateway: {
    name: 'API Gateway',
    cat: 'application',
    shape: 'rect',
    defaults: { processingTime: 10, capacity: 200, failureProbability: 0.01, ...base },
  },
  loadBalancer: {
    name: 'Load Balancer',
    cat: 'application',
    shape: 'rect',
    defaults: { processingTime: 3, capacity: 400, failureProbability: 0.005, ...base },
  },
  server: {
    name: 'Server',
    cat: 'application',
    shape: 'rect',
    defaults: { processingTime: 30, capacity: 100, failureProbability: 0.01, ...base },
  },
  microservice: {
    name: 'Microservice',
    cat: 'application',
    shape: 'rect',
    defaults: { processingTime: 22, capacity: 120, failureProbability: 0.01, ...base },
  },
  database: {
    name: 'Database',
    cat: 'data',
    shape: 'cylinder',
    defaults: {
      processingTime: 40,
      capacity: 80,
      failureProbability: 0.005,
      queueCapacity: 50,
      memoryMb: 1024,
      memoryPerSessionMb: 24,
      retryLimit: 1,
      baseLatencyMs: 4,
    },
  },
  cache: {
    name: 'Cache',
    cat: 'data',
    shape: 'rect',
    defaults: { processingTime: 4, capacity: 500, failureProbability: 0.001, ...base, memoryMb: 512 },
  },
  fileStorage: {
    name: 'File Storage',
    cat: 'data',
    shape: 'folder',
    defaults: {
      processingTime: 15,
      capacity: 150,
      failureProbability: 0.002,
      ...base,
      memoryMb: 256,
      memoryPerSessionMb: 4,
    },
  },
  queue: {
    name: 'Queue',
    cat: 'infrastructure',
    shape: 'stack',
    defaults: { processingTime: 2, capacity: 1000, queueCapacity: 500, ...base },
  },
  messageBroker: {
    name: 'Message Broker',
    cat: 'infrastructure',
    shape: 'stack',
    defaults: { processingTime: 5, capacity: 600, queueCapacity: 500, ...base, memoryMb: 256 },
  },
  externalService: {
    name: 'External Service',
    cat: 'infrastructure',
    shape: 'cloud',
    defaults: {
      processingTime: 60,
      capacity: 60,
      failureProbability: 0.03,
      ...base,
      baseLatencyMs: 25,
    },
  },
  authentication: {
    name: 'Authentication',
    cat: 'security',
    shape: 'shield',
    defaults: { processingTime: 8, capacity: 300, failureProbability: 0.005, ...base },
  },
  firewall: {
    name: 'Firewall',
    cat: 'security',
    shape: 'shield',
    defaults: { processingTime: 1, capacity: 1000, failureProbability: 0.001, ...base },
  },
}

export const nodeTypeKeys = Object.keys(nodeTypes)

export function typesByCategory(cat) {
  return nodeTypeKeys.filter((k) => nodeTypes[k].cat === cat)
}

export function defaultParams(type) {
  return { ...(nodeTypes[type]?.defaults || {}) }
}

export function paramsFor(type) {
  return Object.keys(nodeTypes[type]?.defaults || {})
}

export function resolveParams(node) {
  return { ...(nodeTypes[node.type]?.defaults || {}), ...(node.parameters || {}) }
}

export const clientTypes = ['user', 'webClient', 'mobileClient']
export const computeTypes = ['server', 'microservice']
export const storeTypes = ['database', 'fileStorage']

export function isClient(node) {
  return clientTypes.includes(node.type)
}

export function isCompute(node) {
  return computeTypes.includes(node.type)
}

export function isStore(node) {
  return storeTypes.includes(node.type)
}

export function nodeMemoryLimit(params) {
  const base_ = params.memoryMb ?? 128
  const per = params.memoryPerSessionMb ?? 8
  const capacity = params.capacity ?? 100
  return base_ + per * capacity
}
