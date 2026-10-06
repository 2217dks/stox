require("dotenv").config();

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const { AppError } = require("../utils/errors");

const prisma = require("../config/database");

const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET;

const ACCESS_TOKEN_EXPIRY = process.env.JWT_ACCESS_EXPIRY || "15m";
const REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_EXPIRY || "7d";

const BCRYPT_SALT_ROUNDS = Number.parseInt(
  process.env.BCRYPT_SALT_ROUNDS || "10",
  10,
);

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

requireEnv("JWT_ACCESS_SECRET", ACCESS_TOKEN_SECRET);
requireEnv("JWT_REFRESH_SECRET", REFRESH_TOKEN_SECRET);

/**
 * Normalize email addresses before storing or querying them.
 *
 * Example:
 *   "  USER@Example.COM "
 *       ↓
 *   "user@example.com"
 */
function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

/**
 * Validate the password policy for local Stox accounts.
 *
 * Requirements:
 * - at least 6 characters
 * - at least one lowercase letter
 * - at least one uppercase letter
 * - at least one number
 * - at least one symbol
 *
 * This intentionally does not use regex patterns.
 */
function validatePasswordStrength(password) {
  const errors = [];

  if (typeof password !== "string") {
    return {
      valid: false,
      errors: ["Password must be a string."],
    };
  }

  if (password.length < 6) {
    errors.push("Password must be at least 6 characters long.");
  }

  let hasLowercase = false;
  let hasUppercase = false;
  let hasNumber = false;
  let hasSymbol = false;

  for (const character of password) {
    const code = character.charCodeAt(0);

    // a-z
    if (code >= 97 && code <= 122) {
      hasLowercase = true;
      continue;
    }

    // A-Z
    if (code >= 65 && code <= 90) {
      hasUppercase = true;
      continue;
    }

    // 0-9
    if (code >= 48 && code <= 57) {
      hasNumber = true;
      continue;
    }

    // Anything non-alphanumeric and non-whitespace
    // counts as a symbol.
    if (character.trim() !== "") {
      hasSymbol = true;
    }
  }

  if (!hasLowercase) {
    errors.push("Password must contain at least one lowercase letter.");
  }

  if (!hasUppercase) {
    errors.push("Password must contain at least one uppercase letter.");
  }

  if (!hasNumber) {
    errors.push("Password must contain at least one number.");
  }

  if (!hasSymbol) {
    errors.push("Password must contain at least one symbol.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Hash a password before storing it.
 */
async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

/**
 * Compare a plaintext password against the stored hash.
 */
async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

/**
 * Create the short-lived JWT used for authenticated API requests.
 *
 * We keep the payload small.
 * Do NOT put passwords, refresh tokens, or other sensitive data inside it.
 */
function createAccessToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      email: user.email,
    },
    ACCESS_TOKEN_SECRET,
    {
      expiresIn: ACCESS_TOKEN_EXPIRY,
      issuer: "stox",
      subject: user.id,
    },
  );
}

/**
 * Create a cryptographically random opaque refresh token.
 *
 * The raw token is returned to the caller.
 * Only its SHA-256 hash is stored in PostgreSQL.
 */
function generateRefreshToken() {
  return crypto.randomBytes(48).toString("base64url");
}

/**
 * Hash the refresh token before storing it in the database.
 *
 * This means a leaked database does not directly contain usable
 * refresh tokens.
 */
function hashRefreshToken(refreshToken) {
  return crypto.createHash("sha256").update(refreshToken).digest("hex");
}

/**
 * Convert the configured refresh-token lifetime into milliseconds.
 *
 * This intentionally supports the project's simple configuration:
 * "15m", "7d", etc.
 */
function parseDurationToMilliseconds(value) {
  const match = /^(\d+)([smhd])$/.exec(value);

  if (!match) {
    throw new Error(
      `Invalid token duration "${value}". Use values such as "15m" or "7d".`,
    );
  }

  const amount = Number(match[1]);
  const unit = match[2];

  const multiplier = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  }[unit];

  return amount * multiplier;
}

/**
 * Remove fields that must never be returned to callers.
 */
function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
    isVerified: user.isVerified,
    isSuspended: user.isSuspended,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
  };
}

/**
 * Create an access-token + refresh-token pair.
 *
 * `db` is passed in so this can run inside a Prisma transaction.
 */
