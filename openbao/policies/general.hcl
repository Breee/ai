# General agent: developer secrets
path "secret/data/general/*" {
  capabilities = ["read"]
}

path "secret/data/shared/gitlab/*" {
  capabilities = ["read"]
}

path "secret/data/shared/docker/*" {
  capabilities = ["read"]
}

path "secret/metadata/general/*" {
  capabilities = ["list"]
}

path "secret/metadata/shared/*" {
  capabilities = ["list"]
}

path "secret/*" {
  capabilities = ["deny"]
}
