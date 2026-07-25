export function normalizeUri(uri: string): string {
    if (!uri) return uri;
    return uri.startsWith('file://') || uri.startsWith('http') ? uri : `file://${uri}`;
  }