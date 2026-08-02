export const NANO_VERSION = '0.3.1';
export const CONFIG_FILE_NAME = 'nano.config.json';

/* Distinct exit codes per exit path (PF18): a container supervisor
   and its logs must be able to tell WHY the process died. 0 stays
   the clean signal shutdown. */
export const EXIT_CODE_SHUTDOWN_FAILED = 1;
export const EXIT_CODE_FATAL_EXCEPTION = 2;
export const EXIT_CODE_LOGIN_FAILED = 3;
export const EXIT_CODE_INVALIDATED = 4;
