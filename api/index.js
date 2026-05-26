/**
 * DocTreen live demo (Vercel-ready).
 *
 * A self-contained Express app showcasing the v1.5 Zod-first API:
 *   - defineRoute with raw Zod schemas (no zodToSchemaNode wrapping)
 *   - declared error responses with Zod
 *   - JSDoc-only routes (legacy path still supported)
 *
 * Deploy with `vercel --prod`. All paths route to this single function;
 * Vercel auto-detects /api/index.js without a builds config.
 */

'use strict';

const express = require('express');
const { z } = require('zod');
const { expressAdapter, defineRoute } = require('../src/adapters/express');

const app = express();
app.use(express.json());

// ── Schemas (each one used for both docs and runtime validation, post-1.5) ──

const User = z.object({
  id:    z.number(),
  name:  z.string(),
  email: z.string().email(),
  role:  z.enum(['admin', 'user']).optional(),
});

const CreateUser = z.object({
  name:  z.string().min(2),
  email: z.string().email(),
});

const ListQuery = z.object({
  role:   z.enum(['admin', 'user']).optional(),
  limit:  z.string().optional(),
});

const Error4xx = z.object({ message: z.string(), code: z.string() });

// ── Routes ──────────────────────────────────────────────────────────────────

app.get('/users', defineRoute(
  (req, res) => res.json([{ id: 1, name: 'Ada', email: 'ada@example.com', role: 'admin' }]),
  {
    description: 'List users — optionally filter by role',
    request:  { query: ListQuery },
    response: z.array(User),
  }
));

app.post('/users', defineRoute(
  (req, res) => res.status(201).json({ id: 2, ...req.body, role: 'user' }),
  {
    description: 'Create a new user',
    request:  { body: CreateUser },
    response: User,
    errors: {
      409: { description: 'Email already in use', schema: Error4xx },
      422: { description: 'Validation failed',     schema: Error4xx },
    },
  }
));

app.get('/users/:id', defineRoute(
  (req, res) => res.json({ id: Number(req.params.id), name: 'Ada', email: 'ada@example.com' }),
  {
    description: 'Get one user by id',
    response: User,
    errors:   { 404: { description: 'User not found', schema: Error4xx } },
  }
));

/**
 * Healthcheck — documented via JSDoc instead of `defineRoute`.
 *
 * @response { ok: boolean, uptime: number }
 */
app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ── DocTreen docs UI ────────────────────────────────────────────────────────

app.use(expressAdapter(app, {
  docsPath: '/docs',
  enabled: true,
  meta: {
    title: 'DocTreen Demo API',
    version: '1.5.0',
    description: 'Live demo — every endpoint declared with a Zod schema. Visit /docs.',
  },
}));

// Root → /docs for convenience
app.get('/', (req, res) => res.redirect('/docs'));

module.exports = app;
