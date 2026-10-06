function validate(schema) {
  return function validateMiddleware(req, res, next) {
    req.body = schema.parse(req.body);
    next();
  };
}
module.exports = validate;
