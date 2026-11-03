# System Protection Stack

Layered defense to keep the system responsive regardless of what agents or workloads do.

## Layers

| Layer | Scope | Survives reboot? | Survives cluster teardown? |
|---|---|---|---|
| systemd-oomd | Host | Yes | Yes |
| sysctl | Host | Yes | Yes |
| Docker defaults | Host | Yes | Yes |
| K8s LimitRange | Cluster | No | No |
| K8s ResourceQuota | Cluster | No | No |
| Kyverno policy | Cluster | No | No |

## Host-level (apply once, persists forever)

```bash
sudo bash apply-protection.sh
```

## K8s-level (per cluster)

```bash
kubectl apply -f k8s-protection.yaml
```

## k3d auto-bootstrap

```bash
bash ../gitlab.com/corewire/images/mastery/k3d/create.sh
```

k3s auto-applies manifests from `/var/lib/rancher/k3s/server/manifests/`.

## How it protects you

```
Rogue process eats RAM
  → systemd-oomd kills it at 50% pressure
  → overcommit_memory=2 refuses new allocations
  → min_free_kbytes reserves 256MB for kernel
  → System stays responsive
```
