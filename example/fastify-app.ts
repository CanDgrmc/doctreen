/**
 * example/fastify-app.ts
 *
 * TypeScript version of the doctreen Fastify demo.
 *
 * Demonstrates three schema sources, all type-safe:
 *   1. defineRoute  — explicit schemas; handler types flow through unchanged
 *   2. Fastify-native JSON Schema  (schema option on route)
 *   3. JSDoc block comments        — zero-import fallback
 *
 * ─── How to run ───────────────────────────────────────────────────────────────
 * npm run example:fastify:ts
 *
 * ─── Curl examples ────────────────────────────────────────────────────────────
 * curl -s 'http://localhost:3001/users?page=1&limit=10' | jq
 * curl -s  http://localhost:3001/users/42 | jq
 * curl -s -X POST http://localhost:3001/users \
 *      -H 'Content-Type: application/json' \
 *      -d '{"name":"Alice","email":"alice@example.com","role":"admin"}' | jq
 * curl -s -X PUT http://localhost:3001/users/42 \
 *      -H 'Content-Type: application/json' \
 *      -d '{"name":"Alice Johnson","email":"alice.j@example.com"}' | jq
 * curl -s -X DELETE http://localhost:3001/users/42 | jq
 * curl -s 'http://localhost:3001/products?category=electronics' | jq
 * curl -s -X POST http://localhost:3001/auth/login \
 *      -H 'Content-Type: application/json' \
 *      -d '{"email":"alice@example.com","password":"s3cr3t"}' | jq
 */

import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { fastifyAdapter, defineRoute, defineSchema } from '../src/adapters/fastify';
import { s } from '../src/index';
import type { UserConfig } from '../src/index';

const fastify = Fastify({ logger: false });

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

interface UserListQuery { page?: string; limit?: string; search?: string }
interface CreateUserBody { name: string; email: string; role?: string }
interface UpdateUserBody { name: string; email: string }

interface ProductListQuery { category?: string; minPrice?: string; maxPrice?: string }
interface CreateProductBody { name: string; price: number; category: string; inStock?: boolean }

interface LoginBody { email: string; password: string }
interface LoginResponse { token: string; refreshToken: string; expiresIn: number; user: { id: number; email: string; role: string } }

// ─── Reusable schema fragments ────────────────────────────────────────────────

const userSchema = defineSchema('User', s.object({
  id: s.number(),
  name: s.string(),
  email: s.string(),
  role: s.string(),
  active: s.boolean(),
  createdAt: s.string(),
}));

