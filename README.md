# netstat-parser

webapp that parses multiple netstat files from computers and builds a graph

<!-- Add a screenshot once the UI exists: claude-shots --write netstat-parser (web), or a capture in docs/. -->

**Status:** early development. Started 2026-11-10.

## Getting started

```sh
python3 -m http.server 8580      # then open http://localhost:8580/ (or: claude-update)
```

## Tests

```sh
npm test            # node --test: tests/*.test.mjs
npm run lint        # ESLint, including the unsafe-DOM rule
```

## License

MIT. See [LICENSE](LICENSE).
