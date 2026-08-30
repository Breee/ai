# Explore agent: read-only code access, no secrets
path "secret/data/explore/*" {
  capabilities = ["read"]
}

path "secret/metadata/explore/*" {
  capabilities = ["list"]
}

# Deny all other secret paths
path "secret/*" {
  capabilities = ["deny"]
}
