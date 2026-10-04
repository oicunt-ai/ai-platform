# Helm Charts (`infrastructure/helm/`)

Configurable Helm packaging charts for AI Platform microservices and asynchronous workers.

---

## Chart Standards

- **Common Library Chart**: Reusable base chart capturing platform ingress conventions, probe configurations, standard environment variables, and telemetry annotations.
- **Service Charts**: Lightweight charts extending the common library chart with service-specific configs and secrets.
- **Strict Linting**: All charts must pass `helm lint` in CI before release.
