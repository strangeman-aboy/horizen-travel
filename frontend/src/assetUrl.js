const EXTERNAL_ASSET_PATTERN = /^(?:[a-z]+:|\/\/|data:|blob:)/i;

export function assetUrl(source) {
  if (!source || EXTERNAL_ASSET_PATTERN.test(source)) {
    return source;
  }

  const normalized = String(source).replace(/^\/+/, "");
  return `${import.meta.env.BASE_URL}${normalized}`;
}
