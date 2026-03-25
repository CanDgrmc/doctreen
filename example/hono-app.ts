/**
 * example/hono-app.ts
 *
 * TypeScript version of the doctreen Hono demo.
 *
 * Demonstrates two schema sources with full type safety:
 *   1. defineRoute  — explicit schemas; return type flows through unchanged
 *   2. JSDoc block comments — zero-import fallback
 *
 * ─── How to run ───────────────────────────────────────────────────────────────
 * npm run example:hono:ts
 *  → http://localhost:3002/api/docs
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { serve } from '@hono/node-server';
import { honoAdapter, defineRoute, defineSchema, s } from '../src/adapters/hono';
import type { UserConfig } from '../src/index';

const app = new Hono();

// ─── Type definitions ─────────────────────────────────────────────────────────

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  active: boolean;
  createdAt: string;
}

interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
  inStock: boolean;
  createdAt: string;
}

interface CreateUserBody  { name: string; email: string; role?: string }
interface UpdateUserBody  { name: string; email: string }
interface CreateProductBody { name: string; price: number; category: string; inStock?: boolean }
interface LoginBody       { email: string; password: string }
interface LoginResponse   { token: string; refreshToken: string; expiresIn: number; user: { id: number; email: string; role: string } }

// ─── Reusable schema fragments ────────────────────────────────────────────────

const userSchema = s.object({
  id:        s.number(),
  name:      s.string(),
  email:     s.string(),
  role:      s.string(),
  active:    s.boolean(),
  createdAt: s.string(),
});

defineSchema('User', userSchema);

const productSchema = s.object({
  id:        s.number(),
  name:      s.string(),
  price:     s.number(),
  category:  s.string(),
  inStock:   s.boolean(),
  createdAt: s.string(),
});

defineSchema('Product', productSchema);

// ─────────────────────────────────────────────────────────────────────────────
// Adapter config
// ─────────────────────────────────────────────────────────────────────────────

const docsConfig: UserConfig = {
  docsPath: '/api/docs',
  meta: {
    title:       'My Hono API (TypeScript)',
    version:     '1.0.0',
    description: 'Demo Hono API powered by DocTreen. Works on Node.js, Bun, Deno, and edge runtimes.',
  },
  groups: {
    users:    { description: 'Manage user accounts, profiles, and roles.' },
    products: { description: 'Browse and manage the product catalog.' },
    auth:     { description: 'Authentication, session management, and token refresh.' },
  },
  exclude: ['/health'],
  liveReload: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Users resource
// ─────────────────────────────────────────────────────────────────────────────

// JSDoc source — plain named function
app.get('/users', function listUsers(c: Context) {
  /**
   * List all users
   * @param   {number}  [query.page]   - Page number (default 1)
   * @param   {number}  [query.limit]  - Results per page (default 20)
   * @param   {string}  [query.search] - Full-text search term
   * @response {User[]} users
   * @response {number} total
   * @response {number} page
   * @response {number} limit
   * @header  Authorization - Bearer <token>
   */
  const { page = '1', limit = '20', search = '' } = c.req.query();
  return c.json({
    users: [
      { id: 1, name: 'Alice Smith', email: 'alice@example.com', role: 'admin', active: true,  createdAt: '2024-01-15T10:00:00Z' },
      { id: 2, name: 'Bob Jones',   email: 'bob@example.com',   role: 'user',  active: false, createdAt: '2024-02-20T09:30:00Z' },
    ],
    total:  2,
    page:   Number(page),
    limit:  Number(limit),
    search: String(search),
  });
});

// defineRoute — generic pass-through preserves handler type
app.get('/users/:id', defineRoute(
  (c: Context): Response | Promise<Response> => {
    return c.json({
      id:        Number(c.req.param('id')),
      name:      'Alice Smith',
      email:     'alice@example.com',
      role:      'admin',
      active:    true,
      createdAt: '2024-01-15T10:00:00Z',
    } satisfies User);
  },
  {
    description: 'Fetch a single user by their numeric ID.',
    response:    userSchema,
    headers:     { Authorization: 'Bearer <token>' },
    errors: {
      401: 'Missing or invalid Authorization header',
      404: 'User not found',
    },
  }
));

