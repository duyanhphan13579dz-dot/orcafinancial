#!/usr/bin/env node

/**
 * One-time interactive bootstrap for a TCBS MCP OAuth session.
 *
 * TCBS MCP (https://mcp.tcbs.com.vn/mcp/tcinvest/) is an OAuth 2.1 protected
 * resource. Everything needed to authenticate is discoverable from the server
 * URL alone -- no pre-shared client credentials are required:
 *
 *   1. GET  /.well-known/oauth-protected-resource/mcp/tcinvest -> AS + resource
 *   2. GET  /.well-known/oauth-authorization-server/tcinvest   -> endpoints
 *   3. POST /tcinvest/register     (RFC 7591) -> client_id / client_secret
 *   4. GET  /tcinvest/authorize    (PKCE S256, iOTP in a real browser)
 *   5. POST /tcinvest/token        (authorization_code) -> access/refresh token
 *
 * Step 4 is the only one a machine cannot do alone: TCBS requires iOTP
 * confirmation on the TCInvest app, and the server's state cookie lives 600s.
 * This script opens the browser and waits for the code to come back to a
 * temporary local listener.
 *
 * Usage:
 *   node scripts/tcbs-mcp-bootstrap.mjs --out .tcbs-mcp-token.json
 *   node scripts/tcbs-mcp-bootstrap.mjs --refresh .tcbs-mcp-token.json
 *
 * Secrets are never printed. The token file is written with mode 600.
 * This is a diagnostic/bootstrap tool; it is not imported by the app.
 */

import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { argv, platform, exit } from "node:process";

const MCP_SERVER_URL = "https://mcp.tcbs.com.vn/mcp/tcinvest/";
const CALLBACK_PATH = "/callback";
const DEFAULT_PORT = 8787;
/** The server-side state cookie is Max-Age=600; give ourselves the full window. */
const CALLBACK_TIMEOUT_MS = 10 * 60 * 1000;

const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
};

const b64url = (buf) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fail = (message) => {
  console.error(`\n✖ ${message}\n`);
  exit(1);
};

const step = (n, text) => console.log(`\n[${n}/5] ${text}`);

async function fetchJson(url, init) {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url} :: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

/** Resolve the authorization server + canonical resource for the MCP endpoint. */
async function discover() {
  const mcp = new URL(MCP_SERVER_URL);
  const prmUrl = new URL("/.well-known/oauth-protected-resource", mcp.origin);
  prmUrl.pathname = `/.well-known/oauth-protected-resource${mcp.pathname.replace(/\/$/, "")}`;

  const prm = await fetchJson(prmUrl.toString());
  const resource = typeof prm.resource === "string" ? prm.resource : MCP_SERVER_URL.replace(/\/$/, "");
  const servers = Array.isArray(prm.authorization_servers) ? prm.authorization_servers : [];
  const issuer = servers[0];
  if (!issuer) throw new Error("protected-resource metadata exposes no authorization_servers");

  const issuerUrl = new URL(issuer);
  const asmUrl = `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname}`;

  const asm = await fetchJson(asmUrl);
  const required = ["authorization_endpoint", "token_endpoint"];
  for (const key of required) {
    if (typeof asm[key] !== "string") throw new Error(`authorization-server metadata missing ${key}`);
  }
  const pkce = Array.isArray(asm.code_challenge_methods_supported)
    ? asm.code_challenge_methods_supported
    : [];
  if (!pkce.includes("S256")) throw new Error("server does not advertise PKCE S256");

  return {
    resource,
    issuer,
    authorizationEndpoint: asm.authorization_endpoint,
    tokenEndpoint: asm.token_endpoint,
    registrationEndpoint: typeof asm.registration_endpoint === "string" ? asm.registration_endpoint : undefined,
    grantsSupported: Array.isArray(asm.grant_types_supported) ? asm.grant_types_supported : [],
  };
}

