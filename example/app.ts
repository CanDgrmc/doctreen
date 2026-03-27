/**
 * example/app.ts
 *
 * TypeScript version of the doctreen demo.
 *
 * Demonstrates descriptions at all three levels:
 *   • API-level  — meta.description in the adapter config
 *   • Group-level — groups config keyed by first path segment
 *   • Route-level — description field inside each defineRoute call
 *
 * ─── How to run ───────────────────────────────────────────────────────────────
 * npm run example:ts
 */

import express, { Request, Response, Router } from 'express';
import { expressAdapter, defineRoute } from '../src/adapters/express';
import { s } from '../src/index';
import type { UserConfig } from '../src/index';

const app = express();
app.use(express.json());

// ─── Type definitions ─────────────────────────────────────────────────────────

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface UserListQuery {
  page?: string;
  limit?: string;
  search?: string;
}

interface CreateUserBody {
  name: string;
  email: string;
  role?: string;
}

interface UpdateUserBody {
  name: string;
  email: string;
}

interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
  inStock: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface ProductListQuery {
  category?: string;
  minPrice?: string;
  maxPrice?: string;
}

interface CreateProductBody {
  name: string;
  price: number;
  category: string;
  inStock?: boolean;
}

interface PatchProductBody {
  price?: number;
  inStock?: boolean;
}

// ─── Reusable schema fragments ────────────────────────────────────────────────

const userSchema = s.object({
  id:        s.number(),
  name:      s.string(),
  email:     s.string(),
  role:      s.string(),
  active:    s.boolean(),
  createdAt: s.string(),
});

const productSchema = s.object({
  id:        s.number(),
  name:      s.string(),
  price:     s.number(),
  category:  s.string(),
  inStock:   s.boolean(),
  createdAt: s.string(),
});


const router = express.Router();
router.get('/ping', defineRoute<never, never, { message: string }>(
  (_req, res) => res.json({ message: 'pong' }),
  {
    description: 'A simple health check endpoint that responds with "pong".',
    response: s.object({ message: s.string() }),
  }
));
app.use('/api', router);

// ─────────────────────────────────────────────────────────────────────────────
// Users resource
//
// curl -s http://localhost:3000/users?page=1&limit=10&search=alice | jq
// curl -s http://localhost:3000/users/42 | jq
// curl -s -X POST http://localhost:3000/users \
//      -H 'Content-Type: application/json' \
//      -d '{"name":"Alice Smith","email":"alice@example.com","role":"admin"}' | jq
// curl -s -X PUT http://localhost:3000/users/42 \
//      -H 'Content-Type: application/json' \
//      -d '{"name":"Alice Johnson","email":"alice.j@example.com"}' | jq
// curl -s -X DELETE http://localhost:3000/users/42 | jq
// ─────────────────────────────────────────────────────────────────────────────

app.get('/users', defineRoute<never, UserListQuery, { users: User[]; total: number; page: number; limit: number; search: string }>(
  (req, res) => {
    const { page = '1', limit = '20', search = '' } = req.query;
    res.json({
      users: [
        { id: 1, name: 'Alice Smith', email: 'alice@example.com', role: 'admin', active: true  },
        { id: 2, name: 'Bob Jones',   email: 'bob@example.com',   role: 'user',  active: false },
      ],
      total:  2,
      page:   Number(page),
      limit:  Number(limit),
      search: String(search),
    });
  },
  {
    description: 'List all users. Supports pagination via page/limit and full-text search.',
    headers: { Authorization: 'Bearer <token>' },
    request: {
      body:  null,
      query: s.object({ page: s.number(), limit: s.number(), search: s.string() }),
    },
    response: s.object({
      users: s.array(userSchema),
      total: s.number(), page: s.number(), limit: s.number(), search: s.string(),
    }),
  }
));

app.get('/users/:id', defineRoute<never, never, User>(
  (req, res) => {
    res.json({
      id:        Number(req.params.id),
      name:      'Alice Smith',
      email:     'alice@example.com',
      role:      'admin',
      active:    true,
      createdAt: '2024-01-15T10:00:00Z',
    });
  },
  {
    description: 'Fetch a single user by their numeric ID.',
    headers: { Authorization: 'Bearer <token>' },
    response: userSchema,
    errors: {
      401: 'Missing or invalid Authorization header',
      404: 'User not found',
    },
  }
));