app.post('/users', defineRoute(
  async (c: Context): Promise<Response> => {
    const body = await c.req.json<CreateUserBody>();
    const { name, email, role = 'user' } = body;
    return c.json({
      id: 101, name, email, role, active: true, createdAt: new Date().toISOString(),
    } satisfies User, 201);
  },
  {
    description: 'Create a new user account. Role defaults to "user" if omitted.',
    headers:     { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
    request: {
      body:  s.object({ name: s.string(), email: s.string(), role: s.optional(s.string()) }),
      query: null,
    },
    response: userSchema,
    errors: {
      409: 'Email address already in use',
      422: { description: 'Validation failed', schema: s.object({ message: s.string(), field: s.string() }) },
    },
  }
));

app.put('/users/:id', defineRoute(
  async (c: Context): Promise<Response> => {
    const { name, email } = await c.req.json<UpdateUserBody>();
    return c.json({
      id:        Number(c.req.param('id')),
      name,
      email,
      updatedAt: new Date().toISOString(),
    });
  },
  {
    description: 'Replace a user\'s name and email (full update).',
    headers:     { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
    request: {
      body:  s.object({ name: s.string(), email: s.string() }),
      query: null,
    },
    response: s.object({ id: s.number(), name: s.string(), email: s.string(), updatedAt: s.string() }),
  }
));

app.delete('/users/:id', defineRoute(
  (c: Context): Response => {
    return c.json({ deleted: true, id: Number(c.req.param('id')) });
  },
  {
    description: 'Permanently delete a user by ID.',
    response:    s.object({ deleted: s.boolean(), id: s.number() }),
    headers:     { Authorization: 'Bearer <token>' },
    errors: {
      401: 'Unauthorized',
      403: 'Forbidden — cannot delete another admin account',
      404: 'User not found',
    },
  }
));

// ─────────────────────────────────────────────────────────────────────────────
// Products resource
// ─────────────────────────────────────────────────────────────────────────────

app.get('/products', defineRoute(
  (c: Context): Response => {
    const { category = '', minPrice = '0', maxPrice = '9999' } = c.req.query();
    return c.json({
      products: [
        { id: 1, name: 'Keyboard',   price: 79.99, category: 'electronics', inStock: true,  createdAt: '2024-03-01T08:00:00Z' },
        { id: 2, name: 'Desk Lamp',  price: 34.50, category: 'furniture',   inStock: true,  createdAt: '2024-03-05T10:00:00Z' },
        { id: 3, name: 'Coffee Mug', price:  9.99, category: 'kitchen',     inStock: false, createdAt: '2024-03-10T12:00:00Z' },
      ],
      total:   3,
      filters: { category: String(category), minPrice: Number(minPrice), maxPrice: Number(maxPrice) },
    });
  },
  {
    description: 'List products with optional filtering by category and price range.',
    request: {
      body:  null,
      query: s.object({ category: s.optional(s.string()), minPrice: s.optional(s.number()), maxPrice: s.optional(s.number()) }),
    },
    response: s.object({
      products: s.array(productSchema),
      total:    s.number(),
      filters:  s.object({ category: s.string(), minPrice: s.number(), maxPrice: s.number() }),
    }),
  }
));

app.get('/products/:productId', function getProductById(c: Context) {
  /**
   * Get a product by ID
   * @returns {Product}
   */
  return c.json({
    id:        Number(c.req.param('productId')),
    name:      'Wireless Mouse',
    price:     29.99,
    category:  'electronics',
    inStock:   true,
    createdAt: '2024-03-10T08:30:00Z',
  });
});

app.post('/products', defineRoute(
  async (c: Context): Promise<Response> => {
    const { name, price, category, inStock = true } = await c.req.json<CreateProductBody>();
    return c.json({
      id: 202, name, price: Number(price), category, inStock: Boolean(inStock),
      createdAt: new Date().toISOString(),
    } satisfies Product, 201);
  },
  {
    description: 'Create a new product listing. inStock defaults to true.',
    headers:     { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
    request: {
      body:  s.object({ name: s.string(), price: s.number(), category: s.string(), inStock: s.optional(s.boolean()) }),
      query: null,
    },
    response: productSchema,
  }
));

// ─────────────────────────────────────────────────────────────────────────────
// Auth endpoints
// ─────────────────────────────────────────────────────────────────────────────

app.post('/auth/login', defineRoute(
  async (c: Context): Promise<Response> => {
    const { email } = await c.req.json<LoginBody>();
    return c.json({
      token:        'eyJhbGciOiJIUzI1NiJ9.example',
      refreshToken: 'rt_abc123xyz',
      expiresIn:    3600,
      user:         { id: 1, email, role: 'admin' },
    } satisfies LoginResponse);
  },
  {
    description: 'Authenticate with email and password. Returns a JWT access token and a refresh token.',
    headers:     { 'Content-Type': 'application/json' },
    request: {
      body:  s.object({ email: s.string(), password: s.string() }),
      query: null,
    },
    response: s.object({
      token:        s.string(),
      refreshToken: s.string(),
      expiresIn:    s.number(),
      user:         s.object({ id: s.number(), email: s.string(), role: s.string() }),
    }),
    errors: {
      401: { description: 'Invalid email or password',                   schema: s.object({ message: s.string() }) },
      422: { description: 'Validation failed — missing required fields', schema: s.object({ message: s.string(), field: s.string() }) },
    },
  }
));

app.post('/auth/logout', defineRoute(
  (_c: Context): Response => {
    return _c.json({ success: true, message: 'Logged out successfully' });
  },
  {
    description: 'Invalidate the provided refresh token, ending the session.',
    headers:     { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
    request:     { body: s.object({ refreshToken: s.string() }), query: null },
    response:    s.object({ success: s.boolean(), message: s.string() }),
  }
));

app.post('/auth/refresh', defineRoute(
  (_c: Context): Response => {
    return _c.json({ token: 'eyJhbGciOiJIUzI1NiJ9.refreshed', expiresIn: 3600 });
  },
  {
    description: 'Exchange a valid refresh token for a new access token.',
    headers:     { 'Content-Type': 'application/json' },
    request:     { body: s.object({ refreshToken: s.string() }), query: null },
    response:    s.object({ token: s.string(), expiresIn: s.number() }),
  }
));

// ─────────────────────────────────────────────────────────────────────────────
// Hidden / utility endpoints
// ─────────────────────────────────────────────────────────────────────────────

app.get('/health', (c: Context) => c.json({ status: 'ok' }));

// ─────────────────────────────────────────────────────────────────────────────
// Mount docs adapter — reads routes lazily at first request
// ─────────────────────────────────────────────────────────────────────────────

honoAdapter(app, docsConfig);

// ─────────────────────────────────────────────────────────────────────────────
// Start (Node.js via @hono/node-server)
// ─────────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3002;

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log('');
  console.log('  Server running  →  http://localhost:' + info.port);
  console.log('  API Docs        →  http://localhost:' + info.port + '/api/docs');
  console.log('');
  console.log('  All schemas fully resolved at startup — no curl needed to populate docs.');
  console.log('');
});
