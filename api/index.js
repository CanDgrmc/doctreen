/**
 * DocTreen live demo (Vercel-ready).
 *
 * A self-contained Express app showcasing the full doctreen surface:
 *   - defineRoute with raw Zod schemas (v1.5)
 *   - runtime validation middleware (v1.6) — invalid bodies get 422
 *   - declared request headers (Authorization, etc.)
 *   - JSDoc-only routes (legacy path still supported)
 *   - nested express.Router() introspection
 *   - bundled flows (Flow Creator + saved flows visible in the UI)
 *   - OpenAPI 3.1 export at /docs/openapi.json (v1.7)
 *   - securitySchemes + per-route security + Authorization auto-strip (v1.8)
 *   - hidden: true to keep internal routes out of docs / OpenAPI (v1.8)
 *   - headHtml config injecting Vercel Analytics + Speed Insights (v1.9)
 *
 * Deploy with `vercel --prod`. All paths route to this single function;
 * Vercel auto-detects /api/index.js without a builds config.
 *
 * Note: Vercel Analytics + Speed Insights scripts are loaded
 * unconditionally, but only collect data when the matching products are
 * enabled on the Vercel dashboard for this project.
 */

'use strict';

const express = require('express');
const { z } = require('zod');
const { expressAdapter, defineRoute } = require('doctreen/express');

const app = express();
app.use(express.json());

// ── Schemas ────────────────────────────────────────────────────────────────

const User = z.object({
  id:        z.number(),
  name:      z.string(),
  email:     z.string().email(),
  role:      z.enum(['admin', 'user']),
  active:    z.boolean(),
  createdAt: z.string().datetime(),
});

const CreateUser = z.object({
  name:  z.string().min(2),
  email: z.string().email(),
  role:  z.enum(['admin', 'user']).optional(),
});

const UpdateUser = z.object({
  name:  z.string().min(2).optional(),
  email: z.string().email().optional(),
});

const ListUsersQuery = z.object({
  role:   z.enum(['admin', 'user']).optional(),
  search: z.string().optional(),
  page:   z.coerce.number().int().min(1).optional(),
  limit:  z.coerce.number().int().min(1).max(100).optional(),
});

const Product = z.object({
  id:       z.number(),
  name:     z.string(),
  price:    z.number(),
  category: z.enum(['electronics', 'furniture', 'kitchen', 'apparel']),
  inStock:  z.boolean(),
});

const CreateProduct = z.object({
  name:     z.string().min(1),
  price:    z.number().positive(),
  category: z.enum(['electronics', 'furniture', 'kitchen', 'apparel']),
  inStock:  z.boolean().optional(),
});

const LoginBody    = z.object({ email: z.string().email(), password: z.string().min(8) });
const RefreshBody  = z.object({ refreshToken: z.string().min(1) });
const TokenPair    = z.object({
  token:        z.string(),
  refreshToken: z.string(),
  expiresIn:    z.number(),
  user:         z.object({ id: z.number(), email: z.string().email(), role: z.string() }),
});

const Error4xx = z.object({ message: z.string(), code: z.string().optional() });

const AUTH_HEADER = { Authorization: 'Bearer <token>' };
const JSON_HEADER = { 'Content-Type': 'application/json' };

// ── Users ──────────────────────────────────────────────────────────────────

app.get('/users', defineRoute(
  (req, res) => res.json({
    users: [
      { id: 1, name: 'Ada Lovelace',    email: 'ada@example.com',    role: 'admin', active: true,  createdAt: '2026-01-15T10:00:00Z' },
      { id: 2, name: 'Grace Hopper',    email: 'grace@example.com',  role: 'admin', active: true,  createdAt: '2026-02-02T09:30:00Z' },
      { id: 3, name: 'Linus Torvalds',  email: 'linus@example.com',  role: 'user',  active: false, createdAt: '2026-03-11T14:12:00Z' },
    ],
    total: 3,
    page:  Number(req.query.page  || 1),
    limit: Number(req.query.limit || 20),
  }),
  {
    description: 'List users with optional role filter, search and pagination.',
    request:  { query: ListUsersQuery },
    response: z.object({
      users: z.array(User),
      total: z.number(),
      page:  z.number(),
      limit: z.number(),
    }),
    headers: { ...AUTH_HEADER },
  }
));

