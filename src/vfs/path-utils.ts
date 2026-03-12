export function posixNormalize(inputPath: string): string {
  const raw = inputPath.startsWith('/') ? inputPath : `/${inputPath}`;
  const segments: string[] = [];

  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      segments.pop(); // clamp at root — never goes above /
    } else {
      segments.push(seg);
    }
  }

  return '/' + segments.join('/');
}

export function parentOf(normalizedPath: string): string {
  const idx = normalizedPath.lastIndexOf('/');
  return idx <= 0 ? '/' : normalizedPath.slice(0, idx);
}

export function baseName(normalizedPath: string): string {
  const idx = normalizedPath.lastIndexOf('/');
  return normalizedPath.slice(idx + 1);
}

export function isStrictDescendantPath(ancestorPath: string, candidatePath: string): boolean {
  if (candidatePath === ancestorPath) {
    return false;
  }
  if (ancestorPath === '/') {
    return candidatePath.startsWith('/');
  }
  return candidatePath.startsWith(`${ancestorPath}/`);
}