const productSchema = defineSchema('Product', s.object({
  id: s.number(),
  name: s.string(),
  price: s.number(),
  category: s.string(),
  inStock: s.boolean(),
  createdAt: s.string(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Call fastifyAdapter BEFORE registering routes
// ─────────────────────────────────────────────────────────────────────────────

const docsConfig: UserConfig = {
  docsPath: '/api/docs',
  meta: {
    title: 'My Fastify API (TypeScript)',
    version: '1.0.0',
    description: 'Demo Fastify API powered by DocTreen. Schemas fully resolved at startup — no traffic needed.',
  },
  groups: {
    users: { description: 'Manage user accounts, profiles, and roles.' },
    products: { description: 'Browse and manage the product catalog.' },
    auth: { description: 'Authentication, session management, and token refresh.' },
  },
  exclude: ['/health'],
  liveReload: true,
};

fastifyAdapter(fastify, docsConfig);

// ─────────────────────────────────────────────────────────────────────────────
// Users resource
// ─────────────────────────────────────────────────────────────────────────────

// JSDoc source — plain named function, no defineRoute needed
fastify.get('/users', function listUsers(
  req: FastifyRequest<{ Querystring: UserListQuery }>,
  reply: FastifyReply
) {
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
  const { page = '1', limit = '20', search = '' } = req.query;
  reply.send({
    users: [
      { id: 1, name: 'Alice Smith', email: 'alice@example.com', role: 'admin', active: true, createdAt: '2024-01-15T10:00:00Z' },
      { id: 2, name: 'Bob Jones', email: 'bob@example.com', role: 'user', active: false, createdAt: '2024-02-20T09:30:00Z' },
    ],
    total: 2,
    page: Number(page),
    limit: Number(limit),
    search: String(search),
  });
});

// defineRoute — generic pass-through preserves handler types
fastify.get<{ Params: { id: string }; Reply: User }>('/users/:id', {
  handler: defineRoute(
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      reply.send({
        id: Number(req.params.id),
        name: 'Alice Smith',
        email: 'alice@example.com',
        role: 'admin',
        active: true,
        createdAt: '2024-01-15T10:00:00Z',
      });
    },
    {
      description: 'Fetch a single user by their numeric ID.',
      response: userSchema,
      headers: { Authorization: 'Bearer <token>' },
      errors: {
        401: 'Missing or invalid Authorization header',
        404: 'User not found',
      },
    }
  ),
});

fastify.post<{ Body: CreateUserBody; Reply: User }>('/users', {
  handler: defineRoute(
    async (req: FastifyRequest<{ Body: CreateUserBody }>, reply: FastifyReply) => {
      const { name, email, role = 'user' } = req.body;
      reply.status(201).send({
        id: 101, name, email, role, active: true, createdAt: new Date().toISOString(),
      });
    },
    {
      description: 'Create a new user account. Role defaults to "user" if omitted.',
      headers: { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
      request: {
        body: s.object({ name: s.string(), email: s.string(), role: s.optional(s.string()) }),
        query: null,
      },
      response: userSchema,
      errors: {
        409: 'Email address already in use',
        422: { description: 'Validation failed', schema: s.object({ message: s.string(), field: s.string() }) },
      },
    }
  ),
});

// Fastify native JSON Schema — doctreen reads it automatically
fastify.put<{ Params: { id: string }; Body: UpdateUserBody }>('/users/:id', {
  schema: {
    description: 'Replace a user record',
    body: {
      type: 'object',
      required: ['name', 'email'],
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
      },
    },
    response: {
      200: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string' },
          email: { type: 'string' },
          updatedAt: { type: 'string' },
        },
      },
    },
  },
  handler: async (req: FastifyRequest<{ Params: { id: string }; Body: UpdateUserBody }>, reply: FastifyReply) => {
    const { name, email } = req.body;
    reply.send({ id: Number(req.params.id), name, email, updatedAt: new Date().toISOString() });
  },
});

fastify.delete<{ Params: { id: string }; Reply: { deleted: boolean; id: number } }>('/users/:id', {
  handler: defineRoute(
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      reply.send({ deleted: true, id: Number(req.params.id) });
    },
    {
      description: 'Permanently delete a user by ID.',
      response: s.object({ deleted: s.boolean(), id: s.number() }),
      headers: { Authorization: 'Bearer <token>' },
      errors: {
        401: 'Unauthorized',
        403: 'Forbidden — cannot delete another admin account',
        404: 'User not found',
      },
    }
  ),
});

// ─────────────────────────────────────────────────────────────────────────────
// Products resource
// ─────────────────────────────────────────────────────────────────────────────

fastify.get<{ Querystring: ProductListQuery }>('/products', {
  handler: defineRoute(
    async (req: FastifyRequest<{ Querystring: ProductListQuery }>, reply: FastifyReply) => {
      const { category = '', minPrice = '0', maxPrice = '9999' } = req.query;
      reply.send({
        products: [
          { id: 1, name: 'Keyboard', price: 79.99, category: 'electronics', inStock: true, createdAt: '2024-03-01T08:00:00Z' },
          { id: 2, name: 'Desk Lamp', price: 34.50, category: 'furniture', inStock: true, createdAt: '2024-03-05T10:00:00Z' },
          { id: 3, name: 'Coffee Mug', price: 9.99, category: 'kitchen', inStock: false, createdAt: '2024-03-10T12:00:00Z' },
        ],
        total: 3,
        filters: { category: String(category), minPrice: Number(minPrice), maxPrice: Number(maxPrice) },
      });
    },
    {
      description: 'List products with optional filtering by category and price range.',
      request: {
        body: null,
        query: s.object({ category: s.optional(s.string()), minPrice: s.optional(s.number()), maxPrice: s.optional(s.number()) }),
      },
      response: s.object({
        products: s.array(productSchema),
        total: s.number(),
        filters: s.object({ category: s.string(), minPrice: s.number(), maxPrice: s.number() }),
      }),
    }
  ),
});