/**
 * RFC 7591 dynamic client registration.
 *
 * NOTE: the TCBS endpoint is a stub -- it ignores the request body and always
 * returns the same public constants (client_id "tcinvest", client_secret
 * "dummy"). Nobody has to provision these out of band. We request sensible
 * values anyway and simply use whatever comes back.
 */
async function registerClient(registrationEndpoint, redirectUri) {
  if (!registrationEndpoint) return { client_id: undefined, client_secret: undefined };
  const res = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      client_name: "ORCA Financial",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    }),
  });
  if (!res.ok) {
    throw new Error(`dynamic client registration failed: HTTP ${res.status}`);
  }
  return res.json().catch(() => ({}));
}

function openBrowser(url) {
  try {
    if (platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
    } else if (platform === "darwin") {
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    } else {
      spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
    }
  } catch {
    /* fall through to the manual instruction below */
  }
}

/** Temporary local listener that catches the authorization code. */
function waitForCallback(port, redirectUri, expectedState) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      const done = (status, html) => {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
      };
      if (url.pathname !== CALLBACK_PATH) {
        done(404, "<h1>404</h1>");
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (error) {
        done(400, "<h1>Authorization failed</h1>");
        settle(reject, new Error(`authorization denied: ${error}`));
        return;
      }
      if (!code) {
        done(400, "<h1>Missing code</h1>");
        settle(reject, new Error("callback carried no code"));
        return;
      }
      if (state !== expectedState) {
        done(400, "<h1>State mismatch</h1>");
        settle(reject, new Error("state mismatch -- aborting"));
        return;
      }
      done(200, "<h1>Success.</h1><p>You can close this tab.</p>");
      settle(resolve, code);
    });

    const timer = setTimeout(() => {
      settle(reject, new Error("timed out waiting for the iOTP callback (10 minutes)"));
    }, CALLBACK_TIMEOUT_MS);

    server.on("error", (err) => settle(reject, err));
    server.listen(port, "127.0.0.1", () => {
      console.log(`   listener ready on ${redirectUri}`);
    });

    function settle(fn, argValue) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        server.close();
      } catch {
        /* already closed */
      }
      fn(argValue);
    }
  });
}

async function postToken(tokenEndpoint, params) {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    cache: "no-store",
    body: new URLSearchParams(params).toString(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = typeof payload.error === "string" ? payload.error : `HTTP_${res.status}`;
    const detail = typeof payload.error_description === "string" ? ` (${payload.error_description})` : "";
    throw new Error(`token request failed: ${code}${detail}`);
  }
  return payload;
}

