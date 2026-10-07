const {
  registerUser,
  loginUser,
  refreshAccessToken,
  revokeRefreshToken,
  loginWithGoogle,
  getCurrentUser,
  updateProfile,
} = require("../services/authService");

async function register(req, res, next) {
  try {
    const { name, email, password } = req.body;

    const userAgent = req.get("user-agent") || null;
    const ipAddress = req.ip || null;

    const result = await registerUser({
      name,
      email,
      password,
      userAgent,
      ipAddress,
    });

    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    const userAgent = req.get("user-agent") || null;
    const ipAddress = req.ip || null;

    const result = await loginUser({
      email,
      password,
      userAgent,
      ipAddress,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;

    const userAgent = req.get("user-agent") || null;
    const ipAddress = req.ip || null;

    const result = await refreshAccessToken({
      refreshToken,
      userAgent,
      ipAddress,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;

    const revoked = await revokeRefreshToken(refreshToken);

    return res.status(200).json({
      success: true,
      data: {
        loggedOut: true,
        tokenRevoked: revoked,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function google(req, res, next) {
  try {
    const { credential } = req.body;

    const result = await loginWithGoogle(credential);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function currentUser(req, res, next) {
  try {
    const user = await getCurrentUser(req.user.userId);

    return res.status(200).json({
      success: true,
      data: {
        user,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateCurrentUser(req, res, next) {
  try {
    const user = await updateProfile(req.user.userId, req.body);

    return res.status(200).json({
      success: true,
      data: {
        user,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  google,
  currentUser,
  updateCurrentUser,
};