// Fastify native JSON Schema
fastify.get('/products/:productId', {
  schema: {
    description: 'Get a product by ID',
    response: {
      200: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string' },
          price: { type: 'number' },
          category: { type: 'string' },
          inStock: { type: 'boolean' },
          createdAt: { type: 'string' },
        },
      },
    },
  },
  handler: async (req: FastifyRequest<{ Params: { productId: string } }>, reply: FastifyReply) => {
    reply.send({
      id: Number(req.params.productId),
      name: 'Wireless Mouse',
      price: 29.99,
      category: 'electronics',
      inStock: true,
      createdAt: '2024-03-10T08:30:00Z',
    });
  },
});

fastify.post<{ Body: CreateProductBody; Reply: Product }>('/products', {
  handler: defineRoute(
    async (req: FastifyRequest<{ Body: CreateProductBody }>, reply: FastifyReply) => {
      const { name, price, category, inStock = true } = req.body;
      reply.status(201).send({
        id: 202, name, price: Number(price), category, inStock: Boolean(inStock),
        createdAt: new Date().toISOString(),
      });
    },
    {
      description: 'Create a new product listing. inStock defaults to true.',
      headers: { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
      request: {
        body: s.object({ name: s.string(), price: s.number(), category: s.string(), inStock: s.optional(s.boolean()) }),
        query: null,
      },
      response: productSchema,
    }
  ),
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth endpoints
// ─────────────────────────────────────────────────────────────────────────────

fastify.post<{ Body: LoginBody; Reply: LoginResponse }>('/auth/login', {
  handler: defineRoute(
    async (req: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
      const { email } = req.body;
      reply.send({
        token: 'eyJhbGciOiJIUzI1NiJ9.example',
        refreshToken: 'rt_abc123xyz',
        expiresIn: 3600,
        user: { id: 1, email, role: 'admin' },
      });
    },
    {
      description: 'Authenticate with email and password. Returns a JWT access token and a refresh token.',
      headers: { 'Content-Type': 'application/json' },
      request: {
        body: s.object({ email: s.string(), password: s.string() }),
        query: null,
      },
      response: s.object({
        token: s.string(),
        refreshToken: s.string(),
        expiresIn: s.number(),
        user: s.object({ id: s.number(), email: s.string(), role: s.string() }),
      }),
      errors: {
        401: { description: 'Invalid email or password', schema: s.object({ message: s.string() }) },
        422: { description: 'Validation failed — missing required fields', schema: s.object({ message: s.string(), field: s.string() }) },
      },
    }
  ),
});

fastify.post<{ Body: { refreshToken: string }; Reply: { success: boolean; message: string } }>('/auth/logout', {
  handler: defineRoute(
    async (_req: FastifyRequest, reply: FastifyReply) => {
      reply.send({ success: true, message: 'Logged out successfully' });
    },
    {
      description: 'Invalidate the provided refresh token, ending the session.',
      headers: { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
      request: { body: s.object({ refreshToken: s.string() }), query: null },
      response: s.object({ success: s.boolean(), message: s.string() }),
    }
  ),
});

fastify.post<{ Body: { refreshToken: string }; Reply: { token: string; expiresIn: number } }>('/auth/refresh', {
  handler: defineRoute(
    async (_req: FastifyRequest, reply: FastifyReply) => {
      reply.send({ token: 'eyJhbGciOiJIUzI1NiJ9.refreshed', expiresIn: 3600 });
    },
    {
      description: 'Exchange a valid refresh token for a new access token.',
      headers: { 'Content-Type': 'application/json' },
      request: { body: s.object({ refreshToken: s.string() }), query: null },
      response: s.object({ token: s.string(), expiresIn: s.number() }),
    }
  ),
});

// ─────────────────────────────────────────────────────────────────────────────
// Hidden / utility endpoints
// ─────────────────────────────────────────────────────────────────────────────

fastify.get('/health', (_req: FastifyRequest, reply: FastifyReply) => {
  reply.send({ status: 'ok' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3010;

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log('');
  console.log('  Server running  →  http://localhost:' + PORT);
  console.log('  API Docs        →  http://localhost:' + PORT + '/api/docs');
  console.log('');
  console.log('  All schemas fully resolved at startup — no curl needed to populate docs.');
  console.log('');
});
