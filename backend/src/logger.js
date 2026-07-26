function normalizeError(error) {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    stack: error.stack
  };
}

function serialize(value) {
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, fieldValue]) => [
      key,
      fieldValue instanceof Error ? normalizeError(fieldValue) : fieldValue
    ])
  );
}

export function createJsonLogger(consoleLike = console) {
  return {
    info(event) {
      consoleLike.log(JSON.stringify(serialize(event)));
    },
    error(event) {
      consoleLike.error(JSON.stringify(serialize(event)));
    }
  };
}