app.get('/users/:id', defineRoute(
  (req, res) => res.json({
    id: Number(req.params.id),
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role: 'admin',
    active: true,
    createdAt: '2026-01-15T10:00:00Z',
  }),
  {
    description: 'Fetch a single user by id.',
    response: User,
    headers: { ...AUTH_HEADER },
    errors: {
      401: { description: 'Missing or invalid Authorization header', schema: Error4xx },
      404: { description: 'User not found',                          schema: Error4xx },
    },
  }
));

app.post('/users', defineRoute(
  (req, res) => res.status(201).json({
    id: 42,
    name:  req.body.name,
    email: req.body.email,
    role:  req.body.role || 'user',
    active: true,
    createdAt: new Date().toISOString(),
  }),
  {
    description: 'Create a new user. Try POSTing `{}` to see the v1.6 validation middleware return 422.',
    request:  { body: CreateUser },
    response: User,
    headers:  { ...AUTH_HEADER, ...JSON_HEADER },
    errors: {
      409: { description: 'Email already in use', schema: Error4xx },
      422: { description: 'Validation failed',    schema: Error4xx },
    },
  }
));

app.patch('/users/:id', defineRoute(
  (req, res) => res.json({
    id: Number(req.params.id),
    name:  req.body.name  || 'Ada Lovelace',
    email: req.body.email || 'ada@example.com',
    role: 'admin',
    active: true,
    createdAt: '2026-01-15T10:00:00Z',
  }),
  {
    description: 'Partially update a user record.',
    request:  { body: UpdateUser },
    response: User,
    headers:  { ...AUTH_HEADER, ...JSON_HEADER },
    errors: {
      404: { description: 'User not found',     schema: Error4xx },
      422: { description: 'Validation failed',  schema: Error4xx },
    },
  }
));

app.delete('/users/:id', defineRoute(
  (req, res) => res.json({ deleted: true, id: Number(req.params.id) }),
  {
    description: 'Delete a user.',
    response: z.object({ deleted: z.boolean(), id: z.number() }),
    headers:  { ...AUTH_HEADER },
    errors: {
      401: { description: 'Unauthorized',                                    schema: Error4xx },
      403: { description: 'Forbidden — cannot delete another admin account', schema: Error4xx },
      404: { description: 'User not found',                                  schema: Error4xx },
    },
  }
));

// ── Products ───────────────────────────────────────────────────────────────

app.get('/products', defineRoute(
  (_req, res) => res.json({
    products: [
      { id: 1, name: 'Mechanical Keyboard', price: 129.99, category: 'electronics', inStock: true  },
      { id: 2, name: 'Desk Lamp',           price:  34.50, category: 'furniture',   inStock: true  },
      { id: 3, name: 'Coffee Mug',          price:   9.99, category: 'kitchen',     inStock: false },
    ],
    total: 3,
  }),
  {
    description: 'List products. No auth required — public catalog.',
    response: z.object({ products: z.array(Product), total: z.number() }),
  }
));

app.get('/products/:id', defineRoute(
  (req, res) => res.json({
    id: Number(req.params.id),
    name: 'Mechanical Keyboard',
    price: 129.99,
    category: 'electronics',
    inStock: true,
  }),
  {
    description: 'Get a single product.',
    response: Product,
    errors: { 404: { description: 'Product not found', schema: Error4xx } },
  }
));

app.post('/products', defineRoute(
  (req, res) => res.status(201).json({
    id: 99,
    name:     req.body.name,
    price:    req.body.price,
    category: req.body.category,
    inStock:  req.body.inStock !== false,
  }),
  {
    description: 'Create a new product (admin only).',
    request:  { body: CreateProduct },
    response: Product,
    headers:  { ...AUTH_HEADER, ...JSON_HEADER },
    errors: {
      403: { description: 'Forbidden — admin role required', schema: Error4xx },
      422: { description: 'Validation failed',               schema: Error4xx },
    },
  }
));

// ── Auth ───────────────────────────────────────────────────────────────────