async function persist(path, payload) {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

async function bootstrap() {
  const outFile = arg("out") ?? ".tcbs-mcp-token.json";
  const port = Number(arg("port") ?? DEFAULT_PORT);
  const redirectUri = `http://localhost:${port}${CALLBACK_PATH}`;

  step(1, "Discovering OAuth metadata from the MCP server URL alone");
  const meta = await discover();
  console.log(`   resource      : ${meta.resource}`);
  console.log(`   issuer        : ${meta.issuer}`);
  console.log(`   authorize     : ${meta.authorizationEndpoint}`);
  console.log(`   token         : ${meta.tokenEndpoint}`);
  console.log(`   register      : ${meta.registrationEndpoint ?? "(none advertised)"}`);
  console.log(`   grants        : ${meta.grantsSupported.join(", ") || "(none advertised)"}`);

  step(2, "Dynamic client registration (RFC 7591)");
  const client = await registerClient(meta.registrationEndpoint, redirectUri);
  if (!client.client_id) throw new Error("server returned no client_id");
  console.log(`   client_id     : ${client.client_id}`);
  console.log(`   client_secret : ${client.client_secret ? "(received)" : "(none)"}`);

  step(3, "Generating PKCE (S256)");
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  console.log(`   challenge     : ${challenge.slice(0, 16)}...`);

  const authorizeUrl = new URL(meta.authorizationEndpoint);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", client.client_id);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("resource", meta.resource);

  step(4, "Waiting for iOTP confirmation in the browser");
  console.log("   A browser window will open. Log in and confirm on the TCInvest app.");
  console.log("   The state cookie only lives 600s -- please complete it promptly.\n");
  console.log("   If the browser does not open, paste this URL manually:\n");
  console.log(`   ${authorizeUrl.toString()}\n`);

  const waiting = waitForCallback(port, redirectUri, state);
  openBrowser(authorizeUrl.toString());
  const code = await waiting;
  console.log("   authorization code received");

  step(5, "Exchanging the code for tokens");
  const payload = await postToken(meta.tokenEndpoint, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: client.client_id,
    client_secret: client.client_secret ?? "",
    code_verifier: verifier,
    resource: meta.resource,
  });

  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!accessToken) throw new Error("token response carried no access_token");

  const expiresIn = Number(payload.expires_in);
  const record = {
    access_token: accessToken,
    refresh_token: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
    token_type: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
    scope: typeof payload.scope === "string" ? payload.scope : "",
    expires_in: Number.isFinite(expiresIn) ? expiresIn : undefined,
    expires_at: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined,
    client_id: client.client_id,
    client_secret: client.client_secret,
    token_endpoint: meta.tokenEndpoint,
    resource: meta.resource,
    mcp_server_url: MCP_SERVER_URL,
  };

  await persist(outFile, record);

  console.log("\n✔ Bootstrap complete. Tokens written with mode 600.\n");
  console.log(`   file          : ${outFile}`);
  console.log(`   token_type    : ${record.token_type}`);
  console.log(`   expires_in    : ${record.expires_in ?? "(not reported)"}`);
  console.log(`   refresh_token : ${record.refresh_token ? "YES -- rotation is possible" : "NO"}\n`);

  if (!record.refresh_token) {
    console.log("   ⚠ No refresh_token was issued. Sessions cannot be renewed headlessly;");
    console.log("     this whole flow must be repeated once the access token expires.");
  } else {
    console.log(`   Next: node scripts/tcbs-mcp-bootstrap.mjs --refresh ${outFile}`);
  }
  console.log("");
}

async function refresh() {
  const file = arg("refresh");
  if (!file) fail("--refresh requires a token file path");

  let record;
  try {
    record = JSON.parse(await readFile(file, "utf8"));
  } catch {
    fail(`cannot read token file: ${file}`);
  }
  if (!record.refresh_token) fail("that token file has no refresh_token -- rotation is impossible");

  console.log(`\n[1/1] Rotating session via ${record.token_endpoint}`);
  const payload = await postToken(record.token_endpoint, {
    grant_type: "refresh_token",
    refresh_token: record.refresh_token,
    client_id: record.client_id,
    client_secret: record.client_secret ?? "",
    resource: record.resource,
  });

  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!accessToken) throw new Error("refresh response carried no access_token");

  const expiresIn = Number(payload.expires_in);
  const next = {
    ...record,
    access_token: accessToken,
    refresh_token: typeof payload.refresh_token === "string" ? payload.refresh_token : record.refresh_token,
    expires_in: Number.isFinite(expiresIn) ? expiresIn : record.expires_in,
    expires_at: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined,
  };
  await persist(file, next);

  console.log("\n✔ Session rotated headlessly. Tokens rewritten with mode 600.\n");
  console.log(`   file             : ${file}`);
  console.log(`   expires_in       : ${next.expires_in ?? "(not reported)"}`);
  console.log(`   token rotated    : ${next.refresh_token !== record.refresh_token ? "yes" : "no (same token reused)"}\n`);
  console.log("   → Headless renewal WORKS. A server-side integration can keep a");
  console.log("     session alive indefinitely without touching iOTP again.\n");
}

const main = async () => {
  try {
    if (argv.includes("--refresh")) await refresh();
    else await bootstrap();
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
};

await main();
