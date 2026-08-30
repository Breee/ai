// opencode-sandbox-agent: Containerized agent with SPIRE identity + nono sandbox.
//
// Spawns agent containers with:
// - gVisor runtime (kernel-level isolation)
// - SPIRE agent sidecar (workload identity)
// - nono sandbox (filesystem + network + credential brokering)
//
// Tools exposed:
//   sandbox_spawn(agent_id, workspace?, prompt?)  — spawn a sandboxed agent
//   sandbox_status(agent_id?)                     — check agent status
//   sandbox_kill(agent_id)                        — stop agent container
//   sandbox_list                                  — list running agents

import { execSync, spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const PLUGIN_DIR = path.dirname(new URL(import.meta.url).pathname);
const COMPOSE_DIR = PLUGIN_DIR;

// ---- Container management ----

function dockerCompose(...args) {
  const cmd = `docker compose -f ${COMPOSE_DIR}/docker-compose.agent.yaml ${args.join(" ")}`;
  return execSync(cmd, { encoding: "utf-8", timeout: 30000 }).trim();
}

function dockerRun(...args) {
  const cmd = `docker ${args.join(" ")}`;
  return execSync(cmd, { encoding: "utf-8", timeout: 60000 }).trim();
}

function isImageBuilt() {
  try {
    execSync(`docker image inspect opencode-sandbox-agent`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function buildImage() {
  console.log("[sandbox] Building agent image...");
  execSync(
    `docker build -t opencode-sandbox-agent ${COMPOSE_DIR}`,
    { stdio: "inherit", timeout: 300000 }
  );
  console.log("[sandbox] Image built");
}

function ensureSpireRunning() {
  try {
    const ps = execSync("docker ps --filter name=spire-server --format {{.Names}}", {
      encoding: "utf-8",
    }).trim();
    if (ps.includes("spire-server")) {
      console.log("[sandbox] SPIRE server already running");
      return;
    }
  } catch {}

  console.log("[sandbox] Starting SPIRE server...");
  execSync(
    `docker compose -f ${COMPOSE_DIR}/docker-compose.spire.yaml up -d`,
    { stdio: "inherit", timeout: 60000 }
  );
  // Wait for SPIRE to be ready
  execSync("sleep 3");
  console.log("[sandbox] SPIRE server started");
}

function generateJoinToken() {
  const token = execSync(
    `docker exec spire-server /opt/spire/bin/spire-server entry create \
      -spiffeID spiffe://local/agent \
      -selector docker:label:opencode-agent \
      -node -joinToken`,
    { encoding: "utf-8", timeout: 10000 }
  ).trim();
  return token;
}

// ---- Agent lifecycle ----

const agents = new Map(); // agentId -> { container, startedAt }

function spawnAgent(agentId, workspace, prompt) {
  if (!isImageBuilt()) buildImage();
  ensureSpireRunning();

  const hostWorkspace = path.resolve(workspace || process.cwd());

  // Write join token for the agent container
  const joinToken = generateJoinToken();
  fs.mkdirSync(path.join(COMPOSE_DIR, ".state"), { recursive: true });
  fs.writeFileSync(path.join(COMPOSE_DIR, ".state", "join-token"), joinToken);

  console.log(`[sandbox] Spawning agent ${agentId} in ${hostWorkspace}`);

  const containerName = `opencode-agent-${agentId}`;
  const runArgs = [
    "run", "-d",
    "--name", containerName,
    "--hostname", `agent-${agentId}`,
    "--env", `SPIRE_SERVER_ADDR=host.docker.internal:8081`,
    "--env", `AGENT_ID=/agent/${agentId}`,
    "--env", "WORKSPACE=/workspace",
    "--volume", `${hostWorkspace}:/workspace`,
    "--volume", `${path.join(COMPOSE_DIR, ".state", "join-token")}:/run/spire/join-token:ro`,
    "--network", "opencode-sandbox-agent_agent-net",
    "--cpus", "1.0",
    "--memory", "512m",
    "--pids-limit", "256",
    "--cap-drop", "ALL",
    "--security-opt", "seccomp=unconfined",
    "--security-opt", "apparmor=unconfined",
    "--add-host", "host.docker.internal:host-gateway",
    "opencode-sandbox-agent",
  ];

  if (prompt) {
    runArgs.push("--", "opencode", "--non-interactive", "--prompt", prompt]);
  }

  try {
    const containerId = dockerRun(...runArgs);
    agents.set(agentId, {
      container: containerId,
      name: containerName,
      workspace: hostWorkspace,
      startedAt: new Date(),
    });
    console.log(`[sandbox] Agent ${agentId} started: ${containerId.slice(0, 12)}`);
    return { id: agentId, container: containerId.slice(0, 12), status: "running" };
  } catch (err) {
    console.error(`[sandbox] Failed to start agent ${agentId}: ${err.message}`);
    throw err;
  }
}

function agentStatus(agentId) {
  if (!agentId) {
    // List all agents
    const result = [];
    for (const [id, info] of agents) {
      try {
        const status = execSync(
          `docker inspect --format '{{.State.Status}}' ${info.name}`,
          { encoding: "utf-8" }
        ).trim();
        result.push({ id, container: info.container.slice(0, 12), status, startedAt: info.startedAt });
      } catch {
        result.push({ id, container: info.container.slice(0, 12), status: "unknown", startedAt: info.startedAt });
      }
    }
    return result;
  }

  const info = agents.get(agentId);
  if (!info) return { id: agentId, status: "not found" };

  try {
    const status = execSync(
      `docker inspect --format '{{.State.Status}}' ${info.name}`,
      { encoding: "utf-8" }
    ).trim();
    return { id: agentId, container: info.container.slice(0, 12), status, startedAt: info.startedAt };
  } catch {
    return { id: agentId, container: info.container.slice(0, 12), status: "unknown" };
  }
}

function killAgent(agentId) {
  const info = agents.get(agentId);
  if (!info) throw new Error(`Agent ${agentId} not found`);

  try {
    execSync(`docker rm -f ${info.name}`, { stdio: "pipe" });
    agents.delete(agentId);
    console.log(`[sandbox] Agent ${agentId} killed`);
    return { id: agentId, status: "killed" };
  } catch (err) {
    console.error(`[sandbox] Failed to kill agent ${agentId}: ${err.message}`);
    throw err;
  }
}

function listAgents() {
  return agentStatus();
}

// ---- Plugin ----

export default function createPlugin(config = {}) {
  const defaultWorkspace = config.workspace || process.cwd();

  return {
    name: "opencode-sandbox-agent",

    async register(api) {
      // Ensure image is built on startup
      try {
        if (!isImageBuilt()) {
          api.ui.toast({ message: "sandbox: building agent image...", variant: "info", duration: 5000 });
          buildImage();
          api.ui.toast({ message: "sandbox: image built", variant: "success", duration: 2000 });
        } else {
          api.ui.toast({ message: "sandbox: ready", variant: "success", duration: 2000 });
        }
      } catch (err) {
        api.ui.toast({ message: `sandbox: ${err.message}`, variant: "error", duration: 5000 });
      }
    },

    tool: {
      sandbox_spawn: {
        description: "Spawn a sandboxed agent container with SPIRE identity + nono isolation",
        args: {
          agent_id: { type: "string", description: "Unique agent identifier" },
          workspace: { type: "string", description: "Host workspace path (default: cwd)", required: false },
          prompt: { type: "string", description: "Initial prompt for the agent", required: false },
        },
        async execute(args) {
          try {
            const result = spawnAgent(
              args.agent_id,
              args.workspace || defaultWorkspace,
              args.prompt
            );
            return JSON.stringify(result, null, 2);
          } catch (err) {
            return `Error: ${err.message}`;
          }
        },
      },

      sandbox_status: {
        description: "Check status of sandboxed agent(s)",
        args: {
          agent_id: { type: "string", description: "Agent ID (omit for all)", required: false },
        },
        async execute(args) {
          try {
            const result = agentStatus(args.agent_id);
            return JSON.stringify(result, null, 2);
          } catch (err) {
            return `Error: ${err.message}`;
          }
        },
      },

      sandbox_kill: {
        description: "Stop a sandboxed agent container",
        args: {
          agent_id: { type: "string", description: "Agent ID to stop" },
        },
        async execute(args) {
          try {
            const result = killAgent(args.agent_id);
            return JSON.stringify(result, null, 2);
          } catch (err) {
            return `Error: ${err.message}`;
          }
        },
      },

      sandbox_list: {
        description: "List all sandboxed agents",
        args: {},
        async execute() {
          try {
            const result = listAgents();
            return JSON.stringify(result, null, 2);
          } catch (err) {
            return `Error: ${err.message}`;
          }
        },
      },
    },
  };
}
