# Kubernetes Manifests (`infrastructure/kubernetes/`)

Raw and Kustomize-managed Kubernetes workload definitions, network policies, horizontal pod autoscalers (HPA), and config maps.

---

## Directory Organization

```
kubernetes/
├── base/           # Base deployment, service, configmap, and HPA templates
└── overlays/       # Environment-specific patches (development, staging, production)
```

---

## Workload Invariants

1. **Health Probes**:
   - Every service container exposes `/healthz` (liveness) and `/readyz` (readiness).
2. **Resource Requests & Limits**:
   - All pods must explicitly declare CPU, memory, and ephemeral storage requests and limits.
   - GPU-enabled worker pods request explicit GPU resource counts (`nvidia.com/gpu`).
3. **Pod Disruption Budgets**:
   - Critical services maintain `PodDisruptionBudget` manifests ensuring zero-downtime rolling upgrades.
