# Stack guide

Used by stage 2 (grill me, part A) of `/expert-teams:create` and `/expert-teams:modify` when the user wants advice on the technology. It leads from the hard limits to the stack, never the other way round. Edit this file freely: the skills read it at run time and contain no stack knowledge of their own.

## How to use it

1. Ask the questions below in order, one or two at a time. Skip what the user already said in stage 1 and only confirm it.
2. Each answer narrows the options. The first question (where it runs) is the hardest limit and wins every conflict.
3. Propose exactly one stack: one line per layer (backend, database, frontend, hosting and operation), a short reason for each, and the alternative you rejected and why.
4. Prefer fewer moving parts and the language the maintainer knows over what is fashionable.

## Questions

1. **Where should it run?** Shared webhosting (e.g. Strato, IONOS, All-Inkl, Hetzner webhosting), own server or VPS with Docker, managed cloud or PaaS, the user's desktop, or a phone.
2. **Who maintains it later, and which programming language does that person know?** Nobody technical counts as an answer too.
3. **How many users, and how sensitive is the data?** Internal tool for a few people, customers from outside, personal data under GDPR, money amounts.
4. **Does it need offline use, a mobile app, or real time** (live updates, chat, collaboration)?

## Where it runs

| Hosting | Hard limits | Default stack |
|---|---|---|
| Shared webhosting | PHP and MySQL/MariaDB only, no Node or Python runtime, no long-running processes, no Docker, often no SSH. Background jobs only by cron. | PHP 8.3 or later with MariaDB or MySQL. Laravel if Composer and SSH are available, otherwise a small framework such as Slim. Server-rendered pages (Blade or Twig) with htmx or Alpine.js. Any frontend build runs locally, only the built files are uploaded. |
| Own server or VPS with Docker | Someone must look after updates, TLS and backups. | Free choice by the maintainer's language (next table). docker compose with the app and PostgreSQL, Caddy as reverse proxy for TLS, a nightly database backup to another location. |
| Managed cloud or PaaS | Costs grow with use; vendor lock-in. | Vercel or Netlify: Next.js with a managed PostgreSQL (e.g. Neon, Supabase). Azure, AWS or Google Cloud: a container as on a VPS, with the provider's managed PostgreSQL. |
| Desktop | Runs offline, installs per machine, updates must be shipped. | Tauri (small, Rust core) or Electron (larger, pure TypeScript), SQLite as local database. |
| Phone | Store review and two platforms, unless a web app is enough. | First check whether a progressive web app (PWA) suffices. For a store app: React Native with TypeScript or Flutter. |

## Who maintains it

| Maintainer knows | Backend and database (if the hosting allows) |
|---|---|
| TypeScript or JavaScript | Node.js with Fastify or NestJS, PostgreSQL, React or Vue in the frontend |
| PHP | Laravel, MariaDB or PostgreSQL |
| Python | Django (with admin) or FastAPI, PostgreSQL |
| Java or Kotlin | Spring Boot, PostgreSQL |
| C# | ASP.NET Core, PostgreSQL or SQL Server |
| Nobody technical | The simplest option the hosting allows, with as few parts as possible; on shared webhosting PHP, otherwise a single Docker container. |

## Users and data

- **A few internal users:** a simple login (one password or accounts with sessions) is enough; one server, no scaling.
- **External customers:** proper accounts, password reset, rate limits; plan for more than one server only if the numbers demand it.
- **Personal data (GDPR):** hosting in the EU, a data processing agreement with the host, encrypted backups, deletion on request; name a privacy reviewer role in the team.
- **Money amounts:** exact decimal types in the database (`numeric` or `decimal`), never floating point.

## Offline, mobile, real time

- **Offline:** a PWA with a service worker and local storage, or a desktop app with SQLite. Plan how changes are synced and conflicts resolved.
- **Mobile:** a responsive web app first; a PWA if it should be installable; a native app only for device features or store presence.
- **Real time:** WebSockets need a long-running process, so not on shared webhosting; there use polling every few seconds. On a VPS or cloud: WebSockets or server-sent events.
