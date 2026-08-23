import { useEffect, useState } from 'react'
import type { GitClient } from '../api.ts'
import { isLegacyXlsPath, type PreviewKind } from '../../shared/preview-kind.ts'
import type { GitFail } from '../../shared/types.ts'
import type { Translate } from './types.ts'
import {
  cellText, columnCount, MAX_PREVIEW_ROWS, parseCsvText, parseXlsxBuffer,
  type TableData, type TableRow,
} from './table-data.ts'
import css from './FilePreview.module.css'

export interface FilePreviewProps {
  client: GitClient
  workspaceId?: string
  path: string
  kind: PreviewKind
  t: Translate
}

function fileName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

function previewImgUrl(workspaceId: string, path: string): string {
  return '/git/fs/img?workspaceId=' + encodeURIComponent(workspaceId) + '&path=' + encodeURIComponent(path)
}

/** Decode CSV bytes as UTF-8, falling back to GB18030 when mojibake is detected. */
function decodeCsv(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    return new TextDecoder('gb18030').decode(buffer)
  } catch {
    return utf8
  }
}

function ImagePreview({ workspaceId, path, t }: { workspaceId: string; path: string; t: Translate }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const url = previewImgUrl(workspaceId, path)
  return (
    <div className={css.shell}>
      {failed ? (
        <div className={css.notice} role="alert">
          <p className={css.noticeTitle}>{t('editor.previewImageFail')}</p>
          <p className={css.noticeHint}>{t('editor.previewOpenExternalHint')}</p>
        </div>
      ) : (
        <>
          {!loaded ? <p className={css.hint}>{t('panel.loading')}</p> : null}
          <div className={css.imageShell}>
            <img
              className={css.image}
              src={url}
              alt={fileName(path)}
              onLoad={() => { setLoaded(true); setFailed(false) }}
              onError={() => { setFailed(true) }}
            />
          </div>
        </>
      )}
    </div>
  )
}

type TableState =
  | { phase: 'loading' }
  | { phase: 'error'; fail: GitFail | null; detail: string | null }
  | { phase: 'done'; data: TableData }

function TablePreview({ client, workspaceId, path, t }: {
  client: GitClient
  workspaceId?: string
  path: string
  t: Translate
}) {
  const [state, setState] = useState<TableState>({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ phase: 'loading' })
    if (isLegacyXlsPath(path)) {
      setState({ phase: 'error', fail: null, detail: t('editor.previewXlsUnsupported') })
      return
    }
    if (workspaceId === undefined) {
      setState({ phase: 'error', fail: null, detail: t('panel.noWorkspace') })
      return
    }
    void (async () => {
      const result = await client.readRawFile(workspaceId, path)
      if (cancelled) return
      if (!result.ok) {
        setState({ phase: 'error', fail: result, detail: null })
        return
      }
      try {
        const data = /.xlsx$/i.test(path)
          ? await parseXlsxBuffer(result.value)
          : parseCsvText(decodeCsv(result.value))
        if (cancelled) return
        setState({ phase: 'done', data })
      } catch (error) {
        if (cancelled) return
        setState({
          phase: 'error',
          fail: null,
          detail: t('editor.previewTableFail') + (error instanceof Error ? ' ' + error.message : ''),
        })
      }
    })()
    return () => { cancelled = true }
  }, [client, path, t, workspaceId])

  if (state.phase === 'loading') {
    return <p className={css.hint}>{t('panel.loading')}</p>
  }
  if (state.phase === 'error') {
    const fail = state.fail
    return (
      <div className={css.notice} role="alert">
        <p className={css.noticeTitle}>{fail !== null ? fail.messageZh : (state.detail ?? t('editor.previewTableFail'))}</p>
        {fail !== null && fail.hintZh !== '' ? <p className={css.noticeHint}>{fail.hintZh}</p> : null}
      </div>
    )
  }

  const { data } = state
  const cols = columnCount(data.rows)
  if (data.rows.length === 0 || cols === 0) {
    return (
      <div className={css.notice}>
        <p className={css.noticeTitle}>{t('editor.previewTableEmpty')}</p>
      </div>
    )
  }
  const header: TableRow = data.rows[0] ?? []
  return (
    <div className={css.shell}>
      <div className={css.meta}>
        <span>{t('editor.previewTableDims', { rows: data.totalRows, cols })}</span>
        {data.truncated ? (
          <span className={css.truncated}>{t('editor.previewTableTruncated', { count: MAX_PREVIEW_ROWS })}</span>
        ) : null}
      </div>
      <div className={css.tableWrap}>
        <table className={css.table}>
          <thead>
            <tr>
              {Array.from({ length: cols }, (_, index) => (
                <th key={index} scope="col">{cellText(header[index] ?? null)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.slice(1).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {Array.from({ length: cols }, (_, colIndex) => (
                  <td key={colIndex}>{cellText(row[colIndex] ?? null)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Direct-render preview for images (jpg/png/...) and tables (csv/xlsx/...). */
export function FilePreview({ client, workspaceId, path, kind, t }: FilePreviewProps) {
  if (kind === 'image') {
    if (workspaceId === undefined) {
      return <p className={css.hint}>{t('panel.noWorkspace')}</p>
    }
    return <ImagePreview workspaceId={workspaceId} path={path} t={t} />
  }
  return <TablePreview client={client} workspaceId={workspaceId} path={path} t={t} />
}