app.post('/auth/login', defineRoute(
  (req, res) => res.json({
    token:        'eyJhbGciOiJIUzI1NiJ9.demo-access-token',
    refreshToken: 'rt_demo_abc123',
    expiresIn:    3600,
    user: { id: 1, email: req.body.email, role: 'admin' },
  }),
  {
    description: 'Authenticate with email + password. Returns a JWT pair.',
    security: [],                         // explicit public override (v1.8)
    request:  { body: LoginBody },
    response: TokenPair,
    headers:  { ...JSON_HEADER },
    errors: {
      401: { description: 'Invalid email or password', schema: Error4xx },
      422: { description: 'Validation failed',         schema: Error4xx },
    },
  }
));

app.post('/auth/refresh', defineRoute(
  (_req, res) => res.json({ token: 'eyJhbGciOiJIUzI1NiJ9.demo-refreshed', expiresIn: 3600 }),
  {
    description: 'Exchange a refresh token for a new access token.',
    security: [],                         // public — uses refreshToken from body (v1.8)
    request:  { body: RefreshBody },
    response: z.object({ token: z.string(), expiresIn: z.number() }),
    headers:  { ...JSON_HEADER },
    errors: {
      401: { description: 'Refresh token expired or revoked', schema: Error4xx },
    },
  }
));

app.post('/auth/logout', defineRoute(
  (_req, res) => res.json({ success: true }),
  {
    description: 'Revoke the current session.',
    response: z.object({ success: z.boolean() }),
    headers:  { ...AUTH_HEADER },
  }
));

// ── Admin (nested router — exercises walkStack) ────────────────────────────

const admin = express.Router();

admin.get('/stats', defineRoute(
  (_req, res) => res.json({ totalUsers: 1024, activeUsers: 876, totalProducts: 312, ordersToday: 47, revenue: 9823.50 }),
  {
    description: 'Platform-wide statistics snapshot.',
    security: [{ adminAuth: [] }],         // override: require the admin-role scheme (v1.8)
    response: z.object({
      totalUsers:    z.number(),
      activeUsers:   z.number(),
      totalProducts: z.number(),
      ordersToday:   z.number(),
      revenue:       z.number(),
    }),
    headers: { Authorization: 'Bearer <admin-token>' },
  }
));

admin.delete('/users/:id', defineRoute(
  (req, res) => res.json({ deleted: true, userId: Number(req.params.id), deletedAt: new Date().toISOString() }),
  {
    description: 'Permanently delete a user account (admin only).',
    security: [{ adminAuth: [] }],
    response: z.object({ deleted: z.boolean(), userId: z.number(), deletedAt: z.string() }),
    headers:  { Authorization: 'Bearer <admin-token>' },
    errors:   { 403: { description: 'Admin role required', schema: Error4xx } },
  }
));

// Internal-only health probe — serves traffic for monitors but is hidden
// from the docs UI and the OpenAPI export entirely (v1.8 hidden flag).
admin.get('/internal-health', defineRoute(
  (_req, res) => res.json({ ok: true, ts: Date.now() }),
  {
    description: 'Should never appear in /docs or /docs/openapi.json',
    hidden:      true,
  }
));

app.use('/admin', admin);

// ── Healthcheck — JSDoc-only route (no defineRoute) ────────────────────────

app.get('/health', function health(_req, res) {
  /**
   * Liveness probe — documented via JSDoc instead of `defineRoute`.
   * @response {boolean} ok
   * @response {number}  uptime
   */
  res.json({ ok: true, uptime: process.uptime() });
});

// ── Bundled flows ──────────────────────────────────────────────────────────
// Inlined so Vercel's serverless bundle ships them without needing fs access
// to a separate doctreen-flows/ directory.

