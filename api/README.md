# studio-api

FastAPI service: embedded Nostr relay (NIP-01/42), control plane and media API. See [docs/adr](../docs/adr) for the architectural decisions and [../CONTEXT.md](../CONTEXT.md) for the domain glossary.

## Local development

Everything runs through the repo-root `docker-compose.yml` — see the root README (once one exists) or `docs/adr/0001-relay-embedded-in-api.md`.

```bash
# from the repo root
docker compose up -d
docker compose --profile test run --rm test              # test suite
docker compose --profile test run --rm test uv run mypy src tests
docker compose --profile test run --rm test uv run ruff check src tests
```

`SURREAL_URL` must point at a real, running SurrealDB instance — the SDK's embedded `mem://` engine has a broken live-query implementation (see ADR-0004).
