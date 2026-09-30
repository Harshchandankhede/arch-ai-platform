export const questionBank = [
  {
    topic: 'Scalability',
    q: 'What is the difference between horizontal and vertical scaling?',
    keys: ['horizontal', 'vertical', 'instance', 'adding server', 'more machine', 'increasing capacity', 'machine'],
  },
  {
    topic: 'Caching',
    q: 'Why does adding a cache in front of a database usually reduce latency?',
    keys: ['cache', 'memory', 'reduce', 'database load', 'faster', 'frequent', 'read'],
  },
  {
    topic: 'Load Balancing',
    q: 'What problem does a load balancer solve in a distributed architecture?',
    keys: ['distribute', 'traffic', 'multiple server', 'single point of failure', 'even load', 'balance'],
  },
  {
    topic: 'Bottlenecks',
    q: 'What is a bottleneck in the context of process mining and simulation?',
    keys: ['slowest', 'capacity', 'queue', 'wait', 'constrain', 'throughput', 'saturat'],
  },
  {
    topic: 'Reliability',
    q: 'Why might an architecture have high reliability but low scalability?',
    keys: ['redundan', 'failover', 'capacity', 'scale', 'single', 'limit', 'headroom'],
  },
  {
    topic: 'Queuing',
    q: 'What does Little’s Law tell us about a system under load?',
    keys: ['little', 'law', 'concurrency', 'latency', 'throughput', 'average', 'l =', 'lambda'],
  },
  {
    topic: 'Process Mining',
    q: 'How does an event log differ from a process model?',
    keys: ['event log', 'actual', 'recorded', 'case', 'trace', 'happened', 'observed'],
  },
  {
    topic: 'Deviation',
    q: 'What is a process deviation, and why does it matter during evaluation?',
    keys: ['deviation', 'expected', 'actual', 'differ', 'conformance', 'unexpected', 'drift'],
  },
  {
    topic: 'Security',
    q: 'Where should authentication and authorisation sit in a layered architecture?',
    keys: ['entry', 'gateway', 'before', 'application', 'perimeter', 'front', 'defence', 'defense'],
  },
  {
    topic: 'Evaluation',
    q: 'Why normalise each quality attribute to a 0–100 scale before computing a health score?',
    keys: ['normalise', 'normalize', 'scale', 'compar', 'weighted', '0', '100', 'consistent'],
  },
  {
    topic: 'Trade-offs',
    q: 'What is a trade-off between redundancy and cost in a distributed system?',
    keys: ['trade', 'cost', 'redundan', 'resource', 'expensive', 'budget', 'replica'],
  },
  {
    topic: 'Coupling',
    q: 'How does tight coupling between components affect maintainability?',
    keys: ['coupling', 'depend', 'change', 'deploy', 'test', 'independent', 'modif'],
  },
  {
    topic: 'Caching',
    q: 'What invalidation problem arises once you introduce a cache?',
    keys: ['invalidat', 'stale', 'consisten', 'expire', 'ttl', 'outdated', 'sync'],
  },
  {
    topic: 'Simulation',
    q: 'Why use a discrete event simulation rather than stepping the workload in fixed time slices?',
    keys: ['discrete event', 'event', 'exact', 'queue', 'order', 'precision', 'timestamp', 'efficient'],
  },
  {
    topic: 'AI Advisory',
    q: 'Why should explainable AI recommendations not replace objective evaluation metrics?',
    keys: ['explain', 'objective', 'metric', 'assist', 'verif', 'bias', 'supplement', 'replace'],
  },
]

export function scoreAnswer(question, answer) {
  const text = (answer || '').toLowerCase()
  if (!text.trim()) return 0
  const hits = question.keys.filter((k) => text.includes(k.toLowerCase())).length
  const expected = Math.max(2, Math.ceil(question.keys.length * 0.5))
  const score = Math.min(100, Math.round((hits / expected) * 100))
  const missing = question.keys.filter((k) => !text.includes(k.toLowerCase()))
  return { score, hits, missing }
}

export function feedbackFor(score, question, missing) {
  if (score >= 70) {
    return `Strong answer (${score}/100). You covered the core idea for “${question.topic}”.`
  }
  if (score >= 35) {
    return `Partial credit (${score}/100). You are on the right track for “${question.topic}”. Try naming the mechanism explicitly — terms like ${missing.slice(0, 2).join(' or ')} would make it precise.`
  }
  return `Needs work (${score}/100). Revisit “${question.topic}”. Start by naming what changes in the system's behaviour, then why. Useful keywords: ${missing.slice(0, 3).join(', ')}.`
}
