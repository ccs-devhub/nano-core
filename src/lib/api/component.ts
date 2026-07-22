import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

import { buildCustomId } from '@/misc/utility/custom-id.js';

/**
 * Component sugar over the discord.js builders. Specs are plain JSON
 * (AI/module friendly); customIds follow the `module:action:args`
 * routing convention automatically.
 */
export interface ButtonSpec {
  module: string;
  action: string;
  args?: string[];
  label: string;
  style?: 'primary' | 'secondary' | 'success' | 'danger';
  disabled?: boolean;
  emoji?: string;
}

export interface SelectOptionSpec {
  label: string;
  value: string;
  description?: string;
}

export interface SelectSpec {
  module: string;
  action: string;
  args?: string[];
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  options: SelectOptionSpec[];
}

export interface ModalInputSpec {
  key: string;
  label: string;
  style?: 'short' | 'paragraph';
  required?: boolean;
  placeholder?: string;
  value?: string;
}

export interface ModalSpec {
  module: string;
  action: string;
  args?: string[];
  title: string;
  inputs: ModalInputSpec[];
}

const MAX_BUTTONS_PER_ROW = 5;
const MAX_SELECT_OPTIONS = 25;

const BUTTON_STYLES: Record<string, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

/** A row of routable buttons (max 5, extra specs are dropped). */
export function buttonRow(
  specs: ButtonSpec[]
): ActionRowBuilder<ButtonBuilder> {
  const ROW = new ActionRowBuilder<ButtonBuilder>();

  for (const _spec of specs.slice(0, MAX_BUTTONS_PER_ROW)) {
    const BUTTON = new ButtonBuilder()
      .setCustomId(
        buildCustomId(_spec.module, _spec.action, ...(_spec.args ?? []))
      )
      .setLabel(_spec.label)
      .setStyle(BUTTON_STYLES[_spec.style ?? 'secondary'])
      .setDisabled(_spec.disabled ?? false);

    if (_spec.emoji) {
      BUTTON.setEmoji(_spec.emoji);
    }

    ROW.addComponents(BUTTON);
  }
  return ROW;
}

/** A string select menu row routed via the customId convention. */
export function selectRow(
  spec: SelectSpec
): ActionRowBuilder<StringSelectMenuBuilder> {
  const SELECT = new StringSelectMenuBuilder()
    .setCustomId(
      buildCustomId(spec.module, spec.action, ...(spec.args ?? []))
    )
    .addOptions(spec.options.slice(0, MAX_SELECT_OPTIONS));

  if (spec.placeholder) {
    SELECT.setPlaceholder(spec.placeholder);
  }

  if (spec.min_values !== undefined) {
    SELECT.setMinValues(spec.min_values);
  }

  if (spec.max_values !== undefined) {
    SELECT.setMaxValues(spec.max_values);
  }
  return new ActionRowBuilder<StringSelectMenuBuilder>()
    .addComponents(SELECT);
}

/** A modal whose submit routes back through `module:action`. */
export function buildModal(spec: ModalSpec): ModalBuilder {
  const MODAL = new ModalBuilder()
    .setCustomId(
      buildCustomId(spec.module, spec.action, ...(spec.args ?? []))
    )
    .setTitle(spec.title);

  for (const _input of spec.inputs) {
    const INPUT = new TextInputBuilder()
      .setCustomId(_input.key)
      .setStyle(
        _input.style === 'paragraph'
          ? TextInputStyle.Paragraph
          : TextInputStyle.Short
      )
      .setRequired(_input.required ?? false);

    if (_input.placeholder) {
      INPUT.setPlaceholder(_input.placeholder);
    }

    if (_input.value) {
      INPUT.setValue(_input.value);
    }

    MODAL.addLabelComponents(
      new LabelBuilder()
        .setLabel(_input.label)
        .setTextInputComponent(INPUT)
    );
  }
  return MODAL;
}

/** The standard confirm/cancel pair for destructive actions. */
export function confirmRow(
  module_name: string,
  action: string,
  args: string[] = []
): ActionRowBuilder<ButtonBuilder> {
  return buttonRow([
    {
      module: module_name,
      action,
      args: ['confirm', ...args],
      label: 'Confirm',
      style: 'danger',
    },
    {
      module: module_name,
      action,
      args: ['cancel', ...args],
      label: 'Cancel',
      style: 'secondary',
    },
  ]);
}
