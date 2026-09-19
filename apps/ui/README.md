# Kairo UI v2

This is an isolated Next.js frontend for the approved Kairo interface. It does not import components, stylesheets, design tokens, or layout code from `apps/web`.

It reads the existing `kairo_access_token` cookie and calls the existing API through `KAIRO_API_URL`. Navigation and content workflows remain within this application.

## Local development

```bash
npm run dev --workspace @kairo/ui -- --hostname 0.0.0.0 --port 4173
```

## Vercel project settings

- Root directory: `apps/ui`
- Framework: Next.js
- Build command: `npm run build`
- Environment: `KAIRO_API_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_AUDIENCE`

Register `https://<v2-production-domain>/auth/callback` as an allowed callback URL and `https://<v2-production-domain>` as an allowed logout URL with the existing identity provider. Until that is configured, the page deliberately renders approved concept data when no access-token cookie is available.
