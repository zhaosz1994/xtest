class MiddlewareBase {
  process(chunk) {
    return chunk;
  }

  reset() {}
}

module.exports = MiddlewareBase;
