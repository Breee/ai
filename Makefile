SHELL := /bin/bash
REPO_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
DOCKER_COMPOSE := docker compose -f $(REPO_ROOT)/docker/compose.yaml
CFG := $(HOME)/.config/opencode
LINKS := agents commands opencode.jsonc skills themes tui.jsonc

.PHONY: install opencode-install opencode-uninstall up down status help

help:
	@echo "Available targets:"
	@echo "  make install           - bootstrap opencode and start the docker stack"
	@echo "  make opencode-install  - install the opencode runtime symlinks"
	@echo "  make opencode-uninstall- remove the opencode runtime symlinks"
	@echo "  make up               - start the docker stack"
	@echo "  make down             - stop the docker stack"
	@echo "  make status           - show running compose services"

install: opencode-install up

opencode-install: $(CFG)
	@for f in $(LINKS); do \
	  src="$(REPO_ROOT)/opencode/$$f"; dest="$(CFG)/$$f"; \
	  if [ -L "$$dest" ]; then echo "  skip $$f (symlink exists)"; \
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

up:
	@docker network inspect proxy >/dev/null 2>&1 || docker network create proxy
	@$(DOCKER_COMPOSE) up -d

down:
	@$(DOCKER_COMPOSE) down

status:
	@$(DOCKER_COMPOSE) ps

$(CFG):
	@mkdir -p "$@"
