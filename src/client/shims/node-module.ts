/** Browser stub so a leaked `module` / `node:module` import cannot break DSH ModuleLoader. */
export function createRequire(_filename: string): (id: string) => unknown {
  return function requireStub(id: string): unknown {
    throw new Error(`浏览器插件里不能加载 Node 模块「${id}」`)
  }
}

const moduleShim = { createRequire }
export default moduleShim
