# Documentation Index

## Technical Reference

- **[privacy-engine.md](./privacy-engine.md)** - Canonical heuristic reference, scoring model, threat model, academic references
- **[development-guide.md](./development-guide.md)** - Architecture, data flow, chain modules, scoring, colors, API endpoints
- **[ui/design.md](./ui/design.md)** - UI design system: principles, theme tokens (dark and light), type, layout, copy and component rules
- **[testing.md](./testing.md)** - Test suites, fixtures, golden baselines and how to update them, e2e mocks, CLI tests, coverage
- **[testing-reference.md](./testing-reference.md)** - Reference transactions/addresses with expected grades and the score matrix
- **[mempool-self-hosted-differences.md](./mempool-self-hosted-differences.md)** - Hosted vs self-hosted mempool API differences (electrs forks, prevout field)
- **[xpub-analysis.md](./xpub-analysis.md)** - Wallet (xpub/descriptor) privacy analysis

## Architecture Decisions

- **[adr-boltzmann-wasm.md](./adr-boltzmann-wasm.md)** - Rust/WASM Boltzmann link probability matrix
- **[adr-finding-tiers.md](./adr-finding-tiers.md)** - Adversary tiers and temporality for findings
- **[adr-recommendations.md](./adr-recommendations.md)** - Results page actions vs guide page education
- **[adr-indexeddb-cache.md](./adr-indexeddb-cache.md)** - Persistent IndexedDB API cache
- **[adr-oxt-graph.md](./adr-oxt-graph.md)** - OXT-style transaction graph
- **[adr-groundtruth.md](./adr-groundtruth.md)** - Groundtruth library for analysis QA

## Research

- **[research-boltzmann-entropy.md](./research-boltzmann-entropy.md)** - Boltzmann framework (E = log2(N)), partition formula, worked examples
- **[research-wabisabi-entropy.md](./research-wabisabi-entropy.md)** - Tier-decomposed Boltzmann for WabiSabi CoinJoins
- **[research-oxt-graph.md](./research-oxt-graph.md)** - OXT transaction graph visualization
- **[research-privacy-pathways.md](./research-privacy-pathways.md)** - Privacy techniques beyond CoinJoin

## Deployment

- **[deploy-umbrel.md](./deploy-umbrel.md)** - Umbrel app development and deployment guide

## Specs and Planning

- **[TODO.md](./TODO.md)** - Open backlog
- **[spec-cli-tool.md](./spec-cli-tool.md)** - CLI tool requirements, architecture, commands, JSON schemas
- **[spec-custom-api-endpoint.md](./spec-custom-api-endpoint.md)** - Custom mempool API URL feature
- **[spec-before-you-send.md](./spec-before-you-send.md)** - PSBT and raw tx analysis before broadcast, QR/file input, opt-in broadcast (0.38.0)
- **[plan-before-you-send.md](./plan-before-you-send.md)** - Task-by-task implementation plan for the spec above
- **[spec-observatory-p2p.md](./spec-observatory-p2p.md)** - Observatory P2P markets tab: RoboSats, Mostro and HodlHodl offers, premiums, venue health, volume (0.41.0)
- **[superpowers/plans/2026-10-07-observatory-p2p.md](./superpowers/plans/2026-10-07-observatory-p2p.md)** - Task-by-task implementation plan for the spec above
- **[spec-site-videos.md](./spec-site-videos.md)** - Promo on the home page and /tutorial page, GitHub Pages only
- **[tx-graph-roadmap.md](./tx-graph-roadmap.md)** - Transaction graph roadmap

## Research Archive

- **[archive/](./archive/)** - OXT Research "Understanding Bitcoin Privacy" series (Parts 1-4, HTML + PDF)
