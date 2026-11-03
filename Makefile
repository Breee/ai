SHELL := /bin/bash
REPO_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
DOCKER_COMPOSE := docker compose -f $(REPO_ROOT)/docker/compose.yaml
CFG := $(HOME)/.config/opencode
LINKS := agents commands opencode.jsonc skills themes tui.jsonc

.PHONY: install opencode-install opencode-uninstall up down status help \
        up-core up-langfuse up-otel up-ollama up-opendesign down-opendesign up-all

help:
	@echo "Available targets:"
	@echo "  make install           - bootstrap opencode and start core stack"
	@echo "  make opencode-install  - install the opencode runtime symlinks"
	@echo "  make opencode-uninstall- remove the opencode runtime symlinks"
	@echo "  make up               - start core (traefik) only"
	@echo "  make up-core          - start core (traefik)"
	@echo "  make up-langfuse      - start langfuse stack + core"
	@echo "  make up-otel          - start otel-collector + core"
	@echo "  make up-ollama        - start ollama + core (pulls models on first run)"
	@echo "  make up-opendesign    - start open-design + core + ollama"
	@echo "  make up-all           - start everything"
	@echo "  make down             - stop the docker stack"
	@echo "  make status           - show running compose services"

install: opencode-install up

opencode-install: $(CFG)
	@for f in $(LINKS); do \
	  src="$(REPO_ROOT)/opencode/$$f"; dest="$(CFG)/$$f"; \
	  if [ -L "$$dest" ]; then \
	    target=$$(readlink "$$dest"); \
	    if [ "$$target" = "$$src" ]; then echo "  skip $$f (symlink exists)"; \
	    else rm "$$dest" && ln -s "$$src" "$$dest" && echo "  relink $$f → $$src"; fi; \
	  elif [ -e "$$dest" ]; then echo "  WARN $$f exists but is not a symlink — skipping"; \
	  else ln -s "$$src" "$$dest" && echo "  link $$dest"; fi; \
	done
	@[ -f "$(CFG)/.gitignore" ] || printf 'node_modules\npackage.json\npackage-lock.json\nbun.lock\n.gitignore\n' > "$(CFG)/.gitignore"
	@[ -f "$(CFG)/dcp.jsonc" ] || printf '{"$$schema":"https://raw.githubusercontent.com/Opencode-DCP/opencode-dynamic-context-pruning/master/dcp.schema.json"}\n' > "$(CFG)/dcp.jsonc"
	@[ -f "$(CFG)/package.json" ] || printf '{"dependencies":{"@opencode-ai/plugin":"1.18.21"}}\n' > "$(CFG)/package.json"
	@cd "$(CFG)" && npm install --silent || true
	@echo "done — restart opencode to pick up changes"

opencode-uninstall:
	@for f in $(LINKS); do \
	  dest="$(CFG)/$$f"; \
	  if [ -L "$$dest" ]; then rm "$$dest" && echo "  removed $$dest"; fi; \
	done

up: up-core

up-core:
	@docker network inspect proxy >/dev/null 2>&1 || docker network create proxy
	@$(DOCKER_COMPOSE) --profile core up -d

up-langfuse:
	@docker network inspect proxy >/dev/null 2>&1 || docker network create proxy
	@$(DOCKER_COMPOSE) --profile core --profile langfuse up -d

up-otel:
	@docker network inspect proxy >/dev/null 2>&1 || docker network create proxy
	@$(DOCKER_COMPOSE) --profile core --profile otel up -d

up-ollama:
	@docker network inspect proxy >/dev/null 2>&1 || docker network create proxy
	@$(DOCKER_COMPOSE) --profile core --profile ollama up -d
	@echo "Waiting for ollama to be healthy..."
	@until docker compose -f $(REPO_ROOT)/docker/compose.yaml exec ollama ollama list >/dev/null 2>&1; do sleep 2; done
	@echo "Ollama ready."

up-opendesign:
	@OD_DISABLE_API_AUTH=1 OD_ALLOWED_ORIGINS=http://opendesign.localhost \
	  nohup node $(REPO_ROOT)/open-design/apps/daemon/dist/cli.js --no-open --port 7456 \
	  > /tmp/opendesign.log 2>&1 &
	@echo "Waiting for open-design to be healthy..."
	@until curl -fsS http://127.0.0.1:7456/api/health >/dev/null 2>&1; do sleep 2; done
	@echo "OpenDesign ready at http://opendesign.localhost"

down-opendesign:
	@pkill -f "cli.js.*--no-open.*--port 7456" 2>/dev/null && echo "OpenDesign stopped" || echo "OpenDesign not running"

up-all:
	@docker network inspect proxy >/dev/null 2>&1 || docker network create proxy
	@$(DOCKER_COMPOSE) --profile core --profile langfuse --profile otel --profile ollama --profile opendesign up -d

down:
	@$(DOCKER_COMPOSE) --profile core --profile langfuse --profile otel --profile ollama --profile opendesign down

status:
	@$(DOCKER_COMPOSE) --profile core --profile langfuse --profile otel --profile ollama --profile opendesign ps

$(CFG):
	@mkdir -p "$@"
