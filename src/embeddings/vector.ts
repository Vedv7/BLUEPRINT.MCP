export function normalizeVector(vec: Float32Array) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array) {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Number(Math.max(0, Math.min(1, dot)).toFixed(4));
}

export function serializeVector(vec: Float32Array) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function deserializeVector(buf: Buffer, dimensions: number) {
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const vec = new Float32Array(arrayBuffer);
  if (vec.length === dimensions) return vec;
  return vec.slice(0, dimensions);
}
