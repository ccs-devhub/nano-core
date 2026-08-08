import { ref } from 'vue';

import type { LocalizedText } from './types';

/**
 * The dashboard's own tiny i18n — no library, no locale routes, no
 * second bundle. Three pieces:
 *
 * - `locale` + `t()`: the HOST CHROME (breadcrumbs, buttons, table
 *   furniture) in the languages the host itself ships (en, es).
 * - `localized()`: resolves module DESCRIPTOR text, which may be a
 *   plain string or a `{ lang: text }` map — a module may be
 *   authored in ANY language set it declares in
 *   `manifest.languages` (first entry = its default).
 * - per-module overrides: a reader may pin one module to a
 *   specific language; the pick persists per module id.
 *
 * Resolution order for module text: the reader's per-module pick,
 * then the global locale, then the module's default, then the
 * first entry present.
 */

export const CHROME_LANGUAGES = ['en', 'es'];

/** provide/inject key: a function returning the language preference
    chain of the enclosing module window (pick, global, default). */
export const LANG_PREFER_KEY = 'nano-lang-prefer';

const STORAGE_KEY = 'nano:lang';
const MODULE_KEY = 'nano:lang:module:';

function stored(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function persist(key: string, value: string): void {
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    /* private mode — the pick just does not survive the tab */
  }
}

function detect(): string {
  const SAVED = stored(STORAGE_KEY);

  if (CHROME_LANGUAGES.includes(SAVED)) {
    return SAVED;
  }

  const BROWSER = typeof navigator === 'undefined'
    ? ''
    : (navigator.language ?? '');
  return BROWSER.toLowerCase().startsWith('es') ? 'es' : 'en';
}

/** The global interface language (host chrome + default for text). */
export const locale = ref<string>(detect());

export function setLocale(code: string): void {
  if (CHROME_LANGUAGES.includes(code)) {
    locale.value = code;
    persist(STORAGE_KEY, code);
  }
}

/** Reactive per-module language picks ('' = follow the global). */
const module_picks = ref<Record<string, string>>({});

export function moduleLocale(module_id: string): string {
  if (module_picks.value[module_id] === undefined) {
    module_picks.value = {
      ...module_picks.value,
      [module_id]: stored(`${MODULE_KEY}${module_id}`),
    };
  }
  return module_picks.value[module_id];
}

export function setModuleLocale(module_id: string, code: string): void {
  module_picks.value = { ...module_picks.value, [module_id]: code };
  persist(`${MODULE_KEY}${module_id}`, code);
}

/** Resolve descriptor text against a preference chain. */
export function localized(
  text: LocalizedText | undefined,
  prefer: string[] = []
): string {
  if (text === undefined) {
    return '';
  }

  if (typeof text === 'string') {
    return text;
  }

  for (const _code of [...prefer, locale.value, 'en']) {
    if (_code && text[_code]) {
      return text[_code];
    }
  }

  const FIRST = Object.values(text)[0];
  return FIRST ?? '';
}

