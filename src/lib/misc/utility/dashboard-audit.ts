import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { auditModuleHelp } from '@/misc/utility/help-audit.js';
import type { DashboardManifest } from '@/types/nano-dashboard.js';
import {
  DASHBOARD_MANIFEST_FILENAME,
  loadDashboardManifest
} from '@/types/nano-dashboard.js';
import type { NanoModule } from '@/types/nano-module.js';

/**
 * THE DESCRIPTOR AUDIT — the isolation-audit learnings as a
 * reusable gate. Validates one module's nano-dashboard.json beyond
 * what zod alone checks: language completeness on every localized
 * text, media assets that actually exist, the cross-references the
 * schema does not walk, and (when the module definition is
 * available) provides existence, version equality, and the help
 * bijection. Barrel-exported so module repos run the SAME audit
 * inside their own test suites; the CLI (`npm run module --
 * dashboard`) wraps it for the terminal.
 */
export interface DashboardAuditIssue {
  level: 'error' | 'warn';
  message: string;
}

export interface DashboardAuditReport {
  module_dir: string;
  ok: boolean;
  issues: DashboardAuditIssue[];
}

const TEXT_KEYS = [
  'title', 'label', 'help', 'propagation', 'placeholder',
  'explain', 'confirm', 'description', 'alt',
];

const ASSETS_DIRNAME = 'nano-dashboard-assets';

function walkLocalized(
  node: unknown,
  path: string,
  languages: string[],
  issues: DashboardAuditIssue[]
): void {
  if (Array.isArray(node)) {
    node.forEach((item: unknown, index: number): void => {
      walkLocalized(item, `${path}[${index}]`, languages, issues);
    });
    return;
  }

  if (node === null || typeof node !== 'object') {
    return;
  }

  for (const [_key, _value] of Object.entries(
    node as Record<string, unknown>
  )) {
    const AT = `${path}.${_key}`;

    if (TEXT_KEYS.includes(_key)) {
      if (typeof _value === 'string' && languages.length > 0 &&
          _value.length > 0) {
        issues.push({
          level: 'warn',
          message: `${AT} is a plain string while languages are ` +
            'declared — it renders identically in every language.',
        });
        continue;
      }

      if (_value !== null && typeof _value === 'object' &&
          !Array.isArray(_value)) {
        for (const _code of languages) {
          const TEXT = (_value as Record<string, unknown>)[_code];

          if (typeof TEXT !== 'string' || TEXT.length === 0) {
            issues.push({
              level: 'error',
              message: `${AT} misses declared language '${_code}'.`,
            });
          }
        }
        continue;
      }
    }

    walkLocalized(_value, AT, languages, issues);
  }
}

function checkCrossRefs(
  manifest: DashboardManifest,
  issues: DashboardAuditIssue[]
): void {
  const DATA_IDS = new Set(
    (manifest.data ?? []).map((view: { id: string }): string => {
      return view.id;
    })
  );
  const GROUP_IDS = new Set(
    (manifest.action_groups ?? []).map(
      (group: { id: string }): string => {
        return group.id;
      }
    )
  );

  for (const _group of manifest.action_groups ?? []) {
    if (_group.see && !DATA_IDS.has(_group.see)) {
      issues.push({
        level: 'error',
        message: `action_groups '${_group.id}' see-references ` +
          `unknown data view '${_group.see}'.`,
      });
    }
  }

  for (const _action of manifest.actions ?? []) {
    if (_action.group && !GROUP_IDS.has(_action.group)) {
      issues.push({
        level: 'warn',
        message: `action '${_action.id}' names group ` +
          `'${_action.group}' with no action_groups metadata.`,
      });
    }
  }
}

function checkAssets(
  manifest: DashboardManifest,
  module_dir: string,
  issues: DashboardAuditIssue[]
): void {
  for (const _item of manifest.about?.media ?? []) {
    if (_item.kind !== 'image' ||
        _item.src.startsWith('https://')) {
      continue;
    }

    const FULL = join(module_dir, ASSETS_DIRNAME, _item.src);

    if (!existsSync(FULL)) {
      issues.push({
        level: 'error',
        message: `about.media names '${_item.src}' but ` +
          `${ASSETS_DIRNAME}/${_item.src} does not exist.`,
      });
    }
  }
}

function checkModuleBindings(
  manifest: DashboardManifest,
  module: NanoModule,
  issues: DashboardAuditIssue[]
): void {
  const PROVIDES = (module.provides ?? {}) as
    Record<string, unknown>;
  const NAMES: string[] = [];

  if (manifest.config.validate) {
    NAMES.push(manifest.config.validate);
  }

  for (const _view of manifest.data ?? []) {
    NAMES.push(_view.provides);
  }

  for (const _action of manifest.actions ?? []) {
    NAMES.push(_action.provides);
  }

  for (const _name of NAMES) {
    if (typeof PROVIDES[_name] !== 'function') {
      issues.push({
        level: 'error',
        message: `descriptor binds provides '${_name}' which the ` +
          'module does not export.',
      });
    }
  }

  if (module.api_version !== undefined &&
      manifest.api_version !== undefined &&
      module.api_version !== manifest.api_version) {
    issues.push({
      level: 'error',
      message: 'api_version drift: descriptor ' +
        `'${manifest.api_version}' vs module ` +
        `'${module.api_version}'.`,
    });
  }

  for (const _violation of auditModuleHelp(module)) {
    issues.push({
      level: 'error',
      message: `help cards: ${_violation}`,
    });
  }
}

/**
 * Audit one module directory. Pass the loaded NanoModule when
 * available to additionally verify provides, versions, and the
 * help bijection; descriptor-only audits skip those.
 */
export function auditDashboardDescriptor(
  module_dir: string,
  module?: NanoModule
): DashboardAuditReport {
  const ISSUES: DashboardAuditIssue[] = [];
  const PATH = join(module_dir, DASHBOARD_MANIFEST_FILENAME);

  if (!existsSync(PATH)) {
    return {
      module_dir,
      ok: false,
      issues: [{
        level: 'error',
        message: `No ${DASHBOARD_MANIFEST_FILENAME} in ` +
          `'${module_dir}' — descriptor-at-birth is law.`,
      }],
    };
  }

  const LOADED = loadDashboardManifest(PATH);

  if (!LOADED.ok) {
    return {
      module_dir,
      ok: false,
      issues: [{ level: 'error', message: LOADED.error }],
    };
  }

  const MANIFEST = LOADED.data;
  const LANGUAGES = MANIFEST.languages ?? [];

  walkLocalized(MANIFEST, 'manifest', LANGUAGES, ISSUES);
  checkCrossRefs(MANIFEST, ISSUES);
  checkAssets(MANIFEST, module_dir, ISSUES);

  if (module) {
    checkModuleBindings(MANIFEST, module, ISSUES);
  }

  const HAS_ERROR = ISSUES.some(
    (issue: DashboardAuditIssue): boolean => {
      return issue.level === 'error';
    }
  );
  return { module_dir, ok: !HAS_ERROR, issues: ISSUES };
}
