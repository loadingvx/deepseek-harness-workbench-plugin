/**
 * File upload / download / folder-zip · translation keys (zh + en).
 *
 * Kept in its own module, following the existing "keep new translations out of
 * locales.ts" policy: they are merged into the workbench namespace at registration
 * time in index.ts, which keeps upstream merges small.
 */

export const transferZh = {
  'transfer.upload': '上传',
  'transfer.uploading': '上传中…',
  'transfer.uploaded': '上传完成',
  'transfer.downloadFile': '下载文件',
  'transfer.downloadDir': '下载目录 (zip)',
  'transfer.more': '下载该文件或目录',
  'transfer.uploadHint': '上传到所选文件夹、所选文件所在目录或项目根目录；每个文件最大 256 MiB；同名文件不会被覆盖',
  'transfer.results': '传输结果',
  'transfer.queued': '等待上传',
  'transfer.exists': '文件已存在，未覆盖',
  'transfer.network': '网络错误',
  'transfer.cancelled': '上传已取消',
  'transfer.tooLarge': '超过 256 MiB，未上传',
  'transfer.failed': '上传失败',
  'transfer.close': '关闭传输结果',
}

export const transferEn = {
  'transfer.upload': 'Upload',
  'transfer.uploading': 'Uploading…',
  'transfer.uploaded': 'Uploaded',
  'transfer.downloadFile': 'Download file',
  'transfer.downloadDir': 'Download folder (zip)',
  'transfer.more': 'Download this file or folder',
  'transfer.uploadHint': 'Upload into the selected folder, the selected file\u2019s folder, or the project root; max 256 MiB per file; existing names are not overwritten',
  'transfer.results': 'Transfer results',
  'transfer.queued': 'Queued',
  'transfer.exists': 'File exists; not overwritten',
  'transfer.network': 'Network error',
  'transfer.cancelled': 'Upload cancelled',
  'transfer.tooLarge': 'Exceeds 256 MiB; not uploaded',
  'transfer.failed': 'Upload failed',
  'transfer.close': 'Close transfer results',
}
