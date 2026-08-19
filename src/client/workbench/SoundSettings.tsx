/**
 * 提示音设置：选择内置提示音 或 上传自定义音频文件。
 *
 * 列表直接平铺展示（不再用下拉浮层）：选中项高亮 + 左侧对勾，
 * 行内提供试听按钮；自定义音频行可删除。上传区同样内联展开。
 */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { BUILTIN_SOUNDS } from '../../shared/workbench-sounds/builtins.ts'
import { MAX_SOUND_UPLOAD_BYTES } from '../../shared/workbench-sounds/types.ts'
import { IconButton } from './IconButton.tsx'
import { IconCheck, IconPlay, IconPlus, IconTrash } from './icons.tsx'
import { uiLocaleFromTranslate, type Translate } from './types.ts'
import { playBuiltinSound, playCustomSound } from './useSessionMonitor.ts'
import css from './SoundSettings.module.css'

const SOUNDS_HTTP_PREFIX = '/workbench-sounds'
const PREF_KEY = 'dsh-workbench-sound-id'

interface CustomSound {
  id: string
  name: string
  nameZh: string
  filename: string
  playUrl: string
}

interface SoundOption {
  id: string
  label: string
  kind: 'builtin' | 'custom'
  desc: string
}

export interface SoundSettingsProps {
  t: Translate
}

function builtinSoundKey(id: string, field: 'name' | 'desc'): string {
  return `sessions.sound.builtin.${id}.${field}`
}

function mapUploadError(message: string, t: Translate): string {
  const trimmed = message.trim()
  if (trimmed === '') return t('sessions.soundUploadFail')
  if (/unsupported audio format/i.test(trimmed)) return t('sessions.soundUploadUnsupported')
  if (/file too large/i.test(trimmed)) {
    return t('sessions.soundUploadTooLarge', { max: Math.round(MAX_SOUND_UPLOAD_BYTES / 1024 / 1024) })
  }
  if (/empty file/i.test(trimmed)) return t('sessions.soundUploadEmpty')
  if (/expected multipart|no file found/i.test(trimmed)) return t('sessions.soundUploadFail')
  return t('sessions.soundUploadFail')
}

export function SoundSettings({ t }: SoundSettingsProps) {
  const lang = uiLocaleFromTranslate(t)
  const [selectedId, setSelectedId] = useState<string>(() => {
    try { return localStorage.getItem(PREF_KEY) ?? 'chime-ascending' } catch { return 'chime-ascending' }
  })
  const [customSounds, setCustomSounds] = useState<CustomSound[]>([])
  const [showUpload, setShowUpload] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string>('')
  const acRef = useRef<{ ac: AudioContext | null }>({ ac: null })
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`${SOUNDS_HTTP_PREFIX}/`)
      .then(r => r.json())
      .then((data: { ok: boolean; index?: { custom: CustomSound[] } }) => {
        if (data.ok && data.index?.custom) {
          setCustomSounds(data.index.custom.map((s: CustomSound) => ({
            ...s,
            playUrl: `${SOUNDS_HTTP_PREFIX}/${s.id}`,
          })))
        }
      })
      .catch(() => { /* ignore */ })
  }, [])

  const allSounds: SoundOption[] = [
    ...BUILTIN_SOUNDS.map(s => ({
      id: s.id,
      label: t(builtinSoundKey(s.id, 'name')),
      kind: 'builtin' as const,
      desc: t(builtinSoundKey(s.id, 'desc')),
    })),
    ...customSounds.map(s => ({
      id: s.id,
      label: lang === 'zh' ? s.nameZh : s.name,
      kind: 'custom' as const,
      desc: s.filename,
    })),
  ]

  const savePref = (id: string) => {
    try { localStorage.setItem(PREF_KEY, id) } catch { /* ignore */ }
    setSelectedId(id)
  }

  const previewSound = (id: string, event?: ReactMouseEvent): void => {
    event?.stopPropagation()
    const builtin = BUILTIN_SOUNDS.find(s => s.id === id)
    if (builtin) {
      playBuiltinSound(builtin, acRef)
      return
    }
    const custom = customSounds.find(s => s.id === id)
    if (custom) {
      playCustomSound(custom.playUrl)
    }
  }

  const handleSelect = (id: string) => {
    savePref(id)
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadStatus(t('sessions.soundUploading'))

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch(`${SOUNDS_HTTP_PREFIX}/`, { method: 'POST', body: formData })
      const data = await res.json() as { ok: boolean; entry?: CustomSound; message?: string }
      if (data.ok && data.entry) {
        const newSound: CustomSound = {
          ...data.entry,
          playUrl: `${SOUNDS_HTTP_PREFIX}/${data.entry.id}`,
        }
        setCustomSounds(prev => [...prev.filter(s => s.id !== newSound.id), newSound])
        savePref(newSound.id)
        setUploadStatus(t('sessions.soundUploadOk'))
        setShowUpload(false)
      } else {
        setUploadStatus(mapUploadError(data.message ?? '', t))
      }
    } catch {
      setUploadStatus(t('sessions.soundUploadFail'))
    }

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDelete = async (id: string, e: ReactMouseEvent) => {
    e.stopPropagation()
    try {
      await fetch(`${SOUNDS_HTTP_PREFIX}/${id}`, { method: 'DELETE' })
      setCustomSounds(prev => prev.filter(s => s.id !== id))
      if (selectedId === id) {
        savePref('chime-ascending')
      }
    } catch { /* ignore */ }
  }

  return (
    <div className={css.block}>
      <div className={css.blockHead}>
        <span className={css.blockTitle}>{t('settings.soundLabel')}</span>
        <button
          type="button"
          className={css.uploadBtn}
          onClick={() => { setShowUpload(v => !v); setUploadStatus('') }}
        >
          <IconPlus />
          <span>{t('sessions.soundUpload')}</span>
        </button>
      </div>
      <ul className={css.list} role="listbox" aria-label={t('settings.soundLabel')}>
        {allSounds.map(sound => (
          <li
            key={sound.id}
            className={css.item}
            data-selected={sound.id === selectedId || undefined}
            role="option"
            aria-selected={sound.id === selectedId}
            tabIndex={0}
            onClick={() => { handleSelect(sound.id) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                handleSelect(sound.id)
              }
            }}
          >
            <span className={css.checkSlot} aria-hidden>
              {sound.id === selectedId ? <IconCheck /> : null}
            </span>
            <span className={css.soundMain}>
              <span className={css.soundLabel}>{sound.label}</span>
              <span className={css.soundDesc}>{sound.desc}</span>
            </span>
            <span className={css.soundActions}>
              <IconButton
                dense
                className={css.playBtn}
                label={t('sessions.soundPreview')}
                title={t('sessions.soundPreview')}
                onClick={(event) => { previewSound(sound.id, event) }}
              >
                <IconPlay />
              </IconButton>
              {sound.kind === 'custom' ? (
                <button
                  type="button"
                  className={css.deleteBtn}
                  onClick={(e) => handleDelete(sound.id, e)}
                  title={t('sessions.soundDelete')}
                  aria-label={t('sessions.soundDelete')}
                >
                  <IconTrash />
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {showUpload ? (
        <div className={css.uploadPanel}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".ogg,.mp3,.wav,.webm,.m4a,.flac"
            className={css.fileInput}
            onChange={handleFileChange}
          />
          <span className={css.uploadHint}>{t('sessions.soundUploadHint')}</span>
          {uploadStatus !== '' ? <span className={css.uploadStatus} role="status">{uploadStatus}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
