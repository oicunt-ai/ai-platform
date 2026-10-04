# AI Platform Infrastructure (`infrastructure/`)

Declarative Infrastructure as Code (IaC), containerization definitions, and Kubernetes workload specifications for the **OICUNT AI Platform**.

---

## 1. Scope & Strategy

This directory manages the deployment topology, cloud resources, container definitions, and Kubernetes orchestration manifests for AI platform services and workers.

### Directory Structure

```
infrastructure/
├── docker/         # Multi-stage Dockerfiles and container base images
├── kubernetes/     # Declarative Kubernetes manifests and environment overlays
├── helm/           # Helm charts for AI services, workers, and infrastructure components
└── terraform/      # Terraform modules and environments for cloud AI infrastructure
```

---

## 2. Infrastructure Principles

1. **Separation from Company Platform Infrastructure**:
   - Company-wide infrastructure (core VPCs, IAM root roles, enterprise databases, company-wide ingress) is managed in `https://github.com/oicunt-ai/platform`.
   - AI-specific infrastructure (GPU worker node pools, vector search clusters, AI model secret stores, private inference endpoints) resides here.

2. **Immutable Containers**:
   - Containers are built as minimal distroless or alpine images, execute with non-root security contexts, and run immutable release artifacts.

3. **Declarative GitOps**:
   - Workload manifests in Helm/Kubernetes are deployed via declarative GitOps pipelines.
