# Ops agent: incident response, temporary elevated access
path "secret/data/ops/*" {
  capabilities = ["read"]
}

path "secret/data/shared/*" {
  capabilities = ["read"]
}

path "secret/metadata/ops/*" {
  capabilities = ["list"]
}

path "secret/metadata/shared/*" {
  capabilities = ["list"]
}

# Can list all secret paths for discovery
path "secret/metadata/*" {
  capabilities = ["list"]
}

path "secret/*" {
  capabilities = ["deny"]
}
