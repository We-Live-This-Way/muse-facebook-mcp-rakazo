// HTTP entry point (Rakazo). Streamable-HTTP MCP server, stateless.
// Reads Facebook credentials from this directory's .env and, optionally, from
// a second file pointed at by FB_SHARED_ENV. The HTTP bearer secret comes from
// this directory's .env. Tokens are never logged. Listens on 127.0.0.1 only —
// Rakazo is expected to run on the same box.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadEnvFiles, requireEnv } from "./env.js";
import { setAppSecret } from "./graph.js";
import { registerTools, TOOL_NAMES } from "./tools.js";

const dir = dirname(fileURLToPath(import.meta.url));
const localEnvPath = join(dir, "..", ".env");
const first = loadEnvFiles([localEnvPath]);
const shared = first.FB_SHARED_ENV || process.env.FB_SHARED_ENV;
const env = loadEnvFiles([localEnvPath, shared]);
requireEnv(env, ["FB_PAGE_TOKEN", "FB_PAGE_ID", "FB_LONG_TOKEN", "FB_MCP_BEARER", "FB_APP_SECRET"]);
setAppSecret(env.FB_APP_SECRET);

const PORT = Number(process.env.FB_MCP_PORT || env.FB_MCP_PORT || 8891);
const HOST = "127.0.0.1";

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "facebook-mcp-rakazo", tools: TOOL_NAMES }));
    return;
  }

  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  // Bearer check on every /mcp request (health stays public).
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${env.FB_MCP_BEARER}`) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  if (req.method === "GET" || req.method === "DELETE") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "method not allowed in stateless mode" }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }

  try {
    const body = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", reject);
    });

    const mcpServer = new McpServer({ name: "facebook-draft", version: "1.0.0" });
    registerTools(mcpServer, {
      pageToken: env.FB_PAGE_TOKEN,
      pageId: env.FB_PAGE_ID,
      userToken: env.FB_LONG_TOKEN,
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
    res.on("close", () => transport.close().catch(() => {}));
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "bad request" }));
    }
  }
});

server.listen(PORT, HOST, () => {
  console.error(`facebook-draft (http) listening on http://${HOST}:${PORT}/mcp`);
});
