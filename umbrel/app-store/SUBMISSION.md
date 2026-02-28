# Umbrel App Store Submission Guide

## Prerequisites

1. Docker images must be built and pushed to GHCR (multi-arch: amd64 + arm64)
2. A 256x256 SVG icon with no rounded corners
3. 3-5 gallery screenshots at 1440x900px

## Step-by-step

### 1. Tag and push Docker images

```bash
# Tag the release
git tag v0.9.0
git push origin v0.9.0

# This triggers .github/workflows/docker-umbrel.yml
# which builds and pushes ghcr.io/copexit/am-i-exposed-umbrel:v0.9.0
# for linux/amd64 and linux/arm64
```

### 2. Get the image digest

After the CI builds complete:

```bash
docker buildx imagetools inspect ghcr.io/copexit/am-i-exposed-umbrel:v0.9.0
```

Copy the sha256 digest and update `docker-compose.yml`:
```yaml
image: ghcr.io/copexit/am-i-exposed-umbrel:v0.9.0@sha256:<digest>
```

### 3. Fork and clone umbrel-apps

```bash
gh repo fork getumbrel/umbrel-apps --clone
cd umbrel-apps
```

### 4. Create the app directory

```bash
mkdir am-i-exposed
cp /path/to/umbrel/app-store/umbrel-app.yml am-i-exposed/
cp /path/to/umbrel/app-store/docker-compose.yml am-i-exposed/
```

### 5. Update the PR number

After opening the PR, update `submission:` in `umbrel-app.yml` with the actual PR URL.

### 6. Open the PR

The PR should include:
- The `am-i-exposed/` directory with both YAML files
- 256x256 SVG icon attached
- Gallery images (1440x900px) attached or linked
- Testing checklist (tested on umbrelOS on Linux VM at minimum)

## Testing locally

```bash
# From the am-i-exposed repo root
docker build -f Dockerfile.umbrel -t am-i-exposed-umbrel:test .
docker run -p 8080:8080 \
  -e APP_MEMPOOL_IP=mempool.space \
  -e APP_MEMPOOL_PORT=443 \
  am-i-exposed-umbrel:test
# Visit http://localhost:8080
```
