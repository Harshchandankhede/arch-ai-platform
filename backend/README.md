# Arch-AI Backend

Node.js + Express.js API for Arch-AI — interactive software architecture design, simulation, process mining and evaluation.

This backend is **independent** of the React frontend. It has its own `package.json` and dependencies, and the two are deployed separately.

## Current status — Phase 4 (project CRUD)

Implemented so far:

- Express 5 server with centralised configuration
- Environment variable loading via `dotenv`
- `GET /api/health` including live MongoDB status
- CORS configured for the React frontend
- Centralised error handling (404 + error middleware)
- Request logging and graceful shutdown
- **MongoDB connection via Mongoose** — `connectDatabase()`, `disconnectDatabase()`, `getDbState()`
- **User model** with timestamps, a unique email index, and a `toJSON` transform that strips `passwordHash`
- **JWT authentication** — register, login, and a protected `GET /api/auth/me`, with bcrypt password hashing
- **Project CRUD** — five routes under `/api/projects`, all behind `requireAuth`, with per-user ownership enforced in the service layer
- **Project model** with a nested `arch` document (`nodes[]` and `edges[]`), a `currentVersion` counter, and an index on `{ owner, updatedAt }`

- **Architecture version history** — six nested routes under `/api/projects/:projectId/versions` for save, list, read, rename, restore and delete, with `currentVersion` maintained on the project

**Not yet implemented** (later phases): simulation results persistence, AI model integration,
and the reports/interview features, which currently run entirely in the browser.

## Prerequisites

- **Node.js 18 or newer** — `node --version`
- **MongoDB Atlas** (active) — no local installation required
- MongoDB Compass, optionally, for browsing data

## Setup

```bash
cd backend
npm install
cp .env.example .env
```

Then paste your Atlas connection string into `.env` (see below).

> **`.env` is git-ignored. Never put a real password in `.env.example`** — that file *is* committed, and a credential there would end up in version control history.

## Database

This project uses **MongoDB Atlas**. The application database is **`archai`**. Collections are created automatically on first write — you never create them by hand.

Two environment variables control the connection:

| Variable | Value | Purpose |
|---|---|---|
| `MONGO_URI` | `mongodb+srv://<username>:<password>@<cluster>.mongodb.net/archai?retryWrites=true&w=majority&authSource=admin` | Connection string passed to Mongoose |
| `DB_NAME` | `archai` | Database name applied to the connection |

### Getting the connection string

1. Atlas → your project → cluster → **Connect** → **Drivers** → **Node.js**
2. Copy the string Atlas shows
3. Paste it as the `MONGO_URI=` value in `backend/.env` (not in `.env.example`)

### ⚠️ URL encoding of passwords

If a password contains any of these characters, it **must** be percent-encoded or the driver misreads the whole string and authentication fails with `bad auth`:

| Character | Encoded |
|---|---|
| `@` | `%40` |
| `:` | `%3A` |
| `/` | `%2F` |
| `?` | `%3F` |
| `#` | `%23` |
| `[` `]` | `%5B` `%5D` |
| `%` | `%25` |

Two ways to avoid the problem: copy the string from Atlas (it encodes for you), or choose a **letters-and-digits-only** password.

### Atlas setup checklist

If you are creating the database from scratch:

