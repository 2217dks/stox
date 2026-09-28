const { ZodError } = require("zod");

const { registerSchema } = require("../validators/authValidator");
const { registerUser } = require("../services/authService");

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

module.exports = {
  register,
};
