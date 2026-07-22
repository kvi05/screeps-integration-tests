# Roadmap

## Distribution & Publishing

- [ ] Publish the package to npm

## CLI & Tooling

- [ ] Implement `npx screeps-integration-tests capture <name>` as a proper subcommand (currently capture is a standalone `src/tools/capture-fixture.js`)
- [ ] Add CI

## API & Architecture

- [x] Rethink the `bots` parameter in `createWorld`
- [x] API for creating structures after the world has started
- [ ] Support loading different AI for different bots
- [ ] Group tests and run them by group
- [ ] Resolve ID collisions when using fixtures across multiple rooms

## Metrics

- [ ] Add per-entity metrics
- [ ] Flatten the metrics collection script into a flat structure
- [ ] Native Excel export for metrics, more tooling for downstream analysis/comparison
- [ ] Improved bot metric regression control in scenarios

## Fixtures

- [ ] Multi-room fixture support

## Events

- [ ] More standard events
