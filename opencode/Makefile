HERE    := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
CFG     := $(HOME)/.config/opencode
LINKS   := agents commands opencode.jsonc skills themes tui.jsonc

.PHONY: install uninstall

# Create symlinks and bootstrap the ~/.config/opencode runtime directory.
# This repo is expected to live at ~/repos/github.com/Breee/ai.
install: $(CFG)
	@for f in $(LINKS); do \
	  src="$(HERE)$$f"; dest="$(CFG)/$$f"; \
	  if [ -L "$$dest" ]; then echo "  skip $$f (symlink exists)"; \
	  elif [ -e "$$dest" ]; then echo "  WARN $$f exists but is not a symlink — skipping"; \
	  else ln -s "$$src" "$$dest" && echo "  link $$dest"; fi; \
	done
	@[ -f "$(CFG)/.gitignore" ] || printf 'node_modules\npackage.json\npackage-lock.json\nbun.lock\n.gitignore\n' > "$(CFG)/.gitignore"
	@[ -f "$(CFG)/dcp.jsonc" ] || printf '{"$$schema":"https://raw.githubusercontent.com/Opencode-DCP/opencode-dynamic-context-pruning/master/dcp.schema.json"}\n' > "$(CFG)/dcp.jsonc"
	@[ -f "$(CFG)/package.json" ] || printf '{"dependencies":{"@opencode-ai/plugin":"1.18.21"}}\n' > "$(CFG)/package.json"
	cd "$(CFG)" && npm install --silent || true
	@echo "done — restart opencode to pick up changes"

uninstall:
	@for f in $(LINKS); do \
	  dest="$(CFG)/$$f"; \
	  if [ -L "$$dest" ]; then rm "$$dest" && echo "  removed $$dest"; fi; \
	done

$(CFG):
	mkdir -p $@
