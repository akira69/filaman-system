export interface LabelHistory<T> {
  current(): T
  push(value: T): T
  undo(): T
  redo(): T
  canUndo(): boolean
  canRedo(): boolean
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
  const copyCurrent = () => cloneSnapshot(snapshots[index])

  const pushSnapshot = (value: T) => {
    const next = cloneSnapshot(value)
    if (snapshotsEqual(snapshots[index], next)) return copyCurrent()
    snapshots = snapshots.slice(0, index + 1)
    snapshots.push(next)
    if (snapshots.length > limit + 1) snapshots.shift()
    index = snapshots.length - 1
    return copyCurrent()
  }

  return {
    current: copyCurrent,
    push: pushSnapshot,
    undo() {
      if (index > 0) index -= 1
      return copyCurrent()
    },
    redo() {
      if (index < snapshots.length - 1) index += 1
      return copyCurrent()
    },
    canUndo: () => index > 0,
    canRedo: () => index < snapshots.length - 1,
    reset(value) {
      snapshots = [cloneSnapshot(value)]
      index = 0
      return copyCurrent()
    },
  }
}
