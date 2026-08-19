import { createRequire } from "node:module";
import { access, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { constants, createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { randomUUID } from "node:crypto";
//#region src/shared/redact.ts
/** 展示用脱敏：URL、主机名、路径保留；token / 密码只留头尾。 */
const SENSITIVE_QUERY = /([?&](?:access_token|api[_-]?key|auth(?:orization)?|jwt|password|secret|session|token)=)([^&#\s]+)/gi;
const BEARER = /\b(Bearer\s+)([A-Za-z0-9\-._~+/]+=*)/gi;
const KNOWN_TOKEN = /\b((?:ghp|gho|ghu|ghs|ghr|github_pat|glpat|npm|sk|xox[baprs])[_-])([A-Za-z0-9_-]{8,})/gi;
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi;
function maskSecret(value) {
	if (value.length <= 6) return "***";
	return `${value.slice(0, 3)}***${value.slice(-2)}`;
}
function maskUserInfo(userInfo) {
	const colon = userInfo.indexOf(":");
	if (colon === -1) return looksLikeToken(userInfo) ? maskSecret(userInfo) : userInfo;
	const user = userInfo.slice(0, colon);
	const secret = userInfo.slice(colon + 1);
	if (secret === "") return userInfo;
	return `${user}:${maskSecret(secret)}`;
}
function looksLikeToken(value) {
	if (value.length < 16) return false;
	if (/^[0-9a-f]{7,40}$/i.test(value)) return false;
	return /^[A-Za-z0-9._~+/-]+=*$/.test(value);
}
/** 给即将展示给用户或写入错误条的文本做脱敏。可重复调用。 */
function redactSecrets(raw) {
	let text = raw;
	text = text.replace(URL_USERINFO, (_all, protocol, userInfo) => {
		return `${protocol}${maskUserInfo(userInfo)}@`;
	});
	text = text.replace(SENSITIVE_QUERY, (_all, prefix, value) => `${prefix}${maskSecret(value)}`);
	text = text.replace(BEARER, (_all, prefix, value) => `${prefix}${maskSecret(value)}`);
	text = text.replace(KNOWN_TOKEN, (_all, prefix, rest) => `${prefix}${maskSecret(rest)}`);
	return text;
}
//#endregion
//#region src/shared/errors.ts
const COPY = {
	GIT_NOT_FOUND: {
		messageZh: "本机没有可用的 git 命令。",
		hintZh: "请先安装 Git，并确认终端里执行 `git --version` 能成功。Debian/Ubuntu 可用 `sudo apt install git`。"
	},
	NOT_A_REPO: {
		messageZh: "当前工作区还不是 Git 仓库。",
		hintZh: "请在右侧「源代码管理」里初始化仓库，或打开一个已经是仓库的文件夹。不会自动执行 git init。"
	},
	NO_WORKSPACE: {
		messageZh: "还没有选中工作区。",
		hintZh: "请先在左侧打开或创建一个工作区，再使用 Git。"
	},
	UNKNOWN_WORKSPACE: {
		messageZh: "找不到这个工作区。",
		hintZh: "工作区可能已被删除。请刷新页面，或重新选择一个本地目录。"
	},
	UNKNOWN_REPO: {
		messageZh: "找不到这个 Git 仓库。",
		hintZh: "只能选当前目录、已纳入的上一级，或当前目录下的仓库、软链和子模块。请从列表里重新选。"
	},
	EMPTY_MESSAGE: {
		messageZh: "提交说明不能为空。",
		hintZh: "请用一两句话写清楚这次改了什么，然后再提交。"
	},
	NOTHING_STAGED: {
		messageZh: "没有已暂存的文件，无法提交。",
		hintZh: "请先勾选要提交的文件（暂存），确认右侧 diff 无误后再提交。"
	},
	INDEX_LOCKED: {
		messageZh: "Git 正被其他进程占用（存在 index.lock）。",
		hintZh: "请等当前 Git 操作结束。若确认没有其他 Git 窗口，再检查仓库里的 `.git/index.lock`。"
	},
	DIRTY_WORKTREE: {
		messageZh: "工作区还有未提交的改动。",
		hintZh: "请先提交或处理这些文件，再切换分支、拉取或推送，以免改动丢失。"
	},
	BUSY: {
		messageZh: "上一次 Git 操作还在进行。",
		hintZh: "请稍等当前操作完成，不要连续点击。"
	},
	BRANCH_MISSING: {
		messageZh: "本地没有这个分支。",
		hintZh: "请从列表里选一个已经存在的本地分支。要新建，请用 GRAPH 栏的「新建分支」。"
	},
	BRANCH_EXISTS: {
		messageZh: "这个分支名已经有了。",
		hintZh: "请换一个名字，或先切到已有分支再继续。"
	},
	BRANCH_INVALID: {
		messageZh: "分支名不合法。",
		hintZh: "不要用空格、..、~ ^ : ? * [ \\，也不要以 - / . 开头或以 / . 结尾。最长 64 个字符。"
	},
	MERGE_CONFLICT: {
		messageZh: "合并时出现冲突，已自动取消，工作区保持原样。",
		hintZh: "两边改了同一处。请在终端里手动处理，或先和同事对齐后再拉取。本插件不会留下半成品合并。"
	},
	IDENTITY_MISSING: {
		messageZh: "还没有配置 Git 用户信息，无法提交。",
		hintZh: "请填写姓名和邮箱。新仓库可以在初始化时填写；已有仓库可在终端执行：\ngit config --global user.name \"你的名字\"\ngit config --global user.email \"you@example.com\""
	},
	IDENTITY_INVALID: {
		messageZh: "姓名或邮箱格式不正确。",
		hintZh: "姓名不能为空，也不能包含换行。邮箱必须包含 @，例如 you@company.com。"
	},
	INVALID_PATH: {
		messageZh: "文件路径不合法。",
		hintZh: "只能操作当前仓库内的相对路径，不能使用 .. 或仓库外的绝对路径。"
	},
	NETWORK: {
		messageZh: "无法连接工作台服务。",
		hintZh: "请确认 DeepSeek Harness 网页仍在运行，然后点击右上角刷新。"
	},
	BAD_REQUEST: {
		messageZh: "请求参数不完整。",
		hintZh: "请刷新页面后重试。若仍然失败，请重新打开工作区。"
	},
	GIT_FAILED: {
		messageZh: "Git 命令执行失败。",
		hintZh: "请查看详细原因。常见情况：合并进行中、钩子拒绝、或仓库状态异常。"
	},
	FS_NOT_FOUND: {
		messageZh: "找不到这个文件或文件夹。",
		hintZh: "它可能已被删除或移动。请在左侧目录里重新点开，或点刷新。"
	},
	FS_IS_DIRECTORY: {
		messageZh: "这是一个文件夹，不能当文件打开。",
		hintZh: "请在目录树里展开它，再点里面的文件。"
	},
	FS_TOO_LARGE: {
		messageZh: "文件超过 1.5 MB，编辑器不会打开。",
		hintZh: "太大的文件会把浏览器卡死。请用本机编辑器打开，或换一个更小的文件。"
	},
	FS_BINARY: {
		messageZh: "这是二进制文件，无法在文本编辑器中打开。",
		hintZh: "图片、压缩包、字体等请用本机应用打开。工作台只编辑文本文件。"
	},
	FS_WRITE_FAILED: {
		messageZh: "无法保存这个文件。",
		hintZh: "请确认文件不是只读、磁盘还有空间，然后重试。"
	},
	FS_EXISTS: {
		messageZh: "这个名字已经有人用了。",
		hintZh: "换一个名字，或先把同名文件处理掉再试。"
	},
	FS_RENAME_FAILED: {
		messageZh: "无法重命名或移动这个文件。",
		hintZh: "请确认目标位置可以写入、源文件没有被占用，然后重试。"
	},
	FS_DELETE_FAILED: {
		messageZh: "无法删除这个文件。",
		hintZh: "请确认文件没有被占用，或没有权限限制，然后重试。"
	},
	FS_MKDIR_FAILED: {
		messageZh: "无法创建这个文件夹。",
		hintZh: "请确认上层目录可以写入、磁盘还有空间，然后重试。"
	},
	FS_COPY_FAILED: {
		messageZh: "无法复制这个文件。",
		hintZh: "请确认目标位置可以写入、源文件还在，然后重试。"
	},
	FS_REVEAL_FAILED: {
		messageZh: "没法打开系统文件管理器。",
		hintZh: "若在 Windows 或 WSL，请确认资源管理器能打开，并且终端里执行 explorer.exe 能启动。若在 Linux 桌面，请确认已安装文件管理器，且终端能执行 xdg-open。没有图形界面的远程或容器环境无法使用此功能。"
	},
	LLM_UNAVAILABLE: {
		messageZh: "现在没法调用模型。",
		hintZh: "请确认会话里已经配好可用模型。这次调用不会写入当前对话。也可以先自己动手完成。"
	},
	LLM_FAILED: {
		messageZh: "模型调用失败。",
		hintZh: "请稍后重试。常见原因：模型未就绪、网络中断、思考占用了输出、或内容太长。"
	},
	NOTHING_TO_DESCRIBE: {
		messageZh: "没有可描述的改动。",
		hintZh: "请先修改或暂存文件，再点自动生成。工作区是干净的时候无法生成提交说明。"
	},
	NO_REMOTE: {
		messageZh: "这个仓库还没有配置远程地址。",
		hintZh: "请先添加远程，例如：git remote add origin <仓库地址>。没有远程时不能推送或拉取。"
	},
	NO_UPSTREAM: {
		messageZh: "当前分支还没有对应的远端分支。",
		hintZh: "第一次推送会自动设置跟踪。若要拉取，请先推送一次，或确认远程已有同名分支。"
	},
	NOTHING_TO_PUSH: {
		messageZh: "没有需要推送的新提交。",
		hintZh: "本地已经和远端同步，或还没有任何提交。提交之后才会出现推送按钮。"
	},
	NOTHING_TO_PULL: {
		messageZh: "远端没有可拉取的新提交。",
		hintZh: "当前分支没有落后远端。只有远端有更新时才会出现拉取按钮。"
	},
	REMOTE_AHEAD: {
		messageZh: "远端有新提交，不能直接推送。",
		hintZh: "请先点「拉取」，把远端更新接到本地，确认没有冲突后再推送。"
	},
	DIVERGED: {
		messageZh: "本地和远端都有对方没有的提交，当前拉取方式无法接入。",
		hintZh: "请在齿轮设置里把拉取改为「合并」（git pull --no-rebase），或在终端处理分叉后再试。"
	},
	AUTH_FAILED: {
		messageZh: "远程仓库拒绝了身份验证。",
		hintZh: "请检查 SSH 密钥或 HTTPS 凭据是否有效。本插件不会弹出密码框，需要本机已经配置好认证。"
	},
	REMOTE_UNREACHABLE: {
		messageZh: "连不上远程仓库。",
		hintZh: "请检查网络、远程地址，以及本机能否访问该 Git 服务，然后重试。"
	},
	DETACHED_HEAD: {
		messageZh: "当前处于分离 HEAD，不能推送或拉取。",
		hintZh: "请先切换到一个普通分支，再同步远端。"
	},
	EDITOR_NOT_FOUND: {
		messageZh: "本机没有找到可用的外部编辑器。",
		hintZh: "请先安装 Cursor 或 VS Code，并确认终端里能执行 `cursor` 或 `code`。装好后点右上角三角重新选择。"
	},
	EDITOR_FAILED: {
		messageZh: "外部编辑器没有打开成功。",
		hintZh: "请确认这个软件还能启动。也可以点三角换一个本机应用再试。"
	},
	EDITOR_UNKNOWN: {
		messageZh: "不支持用这个应用打开。",
		hintZh: "请从列表里选 Cursor、VS Code 或系统默认应用。不会执行列表以外的命令。"
	},
	TERM_NO_SHELL: {
		messageZh: "本机没有可用的命令行程序。",
		hintZh: "请确认系统里有 bash 或 zsh，并且终端里能执行 `bash`。"
	},
	TERM_FAILED: {
		messageZh: "工作区命令行没有启动成功。",
		hintZh: "请确认已经打开本地工作区，然后点「重新连接」。若反复失败，请确认本机有 bash/zsh，并且 DeepSeek Harness 能创建伪终端。"
	},
	BROWSER_BAD_URL: {
		messageZh: "这个地址不是网页。",
		hintZh: "请输入 http:// 或 https:// 开头的地址，例如 https://example.com 或 http://127.0.0.1:5173 。"
	},
	BROWSER_TOO_LARGE: {
		messageZh: "这个网页太大，没法在工作台里打开。",
		hintZh: "请换一个更小的页面，或在系统自带的浏览器里打开。"
	},
	BROWSER_TIMEOUT: {
		messageZh: "打开网页超时。",
		hintZh: "请确认这个网站本机能打开，然后点刷新再试。本地服务要先启动，地址要写完整端口。"
	},
	BROWSER_FAILED: {
		messageZh: "网页没有加载成功。",
		hintZh: "请确认地址正确，并且本机网络能打开这个网站。"
	},
	BROWSER_SELF: {
		messageZh: "不能在这里打开工作台自己。",
		hintZh: "地址栏填的是当前工作台页面。请改成你要预览的网站，例如本地开发地址 http://127.0.0.1:5173 。"
	}
};
/** Structured Git failure with Chinese copy the UI can show as-is. */
var GitError = class extends Error {
	code;
	messageZh;
	hintZh;
	constructor(code, detail) {
		const copy = COPY[code];
		const safe = detail === void 0 ? void 0 : redactSecrets(detail);
		const messageZh = safe && (code === "GIT_FAILED" || code === "LLM_FAILED" || code === "TERM_FAILED" || code === "BROWSER_FAILED") ? `${copy.messageZh} ${safe}` : copy.messageZh;
		super(`${code}: ${messageZh}`);
		this.name = "GitError";
		this.code = code;
		this.messageZh = messageZh;
		this.hintZh = copy.hintZh;
	}
	toFail() {
		return {
			ok: false,
			code: this.code,
			messageZh: this.messageZh,
			hintZh: this.hintZh
		};
	}
};
function fail(code, detail) {
	return new GitError(code, detail).toFail();
}
function toFail(error) {
	if (error instanceof GitError) return error.toFail();
	if (error instanceof Error && error.message.includes("index.lock")) return fail("INDEX_LOCKED");
	if (error instanceof Error && /without inject|llm/i.test(error.message)) return fail("LLM_UNAVAILABLE");
	return fail("GIT_FAILED", error instanceof Error ? error.message : String(error));
}
//#endregion
//#region src/shared/branch-name.ts
/** Reject names that git would refuse or that look like flags / path tricks. */
function invalidBranchName(raw) {
	const name = raw.trim();
	if (name === "") return "empty";
	if (name.length > 64) return "invalid";
	if (name === "HEAD" || name === "@") return "invalid";
	if (/^[./-]/.test(name)) return "invalid";
	if (/[./]$/.test(name) || name.endsWith(".lock")) return "invalid";
	if (name.includes("..") || name.includes("//") || name.includes("@{")) return "invalid";
	if (/[\s~^:?*[\\]/.test(name)) return "invalid";
	return null;
}
function normalizeBranchName(raw) {
	return raw.trim();
}
function normalizeFileFilter(raw) {
	return raw.trim().slice(0, 80);
}
/** `.ts` / `*.tsx` 当成扩展名；其余按文件名或路径包含匹配（不走正则）。 */
function entryMatchesFilter(name, path, query) {
	const q = normalizeFileFilter(query).toLowerCase();
	if (q === "") return false;
	const nameL = name.toLowerCase();
	const pathL = path.toLowerCase();
	if (q.startsWith("*.") && q.length > 2) return nameL.endsWith(q.slice(1));
	if (/^\.[a-z0-9]+$/i.test(q)) return nameL === q || nameL.startsWith(`${q}.`) || nameL.endsWith(q);
	return nameL.includes(q) || pathL.includes(q);
}
function shouldSkipSearchDir(name, query) {
	const q = normalizeFileFilter(query).toLowerCase();
	if (name === ".git" && !q.includes(".git")) return true;
	if (name === "node_modules" && !q.includes("node_modules")) return true;
	return false;
}
//#endregion
//#region src/host/git-exec.ts
const DEFAULT_TIMEOUT_MS = 3e4;
function classifyFailure(stderr, exitCode) {
	const text = `${stderr}`;
	if (/index\.lock/i.test(text)) return new GitError("INDEX_LOCKED");
	if (/not a git repository/i.test(text)) return new GitError("NOT_A_REPO");
	if (/did not match any file/i.test(text) && /pathspec/i.test(text)) return new GitError("INVALID_PATH");
	if (/please tell me who you are/i.test(text) || /user\.email/i.test(text) || /user\.name/i.test(text)) return new GitError("IDENTITY_MISSING");
	if (/your local changes/i.test(text) || /would be overwritten/i.test(text)) return new GitError("DIRTY_WORKTREE");
	if (/already exists/i.test(text)) return new GitError("BRANCH_EXISTS");
	if (/pathspec '.*' did not match/i.test(text)) return new GitError("BRANCH_MISSING");
	if (/conflict|automatic merge failed|fix conflicts|unmerged paths/i.test(text)) return new GitError("MERGE_CONFLICT");
	if (/authentication failed|could not read username|terminal prompts disabled|permission denied \(publickey\)|403 forbidden|401 unauthorized/i.test(text)) return new GitError("AUTH_FAILED");
	if (/could not resolve host|unable to access|failed to connect|connection refused|network is unreachable|timed out/i.test(text)) return new GitError("REMOTE_UNREACHABLE");
	if (/not possible to fast-forward|diverging branches|need to specify how to reconcile/i.test(text)) return new GitError("DIVERGED");
	if (/rejected.*non-fast-forward|failed to push some refs|updates were rejected/i.test(text)) return new GitError("REMOTE_AHEAD");
	if (/no upstream|no tracking information|does not have a corresponding remote/i.test(text)) return new GitError("NO_UPSTREAM");
	return new GitError("GIT_FAILED", redactSecrets(text.trim() || `退出码 ${exitCode}`).slice(0, 400));
}
/** Run `git` with a timeout and map common failures to GitError. */
function runGit(options) {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	return new Promise((resolve, reject) => {
		if (options.signal?.aborted) {
			reject(options.signal.reason ?? /* @__PURE__ */ new Error("aborted"));
			return;
		}
		const child = spawn("git", options.args, {
			cwd: options.cwd,
			env: {
				...process.env,
				GIT_TERMINAL_PROMPT: "0",
				GIT_OPTIONAL_LOCKS: "0",
				...options.env
			},
			stdio: [
				options.input !== void 0 ? "pipe" : "ignore",
				"pipe",
				"pipe"
			]
		});
		if (options.input !== void 0 && child.stdin) {
			child.stdin.on("error", () => {});
			child.stdin.end(options.input, "utf8");
		}
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		const onAbort = () => {
			child.kill("SIGTERM");
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new GitError("GIT_FAILED", `命令超时（${timeoutMs}ms）：git ${options.args.join(" ")}`));
		}, timeoutMs);
		child.on("error", (error) => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			if (error.code === "ENOENT") reject(new GitError("GIT_NOT_FOUND"));
			else reject(new GitError("GIT_FAILED", error.message));
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			const exitCode = code ?? 1;
			if (exitCode !== 0 && !options.allowNonZero) {
				reject(classifyFailure(`${stdout}\n${stderr}`, exitCode));
				return;
			}
			resolve({
				stdout,
				stderr,
				exitCode
			});
		});
	});
}
async function gitAvailable(signal) {
	try {
		return {
			ok: true,
			version: (await runGit({
				cwd: process.cwd(),
				args: ["--version"],
				signal,
				timeoutMs: 8e3
			})).stdout.trim()
		};
	} catch (error) {
		if (error instanceof GitError && error.code === "GIT_NOT_FOUND") return { ok: false };
		throw error;
	}
}
//#endregion
//#region src/host/git-ignore.ts
async function isGitWorkTree(root) {
	try {
		const result = await runGit({
			cwd: root,
			args: ["rev-parse", "--is-inside-work-tree"],
			allowNonZero: true,
			timeoutMs: 4e3
		});
		return result.exitCode === 0 && result.stdout.trim() === "true";
	} catch {
		return false;
	}
}
/** Paths that `git check-ignore` treats as ignored (untracked + matching .gitignore). Tracked files stay out. */
async function ignoredPathSet(root, paths) {
	const unique = [...new Set(paths.filter((path) => path !== ""))];
	if (unique.length === 0) return /* @__PURE__ */ new Set();
	if (!await isGitWorkTree(root)) return /* @__PURE__ */ new Set();
	try {
		const result = await runGit({
			cwd: root,
			args: [
				"check-ignore",
				"-z",
				"--stdin"
			],
			input: `${unique.join("\0")}\0`,
			allowNonZero: true,
			timeoutMs: 8e3
		});
		if (result.exitCode !== 0 && result.exitCode !== 1) return /* @__PURE__ */ new Set();
		return new Set(result.stdout.split("\0").filter(Boolean));
	} catch {
		return /* @__PURE__ */ new Set();
	}
}
async function attachIgnored(root, entries) {
	const ignored = await ignoredPathSet(root, entries.map((entry) => entry.path));
	return entries.map((entry) => ({
		...entry,
		ignored: ignored.has(entry.path)
	}));
}
const MAX_DIR_ENTRIES = 400;
const MAX_SEARCH_VISITS = 4e3;
const BINARY_EXT = /* @__PURE__ */ new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".ico",
	".bmp",
	".tif",
	".tiff",
	".woff",
	".woff2",
	".ttf",
	".otf",
	".eot",
	".zip",
	".gz",
	".tgz",
	".bz2",
	".7z",
	".rar",
	".xz",
	".pdf",
	".doc",
	".docx",
	".xls",
	".xlsx",
	".ppt",
	".pptx",
	".wasm",
	".so",
	".dylib",
	".dll",
	".exe",
	".bin",
	".class",
	".mp3",
	".mp4",
	".mov",
	".wav",
	".avi",
	".mkv",
	".webm",
	".sqlite",
	".db",
	".lock"
]);
const LANGUAGE_BY_EXT = {
	".ts": "typescript",
	".tsx": "typescript",
	".js": "javascript",
	".jsx": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".json": "json",
	".md": "markdown",
	".css": "css",
	".scss": "scss",
	".html": "html",
	".yml": "yaml",
	".yaml": "yaml",
	".py": "python",
	".go": "go",
	".rs": "rust",
	".java": "java",
	".kt": "kotlin",
	".sh": "shell",
	".bash": "shell",
	".zsh": "shell",
	".toml": "toml",
	".xml": "xml",
	".sql": "sql",
	".vue": "vue",
	".svelte": "svelte"
};
/** Jail a user path to the workspace root. Empty / `.` means the root itself. */
function assertSafeWorkspacePath(root, filePath) {
	const trimmed = filePath.trim();
	if (trimmed.startsWith("-")) throw new GitError("INVALID_PATH");
	const resolved = resolve(root, trimmed === "" || trimmed === "." ? "" : trimmed);
	const rel = relative(root, resolved);
	if (rel.startsWith("..") || normalize(rel).split(sep).includes("..")) throw new GitError("INVALID_PATH");
	return rel.split("\\").join("/");
}
async function resolveInside(root, rel) {
	const full = rel === "" ? root : join(root, rel);
	let real;
	try {
		real = await realpath(full);
	} catch (error) {
		if (isNotFound$2(error)) {
			if (rel === "") throw new GitError("FS_NOT_FOUND");
			const parent = dirname(full);
			try {
				const parentReal = await realpath(parent);
				if (relative(root, parentReal).startsWith("..")) throw new GitError("INVALID_PATH");
				return join(parentReal, rel.split("/").pop() ?? "");
			} catch (inner) {
				if (inner instanceof GitError) throw inner;
				throw new GitError("FS_NOT_FOUND");
			}
		}
		throw new GitError("INVALID_PATH");
	}
	if (relative(root, real).startsWith("..")) throw new GitError("INVALID_PATH");
	return real;
}
function isNotFound$2(error) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function isPermission(error) {
	return error instanceof Error && "code" in error && error.code === "EACCES";
}
function looksBinary(buffer, path) {
	if (BINARY_EXT.has(extname(path).toLowerCase())) return true;
	return buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}
