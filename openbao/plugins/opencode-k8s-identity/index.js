// opencode-k8s-identity: K8s ServiceAccount identity for OpenCode agents.
//
// Authenticates via K8s SA token (projected or kubectl-created), reads
// secrets from the K8s API scoped by RBAC.
//
// Config via opencode.jsonc:
//   ["opencode-k8s-identity", {
//     "agent": "readonly",
//     "namespace": "ai-agents",
//     "kubeconfig": "~/.kube/config"
//   }]
//
// Commands:
//   /k8s-read <secret-name> [key]   - read a K8s secret
//   /k8s-list                       - list secrets in namespace
//   /k8s-whoami                     - show current SA identity

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---- K8s API client (no deps) ----

function getKubeConfig(kubeconfigPath) {
  const resolved = kubeconfigPath.replace(/^~(?=\/|$)/, os.homedir());
  const raw = fs.readFileSync(resolved, "utf-8");

  // Simple YAML-ish parser for kubeconfig (handles our kind cluster)
  const lines = raw.split("\n");
  let server = "";
  let caCert = "";
  let currentContext = "";

  // Find current context
  for (const line of lines) {
    const m = line.match(/current-context:\s*(.+)/);
    if (m) currentContext = m[1].trim();
  }

  // Find the cluster for current context
  let inCluster = false;
  let clusterName = "";
  for (const line of lines) {
    if (line.match(/^clusters:/)) { inCluster = false; continue; }
    if (line.match(/^  - cluster:/)) {
      const m = line.match(/name:\s*(.+)/);
      if (m) { clusterName = m[1].trim(); inCluster = true; continue; }
    }
    if (inCluster && line.match(/^\s+server:\s*(.+)/)) {
      server = line.match(/^\s+server:\s*(.+)/)[1].trim();
    }
    if (inCluster && line.match(/^\s+certificate-authority-data:\s*(.+)/)) {
      caCert = line.match(/^\s+certificate-authority-data:\s*(.+)/)[1].trim();
    }
    if (inCluster && !line.match(/^\s/) && line.trim()) {
      inCluster = false;
    }
  }

  return { server, caCert, currentContext };
}

function getClusterCA(kubeconfigPath) {
  const kube = getKubeConfig(kubeconfigPath);
  if (!kube.caCert) return null;
  const certPath = path.join(os.homedir(), ".cache", "opencode-k8s", "ca.crt");
  fs.mkdirSync(path.dirname(certPath), { recursive: true });
  fs.writeFileSync(certPath, Buffer.from(kube.caCert, "base64"));
  return certPath;
}

async function k8sRequest(server, caCert, token, method, urlPath, body = null) {
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json",
  };
  if (body) headers["Content-Type"] = "application/json";

  const opts = {
    method,
    headers,
    // For kind, skip CA verification (self-signed)
    ...(caCert ? {} : { signal: AbortSignal.timeout(5000) }),
  };
  if (body) opts.body = JSON.stringify(body);

  const https = caCert ? await import("node:https") : await import("node:http");
  const agent = caCert ? new https.Agent({ ca: fs.readFileSync(caCert) }) : undefined;
  if (agent) opts.agent = agent;

  const resp = await fetch(`${server}${urlPath}`, opts);
  const data = await resp.json();

  if (!resp.ok) {
    const msg = data?.message || resp.statusText;
    throw new Error(`K8s ${method} ${urlPath}: ${resp.status} — ${msg}`);
  }
  return data;
}

async function kubectlExec(args, kubeconfigPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn("kubectl", [...args, "--kubeconfig", kubeconfigPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `kubectl exited ${code}`));
    });
  });
}

// ---- Token management ----

const TOKEN_CACHE_DIR = path.join(os.homedir(), ".cache", "opencode-k8s");

function getTokenCachePath(agent) {
  return path.join(TOKEN_CACHE_DIR, `${agent}.json`);
}

function saveTokenCache(agent, data) {
  fs.mkdirSync(TOKEN_CACHE_DIR, { recursive: true });
  fs.writeFileSync(getTokenCachePath(agent), JSON.stringify(data, null, 2));
}

function loadTokenCache(agent) {
  try {
    return JSON.parse(fs.readFileSync(getTokenCachePath(agent), "utf-8"));
  } catch {
    return null;
  }
}

