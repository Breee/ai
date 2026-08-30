# k8s_readonly: K8s cluster read access
path "secret/data/k8s/*" {
  capabilities = ["read"]
}

path "secret/metadata/k8s/*" {
  capabilities = ["list"]
}

# Shared read-only creds (gitlab, docker registry RO)
path "secret/data/shared/gitlab" {
  capabilities = ["read"]
}

path "secret/data/shared/docker" {
  capabilities = ["read"]
}

path "secret/metadata/shared/*" {
  capabilities = ["list"]
}

path "secret/*" {
  capabilities = ["deny"]
}
