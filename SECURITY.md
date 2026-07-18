# Security

## Supported version

Mainstreet is a hackathon prototype. Security fixes apply to the current `main` branch.

## Reporting a vulnerability

Use GitHub's private security advisory flow for this repository. Do not place credentials, exploit details, or sensitive run artifacts in a public issue.

## Trust boundary

Mainstreet sends the supplied business name, optional owner facts, generated source, and fresh screenshots to the configured OpenAI account. It sends only the selected static site directory to Cloudflare Pages. Do not provide private customer data unless you are authorized to send it to both services.

Generated sites contain only HTML and CSS. Mainstreet rejects scripts, inline event handlers, forms, remote assets, unsafe protocols, and unapproved file types before writing a site cycle.

## Secret handling

- Store secrets only in `.env`.
- Never commit `.env` or paste its values into run details.
- Use a least privilege Cloudflare token limited to Pages operations.
- Rotate a credential immediately if it appears in a terminal capture, screenshot, log, commit, issue, or video.
- Review run artifacts before committing a real business example. Confirm that owner supplied facts are suitable for public release.

## Local serving

The preview server binds to `127.0.0.1` and accepts only ports 4600 and 4601. It canonicalizes the selected root, rejects traversal, refuses files outside that root, and adds restrictive security headers.

## Known limits

- Vision review and deterministic gates reduce risk but do not replace a professional security assessment.
- Mainstreet does not provide authentication, payments, form processing, databases, or user generated content.
- A deployed static site inherits Cloudflare's platform controls and the security posture of the generated source.
