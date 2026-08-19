import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'
import type { UserConfig } from 'tsdown'
import { CLIENT_EXTERNALS, findUnsafeClientRequire } from './src/shared/client-bundle-guard.ts'

const pkgVersion = (JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as { version: string }).version
const nodeEnv = process.env.NODE_ENV ?? 'production'

function resolveBrowserPkg(spec: string): string {
  const resolved = import.meta.resolve(spec)
  return resolved.startsWith('file:') ? fileURLToPath(resolved) : resolved
}

/**
 * mermaid's architecture diagrams import cytoscape. Output format is CJS, so
 * rolldown would pick cytoscape's "require" export and hoist
 * require("cytoscape") — DSH ModuleLoader has no such factory. Point at the
 * ESM file by path (createRequire cannot use the "import"-only subpath).
 */
function resolveMermaidCytoscapeEsm(): string {
  const mermaidPkg = fileURLToPath(new URL(import.meta.resolve('mermaid/package.json')))
  const cytoscapeCjs = createRequire(mermaidPkg).resolve('cytoscape')
  const esm = resolvePath(dirname(cytoscapeCjs), 'cytoscape.esm.mjs')
  if (!existsSync(esm)) {
    throw new Error(`找不到 mermaid 附带的 cytoscape ESM（${esm}）。请重新安装依赖后再构建。`)
  }
  return esm
}

const PACKAGE_ID = 'dsh-workbench-plugin'
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

function browserShims(withCytoscape: boolean): Record<string, string> {
  return {
    'node:process': resolvePath('src/client/shims/node-process.ts'),
    'node:path': resolvePath('src/client/shims/node-path.ts'),
    'node:url': resolvePath('src/client/shims/node-url.ts'),
    'node:module': resolvePath('src/client/shims/node-module.ts'),
    module: resolvePath('src/client/shims/node-module.ts'),
    fflate: resolveBrowserPkg('fflate/browser'),
    ...(withCytoscape ? { cytoscape: resolveMermaidCytoscapeEsm() } : {}),
  }
}

function cssModulesPlugin(): NonNullable<UserConfig['plugins']>[number] {
  return {
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.css')) return null
      const abs = importer !== undefined ? resolvePath(dirname(importer), source) : source
      if (existsSync(abs)) return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      try {
        const resolved = import.meta.resolve(source)
        const file = resolved.startsWith('file:') ? new URL(resolved).pathname : resolved
        if (existsSync(file)) return CSS_VIRTUAL_PREFIX + file + CSS_VIRTUAL_SUFFIX
      } catch { /* fall through */ }
      return null
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const modules = fileId.endsWith('.module.css')
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: modules ? { pattern: '[hash]_[local]' } : false,
        minify: true,
      })
      const classMap: Record<string, string> = {}
      if (modules) {
        for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
      }
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(`${PACKAGE_ID}/${basename(fileId)}`)};`,
        'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
        '  const tag = document.createElement(\'style\');',
        `  tag.dataset.plugin = ${JSON.stringify(PACKAGE_ID)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }
}

const host: UserConfig = {
  name: PACKAGE_ID,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: true,
  sourcemap: false,
  fixedExtension: false,
  external: [/^@deepseek-ai\//, /^node:/, 'node-pty'],
  outputOptions: {
    entryFileNames: 'index.js',
  },
}

const client: UserConfig = {
  name: `${PACKAGE_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  // Do not inherit package.json engines.node (node22…): that makes rolldown
  // pick fflate's Node export, which does createRequire("module") and crashes
  // DSH ModuleLoader at plugin load.
  target: 'es2024',
  dts: false,
  sourcemap: true,
  minify: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id as (typeof CLIENT_EXTERNALS)[number]) ? undefined : true),
  alias: browserShims(false),
  define: {
    'process.env.NODE_ENV': JSON.stringify(nodeEnv),
    'import.meta.env.MODE': JSON.stringify(nodeEnv),
    'import.meta.env.WB_REV': JSON.stringify(pkgVersion),
    'import.meta.env': JSON.stringify({ MODE: nodeEnv, WB_REV: pkgVersion }),
  },
  plugins: [{
    name: 'dsh-forbid-node-require',
    generateBundle(_opts: unknown, bundle: Record<string, { type: string; code?: string }>) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk' || chunk.code === undefined) continue
        const forbidden = findUnsafeClientRequire(chunk.code)
        if (forbidden !== undefined) {
          throw new Error(`${fileName} 含有 ${forbidden}。DSH 网页 ModuleLoader 只能加载平台白名单模块，其余依赖必须打进 client.js`)
        }
      }
    },
  }, cssModulesPlugin()],
  outputOptions: {
    entryFileNames: 'client.js',
    // DSH ModuleLoader wraps this factory and cannot fetch sibling chunks.
    // Heavy mermaid lives in lib/vendor/mermaid.js and is loaded at preview time.
    inlineDynamicImports: true,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

/**
 * Browser ESM served at `/git/vendor/mermaid.js`. Must not use the ModuleLoader
 * banner: the page loads it with native `import(url)` after boot.
 */
const mermaidVendor: UserConfig = {
  name: `${PACKAGE_ID}/vendor-mermaid`,
  entry: { mermaid: 'src/client/vendor/mermaid-entry.ts' },
  outDir: 'lib/vendor',
  format: 'esm',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: false,
  minify: true,
  clean: false,
  noExternal: () => true,
  alias: browserShims(true),
  define: {
    'process.env.NODE_ENV': JSON.stringify(nodeEnv),
    'import.meta.env.MODE': JSON.stringify(nodeEnv),
    'import.meta.env': JSON.stringify({ MODE: nodeEnv }),
  },
  plugins: [cssModulesPlugin()],
  outputOptions: {
    entryFileNames: 'mermaid.js',
    inlineDynamicImports: true,
  },
}

export default [host, client, mermaidVendor]
