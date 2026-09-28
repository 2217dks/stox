const { ZodError } = require("zod");

const {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
} = require("../validators/authValidator");
const {
  registerUser,
  loginUser,
  refreshAccessToken,
  revokeRefreshToken,
} = require("../services/authService");

async function register(req, res) {
  try {
    // --------------------------------------------------------
    // 1. Validate request body
    // --------------------------------------------------------

    const validatedData = registerSchema.parse(req.body);

    // --------------------------------------------------------
    // 2. Collect request metadata
    // --------------------------------------------------------

    const userAgent = req.get("user-agent") || null;
    const ipAddress = req.ip || null;

    // --------------------------------------------------------
    // 3. Call authentication service
    // --------------------------------------------------------

    const result = await registerUser({
      name: validatedData.name,
      email: validatedData.email,
      password: validatedData.password,
      userAgent,
      ipAddress,
    });

    // --------------------------------------------------------
    // 4. Return created user + tokens
    // --------------------------------------------------------

    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    // --------------------------------------------------------
    // Validation errors
    // --------------------------------------------------------

    if (error instanceof ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: error.issues,
        },
      });
    }

    // --------------------------------------------------------
    // Known service errors
    // --------------------------------------------------------

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: {
          code: error.code || "AUTH_ERROR",
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    }

    // --------------------------------------------------------
    // Unexpected error
    // --------------------------------------------------------

    console.error("Registration error:", error);

    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
    });
  }
}

async function login(req, res) {
  try {
    // --------------------------------------------------------
    // 1. Validate request body
    // --------------------------------------------------------

    const validatedData = loginSchema.parse(req.body);

    // --------------------------------------------------------
    // 2. Collect request metadata
    // --------------------------------------------------------

    const userAgent = req.get("user-agent") || null;
    const ipAddress = req.ip || null;

    // --------------------------------------------------------
    // 3. Call authentication service
    // --------------------------------------------------------

    const result = await loginUser({
      email: validatedData.email,
      password: validatedData.password,
      userAgent,
      ipAddress,
    });

    // --------------------------------------------------------
    // 4. Return authenticated user + tokens
    // --------------------------------------------------------

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    // --------------------------------------------------------
    // Validation errors
    // --------------------------------------------------------

    if (error instanceof ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: error.issues,
        },
      });
    }

    // --------------------------------------------------------
    // Known authentication errors
    // --------------------------------------------------------

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: {
          code: error.code || "AUTH_ERROR",
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    }

    // --------------------------------------------------------
    // Unexpected error
    // --------------------------------------------------------

    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
    });
  }
}

async function refresh(req, res) {
  try {
    // --------------------------------------------------------
    // 1. Validate request body
    // --------------------------------------------------------

    const validatedData = refreshTokenSchema.parse(req.body);

    // --------------------------------------------------------
    // 2. Collect request metadata
    // --------------------------------------------------------

    const userAgent = req.get("user-agent") || null;
    const ipAddress = req.ip || null;

    // --------------------------------------------------------
    // 3. Rotate the refresh token
    // --------------------------------------------------------

    const result = await refreshAccessToken({
      refreshToken: validatedData.refreshToken,
      userAgent,
      ipAddress,
    });

    // --------------------------------------------------------
    // 4. Return the new token pair
    // --------------------------------------------------------

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    // --------------------------------------------------------
    // Validation errors
    // --------------------------------------------------------

    if (error instanceof ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: error.issues,
        },
      });
    }

    // --------------------------------------------------------
    // Known authentication errors
    // --------------------------------------------------------

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: {
          code: error.code || "AUTH_ERROR",
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    }

    // --------------------------------------------------------
    // Unexpected error
    // --------------------------------------------------------

    console.error("Refresh-token error:", error);

    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
    });
  }
}

async function logout(req, res) {
  try {
    // --------------------------------------------------------
    // 1. Validate request body
    // --------------------------------------------------------

    const validatedData = refreshTokenSchema.parse(req.body);

    // --------------------------------------------------------
    // 2. Revoke refresh token
    // --------------------------------------------------------

    const revoked = await revokeRefreshToken(validatedData.refreshToken);

    // --------------------------------------------------------
    // 3. Return logout response
    // --------------------------------------------------------

    return res.status(200).json({
      success: true,
      data: {
        loggedOut: true,
        tokenRevoked: revoked,
      },
    });
  } catch (error) {
    // --------------------------------------------------------
    // Validation errors
    // --------------------------------------------------------

    if (error instanceof ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: error.issues,
        },
      });
    }

    // --------------------------------------------------------
    // Unexpected error
    // --------------------------------------------------------

    console.error("Logout error:", error);

    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
    });
  }
}

module.exports = {
  register,
  login,
  refresh,
  logout,
};
