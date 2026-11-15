const express = require("express");

const { AppError } = require("../utils/errors");

/**
 * Translate a body-parser failure into a domain `AppError`.
 *
 * body-parser errors carry a `type` and a raw `message` ("request entity too
 * large", "Unexpected token …"), neither of which belongs in the public
 * contract. Translating at the middleware boundary keeps
 * `middleware/errorHandler.js` a pure renderer: it only ever sees `AppError`,
 * `ZodError`, or genuinely unexpected failures.
 *
 * Returns `null` for errors this module does not own, so the caller can pass
 * them through unchanged.
 */
function translateBodyParserError(error) {
  switch (error?.type) {
    case "entity.too.large":
      return AppError.payloadTooLarge("Request body is too large.");

    case "entity.parse.failed":
      return AppError.badRequest(
        "Request body is not valid JSON.",
        "INVALID_JSON",
      );

    case "encoding.unsupported":
      return AppError.unsupportedMediaType(
        "Request body encoding is not supported.",
        "UNSUPPORTED_CONTENT_ENCODING",
      );

    case "charset.unsupported":
      return AppError.unsupportedMediaType(
        "Request body charset is not supported.",
        "UNSUPPORTED_CHARSET",
      );

    default:
      return null;
  }
}

/**
 * `express.json()` with an explicit size limit whose failures follow the
 * standard error envelope.
 */
function createJsonBodyParser({ limit } = {}) {
  const parser = limit ? express.json({ limit }) : express.json();

  return function jsonBodyParser(req, res, next) {
    parser(req, res, (error) => {
      if (!error) {
        return next();
      }

      return next(translateBodyParserError(error) || error);
    });
  };
}

module.exports = {
  createJsonBodyParser,
  translateBodyParserError,
};
