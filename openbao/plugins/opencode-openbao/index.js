// opencode-openbao: Secrets bridge for OpenCode agents.
//
// Authenticates to OpenBao via AppRole, caches the token, provides
// a vault-read command for agents to fetch secrets at runtime.
//
// Config via opencode.jsonc plugin options:
//   ["opencode-openbao", {
//     "address": "http://127.0.0.1:8200",
//     "roleId": "...",
//     "secretId": "...",
//     "agent": "general"
//   }]
//
// Commands:
//   /vault-read <path> [key]  - read a secret from OpenBao
//   /vault-status             - show current token info
//   /vault-login              - re-authenticate to OpenBao

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TOKEN_CACHE_DIR = path.join(os.homedir(), ".cache", "opencode-openbao");
const TOKEN_CACHE_FILE = path.join(TOKEN_CACHE_DIR, "token.json");

// ---- OpenBao HTTP client (no deps) ----

async functionbaoRequest(address, method, urlPath, token, body = null) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["X-Vault-Token"] = token;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const resp = await fetch(`${address}/v1/${urlPath}`, opts);
  const data = await resp.json();

  if (!resp.ok) {
    const msg = data?.errors?.join("; ") || data?.request_id || resp.statusText;
    throw new Error(`OpenBao ${method} ${urlPath}: ${resp.status} — ${msg}`);
  }
  return data;
}

async function authenticateAppRole(address, roleId, secretId) {
  const data = await baoRequest(address, "POST", "auth/approle/login", null, {
    role_id: roleId,
    secret_id: secretId,
  });
  return {
    token: data.auth.client_token,
    accessor: data.auth.accessor,
    policies: data.auth.policies,
    ttl: data.auth.lease_duration,
    renewable: data.auth.renewable,
    issuedAt: Date.now(),
  };
}

async function renewToken(address, token) {
  try {
    const data = await baoRequest(address, "POST", "auth/token/renew-self", token);
    return {
      token: data.auth.client_token || token,
      ttl: data.auth.lease_duration,
      renewable: data.auth.renewable,
      issuedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

async function readSecret(address, token, secretPath) {
  const data = await baoRequest(address, "GET", `secret/data/${secretPath}`, token);
  return data.data?.data || {};
}

async function listSecrets(address, token, secretPath) {
  const data = await baoRequest(address, "LIST", `secret/metadata/${secretPath}`, token);
  return data.data?.keys || [];
}

// ---- Token cache ----

function saveTokenCache(authData) {
  fs.mkdirSync(TOKEN_CACHE_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(authData, null, 2));
}

function loadTokenCache() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function clearTokenCache() {
  try {
    fs.unlinkSync(TOKEN_CACHE_FILE);
  } catch {}
}

// ---- Plugin ----

export default function createPlugin(config = {}) {
  const address = config.address || "http://127.0.0.1:8200";
  const roleId = config.roleId || "";
  const secretId = config.secretId || "";
  const agentName = config.agent || "unknown";

  let currentToken = null;
  let tokenInfo = null;
  let renewTimer = null;

  async function ensureAuth(api) {
    if (currentToken) return currentToken;

    // Try cache first
    const cached = loadTokenCache();
    if (cached && cached.token) {
      const age = (Date.now() - cached.issuedAt) / 1000;
      if (age < cached.ttl - 60) {
        currentToken = cached.token;
        tokenInfo = cached;
        api?.ui?.toast?.({
          message: `OpenBao: restored cached token (${cached.policies.join(", ")})`,
          variant: "info",
          duration: 2000,
        });
        return currentToken;
      }
    }

    // Authenticate fresh
    if (!roleId || !secretId) {
      throw new Error("OpenBao: roleId and secretId required in plugin config");
    }

    const auth = await authenticateAppRole(address, roleId, secretId);
    currentToken = auth.token;
    tokenInfo = auth;
    saveTokenCache(auth);

    api?.ui?.toast?.({
      message: `OpenBao: authenticated as ${agentName} (${auth.policies.join(", ")})`,
      variant: "success",
      duration: 3000,
    });

    // Auto-renew
    startRenewTimer(api);

    return currentToken;
  }

  function startRenewTimer(api) {
    if (renewTimer) clearInterval(renewTimer);
    if (!tokenInfo?.renewable) return;

    // Renew at 50% of TTL
    const interval = Math.max((tokenInfo.ttl * 500), 30_000);
    renewTimer = setInterval(async () => {
      try {
        const renewed = await renewToken(address, currentToken);
        if (renewed) {
          tokenInfo = { ...tokenInfo, ...renewed };
          saveTokenCache(tokenInfo);
        }
      } catch {
        currentToken = null;
        tokenInfo = null;
        clearTokenCache();
        api?.ui?.toast?.({
          message: "OpenBao: token expired, will re-auth on next use",
          variant: "warn",
          duration: 3000,
        });
      }
    }, interval);
  }

  return {
    name: "opencode-openbao",

    async register(api) {
      // Auto-authenticate on plugin load
      try {
        await ensureAuth(api);
      } catch (err) {
        api.ui.toast({
          message: `OpenBao auth failed: ${err.message}`,
          variant: "error",
          duration: 5000,
        });
      }

      // Register commands
      api.command.register(() => [
        {
          name: "vault-read",
          description: "Read a secret from OpenBao",
          args: [
            { name: "path", description: "Secret path (e.g. deploy/argocd)", required: true },
            { name: "key", description: "Specific key (omit for all)", required: false },
          ],
          async execute(args, ctx) {
            try {
              const token = await ensureAuth(api);
              const secretPath = args.path;
              const data = await readSecret(address, token, secretPath);

              if (args.key) {
                const val = data[args.key];
                if (val === undefined) {
                  ctx.ui.log(`Key "${args.key}" not found at ${secretPath}`);
                  ctx.ui.log(`Available keys: ${Object.keys(data).join(", ")}`);
                } else {
                  ctx.ui.log(`${args.key} = ${val}`);
                }
              } else {
                ctx.ui.log(JSON.stringify(data, null, 2));
              }
            } catch (err) {
              ctx.ui.log(`Error: ${err.message}`);
            }
          },
        },
        {
          name: "vault-status",
          description: "Show current OpenBao token info",
          async execute(_args, ctx) {
            if (!tokenInfo) {
              ctx.ui.log("Not authenticated");
              return;
            }
            const age = Math.floor((Date.now() - tokenInfo.issuedAt) / 1000);
            const remaining = tokenInfo.ttl - age;
            ctx.ui.log(`Agent:    ${agentName}`);
            ctx.ui.log(`Policies: ${tokenInfo.policies.join(", ")}`);
            ctx.ui.log(`TTL:      ${remaining}s remaining (of ${tokenInfo.ttl}s)`);
            ctx.ui.log(`Renewable: ${tokenInfo.renewable}`);
          },
        },
        {
          name: "vault-login",
          description: "Re-authenticate to OpenBao",
          async execute(_args, ctx) {
            try {
              currentToken = null;
              tokenInfo = null;
              clearTokenCache();
              await ensureAuth(api);
              ctx.ui.log("Re-authenticated successfully");
            } catch (err) {
              ctx.ui.log(`Re-auth failed: ${err.message}`);
            }
          },
        },
      ]);
    },

    // Expose for programmatic use by other plugins or the CLI helper
    getClient() {
      return {
        read: (path) => readSecret(address, currentToken, path),
        list: (path) => listSecrets(address, currentToken, path),
        getToken: () => currentToken,
        getAddress: () => address,
        getAgent: () => agentName,
      };
    },
  };
}
