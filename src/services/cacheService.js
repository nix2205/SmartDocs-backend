const caches = new Map();

const getNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? number
    : fallback;
};

const now = () => Date.now();

const getCacheTtl = () =>
  getNumber(
    process.env.SMARTDOCS_CACHE_TTL_MS,
    60000
  );

const getMaxEntries = () =>
  Math.max(
    10,
    getNumber(
      process.env.SMARTDOCS_CACHE_MAX_ENTRIES,
      100
    )
  );

const get = (namespace, key) => {
  const bucket = caches.get(namespace);
  if (!bucket) return null;

  const item = bucket.get(key);
  if (!item) return null;

  if (item.expiresAt <= now()) {
    bucket.delete(key);
    return null;
  }

  item.lastUsedAt = now();
  return item.value;
};

const set = (namespace, key, value, ttl = getCacheTtl()) => {
  let bucket = caches.get(namespace);

  if (!bucket) {
    bucket = new Map();
    caches.set(namespace, bucket);
  }

  bucket.set(key, {
    value,
    expiresAt: now() + ttl,
    lastUsedAt: now(),
  });

  const maxEntries = getMaxEntries();

  while (bucket.size > maxEntries) {
    const oldest = [...bucket.entries()]
      .sort(
        (a, b) =>
          a[1].lastUsedAt - b[1].lastUsedAt
      )[0];

    if (!oldest) break;
    bucket.delete(oldest[0]);
  }

  return value;
};

const clear = (namespace) => {
  if (namespace) {
    caches.delete(namespace);
    return;
  }

  caches.clear();
};

const stats = () => {
  const output = {};

  for (const [namespace, bucket] of caches) {
    output[namespace] = bucket.size;
  }

  return output;
};

module.exports = {
  get,
  set,
  clear,
  stats,
};
