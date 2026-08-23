/**
 * Agent Control Plane 显示开关（localStorage）。
 * Settings 面板与 Workbench editor 首 Tab 共用同一偏好。
 */
import { useSyncExternalStore } from 'react'
import {
  CONTROL_PLANE_VISIBLE_KEY,
  DEFAULT_CONTROL_PLANE_VISIBLE,
  readBoolFlag,
  writeBoolFlag,
} from './ui-flags.ts'

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function read(): boolean {
  return readBoolFlag(CONTROL_PLANE_VISIBLE_KEY, DEFAULT_CONTROL_PLANE_VISIBLE)
}

export function getControlPlaneVisible(): boolean {
  return read()
}

export function setControlPlaneVisible(on: boolean): void {
  writeBoolFlag(CONTROL_PLANE_VISIBLE_KEY, on)
  emit()
}

export function useControlPlaneVisible(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => DEFAULT_CONTROL_PLANE_VISIBLE)
  return [on, setControlPlaneVisible]
}
