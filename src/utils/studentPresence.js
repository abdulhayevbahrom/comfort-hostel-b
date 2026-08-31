export function resolveStudentDirection(configuredDirection, isInside, lastDirection = null, isDuplicate = false) {
  if (configuredDirection === 'IN' || configuredDirection === 'OUT') return configuredDirection
  if (isDuplicate && ['IN', 'OUT'].includes(lastDirection)) return lastDirection
  return isInside ? 'OUT' : 'IN'
}

export function planStudentMovement({
  configuredDirection,
  isInside = false,
  lastEventAt = null,
  lastDirection = null,
  occurredAt,
  duplicateWindowMs = 300_000,
}) {
  const eventTime = new Date(occurredAt)
  const previousTime = lastEventAt ? new Date(lastEventAt) : null
  const delta = previousTime && !Number.isNaN(previousTime.getTime()) ? eventTime.getTime() - previousTime.getTime() : null
  const recent = delta !== null && delta >= 0 && delta < duplicateWindowMs
  const direction = resolveStudentDirection(configuredDirection, isInside, lastDirection, recent)

  if (previousTime && eventTime < previousTime) return { direction, transition: 'stale', applied: false }
  if (recent && direction === lastDirection) return { direction, transition: 'duplicate', applied: false }
  if (direction === 'IN') return { direction, transition: isInside ? 'reentered' : 'entered', applied: true }
  if (isInside) return { direction, transition: 'exited', applied: true }
  return { direction, transition: 'orphan_exit', applied: true }
}