app.post('/users', defineRoute<CreateUserBody, never, User>(
  (req, res) => {
    const { name, email, role = 'user' } = req.body;
    res.status(201).json({
      id: 101, name, email, role, active: true, createdAt: new Date().toISOString(),
    });
  },
  {
    description: 'Create a new user account. Role defaults to "user" if omitted.',
    headers: { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
    request: {
      body:  s.object({ name: s.string(), email: s.string(), role: s.string() }),
      query: null,
    },
    response: userSchema,
    errors: {
      409: 'Email address already in use',
      422: { description: 'Validation failed', schema: s.object({ message: s.string(), field: s.string() }) },
    },
  }
));

app.put('/users/:id', defineRoute<UpdateUserBody, never, Pick<User, 'id' | 'name' | 'email' | 'updatedAt'>>(
  (req, res) => {
    const { name, email } = req.body;
    res.json({ id: Number(req.params.id), name, email, updatedAt: new Date().toISOString() });
  },
  {
    description: 'Replace a user\'s name and email (full update).',
    headers: { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
    request: {
      body:  s.object({ name: s.string(), email: s.string() }),
      query: null,
    },
    response: s.object({ id: s.number(), name: s.string(), email: s.string(), updatedAt: s.string() }),
  }
));

app.delete('/users/:id', defineRoute<never, never, { deleted: boolean; id: number }>(
  (req, res) => {
    res.json({ deleted: true, id: Number(req.params.id) });
  },
  {
    description: 'Permanently delete a user by ID.',
    headers: { Authorization: 'Bearer <token>' },
    response: s.object({ deleted: s.boolean(), id: s.number() }),
    errors: {
      401: 'Unauthorized',
      403: 'Forbidden — cannot delete another admin account',
      404: 'User not found',
    },
  }
));

// ─────────────────────────────────────────────────────────────────────────────
// Products resource
//
// curl -s 'http://localhost:3000/products?category=electronics&minPrice=10&maxPrice=500' | jq
// curl -s http://localhost:3000/products/7 | jq
// curl -s -X POST http://localhost:3000/products \
//      -H 'Content-Type: application/json' \
//      -d '{"name":"Wireless Mouse","price":29.99,"category":"electronics","inStock":true}' | jq
// curl -s -X PATCH http://localhost:3000/products/7 \
//      -H 'Content-Type: application/json' \
//      -d '{"price":24.99,"inStock":false}' | jq
// ─────────────────────────────────────────────────────────────────────────────

app.get('/products', defineRoute<never, ProductListQuery, { products: Product[]; total: number; filters: object }>(
  (req, res) => {
    const { category = '', minPrice = '0', maxPrice = '9999' } = req.query;
    res.json({
      products: [
        { id: 1, name: 'Keyboard',   price: 79.99, category: 'electronics', inStock: true  },
        { id: 2, name: 'Desk Lamp',  price: 34.50, category: 'furniture',   inStock: true  },
        { id: 3, name: 'Coffee Mug', price:  9.99, category: 'kitchen',     inStock: false },
      ],
      total:   3,
      filters: { category: String(category), minPrice: Number(minPrice), maxPrice: Number(maxPrice) },
    });
  },
  {
    description: 'List products with optional filtering by category and price range.',
    headers: { Authorization: 'Bearer <token>' },
    request: {
      body:  null,
      query: s.object({ category: s.string(), minPrice: s.number(), maxPrice: s.number() }),
    },
    response: s.object({
      products: s.array(productSchema),
      total:    s.number(),
      filters:  s.object({ category: s.string(), minPrice: s.number(), maxPrice: s.number() }),
    }),
  }
));

app.get('/products/:productId', defineRoute<never, never, Product>(
  (req, res) => {
    res.json({
      id:        Number(req.params.productId),
      name:      'Wireless Mouse',
      price:     29.99,
      category:  'electronics',
      inStock:   true,
      createdAt: '2024-03-10T08:30:00Z',
    });
  },
  {
    description: 'Fetch a single product by its numeric ID.',
    headers: { Authorization: 'Bearer <token>' },
    response: productSchema,
  }
));

app.post('/products', defineRoute<CreateProductBody, never, Product>(
  (req, res) => {
    const { name, price, category, inStock = true } = req.body;
    res.status(201).json({
      id: 202, name, price: Number(price), category, inStock: Boolean(inStock),
      createdAt: new Date().toISOString(),
    });
  },
  {
    description: 'Create a new product listing. inStock defaults to true.',
    headers: { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
    request: {
      body:  s.object({ name: s.string(), price: s.number(), category: s.string(), inStock: s.boolean() }),
      query: null,
    },
    response: productSchema,
  }
));

app.patch('/products/:productId', defineRoute<PatchProductBody, never, Partial<Product> & { updatedAt: string }>(
  (req, res) => {
    const { price, inStock } = req.body;
    res.json({
      id:        Number(req.params.productId),
      price:     price   !== undefined ? Number(price)    : undefined,
      inStock:   inStock !== undefined ? Boolean(inStock) : undefined,
      updatedAt: new Date().toISOString(),
    });
  },
  {
    description: 'Partially update a product. Only provided fields are changed.',
    headers: { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
    request: {
      body:  s.object({ price: s.number(), inStock: s.boolean() }),
      query: null,
    },
    response: s.object({ id: s.number(), price: s.number(), inStock: s.boolean(), updatedAt: s.string() }),
  }
));

// ─────────────────────────────────────────────────────────────────────────────
// Auth endpoints
//
// curl -s -X POST http://localhost:3000/auth/login \
//      -H 'Content-Type: application/json' \
//      -d '{"email":"alice@example.com","password":"s3cr3t"}' | jq
// curl -s -X POST http://localhost:3000/auth/logout \
//      -H 'Content-Type: application/json' \
//      -d '{"refreshToken":"abc123"}' | jq
// curl -s -X POST http://localhost:3000/auth/refresh \
//      -H 'Content-Type: application/json' \
//      -d '{"refreshToken":"abc123"}' | jq
// ─────────────────────────────────────────────────────────────────────────────

interface LoginBody     { email: string; password: string }
interface LoginResponse { token: string; refreshToken: string; expiresIn: number; user: { id: number; email: string; role: string } }

app.post('/auth/login', defineRoute<LoginBody, never, LoginResponse>(
  (req, res) => {
    const { email } = req.body; // never log or echo passwords
    res.json({
      token:        'eyJhbGciOiJIUzI1NiJ9.example',
      refreshToken: 'rt_abc123xyz',
      expiresIn:    3600,
      user:         { id: 1, email, role: 'admin' },
    });
  },
  {
    description: 'Authenticate with email and password. Returns a JWT access token and a refresh token.',
    headers: { 'Content-Type': 'application/json' },
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
      401: { description: 'Invalid email or password', schema: s.object({ message: s.string() }) },
      422: { description: 'Validation failed — missing required fields', schema: s.object({ message: s.string(), field: s.string() }) },
    },
  }
));

app.post('/auth/logout', defineRoute<{ refreshToken: string }, never, { success: boolean; message: string }>(
  (_req, res) => {
    res.json({ success: true, message: 'Logged out successfully' });
  },
  {
    description: 'Invalidate the provided refresh token, ending the session.',
    headers: { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
    request: { body: s.object({ refreshToken: s.string() }), query: null },
    response: s.object({ success: s.boolean(), message: s.string() }),
  }
));

app.post('/auth/refresh', defineRoute<{ refreshToken: string }, never, { token: string; expiresIn: number }>(
  (_req, res) => {
    res.json({ token: 'eyJhbGciOiJIUzI1NiJ9.refreshed', expiresIn: 3600 });
  },
  {
    description: 'Exchange a valid refresh token for a new access token.',
    headers: { 'Content-Type': 'application/json' },
    request: { body: s.object({ refreshToken: s.string() }), query: null },
    response: s.object({ token: s.string(), expiresIn: s.number() }),
  }
));

// ─────────────────────────────────────────────────────────────────────────────
// Admin — nested router
//
// curl -s http://localhost:3000/admin/stats | jq
// curl -s http://localhost:3000/admin/users | jq
// curl -s -X DELETE http://localhost:3000/admin/users/5 | jq
// ─────────────────────────────────────────────────────────────────────────────

const adminRouter: Router = express.Router();

adminRouter.get('/stats', defineRoute<never, never, { totalUsers: number; activeUsers: number; totalProducts: number; ordersToday: number; revenue: number }>(
  (_req, res) => {
    res.json({ totalUsers: 1024, activeUsers: 876, totalProducts: 312, ordersToday: 47, revenue: 9823.50 });
  },
  {
    description: 'Aggregate platform statistics: user counts, product count, daily orders, and revenue.',
    headers: { Authorization: 'Bearer <token>', 'X-Admin-Role': 'admin' },
    response: s.object({
      totalUsers: s.number(), activeUsers: s.number(),
      totalProducts: s.number(), ordersToday: s.number(), revenue: s.number(),
    }),
  }
));

adminRouter.get('/users', defineRoute<never, never, { users: Array<{ id: number; email: string; role: string; suspended: boolean }>; total: number }>(
  (_req, res) => {
    res.json({
      users: [
        { id: 1, email: 'alice@example.com', role: 'admin', suspended: false },
        { id: 2, email: 'bob@example.com',   role: 'user',  suspended: true  },
      ],
      total: 2,
    });
  },
  {
    description: 'List all users including suspended accounts. Admin-only.',
    headers: { Authorization: 'Bearer <token>', 'X-Admin-Role': 'admin' },
    response: s.object({
      users: s.array(s.object({ id: s.number(), email: s.string(), role: s.string(), suspended: s.boolean() })),
      total: s.number(),
    }),
  }
));

adminRouter.delete('/users/:id', defineRoute<never, never, { deleted: boolean; userId: number; deletedAt: string }>(
  (req, res) => {
    res.json({ deleted: true, userId: Number(req.params.id), deletedAt: new Date().toISOString() });
  },
  {
    description: 'Hard-delete a user account by ID. This action is irreversible.',
    headers: { Authorization: 'Bearer <token>', 'X-Admin-Role': 'admin' },
    response: s.object({ deleted: s.boolean(), userId: s.number(), deletedAt: s.string() }),
  }
));

app.use('/admin', adminRouter);

// ─────────────────────────────────────────────────────────────────────────────
// Hidden endpoints — excluded from docs
// ─────────────────────────────────────────────────────────────────────────────

app.get('/health',  (_req: Request, res: Response) => res.json({ status: 'ok' }));
app.get('/metrics', (_req: Request, res: Response) => res.json({ uptime: process.uptime() }));

// ─────────────────────────────────────────────────────────────────────────────
// Mount the documentation middleware — AFTER all routes
// ─────────────────────────────────────────────────────────────────────────────

const docsConfig: UserConfig = {
  docsPath: '/api/docs',

  // ── API-level description ──────────────────────────────────────────────────
  meta: {
    title:       'My Awesome API (TypeScript)',
    version:     '2.1.0',
    description: 'Internal REST API powering the Awesome platform. All endpoints require a valid JWT unless noted.',
  },

  // ── Group-level descriptions ───────────────────────────────────────────────
  groups: {
    users:    { description: 'Manage user accounts, profiles, and roles.' },
    products: { description: 'Browse and manage the product catalog.' },
    auth:     { description: 'Authentication, session management, and token refresh.' },
    admin:    { description: 'Administrative operations restricted to users with the admin role.' },
    api:      { description: 'Utility endpoints for API health and diagnostics (excluded from docs).' },
  },

  exclude: [
    '/health',
    '/metrics',
    /^\/internal\//,
  ],
  liveReload: true,
};

app.use(expressAdapter(app, docsConfig));

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('  Server running  →  http://localhost:' + PORT);
  console.log('  API Docs        →  http://localhost:' + PORT + '/api/docs');
  console.log('');
  console.log('  Descriptions visible at all three levels: API, group, and route.');
  console.log('');
});