1. **Create a free M0 cluster** at [cloud.mongodb.com](https://cloud.mongodb.com)
2. **Database Access → Add New User** — set a username and password
3. **Grant the user a privilege** on database `archai` with role `readWrite` (under *Specific Privileges*, not a built-in role)
4. **Network Access** — add your own IP (`<ip>/32`), or temporarily allow anywhere while setting up
5. Copy the Node.js connection string and put it in `.env`

> Granting a specific privilege on `archai` is better than a built-in `readWriteAnyDatabase` role: if the password ever leaks, the damage is limited to this project's database. Note that `readWriteAnyDatabase` does **not** permit `dropDatabase`.

### Network troubleshooting (SRV / DNS)

Atlas connection strings use **SRV DNS records** (`_mongodb._tcp.<cluster>.mongodb.net`). Some networks — campus, office, or ISP DNS — block or mishandle these lookups. The symptom is distinctive:

```
MongoServerError: querySrv ECONNREFUSED _mongodb._tcp.<cluster>.mongodb.net
```

Notably, the browser, PowerShell, and `mongosh` may all connect fine while `node` alone fails, because they can use different resolvers. To check what `node` sees:

```bash
node -e "require('dns').resolveSrv('_mongodb._tcp.<cluster>.mongodb.net',(e,r)=>console.log(e?e.code:r.length+' records'))"
```

**Fix — set custom DNS servers.** Add this to `backend/.env`:

```bash
MONGO_DNS_SERVERS=1.1.1.1,8.8.8.8
```

The backend then routes Atlas lookups through those resolvers instead of the system one. It is opt-in and off by default, so it changes nothing on a normal network. The startup log will show:

```
[WARN] Using custom DNS servers: 1.1.1.1, 8.8.8.8
```

Permanent fix on Windows: set your Wi-Fi adapter DNS to `1.1.1.1` / `8.8.8.8` (Settings → Network & internet → Wi-Fi → DNS server assignment → Manual).

### Switching to a local MongoDB

No code change is needed — only the environment value:

```bash
MONGO_URI=mongodb://127.0.0.1:27017
DB_NAME=archai
```

Verify a local server is up with:

```bash
mongosh "mongodb://127.0.0.1:27017" --eval "db.adminCommand({buildInfo:1}).version"
```

## Running

Development (auto-restarts on file changes, via `nodemon`):

```bash
npm run dev
```

Production-style (plain `node`, no watcher):

```bash
npm start
```

Startup order is deliberate: the backend connects to MongoDB **first** and only starts listening on `PORT` (default **5000**) once the database is reachable. If MongoDB is unavailable it logs the reason and exits rather than serving requests against a broken connection.

## Verifying the health endpoint

With the backend running, in a second terminal:

```bash
# macOS / Linux
curl http://localhost:5000/api/health

# Windows PowerShell
Invoke-RestMethod http://localhost:5000/api/health
```

Response when MongoDB is connected — `200 OK`:

```json
{
  "success": true,
  "status": "OK",
  "message": "Arch-AI backend is running",
  "service": "arch-ai-backend",
  "environment": "development",
  "uptimeSeconds": 42,
  "timestamp": "2026-09-28T16:00:00.000Z",
  "database": { "status": "connected", "name": "archai" }
}
```

If MongoDB drops, the endpoint returns `503` with `"status": "DEGRADED"` and the real connection state in `database.status`.

## Authentication

Accounts are stored in MongoDB. Passwords are hashed with **bcrypt** and never stored or logged in plaintext. Successful login returns a **JWT** that the client must send as a `Bearer` token.

| Method | Endpoint | Body | Auth |
|---|---|---|---|
| `POST` | `/api/auth/register` | `{ name, email, password }` | — |
| `POST` | `/api/auth/login` | `{ email, password }` | — |
| `GET` | `/api/auth/me` | — | Bearer token |

Register returns `201`, login `200`, both shaped as:

```json
{ "success": true, "data": { "user": { "id": "...", "name": "...", "email": "...", "role": "student" }, "token": "<jwt>" } }
```

Errors follow the shared error format:

```json
{ "success": false, "error": { "message": "...", "statusCode": 409, "details": { "email": "..." } } }
```

| Status | Cause |
|---|---|
| `400` | Validation failed (missing name, bad email, password under 6 characters) — see `error.details` |
| `401` | Wrong email or password, or a missing/expired token |
| `409` | Email already registered (the unique index rejected it) |

Tokens expire after `JWT_EXPIRES_IN` (default `7d`). The client stores the token in `localStorage` and sends it automatically via an axios request interceptor. On any `401` the client clears the token.

## Projects

A project is the container a student works in: a name, an optional description, and the architecture itself as a list of components (`arch.nodes`) plus the connections between them (`arch.edges`). Every project belongs to exactly one user. `owner` is set from the JWT on the server and is never read from the request body, and every query is filtered by it — so a project is a private workspace rather than shared state.

| Method | Endpoint | Body | Success | Description |
|---|---|---|---|---|
| `GET` | `/api/projects` | — | `200` | List your own projects, most recently updated first |
| `POST` | `/api/projects` | `{ name, description, arch }` | `201` | Create a project owned by the caller |
| `GET` | `/api/projects/:id` | — | `200` | Fetch a single project |
| `PUT` | `/api/projects/:id` | `{ name, description, arch }` | `200` | Update the fields you send; omitted fields are untouched |
| `DELETE` | `/api/projects/:id` | — | `200` | Delete a project, returns its `id` and `name` |

`description` and `arch` are optional on create and fall back to `''` and `{ nodes: [], edges: [] }`. A project is returned in this shape:

```json
{
  "id": "…",
  "name": "Library system",
  "description": "…",
  "arch": {
    "nodes": [
      {
        "id": "n1",
        "type": "service",
        "name": "Catalogue API",
        "position": { "x": 0, "y": 0 },
        "parameters": {}
      },
      {
        "id": "n2",
        "type": "database",
        "name": "Catalogue store",
        "position": { "x": 240, "y": 120 },
        "parameters": {}
      }
    ],
    "edges": [
      { "id": "e1", "source": "n1", "target": "n2" }
    ]
  },
  "currentVersion": 0,
  "createdAt": "…",
  "updatedAt": "…"
}
```

`position` defaults to `{ x: 0, y: 0 }`, `parameters` to `{}` (free-form JSON — `Schema.Types.Mixed`), and both arrays to `[]`. Every `edge` needs an `id`, a `source` and a `target`. `currentVersion` is stored and defaults to `0`; it is maintained by the version routes — incremented on snapshot create (`architecture.service.js:114`), re-pointed when the current version is deleted, and set on restore. Nested sub-documents carry no `_id` of their own, and the schema sets `versionKey: false`, so there is no `__v` either. A `{ owner: 1, updatedAt: -1 }` index backs the list query.

Responses use the shared envelope: `{ "success": true, "data": { "project": … } }`. The list route returns `{ "success": true, "data": { "projects": [ … ] } }`, and delete returns `{ "success": true, "data": { "id": "…", "name": "…" } }`.

### Ownership and security

- **Every project route requires a JWT.** `requireAuth` is applied with `router.use` at the top of `project.routes.js`, so it covers all five routes. There is no unauthenticated path into the resource.
- **Ownership is filtered in the service, not the route.** Each service call receives the caller's `ownerId` from `req.user.id` and puts it in the query — `Project.find({ owner })`, `findOne({ _id, owner })`, `findOneAndUpdate({ _id, owner }, …)`, `findOneAndDelete({ _id, owner })`. A route cannot forget the check, because the route never builds the query. `owner` is also stripped from the serialised document by the schema's `toJSON` transform.
- **Another user's project returns `404`, not `403`.** Deliberate: a `403` confirms that the id exists and belongs to somebody, so a client could probe ids to discover other users' projects. A missing project and someone else's project are indistinguishable from the outside. The `:id` is also format-checked as a 24-character hex string before any query runs, so a malformed id costs nothing.

### Validation

| Rule | Detail |
|---|---|
| `name` | Required, 1–120 characters after trimming |
| `description` | Optional, at most 500 characters |
| Components | At most 120 entries in `arch.nodes` |
| Connections | At most 120 entries in `arch.edges` |
| Component ids | Unique within the project; each component needs both `id` and `type` |
| Connection targets | Every `arch.edges[].source` and `.target` must match an existing `arch.nodes[].id` |

Violations return `400` in the shared error format. `PUT` runs Mongoose validators (`runValidators: true`) and writes only the keys present in the body, so sending just `{ "description": "…" }` leaves the name and architecture alone.

## Wiring status

| Area | State |
|---|---|
| Authentication | **Wired** — frontend registers/logs in against these endpoints |
| Projects | **Wired** — the five `/api/projects` routes are live and owner-scoped |
| Architecture save/load | **Wired** — `arch` is stored inline on the project document; `PUT /api/projects/:id` writes it |
| Architecture version history | **Wired** — six nested `/versions` routes, owner-scoped, `currentVersion` is incremented |
| Simulation, mining, evaluation, reports, interview | Browser only — no API, results are not persisted |
| AI recommendations | Browser only — deterministic rules, no model is called |

The backend has no test suite and no `test` or `lint` script. The pipeline tests live in the
frontend package and run against the pure `src/lib/` modules, which have no browser or
Node-specific dependencies.

## Inspecting the database

### mongosh

```bash
# list collections in archai
mongosh "<your MONGO_URI>" --quiet --eval "db.getCollectionNames()"

# browse users
mongosh "<your MONGO_URI>" --quiet --eval "db.users.find().pretty()"

# confirm the unique email index
mongosh "<your MONGO_URI>" --quiet --eval "db.users.getIndexes()"

# count documents
mongosh "<your MONGO_URI>" --quiet --eval "db.users.countDocuments()"
```

### MongoDB Compass

[Compass](https://www.mongodb.com/products/compass) is a GUI client:

1. Install and open it
2. Paste your `mongodb+srv://…` connection string into the connection field
3. Click **Connect**
4. Select the **`archai`** database in the left sidebar
5. Open the **`users`** collection to browse documents

Compass also works with a local `mongodb://127.0.0.1:27017` string if you switch databases.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | Port the server listens on |
| `NODE_ENV` | `development` | Runtime mode |
| `API_PREFIX` | `/api` | Prefix all routes are mounted under |
| `CLIENT_URL` | `http://localhost:5173` | Frontend origin, added to the CORS allow-list |
| `CORS_ORIGINS` | unset | Comma-separated explicit CORS allow-list; unset allows the localhost dev ports |
| `LOG_REQUESTS` | `true` | Set `false` to silence per-request HTTP logging |
| `MONGO_URI` | `mongodb://127.0.0.1:27017` | MongoDB connection string |
| `DB_NAME` | `archai` | Database name |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS` | `10000` | How long to wait for a reachable server |
| `MONGO_DNS_SERVERS` | unset | Comma-separated DNS servers used for Atlas SRV lookups; unset uses the system resolver |
| `JWT_SECRET` | **required for auth** | Secret used to sign and verify tokens |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime |
| `BCRYPT_ROUNDS` | `10` | Password hashing cost factor |

## Running the full application

The backend and the frontend are two separate apps with their own `package.json` and their own dev server. Start the backend first, then the frontend in a second terminal.

### 1. Prerequisites

- **Node.js 18 or newer** — `node --version`
- **MongoDB Atlas** — an active cluster, with its connection string ready to paste
- **Two terminals** — both servers must run at the same time

### 2. Backend first

```bash
cd backend
npm install
cp .env.example .env
```

Paste your Atlas connection string into `backend/.env`:

```bash
MONGO_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/archai?retryWrites=true&w=majority&authSource=admin
DB_NAME=archai
```

Then set `JWT_SECRET` — registration and login fail without it. Generate a random value and paste the output after the `=`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Start the server:

```bash
npm run dev
```

It connects to MongoDB first, then starts listening on `PORT` (default `5000`). Leave this terminal running.

### 3. Frontend second

From the `backend` folder, `cd ..` moves up to the project root — the folder holding `vite.config.js` and the root `package.json`:

```bash
cd ..
npm install
npm run dev
```

Open **http://localhost:5173** in the browser. Leave this terminal running too.

The frontend calls `http://localhost:5000/api` by default (`src/services/api.js`). To point it somewhere else, set `VITE_API_BASE_URL` in a `.env` file in the project root — that value overrides the default.

### 4. Check it worked

In a third terminal, with the backend still running:

```bash
# Windows PowerShell
Invoke-RestMethod http://localhost:5000/api/health

# macOS / Linux
curl http://localhost:5000/api/health
```

A healthy backend returns `200` with (trimmed):

```json
{
  "success": true,
  "status": "OK",
  "database": { "status": "connected", "name": "archai" }
}
```

If instead you get `503` and `"status": "DEGRADED"`, the server is up but MongoDB is not — see the table below.

Then open http://localhost:5173 and register an account. In MongoDB Compass, connect with the same `MONGO_URI` and check **`archai`** → **`users`** for the new document.

### 5. Two terminals, running together

| Terminal | Command | What it serves |
|---|---|---|
| 1 | `cd backend`, then `npm run dev` | API on `http://localhost:5000` |
| 2 | `cd ..`, then `npm run dev` | UI on `http://localhost:5173` |

Both stay open at the same time. Stopping one with `Ctrl+C` does not stop the other: kill the backend and the page still loads but every API call fails; kill the frontend and the API keeps serving with no UI attached.

### 6. Troubleshooting

| Problem | Fix |
|---|---|
| `MongoServerError: querySrv ECONNREFUSED _mongodb._tcp.<cluster>.mongodb.net` | Your network blocks Atlas SRV lookups. Set `MONGO_DNS_SERVERS=1.1.1.1,8.8.8.8` in `backend/.env` and restart. |
| `bad auth : Authentication failed` | The password in `MONGO_URI` is wrong or was rotated, or the user has no privilege on the `archai` database. Re-copy the string from Atlas and check *Database Access → the user → a privilege on `archai`*. Special characters in the password must be percent-encoded. |
| `EADDRINUSE` on port `5000` | Another process already holds the port. Change `PORT` in `backend/.env`, or stop the other process. |
| `Failed to connect to MongoDB`, backend exits immediately | MongoDB is unreachable, so the server stops rather than serving a broken connection. Fix `MONGO_URI`, `DB_NAME`, or the DNS override above, then start it again. |
| UI shows `Cannot reach the backend` | The backend is not running, or `VITE_API_BASE_URL` points somewhere else. Start terminal 1 and check that value. |
| `401` on any request | The token is missing or has expired. Sign in again — the client clears the stored token on any `401`. |

## Project structure

```text
backend/
├── src/
│   ├── config/
│   │   ├── index.js            # dotenv loading, validated env object
│   │   ├── database.js         # Mongoose connect/disconnect/state
│   │   └── logger.js           # timestamped console logger
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── health.controller.js
│   │   └── project.controller.js
│   ├── middleware/
│   │   ├── auth.js             # requireAuth / optionalAuth (JWT)
│   │   ├── cors.js             # CORS handling + preflight
│   │   └── errorHandler.js     # ApiError, 404 handler, error handler
│   ├── models/
│   │   ├── Project.model.js    # Mongoose Project schema
│   │   └── User.model.js       # Mongoose User schema
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── health.routes.js
│   │   ├── index.js            # central router
│   │   └── project.routes.js
│   ├── services/
│   │   ├── auth.service.js     # register / login / getUserById
│   │   └── project.service.js  # project CRUD, owner-scoped queries
│   ├── app.js                  # express app wiring
│   └── server.js               # db connection, listener, shutdown handling
├── .env                        # real credentials — git-ignored
├── .env.example                # committed template — placeholders only
├── .gitignore
├── package.json
└── README.md
```

`src/app.js` builds the Express app without opening a port, so tests can import it safely. `src/server.js` owns the database connection, the listener, and signal handling.

## User model

Defined in `src/models/User.model.js`:

| Field | Type | Rules |
|---|---|---|
| `name` | String | required, trimmed, 2–80 chars |
| `email` | String | required, trimmed, lowercased, **unique**, format-validated |
| `passwordHash` | String | optional, **`select: false`** — never returned by default |
| `role` | String | enum `student` / `faculty` / `admin`, defaults to `student` |
| `createdAt` | Date | automatic (`timestamps: true`) |
| `updatedAt` | Date | automatic (`timestamps: true`) |

`passwordHash` exists as a schema field only, populated by `bcrypt` during registration. No login/registration/JWT logic lives in the model itself — that is handled by `src/services/auth.service.js`.

Because `passwordHash` is `select: false`, a plain query omits it. To read it deliberately:

```js
await User.findOne({ email }).select('+passwordHash')
```

A `toJSON` transform also strips `passwordHash` and `__v` so the hash cannot leak through an API response. A stored document therefore serialises as:

```json
{
  "_id": "…", "name": "…", "email": "…", "role": "student",
  "createdAt": "…", "updatedAt": "…"
}
```

> In Mongoose, `unique: true` is a schema declaration, not a runtime validator. The index is created by `Model.syncIndexes()` or on first write. Duplicates are then rejected with MongoDB error code `11000`.

## Conventions

- ES modules (`"type": "module"`)
- No semicolons, single quotes, 2-space indent — matching the frontend
- Controllers handle HTTP concerns and will call into service modules as those are added