function languageOf(path) {
	return LANGUAGE_BY_EXT[extname(path).toLowerCase()] ?? "plaintext";
}
const IMAGE_EXT_MIME = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".ico": "image/x-icon",
	".bmp": "image/bmp",
	".svg": "image/svg+xml"
};
/** Map an image file to a MIME type, validating magic bytes so text can never be served as an image. */
function imageMimeOf(path, buffer) {
	const ext = extname(path).toLowerCase();
	if (ext === ".svg") {
		const sample = buffer.subarray(0, 512).toString("utf8").trimStart();
		return sample.startsWith("<?xml") || sample.startsWith("<svg") || sample.startsWith("<") ? "image/svg+xml" : null;
	}
	const mime = IMAGE_EXT_MIME[ext];
	if (mime === void 0) return null;
	if (mime === "image/png") {
		const magic = Buffer.from([
			137,
			80,
			78,
			71,
			13,
			10,
			26,
			10
		]);
		return buffer.length >= 8 && buffer.subarray(0, 8).equals(magic) ? mime : null;
	}
	if (mime === "image/jpeg") return buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 ? mime : null;
	if (mime === "image/gif") return buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "GIF8" ? mime : null;
	if (mime === "image/webp") return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" ? mime : null;
	if (mime === "image/avif") return buffer.length >= 12 && buffer.toString("ascii", 4, 12) === "ftypavif" ? mime : null;
	if (mime === "image/x-icon") return buffer.length >= 4 && buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 1 && buffer[3] === 0 ? mime : null;
	if (mime === "image/bmp") return buffer.length >= 2 && buffer[0] === 66 && buffer[1] === 77 ? mime : null;
	return null;
}
function toPosix(rel) {
	return rel.split("\\").join("/");
}
/** Workspace-rooted directory listing and text file IO. */
var WorkspaceFs = class {
	async list(root, dirPath = "") {
		const rel = assertSafeWorkspacePath(root, dirPath);
		const abs = await resolveInside(root, rel);
		let info;
		try {
			info = await stat(abs);
		} catch (error) {
			if (isNotFound$2(error)) throw new GitError("FS_NOT_FOUND");
			throw new GitError("GIT_FAILED", error instanceof Error ? error.message : String(error));
		}
		if (!info.isDirectory()) throw new GitError("FS_IS_DIRECTORY");
		let names;
		try {
			names = await readdir(abs);
		} catch (error) {
			if (isPermission(error)) throw new GitError("GIT_FAILED", "没有权限读取这个文件夹。");
			throw new GitError("GIT_FAILED", error instanceof Error ? error.message : String(error));
		}
		names.sort((left, right) => left.localeCompare(right, "zh"));
		const truncated = names.length > MAX_DIR_ENTRIES;
		const slice = truncated ? names.slice(0, MAX_DIR_ENTRIES) : names;
		const entries = [];
		for (const name of slice) {
			const childRel = rel === "" ? name : `${rel}/${name}`;
			const childAbs = join(abs, name);
			try {
				const childReal = await realpath(childAbs);
				if (relative(root, childReal).startsWith("..")) continue;
				const childStat = await stat(childReal);
				entries.push({
					name,
					path: toPosix(childRel),
					kind: childStat.isDirectory() ? "directory" : "file",
					hidden: name.startsWith("."),
					ignored: false
				});
			} catch {}
		}
		entries.sort((left, right) => {
			if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
			return left.name.localeCompare(right.name, "zh");
		});
		return {
			path: rel,
			entries: await attachIgnored(root, entries),
			truncated
		};
	}
	async search(root, query, showHidden = false) {
		const q = normalizeFileFilter(query);
		if (q === "") return {
			query: "",
			hits: [],
			truncated: false
		};
		const absRoot = await resolveInside(root, "");
		const hits = [];
		const queue = [""];
		let visits = 0;
		let truncated = false;
		const revealHidden = showHidden || q.startsWith(".");
		while (queue.length > 0) {
			if (hits.length >= 200 || visits >= MAX_SEARCH_VISITS) {
				truncated = true;
				break;
			}
			const rel = queue.shift() ?? "";
			const abs = rel === "" ? absRoot : join(absRoot, rel);
			let names;
			try {
				names = await readdir(abs);
			} catch {
				continue;
			}
			visits += 1;
			for (const name of names) {
				if (hits.length >= 200 || visits >= MAX_SEARCH_VISITS) {
					truncated = true;
					break;
				}
				const hidden = name.startsWith(".");
				if (hidden && !revealHidden) continue;
				if (shouldSkipSearchDir(name, q)) continue;
				const childRel = rel === "" ? name : `${rel}/${name}`;
				const childAbs = join(abs, name);
				try {
					const childReal = await realpath(childAbs);
					if (relative(root, childReal).startsWith("..")) continue;
					const kind = (await stat(childReal)).isDirectory() ? "directory" : "file";
					const path = toPosix(childRel);
					if (entryMatchesFilter(name, path, q)) hits.push({
						name,
						path,
						kind,
						hidden,
						ignored: false
					});
					if (kind === "directory") queue.push(childRel);
				} catch {}
			}
		}
		hits.sort((left, right) => {
			if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
			return left.path.localeCompare(right.path, "zh");
		});
		return {
			query: q,
			hits: await attachIgnored(root, hits),
			truncated
		};
	}
	async resolveAbsolute(root, filePath) {
		return resolveInside(root, assertSafeWorkspacePath(root, filePath));
	}
	async read(root, filePath) {
		const rel = assertSafeWorkspacePath(root, filePath);
		if (rel === "") throw new GitError("FS_IS_DIRECTORY");
		const abs = await resolveInside(root, rel);
		let info;
		try {
			info = await stat(abs);
		} catch (error) {
			if (isNotFound$2(error)) throw new GitError("FS_NOT_FOUND");
			throw new GitError("GIT_FAILED", error instanceof Error ? error.message : String(error));
		}
		if (info.isDirectory()) throw new GitError("FS_IS_DIRECTORY");
		if (info.size > 15e5) throw new GitError("FS_TOO_LARGE");
		let buffer;
		try {
			buffer = await readFile(abs);
		} catch (error) {
			if (isPermission(error)) throw new GitError("FS_WRITE_FAILED");
			throw new GitError("GIT_FAILED", error instanceof Error ? error.message : String(error));
		}
		if (looksBinary(buffer, rel)) throw new GitError("FS_BINARY");
		const ignored = (await ignoredPathSet(root, [rel])).has(rel);
		return {
			path: rel,
			content: buffer.toString("utf8"),
			size: buffer.length,
			language: languageOf(rel),
			ignored
		};
	}
	/** Read a workspace image as raw bytes. Rejects non-images, directories, and files over the image cap. */
	async readImage(root, filePath) {
		const rel = assertSafeWorkspacePath(root, filePath);
		if (rel === "") throw new GitError("FS_IS_DIRECTORY");
		const abs = await resolveInside(root, rel);
		let info;
		try {
			info = await stat(abs);
		} catch (error) {
			if (isNotFound$2(error)) throw new GitError("FS_NOT_FOUND");
			throw new GitError("GIT_FAILED", error instanceof Error ? error.message : String(error));
		}
		if (info.isDirectory()) throw new GitError("FS_IS_DIRECTORY");
		if (info.size > 8e6) throw new GitError("FS_TOO_LARGE");
		let buffer;
		try {
			buffer = await readFile(abs);
		} catch (error) {
			if (isPermission(error)) throw new GitError("FS_WRITE_FAILED");
			throw new GitError("GIT_FAILED", error instanceof Error ? error.message : String(error));
		}
		const mime = imageMimeOf(rel, buffer);
		if (mime === null) throw new GitError("FS_BINARY");
		return {
			buffer,
			mime
		};
	}
	/**
	* Read a spreadsheet / delimited-text file (xlsx, csv, tsv) as raw bytes
	* for in-browser table preview. Validates the container so arbitrary
	* workspace files cannot be served as data.
	*/
	async readData(root, filePath) {
		const rel = assertSafeWorkspacePath(root, filePath);
		if (rel === "") throw new GitError("FS_IS_DIRECTORY");
		const abs = await resolveInside(root, rel);
		let info;
		try {
			info = await stat(abs);
		} catch (error) {
			if (isNotFound$2(error)) throw new GitError("FS_NOT_FOUND");
			throw new GitError("GIT_FAILED", error instanceof Error ? error.message : String(error));
		}
		if (info.isDirectory()) throw new GitError("FS_IS_DIRECTORY");
		if (info.size > 8e6) throw new GitError("FS_TOO_LARGE");
		let buffer;
		try {
			buffer = await readFile(abs);
		} catch (error) {
			if (isPermission(error)) throw new GitError("FS_WRITE_FAILED");
			throw new GitError("GIT_FAILED", error instanceof Error ? error.message : String(error));
		}
		const ext = extname(rel).toLowerCase();
		if (ext === ".xlsx") {
			const magic = Buffer.from([
				80,
				75,
				3,
				4
			]);
			if (buffer.length < 4 || !buffer.subarray(0, 4).equals(magic)) throw new GitError("FS_BINARY");
			return {
				buffer,
				mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
			};
		}
		const mime = ext === ".csv" ? "text/csv; charset=utf-8" : ext === ".tsv" ? "text/tab-separated-values; charset=utf-8" : null;
		if (mime === null) throw new GitError("FS_BINARY");
		if (buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) throw new GitError("FS_BINARY");
		return {
			buffer,
			mime
		};
	}
	/** Rename or move a workspace entry (file or folder). Rejects names that already exist or paths inside the source itself. */
	async rename(root, fromPath, toPath) {
		const fromRel = assertSafeWorkspacePath(root, fromPath);
		const toRel = assertSafeWorkspacePath(root, toPath);
		if (fromRel === "" || toRel === "") throw new GitError("INVALID_PATH");
		if (fromRel === toRel) throw new GitError("FS_EXISTS");
		if (toRel === fromRel || toRel.startsWith(fromRel + "/")) throw new GitError("INVALID_PATH");
		const fromAbs = await resolveInside(root, fromRel);
		const toAbs = await resolveInside(root, toRel);
		let target;
		try {
			target = await stat(toAbs);
		} catch (error) {
			if (!isNotFound$2(error)) throw new GitError("FS_RENAME_FAILED");
		}
		if (target !== void 0) throw new GitError("FS_EXISTS");
		try {
			await rename(fromAbs, toAbs);
		} catch (error) {
			if (error instanceof GitError) throw error;
			throw new GitError("FS_RENAME_FAILED", error instanceof Error ? error.message : void 0);
		}
		return { path: toPosix(toRel) };
	}
	/** Delete a workspace entry (file or folder, recursively). */
	async delete(root, filePath) {
		const rel = assertSafeWorkspacePath(root, filePath);
		if (rel === "") throw new GitError("INVALID_PATH");
		const abs = await resolveInside(root, rel);
		try {
			await rm(abs, {
				recursive: true,
				force: false
			});
		} catch (error) {
			if (isNotFound$2(error)) throw new GitError("FS_NOT_FOUND");
			if (error instanceof GitError) throw error;
			throw new GitError("FS_DELETE_FAILED", error instanceof Error ? error.message : void 0);
		}
		return { path: toPosix(rel) };
	}
	/** Create an empty folder. Parent must already exist. Rejects names that already exist. */
	async mkdir(root, dirPath) {
		const rel = assertSafeWorkspacePath(root, dirPath);
		if (rel === "") throw new GitError("INVALID_PATH");
		const abs = await resolveInside(root, rel);
		try {
			await stat(abs);
			throw new GitError("FS_EXISTS");
		} catch (error) {
			if (error instanceof GitError) throw error;
			if (!isNotFound$2(error)) throw new GitError("FS_MKDIR_FAILED");
		}
		try {
			await mkdir(abs, { recursive: false });
		} catch (error) {
			if (isNotFound$2(error)) throw new GitError("FS_NOT_FOUND");
			if (error instanceof GitError) throw error;
			throw new GitError("FS_MKDIR_FAILED", error instanceof Error ? error.message : void 0);
		}
		return { path: toPosix(rel) };
	}
	/** Copy a file or folder to a new workspace path. Destination must not exist. */
	async copy(root, fromPath, toPath) {
		const fromRel = assertSafeWorkspacePath(root, fromPath);
		const toRel = assertSafeWorkspacePath(root, toPath);
		if (fromRel === "" || toRel === "") throw new GitError("INVALID_PATH");
		if (fromRel === toRel) throw new GitError("FS_EXISTS");
		if (toRel === fromRel || toRel.startsWith(fromRel + "/")) throw new GitError("INVALID_PATH");
		const fromAbs = await resolveInside(root, fromRel);
		const toAbs = await resolveInside(root, toRel);
		try {
			await stat(fromAbs);
		} catch (error) {
			if (isNotFound$2(error)) throw new GitError("FS_NOT_FOUND");
			throw new GitError("FS_COPY_FAILED");
		}
		try {
			if (await stat(toAbs) !== void 0) throw new GitError("FS_EXISTS");
		} catch (error) {
			if (error instanceof GitError) throw error;
			if (!isNotFound$2(error)) throw new GitError("FS_COPY_FAILED");
		}
		try {
			await cp(fromAbs, toAbs, {
				recursive: true,
				errorOnExist: true,
				force: false
			});
		} catch (error) {
			if (error instanceof GitError) throw error;
			throw new GitError("FS_COPY_FAILED", error instanceof Error ? error.message : void 0);
		}
		return { path: toPosix(toRel) };
	}
	async write(root, filePath, content) {
		const rel = assertSafeWorkspacePath(root, filePath);
		if (rel === "") throw new GitError("FS_IS_DIRECTORY");
		if (Buffer.byteLength(content, "utf8") > 15e5) throw new GitError("FS_TOO_LARGE");
		const abs = await resolveInside(root, rel);
		try {
			if ((await stat(abs)).isDirectory()) throw new GitError("FS_IS_DIRECTORY");
		} catch (error) {
			if (error instanceof GitError) throw error;
			if (!isNotFound$2(error)) throw new GitError("FS_WRITE_FAILED");
			await mkdir(dirname(abs), { recursive: true });
		}
		try {
			await writeFile(abs, content, "utf8");
		} catch (error) {
			if (error instanceof GitError) throw error;
			throw new GitError("FS_WRITE_FAILED", error instanceof Error ? error.message : void 0);
		}
		return {
			path: rel,
			size: Buffer.byteLength(content, "utf8")
		};
	}
};
//#endregion
//#region src/shared/git-sync-prefs.ts
const DEFAULT_GIT_SYNC_PREFS = {
	pullMode: "merge",
	pushMode: "safe"
};
function parsePullMode(raw) {
	if (raw === "ff-only" || raw === "rebase" || raw === "merge") return raw;
	return DEFAULT_GIT_SYNC_PREFS.pullMode;
}
function parsePushMode(raw) {
	if (raw === "lease" || raw === "safe") return raw;
	return DEFAULT_GIT_SYNC_PREFS.pushMode;
}
function pullArgs(mode) {
	switch (mode) {
		case "ff-only": return ["pull", "--ff-only"];
		case "rebase": return ["pull", "--rebase"];
		default: return [
			"pull",
			"--no-rebase",
			"--no-edit"
		];
	}
}
function pushArgs(mode, remote, setUpstream) {
	if (setUpstream) return [
		"push",
		"-u",
		remote,
		"HEAD"
	];
	if (mode === "lease") return ["push", "--force-with-lease"];
	return ["push"];
}
//#endregion
//#region src/shared/git-identity.ts
const DEFAULT_INIT_BRANCH = "main";
const NAME_MAX = 128;
const EMAIL_MAX = 254;
/** Reject names git would store poorly or that look empty to a person. */
function invalidGitUserName(raw) {
	const name = raw.trim();
	if (name === "") return "empty";
	if (name.length > NAME_MAX) return "invalid";
	if (/[\r\n\0]/.test(name)) return "invalid";
	return null;
}
/** Git is permissive; we only require a non-empty local-part@host so 小白能一眼看懂。 */
function invalidGitUserEmail(raw) {
	const email = raw.trim();
	if (email === "") return "empty";
	if (email.length > EMAIL_MAX) return "invalid";
	if (/[\s\r\n\0]/.test(email)) return "invalid";
	if (!/^[^\s@]+@[^\s@]+$/.test(email)) return "invalid";
	return null;
}
function normalizeGitUserName(raw) {
	return raw.trim();
}
function normalizeGitUserEmail(raw) {
	return raw.trim();
}
function normalizeInitBranch(raw) {
	const name = normalizeBranchName(raw);
	return name === "" ? DEFAULT_INIT_BRANCH : name;
}
/** Empty input becomes `main`. Only reject names git would refuse. */
function invalidInitBranch(raw) {
	return invalidBranchName(normalizeInitBranch(raw)) === "invalid" ? "invalid" : null;
}
//#endregion
//#region src/host/mutex.ts
/** One-at-a-time lock so overlapping Git writes cannot corrupt the index. */
var GitMutex = class {
	busy = false;
	async run(fn) {
		if (this.busy) throw new GitError("BUSY");
		this.busy = true;
		try {
			return await fn();
		} finally {
			this.busy = false;
		}
	}
};
//#endregion
//#region src/host/git-service.ts
const KIND_LABEL = {
	modified: "已修改",
	added: "新增",
	deleted: "已删除",
	renamed: "已重命名",
	untracked: "未跟踪",
	conflict: "冲突"
};
function letterKind(letter) {
	switch (letter) {
		case "A": return "added";
		case "D": return "deleted";
		case "R":
		case "C": return "renamed";
		case "U": return "conflict";
		case "?": return "untracked";
		default: return "modified";
	}
}
/** Parse `git log --format=%D` decorations into HEAD + typed ref marks. */
function parseDecorations(raw) {
	if (raw.trim() === "") return {
		head: false,
		refs: []
	};
	let head = false;
	const refs = [];
	for (const part of raw.split(",").map((item) => item.trim()).filter(Boolean)) {
		if (part === "HEAD") {
			head = true;
			continue;
		}
		if (part.startsWith("HEAD -> ")) {
			head = true;
			refs.push({
				name: part.slice(8),
				kind: "branch"
			});
			continue;
		}
		if (part.startsWith("tag: ")) {
			refs.push({
				name: part.slice(5),
				kind: "tag"
			});
			continue;
		}
		if (part.includes("/") && part.endsWith("/HEAD")) continue;
		refs.push({
			name: part,
			kind: part.includes("/") ? "remote" : "branch"
		});
	}
	return {
		head,
		refs
	};
}
/** Parse `git log --format=%P` parent hashes. */
function parseParents(raw) {
	if (raw === void 0 || raw.trim() === "") return [];
	const seen = /* @__PURE__ */ new Set();
	const parents = [];
	for (const part of raw.trim().split(/\s+/)) {
		if (!/^[0-9a-f]{7,64}$/i.test(part) || seen.has(part)) continue;
		seen.add(part);
		parents.push(part);
	}
	return parents;
}
function parsePath(raw) {
	const trimmed = raw.trim();
	if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) return trimmed.slice(1, -1).replace(/\\n/g, "\n").replace(/\\t/g, "	").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
	const arrow = trimmed.indexOf(" -> ");
	return arrow === -1 ? trimmed : trimmed.slice(arrow + 4);
}
/** Visible header so an empty new file is not mistaken for “no diff”. */
function emptyNewFileDiff(path) {
	return [
		`diff --git a/${path} b/${path}`,
		"new file mode 100644",
		"--- /dev/null",
		`+++ b/${path}`
	].join("\n") + "\n";
}
function assertSafeRepoPath(root, filePath) {
	if (filePath.trim() === "") throw new GitError("INVALID_PATH");
	if (filePath.startsWith("-")) throw new GitError("INVALID_PATH");
	const resolved = resolve(root, filePath);
	const rel = relative(root, resolved);
	if (rel.startsWith("..") || rel === "" || normalize(rel).split(sep).includes("..")) throw new GitError("INVALID_PATH");
	return rel.split("\\").join("/");
}
function parseBranchLine(line) {
	const rest = line.startsWith("## ") ? line.slice(3) : line;
	if (rest.startsWith("HEAD (no branch)") || rest === "HEAD" || rest.startsWith("HEAD...")) {
		const detachedMatch = /^HEAD(?: \(no branch\))?(?:\.\.\.(\S+))?/.exec(rest);
		return {
			branch: void 0,
			detached: true,
			ahead: 0,
			behind: 0,
			...detachedMatch?.[1] ? { upstream: detachedMatch[1] } : {}
		};
	}
	const unborn = rest.replace(/^(?:No commits yet on |Initial commit on )/, "");
	const match = /^(\S+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(unborn);
	let ahead = 0;
	let behind = 0;
	const tracking = match?.[3];
	if (tracking) {
		const aheadMatch = /ahead (\d+)/.exec(tracking);
		const behindMatch = /behind (\d+)/.exec(tracking);
		if (aheadMatch) ahead = Number(aheadMatch[1]);
		if (behindMatch) behind = Number(behindMatch[1]);
	}
	return {
		branch: match?.[1],
		detached: false,
		ahead,
		behind,
		...match?.[2] ? { upstream: match[2] } : {}
	};
}
function parsePorcelain(stdout) {
	const lines = stdout.split(/\r?\n/).filter((line) => line.length > 0);
	const header = lines.find((line) => line.startsWith("## ")) ?? "## HEAD";
	const files = [];
	for (const line of lines) {
		if (line.startsWith("## ")) continue;
		if (line.startsWith("!! ")) continue;
		if (line.startsWith("?")) {
			files.push({
				path: parsePath(line.slice(3)),
				kind: "untracked",
				staged: false,
				labelZh: KIND_LABEL.untracked
			});
			continue;
		}
		if (line.length < 4) continue;
		const x = line[0] ?? " ";
		const y = line[1] ?? " ";
		const path = parsePath(line.slice(3));
		if (x !== " " && x !== "?") {
			const kind = letterKind(x);
			files.push({
				path,
				kind,
				staged: true,
				labelZh: KIND_LABEL[kind]
			});
		}
		if (y !== " ") {
			const kind = letterKind(y);
			files.push({
				path,
				kind,
				staged: false,
				labelZh: KIND_LABEL[kind]
			});
		}
	}
	return {
		header,
		files
	};
}
/** Workspace-rooted Git operations with structured Chinese errors. */
var GitService = class {
	extraEnv;
	mutex = new GitMutex();
	/**
	* Extra env for git subprocesses. Tests pass `GIT_CONFIG_GLOBAL` so `--global`
	* writes never touch the developer's real `~/.gitconfig`.
	*/
	constructor(extraEnv = {}) {
		this.extraEnv = extraEnv;
	}
	run(options) {
		return runGit({
			...options,
			env: {
				...this.extraEnv,
				...options.env
			}
		});
	}
	async readConfig(cwd, key, file, signal) {
		const result = await this.run({
			cwd,
			args: [
				"config",
				`--${file}`,
				"--null",
				"--get",
				key
			],
			signal,
			allowNonZero: true
		});
		if (result.exitCode !== 0) return void 0;
		const value = result.stdout.replace(/\0+$/, "").trim();
		return value === "" ? void 0 : value;
	}
	async identity(root, signal) {
		if (!(await gitAvailable(signal)).ok) throw new GitError("GIT_NOT_FOUND");
		const [nameLocal, nameGlobal, nameSystem, emailLocal, emailGlobal, emailSystem, branchLocal, branchGlobal, branchSystem] = await Promise.all([
			this.readConfig(root, "user.name", "local", signal),
			this.readConfig(root, "user.name", "global", signal),
			this.readConfig(root, "user.name", "system", signal),
			this.readConfig(root, "user.email", "local", signal),
			this.readConfig(root, "user.email", "global", signal),
			this.readConfig(root, "user.email", "system", signal),
			this.readConfig(root, "init.defaultBranch", "local", signal),
			this.readConfig(root, "init.defaultBranch", "global", signal),
			this.readConfig(root, "init.defaultBranch", "system", signal)
		]);
		return {
			name: nameLocal ?? nameGlobal ?? nameSystem ?? "",
			email: emailLocal ?? emailGlobal ?? emailSystem ?? "",
			defaultBranch: normalizeInitBranch(branchLocal ?? branchGlobal ?? branchSystem ?? "main")
		};
	}
	/** Create a repo in the workspace. Does not run unless the caller asked. Idempotent if already a repo. */
	async initRepo(root, input, signal) {
		return this.mutex.run(async () => {
			const name = normalizeGitUserName(input.name);
			const email = normalizeGitUserEmail(input.email);
			const branch = normalizeInitBranch(input.branch);
			if (invalidGitUserName(name) !== null || invalidGitUserEmail(email) !== null) throw new GitError(invalidGitUserName(name) === "empty" || invalidGitUserEmail(email) === "empty" ? "IDENTITY_MISSING" : "IDENTITY_INVALID");
			if (invalidInitBranch(branch) !== null) throw new GitError("BRANCH_INVALID");
			if (!(await gitAvailable(signal)).ok) throw new GitError("GIT_NOT_FOUND");
			if ((await this.probe(root, signal)).isRepo) return this.status(root, signal);
			try {
				await this.run({
					cwd: root,
					args: [
						"init",
						"-b",
						branch
					],
					signal
				});
			} catch {
				await this.run({
					cwd: root,
					args: ["init"],
					signal
				});
				await this.run({
					cwd: root,
					args: [
						"symbolic-ref",
						"HEAD",
						`refs/heads/${branch}`
					],
					signal
				});
			}
			await this.run({
				cwd: root,
				args: [
					"config",
					"user.email",
					email
				],
				signal
			});
			await this.run({
				cwd: root,
				args: [
					"config",
					"user.name",
					name
				],
				signal
			});
			return this.status(root, signal);
		});
	}
	async probe(root, signal) {
		const available = await gitAvailable(signal);
		if (!available.ok) return {
			gitAvailable: false,
			isRepo: false,
			detached: false,
			ahead: 0,
			behind: 0,
			hasHead: false
		};
		try {
			const inside = await runGit({
				cwd: root,
				args: ["rev-parse", "--is-inside-work-tree"],
				signal,
				allowNonZero: true
			});
			if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") return {
				gitAvailable: true,
				gitVersion: available.version,
				isRepo: false,
				detached: false,
				ahead: 0,
				behind: 0,
				hasHead: false
			};
			const top = await runGit({
				cwd: root,
				args: ["rev-parse", "--show-toplevel"],
				signal
			});
			const status = await runGit({
				cwd: root,
				args: [
					"status",
					"--porcelain=v1",
					"-b"
				],
				signal
			});
			const remotes = await runGit({
				cwd: root,
				args: ["remote"],
				signal,
				allowNonZero: true
			});
			const head = await runGit({
				cwd: root,
				args: [
					"rev-parse",
					"--verify",
					"HEAD"
				],
				signal,
				allowNonZero: true
			});
			const { header } = parsePorcelain(status.stdout);
			const branch = parseBranchLine(header);
			const remote = remotes.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
			return {
				gitAvailable: true,
				gitVersion: available.version,
				isRepo: true,
				root: top.stdout.trim(),
				detached: branch.detached,
				ahead: branch.ahead,
				behind: branch.behind,
				hasHead: head.exitCode === 0,
				...branch.branch !== void 0 ? { branch: branch.branch } : {},
				...remote !== void 0 ? { remote } : {},
				...branch.upstream !== void 0 ? { upstream: branch.upstream } : {}
			};
		} catch (error) {
			if (error instanceof GitError && error.code === "NOT_A_REPO") return {
				gitAvailable: true,
				gitVersion: available.version,
				isRepo: false,
				detached: false,
				ahead: 0,
				behind: 0,
				hasHead: false
			};
			throw error;
		}
	}
	async status(root, signal) {
		const probe = await this.probe(root, signal);
		if (!probe.gitAvailable) throw new GitError("GIT_NOT_FOUND");
		if (!probe.isRepo) return {
			probe,
			staged: [],
			unstaged: [],
			untracked: []
		};
		const { files } = parsePorcelain((await runGit({
			cwd: root,
			args: [
				"status",
				"--porcelain=v1",
				"-b"
			],
			signal
		})).stdout);
		return {
			probe,
			staged: files.filter((file) => file.staged),
			unstaged: files.filter((file) => !file.staged && file.kind !== "untracked"),
			untracked: files.filter((file) => file.kind === "untracked")
		};
	}
	async diff(root, path, staged = false, signal) {
		await this.requireRepo(root, signal);
		const safePath = path !== void 0 ? assertSafeRepoPath(root, path) : void 0;
		if (safePath !== void 0 && !staged) {
			const untracked = await this.diffUntrackedFile(root, safePath, signal);
			if (untracked !== void 0) return {
				staged,
				path: safePath,
				text: untracked,
				empty: untracked.trim() === ""
			};
		}
		const args = [
			"diff",
			"--no-color",
			"--find-renames"
		];
		if (staged) args.push("--cached");
		if (safePath !== void 0) args.push("--", safePath);
		const text = (await runGit({
			cwd: root,
			args,
			signal,
			allowNonZero: true
		})).stdout;
		return {
			staged,
			text,
			empty: text.trim() === "",
			...safePath !== void 0 ? { path: safePath } : {}
		};
	}
	async log(root, limit = 80, signal) {
		await this.requireRepo(root, signal);
		const result = await runGit({
			cwd: root,
			args: [
				"log",
				`--max-count=${Math.min(Math.max(1, Math.floor(limit)), 100)}`,
				"--decorate=short",
				"--topo-order",
				"--format=%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1f%D%x1f%P",
				"--date=iso-strict",
				"HEAD",
				"--branches",
				"--remotes",
				"--tags"
			],
			signal,
			allowNonZero: true
		});
		if (result.exitCode !== 0) return [];
		return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
			const [hash, shortHash, author, date, subject, decorations, parentRaw] = line.split("");
			const marks = parseDecorations(decorations ?? "");
			return {
				hash: hash ?? "",
				shortHash: shortHash ?? "",
				author: author ?? "",
				date: date ?? "",
				subject: subject ?? "",
				head: marks.head,
				refs: marks.refs,
				parents: parseParents(parentRaw)
			};
		});
	}
	async branches(root, signal) {
		await this.requireRepo(root, signal);
		const list = (await runGit({
			cwd: root,
			args: [
				"branch",
				"--list",
				"--format=%(refname:short)%09%(HEAD)"
			],
			signal
		})).stdout.split(/\r?\n/).filter(Boolean).map((line) => {
			const [name, head] = line.split("	");
			return {
				name: name ?? "",
				current: head === "*"
			};
		}).filter((branch) => branch.name !== "");
		if (list.length > 0) return list;
		const head = await runGit({
			cwd: root,
			args: [
				"symbolic-ref",
				"--short",
				"HEAD"
			],
			signal,
			allowNonZero: true
		});
		const name = head.exitCode === 0 ? head.stdout.trim() : "";
		return name === "" ? [] : [{
			name,
			current: true
		}];
	}
	async stage(root, paths, signal) {
		await this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			if (paths.length === 0) throw new GitError("INVALID_PATH");
			await runGit({
				cwd: root,
				args: [
					"add",
					"--",
					...paths.map((path) => assertSafeRepoPath(root, path))
				],
				signal
			});
		});
	}
	async unstage(root, paths, signal) {
		await this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			if (paths.length === 0) throw new GitError("INVALID_PATH");
			const safe = paths.map((path) => assertSafeRepoPath(root, path));
			try {
				await runGit({
					cwd: root,
					args: [
						"restore",
						"--staged",
						"--",
						...safe
					],
					signal
				});
			} catch (error) {
				if (!(error instanceof GitError) || !/could not resolve '?HEAD'?/i.test(error.message)) throw error;
				await runGit({
					cwd: root,
					args: [
						"rm",
						"--cached",
						"-q",
						"--",
						...safe
					],
					signal
				});
			}
		});
	}
	/** Discard worktree edits (`git restore`) or delete untracked paths (`git clean -f`). */
	async restore(root, paths, signal) {
		await this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			if (paths.length === 0) throw new GitError("INVALID_PATH");
			const safe = paths.map((path) => assertSafeRepoPath(root, path));
			const snapshot = await this.status(root, signal);
			const untracked = new Set(snapshot.untracked.map((file) => file.path));
			const tracked = safe.filter((path) => !untracked.has(path));
			const junk = safe.filter((path) => untracked.has(path));
			if (tracked.length > 0) await runGit({
				cwd: root,
				args: [
					"restore",
					"--worktree",
					"--",
					...tracked
				],
				signal
			});
			if (junk.length === 0) return;
			const files = [];
			const dirs = [];
			for (const path of junk) try {
				if ((await stat(join(root, path))).isDirectory()) dirs.push(path);
				else files.push(path);
			} catch {
				files.push(path);
			}
			if (files.length > 0) await runGit({
				cwd: root,
				args: [
					"clean",
					"-f",
					"--",
					...files
				],
				signal
			});
			if (dirs.length > 0) await runGit({
				cwd: root,
				args: [
					"clean",
					"-fd",
					"--",
					...dirs
				],
				signal
			});
		});
	}
	async commit(root, message, all = false, signal) {
		return this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			const trimmed = message.trim();
			if (trimmed === "") throw new GitError("EMPTY_MESSAGE");
			const snapshot = await this.status(root, signal);
			if (snapshot.staged.length === 0) {
				const rest = [...snapshot.unstaged, ...snapshot.untracked].map((file) => file.path);
				if (!all || rest.length === 0) throw new GitError("NOTHING_STAGED");
				await runGit({
					cwd: root,
					args: [
						"add",
						"--",
						...rest.map((path) => assertSafeRepoPath(root, path))
					],
					signal
				});
			}
			await this.assertNoMergeLock(root);
			await runGit({
				cwd: root,
				args: [
					"commit",
					"-m",
					trimmed
				],
				signal
			});
			return {
				hash: (await runGit({
					cwd: root,
					args: ["rev-parse", "HEAD"],
					signal
				})).stdout.trim(),
				subject: trimmed
			};
		});
	}
	/** Update remote-tracking refs, then re-read ahead/behind. Caller must already hold the mutex. */
	async refreshTracking(root, probe, signal) {
		if (probe.remote === void 0) return probe;
		await runGit({
			cwd: root,
			args: [
				"fetch",
				"--prune",
				probe.remote
			],
			signal,
			timeoutMs: 9e4
		});
		return this.probe(root, signal);
	}
	async abortInterruptedPull(root, mode, signal) {
		await runGit({
			cwd: root,
			args: mode === "rebase" ? ["rebase", "--abort"] : ["merge", "--abort"],
			signal,
			allowNonZero: true,
			timeoutMs: 15e3
		});
	}
	async push(root, signal, pushMode = "safe") {
		const mode = parsePushMode(pushMode);
		return this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			let probe = await this.probe(root, signal);
			if (probe.detached) throw new GitError("DETACHED_HEAD");
			if (probe.remote === void 0) throw new GitError("NO_REMOTE");
			if (!probe.hasHead) throw new GitError("NOTHING_TO_PUSH");
			probe = await this.refreshTracking(root, probe, signal);
			if (probe.behind > 0 && mode !== "lease") throw new GitError("REMOTE_AHEAD");
			if (probe.ahead === 0 && probe.upstream !== void 0) throw new GitError("NOTHING_TO_PUSH");
			const branch = probe.branch;
			if (branch === void 0 || branch.trim() === "") throw new GitError("BRANCH_MISSING");
			const setUpstream = probe.upstream === void 0;
			await runGit({
				cwd: root,
				args: pushArgs(mode, probe.remote, setUpstream),
				signal,
				timeoutMs: 9e4
			});
			return {
				remote: probe.remote,
				branch,
				setUpstream
			};
		});
	}
	async pull(root, signal, pullMode = "merge") {
		const mode = parsePullMode(pullMode);
		return this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			let probe = await this.probe(root, signal);
			if (probe.detached) throw new GitError("DETACHED_HEAD");
			if (probe.remote === void 0) throw new GitError("NO_REMOTE");
			if (probe.upstream === void 0) throw new GitError("NO_UPSTREAM");
			const snapshot = await this.status(root, signal);
			if (snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length > 0) throw new GitError("DIRTY_WORKTREE");
			probe = await this.refreshTracking(root, probe, signal);
			if (probe.behind === 0) throw new GitError("NOTHING_TO_PULL");
			const branch = probe.branch;
			if (branch === void 0 || branch.trim() === "") throw new GitError("BRANCH_MISSING");
			try {
				await runGit({
					cwd: root,
					args: pullArgs(mode),
					signal,
					timeoutMs: 9e4
				});
			} catch (error) {
				await this.abortInterruptedPull(root, mode, signal);
				throw error;
			}
			return {
				remote: probe.remote,
				branch
			};
		});
	}
	async switchBranch(root, name, signal) {
		return this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			const trimmed = this.requireExistingBranch(name, await this.branches(root, signal));
			const snapshot = await this.status(root, signal);
			if (snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length > 0) throw new GitError("DIRTY_WORKTREE");
			await runGit({
				cwd: root,
				args: [
					"switch",
					"--",
					trimmed
				],
				signal
			});
			return { branch: trimmed };
		});
	}
	async fetch(root, signal) {
		await this.requireRepo(root, signal);
		const probe = await this.probe(root, signal);
		if (probe.remote === void 0) throw new GitError("NO_REMOTE");
		await runGit({
			cwd: root,
			args: [
				"fetch",
				"--prune",
				probe.remote
			],
			signal,
			timeoutMs: 9e4
		});
		return { remote: probe.remote };
	}
	async createBranch(root, name, signal) {
		return this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			const trimmed = this.requireNewBranchName(name);
			if ((await this.branches(root, signal)).some((branch) => branch.name === trimmed)) throw new GitError("BRANCH_EXISTS");
			await runGit({
				cwd: root,
				args: [
					"switch",
					"-c",
					trimmed
				],
				signal
			});
			return { branch: trimmed };
		});
	}
	async mergeBranch(root, name, signal) {
		return this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			const probe = await this.probe(root, signal);
			if (probe.detached) throw new GitError("DETACHED_HEAD");
			const current = probe.branch;
			if (current === void 0 || current.trim() === "") throw new GitError("BRANCH_MISSING");
			const trimmed = this.requireExistingBranch(name, await this.branches(root, signal));
			if (trimmed === current) throw new GitError("GIT_FAILED", "不能把当前分支合并到自己。");
			const snapshot = await this.status(root, signal);
			if (snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length > 0) throw new GitError("DIRTY_WORKTREE");
			await this.assertNoMergeLock(root);
			try {
				await runGit({
					cwd: root,
					args: [
						"merge",
						"--no-edit",
						"--",
						trimmed
					],
					signal
				});
			} catch (error) {
				const conflict = await this.hasMergeHead(root);
				await runGit({
					cwd: root,
					args: ["merge", "--abort"],
					signal,
					allowNonZero: true
				});
				if (conflict || error instanceof GitError && error.code === "MERGE_CONFLICT") throw new GitError("MERGE_CONFLICT");
				throw error;
			}
			return {
				branch: current,
				from: trimmed
			};
		});
	}
	/** Untracked files are invisible to `git diff`; show them as a full addition. */
	async diffUntrackedFile(root, safePath, signal) {
		let info;
		try {
			info = await stat(join(root, safePath));
		} catch {
			return;
		}
		if (info.isDirectory()) throw new GitError("FS_IS_DIRECTORY");
		if (info.size > 15e5) throw new GitError("FS_TOO_LARGE");
		if ((await runGit({
			cwd: root,
			args: [
				"ls-files",
				"--error-unmatch",
				"--",
				safePath
			],
			signal,
			allowNonZero: true
		})).exitCode === 0) return void 0;
		const result = await runGit({
			cwd: root,
			args: [
				"diff",
				"--no-color",
				"--no-index",
				"--",
				"/dev/null",
				safePath
			],
			signal,
			allowNonZero: true
		});
		if (result.exitCode > 1 && result.stdout.trim() === "") throw new GitError("GIT_FAILED", result.stderr.trim() || `无法读取未跟踪文件 ${safePath}`);
		if (result.stdout.trim() !== "") return result.stdout;
		return emptyNewFileDiff(safePath);
	}
	requireNewBranchName(name) {
		if (invalidBranchName(name) !== null) throw new GitError("BRANCH_INVALID");
		return normalizeBranchName(name);
	}
	requireExistingBranch(name, existing) {
		const reason = invalidBranchName(name);
		if (reason !== null) throw new GitError(reason === "empty" ? "BRANCH_MISSING" : "BRANCH_INVALID");
		const trimmed = normalizeBranchName(name);
		if (!existing.some((branch) => branch.name === trimmed)) throw new GitError("BRANCH_MISSING");
		return trimmed;
	}
	/** Files touched by a commit, with their change kind (A/M/D/R/…). Works for the root commit too. */
	async commitFiles(root, hash, signal) {
		await this.requireRepo(root, signal);
		const result = await runGit({
			cwd: root,
			args: [
				"diff-tree",
				"--no-commit-id",
				"--root",
				"--name-status",
				"-r",
				await this.requireCommitHash(hash, root, signal)
			],
			signal,
			allowNonZero: true
		});
		if (result.exitCode !== 0) throw new GitError("GIT_FAILED", result.stderr.trim() || "无法读取提交 " + hash + " 的改动文件");
		const files = [];
		for (const line of result.stdout.split(/\r?\n/)) {
			if (line.trim() === "") continue;
			const parts = line.split("	");
			const letter = (parts[0] ?? "").trim();
			if (letter === "") continue;
			const path = parts.length >= 3 ? parts[2] ?? "" : parts[1] ?? "";
			if (path.trim() === "") continue;
			const kind = letterKind(letter.charAt(0) ?? "M");
			files.push({
				path: path.trim(),
				kind,
				staged: false,
				labelZh: KIND_LABEL[kind]
			});
		}
		return files;
	}
	/** Unified diff of a single file inside a commit. */
	async commitDiff(root, hash, path, signal) {
		await this.requireRepo(root, signal);
		const safeHash = await this.requireCommitHash(hash, root, signal);
		const safePath = assertSafeRepoPath(root, path);
		const result = await runGit({
			cwd: root,
			args: [
				"show",
				"--no-color",
				"--format=",
				safeHash,
				"--",
				safePath
			],
			signal,
			allowNonZero: true
		});
		if (result.exitCode !== 0) throw new GitError("GIT_FAILED", result.stderr.trim() || "无法读取提交 " + hash + " 中 " + path + " 的差异");
		return {
			staged: false,
			path: safePath,
			text: result.stdout,
			empty: result.stdout.trim() === ""
		};
	}
	async requireCommitHash(hash, root, signal) {
		const trimmed = hash.trim();
		if (!/^[0-9a-fA-F]{7,40}$/.test(trimmed)) throw new GitError("INVALID_PATH");
		const verified = await runGit({
			cwd: root,
			args: [
				"rev-parse",
				"--verify",
				"--quiet",
				trimmed + "^{commit}"
			],
			signal,
			allowNonZero: true
		});
		if (verified.exitCode !== 0 || verified.stdout.trim() === "") throw new GitError("GIT_FAILED", "找不到这个提交。");
		return verified.stdout.trim();
	}
	async requireRepo(root, signal) {
		const probe = await this.probe(root, signal);
		if (!probe.gitAvailable) throw new GitError("GIT_NOT_FOUND");
		if (!probe.isRepo) throw new GitError("NOT_A_REPO");
	}
	async hasMergeHead(root) {
		try {
			await access(join(root, ".git", "MERGE_HEAD"));
			return true;
		} catch {
			return false;
		}
	}
	async assertNoMergeLock(root) {
		try {
			await access(join(root, ".git", "index.lock"));
			throw new GitError("INDEX_LOCKED");
		} catch (error) {
			if (error instanceof GitError) throw error;
		}
		if (await this.hasMergeHead(root)) throw new GitError("GIT_FAILED", "仓库正在合并中，请先处理合并再提交。");
	}
};
const SKIP_CHILD_NAMES = /* @__PURE__ */ new Set([
	"node_modules",
	".git",
	".hg",
	".svn",
	".next",
	"dist",
	"build",
	"coverage",
	"vendor"
]);
function isSkippedChildName(name) {
	return SKIP_CHILD_NAMES.has(name);
}
function folderNameFromPath(path) {
	const trimmed = path.replace(/[\\/]+$/, "");
	if (trimmed === "" || trimmed === "/") return "/";
	const parts = trimmed.split(/[\\/]/).filter(Boolean);
	return parts[parts.length - 1] || trimmed;
}
function isCurrentRepoId(id) {
	return id === void 0 || id === "" || id === ".";
}
function parseNearbyRepoId(id) {
	if (isCurrentRepoId(id)) return { kind: "current" };
	if (id === "..") return { kind: "parent" };
	if (id === void 0) return null;
	const name = id.trim();
	if (name === "" || name === "." || name === "..") return null;
	if (name.startsWith("-") || name.startsWith("/") || name.endsWith("/")) return null;
	if (/[\\\0]/.test(name) || name.includes("..")) return null;
	if (name.split("/").some((part) => part === "" || part === "." || part.startsWith("-"))) return null;
	return {
		kind: "child",
		child: name
	};
}
//#endregion
//#region src/shared/commit-template.ts
const MAX_COMMIT_TEMPLATE_CHARS = 4e3;
const DEFAULT_COMMIT_TEMPLATE_ZH = [
	"你是 Git 提交说明生成器。根据用户给出的 diff 写一条符合 Conventional Commits 的提交说明。",
	"规则：",
	"1. 只输出提交说明本身，不要解释、不要用 Markdown 代码块、不要加引号。",
	"2. 第一行：type(scope): 摘要，不超过 72 个字符。type 只能是 feat、fix、docs、style、refactor、perf、test、chore、build、ci。",
	"3. 如有必要，空一行后写正文：说明为什么改、影响范围；不要逐行复述 diff。",
	"4. 摘要和正文使用中文；文件名、符号、API 名称保持原文。",
	"5. 不要编造 diff 里没有的改动。"
].join("\n");
[
	"You are a Git commit-message generator. Write a Conventional Commits message from the given diff.",
	"Rules:",
	"1. Output only the commit message. No explanation, no Markdown fences, no quotation marks.",
	"2. First line: type(scope): summary, at most 72 characters. type must be feat, fix, docs, style, refactor, perf, test, chore, build, or ci.",
	"3. If needed, add a blank line and a body: why it changed and the impact. Do not restate the diff line by line.",
	"4. Write the summary and body in English. Keep file names, symbols, and API names as-is.",
	"5. Do not invent changes that are not in the diff."
].join("\n");
/** Host fallback when the client sends nothing. UI should send the locale default. */
const DEFAULT_COMMIT_TEMPLATE = DEFAULT_COMMIT_TEMPLATE_ZH;
/** Empty / oversized / non-string input falls back to the built-in Chinese template. */
function resolveCommitTemplate(raw, fallback = DEFAULT_COMMIT_TEMPLATE) {
	if (typeof raw !== "string") return fallback;
	const trimmed = raw.replace(/\r\n/g, "\n").trim();
	if (trimmed === "") return fallback;
	return trimmed.length > 4e3 ? trimmed.slice(0, MAX_COMMIT_TEMPLATE_CHARS).trim() : trimmed;
}
//#endregion
//#region src/host/commit-message.ts
const MAX_DIFF_CHARS = 6e4;
const GENERATE_TIMEOUT_MS$1 = 45e3;
const COMMIT_MAX_TOKENS = 1024;
const PLUGIN_SOURCE$1 = {
	kind: "plugin",
	plugin: "dsh-workbench-plugin"
};
function sanitizeCommitMessage(raw) {
	let text = raw.replace(/\r\n/g, "\n").trim();
	const fenced = /^```(?:\w+)?\n([\s\S]*?)\n```$/m.exec(text);
	if (fenced?.[1] !== void 0) text = fenced[1].trim();
	text = text.replace(/^["'`]+|["'`]+$/g, "").trim();
	if (text.length > 4e3) text = text.slice(0, 4e3).trim();
	return text;
}
function buildCommitUserPrompt(input) {
	const parts = ["请根据下面的仓库改动生成提交说明。"];
	if (input.staged.trim() !== "") parts.push("", "## 已暂存", input.staged.trim());
	if (input.unstaged.trim() !== "") parts.push("", "## 未暂存", input.unstaged.trim());
	if (input.untracked.length > 0) {
		parts.push("", "## 未跟踪");
		for (const file of input.untracked) {
			parts.push("", `### ${file.path}`);
			parts.push(file.patch.trim() === "" ? "（新文件，未能读取内容）" : file.patch.trim());
		}
	}
	let body = parts.join("\n");
	if (body.length > MAX_DIFF_CHARS) body = `${body.slice(0, MAX_DIFF_CHARS)}\n\n…（差异过长，已截断。请只根据已给出的部分总结。）`;
	return body;
}
function createCommitAssemble() {
	return {
		parts: /* @__PURE__ */ new Map(),
		types: [],
		sawReasoning: false,
		fail: "",
		finishKind: "",
		failCode: ""
	};
}
function applyCommitChunk(state, chunk) {
	state.types.push(chunk.type ?? "unknown");
	if (chunk.type === "text-delta" && typeof chunk.text === "string") {
		const index = typeof chunk.index === "number" ? chunk.index : 0;
		const part = state.parts.get(index) ?? {
			text: "",
			closed: false
		};
		if (!part.closed) state.parts.set(index, {
			text: part.text + chunk.text,
			closed: false
		});
	}
	if (chunk.type === "reasoning-delta" || chunk.block?.type === "reasoning") state.sawReasoning = true;
	if (chunk.type === "block-end" && chunk.block?.type === "text" && typeof chunk.block.text === "string") {
		const index = typeof chunk.index === "number" ? chunk.index : 0;
		state.parts.set(index, {
			text: chunk.block.text,
			closed: true
		});
	}
	if (chunk.type === "finish") {
		state.finishKind = chunk.reason?.kind ?? "";
		state.failCode = chunk.reason?.failure?.code ?? "";
		if (state.finishKind === "error" || state.finishKind === "aborted") state.fail = chunk.reason?.failure?.message ?? (state.finishKind === "aborted" ? "生成已取消或超时。" : "模型没有返回可用结果。");
	}
}
function commitAssembleText(state) {
	return [...state.parts.entries()].sort((left, right) => left[0] - right[0]).map(([, part]) => part.text).join("");
}
/** Live preview: hide unfinished markdown fences so the textarea fills with real words. */
function previewCommitMessage(raw) {
	let text = raw.replace(/\r\n/g, "\n");
	text = text.replace(/^```(?:\w+)?\r?\n?/, "");
	text = text.replace(/\n```[ \t]*$/, "");
	if (text.length > 4e3) text = text.slice(0, 4e3);
	return text;
}
function summarizeTypes$1(types) {
	if (types.length === 0) return "没有任何数据";
	const counts = /* @__PURE__ */ new Map();
	for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);
	return [...counts.entries()].map(([type, count]) => `${type}×${count}`).join("，");
}
function commitAssembleResult(state) {
	const text = commitAssembleText(state);
	const trace = summarizeTypes$1(state.types);
	if (state.fail !== "") {
		const code = state.failCode === "" ? "" : ` [${state.failCode}]`;
		return {
			text,
			fail: `${state.fail}${code}（${trace}）`
		};
	}
	if (sanitizeCommitMessage(text) !== "") return {
		text,
		fail: ""
	};
	if (state.types.length === 0) return {
		text,
		fail: "模型接口没有返回任何数据。请确认「模型」已配置，然后重试。"
	};
	if (state.finishKind === "max-tokens") return {
		text,
		fail: state.sawReasoning ? `模型把输出额度用在了思考过程上，没有写出提交说明。（${trace}）` : `模型输出被截断，没有完整提交说明。（${trace}）`
	};
	if (state.sawReasoning) return {
		text,
		fail: `模型只返回了思考过程，没有写出提交说明。（${trace}）`
	};
	if (state.finishKind === "") return {
		text,
		fail: `模型调用没有正常结束。（${trace}）`
	};
	return {
		text,
		fail: `模型没有返回提交说明。（${trace}）`
	};
}
function pickCommitRoute(providers, models, preferred) {
	if (providers.length === 0) throw new GitError("LLM_UNAVAILABLE");
	if (preferred !== void 0 && preferred.provider !== "" && preferred.model !== "" && providers.some((provider) => provider.id === preferred.provider)) return {
		provider: preferred.provider,
		model: preferred.model
	};
	const ranked = [...providers].sort((left, right) => {
		const score = (id) => id.includes("deepseek") ? 0 : 1;
		return score(left.id) - score(right.id);
	});
	for (const provider of ranked) {
		const first = models[provider.id]?.[0]?.id;
		if (first) return {
			provider: provider.id,
			model: first
		};
	}
	throw new GitError("LLM_UNAVAILABLE");
}
function pickCommitReasoningEffort(info) {
	const efforts = info?.reasoning?.efforts ?? [];
	if (efforts.length === 0) return void 0;
	return efforts.some((effort) => effort.id === "off") ? "off" : void 0;
}
async function collectChangePayload(git, root, signal) {
	const status = await git.status(root, signal);
	if (status.staged.length + status.unstaged.length + status.untracked.length === 0) throw new GitError("NOTHING_TO_DESCRIBE");
	if (status.staged.length > 0) return {
		staged: (await git.diff(root, void 0, true, signal)).text,
		unstaged: "",
		untracked: []
	};
	const unstaged = status.unstaged.length > 0 ? (await git.diff(root, void 0, false, signal)).text : "";
	const untracked = [];
	for (const file of status.untracked.slice(0, 20)) try {
		const result = await git.diff(root, file.path, false, signal);
		untracked.push({
			path: file.path,
			patch: result.text.slice(0, 8e3)
		});
	} catch {
		untracked.push({
			path: file.path,
			patch: ""
		});
	}
	return {
		staged: "",
		unstaged,
		untracked
	};
}
function readLlm$2(ctx) {
	const llm = ctx.llm ?? ctx.get("llm");
	if (llm === void 0 || typeof llm.stream !== "function" || typeof llm.listProviders !== "function") throw new GitError("LLM_UNAVAILABLE");
	return llm;
}
function readPreferredRoute$1(ctx) {
	const selection = (ctx.agentDefaultModel ?? ctx.get("agentDefaultModel"))?.currentSelection?.();
	if (typeof selection?.provider === "string" && selection.provider !== "" && typeof selection.model === "string" && selection.model !== "") return {
		provider: selection.provider,
		model: selection.model
	};
}
async function resolveRoute$2(ctx) {
	const llm = readLlm$2(ctx);
	const providers = llm.listProviders();
	const preferred = readPreferredRoute$1(ctx);
	if (preferred !== void 0 && providers.some((provider) => provider.id === preferred.provider)) return preferred;
	const models = {};
	for (const provider of providers) try {
		models[provider.id] = await llm.listModels(provider.id);
	} catch {
		models[provider.id] = [];
	}
	return pickCommitRoute(providers, models, preferred);
}
async function resolveReasoningEffort$1(llm, route, signal) {
	if (typeof llm.resolveModelInfo !== "function") return "off";
	try {
		return pickCommitReasoningEffort(await llm.resolveModelInfo(route.provider, route.model, signal));
	} catch {
		return;
	}
}
function buildUserMessage$1(text) {
	return {
		id: crypto.randomUUID(),
		role: "user",
		content: [{
			type: "text",
			text
		}],
		source: PLUGIN_SOURCE$1
	};
}
/** Stream commit text as the model writes it. Throws GitError when the call fails. */
async function* streamCommitMessage(ctx, git, root, options) {
	const signal = options?.signal;
	const system = resolveCommitTemplate(options?.template);
	const payload = await collectChangePayload(git, root, signal);
	const llm = readLlm$2(ctx);
	const route = await resolveRoute$2(ctx);
	const reasoningEffort = await resolveReasoningEffort$1(llm, route, signal);
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, GENERATE_TIMEOUT_MS$1);
	const onAbort = () => {
		controller.abort();
	};
	signal?.addEventListener("abort", onAbort);
	try {
		const state = createCommitAssemble();
		let last = "";
		for await (const chunk of llm.stream({
			provider: route.provider,
			model: route.model,
			system,
			messages: [buildUserMessage$1(buildCommitUserPrompt(payload))],
			maxTokens: COMMIT_MAX_TOKENS,
			temperature: .2,
			purpose: "session-title",
			...reasoningEffort === void 0 ? {} : { reasoningEffort },
			signal: controller.signal
		})) {
			if (controller.signal.aborted) break;
			applyCommitChunk(state, chunk);
			const visible = previewCommitMessage(commitAssembleText(state));
			if (visible !== last) {
				last = visible;
				yield {
					type: "delta",
					text: visible
				};
			}
		}
		if (signal?.aborted) throw new GitError("LLM_FAILED", "生成已取消。");
		const assembled = commitAssembleResult(state);
		if (assembled.fail !== "") throw new GitError("LLM_FAILED", `${assembled.fail} 路由：${route.provider} / ${route.model}`);
		yield {
			type: "done",
			message: sanitizeCommitMessage(assembled.text)
		};
	} catch (error) {
		if (error instanceof GitError) throw error;
		if (controller.signal.aborted) throw new GitError("LLM_FAILED", signal?.aborted ? "生成已取消。" : "生成超时或已取消，请稍后重试。");
		throw new GitError("LLM_FAILED", error instanceof Error ? error.message : String(error));
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}
/** One-shot auxiliary LLM call: fixed prompt + current diff → commit message. */
async function generateCommitMessage(ctx, git, root, options) {
	let message = "";
	for await (const event of streamCommitMessage(ctx, git, root, options)) if (event.type === "done") message = event.message;
	return message;
}
const DEFAULT_BLACKLIST = [
	{
		id: "rm-rf",
		kind: "rm",
		enabled: true,
		pattern: "rm -rf"
	},
	{
		id: "mkfs",
		kind: "other",
		enabled: true,
		pattern: "mkfs"
	},
	{
		id: "dd-of",
		kind: "other",
		enabled: true,
		pattern: "dd of="
	},
	{
		id: "fork-bomb",
		kind: "other",
		enabled: true,
		pattern: ":(){"
	},
	{
		id: "write-sd",
		kind: "other",
		enabled: true,
		pattern: ">/dev/sd"
	},
	{
		id: "shutdown",
		kind: "other",
		enabled: true,
		pattern: "shutdown"
	},
	{
		id: "reboot",
		kind: "other",
		enabled: true,
		pattern: "reboot"
	},
	{
		id: "halt",
		kind: "other",
		enabled: true,
		pattern: "halt"
	},
	{
		id: "poweroff",
		kind: "other",
		enabled: true,
		pattern: "poweroff"
	},
	{
		id: "init-0",
		kind: "other",
		enabled: true,
		pattern: "init 0"
	},
	{
		id: "init-6",
		kind: "other",
		enabled: true,
		pattern: "init 6"
	},
	{
		id: "git-reset-hard",
		kind: "other",
		enabled: true,
		pattern: "git reset --hard"
	},
	{
		id: "git-clean-f",
		kind: "other",
		enabled: true,
		pattern: "git clean -f"
	},
	{
		id: "find-delete",
		kind: "other",
		enabled: true,
		pattern: "find -delete"
	},
	{
		id: "format-drive",
		kind: "other",
		enabled: true,
		pattern: "format"
	}
];
const LEGACY_RULE_TO_IDS = {
	rmRf: ["rm-rf"],
	mkfs: ["mkfs"],
	ddDisk: ["dd-of"],
	forkBomb: ["fork-bomb"],
	writeDisk: ["write-sd"],
	shutdown: [
		"shutdown",
		"reboot",
		"halt",
		"poweroff",
		"init-0",
		"init-6"
	],
	formatDrive: ["format-drive"],
	gitResetHard: ["git-reset-hard"],
	gitClean: ["git-clean-f"],
	findDelete: ["find-delete"]
};
function cloneBlacklist(rules) {
	return rules.map((rule) => ({ ...rule }));
}
function resolveKind(raw, pattern) {
	if (raw === "rm" || raw === "other") return raw;
	const stripped = pattern.replace(/^sudo\s+/i, "");
	return /^rm\b/i.test(stripped) ? "rm" : "other";
}
function resolveBlacklistRule(raw, index) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
	const source = raw;
	const pattern = typeof source.pattern === "string" ? source.pattern.replace(/[\r\n]+/g, " ") : "";
	const clipped = pattern.length > 80 ? pattern.slice(0, 80) : pattern;
	const kind = resolveKind(source.kind, clipped.trim());
	return {
		id: typeof source.id === "string" && source.id.trim() !== "" ? source.id.trim().slice(0, 64) : `${kind}-${index}`,
		kind,
		enabled: source.enabled !== false,
		pattern: clipped
	};
}
function resolveBlacklist(raw, legacyRules) {
	if (Array.isArray(raw)) {
		const next = [];
		const seen = /* @__PURE__ */ new Set();
		for (const item of raw) {
			if (next.length >= 40) break;
			const rule = resolveBlacklistRule(item, next.length);
			if (rule === null) continue;
			let id = rule.id;
			if (seen.has(id)) id = `${id}-${next.length}`;
			seen.add(id);
			next.push({
				...rule,
				id
			});
		}
		return next;
	}
	if (legacyRules !== null && typeof legacyRules === "object" && !Array.isArray(legacyRules)) {
		const flags = legacyRules;
		return DEFAULT_BLACKLIST.map((rule) => {
			let enabled = rule.enabled;
			for (const [legacy, ids] of Object.entries(LEGACY_RULE_TO_IDS)) if (ids.includes(rule.id) && typeof flags[legacy] === "boolean") {
				enabled = flags[legacy];
				break;
			}
			return {
				...rule,
				enabled
			};
		});
	}
	return cloneBlacklist(DEFAULT_BLACKLIST);
}
function tokenize(text) {
	return text.split(/\s+/).filter(Boolean);
}
function stripSudo(tokens) {
	if (tokens[0]?.toLowerCase() === "sudo") return tokens.slice(1);
	return tokens;
}
function parseRmNeed(pattern) {
	const tokens = stripSudo(tokenize(pattern));
	if (tokens.length === 0 || tokens[0]?.toLowerCase() !== "rm") return null;
	let recursive = false;
	let force = false;
	let extraFlags = "";
	const paths = [];
	for (const token of tokens.slice(1)) {
		if (token === "--") continue;
		if (token === "--recursive" || token.startsWith("--recursive=")) {
			recursive = true;
			continue;
		}
		if (token === "--force" || token.startsWith("--force=")) {
			force = true;
			continue;
		}
		if (token.startsWith("--")) continue;
		if (/^-[A-Za-z]+$/.test(token)) {
			if (/[rR]/.test(token)) recursive = true;
			if (/f/.test(token)) force = true;
			extraFlags += token.slice(1).replace(/[rRf]/g, "");
			continue;
		}
		paths.push(token);
	}
	return {
		recursive,
		force,
		extraFlags: extraFlags.toLowerCase(),
		paths,
		anyRm: !recursive && !force && extraFlags === "" && paths.length === 0
	};
}
function shortFlagsIn(tokens) {
	let flags = "";
	for (const token of tokens) {
		if (token === "--") break;
		if (token.startsWith("--")) {
			if (token === "--recursive" || token.startsWith("--recursive=")) flags += "r";
			if (token === "--force" || token.startsWith("--force=")) flags += "f";
			continue;
		}
		if (/^-[A-Za-z]+$/.test(token)) flags += token.slice(1).toLowerCase();
	}
	return flags;
}
function rmInvocations(command) {
	const chunks = command.split(/[|;&\n]+/);
	const found = [];
	for (const chunk of chunks) {
		const tokens = stripSudo(tokenize(chunk.replace(/^\s*\(+/, "")));
		const index = tokens.findIndex((token) => token.toLowerCase() === "rm");
		if (index === -1) continue;
		found.push(tokens.slice(index + 1));
	}
	return found;
}
function rmMatchesNeed(args, need) {
	if (need.anyRm) return true;
	const flags = shortFlagsIn(args);
	if (need.recursive && !flags.includes("r")) return false;
	if (need.force && !flags.includes("f")) return false;
	for (const letter of need.extraFlags) if (!flags.includes(letter)) return false;
	const paths = [];
	for (const token of args) {
		if (token === "--") continue;
		if (token.startsWith("-") && token !== "-") continue;
		paths.push(token);
	}
	for (const required of need.paths) if (!paths.some((path) => {
		if (required === "/") return path === "/" || path === "/*";
		return path === required || path.startsWith(`${required}/`);
	})) return false;
	return true;
}
function commandMatchesRm(command, pattern) {
	const effective = pattern.trim().replace(/^sudo\s+/i, "");
	const need = parseRmNeed(/^rm\b/i.test(effective) ? pattern.trim() : `rm ${effective}`);
	if (need === null) return false;
	return rmInvocations(command).some((args) => rmMatchesNeed(args, need));
}
function shortFlagPresent(tokens, letter) {
	const lower = letter.toLowerCase();
	for (const token of tokens) {
		if (token === "--") break;
		if (/^-[A-Za-z]+$/.test(token) && token.toLowerCase().includes(lower)) return true;
	}
	return false;
}
function commandHasToken(command, token) {
	const needle = token.toLowerCase();
	if (needle === "") return false;
	const words = tokenize(command);
	if (needle.startsWith("--")) return words.some((word) => {
		const lower = word.toLowerCase();
		return lower === needle || lower.startsWith(`${needle}=`);
	});
	if (/^-[A-Za-z]{1,3}$/.test(token)) return [...token.slice(1)].every((letter) => shortFlagPresent(words, letter));
	if (/[/=><:{]/.test(token)) return command.toLowerCase().replace(/\s+/g, "").includes(needle.replace(/\s+/g, ""));
	if (/^[A-Za-z][\w]*$/.test(token)) return words.some((word) => {
		const lower = word.toLowerCase();
		return lower === needle || lower.startsWith(`${needle}.`);
	});
	return words.some((word) => word.toLowerCase() === needle);
}
function commandMatchesOther(command, pattern) {
	const tokens = tokenize(pattern);
	if (tokens.length === 0) return false;
	return tokens.every((token) => commandHasToken(command, token));
}
/** True when an enabled blacklist rule matches this command line. */
function commandMatchesBlacklist(command, rules) {
	const text = command.trim();
	if (text === "") return false;
	for (const rule of rules) {
		if (!rule.enabled) continue;
		const pattern = rule.pattern.trim();
		if (pattern === "") continue;
		if (rule.kind === "rm") {
			if (commandMatchesRm(text, pattern)) return true;
			continue;
		}
		if (commandMatchesOther(text, pattern)) return true;
	}
	return false;
}
//#endregion
//#region src/shared/term-assist-prefs.ts
const DEFAULT_TERM_ASSIST_SEPARATOR = "--------";
const DEFAULT_TERM_ASSIST_PREFS = {
	showSeparator: true,
	separatorText: DEFAULT_TERM_ASSIST_SEPARATOR,
	showExplain: true,
	directRunKnownCommands: true,
	blockDestructive: true,
	blacklist: cloneBlacklist(DEFAULT_BLACKLIST)
};
function asBool(value, fallback) {
	return typeof value === "boolean" ? value : fallback;
}
function resolveSeparatorText(raw) {
	if (typeof raw !== "string") return DEFAULT_TERM_ASSIST_SEPARATOR;
	const text = redactSecrets(raw.replace(/[\r\n]+/g, " ").trim());
	if (text === "") return DEFAULT_TERM_ASSIST_SEPARATOR;
	return text.length > 80 ? text.slice(0, 80) : text;
}
/** Accepts stored JSON, a host POST body, or a partial draft. Always returns a complete prefs object. */
function resolveTermAssistPrefs(raw) {
	if (raw === void 0 || raw === null || typeof raw !== "object" || Array.isArray(raw)) return cloneTermAssistPrefs(DEFAULT_TERM_ASSIST_PREFS);
	const source = raw;
	return {
		showSeparator: asBool(source.showSeparator, DEFAULT_TERM_ASSIST_PREFS.showSeparator),
		separatorText: resolveSeparatorText(source.separatorText),
		showExplain: asBool(source.showExplain, DEFAULT_TERM_ASSIST_PREFS.showExplain),
		directRunKnownCommands: asBool(source.directRunKnownCommands, DEFAULT_TERM_ASSIST_PREFS.directRunKnownCommands),
		blockDestructive: asBool(source.blockDestructive, DEFAULT_TERM_ASSIST_PREFS.blockDestructive),
		blacklist: resolveBlacklist(source.blacklist, source.destructiveRules)
	};
}
function cloneTermAssistPrefs(prefs) {
	return {
		showSeparator: prefs.showSeparator,
		separatorText: prefs.separatorText,
		showExplain: prefs.showExplain,
		directRunKnownCommands: prefs.directRunKnownCommands,
		blockDestructive: prefs.blockDestructive,
		blacklist: cloneBlacklist(prefs.blacklist)
	};
}
//#endregion
//#region src/shared/term-assist.ts
const MAX_TERM_ASSIST_INPUT = 4e3;
const MAX_TERM_ASSIST_TRANSCRIPT = 6e3;
/** Common argv0 tokens. Keep lowercase; matching is case-insensitive. */
const KNOWN_SHELL_COMMANDS = /* @__PURE__ */ new Set([
	".",
	"alias",
	"ansible",
	"apt",
	"awk",
	"bash",
	"brew",
	"bun",
	"cargo",
	"cat",
	"cd",
	"chmod",
	"chown",
	"clang",
	"clear",
	"cmake",
	"code",
	"column",
	"cp",
	"curl",
	"cut",
	"date",
	"deno",
	"df",
	"diff",
	"dig",
	"dnf",
	"docker",
	"dsh",
	"du",
	"echo",
	"env",
	"eval",
	"exec",
	"exit",
	"export",
	"false",
	"fc",
	"fd",
	"find",
	"free",
	"fzf",
	"gcc",
	"gh",
	"git",
	"go",
	"grep",
	"head",
	"helm",
	"help",
	"history",
	"htop",
	"id",
	"ip",
	"java",
	"journalctl",
	"jq",
	"kill",
	"killall",
	"kubectl",
	"less",
	"ln",
	"ls",
	"lsof",
	"make",
	"man",
	"mise",
	"mkdir",
	"more",
	"mount",
	"mv",
	"mvn",
	"mysql",
	"nano",
	"netstat",
	"node",
	"nohup",
	"npm",
	"npx",
	"nslookup",
	"nvim",
	"pacman",
	"ping",
	"pipx",
	"bunx",
	"pip",
	"pip3",
	"pnpm",
	"podman",
	"printenv",
	"printf",
	"ps",
	"psql",
	"pwd",
	"python",
	"python3",
	"rg",
	"rm",
	"rsync",
	"rustc",
	"scp",
	"screen",
	"sed",
	"set",
	"sh",
	"shift",
	"sleep",
	"sort",
	"source",
	"ss",
	"ssh",
	"stat",
	"sudo",
	"systemctl",
	"tail",
	"tar",
	"tee",
	"terraform",
	"time",
	"timeout",
	"tmux",
	"top",
	"touch",
	"tr",
	"traceroute",
	"tree",
	"true",
	"type",
	"ulimit",
	"umask",
	"uname",
	"uniq",
	"unzip",
	"uv",
	"vim",
	"wait",
	"watch",
	"wc",
	"wget",
	"which",
	"whoami",
	"xargs",
	"yarn",
	"yum",
	"zip",
	"zsh"
]);
const ASK_EN = /^(please|pls|plz|can you|could you|would you|how (?:do|can|to|would)|what(?:'s| is| are)?|why\b|where\b|who\b|help me\b|i (?:want|need|would)|show me\b|tell me\b|explain\b|list all\b|list the\b)/i;
const ASK_CJK = /(请帮|帮我|帮忙|怎么|如何|为何|为什么|什么是|看看|看一下|解释一下|告诉我|我想|我要|能否|可不可以|麻烦|帮下|求助)/;
const CJK = /[\u3400-\u9fff]/;
const PROMPT_PREFIX = /^(?:[>$%❯➜]\s+|PS\s*>\s+)/;
const HASH_PROMPT = /^#\s+/;
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PATH_START = /^(?:\.\.?\/|~\/|\/)/;
const ASK_LINE = /^(?:ASK|NOTE|说明)\s*[:：]\s*/i;
const GREETING = /^(hi|hey|hello|hola|yo|thanks|thank you|thx|ok|okay|bye|goodbye|你好|您好|嗨|谢谢|感谢|再见)(?:[\s!.。！？?,，~～].*)?$/i;
/** English glue words: `sort by disk usage` is a request, not `sort(1)` argv. */
const PROSE_WORD = /^(a|an|the|this|that|these|those|my|all|by|of|from|into|onto|with|using|and|or|to|in|on|for|per|vs|versus|current|directory|folder|files?|lines?|disk|usage|size|largest|smallest|desc|asc|ascending|descending|please)$/i;
const ARGV_TOKEN = /^(?:-{1,2}[\w.-]+|[.~]?\/\S*|\S+\.\w+|\d+|[A-Za-z0-9._*+[\]%@:=,-]+)$/;
/** Strip a pasted prompt character so ` $ ls` still counts as a command. */
function stripTermPrompt(raw) {
	let text = raw.replace(/\r\n/g, "\n").trim();
	text = stripPromptPrefix(text);
	if (text.startsWith("`") && text.endsWith("`") || text.startsWith("\"") && text.endsWith("\"")) text = text.slice(1, -1).trim();
	return text;
}
function stripPromptPrefix(text) {
	const stripped = text.replace(PROMPT_PREFIX, "");
	if (stripped !== text) return stripped;
	if (!text.includes("\n") && HASH_PROMPT.test(text)) return text.replace(HASH_PROMPT, "");
	return text;
}
function firstToken(text) {
	return (text.split(/[\s;|&<>]+/, 1)[0] ?? "").replace(/^\(+/, "").toLowerCase();
}
function isQuestion(text) {
	if (ASK_EN.test(text) || ASK_CJK.test(text)) return true;
	if (text.includes("？")) return true;
	if (/\?\s*$/.test(text) && !text.startsWith("[")) return true;
	return false;
}
function restLooksLikeArgv(text) {
	const words = text.split(/\s+/).filter(Boolean);
	if (words.length <= 1) return true;
	if (/[|;&><]/.test(text)) return true;
	const token = firstToken(text);
	if (token === "echo" || token === "printf") return true;
	const rest = words.slice(1);
	if (rest.some((word) => PROSE_WORD.test(word))) return false;
	if (CJK.test(text)) return false;
	return rest.every((word) => ARGV_TOKEN.test(word));
}
/**
* Heuristic: a real argv line goes straight to the PTY.
* Anything that reads as a request is sent to the model.
* First-token allowlist is not enough: `sort by disk usage` starts with `sort`
* but is English, not `sort(1)` flags.
*/
function classifyTermAssistInput(raw) {
	const text = stripTermPrompt(raw);
	if (text === "") return "ask";
	if (isQuestion(text)) return "ask";
	const token = firstToken(text);
	const known = KNOWN_SHELL_COMMANDS.has(token) || token.endsWith(".sh") || token.endsWith(".bash");
	if (CJK.test(text) && !known) return "ask";
	if (known) return restLooksLikeArgv(text) ? "run" : "ask";
	if (PATH_START.test(text) || ENV_ASSIGN.test(text)) return "run";
	return "ask";
}
/**
* Hard veto when an enabled blacklist rule matches.
* Ordinary `rm file` is not blocked unless the user adds a rule for it.
*/
function looksDestructiveCommand(command, prefs) {
	const text = command.trim();
	if (text === "") return false;
	const p = resolveTermAssistPrefs(prefs);
	if (!p.blockDestructive) return false;
	return commandMatchesBlacklist(text, p.blacklist);
}
/** Chinese PTY note when assist refuses a destructive command. Secrets already redacted. */
function destructiveAssistNote(command) {
	const shown = redactSecrets(command.trim().replace(/\s+/g, " "));
	const clip = shown.length > 160 ? `${shown.slice(0, 159)}…` : shown;
	return [
		"已拒绝执行：命令命中助手黑名单，AI 助手不会代为执行，以免误删文件或系统。",
		clip === "" ? "" : `拦截：${clip}`,
		"如确需操作，请在下方终端自行核对路径后手动输入。黑名单可在齿轮设置里增删。"
	].filter((line) => line !== "").join("\n");
}
function sanitizeAssistCommand(raw) {
	let text = raw.replace(/\r\n/g, "\n").trim();
	const fenced = /^```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)\n```$/m.exec(text);
	if (fenced?.[1] !== void 0) text = fenced[1].trim();
	text = text.replace(/^```(?:[a-zA-Z0-9_-]+)?\r?\n?/, "").replace(/\n```[ \t]*$/, "").trim();
	text = text.replace(/^["'`]+|["'`]+$/g, "").trim();
	text = stripPromptPrefix(text);
	if (text.length > 4e3) text = text.slice(0, MAX_TERM_ASSIST_INPUT).trim();
	return text;
}
/** Live preview: hide unfinished fences so the bar fills with real words. */
function previewAssistText(raw) {
	let text = raw.replace(/\r\n/g, "\n");
	text = text.replace(/^```(?:[a-zA-Z0-9_-]+)?\r?\n?/, "");
	text = text.replace(/\n```[ \t]*$/, "");
	text = stripPromptPrefix(text);
	if (text.length > 4e3) text = text.slice(0, MAX_TERM_ASSIST_INPUT);
	return text;
}
function stripAskPrefix(text) {
	return text.replace(ASK_LINE, "").trim();
}
function unwrapSpokenEcho(command) {
	const m = /^(echo|printf)\s+(?:-[nEe]+\s+)*(.*)$/.exec(command.trim());
	if (m === null) return null;
	if (m[1] === "printf" && /%[a-zA-Z]/.test(command)) return null;
	const rest = m[2].trim();
	if (rest === "" || /[;|&<>`$()]/.test(rest)) return null;
	const unquoted = rest.replace(/^(['"])([\s\S]*)\1$/, "$2");
	if (GREETING.test(unquoted)) return unquoted;
	if (/\s/.test(unquoted) && /[A-Za-z\u3400-\u9fff]/.test(unquoted) && !unquoted.startsWith("-")) return unquoted;
	return null;
}
function isSpokenReply(text) {
	if (GREETING.test(text)) return true;
	if (ASK_EN.test(text) || ASK_CJK.test(text)) return true;
	if (/[.!?。！？]/.test(text) && text.split(/\s+/).length >= 3) return true;
	return false;
}
/**
* Model output: known argv / path / env assignment → command.
* Greetings, prose, and lone unknown tokens → comment (never executed).
*/
function looksLikeModelCommand(text) {
	if (classifyTermAssistInput(text) === "run") return unwrapSpokenEcho(text) === null;
	if (isSpokenReply(text) || unwrapSpokenEcho(text) !== null) return false;
	const words = text.split(/\s+/).filter(Boolean);
	if (words.length <= 1) return false;
	if (CJK.test(text)) return false;
	return /^[A-Za-z0-9._+-]+(\s+(-{1,2}[\w.-]+|\S+))*$/.test(text) && words.length <= 8;
}
function parseAssistOutput(raw, prefs) {
	const text = sanitizeAssistCommand(raw);
	if (text === "") return { kind: "empty" };
	if (ASK_LINE.test(text)) {
		const note = stripAskPrefix(text);
		return {
			kind: "ask",
			note: note === "" ? text : note
		};
	}
	const lines = text.split("\n").map((line) => line.trim()).filter((line) => line !== "");
	const comments = [];
	let commandLine;
	for (const line of lines) {
		if (commandLine === void 0 && line.startsWith("#")) {
			const body = line.replace(/^\s*#+\s?/, "").trim();
			if (body !== "") comments.push(body);
			continue;
		}
		if (commandLine === void 0) {
			commandLine = line;
			continue;
		}
		break;
	}
	const explain = comments[0] ?? "";
	if (commandLine === void 0) {
		if (comments.length === 0) return { kind: "empty" };
		return {
			kind: "ask",
			note: comments.join("\n")
		};
	}
	if (ASK_LINE.test(commandLine)) {
		const note = stripAskPrefix(commandLine);
		return {
			kind: "ask",
			note: note === "" ? commandLine : note
		};
	}
	const command = commandLine.replace(PROMPT_PREFIX, "").trim();
	if (command === "") return { kind: "empty" };
	const spoken = unwrapSpokenEcho(command);
	if (spoken !== null) return {
		kind: "ask",
		note: spoken
	};
	if (looksDestructiveCommand(command, prefs)) return {
		kind: "ask",
		note: destructiveAssistNote(command)
	};
	if (looksLikeModelCommand(command)) return {
		kind: "command",
		command,
		explain
	};
	if (comments.length > 0) return {
		kind: "ask",
		note: [...comments, command].join("\n")
	};
	return {
		kind: "ask",
		note: text
	};
}
function clipAssistInput(raw) {
	const text = raw.replace(/\r\n/g, "\n").trim();
	return text.length > 4e3 ? text.slice(0, MAX_TERM_ASSIST_INPUT) : text;
}
function clipAssistTranscript(raw) {
	const text = redactSecrets(raw.replace(/\r\n/g, "\n").trim());
	if (text.length <= 6e3) return text;
	return text.slice(text.length - MAX_TERM_ASSIST_TRANSCRIPT);
}
function buildTermAssistUserPrompt(input) {
	const parts = ["请根据下面的用户输入给出命令或 ASK 说明。"];
	if (input.cwd !== void 0 && input.cwd !== "") parts.push("", `工作目录：${input.cwd}`);
	const transcript = input.transcript === void 0 ? "" : clipAssistTranscript(input.transcript);
	if (transcript !== "") parts.push("", "最近终端输出：", transcript);
	parts.push("", "用户输入：", clipAssistInput(input.text));
	return parts.join("\n");
}
//#endregion
//#region src/shared/term-assist-prompt.ts
const MAX_TERM_ASSIST_TEMPLATE_CHARS = 4e3;
const DEFAULT_TERM_ASSIST_TEMPLATE_ZH = [
	"你是工作区终端助手。用户可能输入 shell 命令、描述要做的事，也可能只是打招呼或提问。",
	"先判断输出类型，再按下面的格式只输出一种结果：",
	"A. 要执行一条命令：先写一行井号注释（一句话说明对应哪句用户输入），下一行再写命令本身。不要 Markdown，不要 $ 前缀。例如：",
	"# 列出当前目录",
	"ls -la",
	"B. 不能当命令执行的内容（问候、闲聊、知识回答、缺信息、风险说明）：不要输出命令，输出",
	"ASK: <回答正文>",
	"规则：",
	"1. 问候或闲聊（例如 hello、你好、谢谢）必须走 B，禁止输出 echo/printf 或任何会报 command not found 的词。",
	"2. 注释必须是一行，写清「用户想做什么」。不要把注释写成可执行命令。不要输出分隔线。",
	"3. 语言必须跟用户输入一致：输入含中文（含中英夹杂）就用中文写注释和 ASK；输入是英文就用英文。不要中英混写回答。",
	"4. 不要编造不存在的文件或参数；优先用当前工作目录里能跑的命令。",
	"5. 不要输出 rm -rf、mkfs、reboot、fork bomb 等破坏性命令；这类请求走 B，说明风险。即使用户直接粘贴了这类命令，也不要原样回显成可执行行。",
	"6. 若输入已经是完整命令，注释用用户原文（语言仍跟用户一致），下一行原样输出该命令。",
	"7. 文件名、参数保持原文。"
].join("\n");
[
	"You are a workspace terminal assistant. The user may type a shell command, describe a task, or just greet you / ask a question.",
	"Decide the output type, then emit exactly one of:",
	"A. To run a command: first one hash comment (one line summarizing the user request), then the command itself. No Markdown, no $ prefix. Example:",
	"# list files in the current directory",
	"ls -la",
	"B. Anything that must not run as a command (greeting, chit-chat, a knowledge answer, missing facts, a warning): do not emit a command; output",
	"ASK: <the reply>",
	"Rules:",
	"1. Greetings and small talk (hello, hi, thanks) MUST use B. Do not emit echo/printf or any token that would print command not found.",
	"2. The comment must be one line stating what they asked for. Do not make the comment itself executable. Do not emit a separator line.",
	"3. Match the user’s language: if the input contains Chinese (including mixed Chinese/English), write the comment and ASK in Chinese; if the input is English, write them in English. Do not mix languages in the reply.",
	"4. Do not invent files or flags. Prefer commands that work in the current working directory.",
	"5. Never emit destructive commands (rm -rf, mkfs, reboot, fork bomb). Use B and state the risk. Even if the user pasted such a command, do not echo it as a runnable line.",
	"6. If the input is already a complete command, comment with the user’s text (same language) and echo the command unchanged.",
	"7. Keep file names and flags as written."
].join("\n");
[
	"你是工作区终端助手。用户可能输入 shell 命令、描述要做的事，也可能只是打招呼或提问。",
	"先判断输出类型，再按下面的格式只输出一种结果：",
	"A. 要执行一条命令：先写一行井号注释（一句话说明对应哪句用户输入），下一行再写命令本身。不要 Markdown，不要 $ 前缀。例如：",
	"# 列出当前目录",
	"ls -la",
	"B. 不能当命令执行的内容（问候、闲聊、知识回答、缺信息、风险说明）：不要输出命令，输出",
	"ASK: <回答正文>",
	"规则：",
	"1. 问候或闲聊（例如 hello、你好、谢谢）必须走 B，禁止输出 echo/printf 或任何会报 command not found 的词。",
	"2. 注释必须是一行，写清「用户想做什么」。不要把注释写成可执行命令。不要输出分隔线。",
	"3. 语言必须跟用户输入一致：输入含中文（含中英夹杂）就用中文写注释和 ASK；输入是英文就用英文。不要中英混写回答。",
	"4. 不要编造不存在的文件或参数；优先用当前工作目录里能跑的命令。",
	"5. 不要输出 rm -rf、mkfs、reboot、fork bomb 等破坏性命令；这类请求走 B，说明风险。",
	"6. 若输入已经是完整命令，注释用用户原文（语言仍跟用户一致），下一行原样输出该命令。",
	"7. 文件名、参数保持原文。"
].join("\n"), [
	"You are a workspace terminal assistant. The user may type a shell command, describe a task, or just greet you / ask a question.",
	"Decide the output type, then emit exactly one of:",
	"A. To run a command: first one hash comment (one line summarizing the user request), then the command itself. No Markdown, no $ prefix. Example:",
	"# list files in the current directory",
	"ls -la",
	"B. Anything that must not run as a command (greeting, chit-chat, a knowledge answer, missing facts, a warning): do not emit a command; output",
	"ASK: <the reply>",
	"Rules:",
	"1. Greetings and small talk (hello, hi, thanks) MUST use B. Do not emit echo/printf or any token that would print command not found.",
	"2. The comment must be one line stating what they asked for. Do not make the comment itself executable. Do not emit a separator line.",
	"3. Match the user’s language: if the input contains Chinese (including mixed Chinese/English), write the comment and ASK in Chinese; if the input is English, write them in English. Do not mix languages in the reply.",
	"4. Do not invent files or flags. Prefer commands that work in the current working directory.",
	"5. Never emit destructive commands (rm -rf, mkfs, reboot, fork bomb). Use B and state the risk.",
	"6. If the input is already a complete command, comment with the user’s text (same language) and echo the command unchanged.",
	"7. Keep file names and flags as written."
].join("\n"), [
	"你是工作区终端助手。用户可能输入 shell 命令、描述要做的事，也可能只是打招呼或提问。",
	"先判断输出类型，再按下面的格式只输出一种结果：",
	"A. 要执行一条命令：先写一行井号注释（一句话说明对应哪句用户输入），下一行再写命令本身。不要 Markdown，不要 $ 前缀。例如：",
	"# 列出当前目录",
	"ls -la",
	"B. 不能当命令执行的内容（问候、闲聊、知识回答、缺信息、风险说明）：不要输出命令，输出",
	"ASK: <回答正文>",
	"规则：",
	"1. 问候或闲聊（例如 hello、你好、谢谢）必须走 B，禁止输出 echo/printf 或任何会报 command not found 的词。",
	"2. 注释必须是一行、用用户的语言，写清「用户想做什么」；不要把注释写成可执行命令。",
	"3. 不要编造不存在的文件或参数；优先用当前工作目录里能跑的命令。",
	"4. 不要输出 rm -rf、mkfs、reboot、fork bomb 等破坏性命令；这类请求走 B，说明风险。",
	"5. 若输入已经是完整命令，注释用用户原文，下一行原样输出该命令。",
	"6. 文件名、参数保持原文。B 的正文用用户的语言。"
].join("\n"), [
	"You are a workspace terminal assistant. The user may type a shell command, describe a task, or just greet you / ask a question.",
	"Decide the output type, then emit exactly one of:",
	"A. To run a command: first one hash comment (one line summarizing the user request), then the command itself. No Markdown, no $ prefix. Example:",
	"# list files in the current directory",
	"ls -la",
	"B. Anything that must not run as a command (greeting, chit-chat, a knowledge answer, missing facts, a warning): do not emit a command; output",
	"ASK: <the reply>",
	"Rules:",
	"1. Greetings and small talk (hello, hi, thanks) MUST use B. Do not emit echo/printf or any token that would print command not found.",
	"2. The comment must be one line, in the user’s language, stating what they asked for. Do not make the comment itself executable.",
	"3. Do not invent files or flags. Prefer commands that work in the current working directory.",
	"4. Never emit destructive commands (rm -rf, mkfs, reboot, fork bomb). Use B and state the risk.",
	"5. If the input is already a complete command, comment with the user’s text and echo the command unchanged.",
	"6. Keep file names and flags as written. Write B in the same language as the user."
].join("\n"), [
	"你是工作区终端助手。用户可能输入 shell 命令、描述要做的事，也可能只是打招呼或提问。",
	"先判断输出类型，再按下面的格式只输出一种结果：",
	"A. 可在 bash/zsh 里直接执行的一条命令：只输出命令本身。不要解释、不要 Markdown、不要 $ 前缀。",
	"B. 不能当命令执行的内容（问候、闲聊、知识回答、缺信息、风险说明）：输出",
	"ASK: <回答正文>",
	"规则：",
	"1. 问候或闲聊（例如 hello、你好、谢谢）必须走 B，禁止输出 echo/printf 或任何会报 command not found 的词。",
	"2. 不要编造不存在的文件或参数；优先用当前工作目录里能跑的命令。",
	"3. 不要输出 rm -rf、mkfs、reboot、fork bomb 等破坏性命令；这类请求走 B，说明风险。",
	"4. 若输入已经是完整命令，原样输出该命令（走 A）。",
	"5. 文件名、参数保持原文。B 的正文用用户的语言。"
].join("\n"), [
	"You are a workspace terminal assistant. The user may type a shell command, describe a task, or just greet you / ask a question.",
	"Decide the output type, then emit exactly one of:",
	"A. One command that can run in bash/zsh as-is: output only the command. No explanation, no Markdown, no $ prefix.",
	"B. Anything that must not run as a command (greeting, chit-chat, a knowledge answer, missing facts, a warning): output",
	"ASK: <the reply>",
	"Rules:",
	"1. Greetings and small talk (hello, hi, thanks) MUST use B. Do not emit echo/printf or any token that would print command not found.",
	"2. Do not invent files or flags. Prefer commands that work in the current working directory.",
	"3. Never emit destructive commands (rm -rf, mkfs, reboot, fork bomb). Use B and state the risk.",
	"4. If the input is already a complete command, echo it unchanged (A).",
	"5. Keep file names and flags as written. Write B in the same language as the user."
].join("\n");
/** Host fallback when the client sends nothing. UI should send the locale default. */
const DEFAULT_TERM_ASSIST_TEMPLATE = DEFAULT_TERM_ASSIST_TEMPLATE_ZH;
/** Empty / oversized / non-string input falls back to the built-in Chinese template. */
function resolveTermAssistTemplate(raw, fallback = DEFAULT_TERM_ASSIST_TEMPLATE) {
	if (typeof raw !== "string") return fallback;
	const trimmed = raw.replace(/\r\n/g, "\n").trim();
	if (trimmed === "") return fallback;
	return trimmed.length > 4e3 ? trimmed.slice(0, MAX_TERM_ASSIST_TEMPLATE_CHARS).trim() : trimmed;
}
//#endregion
//#region src/host/term-assist.ts
const GENERATE_TIMEOUT_MS = 3e4;
const ASSIST_MAX_TOKENS = 512;
const PLUGIN_SOURCE = {
	kind: "plugin",
	plugin: "dsh-workbench-plugin"
};
function readLlm$1(ctx) {
	const llm = ctx.llm ?? ctx.get("llm");
	if (llm === void 0 || typeof llm.stream !== "function" || typeof llm.listProviders !== "function") throw new GitError("LLM_UNAVAILABLE");
	return llm;
}
function readPreferredRoute(ctx) {
	const selection = (ctx.agentDefaultModel ?? ctx.get("agentDefaultModel"))?.currentSelection?.();
	if (typeof selection?.provider === "string" && selection.provider !== "" && typeof selection.model === "string" && selection.model !== "") return {
		provider: selection.provider,
		model: selection.model
	};
}
async function resolveRoute$1(ctx) {
	const llm = readLlm$1(ctx);
	const providers = llm.listProviders();
	const preferred = readPreferredRoute(ctx);
	if (preferred !== void 0 && providers.some((provider) => provider.id === preferred.provider)) return preferred;
	const models = {};
	for (const provider of providers) try {
		models[provider.id] = await llm.listModels(provider.id);
	} catch {
		models[provider.id] = [];
	}
	return pickCommitRoute(providers, models, preferred);
}
async function resolveReasoningEffort(llm, route, signal) {
	if (typeof llm.resolveModelInfo !== "function") return "off";
	try {
		return pickCommitReasoningEffort(await llm.resolveModelInfo(route.provider, route.model, signal));
	} catch {
		return;
	}
}
function buildUserMessage(text) {
	return {
		id: crypto.randomUUID(),
		role: "user",
		content: [{
			type: "text",
			text
		}],
		source: PLUGIN_SOURCE
	};
}
function summarizeTypes(types) {
	if (types.length === 0) return "没有任何数据";
	const counts = /* @__PURE__ */ new Map();
	for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);
	return [...counts.entries()].map(([type, count]) => `${type}×${count}`).join("，");
}
function assistAssembleResult(state) {
	const text = commitAssembleText(state);
	const trace = summarizeTypes(state.types);
	if (state.fail !== "") {
		const code = state.failCode === "" ? "" : ` [${state.failCode}]`;
		return {
			text,
			fail: `${state.fail}${code}（${trace}）`
		};
	}
	if (parseAssistOutput(text).kind !== "empty") return {
		text,
		fail: ""
	};
	if (state.types.length === 0) return {
		text,
		fail: "模型接口没有返回任何数据。请确认会话里已经配好模型，然后重试。"
	};
	if (state.finishKind === "max-tokens") return {
		text,
		fail: state.sawReasoning ? `模型把输出额度用在了思考过程上，没有写出命令。（${trace}）` : `模型输出被截断，没有完整命令。（${trace}）`
	};
	if (state.sawReasoning) return {
		text,
		fail: `模型只返回了思考过程，没有写出命令。（${trace}）`
	};
	if (state.finishKind === "") return {
		text,
		fail: `模型调用没有正常结束。（${trace}）`
	};
	return {
		text,
		fail: `模型没有返回可用的命令。（${trace}）`
	};
}
/** Stream a shell command (or ASK note) as the model writes it. */
async function* streamTermAssist(ctx, options) {
	const text = clipAssistInput(options.text);
	if (text === "") throw new GitError("LLM_FAILED", "请先输入命令，或用一句话描述你想做什么。");
	const signal = options.signal;
	const system = resolveTermAssistTemplate(options.template, DEFAULT_TERM_ASSIST_TEMPLATE);
	const llm = readLlm$1(ctx);
	const route = await resolveRoute$1(ctx);
	const reasoningEffort = await resolveReasoningEffort(llm, route, signal);
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, GENERATE_TIMEOUT_MS);
	const onAbort = () => {
		controller.abort();
	};
	signal?.addEventListener("abort", onAbort);
	const user = buildTermAssistUserPrompt({
		text,
		cwd: options.cwd,
		transcript: options.transcript === void 0 ? void 0 : clipAssistTranscript(options.transcript)
	});
	try {
		const state = createCommitAssemble();
		let last = "";
		for await (const chunk of llm.stream({
			provider: route.provider,
			model: route.model,
			system,
			messages: [buildUserMessage(user)],
			maxTokens: ASSIST_MAX_TOKENS,
			temperature: .1,
			purpose: "session-title",
			...reasoningEffort === void 0 ? {} : { reasoningEffort },
			signal: controller.signal
		})) {
			if (controller.signal.aborted) break;
			applyCommitChunk(state, chunk);
			const visible = previewAssistText(previewCommitMessage(commitAssembleText(state)));
			if (visible !== last) {
				last = visible;
				yield {
					type: "delta",
					text: redactSecrets(visible)
				};
			}
		}
		if (signal?.aborted) throw new GitError("LLM_FAILED", "生成已取消。");
		const assembled = assistAssembleResult(state);
		if (assembled.fail !== "") throw new GitError("LLM_FAILED", `${assembled.fail} 路由：${route.provider} / ${route.model}`);
		yield {
			type: "done",
			message: redactSecrets(sanitizeDone(assembled.text, options.prefs))
		};
	} catch (error) {
		if (error instanceof GitError) throw error;
		if (controller.signal.aborted) throw new GitError("LLM_FAILED", signal?.aborted ? "生成已取消。" : "生成超时或已取消，请稍后重试。");
		throw new GitError("LLM_FAILED", error instanceof Error ? error.message : String(error));
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}
function sanitizeDone(raw, prefs) {
	const parsed = parseAssistOutput(raw, resolveTermAssistPrefs(prefs));
	if (parsed.kind === "command") return parsed.explain === "" ? parsed.command : `# ${parsed.explain}\n${parsed.command}`;
	if (parsed.kind === "ask") return `ASK: ${parsed.note}`;
	return previewAssistText(raw).trim();
}
//#endregion
//#region src/host/git-nearby.ts
/** True when this directory itself has a `.git` file or folder (does not walk up). */
async function hasGitRoot(dir) {
	try {
		const info = await stat(join(dir, ".git"));
		return info.isDirectory() || info.isFile();
	} catch {
		return false;
	}
}
async function realOrSelf(dir) {
	try {
		return await realpath(dir);
	} catch {
		return dir;
	}
}
function childIdOf(id) {
	const parsed = parseNearbyRepoId(id);
	return parsed?.kind === "child" ? parsed.child ?? null : null;
}
/**
* Resolve a workspace-relative folder / symlink / submodule to its git cwd.
* The id must stay a safe relative path under the workspace; the target may
* sit outside when the workspace entry itself is a symlink.
*/
async function resolveChildGitPath(workspace, id) {
	const child = childIdOf(id);
	if (child === null) return null;
	let rel;
	try {
		rel = assertSafeWorkspacePath(workspace, child);
	} catch {
		return null;
	}
	if (rel === "") return null;
	try {
		return await realpath(join(workspace, rel));
	} catch {
		return null;
	}
}
async function classifyChild(workspace, id) {
	const child = childIdOf(id);
	if (child === null) return null;
	let rel;
	try {
		rel = assertSafeWorkspacePath(workspace, child);
	} catch {
		return null;
	}
	if (rel === "") return null;
	const full = join(workspace, rel);
	const real = await resolveChildGitPath(workspace, rel);
	if (real === null) return null;
	if (!await hasGitRoot(real)) return null;
	let kind = "child";
	try {
		if ((await lstat(full)).isSymbolicLink()) kind = "link";
		else if ((await lstat(join(real, ".git"))).isFile()) kind = "submodule";
	} catch {
		kind = "child";
	}
	return {
		id: rel,
		kind,
		name: rel.includes("/") ? rel : folderNameFromPath(rel) || rel,
		isRepo: true
	};
}
/** `path =` entries from `.gitmodules`. Ignores comments and unknown keys. */
function parseGitmodulePaths(text) {
	const paths = [];
	const seen = /* @__PURE__ */ new Set();
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
		const match = /^path\s*=\s*(.+)$/.exec(line);
		if (match === null) continue;
		let value = match[1].trim();
		if (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2 || value.startsWith("'") && value.endsWith("'") && value.length >= 2) value = value.slice(1, -1);
		if (value === "" || seen.has(value)) continue;
		seen.add(value);
		paths.push(value);
	}
	return paths;
}
async function submodulePaths(workspace) {
	try {
		return parseGitmodulePaths(await readFile(join(workspace, ".gitmodules"), "utf8"));
	} catch {
		return [];
	}
}
async function scanNearbyGit(workspace, signal) {
	const root = await realOrSelf(workspace);
	const workspaceName = folderNameFromPath(root) || basename(root) || root;
	const current = {
		id: ".",
		kind: "current",
		name: workspaceName,
		isRepo: await hasGitRoot(root)
	};
	let parent = null;
	const parentDir = dirname(root);
	if (parentDir !== root && parentDir !== "") {
		if (signal?.aborted) return {
			workspaceName,
			current,
			parent: null,
			children: []
		};
		if (await hasGitRoot(parentDir)) parent = {
			id: "..",
			kind: "parent",
			name: folderNameFromPath(parentDir) || parentDir,
			isRepo: true
		};
	}
	const childrenById = /* @__PURE__ */ new Map();
	const consider = async (id) => {
		if (signal?.aborted) return;
		const found = await classifyChild(root, id);
		if (found === null || childrenById.has(found.id)) return;
		childrenById.set(found.id, found);
	};
	let names = [];
	try {
		names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => entry.name);
	} catch {
		names = [];
	}
	for (const name of names) {
		if (signal?.aborted) break;
		if (isSkippedChildName(name)) continue;
		await consider(name);
	}
	for (const path of await submodulePaths(root)) {
		if (signal?.aborted) break;
		await consider(path);
	}
	const children = [...childrenById.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
	return {
		workspaceName,
		current,
		parent,
		children
	};
}
/**
* Resolve a nearby-repo id to an absolute git cwd.
* `undefined` / `.` → workspace. `..` → parent only if it is a git root.
* Any other id must be a child folder, symlink, or registered submodule that is a git root.
*/
async function resolveNearbyGitPath(workspace, repoId) {
	const parsed = parseNearbyRepoId(repoId);
	if (parsed === null) throw new GitError("UNKNOWN_REPO");
	const root = await realOrSelf(workspace);
	if (parsed.kind === "current") return root;
	if (parsed.kind === "parent") {
		const parentDir = dirname(root);
		if (parentDir === root || parentDir === "") throw new GitError("UNKNOWN_REPO");
		if (!await hasGitRoot(parentDir)) throw new GitError("UNKNOWN_REPO");
		return realOrSelf(parentDir);
	}
	const child = parsed.child;
	if (child === void 0) throw new GitError("UNKNOWN_REPO");
	const found = await classifyChild(root, child);
	if (found === null) throw new GitError("UNKNOWN_REPO");
	const real = await resolveChildGitPath(root, found.id);
	if (real === null) throw new GitError("UNKNOWN_REPO");
	return real;
}
//#endregion
//#region src/host/workspace.ts
function readWorkspaceRegistry(ctx) {
	return ctx.get("workspaceRegistry");
}
/** Resolve a workspace directory. Prefer an explicit id, then a single registered workspace. */
function resolveWorkspacePath(ctx, workspaceId, fallbackCwd) {
	const registry = readWorkspaceRegistry(ctx);
	if (workspaceId !== void 0 && workspaceId !== "") {
		const found = registry?.get(workspaceId);
		if (found === void 0) throw new GitError("UNKNOWN_WORKSPACE");
		return found.path;
	}
	const listed = registry?.list() ?? [];
	if (listed.length === 1) return listed[0].path;
	if (fallbackCwd !== void 0 && fallbackCwd !== "") return fallbackCwd;
	if (listed.length === 0) throw new GitError("NO_WORKSPACE");
	throw new GitError("NO_WORKSPACE");
}
//#endregion
//#region src/shared/types.ts
const EXTERNAL_EDITOR_IDS = [
	"cursor",
	"vscode",
	"vscode-insiders",
	"codium",
	"windsurf",
	"zed",
	"system"
];
function isExternalEditorId(value) {
	return typeof value === "string" && EXTERNAL_EDITOR_IDS.includes(value);
}
//#endregion
//#region src/host/external-open.ts
const CATALOG = [
	{
		id: "cursor",
		label: "Cursor",
		bins: {
			linux: ["cursor"],
			darwin: ["cursor"],
			win32: ["cursor.cmd", "cursor"]
		}
	},
	{
		id: "vscode",
		label: "VS Code",
		bins: {
			linux: ["code"],
			darwin: ["code"],
			win32: ["code.cmd", "code"]
		}
	},
	{
		id: "vscode-insiders",
		label: "VS Code Insiders",
		bins: {
			linux: ["code-insiders"],
			darwin: ["code-insiders"],
			win32: ["code-insiders.cmd", "code-insiders"]
		}
	},
	{
		id: "codium",
		label: "VSCodium",
		bins: {
			linux: ["codium"],
			darwin: ["codium"],
			win32: ["codium.cmd", "codium"]
		}
	},
	{
		id: "windsurf",
		label: "Windsurf",
		bins: {
			linux: ["windsurf"],
			darwin: ["windsurf"],
			win32: ["windsurf.cmd", "windsurf"]
		}
	},
	{
		id: "zed",
		label: "Zed",
		bins: {
			linux: ["zed", "zeditor"],
			darwin: ["zed"],
			win32: ["zed.exe", "zed"]
		}
	},
	{
		id: "system",
		label: "System",
		bins: {
			linux: ["xdg-open"],
			darwin: ["open"],
			win32: ["explorer.exe"]
		}
	}
];
const SETTLE_MS = 600;
const WSL_EXPLORER_PATHS = ["/mnt/c/Windows/explorer.exe", "/mnt/c/WINDOWS/explorer.exe"];
/** WSL userland only. Do not use the kernel osrelease — containers on WSL share it. */
function detectWsl(platform, env = process.env) {
	if (platform !== "linux") return false;
	return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP || env.WSLENV);
}
/** Best-effort WSL → Windows path when `wslpath` is missing. */
function wslToWindowsPath(abs, distro = "") {
	const driveRest = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(abs);
	if (driveRest?.[1] !== void 0) {
		const rest = (driveRest[2] ?? "").replace(/\//g, "\\");
		return rest === "" ? `${driveRest[1].toUpperCase()}:\\` : `${driveRest[1].toUpperCase()}:\\${rest}`;
	}
	const driveOnly = /^\/mnt\/([a-zA-Z])\/?$/.exec(abs);
	if (driveOnly?.[1] !== void 0) return `${driveOnly[1].toUpperCase()}:\\`;
	if (distro === "") return void 0;
	return `\\\\wsl.localhost\\${distro}${(abs.startsWith("/") ? abs : `/${abs}`).replace(/\//g, "\\")}`;
}
function binsFor(spec, platform) {
	return spec.bins[platform] ?? spec.bins.linux ?? [];
}
function looksLikeBareName(bin) {
	return /^[A-Za-z0-9._-]+$/.test(bin);
}
/** Resolve a catalog binary on PATH. Never accepts a user-supplied command string. */
async function whichOnPath(bin, envPath = process.env.PATH ?? "") {
	if (!looksLikeBareName(bin)) return void 0;
	const dirs = envPath.split(delimiter).filter((dir) => dir !== "");
	const win = process.platform === "win32";
	const names = win && !bin.includes(".") ? [
		bin,
		`${bin}.cmd`,
		`${bin}.exe`
	] : [bin];
	const mode = win ? constants.F_OK : constants.X_OK;
	for (const dir of dirs) for (const name of names) {
		const full = join(dir, name);
		try {
			await access(full, mode);
			return full;
		} catch {}
	}
}
function launchDetached(bin, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, [...args], {
			detached: true,
			stdio: "ignore",
			windowsHide: true,
			env: process.env
		});
		let settled = false;
		const finish = (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) {
				reject(error);
				return;
			}
			child.unref();
			resolve();
		};
		const timer = setTimeout(() => {
			finish();
		}, SETTLE_MS);
		child.on("error", (error) => {
			finish(error.code === "ENOENT" ? new GitError("EDITOR_NOT_FOUND") : new GitError("EDITOR_FAILED"));
		});
		child.on("exit", (code) => {
			if (code === 0 || code === null) {
				finish();
				return;
			}
			finish(new GitError("EDITOR_FAILED"));
		});
	});
}
function captureOutput(bin, args, timeoutMs = 8e3) {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, [...args], {
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			],
			env: process.env
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(/* @__PURE__ */ new Error("timeout"));
		}, timeoutMs);
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) {
				resolve(stdout.trim());
				return;
			}
			reject(new Error(stderr.trim() || `exit ${code ?? 1}`));
		});
	});
}
async function defaultWslWindowsPath(abs) {
	try {
		const converted = await captureOutput("wslpath", ["-w", abs]);
		if (converted !== "") return converted;
	} catch {}
	const fallback = wslToWindowsPath(abs, process.env.WSL_DISTRO_NAME ?? "");
	if (fallback === void 0) throw new GitError("FS_REVEAL_FAILED");
	return fallback;
}
/** Detect allowlisted local editors and open a workspace-jailed path in one of them. */
var ExternalOpen = class {
	fs;
	deps;
	constructor(fs, deps = {}) {
		this.fs = fs;
		this.deps = deps;
	}
	platform() {
		return this.deps.platform ?? process.platform;
	}
	isWsl() {
		if (this.deps.isWsl !== void 0) return this.deps.isWsl;
		return detectWsl(this.platform());
	}
	async windowsPath(abs) {
		if (this.deps.toWindowsPath !== void 0) return this.deps.toWindowsPath(abs);
		return defaultWslWindowsPath(abs);
	}
	async resolveExplorer(lookup) {
		const fromPath = await lookup("explorer.exe") ?? await lookup("explorer");
		if (fromPath !== void 0) return fromPath;
		if (this.deps.which !== void 0) return void 0;
		for (const full of WSL_EXPLORER_PATHS) try {
			await access(full, constants.X_OK);
			return full;
		} catch {}
	}
	async runReveal(launch, bin, args, ignoreNonZero) {
		try {
			await launch(bin, args);
		} catch (error) {
			if (ignoreNonZero && error instanceof GitError && error.code === "EDITOR_FAILED") return;
			throw new GitError("FS_REVEAL_FAILED");
		}
	}
	async resolveBin(spec) {
		const lookup = this.deps.which ?? whichOnPath;
		for (const bin of binsFor(spec, this.platform())) {
			const found = await lookup(bin);
			if (found !== void 0) return found;
		}
	}
	async list() {
		const editors = [];
		for (const spec of CATALOG) editors.push({
			id: spec.id,
			label: spec.label,
			available: await this.resolveBin(spec) !== void 0
		});
		return { editors };
	}
	async open(root, filePath = "", app) {
		const spec = await this.pickSpec(app);
		const bin = await this.resolveBin(spec);
		if (bin === void 0) throw new GitError("EDITOR_NOT_FOUND");
		const abs = await this.fs.resolveAbsolute(root, filePath);
		await (this.deps.launch ?? launchDetached)(bin, [abs]);
		return {
			app: spec.id,
			path: filePath.trim() === "." ? "" : filePath.trim()
		};
	}
	/** Open the system file manager at this workspace path (Finder / Explorer / Files). WSL uses Windows Explorer. */
	async reveal(root, filePath = "") {
		const abs = await this.fs.resolveAbsolute(root, filePath);
		const lookup = this.deps.which ?? whichOnPath;
		const launch = this.deps.launch ?? launchDetached;
		const platform = this.platform();
		const rel = filePath.trim() === "." ? "" : filePath.trim();
		const wsl = platform === "linux" && this.isWsl();
		if (platform === "darwin") {
			const bin = await lookup("open");
			if (bin === void 0) throw new GitError("FS_REVEAL_FAILED");
			await this.runReveal(launch, bin, ["-R", abs], false);
			return { path: rel };
		}
		if (platform === "win32" || wsl) {
			const explorer = await this.resolveExplorer(lookup);
			if (explorer !== void 0) {
				const target = wsl ? await this.windowsPath(abs) : abs;
				await this.runReveal(launch, explorer, [`/select,${target}`], true);
				return { path: rel };
			}
			if (!wsl) throw new GitError("FS_REVEAL_FAILED");
		}
		const bin = await lookup("xdg-open");
		if (bin === void 0) throw new GitError("FS_REVEAL_FAILED");
		let target = abs;
		try {
			if (!(await stat(abs)).isDirectory()) target = dirname(abs);
		} catch {
			target = dirname(abs);
		}
		await this.runReveal(launch, bin, [target], false);
		return { path: rel };
	}
	async pickSpec(app) {
		if (app !== void 0 && app !== "") {
			if (!isExternalEditorId(app)) throw new GitError("EDITOR_UNKNOWN");
			const chosen = CATALOG.find((item) => item.id === app);
			if (chosen === void 0) throw new GitError("EDITOR_UNKNOWN");
			return chosen;
		}
		for (const id of EXTERNAL_EDITOR_IDS) {
			const spec = CATALOG.find((item) => item.id === id);
			if (spec === void 0) continue;
			if (await this.resolveBin(spec) !== void 0) return spec;
		}
		throw new GitError("EDITOR_NOT_FOUND");
	}
};
//#endregion
//#region src/shared/new-file-path.ts
function sanitizeTermId(value) {
	if (typeof value !== "string") return "main";
	const trimmed = value.trim();
	if (trimmed === "" || trimmed.length > 64) return "main";
	if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return "main";
	return trimmed;
}
function termSessionKey(workspaceId, termId) {
	return `${workspaceId}::${sanitizeTermId(termId)}`;
}
//#endregion
//#region src/host/terminal.ts
const MAX_BUFFER = 2e5;
const MAX_WRITE = 256e3;
const ALLOWED_SHELL = /^(bash|zsh|sh|dash|pwsh|powershell|cmd)$/;
const ALLOWED_ABS = /^\/(bin|usr\/bin|usr\/local\/bin)\/(bash|zsh|sh|dash)$/;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const PTY_PROBE_TIMEOUT_MS = 5e3;
const RUN_AS_NODE = "ELECTRON_RUN_AS_NODE";
function looksLikeAllowedShell(path) {
	const trimmed = path.trim();
	if (ALLOWED_ABS.test(trimmed)) return true;
	if (process.platform === "win32" && /\.exe$/i.test(trimmed) && /[\\/]/.test(trimmed)) return true;
	return !trimmed.includes("/") && !trimmed.includes("\\") && ALLOWED_SHELL.test(trimmed);
}
async function pickShell(env = process.env, exists) {
	const check = exists ?? (async (abs) => {
		try {
			await access(abs, constants.X_OK);
			return true;
		} catch {
			return false;
		}
	});
	const preferred = env.SHELL !== void 0 && looksLikeAllowedShell(env.SHELL) ? [env.SHELL] : [];
	const winCandidates = process.platform === "win32" ? [
		"C:/Program Files/Git/bin/bash.exe",
		"C:/Program Files/Git/usr/bin/bash.exe",
		join(process.env.SYSTEMROOT ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe")
	] : [];
	const candidates = [
		...preferred,
		...winCandidates,
		"/bin/bash",
		"/usr/bin/bash",
		"/bin/zsh",
		"/usr/bin/zsh",
		"/bin/sh",
		"/usr/bin/sh"
	];
	const seen = /* @__PURE__ */ new Set();
	for (const item of candidates) {
		if (seen.has(item)) continue;
		seen.add(item);
		if (!looksLikeAllowedShell(item)) continue;
		const abs = item.startsWith("/") || process.platform === "win32" && /^[a-zA-Z]:[\\/]/.test(item) ? item : void 0;
		if (abs === void 0) continue;
		if (await check(abs)) return abs;
	}
	throw new GitError("TERM_NO_SHELL");
}
function clampSize(value, min, max, fallback) {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, Math.floor(value)));
}
function termColorEnv(base, cwd) {
	return {
		...base,
		TERM: "xterm-256color",
		COLORTERM: "truecolor",
		PWD: cwd
	};
}
function appendBuffer(current, chunk) {
	const next = current + chunk;
	return next.length > MAX_BUFFER ? next.slice(next.length - MAX_BUFFER) : next;
}
function writeSse(res, event) {
	res.write(`data: ${JSON.stringify(event)}\n\n`);
}
async function loadNodePty() {
	try {
		return await import("node-pty");
	} catch {
		const candidates = [
			join(homedir(), ".dsh/profiles/desktop/node_modules/node-pty"),
			join(homedir(), ".dsh/profiles/node_modules/node-pty"),
			join(process.cwd(), "node_modules/node-pty")
		];
		for (const dir of candidates) try {
			return createRequire(join(dir, "package.json"))(dir);
		} catch {}
		throw new GitError("TERM_FAILED");
	}
}
async function resolveNodePtyManifest() {
	const require = createRequire(import.meta.url);
	try {
		return require.resolve("node-pty/package.json");
	} catch {
		const candidates = [
			join(homedir(), ".dsh/profiles/desktop/node_modules/node-pty/package.json"),
			join(homedir(), ".dsh/profiles/node_modules/node-pty/package.json"),
			join(process.cwd(), "node_modules/node-pty/package.json")
		];
		for (const manifest of candidates) try {
			await access(manifest, constants.R_OK);
			return manifest;
		} catch {}
		throw new GitError("TERM_FAILED", "node-pty is not installed or cannot be resolved");
	}
}
function ptyProbeCode(manifest, bin, cwd, env) {
	const childEnv = termColorEnv(env, cwd);
	return [
		"const { createRequire } = require('node:module')",
		"const pty = createRequire(" + JSON.stringify(manifest) + ")('node-pty')",
		"const term = pty.spawn(" + JSON.stringify(bin) + ", [], {",
		"  name: 'xterm-256color',",
		"  cols: 10,",
		"  rows: 4,",
		"  cwd: " + JSON.stringify(cwd) + ",",
		"  env: " + JSON.stringify(childEnv) + ",",
		"})",
		"let done = false",
		"term.onExit((event) => {",
		"  if (done) return",
		"  done = true",
		"  process.exit(event.exitCode === 0 ? 0 : 1)",
		"})",
		"term.write('exit\\n')",
		"setTimeout(() => {",
		"  if (done) return",
		"  done = true",
		"  try { term.kill() } catch {}",
		"  process.exit(0)",
		"}, 250)",
		""
	].join("\n");
}
function runNodePtyProbe(code, cwd, env) {
	return new Promise((resolve) => {
		const childEnv = { ...env };
		if (process.versions.electron !== void 0) childEnv[RUN_AS_NODE] = "1";
		const child = spawn(process.execPath, ["-e", code], {
			cwd,
			env: childEnv,
			stdio: [
				"ignore",
				"ignore",
				"pipe"
			]
		});
		let stderr = "";
		let settled = false;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve(result);
		};
		const timeout = setTimeout(() => {
			try {
				child.kill();
			} catch {}
			finish({
				ok: false,
				detail: "node-pty self-check timed out"
			});
		}, PTY_PROBE_TIMEOUT_MS);
		child.stderr?.on("data", (chunk) => {
			stderr = (stderr + chunk.toString("utf8")).slice(-4096);
		});
		child.on("error", (error) => {
			finish({
				ok: false,
				detail: error.message
			});
		});
		child.on("exit", (code, signal) => {
			if (code === 0) finish({ ok: true });
			else finish({
				ok: false,
				detail: stderr.trim() || `node-pty self-check exited with ${signal ?? code ?? "unknown status"}`
			});
		});
	});
}
let ptyProbe;
async function assertNodePtyAvailable(bin, cwd, env, runProbe = runNodePtyProbe) {
	if (env.DSH_WORKBENCH_DISABLE_PTY === "1") throw new GitError("TERM_FAILED", "DSH_WORKBENCH_DISABLE_PTY is set");
	if (env.DSH_WORKBENCH_SKIP_PTY_PROBE === "1") return;
	const run = async () => {
		const result = await runProbe(ptyProbeCode(runProbe === runNodePtyProbe ? await resolveNodePtyManifest() : "node-pty/package.json", bin, cwd, env), cwd, env);
		if (!result.ok) throw new GitError("TERM_FAILED", result.detail ?? "node-pty self-check failed");
	};
	if (runProbe !== runNodePtyProbe) {
		await run();
		return;
	}
	if (ptyProbe === void 0) ptyProbe = run().catch((error) => {
		ptyProbe = void 0;
		throw error;
	});
	await ptyProbe;
}
async function defaultSpawnPty(bin, cwd, cols, rows, env) {
	await assertNodePtyAvailable(bin, cwd, env);
	return (await loadNodePty()).spawn(bin, [], {
		name: "xterm-256color",
		cols,
		rows,
		cwd,
		env: termColorEnv(env, cwd)
	});
}
/** One real PTY per workspace terminal tab. Output is redacted before it reaches the browser. */
var TerminalHub = class {
	deps;
	sessions = /* @__PURE__ */ new Map();
	constructor(deps = {}) {
		this.deps = deps;
	}
	key(workspaceId, termId) {
		return termSessionKey(workspaceId, termId);
	}
	async attach(workspaceId, cwd, res, cols = DEFAULT_COLS, rows = DEFAULT_ROWS, termId) {
		const session = await this.ensure(workspaceId, cwd, cols, rows, termId);
		res.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-store",
			connection: "keep-alive"
		});
		writeSse(res, {
			type: "hello",
			cwd: session.cwd,
			shell: basename(session.shell),
			cols: session.cols,
			rows: session.rows
		});
		if (session.buffer !== "") writeSse(res, {
			type: "out",
			text: session.buffer
		});
		const send = (event) => {
			writeSse(res, event);
		};
		session.listeners.add(send);
		const ping = setInterval(() => {
			res.write(": ping\n\n");
		}, 15e3);
		const drop = () => {
			clearInterval(ping);
			session.listeners.delete(send);
		};
		res.on("close", drop);
		res.on("error", drop);
	}
	async write(workspaceId, cwd, data, cols = DEFAULT_COLS, rows = DEFAULT_ROWS, termId) {
		if (data.length > MAX_WRITE) throw new GitError("BAD_REQUEST");
		(await this.ensure(workspaceId, cwd, cols, rows, termId)).pty.write(data);
		return { ok: true };
	}
	async resize(workspaceId, cwd, cols, rows, termId) {
		const nextCols = clampSize(cols, 10, 400, DEFAULT_COLS);
		const nextRows = clampSize(rows, 4, 200, DEFAULT_ROWS);
		const session = await this.ensure(workspaceId, cwd, nextCols, nextRows, termId);
		session.cols = nextCols;
		session.rows = nextRows;
		session.pty.resize(nextCols, nextRows);
		return {
			ok: true,
			cols: nextCols,
			rows: nextRows
		};
	}
	async interrupt(workspaceId, cwd, termId) {
		(await this.ensure(workspaceId, cwd, DEFAULT_COLS, DEFAULT_ROWS, termId)).pty.write("");
		return { ok: true };
	}
	async close(workspaceId, termId) {
		this.kill(this.key(workspaceId, termId));
		return { ok: true };
	}
	async restart(workspaceId, cwd, cols = DEFAULT_COLS, rows = DEFAULT_ROWS, termId) {
		const key = this.key(workspaceId, termId);
		const existing = this.sessions.get(key);
		const listeners = existing === void 0 ? /* @__PURE__ */ new Set() : new Set(existing.listeners);
		if (existing !== void 0) {
			existing.listeners.clear();
			this.sessions.delete(key);
			try {
				existing.pty.kill();
			} catch {}
		}
		const session = await this.ensure(workspaceId, cwd, cols, rows, termId);
		for (const listener of listeners) session.listeners.add(listener);
		return {
			cwd: session.cwd,
			shell: basename(session.shell),
			cols: session.cols,
			rows: session.rows
		};
	}
	disposeAll() {
		for (const id of [...this.sessions.keys()]) this.kill(id);
	}
	kill(key) {
		const session = this.sessions.get(key);
		if (session === void 0) return;
		this.sessions.delete(key);
		try {
			session.pty.kill();
		} catch {}
		for (const listener of session.listeners) listener({
			type: "exit",
			code: null
		});
		session.listeners.clear();
	}
	emit(session, event) {
		if (event.type === "out") {
			const text = redactSecrets(event.text);
			session.buffer = appendBuffer(session.buffer, text);
			const safe = {
				...event,
				text
			};
			for (const listener of session.listeners) listener(safe);
			return;
		}
		for (const listener of session.listeners) listener(event);
	}
	async ensure(workspaceId, cwd, cols, rows, termId) {
		const key = this.key(workspaceId, termId);
		const existing = this.sessions.get(key);
		if (existing !== void 0 && existing.cwd === cwd) return existing;
		if (existing !== void 0) this.kill(key);
		const shell = await pickShell(this.deps.env ?? process.env, this.deps.exists);
		const spawnPty = this.deps.spawnPty ?? defaultSpawnPty;
		const nextCols = clampSize(cols, 10, 400, DEFAULT_COLS);
		const nextRows = clampSize(rows, 4, 200, DEFAULT_ROWS);
		const pty = await spawnPty(shell, cwd, nextCols, nextRows, this.deps.env ?? process.env);
		const session = {
			cwd,
			shell,
			pty,
			buffer: "",
			cols: nextCols,
			rows: nextRows,
			listeners: /* @__PURE__ */ new Set()
		};
		this.sessions.set(key, session);
		pty.onData((chunk) => {
			this.emit(session, {
				type: "out",
				text: chunk
			});
		});
		pty.onExit((event) => {
			if (this.sessions.get(key) !== session) return;
			this.emit(session, {
				type: "exit",
				code: event.exitCode
			});
			this.sessions.delete(key);
		});
		return session;
	}
};
//#endregion
//#region src/shared/version.ts
const PLUGIN_NAME$1 = "dsh-workbench-plugin";
function parseSemver(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
	if (match === null) return null;
	return [
		Number(match[1]),
		Number(match[2]),
		Number(match[3])
	];
}
/** True when `latest` is a higher x.y.z than `current`. Garbage versions never trigger an upgrade. */
function isNewer(latest, current) {
	const next = parseSemver(latest);
	const now = parseSemver(current);
	if (next === null || now === null) return false;
	if (next[0] !== now[0]) return next[0] > now[0];
	if (next[1] !== now[1]) return next[1] > now[1];
	return next[2] > now[2];
}
function upgradeCommand(latest) {
	return `dsh plugin --profile web add ${PLUGIN_NAME$1}@${latest}`;
}
//#endregion
//#region src/host/update-check.ts
const REGISTRY_LATEST = `https://registry.npmjs.org/${PLUGIN_NAME$1}/latest`;
const CACHE_MS = 216e5;
const FETCH_MS = 4e3;
let cached = null;
function readInstalledVersion(from = fileURLToPath(import.meta.url)) {
	let dir = dirname(from);
	for (let i = 0; i < 8; i++) {
		try {
			const raw = readFileSync(join(dir, "package.json"), "utf8");
			const pkg = JSON.parse(raw);
			if (pkg.name === "dsh-workbench-plugin" && typeof pkg.version === "string" && pkg.version !== "") return pkg.version;
		} catch {}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return "0.0.0";
}
async function defaultFetchLatest(signal) {
	const response = await fetch(REGISTRY_LATEST, {
		signal,
		headers: { accept: "application/json" }
	});
	if (!response.ok) return null;
	const body = await response.json();
	if (typeof body !== "object" || body === null || !("version" in body)) return null;
	const version = body.version;
	return typeof version === "string" && version !== "" ? version : null;
}
function snapshot(current, latest) {
	const outdated = latest !== null && isNewer(latest, current);
	return {
		name: PLUGIN_NAME$1,
		current,
		latest,
		outdated,
		command: latest === null ? `dsh plugin --profile web add ${PLUGIN_NAME$1}` : upgradeCommand(latest)
	};
}
/** Compare the installed plugin with npm latest. Network/registry failures stay quiet. */
async function checkPluginUpdate(deps = {}) {
	const installed = readInstalledVersion();
	const now = deps.now ?? Date.now;
	if (cached !== null && now() - cached.at < CACHE_MS && cached.value.current === installed) return cached.value;
	const fetchLatest = deps.fetchLatest ?? defaultFetchLatest;
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, FETCH_MS);
	let latest = null;
	try {
		latest = await fetchLatest(controller.signal);
	} catch {
		latest = null;
	} finally {
		clearTimeout(timer);
	}
	const value = snapshot(installed, latest);
	if (latest !== null) cached = {
		at: now(),
		value
	};
	return value;
}
//#endregion
//#region src/shared/usage-format.ts
/** Strip a trailing /v1 so DeepSeek-style `/user/balance` can be tried at the origin. */
function billingOrigin(baseURL) {
	return baseURL.replace(/\/+$/, "").replace(/\/v1$/i, "");
}
function uniqueUrls(urls) {
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const url of urls) {
		if (url === "" || seen.has(url)) continue;
		seen.add(url);
		out.push(url);
	}
	return out;
}
/** Candidate billing URLs for one configured endpoint. Never includes credentials. */
function billingUrls(baseURL) {
	const origin = billingOrigin(baseURL);
	const raw = baseURL.replace(/\/+$/, "");
	return uniqueUrls([
		`${origin}/user/balance`,
		`${raw}/user/balance`,
		`${raw}/user/info`,
		`${origin}/user/info`,
		`${raw}/dashboard/billing/credit_grants`,
		`${origin}/v1/dashboard/billing/credit_grants`
	]);
}
function asAmount(value) {
	if (typeof value === "number" && Number.isFinite(value)) {
		if (Number.isInteger(value)) return String(value);
		return String(value);
	}
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	if (trimmed === "" || !/^-?\d+(\.\d+)?$/.test(trimmed)) return void 0;
	return trimmed;
}
function rowFromRecord(record, fallbackCurrency = "") {
	const total = asAmount(record.total_balance ?? record.totalBalance ?? record.total_available ?? record.balance ?? record.credit ?? record.total);
	if (total === void 0) return null;
	const currency = typeof record.currency === "string" && record.currency.trim() !== "" ? record.currency.trim() : fallbackCurrency;
	const granted = asAmount(record.granted_balance ?? record.grantedBalance ?? record.total_granted);
	const toppedUp = asAmount(record.topped_up_balance ?? record.toppedUpBalance ?? record.chargeBalance);
	const used = asAmount(record.total_used ?? record.used ?? record.used_balance);
	return {
		currency,
		total,
		...granted === void 0 ? {} : { granted },
		...toppedUp === void 0 ? {} : { toppedUp },
		...used === void 0 ? {} : { used }
	};
}
/**
* Accept known provider billing JSON. Unknown shapes return null so the
* caller can try the next URL instead of showing a blank number.
*/
function parseBalanceBody(body) {
	if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
	const root = body;
	const nested = typeof root.data === "object" && root.data !== null && !Array.isArray(root.data) ? root.data : void 0;
	const infos = Array.isArray(root.balance_infos) ? root.balance_infos : Array.isArray(nested?.balance_infos) ? nested.balance_infos : void 0;
	if (infos !== void 0) {
		const balances = [];
		for (const item of infos) {
			if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
			const row = rowFromRecord(item, "CNY");
			if (row !== null) balances.push(row);
		}
		if (balances.length === 0) return null;
		const available = root.is_available;
		return {
			balances,
			...typeof available === "boolean" ? { accountAvailable: available } : {}
		};
	}
	const source = nested ?? root;
	const row = rowFromRecord(source);
	if (row === null) return null;
	const status = source.status;
	const accountAvailable = typeof root.is_available === "boolean" ? root.is_available : typeof status === "string" && status !== "" ? !/disabled|banned|exhausted|insufficient/i.test(status) : void 0;
	return {
		balances: [row],
		...accountAvailable === void 0 ? {} : { accountAvailable }
	};
}
//#endregion
//#region src/host/provider-usage.ts
const FETCH_TIMEOUT_MS$1 = 8e3;
const DEFAULT_DEEPSEEK_BASE = "https://api.deepseek.com";
const DEEPSEEK_PROVIDER = "deepseek-official";
function readLlm(ctx) {
	const llm = ctx.llm ?? ctx.get("llm");
	if (llm === void 0 || typeof llm.listProviders !== "function") throw new GitError("LLM_UNAVAILABLE");
	return llm;
}
function defaultRoute(ctx) {
	const selection = (ctx.agentDefaultModel ?? ctx.get("agentDefaultModel"))?.currentSelection?.();
	if (typeof selection?.provider === "string" && selection.provider !== "" && typeof selection.model === "string" && selection.model !== "") return {
		provider: selection.provider,
		model: selection.model,
		...typeof selection.reasoningEffort === "string" && selection.reasoningEffort !== "" ? { reasoningEffort: selection.reasoningEffort } : {},
		source: "default"
	};
}
function loggedRoute(agent) {
	const config = (agent?.session?.requestHeader?.())?.config;
	if (typeof config?.provider !== "string" || config.provider === "") return void 0;
	if (typeof config.model !== "string" || config.model === "") return void 0;
	return {
		provider: config.provider,
		model: config.model,
		...typeof config.reasoningEffort === "string" && config.reasoningEffort !== "" ? { reasoningEffort: config.reasoningEffort } : {}
	};
}
function agentFor(ctx, sessionId) {
	if (sessionId === void 0 || sessionId === "") return void 0;
	const found = ctx.get("agents")?.get?.(sessionId);
	if (found !== void 0) return found;
	return (ctx.sessions ?? ctx.get("sessions"))?.binding?.(sessionId);
}
function resolveRoute(ctx, sessionId) {
	const logged = loggedRoute(agentFor(ctx, sessionId));
	if (logged !== void 0) return {
		...logged,
		source: "session"
	};
	const fallback = defaultRoute(ctx);
	if (fallback !== void 0) return fallback;
	throw new GitError("LLM_UNAVAILABLE");
}
function settingsSection(ctx, ns) {
	const settings = ctx.get("settings");
	try {
		return settings?.get?.(ns);
	} catch {
		return;
	}
}
function asRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	return value;
}
function asNonEmpty(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
function connectionFor(ctx, provider) {
	if (provider === DEEPSEEK_PROVIDER) {
		const section = asRecord(settingsSection(ctx, "llm-deepseek"));
		return {
			baseURL: asNonEmpty(section?.baseURL) ?? DEFAULT_DEEPSEEK_BASE,
			apiKeyEnv: asNonEmpty(section?.apiKeyEnv) ?? "DEEPSEEK_API_KEY"
		};
	}
	const profile = asRecord(asRecord(asRecord(settingsSection(ctx, "llm-pi-ai"))?.providers)?.[provider]);
	return {
		baseURL: asNonEmpty(profile?.baseURL) ?? "",
		apiKeyEnv: asNonEmpty(profile?.apiKeyEnv) ?? ""
	};
}
async function resolveApiKey(ctx, ref) {
	if (ref === "" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) return void 0;
	const credentials = ctx.get("credentials");
	if (credentials !== void 0 && typeof credentials.resolve === "function") try {
		return asNonEmpty((await credentials.resolve(ref))?.value);
	} catch {
		return;
	}
	const ambient = asNonEmpty(ctx.get("launchEnvironment")?.get?.(ref)?.value);
	if (ambient !== void 0) return ambient;
	return asNonEmpty(process.env[ref]);
}
function providerNameOf(llm, provider) {
	const match = (llm.listConfigurableProviders?.() ?? []).find((item) => item.provider === provider);
	if (match !== void 0 && match.displayName.trim() !== "") return match.displayName;
	if (provider === DEEPSEEK_PROVIDER) return "DeepSeek";
	return provider;
}
async function modelNameOf(llm, provider, model, signal) {
	try {
		const info = await llm.resolveModelInfo?.(provider, model, signal);
		if (typeof info?.name === "string" && info.name.trim() !== "") return info.name;
	} catch {}
	try {
		const match = (await llm.listModels(provider)).find((item) => item.id === model);
		if (typeof match?.name === "string" && match.name.trim() !== "") return match.name;
	} catch {}
	return model;
}
function endpointLabel(baseURL) {
	if (baseURL === "") return void 0;
	try {
		const url = new URL(baseURL.includes("://") ? baseURL : `https://${baseURL}`);
		return redactSecrets(`${url.host}${url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")}`);
	} catch {
		return redactSecrets(billingOrigin(baseURL));
	}
}
async function readJson$2(response) {
	const text = await response.text();
	if (text.trim() === "") return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
async function queryBalance(baseURL, apiKey, fetchImpl, signal) {
	const urls = billingUrls(baseURL);
	if (urls.length === 0) return {
		status: "unsupported",
		balances: []
	};
	let sawAuth = false;
	let sawHttp = false;
	for (const url of urls) {
		if (signal.aborted) break;
		try {
			const response = await fetchImpl(url, {
				method: "GET",
				signal,
				headers: {
					accept: "application/json",
					authorization: `Bearer ${apiKey}`,
					"user-agent": "dsh-workbench-plugin/usage (+https://github.com/loadingvx/deepseek-harness-workbench-plugin)"
				}
			});
			if (response.status === 401 || response.status === 403) {
				sawAuth = true;
				continue;
			}
			if (response.status === 404 || response.status === 405) continue;
			if (!response.ok) {
				sawHttp = true;
				continue;
			}
			const parsed = parseBalanceBody(await readJson$2(response));
			if (parsed === null) continue;
			return {
				status: "ok",
				balances: parsed.balances,
				accountAvailable: parsed.accountAvailable
			};
		} catch (error) {
			if (signal.aborted) break;
			if (error instanceof Error && error.name === "AbortError") break;
			sawHttp = true;
		}
	}
	if (sawAuth) return {
		status: "auth",
		balances: []
	};
	if (sawHttp) return {
		status: "failed",
		balances: []
	};
	return {
		status: "unsupported",
		balances: []
	};
}
function timeoutSignal(parent) {
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, FETCH_TIMEOUT_MS$1);
	const onParent = () => {
		controller.abort();
	};
	parent?.addEventListener("abort", onParent);
	if (parent?.aborted) controller.abort();
	return {
		signal: controller.signal,
		cancel: () => {
			clearTimeout(timer);
			parent?.removeEventListener("abort", onParent);
		}
	};
}
/** Current session model plus that provider's account balance. Never returns secrets. */
async function readProviderUsage(ctx, sessionId, options) {
	const llm = readLlm(ctx);
	const route = resolveRoute(ctx, sessionId);
	const connection = connectionFor(ctx, route.provider);
	const [modelName, apiKey] = await Promise.all([modelNameOf(llm, route.provider, route.model, options?.signal), connection.apiKeyEnv === "" ? Promise.resolve(void 0) : resolveApiKey(ctx, connection.apiKeyEnv)]);
	const fetchedAt = options?.now?.() ?? Date.now();
	const snapshot = (balanceStatus, extra) => ({
		provider: route.provider,
		providerName: providerNameOf(llm, route.provider),
		model: route.model,
		modelName,
		...route.reasoningEffort === void 0 ? {} : { reasoningEffort: route.reasoningEffort },
		source: route.source,
		...endpointLabel(connection.baseURL) === void 0 ? {} : { endpoint: endpointLabel(connection.baseURL) },
		balanceStatus,
		balances: [],
		fetchedAt,
		...extra
	});
	if (connection.baseURL === "" && route.provider !== DEEPSEEK_PROVIDER) {
		if (apiKey === void 0) return snapshot(connection.apiKeyEnv === "" ? "unsupported" : "no_key");
		return snapshot("unsupported");
	}
	if (apiKey === void 0) return snapshot("no_key");
	const gated = timeoutSignal(options?.signal);
	try {
		const result = await queryBalance(connection.baseURL === "" ? DEFAULT_DEEPSEEK_BASE : connection.baseURL, apiKey, options?.fetch ?? fetch, gated.signal);
		return snapshot(result.status, {
			balances: result.balances,
			...result.accountAvailable === void 0 ? {} : { accountAvailable: result.accountAvailable }
		});
	} finally {
		gated.cancel();
	}
}
//#endregion
//#region src/shared/browser-inspect-script.ts
const BROWSER_INSPECT_SCRIPT = `(function () {
  if (window.__DSH_BROWSER__) return;
  window.__DSH_BROWSER__ = true;
  var SOURCE = ${JSON.stringify("dsh-workbench-browser")};
  var HTML_MAX = 48000;
  var TEXT_MAX = 500;
  var inspectOn = false;
  var overlay = null;
  var labelEl = null;
  var lastHover = null;

  function pageUrl() {
    var base = document.querySelector('base');
    if (base && base.href) return base.href;
    try {
      var u = new URL(location.href);
      var orig = u.searchParams.get('u');
      if (orig) return orig;
    } catch (e) {}
    return location.href;
  }

  function post(payload) {
    payload.source = SOURCE;
    try { parent.postMessage(payload, '*'); } catch (e) {}
  }

  function viewport() {
    return { w: window.innerWidth || 0, h: window.innerHeight || 0 };
  }

  function pageInfo() {
    return {
      type: 'page',
      url: pageUrl(),
      title: document.title || '',
      ua: navigator.userAgent || '',
      viewport: viewport(),
      secure: !!window.isSecureContext,
      cookiesEnabled: navigator.cookieEnabled !== false,
    };
  }

  function tagOf(el) {
    return (el.tagName || 'el').toLowerCase();
  }

  function indexAmongType(el) {
    var parent = el.parentElement;
    if (!parent) return 1;
    var tag = el.tagName;
    var n = 0;
    var kids = parent.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].tagName !== tag) continue;
      n += 1;
      if (kids[i] === el) return n;
    }
    return 1;
  }

  function xpathOf(el) {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1) {
      var tag = tagOf(node);
      if (tag === 'html') {
        parts.unshift('/html[1]');
        break;
      }
      parts.unshift('/' + tag + '[' + indexAmongType(node) + ']');
      node = node.parentElement;
    }
    return parts.join('');
  }

  function cssEscape(value) {
    return String(value).replace(/([^\\w-])/g, '\\\\$1');
  }

  function uniqueSelector(el) {
    if (el.id && /^[A-Za-z][\\w-]*$/.test(el.id)) {
      var byId = '#' + el.id;
      try { if (document.querySelectorAll(byId).length === 1) return byId; } catch (e) {}
    }
    var testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
    if (testId) {
      var sel = '[data-testid="' + String(testId).replace(/"/g, '\\\\"') + '"]';
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e2) {}
    }
    return null;
  }

  function cssPathOf(el) {
    var unique = uniqueSelector(el);
    if (unique) return unique;
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && tagOf(node) !== 'html') {
      var tag = tagOf(node);
      if (tag === 'body') { parts.unshift('body'); break; }
      var idSel = uniqueSelector(node);
      if (idSel) { parts.unshift(idSel); break; }
      var nth = indexAmongType(node);
      var klass = '';
      if (typeof node.className === 'string') {
        klass = node.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2).map(cssEscape).join('.');
      }
      var piece = klass ? tag + '.' + klass : tag;
      var siblings = node.parentElement ? node.parentElement.querySelectorAll(tag).length : 1;
      parts.unshift((nth > 1 || siblings !== 1) ? piece + ':nth-of-type(' + nth + ')' : piece);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function jsPathOf(el) {
    var css = cssPathOf(el);
    return 'document.querySelector("' + css.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"') + '")';
  }

  function clipHtml(html) {
    if (html.length <= HTML_MAX) return { html: html, htmlTruncated: false };
    return { html: html.slice(0, HTML_MAX), htmlTruncated: true };
  }

  function pack(el) {
    var rawHtml = el.outerHTML || '';
    var clipped = clipHtml(rawHtml);
    var text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text.length > TEXT_MAX) text = text.slice(0, TEXT_MAX);
    return {
      tag: tagOf(el),
      id: el.id || '',
      className: typeof el.className === 'string' ? el.className : '',
      name: el.getAttribute('name') || '',
      href: el.getAttribute('href') || '',
      type: el.getAttribute('type') || '',
      role: el.getAttribute('role') || '',
      testId: el.getAttribute('data-testid') || el.getAttribute('data-test') || '',
      xpath: xpathOf(el),
      cssPath: cssPathOf(el),
      jsPath: jsPathOf(el),
      text: text,
      html: clipped.html,
      htmlTruncated: clipped.htmlTruncated,
      url: pageUrl(),
      title: document.title || '',
    };
  }

  function ensureOverlay() {
    if (overlay && overlay.isConnected) return overlay;
    overlay = document.createElement('div');
    overlay.setAttribute('data-dsh-inspect-overlay', '');
    overlay.style.cssText = 'position:fixed!important;z-index:2147483647!important;pointer-events:none!important;border:2px solid #1a73e8!important;background:rgba(26,115,232,0.18)!important;box-shadow:0 0 0 1px rgba(255,255,255,0.85)!important;display:none!important;box-sizing:border-box!important;margin:0!important;padding:0!important;';
    labelEl = document.createElement('div');
    labelEl.setAttribute('data-dsh-inspect-label', '');
    labelEl.style.cssText = 'position:absolute!important;left:-2px!important;height:20px!important;padding:0 6px!important;background:#1a73e8!important;color:#fff!important;font:11px/20px ui-sans-serif,system-ui,sans-serif!important;white-space:nowrap!important;border-radius:2px 2px 0 0!important;max-width:280px!important;overflow:hidden!important;text-overflow:ellipsis!important;pointer-events:none!important;';
    overlay.appendChild(labelEl);
    (document.documentElement || document.body).appendChild(overlay);
    return overlay;
  }

  function hideOverlay() {
    if (overlay) overlay.style.setProperty('display', 'none', 'important');
    lastHover = null;
  }

  function showOverlay(el) {
    if (!el || el === overlay || (labelEl && el === labelEl)) return;
    if (el.getAttribute && el.getAttribute('data-dsh-inspect-overlay') !== null) return;
    var box = ensureOverlay();
    var r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return;
    box.style.setProperty('display', 'block', 'important');
    box.style.setProperty('left', r.left + 'px', 'important');
    box.style.setProperty('top', r.top + 'px', 'important');
    box.style.setProperty('width', Math.max(0, r.width) + 'px', 'important');
    box.style.setProperty('height', Math.max(0, r.height) + 'px', 'important');
    var name = tagOf(el);
    if (el.id) name += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) {
      name += '.' + el.className.trim().split(/\\s+/)[0];
    }
    if (labelEl) {
      labelEl.textContent = name;
      if (r.top < 24) {
        labelEl.style.setProperty('top', '100%', 'important');
        labelEl.style.setProperty('margin-top', '2px', 'important');
        labelEl.style.setProperty('border-radius', '0 0 2px 2px', 'important');
      } else {
        labelEl.style.setProperty('top', '-20px', 'important');
        labelEl.style.setProperty('margin-top', '0', 'important');
        labelEl.style.setProperty('border-radius', '2px 2px 0 0', 'important');
      }
    }
    lastHover = el;
  }

  function setInspect(on) {
    inspectOn = !!on;
    var root = document.documentElement;
    if (root) {
      root.style.cursor = inspectOn ? 'crosshair' : '';
      if (inspectOn) root.setAttribute('data-dsh-inspecting', '');
      else root.removeAttribute('data-dsh-inspecting');
    }
    if (document.body) document.body.style.cursor = inspectOn ? 'crosshair' : '';
    if (inspectOn) ensureOverlay();
    else hideOverlay();
  }

  function isOverlay(el) {
    if (!el) return false;
    if (el.getAttribute && (el.getAttribute('data-dsh-inspect-overlay') !== null || el.getAttribute('data-dsh-inspect-label') !== null)) return true;
    return !!(el.closest && el.closest('[data-dsh-inspect-overlay]'));
  }

  function targetFromEvent(event) {
    var x = event.clientX, y = event.clientY;
    var el = document.elementFromPoint(x, y);
    if (isOverlay(el)) {
      var prev = overlay.style.pointerEvents;
      overlay.style.pointerEvents = 'none';
      el = document.elementFromPoint(x, y);
      overlay.style.pointerEvents = prev;
    }
    if (!el || el === document.documentElement || el === document.body) return el;
    return el;
  }

  function onMove(event) {
    if (!inspectOn) return;
    showOverlay(targetFromEvent(event));
  }

  function onClick(event) {
    if (inspectOn) {
      event.preventDefault();
      event.stopPropagation();
      var el = targetFromEvent(event);
      if (el && !isOverlay(el)) post({ type: 'pick', snapshot: pack(el) });
      return;
    }
    var a = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.href;
    if (!href) return;
    if (a.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (/^(javascript|mailto|tel):/i.test(href)) return;
    event.preventDefault();
    post({ type: 'nav', url: href });
  }

  function wrapConsole(level) {
    var orig = console[level] ? console[level].bind(console) : function () {};
    console[level] = function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) {
        var v = arguments[i];
        try { parts.push(typeof v === 'string' ? v : JSON.stringify(v)); }
        catch (e) { parts.push(String(v)); }
      }
      var text = parts.join(' ');
      if (text.length > 2000) text = text.slice(0, 2000);
      post({ type: 'console', level: level, text: text });
      return orig.apply(console, arguments);
    };
  }

  function stringify(value) {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'bigint') return String(value) + 'n';
    if (typeof value === 'function' || typeof value === 'symbol') return String(value);
    try {
      var json = JSON.stringify(value);
      if (typeof json === 'string') return json;
    } catch (e) {}
    return String(value);
  }

  wrapConsole('log');
  wrapConsole('info');
  wrapConsole('debug');
  wrapConsole('warn');
  wrapConsole('error');
  var origClear = console.clear ? console.clear.bind(console) : function () {};
  console.clear = function () {
    post({ type: 'console-clear' });
    return origClear.apply(console, arguments);
  };

  var netSeq = 0;
  var netQueue = [];
  var netFlush = 0;
  window.__DSH_NET_HOOKS__ = true;
  function clipUrl(u) {
    u = String(u || '');
    if (u.length > 1500) u = u.slice(0, 1500);
    return u;
  }
  function kindFrom(t, url) {
    t = String(t || '').toLowerCase();
    if (t === 'xmlhttprequest' || t === 'xhr') return 'xhr';
    if (t === 'fetch') return 'fetch';
    if (t === 'script') return 'script';
    if (t === 'link' || t === 'css' || t === 'stylesheet') return 'stylesheet';
    if (t === 'img' || t === 'image' || t === 'icon' || t === 'cssimage') return 'image';
    if (t === 'font') return 'font';
    if (t === 'video' || t === 'audio' || t === 'media') return 'media';
    if (t === 'websocket') return 'websocket';
    if (t === 'navigation' || t === 'iframe' || t === 'document') return 'document';
    var path = String(url || '').split('?')[0].toLowerCase();
    if (/\\.(m?js|cjs)(\\.map)?$/.test(path)) return 'script';
    if (/\\.css$/.test(path)) return 'stylesheet';
    if (/\\.(png|jpe?g|gif|svg|webp|ico|avif|bmp)$/.test(path)) return 'image';
    if (/\\.(woff2?|ttf|otf|eot)$/.test(path)) return 'font';
    if (/\\.(mp4|webm|mp3|wav|ogg)$/.test(path)) return 'media';
    return 'other';
  }
  function flushNet() {
    netFlush = 0;
    if (!netQueue.length) return;
    var batch = netQueue;
    netQueue = [];
    post({ type: 'net', entries: batch });
  }
  function postNet(entry) {
    netQueue.push(entry);
    if (netQueue.length >= 40) {
      if (netFlush) {
        try { cancelAnimationFrame(netFlush); } catch (e) {}
        netFlush = 0;
      }
      flushNet();
      return;
    }
    if (netFlush) return;
    try { netFlush = requestAnimationFrame(flushNet); }
    catch (e2) { netFlush = setTimeout(flushNet, 16); }
  }

  try {
    var XO = XMLHttpRequest.prototype.open;
    var XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__dsh = { method: String(method || 'GET').toUpperCase(), url: clipUrl(url), start: Date.now() };
      return XO.apply(this, arguments);
    };
    XMLHttpRequest.prototype.open.__dshNet = true;
    XMLHttpRequest.prototype.send = function () {
      var self = this;
      var meta = self.__dsh || { method: 'GET', url: '', start: Date.now() };
      var id = ++netSeq;
      postNet({ id: id, method: meta.method, url: meta.url, resourceType: 'xhr', status: 0, durationMs: 0, size: 0, pending: true, failed: false, startAt: meta.start });
      self.addEventListener('loadend', function () {
        postNet({
          id: id,
          method: meta.method,
          url: clipUrl(self.responseURL || meta.url),
          resourceType: 'xhr',
          status: self.status || 0,
          durationMs: Date.now() - meta.start,
          size: 0,
          pending: false,
          failed: self.status === 0,
          startAt: meta.start,
        });
      });
      return XS.apply(this, arguments);
    };
  } catch (xhrErr) {}

  try {
    if (typeof window.fetch === 'function') {
      var origFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        var method = 'GET';
        var url = '';
        try {
          if (typeof input === 'string') url = input;
          else if (input && input.url) url = input.url;
          if (init && init.method) method = String(init.method);
          else if (input && input.method) method = String(input.method);
        } catch (e) {}
        method = String(method || 'GET').toUpperCase();
        url = clipUrl(url);
        var id = ++netSeq;
        var start = Date.now();
        postNet({ id: id, method: method, url: url, resourceType: 'fetch', status: 0, durationMs: 0, size: 0, pending: true, failed: false, startAt: start });
        return origFetch.apply(this, arguments).then(function (res) {
          postNet({
            id: id,
            method: method,
            url: clipUrl((res && res.url) || url),
            resourceType: 'fetch',
            status: (res && res.status) || 0,
            durationMs: Date.now() - start,
            size: 0,
            pending: false,
            failed: false,
            startAt: start,
          });
          return res;
        }, function (err) {
          postNet({ id: id, method: method, url: url, resourceType: 'fetch', status: 0, durationMs: Date.now() - start, size: 0, pending: false, failed: true, startAt: start });
          throw err;
        });
      };
      window.fetch.__dshNet = true;
    }
  } catch (fetchErr) {}

  try {
    if (window.WebSocket) {
      var WS = window.WebSocket;
      window.WebSocket = function (url, protocols) {
        var id = ++netSeq;
        var start = Date.now();
        var u = clipUrl(url);
        postNet({ id: id, method: 'WS', url: u, resourceType: 'websocket', status: 0, durationMs: 0, size: 0, pending: true, failed: false, startAt: start });
        var ws = protocols !== undefined ? new WS(url, protocols) : new WS(url);
        ws.addEventListener('open', function () {
          postNet({ id: id, method: 'WS', url: u, resourceType: 'websocket', status: 101, durationMs: Date.now() - start, size: 0, pending: false, failed: false, startAt: start });
        });
        ws.addEventListener('error', function () {
          postNet({ id: id, method: 'WS', url: u, resourceType: 'websocket', status: 0, durationMs: Date.now() - start, size: 0, pending: false, failed: true, startAt: start });
        });
        return ws;
      };
      window.WebSocket.prototype = WS.prototype;
      window.WebSocket.CONNECTING = WS.CONNECTING;
      window.WebSocket.OPEN = WS.OPEN;
      window.WebSocket.CLOSING = WS.CLOSING;
      window.WebSocket.CLOSED = WS.CLOSED;
    }
  } catch (wsErr) {}

  function takeResource(entry) {
    if (!entry) return;
    var url = clipUrl(entry.name);
    if (!url) return;
    var kind = kindFrom(entry.initiatorType, url);
    if (kind === 'xhr' || kind === 'fetch') return;
    var status = 0;
    try { status = entry.responseStatus || 0; } catch (e) {}
    var size = 0;
    try { size = Math.round(entry.transferSize || entry.encodedBodySize || 0); } catch (e2) {}
    postNet({
      id: ++netSeq,
      method: 'GET',
      url: url,
      resourceType: kind,
      status: status,
      durationMs: Math.round(entry.duration || 0),
      size: size,
      pending: false,
      failed: false,
      startAt: Date.now() - Math.round(entry.duration || 0),
    });
  }
  try {
    if (typeof PerformanceObserver === 'function') {
      var po = new PerformanceObserver(function (list) {
        var recs = list.getEntries();
        for (var i = 0; i < recs.length; i++) takeResource(recs[i]);
      });
      try { po.observe({ type: 'resource', buffered: true }); } catch (e) {}
      try { po.observe({ type: 'navigation', buffered: true }); } catch (e2) {}
    }
  } catch (perfErr) {}

  function rowsFromStorage(store) {
    var rows = [];
    if (!store) return rows;
    var n = 0;
    try { n = store.length; } catch (e) { return rows; }
    for (var i = 0; i < n && rows.length < 80; i++) {
      var key = '';
      try { key = store.key(i) || ''; } catch (e2) { continue; }
      var val = '';
      var truncated = false;
      try {
        val = String(store.getItem(key) || '');
        if (val.length > 500) { val = val.slice(0, 500); truncated = true; }
      } catch (e3) {}
      rows.push({ name: String(key), value: val, truncated: truncated });
    }
    return rows;
  }
  function parseCookies() {
    var rows = [];
    var raw = '';
    try { raw = document.cookie || ''; } catch (e) { return rows; }
    var parts = raw.split(';');
    for (var i = 0; i < parts.length && rows.length < 80; i++) {
      var p = String(parts[i] || '').replace(/^\\s+/, '');
      if (!p) continue;
      var eq = p.indexOf('=');
      var name = eq === -1 ? p : p.slice(0, eq);
      var value = eq === -1 ? '' : p.slice(eq + 1);
      var truncated = false;
      if (value.length > 500) { value = value.slice(0, 500); truncated = true; }
      if (name) rows.push({ name: name, value: value, truncated: truncated });
    }
    return rows;
  }
  function postApp() {
    var payload = {
      type: 'app',
      cookies: parseCookies(),
      localStorage: [],
      sessionStorage: [],
      databases: [],
    };
    try { payload.localStorage = rowsFromStorage(window.localStorage); } catch (e) {}
    try { payload.sessionStorage = rowsFromStorage(window.sessionStorage); } catch (e2) {}
    var finish = function () { post(payload); };
    try {
      if (window.indexedDB && indexedDB.databases) {
        indexedDB.databases().then(function (list) {
          var dbs = [];
          if (list) {
            for (var i = 0; i < list.length && dbs.length < 80; i++) {
              var n = list[i] && list[i].name;
              if (n) dbs.push(String(n));
            }
          }
          payload.databases = dbs;
          finish();
        }).catch(finish);
        return;
      }
    } catch (e3) {}
    finish();
  }
  function postCss() {
    var sheets = [];
    var vars = [];
    try {
      var list = document.styleSheets;
      for (var i = 0; i < list.length && sheets.length < 80; i++) {
        var s = list[i];
        var href = '';
        var title = '';
        var disabled = false;
        try { href = s.href || ''; } catch (e) {}
        try { title = s.title || ''; } catch (e2) {}
        try { disabled = !!s.disabled; } catch (e3) {}
        var ruleCount = null;
        var blocked = false;
        try {
          var rules = s.cssRules || s.rules;
          ruleCount = rules ? rules.length : 0;
        } catch (e4) { blocked = true; }
        sheets.push({ href: clipUrl(href), title: title, disabled: disabled, ruleCount: ruleCount, blocked: blocked });
      }
    } catch (e5) {}
    try {
      var root = document.documentElement;
      if (root && window.getComputedStyle) {
        var cs = window.getComputedStyle(root);
        for (var j = 0; j < cs.length && vars.length < 80; j++) {
          var name = cs[j];
          if (name && name.indexOf('--') === 0) {
            vars.push({ name: name, value: String(cs.getPropertyValue(name) || '').slice(0, 300) });
          }
        }
      }
    } catch (e6) {}
    post({ type: 'css', sheets: sheets, vars: vars });
  }
  function postFiles() {
    var out = [];
    var seen = {};
    function add(url, kind, size, duration) {
      url = clipUrl(url);
      if (!url || seen[url]) return;
      seen[url] = 1;
      out.push({ url: url, kind: kind, size: size || 0, durationMs: duration || 0 });
    }
    add(pageUrl(), 'document', 0, 0);
    try {
      var scripts = document.scripts;
      for (var i = 0; i < scripts.length; i++) {
        if (scripts[i].src) add(scripts[i].src, 'script', 0, 0);
      }
    } catch (e) {}
    try {
      var links = document.querySelectorAll('link[rel~="stylesheet"],link[rel="preload"][as="style"]');
      for (var li = 0; li < links.length; li++) {
        var href = links[li].href;
        if (href) add(href, 'stylesheet', 0, 0);
      }
    } catch (e2) {}
    try {
      var imgs = document.images;
      for (var im = 0; im < imgs.length; im++) {
        if (imgs[im].currentSrc || imgs[im].src) add(imgs[im].currentSrc || imgs[im].src, 'image', 0, 0);
      }
    } catch (e3) {}
    try {
      var entries = performance.getEntriesByType('resource');
      for (var p = 0; p < entries.length && out.length < 200; p++) {
        var en = entries[p];
        var size = 0;
        try { size = Math.round(en.transferSize || en.encodedBodySize || 0); } catch (e4) {}
        add(en.name, kindFrom(en.initiatorType, en.name), size, Math.round(en.duration || 0));
      }
    } catch (e5) {}
    post({ type: 'files', files: out.slice(0, 200) });
  }
  function dumpDevtools() {
    postApp();
    postCss();
    postFiles();
  }

  window.addEventListener('error', function (event) {
    var where = event.filename ? ' (' + event.filename + ':' + event.lineno + ')' : '';
    post({ type: 'console', level: 'error', text: (event.message || 'Error') + where });
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    var text = 'Unhandled Promise: ';
    try { text += reason && reason.stack ? String(reason.stack) : stringify(reason); }
    catch (e) { text += String(reason); }
    if (text.length > 2000) text = text.slice(0, 2000);
    post({ type: 'console', level: 'error', text: text });
  });

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.source !== SOURCE) return;
    if (data.type === 'inspect') setInspect(!!data.on);
    if (data.type === 'query' || data.type === 'probe') {
      post(pageInfo());
      dumpDevtools();
    }
    if (data.type === 'eval') {
      var id = data.id;
      var code = String(data.code || '');
      try {
        var result = (0, eval)(code);
        post({ type: 'eval-result', id: id, ok: true, text: stringify(result) });
      } catch (err) {
        var msg = err && err.stack ? String(err.stack) : String(err);
        if (msg.length > 2000) msg = msg.slice(0, 2000);
        post({ type: 'eval-result', id: id, ok: false, text: msg });
      }
    }
  });

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseover', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', function (event) {
    if (inspectOn) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  var origPush = history.pushState;
  var origReplace = history.replaceState;
  history.pushState = function () {
    var r = origPush.apply(this, arguments);
    post(pageInfo());
    return r;
  };
  history.replaceState = function () {
    var r = origReplace.apply(this, arguments);
    post(pageInfo());
    return r;
  };
  window.addEventListener('popstate', function () { post(pageInfo()); });
  window.addEventListener('hashchange', function () { post(pageInfo()); });
  window.addEventListener('resize', function () { post(pageInfo()); });

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    post({ type: 'ready', url: pageUrl(), title: document.title || '', ua: navigator.userAgent || '', viewport: viewport(), secure: !!window.isSecureContext, cookiesEnabled: navigator.cookieEnabled !== false });
    dumpDevtools();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      post({ type: 'ready', url: pageUrl(), title: document.title || '', ua: navigator.userAgent || '', viewport: viewport(), secure: !!window.isSecureContext, cookiesEnabled: navigator.cookieEnabled !== false });
      dumpDevtools();
    });
  }
})();
`;
//#endregion
//#region src/shared/browser-url.ts
/** Address-bar URL: only http(s). Secrets stay in the href for fetch; UI must redact. */
const MAX_URL_LEN = 4096;
const LOOPBACK = /* @__PURE__ */ new Set([
	"localhost",
	"127.0.0.1",
	"::1",
	"[::1]"
]);
function normalizeBrowserUrl(raw) {
	const trimmed = raw.trim();
	if (trimmed === "" || trimmed.length > MAX_URL_LEN) return null;
	const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
	let url;
	try {
		url = new URL(candidate);
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	if (url.hostname === "") return null;
	return url.href;
}
function readBrowserViewTarget(requestUrl) {
	try {
		return normalizeBrowserUrl(new URL(requestUrl, "http://127.0.0.1").searchParams.get("u") ?? "");
	} catch {
		return null;
	}
}
function canonicalHost(hostname) {
	const host = hostname.toLowerCase();
	return LOOPBACK.has(host) ? "loopback" : host;
}
function originKey(url) {
	const port = url.port !== "" ? url.port : url.protocol === "https:" ? "443" : "80";
	return `${url.protocol}//${canonicalHost(url.hostname)}:${port}`;
}
function workbenchHrefFromHost(hostHeader, protocol = "http:") {
	return `${protocol}//${hostHeader.trim() || "127.0.0.1"}/`;
}
/**
* True when the address bar points at this same workbench origin
* (127.0.0.1 / localhost / ::1 on the same port). Opening that inside the
* embedded browser nests the app in itself and can stall the proxy fetch.
*/
function isWorkbenchSelfUrl(targetHref, workbenchHref) {
	const target = normalizeBrowserUrl(targetHref);
	const self = normalizeBrowserUrl(workbenchHref);
	if (target === null || self === null) return false;
	try {
		return originKey(new URL(target)) === originKey(new URL(self));
	} catch {
		return false;
	}
}
//#endregion
//#region src/host/browser-proxy.ts
const FETCH_TIMEOUT_MS = 2e4;
const MAX_HTML_BYTES = 2e6;
function escapeHtml(value) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function stripFramingHeaders(html) {
	return html.replace(/<meta\b[^>]*http-equiv=["']?Content-Security-Policy(?:-Report-Only)?["'][^>]*>/gi, "").replace(/<meta\b[^>]*http-equiv=["']?X-Frame-Options["'][^>]*>/gi, "");
}
/** Inline so `<base href>` cannot rewrite `/git/browser/inspect.js` onto the target origin. */
function inspectInlineTag() {
	return `<script data-dsh-inspect="1">${BROWSER_INSPECT_SCRIPT.replace(/<\/(script)/gi, "<\\/$1")}<\/script>`;
}
function injectBrowserHooks(html, pageUrl) {
	const stripped = stripFramingHeaders(html);
	const base = `<base href="${escapeHtml(pageUrl)}">`;
	const script = inspectInlineTag();
	if (/<head[\s>]/i.test(stripped)) return stripped.replace(/<head([^>]*)>/i, `<head$1>${base}${script}`);
	if (/<html[\s>]/i.test(stripped)) return stripped.replace(/<html([^>]*)>/i, `<html$1><head>${base}${script}</head>`);
	return `<!doctype html><head>${base}${script}</head>${stripped}`;
}
function browserFailPage(failBody, pageUrl) {
	const urlLine = pageUrl === void 0 || pageUrl === "" ? "" : `<p style="word-break:break-all;color:#666">${escapeHtml(redactSecrets(pageUrl))}</p>`;
	const payload = JSON.stringify({
		source: "dsh-workbench-browser",
		type: "fail",
		message: failBody.messageZh,
		hint: failBody.hintZh
	});
	return `<!doctype html>
<meta charset="utf-8">
<title>${escapeHtml(failBody.messageZh)}</title>
<body style="font:14px/1.5 system-ui,sans-serif;padding:24px;color:#222;background:#fafafa">
  <h1 style="font-size:16px">${escapeHtml(failBody.messageZh)}</h1>
  ${urlLine}
  <p>${escapeHtml(failBody.hintZh)}</p>
  <script>parent.postMessage(${payload}, '*')<\/script>
</body>`;
}
function inspectScriptBody() {
	return BROWSER_INSPECT_SCRIPT;
}
function headerOf(headers, name) {
	return headers.get(name) ?? headers.get(name.toLowerCase()) ?? "";
}
function isHtmlType(contentType) {
	const lower = contentType.toLowerCase();
	return lower.includes("text/html") || lower.includes("application/xhtml");
}
function isTextLike(contentType) {
	const lower = contentType.toLowerCase();
	return isHtmlType(contentType) || lower.startsWith("text/") || lower.includes("javascript") || lower.includes("json") || lower.includes("xml");
}
function errorDetail(error) {
	if (!(error instanceof Error)) return String(error);
	const cause = error.cause instanceof Error ? error.cause.message : "";
	return redactSecrets(cause !== "" ? `${error.message}: ${cause}` : error.message);
}
function requestHeaders(userAgent) {
	return {
		accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
		...userAgent !== void 0 && userAgent !== "" ? { "user-agent": userAgent } : {}
	};
}
async function fetchPage(url, userAgent, signal) {
	const response = await fetch(url, {
		method: "GET",
		redirect: "follow",
		signal,
		headers: requestHeaders(userAgent)
	});
	return {
		url: normalizeBrowserUrl(response.url) ?? url,
		contentType: headerOf(response.headers, "content-type") || "text/html; charset=utf-8",
		body: Buffer.from(await response.arrayBuffer())
	};
}
async function fetchBrowserPage(rawUrl, userAgent) {
	const url = normalizeBrowserUrl(rawUrl);
	if (url === null) return {
		ok: false,
		fail: fail("BROWSER_BAD_URL")
	};
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, FETCH_TIMEOUT_MS);
	try {
		const page = await fetchPage(url, userAgent, controller.signal);
		const finalUrl = page.url;
		if (page.body.byteLength > MAX_HTML_BYTES) return {
			ok: false,
			fail: fail("BROWSER_TOO_LARGE"),
			url: finalUrl
		};
		if (!isHtmlType(page.contentType) && !isTextLike(page.contentType) && page.body.byteLength > 0) return {
			ok: true,
			url: finalUrl,
			contentType: "text/html; charset=utf-8",
			body: `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(finalUrl)}</title></head><body><p>这个地址不是网页（${escapeHtml(page.contentType || "未知类型")}），没法点选元素。</p><p>请换成一个 http/https 网页地址。</p></body></html>`
		};
		return {
			ok: true,
			url: finalUrl,
			contentType: page.contentType,
			body: page.body.toString("utf8")
		};
	} catch (error) {
		if (controller.signal.aborted || error instanceof Error && error.message === "timeout") return {
			ok: false,
			fail: fail("BROWSER_TIMEOUT"),
			url
		};
		return {
			ok: false,
			fail: fail("BROWSER_FAILED", errorDetail(error)),
			url
		};
	} finally {
		clearTimeout(timer);
	}
}
const ALLOWED = /* @__PURE__ */ new Set(["mermaid.js"]);
/**
* Map a `/git/vendor/…` pathname to a whitelist file name.
* Anything with a slash, `..`, or an unknown name is rejected.
*/
function vendorAssetId(pathname) {
	if (!pathname.startsWith("/git/vendor/")) return void 0;
	const name = pathname.slice(12);
	if (name.includes("/") || name.includes("\\") || name.includes("..")) return void 0;
	if (!ALLOWED.has(name)) return void 0;
	return name;
}
//#endregion
//#region src/host/vendor-static.ts
const cache = /* @__PURE__ */ new Map();
function vendorDirFrom(moduleUrl) {
	const here = dirname(fileURLToPath(moduleUrl));
	const nextToBundle = join(here, "vendor");
	const fromSource = join(here, "..", "..", "lib", "vendor");
	if (existsSync(join(nextToBundle, "mermaid.js"))) return nextToBundle;
	if (existsSync(join(fromSource, "mermaid.js"))) return fromSource;
	return nextToBundle;
}
function etagOf(size, mtimeMs) {
	return `"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`;
}
async function loadVendor(dir, name) {
	const file = join(dir, name);
	if (!existsSync(file)) return void 0;
	const stat = statSync(file);
	const etag = etagOf(stat.size, stat.mtimeMs);
	const key = `${dir}\0${name}`;
	const hit = cache.get(key);
	if (hit !== void 0 && hit.etag === etag) return hit;
	const raw = await readFile(file);
	const next = {
		raw,
		gzip: gzipSync(raw, { level: 6 }),
		etag
	};
	cache.set(key, next);
	return next;
}
function wantsGzip(req) {
	const header = req.headers["accept-encoding"];
	const value = Array.isArray(header) ? header.join(",") : header;
	return typeof value === "string" && /\bgzip\b/i.test(value);
}
/** Serves `/git/vendor/mermaid.js`. Returns false when the path is not a vendor route. */
async function sendVendorAsset(req, res, pathname, dir) {
	const name = vendorAssetId(pathname);
	if (name === void 0) return false;
	const asset = await loadVendor(dir, name);
	if (asset === void 0) {
		res.statusCode = 404;
		res.setHeader("content-type", "text/plain; charset=utf-8");
		res.setHeader("cache-control", "no-store");
		res.end("找不到该脚本。请重新构建插件后再打开工作台。");
		return true;
	}
	const inm = req.headers["if-none-match"];
	if (typeof inm === "string" && inm === asset.etag) {
		res.statusCode = 304;
		res.setHeader("etag", asset.etag);
		res.setHeader("cache-control", "public, max-age=31536000, immutable");
		res.end();
		return true;
	}
	const gzip = wantsGzip(req);
	const body = gzip ? asset.gzip : asset.raw;
	res.statusCode = 200;
	res.setHeader("content-type", "text/javascript; charset=utf-8");
	res.setHeader("cache-control", "public, max-age=31536000, immutable");
	res.setHeader("etag", asset.etag);
	res.setHeader("vary", "accept-encoding");
	if (gzip) res.setHeader("content-encoding", "gzip");
	res.setHeader("content-length", String(body.length));
	res.end(body);
	return true;
}
//#endregion
//#region src/host/http.ts
function sendHtml(res, status, html) {
	res.statusCode = status;
	res.setHeader("content-type", "text/html; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.end(html);
}
function send$1(res, status, body) {
	const json = JSON.stringify(redactFail(body));
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.end(json);
}
function readBody$1(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 1e6) {
				reject(/* @__PURE__ */ new Error("body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			resolve(Buffer.concat(chunks).toString("utf8"));
		});
		req.on("error", reject);
	});
}
async function readJson$1(req) {
	const raw = await readBody$1(req);
	if (raw.trim() === "") return {};
	const parsed = JSON.parse(raw);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("invalid json");
	return parsed;
}
function query(url, key) {
	const value = url.searchParams.get(key);
	return value === null || value === "" ? void 0 : value;
}
function redactFail(body) {
	if (typeof body !== "object" || body === null || !("ok" in body) || body.ok !== false) return body;
	const failBody = body;
	return {
		...failBody,
		messageZh: redactSecrets(failBody.messageZh),
		hintZh: redactSecrets(failBody.hintZh)
	};
}
function asStringArray(value) {
	if (!Array.isArray(value)) return [];
	return value.filter((item) => typeof item === "string");
}
async function wrap(run) {
	try {
		return {
			ok: true,
			value: await run()
		};
	} catch (error) {
		return toFail(error);
	}
}
async function writeCommitMessageStream(res, run) {
	const controller = new AbortController();
	let closed = false;
	const abort = () => {
		closed = true;
		controller.abort();
	};
	const onResponseClose = () => {
		if (!res.writableEnded) abort();
	};
	res.on("close", onResponseClose);
	res.statusCode = 200;
	res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.setHeader("connection", "keep-alive");
	res.setHeader("x-accel-buffering", "no");
	const writeLine = (body) => {
		if (!res.writable || res.writableEnded) return;
		res.write(`${JSON.stringify(redactFail(body))}\n`);
	};
	try {
		for await (const event of run(controller.signal)) {
			if (controller.signal.aborted) break;
			if (event.type === "delta") writeLine({
				type: "delta",
				text: redactSecrets(event.text)
			});
			else writeLine({
				type: "done",
				message: redactSecrets(event.message)
			});
		}
	} catch (error) {
		if (!closed && !res.destroyed) writeLine(toFail(error));
	} finally {
		res.off("close", onResponseClose);
		if (!res.writableEnded) res.end();
	}
}
/** Register the `/git` JSON API used by the sidebar panel and workbench. */
function registerGitHttp(ctx, git, fs, editors = new ExternalOpen(fs), term = new TerminalHub()) {
	const server = ctx.webServer;
	if (server === void 0) throw new Error("dsh-workbench-plugin: 需要 webServer 才能提供工作台接口，请把本插件装到 web profile。");
	const handler = async (req, res) => {
		const host = req.headers.host ?? "127.0.0.1";
		const url = new URL(req.url ?? "/git", `http://${host}`);
		const route = url.pathname.replace(/\/+$/, "") || "/git";
		const method = (req.method ?? "GET").toUpperCase();
		if (method === "OPTIONS") {
			res.statusCode = 204;
			res.end();
			return;
		}
		if (method === "GET" && route.startsWith("/git/vendor/")) {
			if (!await sendVendorAsset(req, res, route, vendorDirFrom(import.meta.url))) {
				res.statusCode = 404;
				res.setHeader("content-type", "text/plain; charset=utf-8");
				res.setHeader("cache-control", "no-store");
				res.end("没有这个脚本。");
			}
			return;
		}
		if (method === "GET" && route === "/git/browser/inspect.js") {
			res.statusCode = 200;
			res.setHeader("content-type", "application/javascript; charset=utf-8");
			res.setHeader("cache-control", "no-store");
			res.end(inspectScriptBody());
			return;
		}
		if (method === "GET" && route === "/git/browser/view") {
			const target = readBrowserViewTarget(req.url ?? "");
			if (target === null) {
				sendHtml(res, 400, browserFailPage(fail("BROWSER_BAD_URL")));
				return;
			}
			if (isWorkbenchSelfUrl(target, workbenchHrefFromHost(host))) {
				sendHtml(res, 400, browserFailPage(fail("BROWSER_SELF"), target));
				return;
			}
			const ua = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : void 0;
			try {
				const page = await fetchBrowserPage(target, ua);
				if (!page.ok) {
					sendHtml(res, 502, browserFailPage(page.fail, page.url ?? target));
					return;
				}
				sendHtml(res, 200, injectBrowserHooks(page.body, page.url));
			} catch (error) {
				sendHtml(res, 502, browserFailPage(toFail(error), target));
			}
			return;
		}
		const workspaceId = query(url, "workspaceId");
		const rootOf = (body) => {
			return resolveWorkspacePath(ctx, typeof body?.workspaceId === "string" ? body.workspaceId : workspaceId);
		};
		const repoOf = (body) => {
			if (typeof body?.repo === "string" && body.repo !== "") return body.repo;
			return query(url, "repo");
		};
		const gitRootOf = (body) => {
			return resolveNearbyGitPath(rootOf(body), repoOf(body));
		};
		let result;
		try {
			if (method === "GET" && route === "/git/nearby") result = await wrap(() => scanNearbyGit(rootOf()));
			else if (method === "GET" && route === "/git/probe") result = await wrap(async () => git.probe(await gitRootOf()));
			else if (method === "GET" && route === "/git/identity") result = await wrap(async () => git.identity(await gitRootOf()));
			else if (method === "POST" && route === "/git/init") {
				const body = await readJson$1(req);
				const name = typeof body.name === "string" ? body.name : "";
				const email = typeof body.email === "string" ? body.email : "";
				const branch = typeof body.branch === "string" ? body.branch : "";
				if (!isCurrentRepoId(repoOf(body))) result = fail("UNKNOWN_REPO");
				else result = await wrap(() => git.initRepo(rootOf(body), {
					name,
					email,
					branch
				}));
			} else if (method === "GET" && route === "/git/status") result = await wrap(async () => git.status(await gitRootOf()));
			else if (method === "GET" && route === "/git/diff") {
				const path = query(url, "path");
				const staged = query(url, "staged") === "1";
				result = await wrap(async () => git.diff(await gitRootOf(), path, staged));
			} else if (method === "GET" && route === "/git/log") {
				const limit = Number(query(url, "limit") ?? "80");
				result = await wrap(async () => git.log(await gitRootOf(), Number.isFinite(limit) ? limit : 80));
			} else if (method === "GET" && route === "/git/branches") result = await wrap(async () => git.branches(await gitRootOf()));
			else if (method === "POST" && route === "/git/stage") {
				const body = await readJson$1(req);
				result = await wrap(async () => {
					await git.stage(await gitRootOf(body), asStringArray(body.paths));
					return { done: true };
				});
			} else if (method === "POST" && route === "/git/unstage") {
				const body = await readJson$1(req);
				result = await wrap(async () => {
					await git.unstage(await gitRootOf(body), asStringArray(body.paths));
					return { done: true };
				});
			} else if (method === "POST" && route === "/git/restore") {
				const body = await readJson$1(req);
				result = await wrap(async () => {
					await git.restore(await gitRootOf(body), asStringArray(body.paths));
					return { done: true };
				});
			} else if (method === "POST" && route === "/git/commit") {
				const body = await readJson$1(req);
				const message = typeof body.message === "string" ? body.message : "";
				const all = body.all === true;
				result = await wrap(async () => git.commit(await gitRootOf(body), message, all));
			} else if (method === "POST" && route === "/git/commit-message/stream") {
				const body = await readJson$1(req);
				const gitRoot = await gitRootOf(body);
				await writeCommitMessageStream(res, (signal) => streamCommitMessage(ctx, git, gitRoot, {
					signal,
					template: typeof body.template === "string" ? body.template : void 0
				}));
				return;
			} else if (method === "POST" && route === "/git/term/assist/stream") {
				const body = await readJson$1(req);
				const text = typeof body.text === "string" ? body.text : "";
				await writeCommitMessageStream(res, (signal) => streamTermAssist(ctx, {
					signal,
					text,
					cwd: typeof body.cwd === "string" ? body.cwd : void 0,
					transcript: typeof body.transcript === "string" ? body.transcript : void 0,
					template: typeof body.template === "string" ? body.template : void 0,
					prefs: body.prefs
				}));
				return;
			} else if (method === "POST" && route === "/git/commit-message") {
				const body = await readJson$1(req);
				result = await wrap(async () => {
					return { message: await generateCommitMessage(ctx, git, await gitRootOf(body), { template: typeof body.template === "string" ? body.template : void 0 }) };
				});
			} else if (method === "POST" && route === "/git/push") {
				const body = await readJson$1(req);
				result = await wrap(async () => git.push(await gitRootOf(body), void 0, parsePushMode(body.pushMode)));
			} else if (method === "POST" && route === "/git/pull") {
				const body = await readJson$1(req);
				result = await wrap(async () => git.pull(await gitRootOf(body), void 0, parsePullMode(body.pullMode)));
			} else if (method === "POST" && route === "/git/fetch") {
				const body = await readJson$1(req);
				result = await wrap(async () => git.fetch(await gitRootOf(body)));
			} else if (method === "POST" && route === "/git/create-branch") {
				const body = await readJson$1(req);
				const name = typeof body.name === "string" ? body.name : "";
				result = await wrap(async () => git.createBranch(await gitRootOf(body), name));
			} else if (method === "POST" && route === "/git/merge") {
				const body = await readJson$1(req);
				const name = typeof body.name === "string" ? body.name : "";
				result = await wrap(async () => git.mergeBranch(await gitRootOf(body), name));
			} else if (method === "POST" && route === "/git/switch") {
				const body = await readJson$1(req);
				const name = typeof body.name === "string" ? body.name : "";
				result = await wrap(async () => git.switchBranch(await gitRootOf(body), name));
			} else if (method === "GET" && route === "/git/fs/list") result = await wrap(() => fs.list(rootOf(), query(url, "path") ?? ""));
			else if (method === "GET" && route === "/git/fs/search") result = await wrap(() => fs.search(rootOf(), query(url, "q") ?? "", query(url, "hidden") === "1"));
			else if (method === "GET" && route === "/git/fs/read") {
				const path = query(url, "path");
				if (path === void 0) result = fail("BAD_REQUEST");
				else result = await wrap(() => fs.read(rootOf(), path));
			} else if (method === "GET" && route === "/git/fs/img") {
				const path = query(url, "path");
				if (path === void 0) {
					send$1(res, 400, fail("BAD_REQUEST"));
					return;
				}
				try {
					const image = await fs.readImage(rootOf(), path);
					res.statusCode = 200;
					res.setHeader("content-type", image.mime);
					res.setHeader("cache-control", "no-store");
					res.end(image.buffer);
				} catch (error) {
					send$1(res, 400, toFail(error));
				}
				return;
			} else if (method === "GET" && route === "/git/fs/raw") {
				const path = query(url, "path");
				if (path === void 0) {
					send$1(res, 400, fail("BAD_REQUEST"));
					return;
				}
				try {
					const data = await fs.readData(rootOf(), path);
					res.statusCode = 200;
					res.setHeader("content-type", data.mime);
					res.setHeader("cache-control", "no-store");
					res.end(data.buffer);
				} catch (error) {
					send$1(res, 400, toFail(error));
				}
				return;
			} else if (method === "POST" && route === "/git/fs/rename") {
				const body = await readJson$1(req);
				const from = typeof body.from === "string" ? body.from : "";
				const to = typeof body.to === "string" ? body.to : "";
				if (from === "" || to === "") result = fail("BAD_REQUEST");
				else result = await wrap(() => fs.rename(rootOf(body), from, to));
			} else if (method === "POST" && route === "/git/fs/delete") {
				const body = await readJson$1(req);
				const path = typeof body.path === "string" ? body.path : "";
				if (path === "") result = fail("BAD_REQUEST");
				else result = await wrap(() => fs.delete(rootOf(body), path));
			} else if (method === "POST" && route === "/git/fs/mkdir") {
				const body = await readJson$1(req);
				const path = typeof body.path === "string" ? body.path : "";
				if (path === "") result = fail("BAD_REQUEST");
				else result = await wrap(() => fs.mkdir(rootOf(body), path));
			} else if (method === "POST" && route === "/git/fs/copy") {
				const body = await readJson$1(req);
				const from = typeof body.from === "string" ? body.from : "";
				const to = typeof body.to === "string" ? body.to : "";
				if (from === "" || to === "") result = fail("BAD_REQUEST");
				else result = await wrap(() => fs.copy(rootOf(body), from, to));
			} else if (method === "POST" && route === "/git/fs/reveal") {
				const body = await readJson$1(req);
				const path = typeof body.path === "string" ? body.path : "";
				result = await wrap(() => editors.reveal(rootOf(body), path));
			} else if (method === "GET" && route === "/git/commit-files") {
				const hash = query(url, "hash");
				if (hash === void 0) result = fail("BAD_REQUEST");
				else result = await wrap(async () => git.commitFiles(await gitRootOf(), hash));
			} else if (method === "GET" && route === "/git/commit-diff") {
				const hash = query(url, "hash");
				const path = query(url, "path");
				if (hash === void 0 || path === void 0) result = fail("BAD_REQUEST");
				else result = await wrap(async () => git.commitDiff(await gitRootOf(), hash, path));
			} else if (method === "POST" && route === "/git/fs/write") {
				const body = await readJson$1(req);
				const path = typeof body.path === "string" ? body.path : "";
				const content = typeof body.content === "string" ? body.content : null;
				if (path === "" || content === null) result = fail("BAD_REQUEST");
				else result = await wrap(() => fs.write(rootOf(body), path, content));
			} else if (method === "GET" && route === "/git/fs/editors") result = await wrap(() => editors.list());
			else if (method === "POST" && route === "/git/fs/open") {
				const body = await readJson$1(req);
				const path = typeof body.path === "string" ? body.path : "";
				const app = typeof body.app === "string" ? body.app : void 0;
				result = await wrap(() => editors.open(rootOf(body), path, app));
			} else if (method === "GET" && route === "/git/term/stream") {
				const id = workspaceId;
				if (id === void 0) result = fail("NO_WORKSPACE");
				else {
					const cols = Number(query(url, "cols") ?? "80");
					const rows = Number(query(url, "rows") ?? "24");
					await term.attach(id, rootOf(), res, cols, rows, sanitizeTermId(query(url, "termId")));
					return;
				}
			} else if (method === "POST" && route === "/git/term/write") {
				const body = await readJson$1(req);
				const data = typeof body.data === "string" ? body.data : "";
				result = await wrap(() => term.write(typeof body.workspaceId === "string" ? body.workspaceId : workspaceId ?? "", rootOf(body), data, 80, 24, sanitizeTermId(body.termId)));
			} else if (method === "POST" && route === "/git/term/resize") {
				const body = await readJson$1(req);
				result = await wrap(() => term.resize(typeof body.workspaceId === "string" ? body.workspaceId : workspaceId ?? "", rootOf(body), Number(body.cols), Number(body.rows), sanitizeTermId(body.termId)));
			} else if (method === "POST" && route === "/git/term/interrupt") {
				const body = await readJson$1(req);
				result = await wrap(() => term.interrupt(typeof body.workspaceId === "string" ? body.workspaceId : workspaceId ?? "", rootOf(body), sanitizeTermId(body.termId)));
			} else if (method === "POST" && route === "/git/term/close") {
				const body = await readJson$1(req);
				result = await wrap(() => term.close(typeof body.workspaceId === "string" ? body.workspaceId : workspaceId ?? "", sanitizeTermId(body.termId)));
			} else if (method === "GET" && route === "/git/update") result = await wrap(() => checkPluginUpdate());
			else if (method === "GET" && route === "/git/usage") result = await wrap(() => readProviderUsage(ctx, query(url, "sessionId")));
			else if (method === "POST" && route === "/git/term/restart") {
				const body = await readJson$1(req);
				result = await wrap(() => term.restart(typeof body.workspaceId === "string" ? body.workspaceId : workspaceId ?? "", rootOf(body), Number(body.cols), Number(body.rows), sanitizeTermId(body.termId)));
			} else result = fail("BAD_REQUEST");
		} catch (error) {
			result = toFail(error);
		}
		send$1(res, result.ok ? 200 : 400, result);
	};
	const dispose = server.register({
		kind: "prefix",
		path: "/git",
		handler
	});
	return () => {
		term.disposeAll();
		dispose();
	};
}
//#endregion
//#region src/host/tools.ts
function cwdOf(ctx, exec) {
	return resolveWorkspacePath(ctx, void 0, exec.agent?.session?.header?.cwd);
}
function text(value) {
	return [{
		type: "text",
		text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
	}];
}
function failPayload(error) {
	const fail = toFail(error);
	return {
		ok: false,
		code: fail.code,
		message: fail.messageZh,
		hint: fail.hintZh
	};
}
/** Register model-facing git_* tools. Read-only except commit (user must approve). No delete / reset --hard / clean. */
function registerGitTools(ctx, git) {
	const disposeStatus = ctx.tools.register(defineTool({
		name: "git_status",
		description: "Show git status of the current workspace: branch, ahead/behind, staged, unstaged, and untracked files.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {}
			},
			render: (_args, value) => text(value)
		},
		async execute(_args, exec) {
			try {
				return {
					ok: true,
					...await git.status(cwdOf(ctx, exec), exec.signal)
				};
			} catch (error) {
				return failPayload(error);
			}
		},
		presentCall: () => ({
			card: "generic",
			title: "Git 状态",
			kind: "search"
		})
	}));
	const disposeDiff = ctx.tools.register(defineTool({
		name: "git_diff",
		description: "Show a git diff. Optional path limits the file; staged=true uses the index.",
		parameters: {
			path: {
				type: "string",
				description: "Repository-relative file path"
			},
			staged: {
				type: "boolean",
				description: "If true, show staged diff"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {}
			},
			render: (_args, value) => text(value)
		},
		async execute(args, exec) {
			try {
				const path = typeof args.path === "string" ? args.path : void 0;
				const staged = args.staged === true;
				return {
					ok: true,
					...await git.diff(cwdOf(ctx, exec), path, staged, exec.signal)
				};
			} catch (error) {
				return failPayload(error);
			}
		},
		presentCall: (args) => ({
			card: "diff",
			title: args.path ? `Git diff ${args.path}` : "Git diff",
			diffs: [{
				path: typeof args.path === "string" ? args.path : ".",
				oldText: "",
				newText: ""
			}]
		})
	}));
	const disposeLog = ctx.tools.register(defineTool({
		name: "git_log",
		description: "Show recent git commits in the current workspace.",
		parameters: { limit: {
			type: "number",
			description: "Number of commits, default 20, max 100. Includes local branches, remotes, and tags."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {}
			},
			render: (_args, value) => text(value)
		},
		async execute(args, exec) {
			try {
				const limit = typeof args.limit === "number" ? args.limit : 20;
				return {
					ok: true,
					entries: await git.log(cwdOf(ctx, exec), limit, exec.signal)
				};
			} catch (error) {
				return failPayload(error);
			}
		},
		presentCall: () => ({
			card: "generic",
			title: "Git 提交历史"
		})
	}));
	const disposeBranch = ctx.tools.register(defineTool({
		name: "git_branch",
		description: "List local branches, or switch to an existing local branch. Switching is refused when the worktree is dirty. Does not create branches or touch remotes.",
		parameters: {
			action: {
				type: "string",
				required: true,
				description: "list or switch",
				enum: ["list", "switch"]
			},
			name: {
				type: "string",
				description: "Existing local branch name when action is switch"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {}
			},
			render: (_args, value) => text(value)
		},
		async execute(args, exec) {
			try {
				const root = cwdOf(ctx, exec);
				if (args.action === "switch") {
					if (typeof args.name !== "string" || args.name.trim() === "") throw new GitError("BRANCH_MISSING");
					return {
						ok: true,
						...await git.switchBranch(root, args.name, exec.signal)
					};
				}
				return {
					ok: true,
					branches: await git.branches(root, exec.signal)
				};
			} catch (error) {
				return failPayload(error);
			}
		},
		presentCall: (args) => ({
			card: "generic",
			title: args.action === "switch" ? `切换分支 ${args.name ?? ""}` : "Git 分支"
		})
	}));
	const disposeCommit = ctx.tools.register(defineTool({
		name: "git_commit",
		description: "Create a git commit from already-staged files. Requires a non-empty message. Does not stage, delete, restore, reset, push, or amend. The user must approve this call.",
		parameters: { message: {
			type: "string",
			required: true,
			description: "Commit message"
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {}
			},
			render: (_args, value) => text(value)
		},
		async execute(args, exec) {
			try {
				if (typeof args.message !== "string") throw new GitError("EMPTY_MESSAGE");
				return {
					ok: true,
					...await git.commit(cwdOf(ctx, exec), args.message, exec.signal)
				};
			} catch (error) {
				return failPayload(error);
			}
		},
		presentCall: (args) => ({
			card: "generic",
			title: "Git 提交",
			content: typeof args.message === "string" ? args.message : ""
		})
	}));
	const offAsk = ctx.on("tools/pre-execute", async (exec, next) => {
		if (exec.name !== "git_commit") return next();
		return {
			kind: "ask",
			reason: "提交会写入 Git 历史。请确认提交说明和已暂存文件后再允许。"
		};
	});
	return () => {
		disposeStatus();
		disposeDiff();
		disposeLog();
		disposeBranch();
		disposeCommit();
		offAsk();
	};
}
//#endregion
//#region src/shared/ultra-slash/ids.ts
/** Stable identity for slash grouping, HTTP prefix, and the on-disk store. */
const PLUGIN_NAME = "deepseek-harness-ultra-slash";
const COMMAND_NAME = "steer";
//#endregion
//#region src/host/ultra-slash/http.ts
const HTTP_PREFIX$1 = "/ultra-slash";
function send(res, status, body) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.end(JSON.stringify(body));
}
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 1e6) {
				reject(/* @__PURE__ */ new Error("body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			resolve(Buffer.concat(chunks).toString("utf8"));
		});
		req.on("error", reject);
	});
}
async function readJson(req) {
	const raw = await readBody(req);
	if (raw.trim() === "") return {};
	const parsed = JSON.parse(raw);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("invalid json");
	return parsed;
}
function asCommandRows(value) {
	if (!Array.isArray(value)) return void 0;
	const rows = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null) return void 0;
		const row = item;
		if (typeof row.name !== "string" || typeof row.steerText !== "string") return void 0;
		rows.push({
			name: row.name,
			steerText: row.steerText,
			...typeof row.description === "string" ? { description: row.description } : {}
		});
	}
	return rows;
}
async function handleUltraSlashRequest(req, res, hub) {
	const host = req.headers.host ?? "127.0.0.1";
	const route = new URL(req.url ?? "/ultra-slash", `http://${host}`).pathname.replace(/\/+$/, "") || "/ultra-slash";
	const method = (req.method ?? "GET").toUpperCase();
	if (method === "OPTIONS") {
		res.statusCode = 204;
		res.end();
		return;
	}
	try {
		if (method === "GET" && route === `/ultra-slash/commands`) {
			send(res, 200, {
				ok: true,
				value: {
					commands: hub.listCustom(),
					...hub.loadError() === void 0 ? {} : { warning: hub.loadError() }
				}
			});
			return;
		}
		if (method === "PUT" && route === `/ultra-slash/commands`) {
			const rows = asCommandRows((await readJson(req)).commands);
			if (rows === void 0) {
				send(res, 400, {
					ok: false,
					message: "请求格式不对。需要 { \"commands\": [ { \"name\", \"steerText\", \"description?\" } ] }。"
				});
				return;
			}
			const result = await hub.saveCustom(rows);
			send(res, result.ok ? 200 : 400, result);
			return;
		}
		send(res, 404, {
			ok: false,
			message: "没有这个接口。"
		});
	} catch (error) {
		send(res, 400, {
			ok: false,
			message: error instanceof Error ? error.message : String(error)
		});
	}
}
function registerUltraSlashHttp(server, hub) {
	return server.register({
		kind: "prefix",
		path: HTTP_PREFIX$1,
		handler: (req, res) => {
			handleUltraSlashRequest(req, res, hub);
		}
	});
}
//#endregion
//#region src/shared/ultra-slash/catalog.ts
/** DSH command names: lowercase letter, then letters / digits / _ / -. */
const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/u;
const MAX_STEER_TEXT_LENGTH = 8e3;
/**
* Shipped commands, in menu order. `/steer` is the primitive; `/skill` and
* `/docs` are fixed-text aliases of it; `/new` opens a blank session on the client.
*/
const BUILTIN_SLASH_COMMANDS = [
	{
		name: "steer",
		kind: "steer",
		descriptionKey: "steer.description",
		hintKey: "steer.hint"
	},
	{
		name: "new",
		kind: "session",
		descriptionKey: "new.description"
	},
	{
		name: "skill",
		kind: "alias",
		descriptionKey: "skill.description",
		hintKey: "alias.hint",
		payloadKey: "skill.payload"
	},
	{
		name: "docs",
		kind: "alias",
		descriptionKey: "docs.description",
		hintKey: "alias.hint",
		payloadKey: "docs.payload"
	}
];
const BUILTIN_SLASH_NAMES = new Set(BUILTIN_SLASH_COMMANDS.map((command) => command.name));
/**
* Well-known DSH command names we refuse to shadow. A collision with a
* command that is actually registered is still caught at `commands.register`.
*/
const DSH_RESERVED_NAMES = /* @__PURE__ */ new Set([
	"help",
	"plan",
	"goal",
	"compact",
	"feedback",
	"export",
	"permission",
	"model",
	"theme",
	"clear",
	"status",
	"commands",
	"resume",
	"fork"
]);
const RESERVED_SLASH_NAMES = /* @__PURE__ */ new Set([...BUILTIN_SLASH_NAMES, ...DSH_RESERVED_NAMES]);
/** Strip a leading `/` and lowercase so "Review" / "/review" become `review`. */
function normalizeCommandName(raw) {
	return raw.trim().replace(/^\//, "").toLowerCase();
}
function trimDescription(raw) {
	return raw.trim().slice(0, 80);
}
function defaultDescription(steerText) {
	const text = steerText.trim().replace(/\s+/g, " ");
	if (text.length <= 80) return text;
	return `${text.slice(0, 79)}…`;
}
/**
* Validate one custom command. `taken` is other names already in the list
* (not including this row's current name when renaming).
*/
function validateCustomCommand(input, taken = /* @__PURE__ */ new Set()) {
	const name = normalizeCommandName(input.name);
	if (name.length === 0) return {
		ok: false,
		issue: { code: "name.empty" }
	};
	if (name.length > 32) return {
		ok: false,
		issue: {
			code: "name.tooLong",
			name,
			max: 32
		}
	};
	if (!COMMAND_NAME_PATTERN.test(name)) return {
		ok: false,
		issue: {
			code: "name.invalid",
			name
		}
	};
	if (RESERVED_SLASH_NAMES.has(name)) return {
		ok: false,
		issue: {
			code: "name.reserved",
			name
		}
	};
	if (taken.has(name)) return {
		ok: false,
		issue: {
			code: "name.taken",
			name
		}
	};
	const description = trimDescription(input.description ?? "");
	if ((input.description ?? "").trim().length > 80) return {
		ok: false,
		issue: {
			code: "description.tooLong",
			max: 80
		}
	};
	const steerText = input.steerText.trim();
	if (steerText.length === 0) return {
		ok: false,
		issue: { code: "text.empty" }
	};
	if (steerText.length > 8e3) return {
		ok: false,
		issue: {
			code: "text.tooLong",
			max: MAX_STEER_TEXT_LENGTH
		}
	};
	return {
		ok: true,
		command: {
			name,
			description: description.length > 0 ? description : defaultDescription(steerText),
			steerText
		}
	};
}
/** Validate a full replacement list. First error wins so the UI can point at one field. */
function validateCustomList(rows) {
	if (rows.length > 40) return {
		ok: false,
		issue: {
			code: "tooMany",
			max: 40
		}
	};
	const commands = [];
	const seen = /* @__PURE__ */ new Set();
	for (const row of rows) {
		const result = validateCustomCommand(row, seen);
		if (!result.ok) {
			if (result.issue.code === "name.taken") return {
				ok: false,
				issue: {
					code: "list.duplicate",
					name: result.issue.name
				}
			};
			return result;
		}
		seen.add(result.command.name);
		commands.push(result.command);
	}
	return {
		ok: true,
		commands
	};
}
/** Join the builtin payload with an optional extra suffix from `/name extra`. */
function composeAliasText(template, rawInput) {
	const extra = rawInput.trim();
	if (extra.length === 0) return template;
	return `${template}\n${extra}`;
}
//#endregion
//#region src/host/ultra-slash/message.ts
/** Build one user-role next-step message. Shape matches DSH `createUserMessage`. */
function createSteerMessage(text) {
	const message = {
		id: crypto.randomUUID(),
		role: "user",
		content: [{
			type: "text",
			text
		}],
		source: { kind: "user" }
	};
	return Object.freeze(message);
}
//#endregion
//#region src/shared/ultra-slash/locales.ts
/** Simplified Chinese dictionary (the key-set source of truth). */
const zh = {
	"menu.group": "插件命令",
	"steer.description": "不打断当前对话，把内容注入到模型下一步",
	"steer.hint": "<引导内容>",
	"steer.usage": "用法：/steer <引导内容>",
	"steer.example": "示例：/steer 先不要改代码，只列出将要改的文件",
	"steer.empty": "请写明要告诉模型的内容，然后再发送。\n{usage}\n{example}\n\n这条命令不会停止当前对话：模型正在跑时，内容会在下一次访问大模型时注入；模型空闲时，会立刻开始下一步。",
	"steer.queued.running": "已排队到下一步，当前对话不会被打断、也不需要点停止。\n模型下一次访问大模型时会看到：\n{quoted}",
	"steer.queued.idle": "已提交引导，即将开始下一步。\n模型会看到：\n{quoted}",
	"steer.cancelled": "引导已取消，没有注入给模型。",
	"steer.failed": "引导没有送出：{detail}\n当前对话没有被打断。可以改写内容后重新执行 /steer。",
	"steer.preview": "{preview}…\n（已完整排队，共 {count} 字；上面只是预览）",
	"steer.unknownError": "未知错误",
	"new.description": "开启新会话；后面跟的内容会作为第一句话直接发出",
	"new.hint": "<第一句话，可空>",
	"new.ok": "已切到空白会话。之前正在跑的对话不会被停止，可在左侧列表里点回去。",
	"new.started": "已创建新会话，正在发送你的输入：\n{quoted}",
	"new.unavailable": "现在还不能从这里开新会话。请点左侧栏的「新会话」按钮。",
	"alias.hint": "<补充说明，可空>",
	"skill.description": "完成后把刚才的方案存成当前项目的 skill，不打断对话",
	"skill.payload": "完成任务后将刚才的方案创建保存为当前项目下的skill备用",
	"docs.description": "完成后把问题原因和解决方案写成 md，放到 docs 目录，不打断对话",
	"docs.payload": "完成任务后将问题原因和解决方案输出为md文档写入到docs目录下",
	"catalog.issue.name.empty": "请填写命令名。不用写斜杠，填 review 就会变成 /review。",
	"catalog.issue.name.invalid": "命令名 /{name} 不合规。请用小写英文字母开头，后面只能是字母、数字、连字符或下划线。例如 review、save-note。中文请写在下面的「注入内容」里。",
	"catalog.issue.name.tooLong": "命令名太长（最多 {max} 个字符）。请缩短后再试。",
	"catalog.issue.name.reserved": "/{name} 是内置或系统命令，不能占用。请换一个名字，例如 my-{name}。",
	"catalog.issue.name.taken": "已经有 /{name} 了。请换个名字，或者先删掉原来的再添加。",
	"catalog.issue.description.tooLong": "说明太长（最多 {max} 个字）。请缩短后再试。",
	"catalog.issue.text.empty": "请填写发送后要告诉模型的内容。这条命令不会打断当前对话，效果和 /steer 一样。",
	"catalog.issue.text.tooLong": "注入内容太长（最多 {max} 个字）。请缩短后再试。",
	"catalog.issue.tooMany": "最多 {max} 条自定义命令。请先删掉不用的，再添加新的。",
	"catalog.issue.list.duplicate": "列表里出现了两个 /{name}。每个名字只能有一条。",
	"catalog.issue.occupied": "命令名 /{name} 已经被 DeepSeek Harness 占用，请换一个名字。",
	"catalog.issue.corrupt": "自定义命令配置文件损坏，没有覆盖保存。请检查 {path}，修好或删掉后再试。",
	"catalog.issue.io": "没能读写配置文件：{detail}。请确认 DeepSeek Harness 对 {path} 有写权限。",
	"catalog.issue.network": "没保存成功：连不上 DeepSeek Harness。请确认网页还开着，然后重试。",
	"catalog.issue.unknown": "没保存成功：{detail}",
	"settings.nav": "插件命令",
	"settings.title": "插件命令",
	"settings.intro": "在这里管理斜杠命令。它们会出现在输入框 / 菜单最下面的「插件命令」分组。自定义命令发送后，会把固定内容注入模型下一步，当前对话不会被打断。所有会话共用这份名单，保存在本机。",
	"settings.builtinTitle": "内置命令",
	"settings.builtinHint": "这四条不能改名或删除。/steer 是基础能力；另外三条是快捷写法。",
	"settings.customTitle": "自定义命令",
	"settings.customHint": "给常用的 /steer 内容起一个短名字。例如填 review，之后输入 /review 就等于发送那段固定内容。",
	"settings.empty": "还没有自定义命令。下面填好名字和要注入的内容，点「添加」。",
	"settings.nameLabel": "命令名",
	"settings.nameHint": "不用写斜杠。只能用小写英文字母、数字、连字符、下划线。",
	"settings.namePreview": "发送时输入 {slash}",
	"settings.descriptionLabel": "菜单说明（可选）",
	"settings.descriptionHint": "出现在 / 菜单这一行的右边。不填的话，会用注入内容的前几句。",
	"settings.textLabel": "注入内容",
	"settings.textHint": "发送这条命令后，模型下一步会看到这些文字。不会停止当前对话。",
	"settings.textPlaceholder": "例如：完成当前改动后，只总结测试结果，不要再改代码",
	"settings.add": "添加命令",
	"settings.adding": "正在添加…",
	"settings.save": "保存",
	"settings.saving": "正在保存…",
	"settings.cancel": "取消",
	"settings.edit": "编辑",
	"settings.delete": "删除",
	"settings.deleteConfirm": "确定删除 {slash}？删除后输入这个命令不会再生效。",
	"settings.deleteYes": "确定删除",
	"settings.added": "已添加 {slash}。现在就可以在输入框输入这个命令，当前对话不会被打断。",
	"settings.saved": "已保存 {slash}。",
	"settings.deleted": "已删除 {slash}。",
	"settings.loadFailed": "自定义命令名单加载失败。",
	"settings.retry": "重新加载",
	"settings.loading": "正在加载自定义命令…",
	"settings.maxReached": "已经有 {max} 条自定义命令。先删掉不用的，才能再添加。",
	"settings.rowKindSteer": "基础",
	"settings.rowKindAlias": "快捷",
	"settings.rowKindSession": "会话",
	"settings.rowKindCustom": "自定义"
};
/** English dictionary, checked complete against the zh key set. */
const en = {
	"menu.group": "Ultra Slash",
	"steer.description": "Inject guidance into the next model step without interrupting the turn",
	"steer.hint": "<guidance>",
	"steer.usage": "Usage: /steer <guidance>",
	"steer.example": "Example: /steer list the files you would change, do not edit yet",
	"steer.empty": "Write the guidance for the model, then send.\n{usage}\n{example}\n\nThis command does not stop the current turn: while the model is running, the text is injected on the next model access; if it is idle, the next step starts immediately.",
	"steer.queued.running": "Queued for the next step. The current turn is not interrupted and you do not need to press Stop.\nThe model will see this on the next model access:\n{quoted}",
	"steer.queued.idle": "Guidance submitted. The next step will start now.\nThe model will see:\n{quoted}",
	"steer.cancelled": "Guidance cancelled. Nothing was injected.",
	"steer.failed": "Guidance was not sent: {detail}\nThe current turn was not interrupted. You can edit the text and run /steer again.",
	"steer.preview": "{preview}…\n(Queued in full, {count} characters; preview only above)",
	"steer.unknownError": "Unknown error",
	"new.description": "Start a new session; text after the command is sent as the first message",
	"new.hint": "<first message, optional>",
	"new.ok": "Switched to a blank session. A running turn was not stopped; you can switch back from the sidebar.",
	"new.started": "Created a new session; sending your input now:\n{quoted}",
	"new.unavailable": "A new session cannot be started from here. Use the New session button in the sidebar.",
	"alias.hint": "<optional extra>",
	"skill.description": "After the task, save the solution as a project skill, without interrupting the turn",
	"skill.payload": "After you finish this task, create and save the solution you just used as a skill in the current project for later reuse",
	"docs.description": "After the task, write the cause and fix to docs/ as markdown, without interrupting the turn",
	"docs.payload": "After you finish this task, write the root cause and the solution as a markdown document under the docs directory",
	"catalog.issue.name.empty": "Enter a command name. Do not type the slash — review becomes /review.",
	"catalog.issue.name.invalid": "/{name} is not a valid command name. Start with a lowercase letter; after that only letters, digits, hyphens, or underscores. Example: review, save-note. Put other languages in the guidance text, not the name.",
	"catalog.issue.name.tooLong": "The name is too long (max {max} characters). Shorten it and try again.",
	"catalog.issue.name.reserved": "/{name} is a built-in or system command. Pick another name, for example my-{name}.",
	"catalog.issue.name.taken": "/{name} already exists. Choose another name, or delete the existing one first.",
	"catalog.issue.description.tooLong": "The description is too long (max {max} characters). Shorten it and try again.",
	"catalog.issue.text.empty": "Write the text the model should see. This command does not interrupt the turn; it works like /steer.",
	"catalog.issue.text.tooLong": "The guidance is too long (max {max} characters). Shorten it and try again.",
	"catalog.issue.tooMany": "You can have at most {max} custom commands. Delete one you do not need, then add a new one.",
	"catalog.issue.list.duplicate": "The list contains two /{name} rows. Each name can appear only once.",
	"catalog.issue.occupied": "/{name} is already used by DeepSeek Harness. Pick another name.",
	"catalog.issue.corrupt": "The custom-command file is damaged and was not overwritten. Check {path}, fix or delete it, then try again.",
	"catalog.issue.io": "Could not read or write the config file: {detail}. Make sure DeepSeek Harness can write {path}.",
	"catalog.issue.network": "Save failed: DeepSeek Harness is not reachable. Keep the web UI open and try again.",
	"catalog.issue.unknown": "Save failed: {detail}",
	"settings.nav": "Ultra Slash",
	"settings.title": "Ultra Slash",
	"settings.intro": "Manage slash commands here. They appear in the bottom Ultra Slash group of the / menu. A custom command injects fixed text into the next model step and does not interrupt the current turn. The list is stored on this machine and shared by every session.",
	"settings.builtinTitle": "Built-in commands",
	"settings.builtinHint": "These four cannot be renamed or deleted. /steer is the primitive; the others are shortcuts.",
	"settings.customTitle": "Custom commands",
	"settings.customHint": "Give a short name to a /steer payload you use often. For example, review makes /review send that fixed text.",
	"settings.empty": "No custom commands yet. Fill in a name and the text to inject, then click Add.",
	"settings.nameLabel": "Command name",
	"settings.nameHint": "Do not type the slash. Use lowercase letters, digits, hyphens, and underscores only.",
	"settings.namePreview": "Type {slash} to send",
	"settings.descriptionLabel": "Menu description (optional)",
	"settings.descriptionHint": "Shown on the right of the / menu row. If empty, a preview of the guidance is used.",
	"settings.textLabel": "Guidance to inject",
	"settings.textHint": "After you send this command, the model sees this text on the next step. The current turn is not stopped.",
	"settings.textPlaceholder": "Example: after the current change, only summarize test results; do not edit more code",
	"settings.add": "Add command",
	"settings.adding": "Adding…",
	"settings.save": "Save",
	"settings.saving": "Saving…",
	"settings.cancel": "Cancel",
	"settings.edit": "Edit",
	"settings.delete": "Delete",
	"settings.deleteConfirm": "Delete {slash}? Typing this command will no longer do anything.",
	"settings.deleteYes": "Delete",
	"settings.added": "Added {slash}. You can type it in the composer now. The current turn is not interrupted.",
	"settings.saved": "Saved {slash}.",
	"settings.deleted": "Deleted {slash}.",
	"settings.loadFailed": "Could not load custom commands.",
	"settings.retry": "Retry",
	"settings.loading": "Loading custom commands…",
	"settings.maxReached": "You already have {max} custom commands. Delete one before adding another.",
	"settings.rowKindSteer": "Core",
	"settings.rowKindAlias": "Shortcut",
	"settings.rowKindSession": "Session",
	"settings.rowKindCustom": "Custom"
};
const DICTS = {
	zh,
	en
};
/** Fill `{name}` placeholders. Unknown names stay in the template. */
function interpolate(template, vars) {
	if (vars === void 0) return template;
	return template.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(vars, name) ? String(vars[name]) : match);
}
/** Host-side lookup. Client menus should use `ctx.locale.bind(LOCALE_NS)` instead. */
function translate(locale, key, vars) {
	return interpolate(DICTS[locale][key], vars);
}
/** Settings `locale.preference` when present; otherwise DSH's zh fallback. */
function resolveHostLocale(get) {
	return (get?.("settings"))?.get?.("locale")?.preference === "en" ? "en" : "zh";
}
zh["menu.group"];
en["menu.group"];
const ISSUE_KEY = {
	"name.empty": "catalog.issue.name.empty",
	"name.invalid": "catalog.issue.name.invalid",
	"name.tooLong": "catalog.issue.name.tooLong",
	"name.reserved": "catalog.issue.name.reserved",
	"name.taken": "catalog.issue.name.taken",
	"description.tooLong": "catalog.issue.description.tooLong",
	"text.empty": "catalog.issue.text.empty",
	"text.tooLong": "catalog.issue.text.tooLong",
	tooMany: "catalog.issue.tooMany",
	"list.duplicate": "catalog.issue.list.duplicate"
};
/** User-facing text for a custom-command validation failure. */
function formatCatalogIssue(locale, issue) {
	const vars = {};
	if ("name" in issue) vars.name = issue.name;
	if ("max" in issue) vars.max = issue.max;
	return translate(locale, ISSUE_KEY[issue.code], vars);
}
translate("en", "steer.description");
const COMMAND_HINT = translate("en", "steer.hint");
/** Split the command suffix. Surrounding whitespace is discarded; inner text is kept. */
function parseSteerInput(rawInput) {
	const text = rawInput.trim();
	if (text.length === 0) return { kind: "empty" };
	return {
		kind: "steer",
		text
	};
}
/** Usage error when the user typed `/steer` with nothing to inject. */
function emptySteerResult(locale = "zh") {
	return {
		kind: "error",
		text: translate(locale, "steer.empty", {
			usage: translate(locale, "steer.usage"),
			example: translate(locale, "steer.example")
		})
	};
}
/** Confirmation after the text has been queued. The injected payload is the full `text`. */
function queuedSteerResult(status, text, locale = "zh") {
	const quoted = quoteForNotice(text, locale);
	if (status === "running") return {
		kind: "success",
		text: translate(locale, "steer.queued.running", { quoted })
	};
	return {
		kind: "success",
		text: translate(locale, "steer.queued.idle", { quoted })
	};
}
/** Notice when the UI aborted the command before anything was queued. */
function cancelledSteerResult(locale = "zh") {
	return {
		kind: "error",
		text: translate(locale, "steer.cancelled")
	};
}
/** Notice when `agent.steer` itself throws. */
function steerFailedResult(error, locale = "zh") {
	return {
		kind: "error",
		text: translate(locale, "steer.failed", { detail: renderThrown(error, locale) })
	};
}
/** Host `/new` acknowledgment. The client actually switches the visible session. */
function newSessionResult(locale = "zh") {
	return {
		kind: "success",
		text: translate(locale, "new.ok")
	};
}
/** Validate, queue, and acknowledge one `/steer` line. Does not call `cancel()`. */
function executeSteer(invocation, locale = "zh") {
	if (invocation.signal.aborted) return cancelledSteerResult(locale);
	const parsed = parseSteerInput(invocation.rawInput);
	if (parsed.kind === "empty") return emptySteerResult(locale);
	try {
		invocation.agent.steer(createSteerMessage(parsed.text));
	} catch (error) {
		return steerFailedResult(error, locale);
	}
	return queuedSteerResult(invocation.agent.status, parsed.text, locale);
}
const NOTICE_PREVIEW_CHARS = 400;
/** Quote the queued text for the command card. Long payloads stay queued in full. */
function quoteForNotice(text, locale = "zh") {
	if (text.length <= NOTICE_PREVIEW_CHARS) return text;
	return translate(locale, "steer.preview", {
		preview: text.slice(0, NOTICE_PREVIEW_CHARS),
		count: text.length
	});
}
function renderThrown(error, locale) {
	if (error instanceof Error && error.message.trim().length > 0) return error.message;
	try {
		const text = String(error);
		return text.length > 0 ? text : translate(locale, "steer.unknownError");
	} catch {
		return translate(locale, "steer.unknownError");
	}
}
const STORE_RELATIVE_DIR$1 = "ultra-slash";
const STORE_FILE_NAME = "commands.json";
function resolveDshHome$1(env = process.env) {
	const fromEnv = env.DSH_HOME?.trim();
	if (fromEnv !== void 0 && fromEnv.length > 0) return fromEnv;
	return join(homedir(), ".dsh");
}
function customCommandStorePath(env = process.env) {
	return join(resolveDshHome$1(env), STORE_RELATIVE_DIR$1, STORE_FILE_NAME);
}
var StoreError = class extends Error {
	code;
	constructor(code, message, options) {
		super(message, options);
		this.code = code;
		this.name = "StoreError";
	}
};
function isCommandShape(value) {
	if (typeof value !== "object" || value === null) return false;
	const row = value;
	return typeof row.name === "string" && typeof row.steerText === "string" && (row.description === void 0 || typeof row.description === "string");
}
function parseStoreFile(raw) {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new StoreError("corrupt", "commands.json is not valid JSON", { cause: error });
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new StoreError("corrupt", "commands.json must be an object");
	const body = parsed;
	if (!Array.isArray(body.commands)) throw new StoreError("corrupt", "commands.json is missing a commands array");
	const rows = body.commands;
	if (!rows.every(isCommandShape)) throw new StoreError("corrupt", "commands.json contains an invalid command row");
	const validated = validateCustomList(rows);
	if (!validated.ok) throw new StoreError("corrupt", `commands.json failed validation: ${validated.issue.code}`);
	return validated.commands;
}
/** Missing file → empty list. Corrupt file throws so a save cannot wipe it. */
async function loadCustomCommands(path) {
	let raw;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if (isNotFound$1(error)) return [];
		throw new StoreError("io", `could not read ${path}`, { cause: error });
	}
	if (raw.trim().length === 0) return [];
	return parseStoreFile(raw);
}
async function saveCustomCommands(path, commands) {
	const json = `${JSON.stringify({
		version: 1,
		commands
	}, null, 2)}\n`;
	const tmp = `${path}.${process.pid}.tmp`;
	try {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(tmp, json, "utf8");
		await rename(tmp, path);
	} catch (error) {
		throw new StoreError("io", `could not write ${path}`, { cause: error });
	}
}
function isNotFound$1(error) {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
//#endregion
//#region src/host/ultra-slash/register.ts
/**
* Host command registrations: builtins plus the user-defined `/steer` aliases
* persisted under `$DSH_HOME/ultra-slash/commands.json`.
*/
function localeOf(ctx) {
	return resolveHostLocale((name) => ctx.get(name));
}
function aliasHandler(ctx, template) {
	return (invocation) => executeSteer({
		...invocation,
		rawInput: composeAliasText(template(), invocation.rawInput)
	}, localeOf(ctx));
}
function isAlreadyRegistered(error) {
	return error instanceof Error && /already registered/i.test(error.message);
}
function nameFromRegisterError(error) {
	if (!(error instanceof Error)) return void 0;
	return /command "([^"]+)" is already registered/i.exec(error.message)?.[1];
}
function occupiedMessage(locale, name, error) {
	if (isAlreadyRegistered(error)) return translate(locale, "catalog.issue.occupied", { name });
	return translate(locale, "catalog.issue.unknown", { detail: error instanceof Error && error.message.trim().length > 0 ? error.message : translate(locale, "steer.unknownError") });
}
function storeMessage(locale, error, path) {
	if (error.code === "corrupt") return translate(locale, "catalog.issue.corrupt", { path });
	return translate(locale, "catalog.issue.io", {
		path,
		detail: error.cause instanceof Error ? error.cause.message : error.message
	});
}
function registerOne(ctx, definition) {
	return ctx.commands.register(definition);
}
/** Builtins may already be owned by a leftover ultra-slash plugin; skip instead of crashing workbench load. */
function registerBuiltinOne(ctx, definition) {
	try {
		return registerOne(ctx, definition);
	} catch (error) {
		if (isAlreadyRegistered(error)) return () => {};
		throw error;
	}
}
function registerCustomRow(ctx, command) {
	return registerOne(ctx, {
		name: command.name,
		description: command.description,
		input: { hint: translate("en", "alias.hint") },
		handler: aliasHandler(ctx, () => command.steerText)
	});
}
/** Register shipped commands. `/new` only acknowledges; the client switches the session. */
function registerBuiltinCommands(ctx) {
	const undo = [];
	for (const command of BUILTIN_SLASH_COMMANDS) {
		if (command.kind === "steer") {
			undo.push(registerBuiltinOne(ctx, {
				name: COMMAND_NAME,
				description: translate("en", "steer.description"),
				input: { hint: COMMAND_HINT },
				handler: (invocation) => executeSteer(invocation, localeOf(ctx))
			}));
			continue;
		}
		if (command.kind === "session") {
			undo.push(registerBuiltinOne(ctx, {
				name: command.name,
				description: translate("en", "new.description"),
				handler: (invocation) => {
					if (invocation.signal.aborted) return cancelledSteerResult(localeOf(ctx));
					return newSessionResult(localeOf(ctx));
				}
			}));
			continue;
		}
		const payloadKey = command.payloadKey;
		if (payloadKey === void 0) continue;
		undo.push(registerBuiltinOne(ctx, {
			name: command.name,
			description: translate("en", command.descriptionKey),
			input: { hint: translate("en", "alias.hint") },
			handler: aliasHandler(ctx, () => translate(localeOf(ctx), payloadKey))
		}));
	}
	return () => {
		while (undo.length > 0) undo.pop()?.();
	};
}
/**
* Load persisted custom commands, keep them registered, and replace the set
* when the settings page saves.
*/
function createCommandHub(ctx, storePath = customCommandStorePath()) {
	let custom = [];
	let disposers = [];
	const replaceLive = (next) => {
		const previous = custom;
		while (disposers.length > 0) disposers.pop()?.();
		try {
			const nextDisposers = [];
			for (const command of next) nextDisposers.push(registerCustomRow(ctx, command));
			disposers = nextDisposers;
			custom = next;
		} catch (error) {
			while (disposers.length > 0) disposers.pop()?.();
			const restored = [];
			for (const command of previous) restored.push(registerCustomRow(ctx, command));
			disposers = restored;
			custom = previous;
			throw error;
		}
	};
	let queue = Promise.resolve();
	const saveCustomUnlocked = async (rows) => {
		const locale = localeOf(ctx);
		const validated = validateCustomList(rows);
		if (!validated.ok) return {
			ok: false,
			message: formatCatalogIssue(locale, validated.issue)
		};
		const previous = custom;
		try {
			replaceLive(validated.commands);
		} catch (error) {
			return {
				ok: false,
				message: occupiedMessage(locale, nameFromRegisterError(error) ?? validated.commands[0]?.name ?? "", error)
			};
		}
		try {
			await saveCustomCommands(storePath, validated.commands);
		} catch (error) {
			replaceLive(previous);
			return {
				ok: false,
				message: storeMessage(locale, error instanceof StoreError ? error : new StoreError("io", "write failed", { cause: error }), storePath)
			};
		}
		return {
			ok: true,
			commands: validated.commands
		};
	};
	let bootError;
	return {
		listCustom: () => custom,
		loadError: () => bootError,
		setLoadError(message) {
			bootError = message;
		},
		saveCustom(rows) {
			const done = queue.then(async () => {
				const result = await saveCustomUnlocked(rows);
				if (result.ok) bootError = void 0;
				return result;
			});
			queue = done.then(() => void 0, () => void 0);
			return done;
		}
	};
}
async function loadHubFromDisk(hub, storePath = customCommandStorePath()) {
	try {
		const commands = await loadCustomCommands(storePath);
		const result = await hub.saveCustom(commands);
		if (!result.ok) hub.setLoadError(result.message);
		return result;
	} catch (error) {
		const locale = "zh";
		const message = error instanceof StoreError ? storeMessage(locale, error, storePath) : translate(locale, "catalog.issue.unknown", { detail: error instanceof Error ? error.message : String(error) });
		hub.setLoadError(message);
		return {
			ok: false,
			message
		};
	}
}
/** Register shipped commands. Tests can call this without touching the store. */
function applyCommands(ctx) {
	registerBuiltinCommands(ctx);
}
//#endregion
//#region src/host/ultra-slash/apply.ts
function applyUltraSlash(ctx) {
	const host = ctx;
	applyCommands(host);
	const hub = createCommandHub(host);
	loadHubFromDisk(hub);
	ctx.effect(() => {
		const server = ctx.webServer;
		if (server === void 0 || typeof server.register !== "function") return () => {};
		return registerUltraSlashHttp(server, hub);
	}, `${PLUGIN_NAME}: http`);
}
//#endregion
//#region src/shared/workbench-sounds/types.ts
const HTTP_PREFIX = "/workbench-sounds";
/**
* 自定义音频上传上限：50MB（本地使用，不设过小限制；
* 超过 50MB 拒绝，50MB 及以下（含完整歌曲）均可上传播放）。
* parseBody 的 multipart 缓冲上限须比该值留出头部/边界开销余量。
*/
const MAX_SOUND_UPLOAD_BYTES = 52428800;
const STORE_RELATIVE_DIR = "workbench-sounds";
const STORE_INDEX_FILE = "index.json";
const STORE_CUSTOM_DIR = "custom";
function resolveDshHome(env = process.env) {
	const fromEnv = env.DSH_HOME?.trim();
	if (fromEnv !== void 0 && fromEnv.length > 0) return fromEnv;
	return join(homedir(), ".dsh");
}
function soundsDir(env = process.env) {
	return join(resolveDshHome(env), STORE_RELATIVE_DIR);
}
function soundsIndexPath(env = process.env) {
	return join(soundsDir(env), STORE_INDEX_FILE);
}
function soundsCustomDir(env = process.env) {
	return join(soundsDir(env), STORE_CUSTOM_DIR);
}
/** MIME type from extension. */
function mimeFromExt(filename) {
	switch (extname(filename).toLowerCase()) {
		case ".ogg": return "audio/ogg";
		case ".mp3": return "audio/mpeg";
		case ".wav": return "audio/wav";
		case ".webm": return "audio/webm";
		case ".m4a": return "audio/mp4";
		case ".flac": return "audio/flac";
		default: return "application/octet-stream";
	}
}
function isValidMime(mime) {
	return [
		"audio/ogg",
		"audio/mpeg",
		"audio/wav",
		"audio/webm",
		"audio/mp4",
		"audio/flac"
	].includes(mime);
}
function isEntryShape(v) {
	if (typeof v !== "object" || v === null) return false;
	const e = v;
	return typeof e.id === "string" && typeof e.name === "string" && typeof e.nameZh === "string" && typeof e.kind === "string" && (e.kind === "builtin" || e.kind === "custom") && typeof e.url === "string" && typeof e.mimeType === "string";
}
function parseIndex(raw) {
	const parsed = JSON.parse(raw);
	if (typeof parsed !== "object" || parsed === null) throw new Error("index.json must be an object");
	const body = parsed;
	if (typeof body.version !== "number") throw new Error("index.json missing version");
	const custom = Array.isArray(body.custom) ? body.custom.filter(isEntryShape) : [];
	return {
		version: body.version,
		custom
	};
}
function isNotFound(e) {
	return typeof e === "object" && e !== null && "code" in e && e.code === "ENOENT";
}
/** Load sound index. Missing file → empty custom list. */
async function loadSoundIndex(env = process.env) {
	const path = soundsIndexPath(env);
	try {
		const raw = await readFile(path, "utf8");
		if (raw.trim() === "") return {
			version: 1,
			custom: []
		};
		return parseIndex(raw);
	} catch (e) {
		if (isNotFound(e)) return {
			version: 1,
			custom: []
		};
		throw e;
	}
}
/** Save sound index. */
async function saveSoundIndex(index, env = process.env) {
	const path = soundsIndexPath(env);
	const json = `${JSON.stringify(index, null, 2)}\n`;
	const tmp = `${path}.${process.pid}.tmp`;
	await mkdir(dirname(path), { recursive: true });
	await writeFile(tmp, json, "utf8");
	await rename(tmp, path);
}
/** Add a custom sound from a buffer. Returns the new entry. */
async function addCustomSound(buffer, filename, id, env = process.env) {
	const mime = mimeFromExt(filename);
	if (!isValidMime(mime)) throw new Error(`Unsupported audio format: ${mime}`);
	if (buffer.length > 52428800) throw new Error(`File too large (max ${MAX_SOUND_UPLOAD_BYTES / 1024 / 1024}MB)`);
	if (buffer.length === 0) throw new Error("Empty file");
	const customDir = soundsCustomDir(env);
	await mkdir(customDir, { recursive: true });
	const ext = extname(filename);
	const filepath = join(customDir, `${id}${ext}`);
	await writeFile(filepath, buffer);
	const entry = {
		id,
		name: filename.replace(/\.[^.]+$/, ""),
		nameZh: filename.replace(/\.[^.]+$/, ""),
		kind: "custom",
		url: `${id}${ext}`,
		filename,
		mimeType: mime,
		size: buffer.length
	};
	const index = await loadSoundIndex(env);
	index.custom = index.custom.filter((e) => e.id !== id);
	index.custom.push(entry);
	await saveSoundIndex(index, env);
	return entry;
}
/** Delete a custom sound by ID. */
async function deleteCustomSound(id, env = process.env) {
	const index = await loadSoundIndex(env);
	const entry = index.custom.find((e) => e.id === id);
	if (!entry) return;
	const customDir = soundsCustomDir(env);
	const filepath = join(customDir, entry.url);
	try {
		await unlink(filepath);
	} catch {}
	index.custom = index.custom.filter((e) => e.id !== id);
	await saveSoundIndex(index, env);
}
/** Get file path for a custom sound ID. Returns null if not found. */
async function getCustomSoundPath(id, env = process.env) {
	const entry = (await loadSoundIndex(env)).custom.find((e) => e.id === id);
	if (!entry) return null;
	const customDir = soundsCustomDir(env);
	const filepath = join(customDir, entry.url);
	try {
		await stat(filepath);
		return filepath;
	} catch {
		return null;
	}
}
//#endregion
//#region src/host/workbench-sounds/http.ts
function sendJson(res, status, body) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.end(JSON.stringify(body));
}
function sendError(res, status, message) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.end(JSON.stringify({
		ok: false,
		message
	}));
}
function parseBody(req, maxSize = 12582912) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > maxSize) {
				reject(/* @__PURE__ */ new Error("body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}
/**
* Split a Buffer by a separator Buffer.
* Node's Buffer has no split() (that is a String method), so we search for the
* separator bytes with Buffer#indexOf and slice with subarray.
*/
function splitBuffer(buf, sep) {
	const parts = [];
	let start = 0;
	let idx = buf.indexOf(sep, start);
	while (idx !== -1) {
		parts.push(buf.subarray(start, idx));
		start = idx + sep.length;
		idx = buf.indexOf(sep, start);
	}
	parts.push(buf.subarray(start));
	return parts;
}
/** Minimal multipart/form-data parser (no external deps). */
async function parseMultipart(buffer, boundary) {
	const parts = splitBuffer(buffer, Buffer.from(`--${boundary}`));
	for (const part of parts) {
		let body = part;
		if (body.length >= 2 && body[0] === 13 && body[1] === 10) body = body.subarray(2);
		if (body.length === 0 || body.toString().startsWith("--")) continue;
		const idx = body.indexOf("\r\n\r\n");
		if (idx < 0) continue;
		const header = body.subarray(0, idx).toString();
		let fileData = body.subarray(idx + 4);
		if (fileData.length >= 2 && fileData[fileData.length - 2] === 13 && fileData[fileData.length - 1] === 10) fileData = fileData.subarray(0, fileData.length - 2);
		const filenameMatch = header.match(/filename="([^"]+)"/);
		if (!filenameMatch) continue;
		return {
			filename: filenameMatch[1],
			data: fileData
		};
	}
	return null;
}
async function handleSoundsRequest(req, res) {
	const host = req.headers.host ?? "127.0.0.1";
	const route = new URL(req.url ?? "/workbench-sounds", `http://${host}`).pathname.replace(/\/+$/, "") || "/workbench-sounds";
	const method = (req.method ?? "GET").toUpperCase();
	if (method === "OPTIONS") {
		res.statusCode = 204;
		res.setHeader("access-control-allow-origin", "*");
		res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
		res.setHeader("access-control-allow-headers", "content-type");
		res.end();
		return;
	}
	res.setHeader("access-control-allow-origin", "*");
	try {
		if (method === "GET" && (route === "/workbench-sounds" || route === `/workbench-sounds/index`)) {
			sendJson(res, 200, {
				ok: true,
				index: await loadSoundIndex()
			});
			return;
		}
		if (method === "GET" && route.startsWith(`/workbench-sounds/`)) {
			const filepath = await getCustomSoundPath(basename(route.slice(18)));
			if (!filepath) {
				sendError(res, 404, "Sound not found");
				return;
			}
			const mime = mimeFromExt(filepath);
			res.setHeader("content-type", mime);
			res.setHeader("accept-ranges", "bytes");
			const { size } = await stat(filepath);
			const range = req.headers.range;
			const match = typeof range === "string" ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
			if (match !== null) {
				let start = match[1] === "" ? void 0 : Number(match[1]);
				let end = match[2] === "" ? void 0 : Number(match[2]);
				if (start === void 0) {
					start = Math.max(0, size - (end ?? 0));
					end = size - 1;
				} else if (end === void 0 || end >= size) end = size - 1;
				if (start > end || start >= size) {
					res.statusCode = 416;
					res.setHeader("content-range", `bytes */${size}`);
					res.end();
					return;
				}
				res.statusCode = 206;
				res.setHeader("content-range", `bytes ${start}-${end}/${size}`);
				res.setHeader("content-length", end - start + 1);
				createReadStream(filepath, {
					start,
					end
				}).pipe(res);
				return;
			}
			res.setHeader("content-length", size);
			createReadStream(filepath).pipe(res);
			return;
		}
		if (method === "POST" && route === "/workbench-sounds") {
			const match = (req.headers["content-type"] ?? "").match(/multipart\/form-data; boundary=(.+)/);
			if (!match) {
				sendError(res, 400, "Expected multipart/form-data");
				return;
			}
			const parsed = await parseMultipart(await parseBody(req, 54525952), match[1]);
			if (!parsed) {
				sendError(res, 400, "No file found in multipart body");
				return;
			}
			const id = randomUUID().slice(0, 8);
			sendJson(res, 200, {
				ok: true,
				entry: await addCustomSound(parsed.data, parsed.filename, id)
			});
			return;
		}
		if (method === "DELETE" && route.startsWith(`/workbench-sounds/`)) {
			await deleteCustomSound(basename(route.slice(18)));
			sendJson(res, 200, { ok: true });
			return;
		}
		sendError(res, 404, "Not found");
	} catch (error) {
		sendError(res, 500, error instanceof Error ? error.message : String(error));
	}
}
function registerSoundsHttp(server) {
	return server.register({
		kind: "prefix",
		path: HTTP_PREFIX,
		handler: (req, res) => {
			handleSoundsRequest(req, res);
		}
	});
}
//#endregion
//#region src/index.ts
const name = "dsh-workbench-plugin";
const inject = [
	"tools",
	"webServer",
	"llm",
	"agentDefaultModel",
	"commands"
];
/** Host half: Git service, workspace files, JSON API, model-facing tools, Ultra Slash, and sounds. */
function apply(ctx) {
	const git = new GitService();
	const fs = new WorkspaceFs();
	ctx.effect(() => registerGitHttp(ctx, git, fs), "workbench: http");
	ctx.effect(() => registerGitTools(ctx, git), "workbench: tools");
	applyUltraSlash(ctx);
	ctx.effect(() => {
		const server = ctx.webServer;
		if (server === void 0 || typeof server.register !== "function") return () => {};
		return registerSoundsHttp(server);
	}, "workbench: sounds http");
}
//#endregion
export { apply, inject, name };