const MESSAGES: Record<string, Record<string, string>> = {
  en: {
    dashboard: 'dashboard',
    log_out: 'log out',
    log_in: 'log in',
    log_in_discord: 'log in with discord',
    login_blurb:
      'Authenticate with Discord to manage the guilds you administrate.',
    host_badge: 'host',
    breadcrumb: 'breadcrumb',
    toggle: 'toggle',
    network_error: 'The network request failed.',
    not_authenticated: 'Not authenticated.',
    bad_response: 'The server answered without a readable body.',
    reference_missing:
      'Guild roles and channels could not load, pickers accept ' +
      'raw ids.',
    go_to_slide: 'go to media {n}',
    interface_language: 'interface language',
    module_language: 'module language',
    follow_global: 'auto',
    your_guilds: 'your guilds',
    invite_bot: 'invite the bot',
    configurable: 'configurable',
    no_guilds: 'No guilds where you hold the admin bar.',
    load_guilds_failed: 'Failed to load guilds.',
    guilds: 'guilds',
    guild_navigation: 'guild navigation',
    overview: 'overview',
    modules: 'modules',
    config: 'config',
    run: 'run',
    configure: 'configure',
    live: 'live',
    actions: 'actions',
    unavailable: 'unavailable',
    no_dashboard: 'no dashboard',
    bot: 'bot',
    capabilities: 'capabilities',
    no_modules: 'No modules on this instance.',
    enabled: 'enabled',
    disabled: 'disabled',
    toggle_failed: 'toggle failed',
    configure_name: 'configure {name}',
    on_off: '{name} on/off',
    guild_stats: 'guild stats',
    load_failed: 'Failed to load.',
    back_to: 'back to {name}',
    version_mismatch:
      'Descriptor config_version {a} does not match the module\'s ' +
      'registered version {b} — fields missing from the stored ' +
      'config render as placeholders and are never written.',
    descriptor_failed: 'Failed to load the descriptor.',
    config_failed: 'Failed to load the config.',
    not_present:
      '{label} — not present in this module version, nothing will ' +
      'be written for this field.',
    save_changes: 'save changes',
    saving: 'saving...',
    saves_every: 'saves every edited section',
    saved: 'saved:',
    save_failed: 'Save failed.',
    apply_now: 'apply now:',
    load: 'load',
    reload: 'reload',
    open_actions: 'open actions',
    raw_fallback: 'Raw result straight from the module.',
    running: 'running {id}...',
    done: 'done',
    failed: 'failed',
    confirm_run: 'Run \'{label}\'?',
    find_ids: 'find the ids in {view} below',
    commands: 'commands',
    commands_hint: 'Slash commands this module answers to.',
    subcommands: 'subcommands',
    subcommands_hint: 'Paths inside the commands above.',
    gated_off: 'turned off',
    gated_off_hint: 'Paths this server turned off.',
    command_on_off: '{name} on/off',
    recovery_note: 'always on, the recovery path',
    access: 'access',
    allowed_roles: 'roles allowed',
    allowed_members: 'members allowed',
    add_member_id: 'add a member id',
    empty_means_everyone:
      'Empty lists mean everyone with Discord permission can run ' +
      'it.',
    examples: 'examples:',
    commands_card_desc:
      'See every command, turn paths on or off, and choose who ' +
      'can run them.',
    media_label: 'module media',
    open_post: 'open post',
    previous_media: 'previous',
    next_media: 'next',
    select_placeholder: 'select...',
    nothing_to_pick: 'nothing to pick',
    resolves_to: ':: {name}',
    search_placeholder: 'search... (or column: value)',
    search_aria: 'search rows, or scope with column name then colon',
    rows: 'rows',
    page: 'page',
    nothing_here: 'nothing here',
    updated: ':: updated {time}',
    owner_only: 'bot owner only',
    template_placeholder:
      'Message text - Discord formatting works here.',
    slots: 'slots:',
    none_option: '(none)',
    add_ellipsis: 'add...',
    add_id_enter: 'add snowflake id + enter',
    snowflake_id: 'snowflake id',
    add_to: 'add to {label}',
    add_item: 'add {label}',
    remove_from_list: 'remove from list',
    move_up: 'move up',
    move_down: 'move down',
    remove_entry: 'remove this entry',
  },
  es: {
    dashboard: 'tablero',
    log_out: 'cerrar sesión',
    log_in: 'iniciar sesión',
    log_in_discord: 'iniciar sesión con discord',
    login_blurb:
      'Autentícate con Discord para administrar los servidores ' +
      'donde eres admin.',
    host_badge: 'host',
    breadcrumb: 'ruta',
    toggle: 'alternar',
    network_error: 'La red falló al pedir los datos.',
    not_authenticated: 'Sin sesión iniciada.',
    bad_response: 'El servidor respondió sin un cuerpo legible.',
    reference_missing:
      'No se pudieron cargar los roles y canales del servidor, ' +
      'los campos aceptan ids directos.',
    go_to_slide: 'ir al medio {n}',
    interface_language: 'idioma de la interfaz',
    module_language: 'idioma del módulo',
    follow_global: 'auto',
    your_guilds: 'tus servidores',
    invite_bot: 'invita al bot',
    configurable: 'configurable',
    no_guilds: 'No hay servidores donde seas administrador.',
    load_guilds_failed: 'No se pudieron cargar los servidores.',
    guilds: 'servidores',
    guild_navigation: 'navegación del servidor',
    overview: 'resumen',
    modules: 'módulos',
    config: 'config',
    run: 'ejecutar',
    configure: 'configurar',
    live: 'en vivo',
    actions: 'acciones',
    unavailable: 'no disponible',
    no_dashboard: 'sin tablero',
    bot: 'bot',
    capabilities: 'capacidades',
    no_modules: 'No hay módulos en esta instancia.',
    enabled: 'activado',
    disabled: 'desactivado',
    toggle_failed: 'no se pudo cambiar',
    configure_name: 'configurar {name}',
    on_off: '{name} encendido/apagado',
    guild_stats: 'estadísticas del servidor',
    load_failed: 'No se pudo cargar.',
    back_to: 'volver a {name}',
    version_mismatch:
      'La config_version {a} del descriptor no coincide con la ' +
      'versión registrada {b} del módulo — los campos que faltan ' +
      'en la config guardada se muestran vacíos y nunca se ' +
      'escriben.',
    descriptor_failed: 'No se pudo cargar el descriptor.',
    config_failed: 'No se pudo cargar la configuración.',
    not_present:
      '{label} — no existe en esta versión del módulo, no se ' +
      'escribirá nada para este campo.',
    save_changes: 'guardar cambios',
    saving: 'guardando...',
    saves_every: 'guarda cada sección editada',
    saved: 'guardado:',
    save_failed: 'No se pudo guardar.',
    apply_now: 'aplicar ahora:',
    load: 'cargar',
    reload: 'recargar',
    open_actions: 'abrir acciones',
    raw_fallback: 'Resultado crudo directo del módulo.',
    running: 'ejecutando {id}...',
    done: 'listo',
    failed: 'falló',
    confirm_run: '¿Ejecutar \'{label}\'?',
    find_ids: 'encuentra los ids en {view} más abajo',
    commands: 'comandos',
    commands_hint: 'Comandos de barra que responde este módulo.',
    subcommands: 'subcomandos',
    subcommands_hint: 'Rutas dentro de los comandos de arriba.',
    gated_off: 'apagados',
    gated_off_hint: 'Rutas que este servidor apagó.',
    command_on_off: '{name} encendido/apagado',
    recovery_note: 'siempre activo, la ruta de rescate',
    access: 'acceso',
    allowed_roles: 'roles permitidos',
    allowed_members: 'miembros permitidos',
    add_member_id: 'agrega el id de un miembro',
    empty_means_everyone:
      'Listas vacías significan que puede usarlo cualquiera con ' +
      'permiso de Discord.',
    examples: 'ejemplos:',
    commands_card_desc:
      'Mira cada comando, prende o apaga rutas, y elige quién ' +
      'puede usarlos.',
    media_label: 'galería del módulo',
    open_post: 'ver el post',
    previous_media: 'anterior',
    next_media: 'siguiente',
    select_placeholder: 'elegir...',
    nothing_to_pick: 'nada por elegir',
    resolves_to: ':: {name}',
    search_placeholder: 'buscar... (o columna: valor)',
    search_aria:
      'busca filas, o filtra con el nombre de la columna y dos puntos',
    rows: 'filas',
    page: 'página',
    nothing_here: 'nada por aquí',
    updated: ':: actualizado {time}',
    owner_only: 'solo el dueño del bot',
    template_placeholder:
      'Texto del mensaje, el formato de Discord funciona aquí.',
    slots: 'variables:',
    none_option: '(ninguno)',
    add_ellipsis: 'agregar...',
    add_id_enter: 'agrega el id y presiona enter',
    snowflake_id: 'id de discord',
    add_to: 'agregar a {label}',
    add_item: 'agregar {label}',
    remove_from_list: 'quitar de la lista',
    move_up: 'subir',
    move_down: 'bajar',
    remove_entry: 'quitar esta entrada',
  },
};

/** Test-facing view of the chrome dictionaries (parity gate). */
export function chromeDictionaries(): Record<
  string,
  Record<string, string>
  > {
  return MESSAGES;
}

/** Host chrome text with `{slot}` interpolation. */
export function t(
  key: string,
  params: Record<string, string | number> = {}
): string {
  const RAW = MESSAGES[locale.value]?.[key] ??
    MESSAGES.en[key] ?? key;
  return RAW.replace(
    /\{([a-z_]+)\}/g,
    (match: string, slot: string): string => {
      return params[slot] !== undefined ? String(params[slot]) : match;
    }
  );
}
