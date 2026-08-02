import type { NanoCommand, NanoModule } from '@/types/nano-module.js';
import { taskDescription } from '@/types/nano-module.js';

/**
 * The HELP COMPLETENESS GATE. Modules run auditModuleHelp() inside
 * their own test suites (expect the result to be empty) so missing
 * help metadata fails the suite — help is written WITH each command,
 * never bulk-retrofitted later.
 */
interface CommandOptionJson {
  type?: number;
  name?: string;
  description?: string;
  options?: CommandOptionJson[];
}

interface CommandJson {
  name?: string;
  type?: number;
  description?: string;
  options?: CommandOptionJson[];
}

const CHAT_INPUT_TYPE = 1;
const SUBCOMMAND_TYPE = 1;
const SUBCOMMAND_GROUP_TYPE = 2;

/**
 * Every subcommand path a command's builder declares, in declaration
 * order: `['list', 'group add']`-style space-joined paths. Empty for
 * commands without subcommands.
 */
export function subcommandPaths(command: NanoCommand): string[] {
  const JSON_DATA = command.data.toJSON() as CommandJson;
  const PATHS: string[] = [];

  for (const _option of JSON_DATA.options ?? []) {
    if (_option.type === SUBCOMMAND_TYPE && _option.name) {
      PATHS.push(_option.name);
      continue;
    }

    if (_option.type === SUBCOMMAND_GROUP_TYPE && _option.name) {
      for (const _nested of _option.options ?? []) {
        if (_nested.type === SUBCOMMAND_TYPE && _nested.name) {
          PATHS.push(`${_option.name} ${_nested.name}`);
        }
      }
    }
  }
  return PATHS;
}

/**
 * Violations of the help metadata law for one command. An empty
 * array means the command passes the gate.
 */
export function auditCommandHelp(command: NanoCommand): string[] {
  const JSON_DATA = command.data.toJSON() as CommandJson;
  const NAME = command.data.name;
  const VIOLATIONS: string[] = [];
  const IS_CHAT_INPUT = JSON_DATA.type === undefined ||
    JSON_DATA.type === CHAT_INPUT_TYPE;

  if (IS_CHAT_INPUT && !JSON_DATA.description?.trim()) {
    VIOLATIONS.push(`/${NAME}: builder description is empty`);
  }

  if (!command.help) {
    VIOLATIONS.push(`/${NAME}: help metadata is missing`);
    return VIOLATIONS;
  }

  if (!command.help.long?.trim()) {
    VIOLATIONS.push(`/${NAME}: help.long is empty`);
  }

  if (!command.help.usage?.trim()) {
    VIOLATIONS.push(`/${NAME}: help.usage is empty`);
  }

  if (!hasExample(command.help.examples)) {
    VIOLATIONS.push(`/${NAME}: help.examples needs at least one example`);
  }

  const PATHS = subcommandPaths(command);
  const DECLARED = command.help.subcommands ?? {};

  for (const _path of PATHS) {
    const CARD = DECLARED[_path];

    if (!CARD) {
      VIOLATIONS.push(`/${NAME} ${_path}: subcommand help card is missing`);
      continue;
    }

    if (!CARD.long?.trim()) {
      VIOLATIONS.push(`/${NAME} ${_path}: help.long is empty`);
    }

    if (!CARD.usage?.trim()) {
      VIOLATIONS.push(`/${NAME} ${_path}: help.usage is empty`);
    }

    if (!hasExample(CARD.examples)) {
      VIOLATIONS.push(
        `/${NAME} ${_path}: help.examples needs at least one example`
      );
    }
  }

  for (const _declared of Object.keys(DECLARED)) {
    if (!PATHS.includes(_declared)) {
      VIOLATIONS.push(
        `/${NAME} ${_declared}: help card has no matching subcommand`
      );
    }
  }
  return VIOLATIONS;
}

/**
 * Violations of the help metadata law for a whole module: module
 * description, every command (subcommand-deep), every event, every
 * task. An empty array means the module passes the gate.
 */
export function auditModuleHelp(module: NanoModule): string[] {
  const VIOLATIONS: string[] = [];

  if (!module.description?.trim()) {
    VIOLATIONS.push(`module ${module.name}: description is empty`);
  }

  for (const _command of module.commands ?? []) {
    VIOLATIONS.push(...auditCommandHelp(_command));
  }

  for (const _event of module.events ?? []) {
    if (!_event.description?.trim()) {
      VIOLATIONS.push(`event ${_event.name}: description is empty`);
    }
  }

  for (const [_name, _entry] of Object.entries(module.tasks ?? {})) {
    if (!taskDescription(_entry)?.trim()) {
      VIOLATIONS.push(`task ${_name}: description is empty`);
    }
  }

  for (const _task of module.reconcile ?? []) {
    if (!_task.description.trim()) {
      VIOLATIONS.push(
        `reconcile ${_task.id}: description is empty`
      );
    }
  }
  return VIOLATIONS;
}

function hasExample(examples: string[] | undefined): boolean {
  return (examples ?? []).some((example: string): boolean => {
    return example.trim().length > 0;
  });
}
