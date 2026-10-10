const prisma = require("../config/database");
const { getCurrentUser } = require("./authService");

// The only fields a caller is allowed to change. Anything else in the request
// body is ignored here, and the validator rejects unknown keys before it ever
// reaches this layer.
const UPDATABLE_FIELDS = ["emailNotifications", "pushNotifications"];

function serializePreferences(preference) {
  return {
    id: preference.id,
    userId: preference.userId,
    emailNotifications: preference.emailNotifications,
    pushNotifications: preference.pushNotifications,
    createdAt: preference.createdAt,
    updatedAt: preference.updatedAt,
  };
}

/**
 * Return the caller's preferences, creating defaults on first access.
 *
 * Preferences are created lazily rather than at registration so accounts that
 * predate this feature (and Google sign-ups) still get a row the first time
 * they are read. `UserPreference.userId` is unique, so an upsert can never
 * create a second row for the same account.
 */
async function getPreferences(userId) {
  // Reuse the existing auth helper so a deleted or suspended account gets the
  // same 404/403 semantics as the rest of the account-scoped API.
  await getCurrentUser(userId);

  const preference = await prisma.userPreference.upsert({
    where: {
      userId,
    },
    update: {},
    create: {
      userId,
    },
  });

  return serializePreferences(preference);
}

/**
 * Update the caller's preferences, creating defaults first if needed.
 *
 * Only the fields present in `data` are written; every other key is ignored,
 * so a PATCH can never mutate an unexpected column.
 */
async function updatePreferences(userId, data = {}) {
  await getCurrentUser(userId);

  const updates = {};

  for (const field of UPDATABLE_FIELDS) {
    if (data[field] !== undefined) {
      updates[field] = data[field];
    }
  }

  // Upsert keeps PATCH working even when the row was never read first,
  // and applies any provided values on creation.
  const preference = await prisma.userPreference.upsert({
    where: {
      userId,
    },
    update: updates,
    create: {
      userId,
      ...updates,
    },
  });

  return serializePreferences(preference);
}

module.exports = {
  getPreferences,
  updatePreferences,
};
