function validate(schema) {
  return function validateMiddleware(req, res, next) {
    req.body = schema.parse(req.body);
    next();
  };
}

function validateParams(schema) {
  return function validateParamsMiddleware(req, res, next) {
    req.params = schema.parse(req.params);
    next();
  };
}

module.exports = validate;
module.exports.validateParams = validateParams;