async function getToken(agent, namespace, kubeconfigPath, duration = "1h") {
  // Check cache
  const cached = loadTokenCache(agent);
  if (cached && cached.expiry) {
    if (new Date(cached.expiry) > new Date()) {
      return cached.token;
    }
  }

  // Generate new token via kubectl
  const token = await kubectlExec(
    ["create", "token", agent, "-n", namespace, "--duration", duration],
    kubeconfigPath
  );

  // Cache with expiry (duration minus 30s buffer)
  const durationMs = parseDuration(duration);
  const expiry = new Date(Date.now() + durationMs - 30_000).toISOString();
  saveTokenCache(agent, { token, expiry, agent, namespace });

  return token;
}

function parseDuration(d) {
  const m = d.match(/^(\d+)(s|m|h)$/);
  if (!m) return 3600000; // default 1h
  const n = parseInt(m[1]);
  switch (m[2]) {
    case "s": return n * 1000;
    case "m": return n * 60_000;
    case "h": return n * 3600_000;
  }
}

// ---- Plugin ----

export default function createPlugin(config = {}) {
  const agent = config.agent || "readonly";
  const namespace = config.namespace || "ai-agents";
  const kubeconfigPath = (config.kubeconfig || "~/.kube/config").replace(/^~(?=\/|$)/, os.homedir());
  const duration = config.duration || "1h";

  let caCert = null;
  let server = "";

  async function ensureAuth(api) {
    const kube = getKubeConfig(kubeconfigPath);
    server = kube.server;
    caCert = getClusterCA(kubeconfigPath);
    const token = await getToken(agent, namespace, kubeconfigPath, duration);
    return { token, server, caCert };
  }

  async function readSecret(token, server, caCert, secretName, key = null) {
    const data = await k8sRequest(
      server, caCert, token, "GET",
      `/api/v1/namespaces/${namespace}/secrets/${secretName}`
    );

    // K8s secrets are base64-encoded
    const decoded = {};
    for (const [k, v] of Object.entries(data.data || {})) {
      decoded[k] = Buffer.from(v, "base64").toString("utf-8");
    }

    if (key) {
      const val = decoded[key];
      if (val === undefined) {
        throw new Error(`Key "${key}" not found. Available: ${Object.keys(decoded).join(", ")}`);
      }
      return { [key]: val };
    }
    return decoded;
  }

  async function listSecrets(token, server, caCert) {
    const data = await k8sRequest(
      server, caCert, token, "GET",
      `/api/v1/namespaces/${namespace}/secrets?labelSelector=app.kubernetes.io/part-of=opencode-agents`
    );
    return (data.items || []).map((s) => s.metadata.name);
  }

  return {
    name: "opencode-k8s-identity",

    async register(api) {
      try {
        await ensureAuth(api);
        api.ui.toast({
          message: `K8s identity: ${agent} @ ${namespace}`,
          variant: "success",
          duration: 2000,
        });
      } catch (err) {
        api.ui.toast({
          message: `K8s auth failed: ${err.message}`,
          variant: "error",
          duration: 5000,
        });
      }

      api.command.register(() => [
        {
          name: "k8s-read",
          description: "Read a K8s secret",
          args: [
            { name: "secret", description: "Secret name", required: true },
            { name: "key", description: "Key within secret (omit for all)", required: false },
          ],
          async execute(args, ctx) {
            try {
              const { token, server: s, caCert: ca } = await ensureAuth(api);
              const data = await readSecret(token, s, ca, args.secret, args.key);
              for (const [k, v] of Object.entries(data)) {
                ctx.ui.log(`${k} = ${v}`);
              }
            } catch (err) {
              ctx.ui.log(`Error: ${err.message}`);
            }
          },
        },
        {
          name: "k8s-list",
          description: "List secrets in namespace",
          async execute(_args, ctx) {
            try {
              const { token, server: s, caCert: ca } = await ensureAuth(api);
              const names = await listSecrets(token, s, ca);
              names.forEach((n) => ctx.ui.log(n));
            } catch (err) {
              ctx.ui.log(`Error: ${err.message}`);
            }
          },
        },
        {
          name: "k8s-whoami",
          description: "Show current K8s identity",
          async execute(_args, ctx) {
            try {
              const { token } = await ensureAuth(api);
              // Decode JWT payload
              const payload = JSON.parse(
                Buffer.from(token.split(".")[1], "base64url").toString()
              );
              ctx.ui.log(`SA:       ${payload.kubernetes.io/serviceaccount/name}`);
              ctx.ui.log(`Namespace: ${payload.kubernetes.io/serviceaccount/namespace}`);
              ctx.ui.log(`UID:      ${payload.kubernetes.io/serviceaccount.uid}`);
              ctx.ui.log(`Expiry:   ${new Date(payload.exp * 1000).toISOString()}`);
            } catch (err) {
              ctx.ui.log(`Error: ${err.message}`);
            }
          },
        },
      ]);
    },
  };
}
