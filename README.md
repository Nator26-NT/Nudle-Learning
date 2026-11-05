# Nudle Learning Platform

Full-stack learning management platform with an interactive hardware-troubleshooting simulation.

## Quick Start
[the pip install + python app.py steps]

## Demo Accounts
| Role    | Email              | Password   |
|---------|--------------------|------------|
| Admin   | admin@nudle.com    | Admin123!  |
| Learner | learner@nudle.com  | Learner123!|

## Technology Stack
- Backend: Flask 3, SQLite (stdlib), Werkzeug password hashing
- Frontend: Vanilla JS SPA, semantic HTML, custom CSS with design tokens
- No ORM, no auth library, no build step — see "Design Decisions"

## Architecture Overview
[diagram or bullet list showing browser → Flask routes → SQLite]

## Features Completed
### Admin
- ✅ Dashboard with live stats + 7-day completion chart
- ✅ Learner CRUD (add / edit / toggle active / search / filter)
- ✅ Activity creation
- ✅ Assign activity to multiple learners
- ✅ Per-learner progress modal
- ✅ Performance report + CSV export
- ✅ Audit log

### Learner
- ✅ Personal dashboard with stats
- ✅ Assigned activity list
- ✅ Branching simulation (hardware troubleshooting)
- ✅ Auto-saved result + history view

### Cross-cutting
- ✅ Role-based access control (session-based)
- ✅ Server-side score recomputation (client score is never trusted)
- ✅ Parameterised SQL everywhere
- ✅ Hashed passwords (PBKDF2 via Werkzeug)
- ✅ Responsive layout (desktop + mobile)
- ✅ Loading / success / error states
- ✅ Audit logging

## Partially Completed
- ⚠️ Real-time dashboard updates — implemented as refresh-on-load, not WebSockets
- ⚠️ Simulation "resume" — progress resets if the learner closes the tab mid-simulation

## Not Implemented
- ❌ Password reset flow
- ❌ Configurable scenarios via admin UI (scenarios are coded in `SIMULATION` dict)
- ❌ Automated test suite (manual test checklist in `TESTING.md`)

## Design Explanation
[~200 words on colour palette, layout, why sidebar + topbar, accessibility choices]

## Development Summary
[~200 words: what was built, what was hard, what you'd do with more time]

## Known Limitations
- SQLite is single-writer; fine for this scope, would move to Postgres at scale
- `debug=True` in `app.py` — must be disabled for production
- Session cookie is signed but not encrypted; no HTTPS in local dev
- `SECRET_KEY` falls back to a dev default — set `SECRET_KEY` in `.env` for any real deployment

## AI Assistance Disclosure
AI was used to scaffold the boilerplate (Flask routes, CSS tokens, simulation node graph) and to help debug syntax issues. All application logic, data model, and design decisions were reviewed and are understood line by line. [Adjust this statement to reflect your actual use.]