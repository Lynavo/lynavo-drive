//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let electron = require("electron");
let path = require("path");
let node_http = require("node:http");
node_http = __toESM(node_http);
let _lynavo_drive_contracts = require("@lynavo-drive/contracts");
let electron_log = require("electron-log");
electron_log = __toESM(electron_log);
let node_child_process = require("node:child_process");
let node_fs_promises = require("node:fs/promises");
let node_os = require("node:os");
let node_path = require("node:path");
let node_util = require("node:util");
let node_events = require("node:events");
let ws = require("ws");
ws = __toESM(ws);
//#region src/main/sidecar-client.ts
var BASE = `http://127.0.0.1:${_lynavo_drive_contracts.SIDECAR_HTTP_PORT}`;
async function request(method, path, body) {
	return new Promise((resolve, reject) => {
		const url = new URL(path, BASE);
		const options = {
			method,
			hostname: url.hostname,
			port: url.port,
			path: url.pathname + url.search,
			headers: { "Content-Type": "application/json" }
		};
		const req = node_http.default.request(options, (res) => {
			let data = "";
			res.on("data", (chunk) => data += chunk);
			res.on("end", () => {
				if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(data));
				else reject(/* @__PURE__ */ new Error(`Sidecar ${method} ${path}: ${res.statusCode} ${data}`));
			});
		});
		req.on("error", reject);
		if (body) req.write(JSON.stringify(body));
		req.end();
	});
}
var sidecarClient = {
	getHealth: () => request("GET", "/health"),
	getDashboardSummary: () => request("GET", "/dashboard/summary"),
	getDashboardDevices: () => request("GET", "/dashboard/devices"),
	getDeviceFiles: (id, date, options) => {
		const params = new URLSearchParams({ date });
		if (options?.page) params.set("page", String(options.page));
		if (options?.pageSize) params.set("pageSize", String(options.pageSize));
		if (options?.sortField) params.set("sortField", options.sortField);
		if (options?.sortDirection) params.set("sortDirection", options.sortDirection);
		return request("GET", `/devices/${id}/files?${params.toString()}`);
	},
	getDeviceDates: (id) => request("GET", `/devices/${id}/dates`),
	getSettings: () => request("GET", "/settings"),
	updateSettings: (s) => request("PUT", "/settings", s),
	regenerateConnectionCode: () => request("POST", "/connection-code/regenerate"),
	getShareStatus: () => request("GET", "/share/status"),
	validateShare: () => request("POST", "/share/validate")
};
//#endregion
//#region src/main/file-operations.ts
async function openFolder(path) {
	await electron.shell.openPath(path);
}
async function openFile(path) {
	await electron.shell.openPath(path);
}
async function openExternal(target) {
	await electron.shell.openExternal(target);
}
async function selectFolder() {
	const result = await electron.dialog.showOpenDialog({ properties: ["openDirectory"] });
	return result.canceled ? null : result.filePaths[0] ?? null;
}
function copyToClipboard(text) {
	electron.clipboard.writeText(text);
}
//#endregion
//#region src/main/diagnostics.ts
var execFileAsync = (0, node_util.promisify)(node_child_process.execFile);
function diagnosticsTimestamp() {
	const now = /* @__PURE__ */ new Date();
	const pad = (value) => String(value).padStart(2, "0");
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
async function exists(path) {
	try {
		await (0, node_fs_promises.stat)(path);
		return true;
	} catch {
		return false;
	}
}
async function safeCall(fn) {
	try {
		return await fn();
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}
function getAppInfo() {
	const buildNumber = resolveBuildNumber();
	return {
		name: electron.app.getName(),
		version: electron.app.getVersion(),
		buildNumber
	};
}
function resolveBuildNumber() {
	const fallback = "";
	const packagedPackageJson = (0, node_path.join)(electron.app.getAppPath(), "package.json");
	const repoProject = (0, node_path.join)(process.cwd(), "apps", "mobile", "ios", "LynavoDrive.xcodeproj", "project.pbxproj");
	try {
		const packaged = require(packagedPackageJson);
		if (packaged.syncflowBuildNumber) return packaged.syncflowBuildNumber;
	} catch {}
	try {
		return require("node:fs").readFileSync(repoProject, "utf8").match(/CURRENT_PROJECT_VERSION = (\d+);/)?.[1] ?? fallback;
	} catch {
		return fallback;
	}
}
async function exportDiagnostics(sidecarManager) {
	const timestamp = diagnosticsTimestamp();
	const defaultPath = (0, node_path.join)(electron.app.getPath("desktop"), `SyncFlow-Diagnostics-${timestamp}.zip`);
	const dialogResult = await electron.dialog.showSaveDialog({
		title: "导出诊断包",
		defaultPath,
		filters: [{
			name: "ZIP Archive",
			extensions: ["zip"]
		}]
	});
	if (dialogResult.canceled || !dialogResult.filePath) return null;
	const tempRoot = (0, node_path.join)((0, node_os.tmpdir)(), `syncflow-diagnostics-${timestamp}`);
	const bundleDir = (0, node_path.join)(tempRoot, `SyncFlow-Diagnostics-${timestamp}`);
	const filesDir = (0, node_path.join)(bundleDir, "files");
	const sidecarDataDir = electron.app.getPath("userData");
	const sidecarDbPath = (0, node_path.join)(sidecarDataDir, "sidecar.db");
	const desktopLogPath = electron_log.default.transports.file.getFile().path;
	await (0, node_fs_promises.rm)(tempRoot, {
		recursive: true,
		force: true
	});
	await (0, node_fs_promises.mkdir)(filesDir, { recursive: true });
	const appInfo = getAppInfo();
	const snapshot = {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		app: {
			...appInfo,
			platform: process.platform
		},
		sidecar: {
			runtimeState: sidecarManager.getState(),
			health: await safeCall(() => sidecarClient.getHealth()),
			settings: await safeCall(() => sidecarClient.getSettings()),
			dashboardSummary: await safeCall(() => sidecarClient.getDashboardSummary()),
			dashboardDevices: await safeCall(() => sidecarClient.getDashboardDevices()),
			shareStatus: await safeCall(() => sidecarClient.getShareStatus())
		},
		files: {
			desktopLogPath: await exists(desktopLogPath) ? desktopLogPath : null,
			sidecarDbPath: await exists(sidecarDbPath) ? sidecarDbPath : null,
			sidecarDataDir
		}
	};
	await (0, node_fs_promises.writeFile)((0, node_path.join)(bundleDir, "diagnostics.json"), JSON.stringify(snapshot, null, 2), "utf8");
	await (0, node_fs_promises.writeFile)((0, node_path.join)(bundleDir, "README.txt"), [
		"SyncFlow 诊断包",
		"",
		"包含内容：",
		"- diagnostics.json：版本、运行时状态、dashboard、设置、共享状态",
		"- files/desktop-main.log：桌面端主进程日志（含 sidecar stdout/stderr）",
		"- files/sidecar.db：sidecar 数据库快照（如存在）",
		"",
		"请将整个 ZIP 提供给开发团队进行排查。",
		""
	].join("\n"), "utf8");
	if (await exists(desktopLogPath)) await (0, node_fs_promises.copyFile)(desktopLogPath, (0, node_path.join)(filesDir, "desktop-main.log"));
	if (await exists(sidecarDbPath)) await (0, node_fs_promises.copyFile)(sidecarDbPath, (0, node_path.join)(filesDir, "sidecar.db"));
	if (process.platform === "win32") await execFileAsync("powershell.exe", [
		"-NoProfile",
		"-Command",
		`Compress-Archive -Path '${bundleDir.replace(/'/g, "''")}\\*' -DestinationPath '${dialogResult.filePath.replace(/'/g, "''")}' -Force`
	]);
	else await execFileAsync("ditto", [
		"-c",
		"-k",
		"--sequesterRsrc",
		"--keepParent",
		bundleDir,
		dialogResult.filePath
	]);
	await (0, node_fs_promises.rm)(tempRoot, {
		recursive: true,
		force: true
	});
	electron.shell.showItemInFolder(dialogResult.filePath);
	return dialogResult.filePath;
}
//#endregion
//#region src/main/ipc-handlers.ts
var IPC = {
	SIDECAR_HEALTH: "sidecar:health",
	SIDECAR_DASHBOARD_SUMMARY: "sidecar:dashboard-summary",
	SIDECAR_DASHBOARD_DEVICES: "sidecar:dashboard-devices",
	SIDECAR_DEVICE_FILES: "sidecar:device-files",
	SIDECAR_DEVICE_DATES: "sidecar:device-dates",
	SIDECAR_SETTINGS: "sidecar:settings",
	SIDECAR_UPDATE_SETTINGS: "sidecar:update-settings",
	SIDECAR_REGENERATE_CODE: "sidecar:regenerate-code",
	SIDECAR_RUNTIME_STATE: "sidecar:runtime-state",
	SIDECAR_RETRY_START: "sidecar:retry-start",
	SIDECAR_SHARE_STATUS: "sidecar:share-status",
	SIDECAR_VALIDATE_SHARE: "sidecar:validate-share",
	SUPPORT_EXPORT_DIAGNOSTICS: "support:export-diagnostics",
	SUPPORT_APP_INFO: "support:app-info",
	FILES_OPEN_FOLDER: "files:open-folder",
	FILES_OPEN_FILE: "files:open-file",
	FILES_OPEN_EXTERNAL: "files:open-external",
	FILES_SELECT_FOLDER: "files:select-folder",
	FILES_COPY_CLIPBOARD: "files:copy-clipboard"
};
function registerIpcHandlers(sidecarManager) {
	electron.ipcMain.handle(IPC.SIDECAR_HEALTH, () => sidecarClient.getHealth());
	electron.ipcMain.handle(IPC.SIDECAR_DASHBOARD_SUMMARY, () => sidecarClient.getDashboardSummary());
	electron.ipcMain.handle(IPC.SIDECAR_DASHBOARD_DEVICES, () => sidecarClient.getDashboardDevices());
	electron.ipcMain.handle(IPC.SIDECAR_DEVICE_FILES, (_e, deviceId, date, options) => sidecarClient.getDeviceFiles(deviceId, date, options));
	electron.ipcMain.handle(IPC.SIDECAR_DEVICE_DATES, (_e, deviceId) => sidecarClient.getDeviceDates(deviceId));
	electron.ipcMain.handle(IPC.SIDECAR_SETTINGS, () => sidecarClient.getSettings());
	electron.ipcMain.handle(IPC.SIDECAR_UPDATE_SETTINGS, (_e, partial) => sidecarClient.updateSettings(partial));
	electron.ipcMain.handle(IPC.SIDECAR_REGENERATE_CODE, () => sidecarClient.regenerateConnectionCode());
	electron.ipcMain.handle(IPC.SIDECAR_RUNTIME_STATE, () => sidecarManager.getState());
	electron.ipcMain.handle(IPC.SIDECAR_RETRY_START, () => sidecarManager.retryStart());
	electron.ipcMain.handle(IPC.SIDECAR_SHARE_STATUS, () => sidecarClient.getShareStatus());
	electron.ipcMain.handle(IPC.SIDECAR_VALIDATE_SHARE, () => sidecarClient.validateShare());
	electron.ipcMain.handle(IPC.SUPPORT_EXPORT_DIAGNOSTICS, () => exportDiagnostics(sidecarManager));
	electron.ipcMain.handle(IPC.SUPPORT_APP_INFO, () => getAppInfo());
	electron.ipcMain.handle(IPC.FILES_OPEN_FOLDER, (_e, path) => openFolder(path));
	electron.ipcMain.handle(IPC.FILES_OPEN_FILE, (_e, path) => openFile(path));
	electron.ipcMain.handle(IPC.FILES_OPEN_EXTERNAL, (_e, target) => openExternal(target));
	electron.ipcMain.handle(IPC.FILES_SELECT_FOLDER, () => selectFolder());
	electron.ipcMain.handle(IPC.FILES_COPY_CLIPBOARD, (_e, text) => copyToClipboard(text));
}
//#endregion
//#region src/shared/sidecar-runtime.ts
var INITIAL_SIDECAR_RUNTIME_STATE = {
	status: "starting",
	message: "后台服务启动中…",
	restartCount: 0,
	maxRestarts: 3,
	lastExitCode: null
};
//#endregion
//#region src/main/sidecar-manager.ts
var isDev$1 = !electron.app.isPackaged;
var sidecarBinaryName = process.platform === "win32" ? "syncflow-sidecar.exe" : "syncflow-sidecar";
var HEALTHCHECK_INTERVAL_MS = 500;
var DEV_HEALTHCHECK_RETRIES = 120;
var PROD_HEALTHCHECK_RETRIES = 10;
var SidecarManager = class extends node_events.EventEmitter {
	process = null;
	restartCount = 0;
	maxRestarts = 3;
	healthInterval = null;
	restartTimer = null;
	stopping = false;
	state = INITIAL_SIDECAR_RUNTIME_STATE;
	constructor() {
		super();
		this.state = {
			...INITIAL_SIDECAR_RUNTIME_STATE,
			maxRestarts: this.maxRestarts
		};
	}
	getState() {
		return { ...this.state };
	}
	getSpawnArgs() {
		if (isDev$1) return {
			command: "go",
			args: ["run", "./cmd/syncflow-sidecar/"]
		};
		return {
			command: (0, node_path.join)(process.resourcesPath, sidecarBinaryName),
			args: []
		};
	}
	async start() {
		if (this.process) return;
		this.stopping = false;
		this.clearRestartTimer();
		this.stopHealthCheck();
		if (await this.healthCheck()) {
			this.restartCount = 0;
			this.startHealthCheck();
			this.setState({
				status: "healthy",
				message: null,
				lastExitCode: null
			});
			electron_log.default.info("[SidecarManager] reusing existing healthy sidecar");
			return;
		}
		const { command, args } = this.getSpawnArgs();
		const cwd = isDev$1 ? (0, node_path.join)(electron.app.getAppPath(), "..", "..", "services", "sidecar-go") : void 0;
		this.setState({
			status: "starting",
			message: this.restartCount > 0 ? `后台服务不可用，正在重试（${this.restartCount}/${this.maxRestarts}）` : "后台服务启动中…"
		});
		electron_log.default.info(`[SidecarManager] starting: ${command} ${args.join(" ")}`);
		const child = (0, node_child_process.spawn)(command, args, {
			cwd,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			],
			env: {
				...process.env,
				SYNCFLOW_CONFIG: "",
				CGO_ENABLED: "1"
			}
		});
		this.process = child;
		child.stdout?.on("data", (data) => {
			try {
				electron_log.default.info(`[sidecar] ${data.toString().trim()}`);
			} catch {}
		});
		child.stderr?.on("data", (data) => {
			try {
				electron_log.default.error(`[sidecar] ${data.toString().trim()}`);
			} catch {}
		});
		child.on("error", (err) => {
			if (this.process !== child) return;
			this.process = null;
			electron_log.default.error(`[SidecarManager] process error: ${err.message}`);
			this.handleFailure(`后台服务启动失败：${err.message}`, null);
		});
		child.on("exit", (code) => {
			if (this.process !== child) return;
			this.process = null;
			electron_log.default.warn(`[SidecarManager] process exited with code ${code}`);
			this.handleFailure("后台服务已退出", code);
		});
		try {
			await this.waitForHealth(isDev$1 ? DEV_HEALTHCHECK_RETRIES : PROD_HEALTHCHECK_RETRIES, HEALTHCHECK_INTERVAL_MS);
			this.restartCount = 0;
			this.startHealthCheck();
			this.setState({
				status: "healthy",
				message: null,
				lastExitCode: null
			});
			electron_log.default.info("[SidecarManager] sidecar is healthy");
		} catch (err) {
			electron_log.default.error("[SidecarManager] health wait failed", err);
			if (this.process === child && !child.killed) child.kill("SIGTERM");
			throw err;
		}
	}
	async retryStart() {
		this.restartCount = 0;
		this.clearRestartTimer();
		await this.stop();
		await this.start();
	}
	async stop() {
		this.stopping = true;
		this.clearRestartTimer();
		this.stopHealthCheck();
		if (this.process) {
			electron_log.default.info("[SidecarManager] stopping sidecar");
			this.process.kill("SIGTERM");
			await new Promise((resolve) => {
				const timeout = setTimeout(() => {
					if (this.process) this.process.kill("SIGKILL");
					resolve();
				}, 5e3);
				this.process?.on("exit", () => {
					clearTimeout(timeout);
					resolve();
				});
			});
			this.process = null;
		}
		this.setState({
			status: "stopped",
			message: null
		});
	}
	async healthCheck() {
		try {
			return (await sidecarClient.getHealth()).ok === true;
		} catch {
			return false;
		}
	}
	async waitForHealth(retries, intervalMs) {
		for (let i = 0; i < retries; i++) {
			if (await this.healthCheck()) return;
			await new Promise((r) => setTimeout(r, intervalMs));
		}
		throw new Error("Sidecar failed to become healthy");
	}
	startHealthCheck() {
		this.stopHealthCheck();
		this.healthInterval = setInterval(async () => {
			if (!await this.healthCheck()) electron_log.default.warn("[SidecarManager] health check failed");
		}, 3e3);
	}
	stopHealthCheck() {
		if (this.healthInterval) {
			clearInterval(this.healthInterval);
			this.healthInterval = null;
		}
	}
	clearRestartTimer() {
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = null;
		}
	}
	handleFailure(message, code) {
		this.stopHealthCheck();
		if (this.stopping) {
			this.setState({
				status: "stopped",
				message: null,
				lastExitCode: code
			});
			return;
		}
		if (this.restartCount < this.maxRestarts) {
			this.restartCount += 1;
			this.setState({
				status: "starting",
				message: `${message}，正在重试（${this.restartCount}/${this.maxRestarts}）`,
				lastExitCode: code
			});
			electron_log.default.info(`[SidecarManager] restarting (attempt ${this.restartCount}/${this.maxRestarts})`);
			this.clearRestartTimer();
			this.restartTimer = setTimeout(() => {
				this.restartTimer = null;
				this.start().catch((err) => {
					electron_log.default.error("[SidecarManager] restart attempt failed", err);
				});
			}, 1e3);
			return;
		}
		electron_log.default.error("[SidecarManager] max restarts exceeded");
		this.setState({
			status: "failed",
			message: `${message}。请检查 sidecar 可执行文件或点击重试。`,
			lastExitCode: code
		});
	}
	setState(patch) {
		this.state = {
			...this.state,
			...patch,
			restartCount: this.restartCount,
			maxRestarts: this.maxRestarts
		};
		this.emit("state", this.getState());
	}
};
//#endregion
//#region src/main/ws-bridge.ts
var WsBridge = class {
	ws = null;
	reconnectTimer = null;
	constructor(getWindow) {
		this.getWindow = getWindow;
	}
	connect() {
		if (this.ws && (this.ws.readyState === ws.default.OPEN || this.ws.readyState === ws.default.CONNECTING)) return;
		const url = `ws://127.0.0.1:${_lynavo_drive_contracts.SIDECAR_HTTP_PORT}/events/stream`;
		electron_log.default.info(`[WsBridge] connecting to ${url}`);
		this.ws = new ws.default(url);
		this.ws.on("open", () => {
			electron_log.default.info("[WsBridge] connected");
		});
		this.ws.on("message", (data) => {
			try {
				const event = JSON.parse(data.toString());
				const win = this.getWindow();
				if (win && !win.isDestroyed()) win.webContents.send("sidecar:event", event);
			} catch (err) {
				electron_log.default.warn("[WsBridge] failed to parse event", err);
			}
		});
		this.ws.on("close", () => {
			electron_log.default.info("[WsBridge] disconnected, reconnecting in 3s");
			this.scheduleReconnect();
		});
		this.ws.on("error", (err) => {
			electron_log.default.warn("[WsBridge] error", err.message);
		});
	}
	disconnect() {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}
	scheduleReconnect() {
		if (this.reconnectTimer) return;
		this.reconnectTimer = setTimeout(() => this.connect(), 3e3);
	}
};
//#endregion
//#region src/main/index.ts
process.on("uncaughtException", (err) => {
	if (err.message.includes("write EIO") || err.message.includes("EPIPE")) return;
	console.error("Uncaught exception:", err);
});
var mainWindow = null;
var sidecar = new SidecarManager();
var wsBridge;
var isDev = !electron.app.isPackaged;
function broadcastSidecarRuntimeState(state) {
	for (const win of electron.BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send("sidecar:runtime-state", state);
}
sidecar.on("state", (state) => {
	broadcastSidecarRuntimeState(state);
});
async function createMainWindow() {
	mainWindow = new electron.BrowserWindow({
		width: 1440,
		height: 960,
		minWidth: 1200,
		minHeight: 800,
		titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
		backgroundColor: "#f4f8fb",
		webPreferences: {
			preload: (0, path.join)(__dirname, "../preload/index.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false
		}
	});
	if (isDev && process.env["ELECTRON_RENDERER_URL"]) await mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
	else await mainWindow.loadFile((0, path.join)(__dirname, "../renderer/index.html"));
}
electron.app.whenReady().then(async () => {
	registerIpcHandlers(sidecar);
	await createMainWindow();
	wsBridge = new WsBridge(() => mainWindow);
	wsBridge.connect();
	sidecar.start().catch((err) => {
		console.error("Failed to start sidecar:", err);
	});
	electron.app.on("activate", async () => {
		if (electron.BrowserWindow.getAllWindows().length === 0) await createMainWindow();
	});
});
electron.app.on("window-all-closed", () => {
	if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("before-quit", async () => {
	wsBridge?.disconnect();
	await sidecar.stop();
});
//#endregion
