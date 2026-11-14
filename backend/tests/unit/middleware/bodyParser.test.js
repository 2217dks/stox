const { Readable } = require("stream");

const {
  createJsonBodyParser,
  translateBodyParserError,
} = require("../../../src/middleware/bodyParser");
const { AppError } = require("../../../src/utils/errors");

function makeReq(body, contentType = "application/json") {
  const req = Readable.from([Buffer.from(body)]);
  req.method = "POST";
  req.headers = {
    "content-type": contentType,
    "content-length": String(Buffer.byteLength(body)),
  };
  return req;
}

function makeRes() {
  return {
    setHeader() {},
    getHeader() {},
    removeHeader() {},
  };
}

describe("body parser middleware", () => {
  describe("translateBodyParserError", () => {
    test("maps an oversized body to 413 PAYLOAD_TOO_LARGE", () => {
      const error = translateBodyParserError({ type: "entity.too.large" });

      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(413);
      expect(error.code).toBe("PAYLOAD_TOO_LARGE");
      expect(error.message).toBe("Request body is too large.");
    });

    test("maps a parse failure to 400 INVALID_JSON", () => {
      const error = translateBodyParserError({ type: "entity.parse.failed" });

      expect(error.statusCode).toBe(400);
      expect(error.code).toBe("INVALID_JSON");
      expect(error.message).not.toContain("Unexpected token");
    });

    test("maps an unsupported encoding to 415", () => {
      const error = translateBodyParserError({ type: "encoding.unsupported" });

      expect(error.statusCode).toBe(415);
      expect(error.code).toBe("UNSUPPORTED_CONTENT_ENCODING");
    });

    test("returns null for errors it does not own", () => {
      expect(translateBodyParserError({ type: "request.aborted" })).toBeNull();
      expect(translateBodyParserError(new Error("other"))).toBeNull();
      expect(translateBodyParserError(undefined)).toBeNull();
    });
  });

  describe("createJsonBodyParser", () => {
    test("parses a valid JSON body and calls next()", async () => {
      const parser = createJsonBodyParser({ limit: "10kb" });
      const req = makeReq('{"name":"stox"}');

      const nextError = await new Promise((resolve) => {
        parser(req, makeRes(), resolve);
      });

      expect(nextError).toBeUndefined();
      expect(req.body).toEqual({ name: "stox" });
    });

    test("passes an AppError to next when the body exceeds the limit", async () => {
      const parser = createJsonBodyParser({ limit: "1b" });
      const req = makeReq('{"name":"stox"}');

      const nextError = await new Promise((resolve) => {
        parser(req, makeRes(), resolve);
      });

      expect(nextError).toBeInstanceOf(AppError);
      expect(nextError.statusCode).toBe(413);
      expect(nextError.code).toBe("PAYLOAD_TOO_LARGE");
    });

    test("passes an AppError to next for malformed JSON", async () => {
      const parser = createJsonBodyParser({ limit: "10kb" });
      const req = makeReq('{"name":');

      const nextError = await new Promise((resolve) => {
        parser(req, makeRes(), resolve);
      });

      expect(nextError).toBeInstanceOf(AppError);
      expect(nextError.statusCode).toBe(400);
      expect(nextError.code).toBe("INVALID_JSON");
    });

    test("leaves non-JSON content types alone", async () => {
      const parser = createJsonBodyParser({ limit: "10kb" });
      const req = makeReq("plain text", "text/plain");

      const nextError = await new Promise((resolve) => {
        parser(req, makeRes(), resolve);
      });

      expect(nextError).toBeUndefined();
      expect(req.body).toBeUndefined();
    });
  });
});
