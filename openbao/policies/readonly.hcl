# readonly: code-only access, no secrets
path "secret/data/readonly/*" {
  capabilities = ["read"]
}

path "secret/metadata/readonly/*" {
  capabilities = ["list"]
}

path "secret/*" {
  capabilities = ["deny"]
}