async function issueTokenPair(db, user, metadata = {}) {
  const accessToken = createAccessToken(user);

  const rawRefreshToken = generateRefreshToken();
  const hashedRefreshToken = hashRefreshToken(rawRefreshToken);

  const refreshLifetimeMs = parseDurationToMilliseconds(REFRESH_TOKEN_EXPIRY);

  const expiresAt = new Date(Date.now() + refreshLifetimeMs);

  await db.refreshToken.create({
    data: {
      token: hashedRefreshToken,
      userId: user.id,
      expiresAt,
      userAgent: metadata.userAgent || null,
      ipAddress: metadata.ipAddress || null,
    },
  });

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    expiresAt,
  };
}

/**
 * Register a local/password-based Stox account.
 *
 * This is service logic only.
 * The HTTP endpoint will be implemented in the next commit.
 */
async function registerUser({ name, email, password, userAgent, ipAddress }) {
  const normalizedEmail = normalizeEmail(email);

  const passwordValidation = validatePasswordStrength(password);

  if (!passwordValidation.valid) {
    throw AppError.badRequest(
      passwordValidation.errors.join(" "),
      "WEAK_PASSWORD",
      passwordValidation.errors,
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: {
      email: normalizedEmail,
    },
  });

  if (existingUser) {
    throw AppError.conflict(
      "An account with this email already exists.",
      "EMAIL_ALREADY_EXISTS",
    );
  }

  const passwordHash = await hashPassword(password);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
      },
    });

    await tx.portfolio.create({
      data: {
        userId: user.id,
        name: "Main Portfolio",
        startingBalance: "10000",
        cashBalance: "10000",
        isDefault: true,
      },
    });

    const tokens = await issueTokenPair(tx, user, {
      userAgent,
      ipAddress,
    });

    return {
      user,
      tokens,
    };
  });

  return {
    user: sanitizeUser(result.user),
    ...result.tokens,
  };
}

/**
 * Login with email + password.
 */
async function loginUser({ email, password, userAgent, ipAddress }) {
  const normalizedEmail = normalizeEmail(email);

  const user = await prisma.user.findUnique({
    where: {
      email: normalizedEmail,
    },
  });

  if (!user) {
    throw AppError.unauthorized("Invalid email or password.", "INVALID_CREDENTIALS");
  }

  if (user.isSuspended) {
    throw AppError.forbidden("This account has been suspended.", "ACCOUNT_SUSPENDED");
  }

  if (!user || !user.passwordHash) {
    throw AppError.unauthorized("Invalid email or password.", "INVALID_CREDENTIALS");
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);

  if (!passwordMatches) {
    throw AppError.unauthorized("Invalid email or password.", "INVALID_CREDENTIALS");
  }

  const result = await prisma.$transaction(async (tx) => {
    const tokens = await issueTokenPair(tx, user, {
      userAgent,
      ipAddress,
    });

    const updatedUser = await tx.user.update({
      where: {
        id: user.id,
      },
      data: {
        lastLoginAt: new Date(),
      },
    });

    return {
      user: updatedUser,
      tokens,
    };
  });

  return {
    user: sanitizeUser(result.user),
    ...result.tokens,
  };
}

/**
 * Exchange a valid refresh token for a new access-token + refresh-token pair.
 *
 * Refresh-token rotation:
 *
 * old refresh token
 *       ↓
 * verify + check database
 *       ↓
 * revoke old token
 *       ↓
 * create new refresh token
 *       ↓
 * return new token pair
 */
