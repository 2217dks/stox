# Phase 1 API Contract Review

## Purpose

Define the API contracts and conventions used by the Phase 1 administrative user APIs before implementation.

The contracts follow the centralized Stox backend architecture:

```text
Authentication
      ↓
Authorization
      ↓
Input validation
      ↓
Controller
      ↓
Service
      ↓
Prisma
      ↓
Centralized error handler
```

---

## API Response Convention

### Success

All successful responses use:

```json
{
    "success": true,
    "data": {}
}
```

### Error

All errors are handled centrally by:

```text
src/middleware/errorHandler.js
```

and use:

```json
{
    "success": false,
    "error": {
        "code": "ERROR_CODE",
        "message": "Human-readable message"
    }
}
```

`details` is included when available.

Controllers and services must never construct error responses directly.

Expected application errors must use `AppError`.

---

# Authentication and Authorization

Protected administrative endpoints require:

```http
Authorization: Bearer <access-token>
```

Middleware order:

```text
authMiddleware
      ↓
admin authorization middleware
      ↓
validation
      ↓
controller
```

Authentication identifies the caller through:

```js
req.user = {
    userId,
    role,
    email,
};
```

Authorization is handled separately by the RBAC middleware.

The admin APIs must not duplicate RBAC logic inside controllers or services.

---

# 1. Admin User List API

## Endpoint

```http
GET /api/v1/admin/users
```

## Purpose

Return a paginated list of users for administrative use.

## Query Parameters

| Parameter     | Type    | Required | Default | Description              |
| ------------- | ------- | -------: | ------: | ------------------------ |
| `page`        | integer |       No |     `1` | Page number              |
| `limit`       | integer |       No |    `20` | Number of users per page |
| `search`      | string  |       No |       — | Search by name or email  |
| `role`        | enum    |       No |       — | Filter by user role      |
| `isSuspended` | boolean |       No |       — | Filter suspended users   |
| `isVerified`  | boolean |       No |       — | Filter verified users    |

### Pagination limits

```text
page >= 1
limit >= 1
limit <= 100
```

### Valid roles

```text
TRADER
MODERATOR
ADMIN
```

### Boolean filters

```text
true
false
```

## Example Request

```http
GET /api/v1/admin/users?page=1&limit=20&search=john&role=TRADER&isSuspended=false
```

## Default Ordering

Users are returned newest first:

```text
createdAt DESC
```

## Success Response

```json
{
    "success": true,
    "data": {
        "users": [
            {
                "id": "uuid",
                "email": "user@example.com",
                "name": "John Doe",
                "avatarUrl": null,
                "role": "TRADER",
                "isVerified": true,
                "isSuspended": false,
                "createdAt": "2026-10-01T10:00:00.000Z",
                "updatedAt": "2026-10-06T10:00:00.000Z",
                "lastLoginAt": "2026-10-06T11:00:00.000Z"
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 1,
            "totalPages": 1
        }
    }
}
```

## Search

`search` matches against:

```text
name
email
```

---

# 2. Admin User Detail API

## Endpoint

```http
GET /api/v1/admin/users/:userId
```

## Purpose

Return the administrative user profile for a specific user.

## Path Parameter

```text
userId
```

Must be a valid UUID.

## Example Request

```http
GET /api/v1/admin/users/8b2c...
```

## Success Response

```json
{
    "success": true,
    "data": {
        "user": {
            "id": "uuid",
            "email": "user@example.com",
            "name": "John Doe",
            "avatarUrl": null,
            "role": "TRADER",
            "isVerified": true,
            "isSuspended": false,
            "createdAt": "2026-10-01T10:00:00.000Z",
            "updatedAt": "2026-10-06T10:00:00.000Z",
            "lastLoginAt": "2026-10-06T11:00:00.000Z"
        }
    }
}
```

---

# User Fields

## Allowed fields

The administrative user representation may expose:

```text
id
email
name
avatarUrl
role
isVerified
isSuspended
createdAt
updatedAt
lastLoginAt
```

## Sensitive fields

The following fields must never be returned:

```text
passwordHash
googleId
pushToken
refreshTokens
```

The API should explicitly select the allowed fields through Prisma rather than querying the full user object and removing sensitive fields afterward.

---

# Error Contracts

## Missing authentication

```http
401 UNAUTHORIZED
```

```json
{
    "success": false,
    "error": {
        "code": "UNAUTHORIZED",
        "message": "Authentication required."
    }
}
```

## Invalid authentication token

```http
401 INVALID_ACCESS_TOKEN
```

## Authenticated but not authorized

```http
403 FORBIDDEN
```

```json
{
    "success": false,
    "error": {
        "code": "FORBIDDEN",
        "message": "Administrator access required."
    }
}
```

## Invalid request/query/path parameters

```http
400 VALIDATION_ERROR
```

Validation errors are produced by Zod and formatted by the centralized error handler.

## User not found

```http
404 USER_NOT_FOUND
```

```json
{
    "success": false,
    "error": {
        "code": "USER_NOT_FOUND",
        "message": "User not found."
    }
}
```

## Unexpected error

Unexpected errors must not expose internal details.

```http
500 INTERNAL_SERVER_ERROR
```

The full error is logged server-side through Winston.

---

# Scope Boundaries

The admin user-detail API returns user information only.

It does not include:

```text
portfolio details
holdings
orders
trades
social activity
leaderboard statistics
```

Those concerns belong to their respective Phase 1 APIs.

---

# Implementation Conventions

## Controllers

Controllers:

- extract validated request data
- call the service
- return successful responses
- forward errors with `next(error)`

Controllers must not construct error responses.

## Services

Services:

- contain business logic
- query Prisma
- throw `AppError` for expected failures
- translate relevant Prisma errors into domain errors

## Validation

Request validation must use Zod schemas.

Body, query, and path parameters should be validated before the controller executes.

## Logging

Request and error logging is handled by the centralized Winston pipeline.

Admin controllers and services must not introduce their own `console.error` logging.

---
