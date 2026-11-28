function createLogThrottle(windowMs = 2000) {
  const seen = new Map();
  const span = Math.max(0, Number(windowMs) || 0);
  return {
    line(text, now = Date.now()) {
      const key = String(text == null ? '' : text);
      const prev = seen.get(key);
      if (!prev) {
        seen.set(key, { count: 0, emittedAt: now });
        return { text: key, count: 1 };
      }
      prev.count += 1;
      if (now - prev.emittedAt >= span) {
        const out = { text: key, count: prev.count };
        prev.count = 0;
        prev.emittedAt = now;
        return out;
      }
      return null;
    },
  };
}

module.exports = { createLogThrottle };