async function refreshAccessToken({ refreshToken, userAgent, ipAddress }) {
  if (!refreshToken) {
    throw AppError.unauthorized("Refresh token is required.", "REFRESH_TOKEN_REQUIRED");
  }

  const hashedToken = hashRefreshToken(refreshToken);

  const storedToken = await prisma.refreshToken.findUnique({
    where: {
      token: hashedToken,
    },
    include: {
      user: true,
    },
  });

  if (!storedToken) {
    throw AppError.unauthorized("Invalid refresh token.", "INVALID_REFRESH_TOKEN");
  }

  if (storedToken.revokedAt) {
    throw AppError.unauthorized("Refresh token has been revoked.", "REFRESH_TOKEN_REVOKED");
  }

  if (storedToken.expiresAt <= new Date()) {
    throw AppError.unauthorized("Refresh token has expired.", "REFRESH_TOKEN_EXPIRED");
  }

  if (storedToken.user.isSuspended) {
    throw AppError.forbidden("This account has been suspended.", "ACCOUNT_SUSPENDED");
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({
      where: {
        id: storedToken.id,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    const tokens = await issueTokenPair(tx, storedToken.user, {
      userAgent,
      ipAddress,
    });

    return tokens;
  });

  return {
    user: sanitizeUser(storedToken.user),
    ...result,
  };
}

/**
 * Revoke a refresh token.
 *
 * The logout controller will call this in the later logout task.
 */
async function revokeRefreshToken(refreshToken) {
  if (!refreshToken) {
    return false;
  }

  const hashedToken = hashRefreshToken(refreshToken);

  const result = await prisma.refreshToken.updateMany({
    where: {
      token: hashedToken,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  return result.count > 0;
}

async function loginWithGoogle(credential) {
  if (!credential) {
    throw AppError.badRequest("Google credential is required.", "GOOGLE_CREDENTIAL_REQUIRED");
  }

  let ticket;

  try {
    ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
  } catch (error) {
    throw AppError.unauthorized("Invalid Google credential.", "INVALID_GOOGLE_TOKEN");
  }

  const payload = ticket.getPayload();

  if (!payload) {
    throw AppError.unauthorized("Invalid Google account payload.", "INVALID_GOOGLE_TOKEN");
  }

  const {
    sub: googleId,
    email,
    email_verified: emailVerified,
    name,
    picture,
  } = payload;

  if (!googleId || !email) {
    throw AppError.unauthorized(
      "Google account information is incomplete.",
      "INVALID_GOOGLE_ACCOUNT",
    );
  }

  const normalizedEmail = normalizeEmail(email);

  let user = await prisma.user.findUnique({
    where: {
      googleId,
    },
  });

  // Existing Google-linked account
  if (user) {
    if (user.isSuspended) {
      throw AppError.forbidden("Account is suspended.", "ACCOUNT_SUSPENDED");
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: {
          id: user.id,
        },
        data: {
          lastLoginAt: new Date(),
          ...(picture ? { avatarUrl: picture } : {}),
        },
      });

      const tokens = await issueTokenPair(tx, updatedUser);

      return {
        user: sanitizeUser(updatedUser),
        tokens,
      };
    });

    return result;
  }

  // Existing password account with same email
  const existingEmailUser = await prisma.user.findUnique({
    where: {
      email: normalizedEmail,
    },
  });

  if (existingEmailUser) {
    throw AppError.conflict(
      "An account already exists with this email. Sign in with your password before linking Google.",
      "GOOGLE_ACCOUNT_LINK_REQUIRED",
    );
  }

  // New Google account
  const result = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email: normalizedEmail,
        name: name?.trim() || "Stox User",
        googleId,
        passwordHash: null,
        avatarUrl: picture || null,
        isVerified: Boolean(emailVerified),
      },
    });

    await tx.portfolio.create({
      data: {
        userId: newUser.id,
        name: "Main Portfolio",
        startingBalance: 10000,
        cashBalance: 10000,
        isDefault: true,
      },
    });

    const tokens = await issueTokenPair(tx, newUser);

    return {
      user: sanitizeUser(newUser),
      tokens,
    };
  });

  return result;
}

async function getCurrentUser(userId) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });

  if (!user) {
    throw AppError.notFound("User not found.", "USER_NOT_FOUND");
  }

  if (user.isSuspended) {
    throw AppError.forbidden("Account is suspended.", "ACCOUNT_SUSPENDED");
  }

  return sanitizeUser(user);
}

async function updateProfile(userId, profileData) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });

  if (!user) {
    throw AppError.notFound("User not found.", "USER_NOT_FOUND");
  }

  if (user.isSuspended) {
    throw AppError.forbidden("Account is suspended.", "ACCOUNT_SUSPENDED");
  }

  const data = {};

  if (profileData.name !== undefined) {
    data.name = profileData.name;
  }

  if (profileData.avatarUrl !== undefined) {
    data.avatarUrl = profileData.avatarUrl;
  }

  const updatedUser = await prisma.user.update({
    where: {
      id: userId,
    },
    data,
  });

  return sanitizeUser(updatedUser);
}

module.exports = {
  normalizeEmail,
  validatePasswordStrength,
  hashPassword,
  verifyPassword,
  createAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  sanitizeUser,
  registerUser,
  loginUser,
  refreshAccessToken,
  revokeRefreshToken,
  loginWithGoogle,
  getCurrentUser,
  updateProfile,
};
