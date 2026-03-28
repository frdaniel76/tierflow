# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in TierFlow, please report it responsibly.

**Report via:** [GitHub Security Advisory](https://github.com/frdaniel76/tierflow/security/advisories/new)

**Do not** open a public issue for security vulnerabilities.

## What to Report

- PII scrubbing bypasses (data leaking through placeholders)
- API key exposure (keys logged, cached, or leaked in responses)
- Authentication bypasses on management endpoints
- Injection attacks via config or request payloads
- Memory safety issues in the PII vault

## Response Timeline

- **Acknowledgment:** within 48 hours
- **Initial assessment:** within 7 days
- **Fix + disclosure:** coordinated with reporter

## Security Design

- TierFlow binds to `127.0.0.1` by default (localhost only)
- Management endpoints (`/reload-config`, `/stats`, `/config`) have no authentication — this is by design for localhost use. If exposed on a network, use a reverse proxy with auth.
- PII vault uses AES-256-GCM encryption and is never written to disk
- API keys are read from environment variables and forwarded directly — never logged, cached, or stored
- Zero runtime dependencies reduces supply chain attack surface

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.x | Yes |
| 1.x | No |
