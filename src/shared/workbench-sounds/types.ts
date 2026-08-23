/**
 * Shared types for the workbench sounds system.
 * Sound files are stored in `~/.dsh/workbench-sounds/`:
 * - index.json: sound registry
 * - custom/: user-uploaded audio files
 */

/** A registered sound. */
export interface SoundEntry {
  /** Stable ID, e.g. "chime-ascending" or "custom-uuid". */
  id: string
  /** Display name (English). */
  name: string
  /** Display name (Chinese). */
  nameZh: string
  /** "builtin" | "custom" */
  kind: 'builtin' | 'custom'
  /**
   * For built-in synthesis: the URL or data-URL of the sound.
   * For custom: relative path served by /workbench-sounds/{id}
   */
  url: string
  /** Original filename for custom sounds. */
  filename?: string
  /** MIME type, e.g. "audio/ogg", "audio/mp3", "audio/wav". */
  mimeType: string
  /** File size in bytes (custom sounds only). */
  size?: number
}

/** The sound registry stored at ~/.dsh/workbench-sounds/index.json */
export interface SoundIndex {
  version: 1
  /** Ordered list of custom sounds (built-ins come from the plugin). */
  custom: SoundEntry[]
}

/** User-selected sound preference, stored in localStorage. */
export interface SoundPreference {
  /** Selected sound ID, e.g. "chime-ascending" or "custom-xxx". */
  selectedId: string
}

export const SOUNDS_DIR = 'workbench-sounds'
export const SOUNDS_INDEX_FILE = 'index.json'
export const SOUNDS_CUSTOM_DIR = 'custom'
export const HTTP_PREFIX = '/workbench-sounds'

/**
 * 自定义音频上传上限：50MB（本地使用，不设过小限制；
 * 超过 50MB 拒绝，50MB 及以下（含完整歌曲）均可上传播放）。
 * parseBody 的 multipart 缓冲上限须比该值留出头部/边界开销余量。
 */
export const MAX_SOUND_UPLOAD_BYTES = 50 * 1024 * 1024
