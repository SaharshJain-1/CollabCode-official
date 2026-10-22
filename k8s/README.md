# CollabCode Local Kubernetes Deployment

This folder contains Kubernetes manifests to run all 4 services locally:

- `frontend`
- `express-server`
- `websocket-server`
- `worker`
- plus `redis` with persistent storage

## Architecture goals covered

- **Scalability**:
  - `frontend`, `express-server`, and `websocket-server` run with 2 replicas and HPAs.
  - `worker` uses **KEDA ScaledObject** on Redis queue `problems` (`minReplicaCount: 1`, `maxReplicaCount: 10`, scale target: 10 queued jobs).
- **Persistence**:
  - Redis runs as a StatefulSet with `appendonly yes` and a PVC (`1Gi`).
- **Single point of failure awareness**:
  - App tiers are multi-replica.
  - Redis is currently single-primary (persistent but still an SPOF). For true HA, move to Redis Sentinel/Cluster.

## Prerequisites

- A local Kubernetes cluster (Docker Desktop Kubernetes, Minikube, or Kind)
- NGINX Ingress Controller installed
- KEDA installed (for worker queue-length autoscaling)
- `kubectl`
- Docker available to build images

## 0) Install KEDA (one-time)

```powershell
kubectl apply --server-side -f https://github.com/kedacore/keda/releases/download/v2.16.1/keda-2.16.1.yaml
```

## 1) Build images

Build all images from project root:

```powershell
docker build -t collabcode/express-server:local .\express-server
docker build -t collabcode/websocket-server:local .\websocket-server
docker build -t collabcode/worker:local .\worker
docker build -t collabcode/frontend:local .\frontend
```

If you use **Kind**, load images into cluster nodes:

```powershell
kind load docker-image collabcode/express-server:local
kind load docker-image collabcode/websocket-server:local
kind load docker-image collabcode/worker:local
kind load docker-image collabcode/frontend:local
```

## 2) Configure secret

Copy `secret.example.yaml` to `secret.yaml` and set your real Groq key:

```powershell
Copy-Item .\k8s\secret.example.yaml .\k8s\secret.yaml
```

Then edit `k8s/secret.yaml` and replace `GROQ_API_KEY` value.

## 3) Deploy manifests

```powershell
kubectl apply -f .\k8s\namespace.yaml
kubectl apply -f .\k8s\configmap.yaml
kubectl apply -f .\k8s\secret.yaml
kubectl apply -f .\k8s\redis.yaml
kubectl apply -f .\k8s\express-server.yaml
kubectl apply -f .\k8s\websocket-server.yaml
kubectl apply -f .\k8s\worker.yaml
kubectl apply -f .\k8s\frontend.yaml
kubectl apply -f .\k8s\ingress.yaml
```

## 4) Add local host mapping

Add this to your hosts file (`C:\Windows\System32\drivers\etc\hosts`):

```text
127.0.0.1 collabcode.local
```

If using Minikube, use `minikube ip` instead of `127.0.0.1`.

## 5) Validate

```powershell
kubectl get pods -n collabcode
kubectl get svc -n collabcode
kubectl get ingress -n collabcode
```

Open:

- `http://collabcode.local`

## Important note about worker runtime

The worker now runs code using **ephemeral Kubernetes Pods** via the Kubernetes API.
No Docker socket mount is used.

## Next hardening steps (recommended)

- Replace single Redis with Redis Sentinel/HA chart.
- Add PodDisruptionBudgets and anti-affinity rules.
- Externalize logs and metrics (Prometheus/Grafana + Loki).
- Move API key management to external secret manager.
