# Deploy agent: ArgoCD + Kargo credentials
path "secret/data/deploy/argocd" {
  capabilities = ["read"]
}

path "secret/data/deploy/kargo" {
  capabilities = ["read"]
}

path "secret/data/deploy/k8s-*" {
  capabilities = ["read"]
}

path "secret/metadata/deploy/*" {
  capabilities = ["list"]
}

path "secret/*" {
  capabilities = ["deny"]
}
