## What I built
[3–4 sentences]

## Challenges encountered
- Getting the branching simulation to compute score server-side without trusting the client
- Handling SQLite UNIQUE violations on re-assignment cleanly (caught IntegrityError per row)
- Making the SPA router preserve auth state across page reloads (session cookie + /api/me)
- Fixing a TypeScript parser issue in plain JS by adding jsconfig.json

## What I would improve with more time
- Real WebSocket dashboard updates
- Configurable scenarios stored in DB instead of code
- Automated tests (pytest + Playwright for the simulation flow)
- Password reset + email verification
- Deployment to Fly.io/Render with HTTPS + production SECRET_KEY