const flows = [
  {
    version: 1,
    name: 'User onboarding',
    description: 'Log in, create a user, fetch it back, then delete it.',
    baseUrl: '{{env.baseUrl}}',
    env: { baseUrl: '' },
    inputs: {
      email:    { type: 'string', required: true },
      name:     { type: 'string', required: true },
      password: { type: 'string', required: true },
    },
    steps: [
      {
        id: 'login',
        name: 'Authenticate',
        request: {
          method: 'POST',
          path: '/auth/login',
          headers: { 'Content-Type': 'application/json' },
          body: { email: '{{input.email}}', password: '{{input.password}}' },
        },
        extract: { accessToken: { from: 'body', path: '$.token' } },
        assert: { status: 200, exists: ['$.token', '$.refreshToken'] },
      },
      {
        id: 'create-user',
        name: 'Create user',
        request: {
          method: 'POST',
          path: '/users',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer {{vars.accessToken}}',
          },
          body: { name: '{{input.name}}', email: '{{input.email}}', role: 'user' },
        },
        extract: { userId: { from: 'body', path: '$.id' } },
        assert: {
          status: 201,
          body: { '$.email': '{{input.email}}', '$.name': '{{input.name}}' },
        },
      },
      {
        id: 'get-user',
        name: 'Fetch user',
        request: {
          method: 'GET',
          path: '/users/{{vars.userId}}',
          headers: { Authorization: 'Bearer {{vars.accessToken}}' },
        },
        assert: { status: 200, exists: ['$.email', '$.createdAt'] },
      },
      {
        id: 'delete-user',
        name: 'Delete user',
        request: {
          method: 'DELETE',
          path: '/users/{{vars.userId}}',
          headers: { Authorization: 'Bearer {{vars.accessToken}}' },
        },
        assert: { status: 200, body: { '$.deleted': true } },
      },
    ],
  },
  {
    version: 1,
    name: 'Product catalog smoke',
    description: 'Public product listing and detail check — no auth.',
    baseUrl: '{{env.baseUrl}}',
    env: { baseUrl: '' },
    steps: [
      {
        id: 'list-products',
        name: 'List products',
        request: { method: 'GET', path: '/products' },
        extract: { firstProductId: { from: 'body', path: '$.products[0].id' } },
        assert: { status: 200, body: { '$.total': 3 } },
      },
      {
        id: 'get-product',
        name: 'Fetch first product',
        request: { method: 'GET', path: '/products/{{vars.firstProductId}}' },
        assert: { status: 200, exists: ['$.name', '$.price', '$.category'] },
      },
    ],
  },
];

// ── DocTreen docs UI ───────────────────────────────────────────────────────

app.use(expressAdapter(app, {
  docsPath: '/docs',
  enabled:  true,
  validate: true,
  flows,

  // ── Vercel Analytics + Speed Insights (v1.9 headHtml) ────────────────────
  // The /_vercel/* paths are served by Vercel automatically when the matching
  // products are enabled in the project dashboard. Both scripts are no-ops
  // on non-Vercel hosts (404 with cached failure), so they're safe to ship.
  headHtml: [
    '<script defer src="/_vercel/insights/script.js"></script>',
    '<script defer src="/_vercel/speed-insights/script.js"></script>',
    '<meta name="theme-color" content="#0f1117">',
  ].join('\n  '),

  meta: {
    title:       'DocTreen Demo API',
    version:     '1.9.0',
    description:
      'Live demo — Zod-first schemas, runtime validation, OpenAPI 3.1 export with proper security schemes, ' +
      'per-route security overrides, hidden-from-docs flag, header auth, nested routers, and saved flows. ' +
      'Try POSTing {} to /users to see the v1.6 422 validation response, or hit /docs/openapi.json to ' +
      'inspect the v1.8 spec with components.securitySchemes wired up.',
  },
  exclude: ['/health'],

  // ── OpenAPI 3.1 configuration (v1.7 / v1.8) ──────────────────────────────
  openapi: {
    servers: [
      { url: 'https://doctreen.vercel.app', description: 'Production demo' },
      { url: '/',                            description: 'Same-origin (Swagger UI Try-it-out)' },
    ],
    securitySchemes: {
      bearerAuth: {
        type:         'http',
        scheme:       'bearer',
        bearerFormat: 'JWT',
        description:  'Standard user token returned by POST /auth/login',
      },
      adminAuth: {
        type:         'http',
        scheme:       'bearer',
        bearerFormat: 'JWT',
        description:  'Token with admin role — required for /admin/* routes',
      },
    },
    // Global default — applies to every route that does not declare its own.
    // /auth/login + /auth/refresh override with `security: []` (public).
    security: [{ bearerAuth: [] }],
  },
}));

// Root → /docs for convenience
app.get('/', (_req, res) => res.redirect('/docs'));

module.exports = app;
