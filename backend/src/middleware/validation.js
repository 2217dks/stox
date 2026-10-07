function validate(schema, source = "body") {
  return function validateMiddleware(req, res, next) {
    const parsed = schema.parse(req[source]);

    req[source] = parsed;

    next();
  };
}

module.exports = validate;
