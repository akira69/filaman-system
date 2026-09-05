export interface LabelHistory<T> {
  current(): T
  push(value: T): T
  undo(): T
  redo(): T
  canUndo(): boolean
  canRedo(): boolean
  beginGesture(): void
  updateGesture(value: T): T
  endGesture(): T
  reset(value: T): T
}

function cloneSnapshot<T>(value: T): T {
  return structuredClone(value)
}

function snapshotsEqual<T>(left: T, right: T) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function createLabelHistory<T>(initial: T, maxUndoSnapshots = 50): LabelHistory<T> {
  const limit = Math.max(1, Math.floor(maxUndoSnapshots))
  let snapshots = [cloneSnapshot(initial)]
  let index = 0
  let gestureStart: T | null = null
  let gestureLatest: T | null = null

  const activeValue = () => gestureLatest ?? snapshots[index]
  const copyCurrent = () => cloneSnapshot(activeValue())

  const pushSnapshot = (value: T) => {
    const next = cloneSnapshot(value)
    if (snapshotsEqual(snapshots[index], next)) return copyCurrent()
    snapshots = snapshots.slice(0, index + 1)
    snapshots.push(next)
    if (snapshots.length > limit + 1) snapshots.shift()
    index = snapshots.length - 1
    return copyCurrent()
  }

  const endGesture = () => {
    if (gestureStart === null || gestureLatest === null) {
      gestureStart = null
      gestureLatest = null
      return copyCurrent()
    }
    const start = gestureStart
    const latest = gestureLatest
    gestureStart = null
    gestureLatest = null
    if (!snapshotsEqual(start, latest)) pushSnapshot(latest)
    return copyCurrent()
  }

  return {
    current: copyCurrent,
    push(value) {
      if (gestureStart !== null) endGesture()
      return pushSnapshot(value)
    },
    undo() {
      if (gestureStart !== null) endGesture()
      if (index > 0) index -= 1
      return copyCurrent()
    },
    redo() {
      if (gestureStart !== null) endGesture()
      if (index < snapshots.length - 1) index += 1
      return copyCurrent()
    },
    canUndo: () => index > 0,
    canRedo: () => index < snapshots.length - 1,
    beginGesture() {
      if (gestureStart !== null) return
      gestureStart = cloneSnapshot(snapshots[index])
      gestureLatest = cloneSnapshot(snapshots[index])
    },
    updateGesture(value) {
      if (gestureStart === null) this.beginGesture()
      gestureLatest = cloneSnapshot(value)
      return copyCurrent()
    },
    endGesture,
    reset(value) {
      snapshots = [cloneSnapshot(value)]
      index = 0
      gestureStart = null
      gestureLatest = null
      return copyCurrent()
    },
  }
}
