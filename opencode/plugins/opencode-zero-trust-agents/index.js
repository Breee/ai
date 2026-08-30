// opencode-zero-trust-agents: Zero-knowledge vault broker for OpenCode agents.
//
// The agent NEVER sees the vault token. It calls vault_get() and the
// plugin mediates the request using its internally held token.
//
// Token files: ~/.vault-tokens/<agent-role> (chmod 600)
// Config via opencode.jsonc plugin options:
//   ["opencode-vault-broker", {
//     "address": "http://vault.localhost",
//     "tokenDir": "~/.vault-tokens"
//   }]
//
// Tools exposed:
//   vault_get(path, key?)     - read a secret value
//   vault_list(path)          - list keys at a path
//   vault_status              - show token info (no secret material)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_TOKEN_DIR = path.join(os.homedir(), ".vault-tokens");

// ---- HTTP client (no deps) ----

async function vaultRequest(address, method, urlPath, token, body = null) {
  const headers = {};
  if (token) headers["X-Vault-Token"] = token;

  const opts = { method, headers };
  if (body) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const resp = await fetch(`${address}/v1/${urlPath}`, opts);
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!resp.ok) {
    const msg = data?.errors?.join("; ") || data?.request_id || resp.statusText;
    throw new Error(`vault ${method} ${urlPath}: ${resp.status} — ${msg}`);
  }
  return data;
}

// ---- Token management ----

function resolveTokenDir(tokenDir) {
  const dir = tokenDir?.startsWith("~")
    ? tokenDir.replace("~", os.homedir())
    : tokenDir || DEFAULT_TOKEN_DIR;
  return dir;
}

function readTokenFile(tokenDir, agentRole) {
  const tokenPath = path.join(resolveTokenDir(tokenDir), agentRole);
  try {
    // Check permissions before reading
    const stat = fs.statSync(tokenPath);
    const mode = (stat.mode & 0o777).toString(8);
    if (mode !== "600") {
      console.warn(`vault-broker: WARNING ${tokenPath} has mode ${mode}, expected 600`);
    }
    return fs.readFileSync(tokenPath, "utf-8").trim();
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        `No vault token found for agent "${agentRole}". ` +
        `Create ~/.vault-tokens/${agentRole} with chmod 600.`
      );
    }
    throw err;
  }
}

// ---- Plugin ----

export default function createPlugin(config = {}) {
  const address = config.address || "http://vault.localhost";
  const tokenDir = config.tokenDir || DEFAULT_TOKEN_DIR;

  // Plugin-level state: token is held here, never exposed to agent
  let heldToken = null;
  let agentRole = null;
  let tokenInfo = null;

  function setAgentRole(role) {
    agentRole = role;
    heldToken = readTokenFile(tokenDir, role);
  }

  async function ensureToken() {
    if (!heldToken) {
      // Try to detect agent role from environment or config
      agentRole = process.env.VAULT_AGENT_ROLE || "reader";
      heldToken = readTokenFile(tokenDir, agentRole);
    }
    return heldToken;
  }

  async function fetchSecret(secretPath, key) {
    const token = await ensureToken();
    const data = await vaultRequest(address, "GET", `secret/data/${secretPath}`, token);
    const values = data.data?.data || {};

    if (key) {
      const val = values[key];
      if (val === undefined) {
        const available = Object.keys(values).join(", ");
        throw new Error(`Key "${key}" not found at ${secretPath}. Available: ${available}`);
      }
      return val;
    }
    return values;
  }

  async function listSecrets(secretPath) {
    const token = await ensureToken();
    const data = await vaultRequest(address, "LIST", `secret/metadata/${secretPath}`, token);
    return data.data?.keys || [];
  }

  return {
    name: "opencode-zero-trust-agents",

    async register(api) {
      // Detect agent role from context if possible
      try {
        await ensureToken();
        api.ui.toast({
          message: `zero-trust: loaded token for "${agentRole}"`,
          variant: "success",
          duration: 2000,
        });
      } catch (err) {
        api.ui.toast({
          message: `zero-trust: ${err.message}`,
          variant: "error",
          duration: 5000,
        });
      }
    },

    // Custom tools — agent calls these, never sees the token
    tool: {
      vault_get: {
        description: "Read a secret from the vault. Agent never sees the vault token.",
        args: {
          path: { type: "string", description: "Secret path (e.g. 'shared/gitlab')" },
          key: { type: "string", description: "Specific key (omit for all keys)", required: false },
        },
        async execute(args) {
          try {
            const result = await fetchSecret(args.path, args.key);
            if (typeof result === "string") return result;
            return JSON.stringify(result, null, 2);
          } catch (err) {
            return `Error: ${err.message}`;
          }
        },
      },

      vault_list: {
        description: "List secret paths under a prefix",
        args: {
          path: { type: "string", description: "Path prefix (e.g. 'shared/')" },
        },
        async execute(args) {
          try {
            const keys = await listSecrets(args.path);
            return keys.length ? keys.join("\n") : "(empty)";
          } catch (err) {
            return `Error: ${err.message}`;
          }
        },
      },

      vault_status: {
        description: "Show vault connection status (no secret material exposed)",
        args: {},
        async execute() {
          try {
            await ensureToken();
            // Verify connectivity
            const token = await ensureToken();
            await vaultRequest(address, "GET", "sys/health", token);
            return JSON.stringify({
              address,
              agent: agentRole,
              status: "connected",
              tokenFile: path.join(resolveTokenDir(tokenDir), agentRole),
            }, null, 2);
          } catch (err) {
            return JSON.stringify({ status: "error", error: err.message }, null, 2);
          }
        },
      },
    },
  };
}
