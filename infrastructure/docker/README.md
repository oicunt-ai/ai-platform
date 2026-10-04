# Docker Specifications (`infrastructure/docker/`)

Container image build definitions, multi-stage build patterns, and development container setups for AI platform services and workers.

---

## Standards & Best Practices

1. **Multi-Stage Builds**:
   - Stage 1: Build & bundle TypeScript sources with pnpm.
   - Stage 2: Runtime image containing only production dependencies, compiled JavaScript (`dist/`), and minimal system libraries.
2. **Security**:
   - Execute under a dedicated unprivileged user (`USER node` / `USER 10001`).
   - Read-only root filesystem where feasible.
   - Regular automated CVE scanning in CI.
3. **Layer Caching**:
   - Copy `package.json`, `pnpm-lock.yaml`, and workspace descriptors first to optimize layer caching before copying source trees.
