function validate(schema, source = "body", destination = source) {
  return function validateMiddleware(req, res, next) {
    const parsed = schema.parse(req[source]);

    req[destination] = parsed;

    next();
  };
}

module.exports = validate;
