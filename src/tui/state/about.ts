import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Project identity for the UI, read from package.json so the
 * maintainers section never drifts from the manifest.
 */
export interface AboutPerson {
  name: string;
  url?: string;
}

export interface ProjectAbout {
  author?: AboutPerson;
  maintainers: AboutPerson[];
}

interface PackageJsonLike {
  author?: { name?: string; url?: string };
  maintainers?: { name?: string; url?: string }[];
}

export function getAbout(root: string = process.cwd()): ProjectAbout {
  const FILE = join(root, 'package.json');

  if (!existsSync(FILE)) {
    return { maintainers: [] };
  }

  try {
    const PARSED = JSON.parse(
      readFileSync(FILE, 'utf8')
    ) as PackageJsonLike;
    return {
      author: PARSED.author?.name
        ? { name: PARSED.author.name, url: PARSED.author.url }
        : undefined,
      maintainers: (PARSED.maintainers ?? [])
        .filter((person): boolean => {
          return Boolean(person?.name);
        })
        .map((person): AboutPerson => {
          return { name: person.name ?? '', url: person.url };
        }),
    };
  } catch {
    return { maintainers: [] };
  }
}
