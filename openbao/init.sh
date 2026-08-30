#!/usr/bin/env bash
set -euo pipefail

# OpenBao initialization and setup
# Run once: docker compose exec openbao sh /openbao/init.sh

ROOT_TOKEN="${ROOT_TOKEN:-dev-root-token}"
export VAULT_ADDR="http://127.0.0.1:8200"

echo "==> Waiting for OpenBao..."
until vault status -format=json 2>&1 | jq -e '.initialized' >/dev/null 2>&1; do
  sleep 1
done

# Initialize if needed
INIT_STATUS=$(vault status -format=json 2>&1 | jq -r '.initialized')
if [ "$INIT_STATUS" = "false" ]; then
  echo "==> Initializing OpenBao..."
  vault operator init -key-shares=1 -key-threshold=1 -format=json > /tmp/init.json
  UNSEAL_KEY=$(jq -r '.unseal_keys_b64[0]' /tmp/init.json)
  echo "    Unseal key: $UNSEAL_KEY"
  echo "$UNSEAL_KEY" > /openbao/file/.unseal_key
  echo "$ROOT_TOKEN" > /openbao/file/.root_token
  rm /tmp/init.json
fi

# Unseal if needed
SEALED=$(vault status -format=json 2>&1 | jq -r '.sealed')
if [ "$SEALED" = "true" ]; then
  echo "==> Unsealing..."
  if [ -f /openbao/file/.unseal_key ]; then
    UNSEAL_KEY=$(cat /openbao/file/.unseal_key)
    vault operator unseal "$UNSEAL_KEY"
  else
    echo "    ERROR: No unseal key found. Manual unseal required."
    exit 1
  fi
fi

export VAULT_TOKEN="$ROOT_TOKEN"

echo "==> Enabling KV v2..."
vault secrets enable -version=2 -path=secret kv 2>/dev/null || echo "    (already enabled)"

echo "==> Writing policies..."
vault policy write agent-readonly /openbao/policies/readonly.hcl
vault policy write agent-k8s-readonly /openbao/policies/k8s-readonly.hcl

echo "==> Enabling AppRole..."
vault auth enable approle 2>/dev/null || echo "    (already enabled)"

echo "==> Creating roles..."
vault write auth/approle/role/readonly \
  token_policies="agent-readonly" \
  token_ttl=1h token_max_ttl=4h secret_id_ttl=0 token_num_uses=0
echo "    readonly -> agent-readonly"

vault write auth/approle/role/k8s-readonly \
  token_policies="agent-k8s-readonly" \
  token_ttl=1h token_max_ttl=4h secret_id_ttl=0 token_num_uses=0
echo "    k8s-readonly -> agent-k8s-readonly"

echo "==> Seeding secrets..."
vault kv put secret/readonly/config \
  note="readonly agent placeholder"

vault kv put secret/shared/gitlab \
  read_token="glrt-REPLACE-ME" \
  api_url="https://gitlab.example.com/api/v4"

vault kv put secret/shared/docker \
  registry="registry.example.com" \
  username="deployer" \
  password="REPLACE-ME"

vault kv put secret/k8s/staging \
  server="https://staging-cluster.example.com" \
  token="REPLACE-ME" \
  namespace="staging"

vault kv put secret/k8s/production \
  server="https://prod-cluster.example.com" \
  token="REPLACE-ME" \
  namespace="production"

echo ""
echo "==> Agent credentials (save these):"
echo ""
for agent in readonly k8s-readonly; do
  role_id=$(vault read -field=role_id "auth/approle/role/$agent/role-id")
  secret_id=$(vault write -f -field=secret_id "auth/approle/role/$agent/secret-id")
  echo "--- $agent ---"
  echo "  ROLE_ID:     $role_id"
  echo "  SECRET_ID:   $secret_id"
  echo ""
done

echo "==> Done. UI: http://127.0.0.1:8200/ui"
