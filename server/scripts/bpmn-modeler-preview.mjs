// Isolated development preview: never loads production .env or accesses a real engine.
// Build server and client first; then run from server: node scripts/bpmn-modeler-preview.mjs
import { createServer, request } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temp = mkdtempSync(join(tmpdir(), "bpmn-ui-isolated-"));
const apiPort = Number(process.env.BPMN_PREVIEW_API_PORT || 4511);
const uiPort = Number(process.env.BPMN_PREVIEW_UI_PORT || 4510);
const mockPort = Number(process.env.BPMN_PREVIEW_MOCK_PORT || 4512);
const mock = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  res.setHeader("Content-Type", "application/json");
  if (req.method === "POST" && req.url === "/repository/deployments") {
    writeFileSync(join(temp, "mock-deployment.multipart.txt"), body);
    res.end(JSON.stringify({ id: "ui-mock-deployment" }));
    return;
  }
  const key =
    new URL(req.url, "http://127.0.0.1").searchParams.get("key") ||
    "uiApproval";
  res.end(
    JSON.stringify({
      data: [
        {
          id: `${key}:1:mock`,
          key,
          deploymentId: "ui-mock-deployment",
        },
      ],
    }),
  );
});
await new Promise((r) => mock.listen(mockPort, "127.0.0.1", r));
const env = {
  PATH: process.env.PATH,
  HOME: temp,
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: String(apiPort),
  DATABASE_FILE: join(temp, "ui.sqlite"),
  DOTENV_CONFIG_PATH: join(temp, "no.env"),
  APP_ENCRYPTION_KEY: "b4".repeat(32),
  APP_ENCRYPTION_KEY_FILE: join(temp, "key"),
  DATA_FILE: join(temp, "missing.json"),
  LEGACY_DATA_FILE: join(temp, "missing.json"),
  DOCUMENT_STORAGE_DIR: join(temp, "docs"),
  INTEGRATION_DATA_DIR: temp,
  BPMN_MODELER_ALLOW_TEST_MOCK: "true",
  REDIS_URL: "",
  CORS_ORIGIN: "",
};
const child = spawn(process.execPath, ["dist/index.js"], {
  cwd: join(root, "server"),
  env,
  stdio: ["ignore", "inherit", "inherit"],
});
const base = `http://127.0.0.1:${apiPort}`;
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(base + "/api/health")).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 100));
}
const setup = await (
  await fetch(base + "/api/auth/mobile/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      displayName: "隔离验收管理员",
      email: "bpmn-ui@example.test",
      password: "isolated-ui-password-123",
    }),
  })
).json();
if (!setup.accessToken) throw Error("Isolated test setup failed");
const user = setup.user;
const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${setup.accessToken}`,
  "X-Tenant-ID": user.tenantId,
  "X-Organization-ID": user.organizationId,
  "X-Account-ID": user.accountId,
};
const cfg = await fetch(base + "/api/integrations/settings/flowable", {
  method: "PUT",
  headers,
  body: JSON.stringify({
    baseUrl: `http://127.0.0.1:${mockPort}`,
    username: "mock",
    password: "mock",
    userMap: { "bpmn-ui@example.test": "isolated-admin" },
  }),
});
if (!cfg.ok) throw Error("Mock connector configuration failed");
const mime = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".json": "application/json",
};
const web = createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    const proxy = request(
      base + req.url,
      {
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${apiPort}`, origin: base },
      },
      (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
      },
    );
    proxy.on("error", () => {
      res.writeHead(502);
      res.end("Isolated API unavailable");
    });
    req.pipe(proxy);
    return;
  }
  const url = new URL(req.url, "http://localhost");
  let path = resolve(
    root,
    "client/dist",
    "." + decodeURIComponent(url.pathname),
  );
  if (
    !path.startsWith(resolve(root, "client/dist") + "/") ||
    !existsSync(path) ||
    url.pathname === "/"
  )
    path = join(root, "client/dist/index.html");
  try {
    res.setHeader("Content-Type", mime[extname(path)] || "text/html");
    res.end(readFileSync(path));
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
await new Promise((r) => web.listen(uiPort, "127.0.0.1", r));
console.log(
  JSON.stringify({
    url: `http://localhost:${uiPort}`,
    database: join(temp, "ui.sqlite"),
    email: "bpmn-ui@example.test",
    password: "isolated-ui-password-123",
    mode: "TEMP DB + LOOPBACK MOCK ONLY",
  }),
);
function stop() {
  web.close();
  mock.close();
  child.kill("SIGTERM");
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
