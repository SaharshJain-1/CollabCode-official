# CollabCode - Microservices-Based Collaborative Code Editor

CollabCode is a highly scalable, microservices-based collaborative code editor deployed on Kubernetes. It is designed to tackle the distributed-systems challenges of real-time state synchronization under high concurrency and to provide secure, ephemeral remote code execution (RCE) for arbitrary user-submitted programs.

---

## ✨ Key Features

- **Real-Time Code Collaboration:** Synchronizes code edits across multiple users in milliseconds using a decoupled WebSocket layer and a Redis Pub/Sub backplane.
- **Secure Remote Code Execution (RCE):** Runs user submissions in freshly created, resource-limited, ephemeral Kubernetes Pods to ensure strong sandbox isolation. Supports C++, Java, Python, Go, Rust, and JavaScript.
- **AI Coding Assistant:** Integrated AI chatbot and inline autocomplete powered by the Groq API (models used: `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`).
- **Collaborative Whiteboard:** Shared drawing canvas built with `tldraw`.
- **Event-Driven Autoscaling:** Dynamically scales worker pods based on the Redis submission queue depth using KEDA (Kubernetes Event-driven Autoscaling).
- **High Availability:** Application tiers (Frontend, Express Server, WebSocket Server) are scaled automatically by the Kubernetes Horizontal Pod Autoscaler (HPA) based on CPU utilization.

---

## 🏗️ System Architecture

CollabCode is decomposed into four independently deployable microservices and a stateful data store:

1. **Frontend:** React SPA served by NGINX, embedding the Monaco Editor, TLDraw whiteboard, and a room chat.
2. **Express Server:** REST API that enqueues code submissions to Redis and proxies AI requests to Groq.
3. **WebSocket Server:** Manages persistent WebSocket connections and routes real-time collaborative events through Redis channels.
4. **Worker Daemon:** Consumes execution jobs from Redis, provisions ephemeral Kubernetes Pods to execute code, and publishes results back to the room.
5. **Redis:** Message broker (Pub/Sub) and job queue, running as a StatefulSet with append-only persistence.

---

## 🛠️ Technology Stack

- **Frontend:** React 18, Recoil, Monaco Editor, Tailwind CSS, Axios, tldraw  
- **Backend (API & WS):** Node.js, Express.js, TypeScript, `ws` library, Redis Node client  
- **Worker:** Node.js, `@kubernetes/client-node`, TypeScript  
- **Infrastructure & Orchestration:** Kubernetes (Minikube), NGINX Ingress Controller, KEDA v2.16, Metrics Server, Docker

---

## 🚀 Local Deployment Guide

The following instructions will help you deploy the entire platform locally using Minikube.

### Prerequisites
- A local Kubernetes cluster (Minikube recommended)
- `kubectl` and Docker
- NGINX Ingress Controller enabled:
  ```bash
  minikube addons enable ingress
  ```
- Metrics Server enabled:
  ```bash
  minikube addons enable metrics-server
  ```
- A valid Groq API Key

### 1. Install KEDA
Install KEDA for event-driven autoscaling of the worker pods:
```bash
kubectl apply --server-side -f https://github.com/kedacore/keda/releases/download/v2.16.1/keda-2.16.1.yaml
```

### 2. Build Docker Images
Build all component images from the project root:
```bash
docker build -t collabcode/express-server:local ./express-server
docker build -t collabcode/websocket-server:local ./websocket-server
docker build -t collabcode/worker:local ./worker
docker build -t collabcode/frontend:local ./frontend
```
If using Minikube, load the images into the cluster:
```bash
minikube image load collabcode/express-server:local
minikube image load collabcode/websocket-server:local
minikube image load collabcode/worker:local
minikube image load collabcode/frontend:local
```
Alternatively build inside Minikube's Docker daemon:
```bash
eval $(minikube -p minikube docker-env)
# then run docker build commands (they will build into the Minikube daemon)
```

### 3. Configure Secrets
Create the secret file for the Groq AI API key:
```bash
cp ./k8s/secret.example.yaml ./k8s/secrets.yaml
```
Edit `./k8s/secrets.yaml` and insert your real Groq API key.  
Important: do NOT commit `k8s/secrets.yaml` to version control. If you accidentally committed keys, rotate/revoke them immediately.

### 4. Deploy Manifests
Apply the Kubernetes configurations:
```bash
kubectl apply -f ./k8s/namespace.yaml
kubectl apply -f ./k8s/configmap.yaml
kubectl apply -f ./k8s/secrets.yaml
kubectl apply -f ./k8s/redis.yaml
kubectl apply -f ./k8s/express-server.yaml
kubectl apply -f ./k8s/websocket-server.yaml
kubectl apply -f ./k8s/worker.yaml
kubectl apply -f ./k8s/frontend.yaml
kubectl apply -f ./k8s/ingress.yaml
kubectl apply -f ./k8s/ingress-api.yaml
```

### 5. Add Host Mapping
Map the ingress domain to your local loopback address (or Minikube IP) in your system hosts file:

- Windows: edit `C:\Windows\System32\drivers\etc\hosts` (requires admin)
- Linux/macOS: edit `/etc/hosts` (requires sudo)

Add a line:
```
127.0.0.1 collabcode.local
```

### 6. Access the Application
Validate that your pods are running:
```bash
kubectl get pods -n collabcode
```
Once ready, open your browser and navigate to:
```
http://collabcode.local
```
